/**
 * The Path progress engine — the atomic-transition CORE (T1 Unit 8), plain and
 * testable. This is the pure decision logic that sits between the Unit 7 state
 * machine and the `move_path_task` security-definer RPC: the hardcoded target
 * map the RPC's SQL CASE mirrors, the three-way interpretation of the RPC's
 * compare-and-swap echo, and the mapping of that echo to the client-facing
 * result (including the fail-closed row narrowing the loader leans on).
 *
 * PLAIN — no `server-only`, no `"use server"`, no next/supabase/react imports —
 * so it is importable under `tsx` and vitest (the repo has no DB in tests, so the
 * migration + RPC are verified against production manually; only this decision
 * logic is unit-testable). The `server-only` loader that calls the RPC lives in
 * `progress-loader.ts`; the `"use server"` action in `actions/transition.ts`.
 */

import type { Band } from "@/app/path/content/types";
import { TASK_STATES, type TaskState, type TransitionRefusal } from "./transition-table";

/**
 * The eight TASK-scope transitions the `move_path_task` RPC executes, as an
 * `as const` TUPLE so it is both the runtime allowlist AND a Zod-enumerable set
 * for the action's input schema. The criterion/phase return transitions (Unit
 * 7's `criterion_return`/`phase_return`) are the review-ceremony's job (Unit 12).
 */
export const TASK_TRANSITIONS = [
  "unlock",
  "open",
  "submit",
  "withdraw",
  "verify",
  "not_yet",
  "resume",
  "revoke",
] as const;

export type TaskTransition = (typeof TASK_TRANSITIONS)[number];

/**
 * The from-INDEPENDENT target state of each task-scope transition — the plan's
 * "hardcoded target". The RPC never accepts a caller-supplied target state: it
 * receives the transition NAME and maps it to this literal in its SQL `CASE`, so
 * a stale or tampered caller cannot smuggle a forged target in. This TS map is
 * the single source that SQL `CASE` mirrors — a test pins every entry against
 * the `to` of the matching Unit 7 table row AND against the SQL CASE arms parsed
 * from the migration, so the engine, this map, and the SQL can never drift.
 */
export const TASK_TRANSITION_TARGETS: Record<TaskTransition, TaskState> = {
  unlock: "available",
  open: "in_progress",
  submit: "submitted",
  withdraw: "in_progress",
  verify: "verified",
  not_yet: "not_yet",
  resume: "in_progress",
  revoke: "not_yet",
};

export function isTaskTransition(x: string): x is TaskTransition {
  return (TASK_TRANSITIONS as readonly string[]).includes(x);
}

export function transitionTarget(t: TaskTransition): TaskState {
  return TASK_TRANSITION_TARGETS[t];
}

/** The criterion id a task belongs to: the first two dotted segments of the task
 *  id ("1.2.4" → "1.2"). */
export function criterionIdOf(taskId: string): string {
  return taskId.split(".").slice(0, 2).join(".");
}

/* ----------------------------------------- fail-closed input narrowing */

/**
 * Narrow an untyped state string from a service-role DB row into the `TaskState`
 * union, FAIL CLOSED — the `parseRoleGrant` pattern: a value outside the union
 * (a renamed column, a CRM status, junk) returns `null` and is never coerced
 * into a trusted state. The loader treats a `null` narrowing as a corrupt row.
 */
export function narrowTaskState(x: unknown): TaskState | null {
  return typeof x === "string" && (TASK_STATES as readonly string[]).includes(x)
    ? (x as TaskState)
    : null;
}

/**
 * The band DERIVED from a child's grade (Unit 5: band is derived from
 * public.children.grade, never stored twice). 3–5 / 6–8 / 9–12 map to the three
 * book tracks; a grade outside that range — or a null grade — returns `null`.
 * Unit 15 owns the provisioning decision for a null band; this pure map refuses
 * to guess.
 */
export function bandForGrade(grade: number | null): Band | null {
  if (grade === null) return null;
  if (grade >= 3 && grade <= 5) return "g3_5";
  if (grade >= 6 && grade <= 8) return "g6_8";
  if (grade >= 9 && grade <= 12) return "g9_12";
  return null;
}

/**
 * The Supabase typed client models a one-to-one embed as an array even when the
 * FK is UNIQUE. Normalise either shape to the child's grade (or null). Pure, so
 * the array-vs-object branch is unit-tested rather than discovered in production.
 */
export function gradeFromChildJoin(childJoin: unknown): number | null {
  const child = Array.isArray(childJoin) ? childJoin[0] : childJoin;
  const grade = (child as { grade?: unknown } | null | undefined)?.grade;
  return typeof grade === "number" ? grade : null;
}

/* ------------------------------------------- snapshot building (fail-closed) */

/** The minimal task shape the snapshot builder reads from a DB progress row. */
export type ProgressRow = {
  task_id: string;
  state: unknown;
  review_opened_at?: string | null;
  verified_by?: string | null;
  snapshot_band?: Band | null;
};

