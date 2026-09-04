/**
 * Stripe webhook for First Profit Round One only.
 *
 * This route has its own webhook signing secret and does not share The 120 seat
 * deposit handler. Signature verification happens over the raw body before any
 * metadata is inspected. The metadata then points back to a pre-existing order;
 * the SQL transaction compares parent, child, product, version, amount and
 * currency before it can activate access.
 */

import Stripe from "stripe";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  planRoundOneWebhook,
  ROUND_ONE_STRIPE_API_VERSION,
  webhookRpcOutcomeIsSuccess,
  type RoundOneWebhookMetadata,
} from "../round-one-rules";
import { sendRoundOneStripeSetupEmail } from "../round-one-setup-email";
import {
  applyRoundOneWebhookPlan,
  cancelRoundOneExpiredCheckout,
  fillRoundOneParentPhone,
  markRoundOneWebhookCleanupComplete,
  readRoundOnePendingCheckouts,
  readRoundOneWebhookCleanupProvenance,
  type RoundOneWebhookCleanupScope,
} from "../round-one-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function metadataFrom(value: Stripe.Metadata | null | undefined): RoundOneWebhookMetadata {
  return {
    billingKind: value?.billing_kind ?? null,
    orderId: value?.order_id ?? null,
    parentId: value?.parent_id ?? null,
    childId: value?.child_id ?? null,
    productKey: value?.product_key ?? null,
    productVersion: value?.product_version ?? null,
  };
}

/** Stripe can deliver expandable references as either an id or an expanded
 * object. Normalize both so webhook ordering does not depend on expansion. */
function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id.trim() || null : null;
}

/**
 * A dispute can commit after a replacement Checkout URL was already returned.
 * The database hold immediately blocks access and any new URL, while this
 * post-commit pass closes every still-open sibling Session at Stripe. There is
 * no atomic transaction across Stripe and Postgres: a Session that races to
 * `complete` remains financial truth, but its paid event cannot restore access.
 */
async function closePendingCheckoutsAfterDispute(
  db: ReturnType<typeof supabaseAdmin>,
  stripe: Stripe,
  input: RoundOneWebhookCleanupScope
): Promise<boolean> {
  const pending = await readRoundOnePendingCheckouts(db, input);
  if (pending === "error") return false;

  let allClosed = true;
  for (const checkout of pending) {
    try {
      const session = await stripe.checkout.sessions.retrieve(checkout.sessionId);
      if (session.id !== checkout.sessionId) {
        allClosed = false;
        continue;
      }

      if (session.status === "open") {
        const expired = await stripe.checkout.sessions.expire(checkout.sessionId);
        if (expired.id !== checkout.sessionId || expired.status !== "expired") {
          allClosed = false;
          continue;
        }
      } else if (session.status === "complete") {
        // Stripe cannot expire a completed Session. The sticky database hold
        // still prevents fulfilment; its paid webhook makes the charge visible
        // for staff refund review instead of reopening course access.
        console.error(
          `[fp/billing/round-one/webhook] disputed product has completed sibling order ${checkout.orderId}; access remains suspended`
        );
        continue;
      } else if (session.status !== "expired") {
        allClosed = false;
        continue;
      }

      if (!(await cancelRoundOneExpiredCheckout(db, checkout))) {
        allClosed = false;
      }
    } catch (err) {
      console.error(
        `[fp/billing/round-one/webhook] sibling Checkout cleanup failed for order ${checkout.orderId}: ${err instanceof Error ? err.message : String(err)}`
      );
      allClosed = false;
    }
  }
  return allClosed;
}

async function finishDisputeCheckoutCleanup(
  db: ReturnType<typeof supabaseAdmin>,
  stripe: Stripe,
  eventId: string,
  eventType: "charge.dispute.created" | "charge.dispute.closed"
): Promise<"complete" | "missing" | "error"> {
  const provenance = await readRoundOneWebhookCleanupProvenance(
    db,
    eventId,
    eventType
  );
  if (provenance === "missing" || provenance === "error") return provenance;
  if (provenance.state === "complete") return "complete";
  if (!(await closePendingCheckoutsAfterDispute(db, stripe, provenance.scope))) {
    return "error";
  }
  return await markRoundOneWebhookCleanupComplete(db, {
    eventId,
    orderId: provenance.scope.orderId,
  })
    ? "complete"
    : "error";
}

