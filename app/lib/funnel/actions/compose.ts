"use server";

/**
 * Composition Server Actions — thin wrappers over
 * `app/lib/funnel/compose-core.ts` (server-only, deps-injectable). The
 * wrappers exist so a client component can invoke them and so the core's
 * `deps` parameter never reaches the wire. Never called from the browser
 * directly means exactly this: the model call lives behind these (R39).
 */

import {
  composeProjectCore,
  recordProjectEditCore,
  regenerateProjectCore,
  type ComposeResult,
  type EditResult,
  type RegenerateResult,
} from "@/app/lib/funnel/compose-core";

export async function composeProjectAction(input: unknown): Promise<ComposeResult> {
  return composeProjectCore(input);
}

export async function regenerateProjectAction(input: unknown): Promise<RegenerateResult> {
  return regenerateProjectCore(input);
}

export async function recordProjectEditAction(input: unknown): Promise<EditResult> {
  return recordProjectEditCore(input);
}
