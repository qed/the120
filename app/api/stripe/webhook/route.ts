import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { alertIfAtCapacity, applyStripeEvent, type WebhookDeps } from "@/app/lib/funnel/deposit-core";
import { SEATS_TOTAL } from "@/app/lib/site";
import { FOUNDING_COMMITMENTS } from "@/app/lib/seats";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
import { ensureProvisionClaim } from "@/app/lib/funnel/provision-deps";
import { notifyOps } from "@/app/lib/ops-alert";

/**
 * S3 + funnel U14: the Stripe webhook, rebuilt over the deps-injected core.
 * Every branch decision lives in deposit-rules/deposit-core (tested without
 * Stripe); this file only verifies the signature, normalizes the event, and
 * maps the outcome to an HTTP status. Handles completed (paid AND unpaid),
 * async_payment_succeeded / async_payment_failed / expired (a delayed
 * payment used to arrive and never be recorded), and charge.refunded. A
 * redelivered `completed` after a refund is a no-op — the refund is newer
 * truth (the carried refunded_at bug, closed).
 */

function realDeps(): WebhookDeps {
  const db = supabaseAdmin();
  return {
    findBySession: async (sessionId) => {
      const { data, error } = await db
        .from("deposits")
        .select("status, refunded_at")
        .eq("stripe_session_id", sessionId)
        .maybeSingle();
      if (error) return "error";
      return data ?? null;
    },
    writeDeposit: async (row) => {
      // CONDITIONAL IN SQL (deposit_fulfil RPC): the core's verdict is a
      // read-then-write, and a refund committing between the two let a
      // retried `completed` overwrite refunded with paid (TOCTOU — the
      // adversarial review). The refusal now happens atomically.
      const { data, error } = await db.rpc("deposit_fulfil", {
        p_session_id: row.sessionId,
        p_payment_intent: row.paymentIntent,
        p_parent_id: row.parentId,
        p_child_id: row.childId,
        p_amount: row.amount,
        p_currency: row.currency,
        p_status: row.status,
      });
      if (error) {
        console.error("[stripe/webhook] deposit write failed:", error.message);
        return "error";
      }
      if (data === "conflict") return "conflict";
      // "refused_refunded" is a successful no-op: the refund stands.
      return "written";
    },
    setStatus: async (sessionId, status) => {
      const { error } = await db
        .from("deposits")
        .update({ status })
        .eq("stripe_session_id", sessionId);
      if (error) console.error("[stripe/webhook] status update failed:", error.message);
      return !error;
    },
    markRefunded: async (paymentIntent) => {
      // U8 (W15): ONE SQL transaction — the refund mark, the claim's flip
      // to suspend_pending, and the never-reissue ledger insert commit or
      // roll back together (deposit_refund_release RPC). The refund mark
      // is the effective dedupe stamp: separate PostgREST calls after it
      // would be lost forever on a crash, because the replayed refund
      // no-ops and Stripe stops retrying.
      //
      // 'no_deposit' keeps the zero-rows-is-FAILURE lesson exactly: Stripe
      // does not order deliveries, and a refund arriving before its
      // `completed` must answer non-200 and retry until the row lands.
      // (Residual, documented: a refund for a session whose row NEVER
      // lands — the double-paid second session — retries to exhaustion;
      // the log below is the staff signal.)
      const { data, error } = await db.rpc("deposit_refund_release", {
        p_payment_intent: paymentIntent,
      });
      if (error) {
        console.error("[stripe/webhook] refund release failed:", error.message);
        return false;
      }
      if (data === "no_deposit") {
        console.error(
          `[stripe/webhook] refund matched ZERO rows for intent ${paymentIntent} — retrying until the deposit lands`
        );
        return false;
      }
      // 'released' or 'noop_replay' — both acknowledged; exactly one
      // ledger row exists either way (ON CONFLICT DO NOTHING).
      return true;
    },
    linkAttempt: async (attemptId, sessionId) => {
      const { error } = await db
        .from("deposit_attempts")
        .update({ stripe_session_id: sessionId })
        .eq("id", attemptId);
      if (error) console.error("[stripe/webhook] attempt link failed:", error.message);
    },
  };
}

