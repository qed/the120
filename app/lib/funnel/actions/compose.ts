"use server";

/**
 * Composition Server Actions — thin wrappers over
 * `app/lib/funnel/compose-core.ts` (server-only, deps-injectable). The
 * wrappers exist so a client component can invoke them and so the core's
 * `deps` parameter never reaches the wire. Never called from the browser
 * directly means exactly this: the model call lives behind these (R39).
 */

import { emitFunnelEvent } from "@/app/lib/funnel/events";
import {
  composeProjectCore,
  recordProjectEditCore,
  regenerateProjectCore,
  type ComposeResult,
  type EditResult,
  type RegenerateResult,
} from "@/app/lib/funnel/compose-core";

export async function composeProjectAction(input: unknown): Promise<ComposeResult> {
  const result = await composeProjectCore(input);
  if (result.kind === "composed") {
    const i = input as { childId?: unknown; templateId?: unknown };
    void emitFunnelEvent(
      "project_created",
      { childId: typeof i.childId === "string" ? i.childId : null },
      {
        template: typeof i.templateId === "string" ? i.templateId : "own-idea",
        degraded: result.degraded ?? "none",
      }
    );
  }
  return result;
}

export async function regenerateProjectAction(input: unknown): Promise<RegenerateResult> {
  const result = await regenerateProjectCore(input);
  if (result.kind === "regenerated") {
    void emitFunnelEvent(
      "project_regenerated",
      { childId: result.childId },
      {
        ...(typeof (input as { projectId?: unknown })?.projectId === "string"
          ? { project: (input as { projectId: string }).projectId }
          : {}),
        left: result.view.regenerationsLeft,
      }
    );
  }
  return result;
}

export async function recordProjectEditAction(input: unknown): Promise<EditResult> {
  return recordProjectEditCore(input);
}
