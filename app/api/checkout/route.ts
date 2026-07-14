import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/app/lib/supabase/server";
import { RESERVE_GATE_MESSAGE, canReserveSeat, hasPaidDeposit } from "@/app/dashboard/data";

/**
 * S3: create a Stripe Checkout session for a child's $250 refundable seat deposit.
 * Auth: the parent's Supabase session cookie (browser) or a Bearer token (API).
 * RLS guarantees the child lookup only succeeds for the parent's own children.
 *
 * Approval gate (R11): checkout opens only at `offered` or later — the same
 * canReserveSeat predicate the dashboard CTA uses, enforced here so a direct
 * API call can't pay early. `children.status` is safe to gate on: only the
 * staff-side move_candidate RPC can advance it (parents are limited to
 * draft → submitted by the DB status guard).
 */
export async function POST(req: Request) {
  try {
    const { childId } = (await req.json()) as { childId?: string };
    if (!childId) return NextResponse.json({ error: "childId required" }, { status: 400 });

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
      .select("id, first_name, status")
      .eq("id", childId)
      .maybeSingle();
    if (!child) return NextResponse.json({ error: "Child not found" }, { status: 404 });
    if (child.status === "draft")
      return NextResponse.json(
        { error: "Submit the dossier before reserving a seat." },
        { status: 400 }
      );

    const { data: depositRows } = await supabase
      .from("deposits")
      .select("status")
      .eq("child_id", childId);
    const deposits = depositRows ?? [];
    if (!canReserveSeat(child.status, deposits)) {
      if (hasPaidDeposit(deposits))
        return NextResponse.json(
          { error: "A deposit is already paid for this child." },
          { status: 400 }
        );
      // Not yet approved — a distinct, non-retry message the client renders verbatim.
      return NextResponse.json({ error: RESERVE_GATE_MESSAGE }, { status: 400 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const origin = req.headers.get("origin") ?? "https://the120.school";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_DEPOSIT_PRICE_ID!, quantity: 1 }],
      customer_email: user.email,
      metadata: { child_id: childId, parent_id: user.id },
      payment_intent_data: {
        description: `The 120 — refundable seat deposit (${child.first_name || "child"})`,
        metadata: { child_id: childId, parent_id: user.id },
      },
      success_url: `${origin}/dashboard?deposit=success`,
      cancel_url: `${origin}/dashboard?deposit=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[checkout]", err);
    return NextResponse.json({ error: "Could not start checkout" }, { status: 500 });
  }
}
