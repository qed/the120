import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/app/lib/supabase/server";
import { RESERVE_GATE_MESSAGE, canReserveSeatForChild, hasPaidDeposit } from "@/app/dashboard/data";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { getSeatsRemainingStrict } from "@/app/lib/seats";
import { REFUND_POLICY, resolveOrigin } from "@/app/lib/funnel/deposit-rules";
import { recordCheckoutAttempt } from "@/app/lib/funnel/deposit-core";

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
    const { childId, policyAccepted, policyVersion } = (await req.json()) as {
      childId?: string;
      policyAccepted?: boolean;
      policyVersion?: string;
    };
    if (!childId) return NextResponse.json({ error: "childId required" }, { status: 400 });
    // R51a: the full policy renders inline above an UNTICKED checkbox; the
    // server refuses a request that skipped it (a UI-only checkbox is a
    // crafted POST away from meaningless).
    if (policyAccepted !== true) {
      return NextResponse.json(
        { error: "Please read and accept the refund policy first." },
        { status: 400 }
      );
    }
    // The acceptance record stamps the SERVER's current version — so the
    // client must prove it rendered that same version. A stale tab (or a
    // pre-bump bundle, which sends no version at all) is refused and told
    // to refresh, instead of being silently recorded as consenting to text
    // it never displayed (the record is dispute evidence AND the U15
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

    // R51a + R52b: the attempt row persists the policy acceptance
    // (version/hash/timestamp/IP) and anchors the Stripe idempotency key —
    // a PERSISTED key, not a bare per-child string, which Stripe prunes at
    // 24h and would block a legitimate retry.
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
    // CHILD-scoped idempotency key with STABLE params (no attempt id in
    // metadata — the attempt links to the session below instead): a
    // double-click or second device replays the SAME open session instead
    // of minting a second payable one (the adversarial review: the
    // per-attempt key un-deduped checkout; the partial index only catches
    // the second session at PAYMENT, $500 already taken). expires_at
    // shortens the double-payment window from Stripe's 24h default to the
    // minimum 30 minutes.
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ price: process.env.STRIPE_DEPOSIT_PRICE_ID!, quantity: 1 }],
        customer_email: user.email,
        metadata: { child_id: childId, parent_id: user.id },
        payment_intent_data: {
          description: `The 120 — refundable seat deposit (${child.first_name || "child"})`,
          metadata: { child_id: childId, parent_id: user.id },
        },
        // U7 (W13): success lands on the ARRIVAL page — without this the
        // acceptance moment is unreachable. Cancel keeps the dashboard
        // (nothing to arrive at; the page itself also redirects any
        // session with no live paid deposit back to the dashboard).
        success_url: `${origin}/start/arrival?child=${encodeURIComponent(childId)}`,
        cancel_url: `${origin}/dashboard?deposit=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      { idempotencyKey: `deposit:${childId}` }
    );

    // R51a: the acceptance record links to the session it opened. The
    // attempt row is the POLICY record; the session id ties it to money.
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
