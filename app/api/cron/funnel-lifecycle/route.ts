import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { notifyOps } from "@/app/lib/ops-alert";
import {
  sweepOverdueForwarding,
  sweepStaleProvisioningClaims,
  sweepSuspendPendingClaims,
} from "@/app/lib/funnel/provision-deps";
import { capacityAlarm } from "@/app/lib/funnel/deposit-rules";
import { SEATS_TOTAL } from "@/app/lib/site";
import { FOUNDING_COMMITMENTS } from "@/app/lib/seats";

/**
 * The provisioning lifecycle cron (funnel wrap U8) — HOURLY, because the
 * suspend sweep's latency IS the exposure window: a refund flips the
 * claim to suspend_pending atomically, but the Workspace suspend runs
 * out-of-band here, and the adversarial review priced the original
 * weekly-only wiring at up to seven days of live mailbox after a family
 * left. Hourly bounds it at one hour; the weekly retention run repeats
 * the same sweeps as a belt-and-braces pass (all idempotent).
 *
 * GET, like every sibling cron (a POST export 405s forever). Each sweep
 * is independently try/caught: one failure never starves the others.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — lifecycle cron disabled" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sweeps: Record<string, unknown> = {};
  try {
    sweeps.suspend = await sweepSuspendPendingClaims();
  } catch (err) {
    console.error("[funnel/lifecycle] suspend sweep threw:", err);
    sweeps.suspend = "skipped";
  }
  try {
    sweeps.staleClaims = await sweepStaleProvisioningClaims();
  } catch (err) {
    console.error("[funnel/lifecycle] stale-claim sweep threw:", err);
    sweeps.staleClaims = "skipped";
  }
  try {
    sweeps.forwarding = await sweepOverdueForwarding();
  } catch (err) {
    console.error("[funnel/lifecycle] forwarding sweep threw:", err);
    sweeps.forwarding = "skipped";
  }
  try {
    // The U2 carry: standing capacity reconciliation, independent of any
    // single webhook invocation (a lost inline page can never re-alert —
    // the retry is a replay_noop). While over capacity this pages every
    // run it fires on — deliberate, the DOUBLE-PAID precedent.
    const { data } = await supabaseAdmin().rpc("seats_claimed");
    const claimed = typeof data === "number" ? data : null;
    if (capacityAlarm(claimed, SEATS_TOTAL, FOUNDING_COMMITMENTS)) {
      const sellable = Math.max(0, SEATS_TOTAL - FOUNDING_COMMITMENTS);
      await notifyOps(
        "Capacity reconciliation — seats over-allocated",
        `seats_claimed=${claimed} of ${sellable} sellable.\n` +
          `Standing check (U8). Review the offer queue and waitlist before offering again.`
      );
      sweeps.capacity = "alerted";
    } else {
      sweeps.capacity = claimed === null ? "unreadable" : "below";
    }
  } catch (err) {
    console.error("[funnel/lifecycle] capacity reconciliation threw:", err);
    sweeps.capacity = "skipped";
  }

  return NextResponse.json({ ok: true, sweeps });
}
