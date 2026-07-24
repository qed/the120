import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { Icon } from "@/app/fp/components/system/Icon";
// Side-effect: registers every generated program module so getProgram resolves
// this student's PINNED version in THIS module graph.
import "@/app/fp/content/registry";
import { getProgram } from "@/app/fp/content/manifest";
import FwReadingRule from "@/app/fp/fw/components/FwReadingRule";
import FwTaskTree from "@/app/fp/fw/components/FwTaskTree";
import { resolveFwActorForCohort } from "@/app/fp/lib/fw-auth";
import { loadFwStudentDrilldown } from "@/app/fp/lib/fw-loader";
import { buildFwTaskTree, FW_BAND_LABEL, summarizeFwResume } from "@/app/fp/lib/fw-nav-rules";

/**
 * /fp/fw/cohort/[cohortId]/student/[studentId] — one student's whole catalog
 * (FW Unit 4; FW-R13, FW-R14, FW-D5).
 *
 * TWO gates, both necessary and neither redundant. `resolveFwActorForCohort`
 * answers "may this caller act in this weekend"; `loadFwStudentDrilldown`
 * answers "is this child in it". Only the second stops a URL edit from rendering
 * a Hamptons child's name, band, and complete progress to a Boston guide.
 *
 * The tree comes from the STATIC CONTENT BUNDLE, resolved against the student's
 * pinned program version (D27) — never a "current" global, and never a DB
 * round-trip per task. That is what makes it renderable at all under Unit 8's
 * outage, and what makes a pinned student's catalog immune to a later
 * curriculum revision.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Student · Founders Weekend",
  robots: { index: false, follow: false },
};

export default async function FwStudentPage({
  params,
}: {
  params: Promise<{ cohortId: string; studentId: string }>;
}) {
  const { cohortId, studentId } = await params;
  const { verdict } = await resolveFwActorForCohort(cohortId);
  if (!verdict.ok) notFound();

  const loaded = await loadFwStudentDrilldown(supabaseAdmin(), { cohortId, studentId });
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

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-6">
      <Link
        href={`/fp/fw/cohort/${cohortId}`}
        className="inline-flex min-h-[44px] items-center gap-1.5 font-path-body text-sm text-hq-ink-soft hover:text-hq-ink"
      >
        <Icon name="chevron-left" size={16} />
        Roster
      </Link>

      <h1 className="mt-2 font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
        {student.firstName} {student.lastName}
      </h1>
      <p className="mt-1 font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
        {FW_BAND_LABEL[student.band]}
        {resume.furthestTaskId && ` · ${resume.verified} checked · up to ${resume.furthestTaskId}`}
      </p>

      <div className="mt-4">
        <FwReadingRule />
      </div>

      <div className="mt-4">
        <FwTaskTree
          phases={phases}
          taskHrefPrefix={`/fp/fw/cohort/${cohortId}/student/${studentId}/task`}
        />
      </div>
    </main>
  );
}
