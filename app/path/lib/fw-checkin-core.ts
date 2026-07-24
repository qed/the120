/**
 * The FW check-in write path (FW Unit 3) — the db-taking half: the `fw_move_task`
 * caller, the cohort-membership read Decision 3 requires, and the batch
 * orchestration that turns one guide tap into N atomic writes and one truthful
 * report.
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the `db` argument cannot serialize) and no
 * `import "server-only"` (so Unit 7's importer and Unit 8's drain engine can
 * reuse it under `tsx`). Callers own their gate: `actions/fw-checkin.ts` gates
 * with `resolveFwActorForCohort`. See docs/solutions/best-practices/shared-db-
 * taking-core-must-not-live-in-a-use-server-file-… and …/use-server-type-
 * reexport-registers-server-reference-…
 *
 * ── Why this file exists rather than living inside the action
 *
 * Unit 2 shipped a P1 that neither of the two functions it was made of contained:
 * an idempotent primitive composed with an unconditional caller rotated a working
 * guide's live credential. Both halves were correct and individually well-tested;
 * nothing tested the composition, because the composition lived in a `"use
 * server"` file the repo cannot unit-test (docs/solutions/logic-errors/
 * idempotent-primitive-plus-unconditional-caller-rotated-a-live-credential-
 * reuse-the-existing-verdict-2026-07-23.md).
 *
 * This unit's composition is the same shape with a louder failure: an idempotent
 * primitive (`fw_move_task`, deliberately a no-op on an already-decided task) and
 * a downstream effect chained onto its success (the First Dollar bell, in a room
 * full of families). So the orchestration lives HERE, as a plain module, and
 * `__tests__/fw-checkin-core.test.ts` drives it through a fake Supabase client.
 * The action above is left with nothing but gate → parse → delegate.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clampFwCapturedAt,
  fwFirstDollarStudents,
  narrowFwOutcome,
  planFwBatch,
  resultForFwEcho,
  type FwAction,
  type FwEcho,
  type FwStudentResult,
} from "./fw-rules";
import { narrowTaskState } from "./progress-core";

/* ═══════════════════════════════════════════════════════════════ the RPC ══ */

export type FwMoveTaskParams = {
  studentId: string;
  taskId: string;
  action: FwAction;
  actor: string;
  cohortId: string;
  /** Already clamped by the caller; the RPC re-clamps as a boundary backstop. */
  capturedAt: string;
  /** Groups a batch: one guide tap on three students shares one id (FW-D16). */
  actionId: string;
  /** The exactly-once key for this (student, task, tap); null when online. */
  clientId: string | null;
};

/**
 * Call `fw_move_task` and narrow its echo FAIL-CLOSED.
 *
 * Returns null on any shape the caller cannot trust — an RPC error, an empty
 * result, an outcome outside the union. `resultForFwEcho` turns that into a
 * `failed` result rather than an optimistic success: an errored response is not
 * proof the write failed, but it is not proof it landed either, and FW's recovery
 * is the guide tapping again (idempotent by state, and by `client_id` when the
 * offline queue carried one).
 */
export async function fwMoveTask(
  db: SupabaseClient,
  p: FwMoveTaskParams
): Promise<FwEcho | null> {
  const { data, error } = await db.rpc("fw_move_task", {
    p_student_id: p.studentId,
    p_task_id: p.taskId,
    p_action: p.action,
    p_actor: p.actor,
    p_cohort_id: p.cohortId,
    p_captured_at: p.capturedAt,
    p_action_id: p.actionId,
    p_client_id: p.clientId,
  });

  if (error) {
    console.error(
      `[fw/checkin] fw_move_task(${p.studentId}, ${p.taskId}, ${p.action}) failed: ${error.message}`
    );
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    console.error(`[fw/checkin] fw_move_task(${p.studentId}, ${p.taskId}) returned no row`);
    return null;
  }

  const outcome = narrowFwOutcome(row.outcome);
  if (outcome === null) {
    // Never coerced: this value decides whether a bell rings in a room.
    console.error(`[fw/checkin] fw_move_task echoed an unrecognized outcome: ${String(row.outcome)}`);
    return null;
  }

  return {
    outcome,
    // `missing` legitimately has no state; every other outcome describes a real
    // locked row, and resultForFwEcho fails a null there closed.
    state: narrowTaskState(row.state),
    verifiedBy: typeof row.verified_by === "string" ? row.verified_by : null,
  };
}

