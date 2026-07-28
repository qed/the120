import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { applyStripeEvent, type WebhookDeps } from "@/app/lib/funnel/deposit-core";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
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
      // ZERO rows is a FAILURE, not a success: Stripe does not order
      // deliveries, and a refund arriving before its `completed` would
      // otherwise be acknowledged against nothing and lost forever — the
      // family's money back, the books showing a paid seat (both U14
      // reviewers). Returning false answers non-200 so Stripe retries the
      // refund until the deposit row exists. (Residual, documented: a
      // refund for a session whose row NEVER lands — the double-paid
      // second session — retries to exhaustion; the log below is the
      // staff signal.)
      const { data, error } = await db
        .from("deposits")
        .update({ status: "refunded", refunded_at: new Date().toISOString() })
        .eq("stripe_payment_intent", paymentIntent)
        .select("stripe_session_id");
      if (error) {
        console.error("[stripe/webhook] refund update failed:", error.message);
        return false;
      }
      if ((data ?? []).length === 0) {
        console.error(
          `[stripe/webhook] refund matched ZERO rows for intent ${paymentIntent} — retrying until the deposit lands`
        );
        return false;
      }
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
    // R56/R58: C3 — once per WRITTEN fulfilment, never per replay.
    // AWAITED: a serverless freeze after the 200 must not eat the
    // conversion the ads math divides by.
    await emitFunnelEvent(
      "c3_deposit",
      { childId: outcome.fulfilled.childId, parentId: outcome.fulfilled.parentId },
      { session: outcome.fulfilled.sessionId }
    );
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
