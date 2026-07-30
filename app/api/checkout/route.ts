import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/app/lib/supabase/server";
import { RESERVE_GATE_MESSAGE, canReserveSeatForChild, hasPaidDeposit } from "@/app/dashboard/data";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { getSeatsRemainingStrict } from "@/app/lib/seats";
import { REFUND_POLICY, resolveOrigin } from "@/app/lib/funnel/deposit-rules";
import {
  createCheckoutSessionWithConsent,
  recordCheckoutAttempt,
} from "@/app/lib/funnel/deposit-core";

/**
 * S3: create a Stripe Checkout session for a child's $250 refundable seat deposit.
 * Auth: the parent's Supabase session cookie (browser) or a Bearer token (API).
 * RLS guarantees the child lookup only succeeds for the parent's own children.
 *
 * Approval gate (R11): checkout opens only at `offered` or later — the same
 * predicate family the dashboard CTA uses, enforced here so a direct API call
 * can't pay early. `children.status` is safe to gate on: only the staff-side
 * move_candidate RPC can advance it (parents are limited to draft → submitted
 * by the DB status guard).
 *
 * Since funnel U1 the gate is `canReserveSeatForChild`, which also refuses a
 * funnel child whose `applicant_state` sits before `offered` (or at
 * `waitlisted` — F7 closes checkout at zero seats). For every pre-funnel
 * child `applicant_state` is NULL and the verdict is bit-identical to the old
 * `canReserveSeat` — pinned by a regression sweep in
 * app/lib/__tests__/funnel-applicant-rules.test.ts. This is the SERVER gate;
 * it must adopt funnel awareness first, because a UI-only check is a request
 * away from being bypassed.
 */
export async function POST(req: Request) {
  try {
    const { childId, policyVersion } = (await req.json()) as {
      childId?: string;
      policyVersion?: string;
    };
    if (!childId) return NextResponse.json({ error: "childId required" }, { status: 400 });
    // P0 2026-07-30: NO accepted-boolean in the contract (a test pins its
    // absence). The old inline policy+checkbox is gone (6fa1f8f) and a
    // client-sent boolean over a surface that renders nothing is a
    // fabricated acceptance — the removed check only verified it. The policy
    // now renders — and is accepted — ON the Stripe-hosted checkout page
    // (consent_collection + custom_text below); Stripe's consent record is
    // the acceptance evidence.
    //
    // The version echo REMAINS load-bearing: the attempt row stamps the
    // SERVER's current version as "what checkout will present", so the
    // client must prove its bundle carries that same version. A stale tab
    // (or a pre-echo bundle, which sends no version at all) is refused and
    // told to refresh (the record is dispute evidence AND the U15
    // parental-consent artifact).
    if (policyVersion !== REFUND_POLICY.version) {
      return NextResponse.json(
        {
          error: "The policy text was updated. Refresh the page to review the current version.",
          stalePolicy: true,
        },
        { status: 409 }
      );
    }

    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const supabase = bearer
      ? createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${bearer}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          }
        )
      : await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

    const { data: child } = await supabase
      .from("children")
      .select("id, first_name, status, applicant_state")
      .eq("id", childId)
      .maybeSingle();
    if (!child) return NextResponse.json({ error: "Child not found" }, { status: 404 });
    if (child.status === "draft")
      return NextResponse.json(
        { error: "Submit the dossier before reserving a seat." },
        { status: 400 }
      );

    // F7: zero seats closes checkout and routes to the waitlist. STRICT
    // read: an unavailable count refuses rather than guessing (a stale
    // marketing fallback here could sell a seat that does not exist).
    const seatsRemaining = await getSeatsRemainingStrict();
    if (seatsRemaining === null) {
      return NextResponse.json(
        { error: "Seat availability is unavailable right now. Try again in a minute." },
        { status: 503 }
      );
    }
    if (seatsRemaining <= 0) {
      return NextResponse.json(
        { error: "The 120 seats are spoken for.", redirect: "/start/waitlist" },
        { status: 409 }
      );
    }

    const { data: depositRows } = await supabase
      .from("deposits")
      .select("status")
      .eq("child_id", childId);
    const deposits = depositRows ?? [];
    // A PENDING deposit (delayed bank debit, clearing for days) closes the
    // gate: without this, an anxious second card payment during the window
    // ends as a double charge surfacing days later as a 23505 log (the
    // adversarial review).
    if (deposits.some((d) => d.status === "pending")) {
      return NextResponse.json(
        { error: "A deposit payment is already processing for this child. Bank debits can take a few days to clear." },
        { status: 409 }
      );
    }
    if (
      !canReserveSeatForChild({
        status: child.status,
        applicantState: child.applicant_state,
        deposits,
      })
    ) {
      if (hasPaidDeposit(deposits))
        return NextResponse.json(
          { error: "A deposit is already paid for this child." },
          { status: 400 }
        );
      // Not yet approved — a distinct, non-retry message the client renders verbatim.
      return NextResponse.json({ error: RESERVE_GATE_MESSAGE }, { status: 400 });
    }

    // R51a + R52b: the attempt row persists the policy PRESENTATION record
    // (version/hash/timestamp/IP — what the checkout page will render, not
    // an acceptance; the acceptance is Stripe's consent record on the
    // session) and anchors the Stripe idempotency key — a PERSISTED key,
    // not a bare per-child string, which Stripe prunes at 24h and would
    // block a legitimate retry.
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const attempt = await recordCheckoutAttempt(
      {
        insertAttempt: async (row) => {
          const { data, error } = await supabaseAdmin()
            .from("deposit_attempts")
            .insert({
              parent_id: row.parentId,
              child_id: row.childId,
              policy_version: row.policyVersion,
              policy_hash: row.policyHash,
              accepted_ip: row.acceptedIp,
            })
            .select("id")
            .single();
          if (error) {
            console.error("[checkout] attempt insert failed:", error.message);
            return null;
          }
          return String(data.id);
        },
      },
      { parentId: user.id, childId, acceptedIp: ip }
    );
    if (!attempt) {
      return NextResponse.json({ error: "Could not start checkout" }, { status: 500 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    // NEVER the raw Origin header into redirect URLs — allowlisted or ours.
    const origin = resolveOrigin(req.headers.get("origin"));
    // P0 2026-07-30: the hosted checkout page renders the FULL refund
    // policy above a REQUIRED tick that gates payment (consent_collection +
    // custom_text.terms_of_service_acceptance), degrading once per process
    // to rendered-text-only (custom_text.submit) if the Stripe account's
    // ToS URL is not configured — checkout never bricks on a dashboard
    // setting. Params, idempotency keys (child-scoped, R52b), and the
    // degrade live in deposit-core so they are pinned by tests without
    // Stripe.
    const { session } = await createCheckoutSessionWithConsent(
      { createSession: (params, opts) => stripe.checkout.sessions.create(params, opts) },
      {
        childId,
        parentId: user.id,
        customerEmail: user.email,
        childFirstName: child.first_name || "child",
        priceId: process.env.STRIPE_DEPOSIT_PRICE_ID!,
        origin,
      }
    );

    // R51a: the presentation record links to the session it opened. The
    // attempt row is the POLICY record; the session id ties it to money AND
    // to Stripe's consent record (the acceptance evidence).
    await supabaseAdmin()
      .from("deposit_attempts")
      .update({ stripe_session_id: session.id })
      .eq("id", attempt.attemptId);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[checkout]", err);
    return NextResponse.json({ error: "Could not start checkout" }, { status: 500 });
  }
}
