import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { Icon } from "@/app/path/components/system/Icon";
import FwCohortMemory from "@/app/path/fw/components/FwCohortMemory";
import { signOutFwGuide } from "@/app/path/lib/actions/fw-guide";
import { isFwStaffActor } from "@/app/path/lib/fw-access-rules";
import { grantedCohortIds, resolveFwActorForCohort } from "@/app/path/lib/fw-auth";
import { listFwCohortsForActor } from "@/app/path/lib/fw-guide-core";

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
 * THE SWITCHER IS HIDDEN FOR SINGLE-COHORT SESSIONS (Decision 3). Switching is a
 * plain link back to `/path/fw`, which resets the drill-down by construction —
 * the roster, the tree, and the task view are all URL state under the cohort, so
 * there is no stale selection left to carry into the wrong weekend.
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
  });
  const cohorts = listed.ok ? listed.cohorts : [];
  const active = cohorts.find((c) => c.id === cohortId);
  // Only offer a switch when there is genuinely somewhere else to switch TO. A
  // read failure leaves `cohorts` empty and therefore hides the control, which
  // is the right way round: a guide who cannot be shown their other weekends
  // must not be shown a link that lands them on an error.
  const canSwitch = cohorts.length > 1;

  return (
    <>
      {active && <FwCohortMemory id={active.id} slug={active.slug} />}

      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-hq-border bg-hq-canvas/95 px-5 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
            {isStaff ? "Founders Weekend · Staff" : "Founders Weekend"}
          </p>
          <p className="truncate font-path-display text-base font-semibold text-hq-ink">
            {active?.slug ?? "This weekend"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {/* Staff only, and the visibility is purely a way IN — the ops pages
              and every ops action re-gate on `isFwStaffActor` server-side, so a
              guide who types the URL gets a 404 whether or not this renders. */}
          {isStaff && (
            <Link
              href={`/path/fw/ops/cohort/${cohortId}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 font-path-body text-sm text-hq-ink-soft hover:text-hq-ink"
            >
              <Icon name="shield-check" size={16} />
              Ops
            </Link>
          )}
          {canSwitch && (
            <Link
              href="/path/fw"
              className="inline-flex min-h-[44px] items-center gap-1.5 font-path-body text-sm text-hq-ink-soft hover:text-hq-ink"
            >
              <Icon name="refresh" size={16} />
              Switch
            </Link>
          )}
          <form action={signOutFwGuide}>
            <button
              type="submit"
              className="min-h-[44px] font-path-body text-sm text-hq-ink-soft underline underline-offset-2 hover:text-hq-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {children}
    </>
  );
}
