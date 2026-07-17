import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { verifyCalcomSignature } from "@/app/lib/calcom/verify";
import { parseCalcomEvent } from "@/app/lib/calcom/events";
import { runCalcomWebhook } from "@/app/crm/lib/lead-ingest";

/**
 * Cal.com booking webhook (plan 2026-07-17-002, Unit 7 — R13-R16).
 *
 * Stamps/clears a family's `call_booked` from Cal.com bookings, idempotently
 * and out-of-order-tolerantly, and mints an implied-EBR `booking` lead for an
 * unmatched booker. Mirrors the Stripe webhook posture: read the RAW body,
 * verify the signature, THEN parse — never `req.json()` before verifying.
 *
 * Node runtime: HMAC verification uses `node:crypto`.
 *
 * The env secret is read as `CAL_WEBHOOK_SECRET`; configuring it (and
 * subscribing the webhook in Cal.com) is a human go-live step.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-cal-signature-256");
  const secret = process.env.CAL_WEBHOOK_SECRET;

  // Trust boundary: verify BEFORE parsing or any DB access. Fails closed on a
  // missing/wrong signature or an unconfigured secret. 401 → no CRM write.
  if (!verifyCalcomSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate + normalize before any DB write. Ping / unknown trigger → 200
  // ack-noop; a known trigger with an unusable payload → 400.
  const parsed = parseCalcomEvent(json);
  if (!parsed.ok) {
    return NextResponse.json(
      { received: true, ignored: parsed.reason },
      { status: parsed.status }
    );
  }

  try {
    const db = supabaseAdmin();
    const outcome = await runCalcomWebhook(db, parsed.event);
    return NextResponse.json({ received: true, outcome: outcome.status });
  } catch (err) {
    console.error("[calcom-webhook] processing failed:", err);
    // 500 → Cal.com retries; idempotency (dedupe + set-to-value) makes the
    // retry safe and non-duplicating.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
