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

export async function captureAction(input: unknown): Promise<CaptureResult> {
  return captureCore(input);
}
