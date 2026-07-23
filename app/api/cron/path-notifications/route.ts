import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { MAX_SEND_ATTEMPTS, RECONCILE_WINDOW_MS } from "@/app/path/lib/notify/notify-rules";
import { drainPendingSends, reconcileNotifications } from "@/app/path/lib/notify/send";

/**
 * The Path notification cron (T1 Unit 12, Decision 8) — vercel.json schedules
 * this every 10 minutes (Vercel Pro; pinned by the notify-rules parity test).
 * Two passes, both idempotent:
 *
 *   1. RECONCILE — re-derive every notification the trailing window's
 *      path_task_events / path_reviews spines imply and insert whatever is
 *      missing (dedupe keys + ON CONFLICT DO NOTHING). This is the healer: a
 *      crash between a transition's RPC commit and its inline enqueue loses
 *      nothing. Also re-applies supersede flags and enqueues due stall nudges.
 *   2. DRAIN — claim-then-send every pending send row under the attempt
 *      ceiling, with a STABLE Resend Idempotency-Key per row (a retried
 *      lost-response send is a provider-side no-op within the 24h window).
 *
 * Delivery latency (the Decision 8 acceptance criterion): inline delivery is
 * immediate; a failed inline send delivers on the next run — ≤10 minutes per
 * retry, ≈50 minutes worst case under sustained transient failure
 * (MAX_SEND_ATTEMPTS = 5), after which the row parks and `parked` in this
 * response reports it loudly. Re-arm by resetting `attempts`.
 *
 * Auth shape copies the nurture cron: missing secret → 503 (loud "not
 * configured", never a silent no-op), wrong bearer → 401, hard per-run caps.
 */

// Never send more than this per run — runaway protection if a derivation bug
// ever floods the queue.
const MAX_SENDS_PER_RUN = 100;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — path notifications disabled" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  try {
    const reconciled = await reconcileNotifications(db, {
      nowMs: Date.now(),
      windowMs: RECONCILE_WINDOW_MS,
    });
    const drained = await drainPendingSends(db, { limit: MAX_SENDS_PER_RUN });

    // Parked rows (attempt ceiling reached, still unsent) are a loud signal —
    // they no longer retry and need a human (or an attempts reset).
    const { count: parked } = await db
      .from("path_notification_sends")
      .select("id", { count: "exact", head: true })
      .is("sent_at", null)
      .gte("attempts", MAX_SEND_ATTEMPTS);

    if ((parked ?? 0) > 0) {
      console.error(`[path/notify-cron] ${parked} send row(s) parked at the attempt ceiling`);
    }

    return NextResponse.json({ ok: true, reconciled, drained, parked: parked ?? 0 });
  } catch (e) {
    console.error("[path/notify-cron] run failed:", e);
    return NextResponse.json({ error: "Notification cron run failed" }, { status: 500 });
  }
}
