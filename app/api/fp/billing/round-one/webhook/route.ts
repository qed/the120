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
  fillRoundOneParentPhone,
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

  let metadata = metadataFrom(session?.metadata);
  let paymentIntentId = session && typeof session.payment_intent === "string"
    ? session.payment_intent
    : null;
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
    paymentIntentId = typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : null;
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

  const plan = planRoundOneWebhook({
    eventId: event.id,
    eventType: event.type,
    paymentStatus: session?.payment_status ?? null,
    fullRefund: charge?.refunded === true,
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

  const applied = await applyRoundOneWebhookPlan(supabaseAdmin(), plan);
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