export async function POST(req: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const isSessionEvent = event.type.startsWith("checkout.session.");
  const session = isSessionEvent ? (event.data.object as Stripe.Checkout.Session) : null;
  // P0 2026-07-30: Stripe's own consent record is the affirmative
  // acceptance evidence (the attempt row records what checkout PRESENTED,
  // not that anyone accepted it). "none" is the degraded rendered-text-only
  // session (no ToS URL configured) — the policy still rendered; payment
  // itself was the affirmative act.
  const tosConsent: "accepted" | "none" =
    session?.consent?.terms_of_service === "accepted" ? "accepted" : "none";
  const charge = event.type === "charge.refunded" ? (event.data.object as Stripe.Charge) : null;

  // charge.refunded fires for PARTIAL refunds too; `charge.refunded` (the
  // boolean) is true only when FULLY refunded. Marking a $50 goodwill
  // partial as status='refunded' would reopen the Reserve button to a
  // family who paid $250 and got $50 back (the adversarial review). A
  // partial refund is a staff-ledger event, not a status change.
  if (charge && charge.refunded !== true) {
    console.error(
      `[stripe/webhook] PARTIAL refund on intent ${typeof charge.payment_intent === "string" ? charge.payment_intent : "?"} (${charge.amount_refunded}/${charge.amount}) — no status change, staff ledger entry needed`
    );
    return NextResponse.json({ received: true });
  }

  const outcome = await applyStripeEvent(realDeps(), {
    type: event.type,
    session: session
      ? {
          id: session.id,
          paymentStatus: session.payment_status ?? null,
          paymentIntent:
            typeof session.payment_intent === "string" ? session.payment_intent : null,
          childId: session.metadata?.child_id ?? null,
          parentId: session.metadata?.parent_id ?? null,
          attemptId: session.metadata?.attempt_id ?? null,
          amount: session.amount_total,
          currency: session.currency,
        }
      : undefined,
    refundPaymentIntent:
      charge && typeof charge.payment_intent === "string" ? charge.payment_intent : null,
  });

  if (outcome.kind === "failed") {
    // Non-200 → Stripe retries; the write path is idempotent by session id.
    return NextResponse.json({ error: "DB write failed" }, { status: 500 });
  }
  if (outcome.kind === "ok" && outcome.fulfilled) {
    // Consent persistence (P0 2026-07-30): neither deposit_attempts nor
    // deposits has a column that fits Stripe's consent verdict (checked
    // 2026-07-30 — no jsonb, every text column load-bearing), and a
    // migration is deliberately NOT added here (Lane B holds the lock).
    // FOLLOW-UP: Lane B migration adding e.g.
    // `deposit_attempts.tos_consented_at timestamptz`. Until then the
    // verdict rides (a) this log and (b) the c3_deposit event's jsonb
    // properties below; the session id on the attempt/deposit rows is the
    // retrievable Stripe-side evidence anchor either way
    // (sessions.retrieve(id).consent).
    if (tosConsent === "accepted") {
      console.log(
        `[stripe/webhook] ToS consent ACCEPTED on session ${outcome.fulfilled.sessionId} (Stripe consent record is the acceptance evidence)`
      );
    } else {
      console.error(
        `[stripe/webhook] deposit fulfilled WITHOUT a Stripe consent record — session ${outcome.fulfilled.sessionId} was a degraded rendered-text-only checkout (ToS URL unset?). Acceptance evidence is the rendered policy + payment itself.`
      );
    }
    // R56/R58: C3 — once per WRITTEN fulfilment, never per replay.
    // AWAITED: a serverless freeze after the 200 must not eat the
    // conversion the ads math divides by.
    await emitFunnelEvent(
      "c3_deposit",
      { childId: outcome.fulfilled.childId, parentId: outcome.fulfilled.parentId },
      { session: outcome.fulfilled.sessionId, tos_consent: tosConsent }
    );
  }
  // W6a: a cleared bank debit is honoured even past capacity, so the
  // over-allocation must be visible. The replay suppression lives INSIDE
  // alertIfAtCapacity (it takes the whole outcome and returns
  // "not_fulfilled" for a replay_noop), so it is a tested behaviour of
  // the core rather than a property of where this line sits.
  await alertIfAtCapacity(
    {
      readSeatsClaimed: async () => {
        const { data } = await supabaseAdmin().rpc("seats_claimed");
        return typeof data === "number" ? data : null;
      },
      notify: notifyOps,
    },
    outcome,
    SEATS_TOTAL,
    FOUNDING_COMMITMENTS
  );
  // U15 (wrap U6 part 2): the provisioning CLAIM, and only the claim —
  // never a Google or Supabase-admin call in the request path; the legs
  // run out-of-band under the lease RPC (arrival page, cron sweep).
  // AWAITED, and load-bearing: a paid child with no claim row is a family
  // nothing will ever provision. The insert is idempotent by
  // UNIQUE(child_id), and a failure answers non-200 so Stripe redelivers —
  // the redelivery is a replay_noop, which carries `replayedPaid` exactly
  // so this line can heal the missing claim (a refunded row never reaches
  // either arm).
  const claimFor = outcome.kind === "ok" ? (outcome.fulfilled ?? outcome.replayedPaid) : undefined;
  if (claimFor) {
    const claimed = await ensureProvisionClaim(claimFor.childId);
    if (!claimed) {
      return NextResponse.json({ error: "provisioning claim failed" }, { status: 500 });
    }
  }
  if (outcome.kind === "double_paid" && session) {
    // A family paid twice for one seat: a refund is owed and only a human
    // can issue it. The console.error alone was the whole detection channel
    // (closing-note carried item 18). KNOWN: a Stripe redelivery of the
    // conflicting session repeats this alert (its row never lands, so no
    // replay_noop) — duplicates of a rare, refund-owed event are the safe
    // direction; a tombstone row can dedupe it if the noise ever matters.
    await notifyOps(
      "DOUBLE PAID deposit — refund required",
      `child=${session.metadata?.child_id ?? "?"}\nsession=${session.id}\nRefund the second payment in the Stripe dashboard.`
    );
  }
  // "double_paid" is acknowledged (retrying cannot fix it) after the loud log.
  return NextResponse.json({ received: true });
}
