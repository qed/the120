import "server-only";

/**
 * The server-only I/O layer for the Unit 8 transition action: it builds the
 * engine's snapshot from the pinned program joined with the student's DB rows,
 * and calls the `move_path_task` RPC. Kept OUT of the `"use server"` action file
 * so these functions are not themselves client-callable Server Actions; the pure
 * decision logic they lean on lives in `progress-core.ts` (tested).
 *
 * FAIL LOUD, NEVER SILENT: every query checks its `error`. A read failure THROWS
 * a labeled error (the action catches it and returns a typed `unavailable`),
 * rather than defaulting an unread task to `locked` or an unread review to
 * `active` — a swallowed blip must never masquerade as a business-rule refusal.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { getProgram } from "@/app/path/content/manifest";
import type { Band } from "@/app/path/content/types";
import {
  bandForGrade,
  buildTaskSnapshots,
  criterionIdOf,
  gradeFromChildJoin,
  narrowTaskState,
  type ProgressEcho,
  type ProgressRow,
  type TaskTransition,
} from "./progress-core";
import type { CriterionSnapshot, TaskState } from "./transition-table";

type Db = ReturnType<typeof supabaseAdmin>;

/** The authoritative student context — profile ids for authorization + the
 *  derived band. Ids come from the DB row, never a client field. */
export type StudentContext = {
  studentId: string;
  programVersionId: string;
  familyId: string;
  cohortId: string | null;
  band: Band | null;
};

/** Load the authoritative profile (and derive the band from the child's grade).
 *  Returns null only when the student genuinely does not exist; a query error
 *  THROWS so the caller does not mistake an outage for "not found". */
export async function loadStudentContext(db: Db, studentId: string): Promise<StudentContext | null> {
  const { data, error } = await db
    .from("path_student_profiles")
    .select("id, program_version_id, family_id, cohort_id, children(grade)")
    .eq("id", studentId)
    .maybeSingle();
  if (error) {
    throw new Error(`loadStudentContext(${studentId}) failed: ${error.message}`);
  }
  if (!data) return null;

  return {
    studentId: data.id as string,
    programVersionId: data.program_version_id as string,
    familyId: data.family_id as string,
    cohortId: (data.cohort_id as string | null) ?? null,
    band: bandForGrade(gradeFromChildJoin(data.children)),
  };
}

/**
 * Build the CriterionSnapshot the engine reads: the pinned program's task list
 * (ids + seq, D27) joined with the student's progress rows. A task with no
 * progress row yet reads as `locked`; a corrupt state throws (fail closed, via
 * `buildTaskSnapshots`). A query error throws too.
 *
 * `criterion.state` is a fixed `active`: a TASK transition's ok/refuse verdict
 * does not read it (it reads task + sibling states), and the RPC — not this
 * snapshot — is authoritative for the persisted criterion aggregate, so deriving
 * the true state here would be a wasted round-trip.
 */
export async function loadCriterionSnapshot(
  db: Db,
  ctx: StudentContext,
  criterionId: string
): Promise<CriterionSnapshot> {
  const program = getProgram(ctx.programVersionId); // pinned version (throws on unknown)
  const criterion = program.phases
    .flatMap((p) => p.criteria)
    .find((c) => c.id === criterionId);
  if (!criterion) {
    throw new Error(`criterion "${criterionId}" not in version "${ctx.programVersionId}"`);
  }

  const { data: rows, error } = await db
    .from("path_task_progress")
    .select("task_id, state, review_opened_at, verified_by, snapshot_band")
    .eq("student_id", ctx.studentId)
    .eq("criterion_id", criterionId);
  if (error) {
    throw new Error(`loadCriterionSnapshot(${ctx.studentId}, ${criterionId}) failed: ${error.message}`);
  }

  const tasks = buildTaskSnapshots(
    criterion.tasks.map((t) => ({ id: t.id, seq: t.seq })),
    (rows ?? []) as ProgressRow[],
    ctx.studentId
  );

  return { id: criterionId, state: "active", tasks };
}

/** Call the atomic `move_path_task` RPC and narrow its echo. Returns null on a
 *  query error / missing row (logged, so an outage is observable and separable
 *  from ordinary lost-CAS traffic); the caller re-reads once before failing. */
export async function moveTask(
  db: Db,
  p: {
    studentId: string;
    taskId: string;
    transition: TaskTransition;
    expectedFrom: TaskState;
    actor: string | null;
    actorRole: "student" | "adult";
    band: Band | null;
    /** Client-supplied, skew-clamped submit time (Unit 11); null server-side. */
    submittedAt: string | null;
    note: string | null;
  }
): Promise<ProgressEcho | null> {
  const { data, error } = await db.rpc("move_path_task", {
    p_student_id: p.studentId,
    p_task_id: p.taskId,
    p_transition: p.transition,
    p_expected_from: p.expectedFrom,
    p_actor: p.actor,
    p_actor_role: p.actorRole,
    p_band: p.band,
    p_submitted_at: p.submittedAt,
    p_note: p.note,
  });
  if (error) {
    console.error(`[path/progress] move_path_task(${p.studentId}, ${p.taskId}, ${p.transition}) failed: ${error.message}`);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  const state = narrowTaskState(row.state);
  if (state === null) {
    console.error(`[path/progress] move_path_task echoed an unrecognized state: ${String(row.state)}`);
    return null;
  }
  return {
    // Narrowed, not Boolean()-coerced: `wrote` decides win-vs-loss, so a shape
    // drift must read as "did not write", never a truthy surprise.
    wrote: row.wrote === true,
    state,
    verifiedBy: (row.verified_by as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
  };
}

export { criterionIdOf };