/** A task's id + sequence from the pinned program content. */
export type CriterionTaskContent = { id: string; seq: number };

/** A materialised task snapshot for the Unit 7 engine (mirrors TaskSnapshot). */
export type BuiltTaskSnapshot = {
  id: string;
  seq: number;
  state: TaskState;
  reviewOpenedAt: string | null;
  verifiedBy: string | null;
  snapshotBand: Band | null;
};

/**
 * Build the engine's task snapshots from the pinned program's task list joined
 * with the student's progress rows. A task with no progress row yet reads as
 * `locked`; a row whose state fails to narrow THROWS (fail closed — never a
 * silent `locked` default for a corrupt value). Pure — the loader passes
 * already-fetched arrays, so this whole branch is unit-tested.
 */
export function buildTaskSnapshots(
  criterionTasks: readonly CriterionTaskContent[],
  rows: readonly ProgressRow[],
  label: string
): BuiltTaskSnapshot[] {
  const byId = new Map(rows.map((r) => [r.task_id, r]));
  return criterionTasks.map((t) => {
    const row = byId.get(t.id);
    const state = row ? narrowTaskState(row.state) : "locked";
    if (state === null) {
      throw new Error(`corrupt progress state for ${label}/${t.id}: ${String(row?.state)}`);
    }
    return {
      id: t.id,
      seq: t.seq,
      state,
      reviewOpenedAt: row?.review_opened_at ?? null,
      verifiedBy: row?.verified_by ?? null,
      snapshotBand: row?.snapshot_band ?? null,
    };
  });
}

/* --------------------------------------------------------- the CAS echo */

/**
 * The row the RPC echoes back after its compare-and-swap. `wrote` is whether
 * THIS call's CAS updated the row (rows-affected = 1); the rest is the current
 * DB row whether we won or lost. Guards coerce and the RPC never raises on a
 * lost CAS, so `{ error: null }` is not proof our write landed — the echo is.
 */
export type ProgressEcho = {
  wrote: boolean;
  state: TaskState;
  verifiedBy: string | null;
  decidedAt: string | null;
};

export type EchoOutcome =
  /** Our CAS won — the task is now at the target, by this caller. */
  | { kind: "applied"; state: TaskState }
  /** We did not write, but the DB reached OUR target first (a concurrent same
   *  transition, or an idempotent replay). The goal holds — but not by us. */
  | { kind: "superseded"; winner: ProgressEcho }
  /** We did not write and the DB is at neither our from nor our to — someone
   *  moved it elsewhere (e.g. the other parent said Not Yet while we verified). */
  | { kind: "diverged"; winner: ProgressEcho }
  /** We did not write and the row is still at our from-state — the write did not
   *  land. Usually transient; the echo is carried so a revoke that lost the §9.5
   *  identity CAS (a PERMANENT refusal that also leaves the row at `verified`)
   *  can be told apart from a genuine retry. */
  | { kind: "retryable"; echo: ProgressEcho };

/**
 * Interpret the RPC's CAS echo — the analogue of `effectiveReviewStatus` and the
 * stale-status-echo doc's matches/behind/ahead:
 *   wrote                     → applied
 *   !wrote, state === to      → superseded (DB reached our target — adopt it)
 *   !wrote, state === from    → retryable  (nothing moved; carry the echo)
 *   !wrote, state otherwise   → diverged   (moved elsewhere — adopt the DB value)
 */
export function interpretEcho(
  intended: { from: TaskState; to: TaskState },
  echo: ProgressEcho
): EchoOutcome {
  if (echo.wrote) return { kind: "applied", state: echo.state };
  if (echo.state === intended.to) return { kind: "superseded", winner: echo };
  if (echo.state === intended.from) return { kind: "retryable", echo };
  return { kind: "diverged", winner: echo };
}

/* ------------------------------------------------- the client-facing result */

export type TransitionWinner = {
  /** The winning task state. */
  state: TaskState;
  /** The verifier — meaningful ONLY when `state === "verified"`; null otherwise
   *  (verify is the only transition that records it, and revoke clears it). */
  verifiedBy: string | null;
  /** The decision time — meaningful ONLY for a decision state (verified/not_yet);
   *  null for a plain student-action state, whose row carries a stale decidedAt. */
  decidedAt: string | null;
};

/** The closed set of failure reasons `applyTransition` can return — engine
 *  refusals plus the action's own — so a UI consumer switches exhaustively. */
export type TransitionFailureReason =
  | TransitionRefusal
  | "invalid_input"
  | "unknown_transition"
  | "not_found"
  | "forbidden"
  | "unavailable"
  | "diverged"
  | "retry";

/**
 * The transition action's result. `ok: true` means the task IS at the intended
 * target; `byCaller` says whether THIS request's write achieved it — never
 * claimed true unless the CAS provably wrote (R6 misattribution guard). A
 * `winner` names who/when when the target was reached by someone else.
 */
