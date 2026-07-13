import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/app/lib/supabase/admin";

/**
 * S3: Stripe webhook — records paid deposits (service role bypasses RLS;
 * parents can never write their own deposit rows). Idempotent via the
 * unique stripe_session_id (upsert), so Stripe retries are safe.
 */
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
    console.error("[webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const childId = session.metadata?.child_id;
    const parentId = session.metadata?.parent_id;
    if (childId && parentId && session.payment_status === "paid") {
      const { error } = await supabaseAdmin()
        .from("deposits")
        .upsert(
          {
            stripe_session_id: session.id,
            stripe_payment_intent:
              typeof session.payment_intent === "string" ? session.payment_intent : null,
            parent_id: parentId,
            child_id: childId,
            amount: session.amount_total ?? 25000,
            currency: session.currency ?? "cad",
            status: "paid",
          },
          { onConflict: "stripe_session_id" }
        );
      if (error) {
        console.error("[webhook] deposit insert failed:", error.message);
        // 500 → Stripe retries; the upsert makes retries idempotent.
        return NextResponse.json({ error: "DB write failed" }, { status: 500 });
      }
    }
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntent =
      typeof charge.payment_intent === "string" ? charge.payment_intent : null;
    if (paymentIntent) {
      await supabaseAdmin()
        .from("deposits")
        .update({ status: "refunded", refunded_at: new Date().toISOString() })
        .eq("stripe_payment_intent", paymentIntent);
    }
  }

  return NextResponse.json({ received: true });
}
