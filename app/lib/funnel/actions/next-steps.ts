"use server";

/** Next Steps Server Action — thin wrapper (deps never reach the wire). */

import { saveGoalCore, type SaveGoalResult } from "@/app/lib/funnel/next-steps-core";

export async function saveGoalAction(input: unknown): Promise<SaveGoalResult> {
  return saveGoalCore(input);
}