export type TransitionResult =
  | { ok: true; state: TaskState; byCaller: boolean; winner?: TransitionWinner }
  | { ok: false; reason: TransitionFailureReason; winner?: TransitionWinner };

/** who/when only where the DB row's fields actually describe THIS state. */
function gateWinner(echo: ProgressEcho): TransitionWinner {
  const isDecision = echo.state === "verified" || echo.state === "not_yet";
  return {
    state: echo.state,
    verifiedBy: echo.state === "verified" ? echo.verifiedBy : null,
    decidedAt: isDecision ? echo.decidedAt : null,
  };
}

/**
 * Map an EchoOutcome to the client-facing TransitionResult. Pure and exported so
 * the action's contract is unit-tested rather than an untested `"use server"`
 * detail. `superseded`/`diverged` stay DISTINCT reasons (a concurrent same
 * transition vs. the task going elsewhere) so Unit 16 can render different copy.
 * A `retryable` revoke whose row is verified by someone OTHER than the actor is
 * a permanent §9.5 refusal, not a transient retry.
 */
export function resultForEcho(
  outcome: EchoOutcome,
  ctx: { transition: TaskTransition; actorId: string | null }
): TransitionResult {
  switch (outcome.kind) {
    case "applied":
      return { ok: true, state: outcome.state, byCaller: true };
    case "superseded":
      // Target reached, but not by us — ok (goal met) with byCaller:false.
      return { ok: true, state: outcome.winner.state, byCaller: false, winner: gateWinner(outcome.winner) };
    case "diverged":
      return { ok: false, reason: "diverged", winner: gateWinner(outcome.winner) };
    case "retryable":
      if (ctx.transition === "revoke" && outcome.echo.verifiedBy !== ctx.actorId) {
        // The verifier changed under us between snapshot and RPC — retrying will
        // fail forever; report the real §9.5 refusal instead of "retry".
        return { ok: false, reason: "not_original_verifier" };
      }
      return { ok: false, reason: "retry" };
  }
}

/* --------------------------------------- initial progress materialization */

/** The DB row shapes the builder consumes — `path_criteria` / `path_unit_tasks`
 *  (the same source the RPC's cascade reads, so the two can't disagree). */
export type SeedCriterionRow = { criterion_id: string; phase_num: string; seq: number };
export type SeedTaskRow = { task_id: string; criterion_id: string; seq: number };

export type InitialProgressRow = {
  student_id: string;
  program_version_id: string;
  criterion_id: string;
  task_id: string;
  state: "locked" | "available";
  snapshot_band: Band | null;
};

/**
 * Build the initial `path_task_progress` rows for a freshly provisioned (or
 * backfilled) student: one row per task in the pinned version, the FIRST task
 * of each FIRST-PHASE criterion `available` with the band snapshotted (the
 * first-`available` rule — criteria run in parallel within a phase), everything
 * else `locked` with no band.
 *
 * The RPC only UPDATEs — "empty echo = the progress row does not exist (a
 * provisioning gap)" — so these rows are the precondition for every transition
 * a student will ever make. Pure; the I/O executor lives in provision-core.
 *
 * Throws (fail loud, never a partial record):
 *   - null band — an unlock must never snapshot nothing (Unit 8 carry-forward:
 *     the caller refuses provisioning for a grade-less child, or documents a
 *     default; this builder never invents one);
 *   - empty tasks — zero rows is a data bug reported as success otherwise;
 *   - a task whose criterion is missing — a silent lock would strand the task.
 */
export function buildInitialProgressRows(input: {
  studentId: string;
  programVersionId: string;
  band: Band | null;
  /** `path_phases.num` of the version's first phase (seq 1) — e.g. "01". */
  firstPhaseNum: string;
  criteria: readonly SeedCriterionRow[];
  tasks: readonly SeedTaskRow[];
}): InitialProgressRow[] {
  if (!input.band) {
    throw new Error(
      `buildInitialProgressRows: student ${input.studentId} has no band — refuse the unlock rather than snapshot nothing`
    );
  }
  if (input.tasks.length === 0) {
    throw new Error(
      `buildInitialProgressRows: zero tasks for version ${input.programVersionId} — the content seed has not run`
    );
  }

  const byId = new Map(input.criteria.map((c) => [c.criterion_id, c]));
  return input.tasks.map((t) => {
    const criterion = byId.get(t.criterion_id);
    if (!criterion) {
      throw new Error(
        `buildInitialProgressRows: task ${t.task_id} references criterion ${t.criterion_id}, absent from path_criteria`
      );
    }
    const available = criterion.phase_num === input.firstPhaseNum && t.seq === 1;
    return {
      student_id: input.studentId,
      program_version_id: input.programVersionId,
      criterion_id: t.criterion_id,
      task_id: t.task_id,
      state: available ? "available" : "locked",
      snapshot_band: available ? input.band : null,
    };
  });
}
