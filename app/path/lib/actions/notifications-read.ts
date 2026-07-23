"use server";

/**
 * Agent-native read wrapper for the notification feed (T1 Unit 16; the parity
 * convention review-read/journey-read/family-read established): anything the
 * student's notifications page can SEE, a typed programmatic caller can fetch
 * — same loader, same pure rules, same register resolution.
 *
 * FUNCTIONS-ONLY export list (the use-server-type-reexport learning): the
 * FeedItem type is imported from celebration-tier1-rules by consumers
 * directly.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { requirePathUser } from "@/app/path/lib/auth";
import type { FeedItem } from "@/app/path/lib/celebration-tier1-rules";
import { resolveStudentSelf } from "@/app/path/lib/journey-loader";
import { loadNotificationFeed } from "@/app/path/lib/notifications-loader";
import type { Skin } from "@/app/path/lib/skin-tokens";

/** The signed-in student's own feed, register-resolved for their current
 *  skin, or a typed refusal (parents/guides have no in-app feed — theirs is
 *  the email channel and the review queue). Reading NEVER stamps seen_at —
 *  an agent fetch must not consume a child's celebration replay. */
export async function getNotificationsFeed(): Promise<
  | { ok: true; skin: Skin; items: FeedItem[]; unseenCount: number }
  | { ok: false; reason: "not_a_student" | "unavailable" }
> {
  const { grants } = await requirePathUser();
  const db = supabaseAdmin();
  const self = await resolveStudentSelf(db, grants);
  if (!self) return { ok: false, reason: "not_a_student" };
  try {
    const feed = await loadNotificationFeed(db, self.ctx, self.skin);
    return { ok: true, skin: self.skin, items: feed.items, unseenCount: feed.unseenIds.length };
  } catch (e) {
    console.error(`[path/notifications-read] feed load failed for student ${self.ctx.studentId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
}
