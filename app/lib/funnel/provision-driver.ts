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
    await driveForwarding(realForwardingDeps(), childId);
  }

  return outcome;
}
