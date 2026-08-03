import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePathUser } from "@/app/fp/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  loadFounderCards,
  loadLinkableFounders,
  loadPendingInvites,
  resolveParentFamily,
} from "@/app/fp/lib/family-loader";
import { FamilyDashboard } from "@/app/fp/components/family/FamilyDashboard";
import { FamilySites, type FamilySiteRow } from "@/app/fp/components/family/FamilySites";
import { readSiteForParent } from "@/app/fp/lib/fp-site-parent-core";

/**
 * /fp/family — the parent family dashboard (T1 Unit 15; handoff surface 13).
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
  title: "Family — First Profit",
  robots: { index: false, follow: false },
};

export default async function PathFamilyPage() {
  const { userId, grants } = await requirePathUser();

  const db = supabaseAdmin();
  const family = await resolveParentFamily({ userId, grants });
  if (!family) {
    const isStudent = grants.some((g) => g.role === "student");
    if (isStudent) redirect("/fp");
    notFound();
  }

  const [cards, founders, invites] = await Promise.all([
    loadFounderCards(db, family.familyId),
    loadLinkableFounders(db, family),
    loadPendingInvites(db, family.familyId),
  ]);

  // Public-site rows (real-public-site Unit 2; R21/R22): one read per card via
  // the parent core. Its ownership check is children.parent_id — an invited
  // CO-PARENT (grants-based family membership, different parent_id) gets
  // `forbidden` and simply sees no row for that child; the signup parent is
  // the takedown holder in v1 (documented limitation, matches the action).
  const siteRows: FamilySiteRow[] = [];
  for (const card of cards) {
    const site = await readSiteForParent(db, { parentUserId: userId, childId: card.childId });
    if (site.ok && site.site) {
      siteRows.push({
        childId: card.childId,
        firstName: card.firstName,
        handle: site.site.handle,
        status: site.site.status,
        operatorLocked: site.site.operatorLocked,
      });
    }
  }

  // Loader output types ARE the component prop types (shared via
  // onboarding-rules) — pass through, no field-by-field re-mapping to drift.
  return (
    <>
      <FamilyDashboard
        familyLabel={family.familyLabel}
        familyId={family.familyId}
        cards={cards}
        parentCount={family.parentCount}
        invites={invites}
        hasLinkable={founders.some((f) => f.kind === "linkable" || f.kind === "needs_grade")}
      />
      <FamilySites sites={siteRows} />
    </>
  );
}
