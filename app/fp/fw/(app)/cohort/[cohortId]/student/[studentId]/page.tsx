import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
// Side-effect: registers every generated program module so getProgram resolves
// this student's PINNED version in THIS module graph.
import "@/app/lib/fp/content/registry";
import { getProgram } from "@/app/lib/fp/content/manifest";
import { resolveVariant } from "@/app/lib/fp/content/parse-curriculum";
import FwStudentView from "@/app/fp/fw/components/FwStudentView";
import type { FwTaskDetail } from "@/app/fp/fw/components/FwTaskDetailModal";
import { resolveFwActorForCohort } from "@/app/lib/fp/fw-auth";
import { loadFwCohortRoster, loadFwStudentDrilldown } from "@/app/lib/fp/fw-loader";
import {
  buildFwTaskTree,
  fwSelectedPhaseKey,
  summarizeFwResume,
  FW_BRAND_SUFFIX,
} from "@/app/lib/fp/fw-nav-rules";

/**
 * /fp/fw/cohort/[cohortId]/student/[studentId] — the student view (FW Unit 4,
 * rebuilt by ops-guide redesign Unit 8; R19, R20-structure, R21, R23).
 *
 * TWO gates, both necessary and neither redundant. `resolveFwActorForCohort`
 * answers "may this caller act in this weekend"; `loadFwStudentDrilldown`
 * answers "is this child in it". Only the second stops a URL edit from rendering
 * a Hamptons child's name, band, and complete progress to a Boston guide.
 *
 * EVERYTHING RENDERS FROM THE STATIC CONTENT BUNDLE, resolved against the
 * student's pinned program version (D27) — the tree, AND (new in Unit 8) every
 * task's full detail (body, done-when, band variant, all-bands note), which
 * ships in this page's payload so the (i) modal opens with no fetch. That is
 * what keeps the whole surface usable under the outage, and what made the
 * per-task page (now a redirect) removable at all.
 *
 * THE ROSTER rides alongside the drilldown for the sidebar (Unit 7's two-pane
 * frame, extended here) — one concurrent Promise.all, no extra waterfall. A
 * roster read failure degrades to the cached-name sidebar fallback, never a
 * fake empty roster and never a dead page: the drilldown is this page's spine,
 * the sidebar a navigation aid layered on it.
 *
 * `?phase=` selects the phase (R19) — resolved server-side by
 * `fwSelectedPhaseKey` so a stale, absent, or fabricated value degrades to the
 * first phase; the client keeps it current via history.replaceState (see
 * FwStudentView's docblock for why that, and not navigation).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Student · Founders Weekend${FW_BRAND_SUFFIX}`,
  robots: { index: false, follow: false },
};

export default async function FwStudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string; studentId: string }>;
  searchParams: Promise<{ phase?: string | string[] }>;
}) {
  const [{ cohortId, studentId }, sp] = await Promise.all([params, searchParams]);
  const { verdict, session } = await resolveFwActorForCohort(cohortId);
  if (!verdict.ok) notFound();

  const db = supabaseAdmin();
  // CONCURRENT: the roster needs only `cohortId`, known before the drilldown
  // starts — awaiting them in sequence would stack an avoidable waterfall onto
  // the guide's main loop (the same performance-review finding the retired task
  // page carried). A roster failure costs the sidebar, not the student.
  const [loaded, roster] = await Promise.all([
    loadFwStudentDrilldown(db, { cohortId, studentId }),
    loadFwCohortRoster(db, cohortId),
  ]);
  // `not_found` covers both "no such student" and "not in this cohort" — the
  // loader collapses them so a guide cannot enumerate which ids are real.
  if (!loaded.ok && loaded.reason === "not_found") notFound();

  if (!loaded.ok) {
    return (
      <main className="mx-auto w-full max-w-2xl px-5 py-6">
        <p
          role="alert"
          className="rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
        >
          We couldn&apos;t load this student just now. Reload the page — if it keeps happening,
          tell The 120 staff.
        </p>
      </main>
    );
  }

  const { student, programVersionId, states } = loaded.value;
  // Throws on an unknown version rather than falling back to "latest" — a silent
  // fallback would render a different curriculum than the one this child's
  // record is pinned to.
  const program = getProgram(programVersionId);
  const phases = buildFwTaskTree({ program, states });
  const resume = summarizeFwResume(
    Object.entries(states).map(([taskId, state]) => ({ taskId, state }))
  );

  // The detail the retired task page used to render, for EVERY task, resolved
  // against this student's band — built here, once, from the bundle already in
  // memory. ~125 entries of static curriculum text: the deliberate Unit 8 trade
  // (page weight for offline-complete detail).
  const details: Record<string, FwTaskDetail> = {};
  for (const phase of program.phases) {
    for (const criterion of phase.criteria) {
      for (const task of criterion.tasks) {
        details[task.id] = {
          body: task.body,
          doneWhen: task.doneWhen,
          variant: resolveVariant(task, student.band) ?? null,
          allBandsNote: task.allBandsNote ?? null,
        };
      }
    }
  }

  const phaseParam = typeof sp.phase === "string" ? sp.phase : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-6">
      <FwStudentView
        cohortId={cohortId}
        student={student}
        // The AUTHORITATIVE session id (the gate above already passed) — what an
        // offline capture stamps as its actor, and what scopes the pending read.
        actorUserId={session.userId}
        roster={roster.ok ? roster.students : null}
        phases={phases}
        details={details}
        initialPhaseKey={fwSelectedPhaseKey(phases, phaseParam)}
        resume={resume}
      />
    </main>
  );
}