/* ══════════════════════════════════════════ the cohort-membership read ══ */

/**
 * Which of these students are actually members of this cohort — the authoritative
 * half of Decision 3's `activeCohort ∈ (student's membership ∩ actor's scope)`.
 *
 * The actor half is already settled before this runs: `resolveFwActorForCohort`
 * refused the whole request if the caller cannot act in this cohort. What remains
 * is membership, and it is read from `path_cohort_members` rather than inferred,
 * because inference is ambiguous for a Hamptons returner who belongs to two.
 *
 * TRI-STATE ON PURPOSE. A read failure returns `ok:false`, never an empty set.
 * Collapsing the two would report every student as "not in this cohort" — a
 * confident, specific lie that sends guides hunting a roster problem that does
 * not exist, mid-event. This is the same distinction `listFwCohortsForActor`
 * draws for the same reason, and the opposite of the collapse used in
 * AUTHORIZATION reads (where "could not load" must fail closed to "no").
 */
export async function loadFwCohortMemberIds(
  db: SupabaseClient,
  cohortId: string,
  studentIds: readonly string[]
): Promise<{ ok: true; memberIds: string[] } | { ok: false }> {
  if (studentIds.length === 0) return { ok: true, memberIds: [] };

  const res = await db
    .from("path_cohort_members")
    .select("student_id")
    .eq("cohort_id", cohortId)
    .in("student_id", [...studentIds]);

  if (res.error) {
    console.error(`[fw/checkin] membership load failed for cohort ${cohortId}: ${res.error.message}`);
    return { ok: false };
  }

  return {
    ok: true,
    memberIds: (res.data ?? [])
      .map((r) => r.student_id)
      .filter((id): id is string => typeof id === "string"),
  };
}

/* ═══════════════════════════════════════════════════ the batch orchestration ══ */

export type RunFwCheckInInput = {
  actorUserId: string;
  cohortId: string;
  taskId: string;
  action: FwAction;
  /** The guide's selection, in picker order. Deduplicated downstream. */
  studentIds: readonly string[];
  /** Per-student exactly-once keys, minted at capture by the offline queue. */
  clientIds?: Readonly<Record<string, string>>;
  /** Client capture time; absent online, where receipt time IS capture time. */
  capturedAt?: string | null;
  /**
   * Supplied ONLY by a replay (Unit 8), so a batch captured offline still rings
   * ONE bell on drain instead of three. Every live tap mints its own.
   */
  actionId?: string;
  now: number;
};

/**
 * What the Server Action returns. Lives HERE, in the plain module, because
 * `actions/fw-checkin.ts` is a `"use server"` file and even a TYPE re-export from
 * one gets a `registerServerReference()` emitted for it — the module then throws
 * at load and takes every FW action down with it (docs/solutions/runtime-errors/
 * use-server-type-reexport-registers-server-reference-…-2026-07-22.md, found live
 * in the Path's Unit 14).
 *
 * The gate refusals are deliberately COARSER than the verdict they come from: a
 * caller learns "you may not do this here", never whether a cohort id exists or
 * what kind it is. Probing for live cohort ids should teach nothing.
 */
export type FwCheckInActionResult =
  | RunFwCheckInResult
  | { ok: false; reason: "invalid_input" | "no_session" | "forbidden" };

