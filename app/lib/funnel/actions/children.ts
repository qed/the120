"use server";

/**
 * Add a Child's Server Actions — thin wrappers. Sequencing and every decision
 * live in `app/lib/funnel/children-core.ts` (server-only, deps-injectable);
 * these exist because a client form can only invoke a `"use server"` function,
 * and because the core's `deps` parameter must never reach the wire.
 */

import {
  addChildCore,
  listChildrenCore,
  type AddChildResult,
  type ListChildrenResult,
} from "@/app/lib/funnel/children-core";

export async function addChildAction(input: unknown): Promise<AddChildResult> {
  return addChildCore(input);
}

export async function listChildrenAction(): Promise<ListChildrenResult> {
  return listChildrenCore();
}
