import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requirePathUser } from "@/app/fp/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { TaskSurface } from "@/app/fp/components/task/TaskSurface";
import { loadTaskDetail, resolveStudentSelf } from "@/app/fp/lib/journey-loader";
import { pinCookieName, sanitizePinnedTaskId } from "@/app/fp/lib/now-card-rules";

/**
 * /fp/task/[taskId] — the capture and submit surface (T1 Unit 14). The first
 * point in the plan at which a student can reach a task, attach evidence, and
 * submit.
 *
 * A task the student cannot access resolves to notFound(), never a partial
 * render: a malformed id, an id outside the pinned program (D27), or a viewer
 * without access all end the same way. Auth runs first, before any other await.
 */

export const metadata: Metadata = {
  title: "First Profit",
  robots: { index: false, follow: false },
};

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { userId, grants } = await requirePathUser();

  const { taskId } = await params;
  if (!/^\d+\.\d+\.\d+$/.test(taskId)) notFound();

  const db = supabaseAdmin();
  const self = await resolveStudentSelf(db, grants);
  if (!self) redirect("/fp");

  const detail = await loadTaskDetail(db, self.ctx, taskId, { userId, grants });
  if (!detail) notFound();

  const cookieStore = await cookies();
  const pinnedTaskId = sanitizePinnedTaskId(cookieStore.get(pinCookieName(self.ctx.studentId))?.value);

  return (
    <TaskSurface
      skin={self.skin}
      studentId={self.ctx.studentId}
      taskId={detail.taskId}
      criterionId={detail.criterionId}
      phaseKey={detail.phaseKey}
      title={detail.title}
      body={detail.body}
      doneWhen={detail.doneWhen}
      variant={detail.variant}
      allBandsNote={detail.allBandsNote}
      seq={detail.seq}
      taskTotal={detail.taskTotal}
      state={detail.state}
      mutability={detail.mutability}
      band={detail.band}
      liveMoment={detail.liveMoment}
      safetyFlags={detail.safetyFlags}
      evidenceSpec={detail.evidenceSpec}
      hasLogTemplate={detail.logTemplate !== null}
      decision={detail.decision}
      evidence={detail.evidence}
      pinned={pinnedTaskId === detail.taskId}
    />
  );
}
