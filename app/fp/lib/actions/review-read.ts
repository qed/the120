"use server";

/**
 * Agent-native read wrapper for the review queue (T1 Unit 12; the parity
 * convention journey-read.ts and family-read.ts established): any queue a
 * parent can SEE, a typed programmatic caller can fetch — which is also the
 * only way such a caller can DISCOVER the (taskId, attempt, taskIds) inputs
 * `applyTransition`/`applyCriterionReturn` require.
 *
 * FUNCTIONS-ONLY export list (the use-server-type-reexport learning): the
 * ReviewQueue type is imported from review-loader by consumers directly.
 */

import { requirePathUser } from "@/app/fp/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveParentFamily } from "@/app/fp/lib/family-loader";
import { loadReviewQueue, type ReviewQueue } from "@/app/fp/lib/review-loader";

/** The signed-in parent's full review queue, or a typed refusal for a
 *  non-parent session (students/guides have no queue to read). */
export async function getReviewQueue(): Promise<
  { ok: true; queue: ReviewQueue } | { ok: false; reason: "not_a_parent" | "unavailable" }
> {
  const { userId, grants } = await requirePathUser();
  const family = await resolveParentFamily({ userId, grants });
  if (!family) return { ok: false, reason: "not_a_parent" };
  try {
    const queue = await loadReviewQueue(supabaseAdmin(), family, { userId, grants });
    return { ok: true, queue };
  } catch (e) {
    console.error(`[path/review-read] queue load failed for family ${family.familyId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
}
