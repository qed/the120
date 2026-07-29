"use server";

/**
 * The mini-app's Server Actions — thin wrappers over
 * `app/lib/funnel/miniapp-core.ts` (server-only, deps-injectable). The
 * wrapper exists so a client component can invoke it and so the core's
 * `deps` parameter never reaches the wire.
 */

import {
  changeDoorCore,
  confirmDoorCore,
  type ChangeDoorResult,
  type ConfirmDoorResult,
} from "@/app/lib/funnel/miniapp-core";
import { emitFunnelEvent } from "@/app/lib/funnel/events";

export async function confirmDoorAction(input: unknown): Promise<ConfirmDoorResult> {
  const result = await confirmDoorCore(input);
  // R57: the switch rate per landing page is the ad-targeting health
  // metric, so the tuple comes from SERVER truth (the child's group before
  // the write), not the request body — a client-supplied tuple was
  // trivially poisonable and a RE-confirm inflated preselected (both
  // reviewers). A re-confirm of the same door emits nothing: one event per
  // real transition. `preselected` (did the confirmed door match the ad
  // hint?) is only meaningful on the FIRST confirm, and the hint is client
  // knowledge — accepted as a validated boolean there, ignored otherwise.
  if (result.kind === "confirmed" && result.previousSlug !== result.slug) {
    const i = input as { childId?: unknown; preselected?: unknown };
    void emitFunnelEvent(
      "door_confirmed",
      { childId: typeof i.childId === "string" ? i.childId : null, groupSlug: result.slug },
      {
        group: result.slug,
        first: result.previousSlug === null,
        preselected: result.previousSlug === null && i.preselected === true,
        ...(result.previousSlug ? { switched_from: result.previousSlug } : {}),
      }
    );
  }
  return result;
}

/**
 * Reconnect U8: the door CHANGE (post-confirm), atomic with project
 * retirement when one exists — thin wrapper over `changeDoorCore`. Emits
 * the same door_confirmed event as a switch through `confirmDoorAction`
 * would: server-truth tuple, one event per real transition (`unchanged`
 * emits nothing — the core already refuses to write a same-door change).
 */
export async function changeDoorAction(input: unknown): Promise<ChangeDoorResult> {
  const result = await changeDoorCore(input);
  if (result.kind === "changed" && result.previousSlug !== result.slug) {
    const i = input as { childId?: unknown; preselected?: unknown };
    void emitFunnelEvent(
      "door_confirmed",
      { childId: typeof i.childId === "string" ? i.childId : null, groupSlug: result.slug },
      {
        group: result.slug,
        first: result.previousSlug === null,
        preselected: result.previousSlug === null && i.preselected === true,
        ...(result.previousSlug ? { switched_from: result.previousSlug } : {}),
      }
    );
  }
  return result;
}