export type RunFwCheckInResult =
  | {
      ok: true;
      actionId: string;
      /** One entry per DEDUPLICATED student, in the guide's selection order. */
      outcomes: FwStudentResult[];
      /** Students who JUST crossed the first-dollar line — never the whole
       *  selection. Non-empty means: ring it, and name these children. */
      firstDollar: string[];
      /** Whether the client's capture time had to be clamped (an anomaly signal
       *  for the ops surface, never a reason to refuse the tap). */
      capturedAtClamped: boolean;
    }
  | { ok: false; reason: "unavailable" };

/**
 * Run one check-in action across one or more students.
 *
 * Sequence: verify membership → plan (pure) → N atomic RPC calls sharing one
 * `action_id` → interpret each echo → derive the celebration from the results.
 *
 * ── Three properties worth stating, each a bug this shape prevents
 *
 * 1. **A failed membership read refuses the whole action.** Writing with an
 *    unverified cohort stamp is not a degraded success; it is a permanent lie in
 *    an append-only log (a Hamptons tap counted in Boston's weekend numbers).
 *
 * 2. **One student's failure never aborts the others.** The guide tapped for all
 *    of them; each write is independently atomic, and a partial batch is a
 *    DESIGNED, REPORTED state — the plan tolerates partial `action_id` groups
 *    explicitly. Aborting midway would leave the same partial write with a less
 *    honest report.
 *
 * 3. **The celebration is derived from RESULTS, not from reaching the end.**
 *    `fwFirstDollarStudents` filters on `kind === "applied"`, so `already_done`
 *    and `replayed` — the two ways a checkmark succeeds without anything new
 *    happening — ring nothing. That is bell safety (Decision 2) and the stale-
 *    replay rule (Decision 5) falling out of one gate rather than two.
 */
export async function runFwCheckIn(
  db: SupabaseClient,
  input: RunFwCheckInInput
): Promise<RunFwCheckInResult> {
  // Deduplicate up front so the membership read, the write loop, and the result
  // list all agree on the same student set — and so the guide's selection order
  // survives into the report.
  const ordered = [...new Set(input.studentIds)];

  const membership = await loadFwCohortMemberIds(db, input.cohortId, ordered);
  if (!membership.ok) return { ok: false, reason: "unavailable" };

  const plan = planFwBatch({
    studentIds: ordered,
    cohortMemberIds: membership.memberIds,
    clientIds: input.clientIds,
  });

  const actionId = input.actionId ?? randomUUID();
  const captured = clampFwCapturedAt(input.capturedAt, input.now);

  const byStudent = new Map<string, FwStudentResult>();
  for (const skip of plan.skipped) {
    byStudent.set(skip.studentId, {
      studentId: skip.studentId,
      kind: "skipped",
      reason: skip.reason,
    });
  }

  // Sequential, not Promise.all: each call takes a row lock, and the venue-wifi
  // reality is that a burst of parallel writes over a flaky link fails together
  // rather than degrading. Three rows at most (FW_BATCH_MAX), so the wall clock
  // is three round trips on the slowest path the guide will ever hit.
  for (const target of plan.targets) {
    const echo = await fwMoveTask(db, {
      studentId: target.studentId,
      taskId: input.taskId,
      action: input.action,
      actor: input.actorUserId,
      cohortId: input.cohortId,
      capturedAt: captured.value,
      actionId,
      clientId: target.clientId,
    });
    byStudent.set(target.studentId, resultForFwEcho(target.studentId, input.action, echo));
  }

  const outcomes = ordered.map(
    (studentId) =>
      byStudent.get(studentId) ?? {
        studentId,
        kind: "failed" as const,
        reason: "unavailable" as const,
      }
  );

  return {
    ok: true,
    actionId,
    outcomes,
    firstDollar: fwFirstDollarStudents({
      taskId: input.taskId,
      action: input.action,
      results: outcomes,
    }),
    capturedAtClamped: captured.clamped,
  };
}
