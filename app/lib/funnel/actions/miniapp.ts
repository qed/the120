"use server";

/**
 * The mini-app's Server Actions — thin wrappers over
 * `app/lib/funnel/miniapp-core.ts` (server-only, deps-injectable). The
 * wrapper exists so a client component can invoke it and so the core's
 * `deps` parameter never reaches the wire.
 */

import { confirmDoorCore, type ConfirmDoorResult } from "@/app/lib/funnel/miniapp-core";

export async function confirmDoorAction(input: unknown): Promise<ConfirmDoorResult> {
  return confirmDoorCore(input);
}
