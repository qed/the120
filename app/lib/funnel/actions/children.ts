"use server";

/**
 * Add a Child's Server Actions — thin wrappers. Sequencing and every decision
 * live in `app/lib/funnel/children-core.ts` (server-only, deps-injectable);
 * these exist because a client form can only invoke a `"use server"` function,
 * and because the core's `deps` parameter must never reach the wire.
 */

import { emitFunnelEvent } from "@/app/lib/funnel/events";
import {
  addChildCore,
  listChildrenCore,
  type AddChildResult,
  type ListChildrenResult,
} from "@/app/lib/funnel/children-core";

export async function addChildAction(input: unknown): Promise<AddChildResult> {
  const result = await addChildCore(input);
  if (result.kind === "added") {
    void emitFunnelEvent("child_added", { childId: result.childId });
  }
  return result;
}

export async function listChildrenAction(): Promise<ListChildrenResult> {
  return listChildrenCore();
}
