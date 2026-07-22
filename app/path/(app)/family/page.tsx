import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  loadFounderCards,
  loadLinkableFounders,
  loadPendingInvites,
  resolveParentFamily,
} from "@/app/path/lib/family-loader";
import { FamilyDashboard } from "@/app/path/components/family/FamilyDashboard";

/**
 * /path/family — the parent family dashboard (T1 Unit 15; handoff surface 13).
 * Every child's position at a glance: n/125, phase + criterion, the
 * five-segment criteria bar, the honest awaiting-review count — plus reset
 * password (R32's first UI), the co-parent invite (R4), and a truthful
 * settings strip. The handoff's weekly digest and per-card "Open" button
 * route into the review queue and land with Unit 12.
 *
 * Auth runs FIRST in the body (never only in the layout), before any other
 * await. A student hitting this URL goes to their journey; any other
 * non-parent session is a 404 (requirePathUser already 404'd grant-less ones).
 */

export const metadata: Metadata = {
  title: "Family — The Path",
  robots: { index: false, follow: false },
};

export default async function PathFamilyPage() {
  const { userId, grants } = await requirePathUser();

  const db = supabaseAdmin();
  const family = await resolveParentFamily(db, { userId, grants });
  if (!family) {
    const isStudent = grants.some((g) => g.role === "student");
    if (isStudent) redirect("/path");
    notFound();
  }

  const [cards, founders, invites] = await Promise.all([
    loadFounderCards(db, family.familyId),
    loadLinkableFounders(db, family),
    loadPendingInvites(db, family.familyId, Date.now()),
  ]);

  return (
    <FamilyDashboard
      familyLabel={family.familyLabel}
      familyId={family.familyId}
      cards={cards.map((c) => ({
        profileId: c.profileId,
        firstName: c.firstName,
        gradeLabel: c.gradeLabel,
        skinLabel: c.skinLabel,
        verifiedTotal: c.verifiedTotal,
        totalTasks: c.totalTasks,
        phase: c.phase,
        criterionLine: c.criterionLine,
        segments: c.segments,
        awaitingCount: c.awaitingCount,
        stranded: c.stranded,
        firstRun: c.firstRun,
      }))}
      parentCount={family.parentCount}
      invites={invites.map((i) => ({
        id: i.id,
        email: i.email,
        expiresAt: i.expiresAt,
        expired: i.expired,
      }))}
      hasLinkable={founders.some((f) => f.kind === "linkable" || f.kind === "needs_grade")}
    />
  );
}
