"use server";

/**
 * Capture's Server Action — a thin wrapper, nothing else. All sequencing and
 * every decision live in `app/lib/funnel/capture-core.ts` (server-only,
 * deps-injectable, tested by execution). This wrapper exists because a client
 * form can only invoke a `"use server"` function, and because the core's
 * `deps` parameter must never reach the wire: a Server Action's arguments
 * arrive from the client, so the input-only signature here is what keeps the
 * injection seam server-side.
 */

import { captureCore, type CaptureResult } from "@/app/lib/funnel/capture-core";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
import { readCtaSource } from "@/app/lib/cta-source";

export async function captureAction(input: unknown): Promise<CaptureResult> {
  const result = await captureCore(input);
  if (result.kind === "captured") {
    // R56/R58: C1 — the event's entry_source goes through the SAME
    // readCtaSource the core just used to stamp the family, so the event
    // stream and the families table cannot diverge (the review: the raw
    // input made phantom buckets the C2s would never land in). familyId
    // resolves inside the emitter's enrichment from the stamped row.
    const source =
      typeof (input as { source?: unknown })?.source === "string"
        ? readCtaSource({ src: (input as { source: string }).source })
        : null;
    void emitFunnelEvent("c1_captured", { parentId: result.userId, entrySource: source });
  }
  return result;
}
