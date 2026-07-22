import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { CriterionDetail, type CriterionTaskItem } from "@/app/path/components/journey/CriterionDetail";
import { loadJourney, resolveStudentSelf } from "@/app/path/lib/journey-loader";
import { resolveCriterionNow, splitCriterionLabel } from "@/app/path/lib/now-card-rules";

/**
 * /path/criterion/[criterionId] — the landmark / criterion sheet (T1 Unit 14).
 * Resolves through the student's PINNED program only (D27): a criterion id not
 * in that program is notFound(), never a partial render. Auth first, before
 * any other await.
 */

export const metadata: Metadata = {
  title: "The Path",
  robots: { index: false, follow: false },
};

export default async function CriterionPage({ params }: { params: Promise<{ criterionId: string }> }) {
  const { grants } = await requirePathUser();

  const { criterionId } = await params;
  if (!/^\d+\.\d+$/.test(criterionId)) notFound();

  const db = supabaseAdmin();
  const self = await resolveStudentSelf(db, grants);
  if (!self) redirect("/path");

  const journey = await loadJourney(db, self.ctx, { pinnedTaskId: null });
  const jc = journey.criteria[criterionId];
  if (!jc) notFound();

  const phase = journey.program.phases.find((p) => p.criteria.some((c) => c.id === criterionId));
  const criterion = phase?.criteria.find((c) => c.id === criterionId);
  if (!phase || !criterion) notFound();

  const tasks: CriterionTaskItem[] = criterion.tasks.map((t) => ({
    id: t.id,
    seq: t.seq,
    title: t.title,
    body: t.body,
    doneWhen: t.doneWhen,
    state: jc.taskStates[t.id] ?? "locked",
  }));

  // The current step WITHIN this criterion — the pure, tested three-way rule
  // (journey Now here → wins; else this criterion's own selection; else null).
  const scoped = journey.candidates.filter((c) => c.criterionId === criterionId);
  const currentTaskId = resolveCriterionNow(
    journey.now.kind === "task" ? journey.now.taskId : null,
    scoped
  );

  const label = splitCriterionLabel(criterion.passCriterion);

  return (
    <CriterionDetail
      skin={self.skin}
      criterionId={criterionId}
      title={label.title}
      detail={label.detail}
      status={jc.view.status}
      phaseKey={phase.key}
      verifiedCount={jc.view.verifiedCount}
      taskTotal={jc.view.taskTotal}
      tasks={tasks}
      currentTaskId={currentTaskId}
    />
  );
}
