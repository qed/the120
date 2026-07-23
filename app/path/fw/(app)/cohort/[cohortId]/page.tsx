import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFwStaffActor } from "@/app/path/lib/fw-access-rules";
import { resolveFwActorForCohort } from "@/app/path/lib/fw-auth";

/**
 * /path/fw/cohort/[cohortId] — the per-cohort gate (FW Unit 2, STUB).
 *
 * The one surface where `resolveFwActor` actually runs against a real cohort
 * row, which is what makes Unit 2's verification checkable: a granted guide
 * opens their own cohort and 404s on another; a staff session opens any
 * `kind='fw'` cohort with no grant; EVERY session 404s on a `kind='path'`
 * cohort, guide grant or not (a Path guide grant is D25 review authority, not
 * authority to drive the cascade-free FW write path).
 *
 * `notFound()` for every refusal, never a message: distinguishing "that cohort
 * isn't yours" from "that cohort doesn't exist" would enumerate cohort ids to a
 * signed-in non-guide. The `no_session` branch cannot be reached here (the
 * layout's `requireFwSession` redirected already) but is handled rather than
 * assumed — this file's gate must stand on its own if the layout ever changes,
 * since Next 16 layouts do not re-render on navigation.
 *
 * Unit 4 replaces the body with the roster and drill-down; the gate stays.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Founders Weekend",
  robots: { index: false, follow: false },
};

export default async function FwCohortPage({
  params,
}: {
  params: Promise<{ cohortId: string }>;
}) {
  const { cohortId } = await params;
  const { cohort, verdict } = await resolveFwActorForCohort(cohortId);
  if (!verdict.ok || !cohort) notFound();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10">
      {/* Via the shared predicate, not a hand-rolled `via === "bridge"`. The
          same commit that exports a helper to stop callers re-deriving a
          security-adjacent boolean should thread it through its own call sites,
          or the helper ships with its test as its only caller — the shape
          docs/solutions/security-issues/guard-function-with-no-callers-…md
          warns about (learnings + maintainability review). */}
      <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
        {isFwStaffActor(verdict) ? "Staff" : "Guide"}
      </p>
      <h1 className="mt-2 font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
        {cohort.id}
      </h1>
      <p className="mt-3 font-path-body text-sm leading-6 text-hq-ink-soft">
        Check-in lands here in Unit 4.
      </p>
    </main>
  );
}
