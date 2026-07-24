import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
// Side-effect: registers every generated program module so getProgram resolves
// this student's PINNED version in THIS module graph.
import "@/app/path/content/registry";
import { getProgram } from "@/app/path/content/manifest";
import { resolveVariant } from "@/app/path/content/parse-curriculum";
import FwTaskView from "@/app/path/fw/components/FwTaskView";
import { resolveFwActorForCohort } from "@/app/path/lib/fw-auth";
import { loadFwRosterNames, loadFwStudentDrilldown } from "@/app/path/lib/fw-loader";
import { resolveTaskInProgram } from "@/app/path/lib/now-card-rules";

/**
 * The task view's page (FW Unit 4; FW-R15, FW-D5).
 *
 * NO GATING ON THE TASK. Any of the 125 tasks is reachable for any student —
 * the only thing that can 404 here is a task id that does not exist in this
 * student's PINNED program version, which is a broken URL rather than a rule.
 *
 * The band-resolved line comes from `resolveVariant`, the same function the
 * Path's own task surface uses, against the band on the FW profile (the Path
 * derives its band from `children(grade)`; an FW student has no roster row, so
 * the profile's own column is authoritative — that asymmetry is FW-D8).
 *
 * The roster is loaded for the batch picker, which is why it is ROSTER-SCOPED by
 * construction: there is nobody in the picker who is not a member of this
 * cohort, so `planFwBatch`'s membership filter has nothing to catch from this
 * surface — it stays as the server-side backstop for a forged request.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Task · Founders Weekend",
  robots: { index: false, follow: false },
};

export default async function FwTaskPage({
  params,
}: {
  params: Promise<{ cohortId: string; studentId: string; taskId: string }>;
}) {
  const { cohortId, studentId, taskId } = await params;
  const { verdict } = await resolveFwActorForCohort(cohortId);
  if (!verdict.ok) notFound();

  const db = supabaseAdmin();
  // CONCURRENT: the roster needs only `cohortId`, which is known before the
  // drill-down starts, so awaiting the drill-down first stacked an avoidable
  // waterfall onto the most time-pressured screen in the product (performance
  // review). A roster read failure costs the batch picker, not the tap.
  const [loaded, roster] = await Promise.all([
    loadFwStudentDrilldown(db, { cohortId, studentId }),
    loadFwRosterNames(db, cohortId),
  ]);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  if (!loaded.ok) {
    return (
      <main className="mx-auto w-full max-w-2xl px-5 py-6">
        <p
          role="alert"
          className="rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
        >
          We couldn&apos;t load this task just now. Reload the page — if it keeps happening, tell
          The 120 staff.
        </p>
      </main>
    );
  }

  const { student, programVersionId, states } = loaded.value;
  const hit = resolveTaskInProgram(getProgram(programVersionId), taskId);
  if (!hit) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-6">
      <FwTaskView
        cohortId={cohortId}
        student={student}
        roster={roster.ok ? roster.students : []}
        taskId={taskId}
        taskTitle={hit.task.title}
        taskBody={hit.task.body}
        doneWhen={hit.task.doneWhen}
        variant={resolveVariant(hit.task, student.band) ?? null}
        allBandsNote={hit.task.allBandsNote ?? null}
        // Absent means `locked` — which is what an untouched FW row is. A row
        // that is genuinely missing still taps through to the RPC's truthful
        // `missing` outcome rather than being hidden behind a grey control.
        initialState={states[taskId] ?? "locked"}
        treeHref={`/path/fw/cohort/${cohortId}/student/${studentId}`}
        rosterHref={`/path/fw/cohort/${cohortId}`}
      />
    </main>
  );
}
