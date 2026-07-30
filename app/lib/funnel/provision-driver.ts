import "server-only";

/**
 * The provisioning DRIVER (funnel wrap U7) — the composition root the
 * route layer calls. Cores never emit and never build their own deps;
 * this file does both, so the emit convention ("actions/routes, never
 * cores") holds while every driver (arrival route now, the cron sweep in
 * Unit 8) shares one wiring.
 *
 * `student_account_created` emits EXACTLY ONCE per child, structurally:
 * the fenced finishRun means exactly one run ever lands `complete` (the
 * outcome kind "complete" — a later drive of a complete claim returns
 * "noop_terminal" and cannot re-emit). AWAITED, inside the run that won
 * the landing — the serverless-freeze lesson, same as the webhook's c3.
 */

import { emitFunnelEvent } from "@/app/lib/funnel/events";
import { driveForwarding, type ProvisionOutcome } from "@/app/lib/funnel/provision-core";
import {
  driveProvisioningForChild,
  realForwardingDeps,
} from "@/app/lib/funnel/provision-deps";
import { supabaseAdmin } from "@/app/lib/supabase/admin";

/**
 * The sticky arrival fact (reconnect U11, R12): `children.arrived_at`, the
 * column the dashboard's register flip reads. A durable PRODUCT fact, not
 * telemetry — deliberately NOT routed through `emitFunnelEvent`'s
 * swallow-everything path. Set-once semantics live in the WHERE
 * (`arrived_at IS NULL` — the coalesce guard as a filter): the first stamp
 * wins, every later call writes zero rows, and nothing ever clears it.
 *
 * Service-role client: the parent has no session in this driver, and the
 * U7 projects-invalidation trigger does not apply to `children`. A failed
 * stamp logs loudly but must NOT fail provisioning — the arrival page must
 * still work; the register flip simply waits for a later drive of the
 * complete claim (this is called on the noop_terminal-complete path too,
 * exactly so a lost first stamp heals on the arrival page's next poll) or
 * for a manual backfill.
 */
async function stampArrivedAt(childId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from("children")
      .update({ arrived_at: new Date().toISOString() })
      .eq("id", childId)
      .is("arrived_at", null);
    if (error) {
      console.error(`[provision] arrived_at stamp FAILED for ${childId}: ${error.message}`);
    }
  } catch (e) {
    console.error(
      `[provision] arrived_at stamp FAILED for ${childId}:`,
      e instanceof Error ? e.message : e
    );
  }
}

export async function driveProvisioningWithEvent(
  childId: string,
  owner: string
): Promise<ProvisionOutcome> {
  const outcome = await driveProvisioningForChild(childId, owner);

  if (outcome.kind === "complete") {
    // The landing run — the only run that ever sees this kind for this
    // child. Awaited: the event is the acceptance-moment telemetry and
    // must not be eaten by a serverless freeze after the response.
    await emitFunnelEvent("student_account_created", { childId });
  }

  // Forwarding progresses whenever the mailbox is live: on the landing
  // run itself, and on every later visit while verification is pending
  // (its own CAS-arbitrated state machine — no lease involved).
  if (
    outcome.kind === "complete" ||
    (outcome.kind === "noop_terminal" && outcome.state === "complete")
  ) {
    // The arrival stamp rides BOTH branches: the landing run sets it, and
    // any later drive of the complete claim re-tries a stamp the landing
    // run lost (idempotent via the IS NULL guard).
    await stampArrivedAt(childId);
    await driveForwarding(realForwardingDeps(), childId);
  }

  return outcome;
}
