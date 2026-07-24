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

import { withFwTimeout } from "./fw-call";
import { isFwTombstoneName } from "./fw-ops-rules";
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

/* ═══════════════════════════════════════════════════════════ the wall clock ══ */

/**
 * The timeout and the throw-guard this file introduced now live in `fw-call.ts`,
 * because Unit 4's read path needs exactly the same protection for exactly the
 * same reason (the reliability review found it missing there). Re-exported so
 * this module's own tests and callers keep their import.
 */
export { FW_CALL_TIMEOUT_MS } from "./fw-call";

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
  /**
   * The offline-only undo CAS (Unit 9 / Decision 9). null on every online tap — no
   * CAS, so any guide may undo any decision live. Non-null ONLY on an offline undo
   * REPLAY, carrying the author the drain's same-actor guard checked; the RPC then
   * applies the undo only while `verified_by` still matches, and echoes
   * `cross_actor_undo` if a concurrent cross-actor decision won the row first. The
   * RPC ignores it for checkmark/not_yet.
   */
  expectedVerifiedBy: string | null;
};

/**
 * Call `fw_move_task` and narrow its echo FAIL-CLOSED.
 *
 * Returns null on any shape the caller cannot trust — an RPC error, a timeout, an
 * empty result, an outcome outside the union. `resultForFwEcho` turns that into a
 * `failed` result rather than an optimistic success: an errored response is not
 * proof the write failed, but it is not proof it landed either.
 *
 * RETRY SAFETY IS NOT UNIFORM ACROSS THE THREE ACTIONS, and the difference is
 * worth stating precisely because "the guide taps again" is the whole recovery
 * model:
 *
 *   - `checkmark` / `undo` are idempotent BY STATE. A retry after an ambiguous
 *     failure lands on the `already_done` arm — zero rows, zero events, no bell.
 *   - `not_yet` is NOT, unless a `client_id` is carried. A second tap on an
 *     already-`not_yet` row is DEFINED to append a re-attempt event (that is the
 *     FW-D4 repeat-struggle signal), so the RPC cannot distinguish "the guide
 *     genuinely tapped twice" from "the first response was lost over venue wifi"
 *     without the exactly-once key. Online taps currently carry none.
 *
 * That gap is a Unit 4 wiring requirement, not a Unit 3 schema change: the whole
 * path (`RunFwCheckInInput.clientIds` -> `p_client_id` -> the partial unique
 * index) already exists, so the guide surface should mint a client id per tap
 * ONLINE as well as offline. `fw-checkin-core.test.ts` pins the current behaviour
 * so the gap is visible in the suite rather than discovered at an event.
 */
