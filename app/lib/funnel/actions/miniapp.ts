"use server";

/**
 * The mini-app's Server Actions — thin wrappers over
 * `app/lib/funnel/miniapp-core.ts` (server-only, deps-injectable). The
 * wrapper exists so a client component can invoke it and so the core's
 * `deps` parameter never reaches the wire.
 */

import { confirmDoorCore, type ConfirmDoorResult } from "@/app/lib/funnel/miniapp-core";
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
