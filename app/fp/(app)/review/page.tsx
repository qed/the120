import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePathUser } from "@/app/fp/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveParentFamily } from "@/app/fp/lib/family-loader";
import { loadReviewQueue } from "@/app/fp/lib/review-loader";
import { ReviewPanel } from "@/app/fp/components/ReviewPanel";

/**
 * /fp/review — the parent review queue (T1 Unit 12; the surface the
 * "submitted" email links to). Every submitted task across the family's
 * students, verified against the Done-when line; every criterion review
 * underway, returnable with a note (§9.3).
 *
 * Auth runs FIRST in the body (never only in the layout), before any other
 * await. A student hitting this URL goes to their journey; any other
 * non-parent session is a 404 (mirrors /fp/family).
 */

export const metadata: Metadata = {
  title: "Review queue — First Profit",
  robots: { index: false, follow: false },
};

export default async function PathReviewPage() {
  const { userId, grants } = await requirePathUser();

  const db = supabaseAdmin();
  const family = await resolveParentFamily({ userId, grants });
  if (!family) {
    const isStudent = grants.some((g) => g.role === "student");
    if (isStudent) redirect("/fp");
    notFound();
  }

  const queue = await loadReviewQueue(db, family, { userId, grants });

  return <ReviewPanel queue={queue} />;
}
