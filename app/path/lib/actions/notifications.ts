"use server";

/**
 * The seen-cursor action (T1 Unit 16). `seen_at` on `path_notification_events`
 * is the celebration-replay cursor: unseen events fire in order on next open,
 * and stamping is what retires them — the one case Tier 1 deliberately
 * replays is an UNSTAMPED event, never a stamped one.
 *
 * Only the student themself stamps (the moment is THEIRS — a parent browsing
 * a shared device must not silently consume a child's celebration). The
 * student id comes from the caller's own self-grant, never a client field;
 * the UPDATE is additionally fenced `student_id = self AND seen_at IS NULL`,
 * so a replayed/forged id list can neither cross students nor un-stamp
 * history (one-way, like every Path flag).
 *
 * Canon: gate → zod → authorize → effect → typed result. FUNCTIONS-ONLY
 * exports (the use-server-type-reexport learning).
 */

import { z } from "zod";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { requirePathUser } from "@/app/path/lib/auth";

/** Generous ceiling — a full replay stamps a handful of ids; a client sending
 *  hundreds is malformed, not ambitious. */
const MAX_IDS_PER_CALL = 100;

const markSeenSchema = z.object({
  eventIds: z.array(z.string().uuid()).min(1).max(MAX_IDS_PER_CALL),
});

export type MarkSeenResult =
  | { ok: true; stamped: number }
  | { ok: false; reason: "invalid_input" | "forbidden" | "unavailable" };

export async function markNotificationEventsSeen(input: unknown): Promise<MarkSeenResult> {
  const { grants } = await requirePathUser();
  const parsed = markSeenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };

  const selfGrant = grants.find((g) => g.role === "student" && g.scopeType === "student");
  if (!selfGrant) return { ok: false, reason: "forbidden" };

  const { data, error } = await supabaseAdmin()
    .from("path_notification_events")
    .update({ seen_at: new Date().toISOString() })
    .eq("student_id", selfGrant.scopeId)
    .is("seen_at", null)
    .in("id", parsed.data.eventIds)
    .select("id");
  if (error) {
    console.error(`[path/notifications] seen stamp failed for student ${selfGrant.scopeId}:`, error.message);
    return { ok: false, reason: "unavailable" };
  }
  // Zero rows is FINE here — a concurrent tab already stamped them; the
  // cursor is one-way and idempotent, so "already seen" is success.
  return { ok: true, stamped: data?.length ?? 0 };
}
