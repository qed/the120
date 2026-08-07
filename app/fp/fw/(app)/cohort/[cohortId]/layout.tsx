import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { Icon } from "@/app/fp/fw/components/system/Icon";
import FwCohortMemory from "@/app/fp/fw/components/FwCohortMemory";
import { isFwStaffActor } from "@/app/lib/fp/fw-access-rules";
import { grantedCohortIds, resolveFwActorForCohort } from "@/app/lib/fp/fw-auth";
import { listFwCohortsForActor } from "@/app/lib/fp/fw-guide-core";

/**
 * The per-cohort shell (FW Unit 4) — the chrome every guide surface sits inside,
 * and the one place that knows which weekend is active.
 *
 * WHY THE COHORT IS IN THE URL. Decision 3 says the cohort stamp is verified
 * client context: always carried, never inferred, never trusted. A cohort held
 * only in device storage would be inferred by every page and unverifiable by
 * any of them; carried in the path, it is re-resolved against authoritative rows
 * on every request by `resolveFwActorForCohort`, and a deep link is complete.
 *
 * AUTH POSTURE (Next 16, inherited from the Path's `(app)` layout): layouts do
 * NOT re-render on navigation, so this gate is the chrome's identity resolution
 * only. EVERY page below runs its own gate, and every action re-gates
 * server-side regardless. `resolveFwActorForCohort` is request-memoized, so the
 * page's own call costs nothing extra on the render that mounts this.
 *
 * THE WAY BACK TO THE PICKER IS THE WEEKEND NAME (redesign R25). Switching is a
 * plain link back to `/fp/fw`, which resets the drill-down by construction —
 * the roster, the tree, and the task view are all URL state under the cohort, so
 * there is no stale selection left to carry into the wrong weekend. The explicit
 * Switch control that used to sit beside Ops is retired (Unit 11): the weekend
 * NAME in the header carries that link now, and staff reach other weekends via
 * Staff Home.
 *
 * SIGN-OUT MOVED UP (Staff Front Door Unit 4, R16). `FwSignOutButton` rendered here
 * and is retired: R16 makes the drain gate a property of the DEVICE AND SESSION
 * rather than of a URL subtree, and two controls for one act is how the ops header's
 * ungated form went unnoticed. What this header keeps is the context only it can
 * resolve — which weekend is active, the way into ops, the way back to the picker.
 * The staff bar (`../../layout.tsx`) carries identity and sign-out above it.
 *
 * STICKY OFFSET: `--staff-bar-h`, published by the bar — see the ops layout for why
 * two headers at `top: 0` do not stack.
 */
export default async function FwCohortLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ cohortId: string }>;
}) {
  const { cohortId } = await params;
  const { verdict, session } = await resolveFwActorForCohort(cohortId);
  // `notFound()` for every refusal, never a message: distinguishing "that cohort
  // isn't yours" from "that cohort doesn't exist" would enumerate cohort ids to
  // a signed-in non-guide.
  if (!verdict.ok) notFound();

  const isStaff = isFwStaffActor(verdict);
  const listed = await listFwCohortsForActor(supabaseAdmin(), {
    grantedCohortIds: grantedCohortIds(session.grants),
    isStaff,
    // UNFILTERED, per the plan's settled decision: this list feeds the header's
    // weekend name, which must resolve for an archived cohort a staff member (or
    // a guide holding only an archived weekend) opens — a filtered list would
    // miss it and fall back to "This weekend", which is wrong-stamp risk.
    includeArchived: true,
  });
  const cohorts = listed.ok ? listed.cohorts : [];
  const active = cohorts.find((c) => c.id === cohortId);

  return (
    <>
      {active && <FwCohortMemory id={active.id} slug={active.slug} />}

      <header className="sticky top-[var(--staff-bar-h,0px)] z-10 flex items-center justify-between gap-3 border-b border-hq-border bg-hq-canvas/95 px-5 py-3 backdrop-blur">
        {/* The cohort name ONLY — no application label. The StaffBar above already
            names the application (its doc comment: "the bar never names a weekend,
            only the application"), so a repeated application line here was the same
            label twice on every cohort surface. Staff identity is the bar's job
            too, so the `· Staff` marker went with it. This header keeps the
            context only it can carry: which weekend is active.

            The name is a LINK to the picker (ops-guide redesign R25): the weekend
            name is the natural "which weekend am I in / take me to the others"
            affordance, and since Unit 11 retired the explicit Switch control it is
            the ONLY way back to the picker from here (staff use Staff Home).
            Quietly styled — same type as the old static name, no underline — and
            truncation stays on the link itself. */}
        <Link
          href="/fp/fw"
          className="min-w-0 truncate font-path-display text-base font-semibold text-hq-ink hover:text-hq-ink-soft"
        >
          {active?.slug ?? "This weekend"}
        </Link>

        <div className="flex shrink-0 items-center gap-4">
          {/* Staff only, and the visibility is purely a way IN — the ops pages
              and every ops action re-gate on `isFwStaffActor` server-side, so a
              guide who types the URL gets a 404 whether or not this renders. */}
          {isStaff && (
            <Link
              href={`/fp/fw/ops/cohort/${cohortId}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 font-path-body text-sm text-hq-ink-soft hover:text-hq-ink"
            >
              <Icon name="shield-check" size={16} />
              Ops
            </Link>
          )}
        </div>
      </header>

      {children}
    </>
  );
}