export async function fwMoveTask(
  db: SupabaseClient,
  p: FwMoveTaskParams
): Promise<FwEcho | null> {
  const where = `${p.studentId}, ${p.taskId}, ${p.action}, cohort ${p.cohortId}, actor ${p.actor}`;

  // try/catch, not just the { data, error } shape: supabase-js reports most
  // failures in-band, but a network abort or a malformed response can THROW, and
  // an exception escaping here would unwind the caller's sequential loop — so
  // students already written would never be reported even though their writes
  // committed, silently breaking this file's "one student's failure never aborts
  // the others" guarantee.
  let raced;
  try {
    raced = await withFwTimeout(
      db.rpc("fw_move_task", {
        p_student_id: p.studentId,
        p_task_id: p.taskId,
        p_action: p.action,
        p_actor: p.actor,
        p_cohort_id: p.cohortId,
        p_captured_at: p.capturedAt,
        p_action_id: p.actionId,
        p_client_id: p.clientId,
        p_expected_verified_by: p.expectedVerifiedBy,
      }),
      `fw_move_task(${where})`
    );
  } catch (e) {
    console.error(`[fw/checkin] fw_move_task(${where}) threw:`, e);
    return null;
  }
  if (raced.timedOut) return null;

  const { data, error } = raced.value;
  if (error) {
    console.error(`[fw/checkin] fw_move_task(${where}) failed: ${error.message}`);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    console.error(`[fw/checkin] fw_move_task(${where}) returned no row`);
    return null;
  }

  const outcome = narrowFwOutcome(row.outcome);
  if (outcome === null) {
    // Never coerced: this value decides whether a bell rings in a room. Logged
    // WITH its coordinates — this is a schema-drift signal somebody may have to
    // diagnose at 9pm on a Saturday with no engineer on site.
    console.error(
      `[fw/checkin] fw_move_task(${where}) echoed an unrecognized outcome: ${String(row.outcome)}`
    );
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

  let raced;
  try {
    raced = await withFwTimeout(
      db
        .from("path_cohort_members")
        .select("student_id")
        .eq("cohort_id", cohortId)
        .in("student_id", [...studentIds]),
      `membership read (cohort ${cohortId})`
    );
  } catch (e) {
    console.error(`[fw/checkin] membership load for cohort ${cohortId} threw:`, e);
    return { ok: false };
  }
  if (raced.timedOut) return { ok: false };
  const res = raced.value;

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

/**
 * Which of these students are ANONYMIZED — the write-path half of Decision 10's
 * "permanently retired" guarantee (adversarial review, Unit 5b).
 *
 * Anonymize tombstones a student's name but deliberately KEEPS their
 * `path_cohort_members` row (the record stays; the person is unfindable by name).
 * The guide roster and quick-create already filter anonymized students out, but
 * those are LIST reads — a guide with a task page already rendered before the
 * anonymize (a stale tab, or a race) can still fire a check-in ACTION for that
 * student, and `fw_move_task` only checks membership + `kind='fw'`. This is the
 * single choke point every write goes through (`runFwCheckIn` is the only caller
 * of `fwMoveTask`), so excluding tombstoned students HERE keeps a retired
 * identity out of the append-only event log without a guessable stale render
 * routing around it.
 *
 * TRI-STATE, like the membership read it runs beside: a read failure refuses the
 * whole action (`ok:false`), never silently treats a student as non-tombstoned —
 * the fail-closed posture for a guard that keeps events off a retired child.
 */
export async function loadFwTombstonedStudentIds(
  db: SupabaseClient,
  studentIds: readonly string[]
): Promise<{ ok: true; ids: Set<string> } | { ok: false }> {
  if (studentIds.length === 0) return { ok: true, ids: new Set() };

  let raced;
  try {
    raced = await withFwTimeout(
      db.from("path_student_profiles").select("id, first_name, last_name").in("id", [...studentIds]),
      `tombstone read (${studentIds.length} students)`
    );
  } catch (e) {
    console.error(`[fw/checkin] tombstone load threw:`, e);
    return { ok: false };
  }
  if (raced.timedOut) return { ok: false };
  const res = raced.value;
  if (res.error) {
    console.error(`[fw/checkin] tombstone load failed: ${res.error.message}`);
    return { ok: false };
  }

  const ids = new Set<string>();
  for (const r of res.data ?? []) {
    if (typeof r.id === "string" && isFwTombstoneName(r.first_name, r.last_name)) ids.add(r.id);
  }
  return { ok: true, ids };
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
  /**
   * The offline-only undo CAS author (Unit 9 / Decision 9), passed ONLY by the
   * drain when it replays a leading undo the same-actor guard already checked. null
   * on every online tap — no CAS, so a live cross-actor undo still applies. The RPC
   * consults it only for `undo`, so a batch replay (always single-student here) is
   * safe. See `fw_move_task`'s `p_expected_verified_by`.
   */
  expectedVerifiedBy?: string | null;
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
 * Sequence: verify membership → plan (pure) → N atomic RPC calls (concurrent,
 * sharing one `action_id`) → interpret each echo → derive the celebration from
 * the results.
 *
 * ── Three properties worth stating, each a bug this shape prevents
 *
 * 1. **A failed membership read refuses the whole action.** Writing with an
 *    unverified cohort stamp is not a degraded success; it is a permanent lie in
 *    an append-only log (a Hamptons tap counted in Boston's weekend numbers).
 *    The accepted cost, stated: a transient blip blocks the guide from recording
 *    anything until they retap. Unit 8's offline queue — not a partial write
 *    here — is the mitigation for a sustained outage.
 *
 * 2. **One student's failure never aborts the others.** The guide tapped for all
 *    of them; each write is independently atomic, and a partial batch is a
 *    DESIGNED, REPORTED state — the plan tolerates partial `action_id` groups
 *    explicitly. This is why `fwMoveTask` catches and times out rather than
 *    letting anything escape: an exception would unwind the whole batch and hide
 *    writes that already committed.
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

  // Membership (Decision 3) AND the anonymize guard (Decision 10) — read
  // CONCURRENTLY so the retired-identity check costs the hot loop no extra round
  // trip. A tombstoned student is EXCLUDED from the effective member set, so
  // `planFwBatch` treats their tap as a non-member skip: their membership row
  // persists by design, but no new event may be written against a retired child.
  const [membership, tombstoned] = await Promise.all([
    loadFwCohortMemberIds(db, input.cohortId, ordered),
    loadFwTombstonedStudentIds(db, ordered),
  ]);
  if (!membership.ok || !tombstoned.ok) return { ok: false, reason: "unavailable" };
  const activeMemberIds = membership.memberIds.filter((id) => !tombstoned.ids.has(id));

  const plan = planFwBatch({
    studentIds: ordered,
    cohortMemberIds: activeMemberIds,
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

  // CONCURRENT, deliberately. An earlier revision ran these sequentially and
  // justified it by row locks — which is wrong, and the performance review caught
  // it: `planFwBatch` has already de-duplicated by student, so the (at most
  // FW_BATCH_MAX) targets are always DISTINCT (student_id, task_id) rows. They
  // share no lock, so serializing them bought nothing and cost a full round trip
  // per extra student — ~600ms of the plan's ~5s tap-to-board budget on a 3-student
  // tap over venue wifi, every time.
  //
  // Safe to parallelize because each call is an independently atomic transaction
  // and `fwMoveTask` never throws (it catches, times out, and fails closed to
  // null), so `Promise.all` cannot reject and cannot lose a sibling's result.
  const echoes = await Promise.all(
    plan.targets.map((target) =>
      fwMoveTask(db, {
        studentId: target.studentId,
        taskId: input.taskId,
        action: input.action,
        actor: input.actorUserId,
        cohortId: input.cohortId,
        capturedAt: captured.value,
        actionId,
        clientId: target.clientId,
        // null on every online tap (no CAS); the drain sets it only when replaying a
        // guard-checked leading undo, and the RPC consults it only for `undo`.
        expectedVerifiedBy: input.expectedVerifiedBy ?? null,
      })
    )
  );
  plan.targets.forEach((target, i) => {
    byStudent.set(target.studentId, resultForFwEcho(target.studentId, input.action, echoes[i]));
  });

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
