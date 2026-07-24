import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePathUser } from "@/app/fp/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { loadLinkableFounders, resolveParentFamily } from "@/app/fp/lib/family-loader";
import { resolveOnboardingMode } from "@/app/fp/lib/onboarding-rules";
import { AddFounder } from "@/app/fp/components/AddFounder";

/**
 * /fp/onboarding — add a founder (T1 Unit 15; handoff scene 2). The
 * enrolled-family LINK path is primary (R31): the roster's children render as
 * linkable founders with DERIVED bands; the create form is the fallback when
 * nothing is linkable. The link-vs-create resolution and every founder's
 * link state are the pure, tested onboarding-rules.
 *
 * Auth runs FIRST in the body, before any other await; students bounce to
 * their journey, other non-parents 404.
 */

export const metadata: Metadata = {
  title: "Add a founder — First Profit",
  robots: { index: false, follow: false },
};

export default async function PathOnboardingPage() {
  const { userId, grants } = await requirePathUser();

  const db = supabaseAdmin();
  const family = await resolveParentFamily({ userId, grants });
  if (!family) {
    const isStudent = grants.some((g) => g.role === "student");
    if (isStudent) redirect("/fp");
    notFound();
  }

  const founders = await loadLinkableFounders(db, family);
  const provisionedCount = founders.filter((f) => f.kind === "provisioned").length;

  return (
    <AddFounder
      familyId={family.familyId}
      founders={founders}
      initialMode={resolveOnboardingMode(founders)}
      canCreate={family.callerHasCrmParentRow}
      showWelcome={provisionedCount === 0}
    />
  );
}