export async function POST(req: Request): Promise<Response> {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.FP_ROUND_ONE_STRIPE_WEBHOOK_SECRET?.trim();
  const expectedPriceId = process.env.FP_ROUND_ONE_STRIPE_PRICE_ID?.trim();
  if (!stripeKey || !webhookSecret || !expectedPriceId) {
    console.error("[fp/billing/round-one/webhook] configuration is incomplete");
    return Response.json({ error: "Webhook unavailable" }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  const stripe = new Stripe(stripeKey, {
    apiVersion: ROUND_ONE_STRIPE_API_VERSION,
  });
  let event: Stripe.Event;
  try {
    const raw = await req.text();
    event = await stripe.webhooks.constructEventAsync(raw, signature, webhookSecret);
  } catch (err) {
    console.error(
      `[fp/billing/round-one/webhook] signature verification failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const isSession = event.type.startsWith("checkout.session.");
  const session = isSession ? (event.data.object as Stripe.Checkout.Session) : null;
  const charge = event.type === "charge.refunded"
    ? (event.data.object as Stripe.Charge)
    : null;
  const dispute = event.type === "charge.dispute.created"
    || event.type === "charge.dispute.closed"
    ? (event.data.object as Stripe.Dispute)
    : null;
  const disputeEventType = event.type === "charge.dispute.created"
    || event.type === "charge.dispute.closed"
    ? event.type
    : null;
  const db = supabaseAdmin();

  if (disputeEventType) {
    // Preflight before retrieving mutable PaymentIntent metadata. If the event
    // already committed, its ledger/order FK is the only cleanup provenance;
    // changed or cleared Stripe metadata cannot redirect or bypass the retry.
    const replayCleanup = await finishDisputeCheckoutCleanup(
      db,
      stripe,
      event.id,
      disputeEventType
    );
    if (replayCleanup === "error") {
      return Response.json(
        { error: "Disputed checkout cleanup incomplete" },
        { status: 500 }
      );
    }
    if (replayCleanup === "complete") {
      return Response.json({ received: true });
    }
  }

  let metadata = metadataFrom(session?.metadata);
  let paymentIntentId = stripeObjectId(session?.payment_intent);
  let processorObjectId: string | null = null;
  let processorStatus: string | null = null;
  let processorReason: string | null = null;
  let processorAmount: number | null = null;
  let processorTotalAmount: number | null = null;
  const needsCatalogProof = !!session && (
    event.type === "checkout.session.completed"
    || event.type === "checkout.session.async_payment_succeeded"
  );
  let catalogPriceMatches = false;
  if (needsCatalogProof) {
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 2,
        expand: ["data.price"],
      });
      const item = lineItems.data[0];
      const itemPriceId = typeof item?.price === "string"
        ? item.price
        : item?.price?.id ?? null;
      catalogPriceMatches = lineItems.data.length === 1
        && item?.quantity === 1
        && itemPriceId === expectedPriceId;
    } catch (err) {
      console.error(
        `[fp/billing/round-one/webhook] line-item lookup failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return Response.json({ error: "Payment lookup failed" }, { status: 500 });
    }
  }

  // Promotion Codes reduce amount_total. Fulfilment binds the exact catalog
  // line/subtotal and verifies Stripe's subtotal = total + discount equation.
  // Refund events do not use these fields and resolve by PaymentIntent.
  let amountSubtotal = session?.amount_subtotal ?? null;
  let amountTotal = session?.amount_total ?? null;
  let amountDiscount = session
    ? session.total_details?.amount_discount ?? 0
    : null;
  let amountTax = session ? session.total_details?.amount_tax ?? 0 : null;
  let currency = session?.currency ?? null;

  if (charge) {
    paymentIntentId = stripeObjectId(charge.payment_intent);
    processorObjectId = charge.id;
    processorStatus = charge.refunded ? "fully_refunded" : "partially_refunded";
    processorAmount = charge.amount_refunded;
    processorTotalAmount = charge.amount;
    amountSubtotal = null;
    amountTotal = null;
    amountDiscount = null;
    amountTax = null;
    currency = charge.currency;
    // payment_intent_data.metadata is attached to the PaymentIntent. Retrieve
    // it so an out-of-order refund can still resolve its pre-existing order
    // before checkout.session.completed has stored the intent id locally.
    if (paymentIntentId) {
      try {
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        metadata = metadataFrom(intent.metadata);
      } catch (err) {
        console.error(
          `[fp/billing/round-one/webhook] payment intent lookup failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return Response.json({ error: "Payment lookup failed" }, { status: 500 });
      }
    } else {
      metadata = metadataFrom(charge.metadata);
    }
  }

  if (dispute) {
    paymentIntentId = stripeObjectId(dispute.payment_intent);
    processorObjectId = dispute.id;
    processorStatus = dispute.status;
    processorReason = dispute.reason;
    processorAmount = dispute.amount;
    currency = dispute.currency;

    // Round One Checkout always creates a PaymentIntent. The current Dispute
    // object exposes that expandable id directly; the Charge fallback covers a
    // webhook snapshot where it is absent without ever trusting Dispute
    // metadata as order identity.
    if (!paymentIntentId) {
      const chargeId = stripeObjectId(dispute.charge);
      if (!chargeId) {
        console.error("[fp/billing/round-one/webhook] dispute had no charge identity");
        return Response.json({ error: "Payment lookup failed" }, { status: 500 });
      }
      try {
        const disputedCharge = await stripe.charges.retrieve(chargeId);
        paymentIntentId = stripeObjectId(disputedCharge.payment_intent);
      } catch (err) {
        console.error(
          `[fp/billing/round-one/webhook] disputed charge lookup failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return Response.json({ error: "Payment lookup failed" }, { status: 500 });
      }
    }
    if (!paymentIntentId) {
      console.error("[fp/billing/round-one/webhook] dispute had no PaymentIntent identity");
      return Response.json({ error: "Payment lookup failed" }, { status: 500 });
    }
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      metadata = metadataFrom(intent.metadata);
    } catch (err) {
      console.error(
        `[fp/billing/round-one/webhook] disputed PaymentIntent lookup failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return Response.json({ error: "Payment lookup failed" }, { status: 500 });
    }
  }

  const plan = planRoundOneWebhook({
    eventId: event.id,
    eventType: event.type,
    paymentStatus: session?.payment_status ?? null,
    fullRefund: charge?.refunded === true,
    processorObjectId,
    processorStatus,
    processorReason,
    processorAmount,
    processorTotalAmount,
    metadata,
    sessionId: session?.id ?? null,
    paymentIntentId,
    catalogPriceMatches,
    amountSubtotal,
    amountTotal,
    amountDiscount,
    amountTax,
    currency,
  });

  if (plan.kind === "ignore") {
    return Response.json({ received: true });
  }
  if (plan.kind === "invalid") {
    console.error("[fp/billing/round-one/webhook] signed Round One event had invalid metadata");
    return Response.json({ error: "Invalid Round One metadata" }, { status: 500 });
  }

  const applied = await applyRoundOneWebhookPlan(db, plan);
  if (!applied.ok || !webhookRpcOutcomeIsSuccess(applied.outcome)) {
    console.error(
      `[fp/billing/round-one/webhook] event effect refused: ${applied.ok ? applied.outcome : "db_error"}`
    );
    // Non-2xx keeps a paid-but-not-granted event in Stripe's retry queue.
    return Response.json({ error: "Round One fulfilment failed" }, { status: 500 });
  }
  if (applied.outcome === "duplicate_paid") {
    console.error(
      "[fp/billing/round-one/webhook] duplicate paid order detected; access preserved and staff refund review required"
    );
  }
  if (applied.outcome === "partial_refund_review") {
    console.error(
      "[fp/billing/round-one/webhook] partial Round One refund recorded; access preserved and staff review required"
    );
  }
  if (
    applied.outcome === "dispute_suspended"
    || applied.outcome === "dispute_stands"
    || applied.outcome === "dispute_closed_review"
  ) {
    console.error(
      "[fp/billing/round-one/webhook] Round One dispute recorded; access remains suspended pending staff review"
    );
  }
  if (disputeEventType) {
    const cleanup = await finishDisputeCheckoutCleanup(
      db,
      stripe,
      event.id,
      disputeEventType
    );
    if (cleanup !== "complete") {
      // The durable hold is already committed. Non-2xx asks Stripe to retry the
      // signed event so a transient Stripe/database cleanup failure can finish.
      return Response.json(
        { error: "Disputed checkout cleanup incomplete" },
        { status: 500 }
      );
    }
  }
  if (plan.effect === "paid") {
    const phone = session?.customer_details?.phone?.trim() ?? "";
    if (phone) {
      const phoneStored = await fillRoundOneParentPhone(supabaseAdmin(), {
        parentId: plan.parentId,
        phone,
      });
      if (!phoneStored) {
        // Stripe will retry this signed event. The financial effect is
        // idempotent, so a transient database failure can recover without
        // charging the parent again or duplicating access.
        return Response.json({ error: "Parent support details could not be saved" }, { status: 500 });
      }
    } else {
      // Older Checkout Sessions created before phone collection was enabled
      // can legitimately omit it. Preserve paid access and let Watchtower flag
      // the family for a manual follow-up instead of trapping fulfilment.
      console.error("[fp/billing/round-one/webhook] paid session had no parent phone");
    }
  }
  if (plan.effect === "paid" && applied.outcome === "granted") {
    // The financial RPC committed access and the durable notification row in
    // one transaction. Try that row immediately for low latency; any failure
    // remains pending for the notification cron and must never keep Stripe
    // retrying a financial event whose entitlement was successfully granted.
    const emailed = await sendRoundOneStripeSetupEmail(supabaseAdmin(), {
      orderId: plan.orderId,
      parentId: plan.parentId,
      childId: plan.childId,
    });
    if (emailed.status !== "sent") {
      console.error(
        `[fp/billing/round-one/webhook] setup email did not send: ${emailed.status}`
      );
    }
  }
  return Response.json({ received: true });
}
