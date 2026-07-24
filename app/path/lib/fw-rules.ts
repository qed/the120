/**
 * The FW check-in decision table (FW Unit 3; FW-R16–R22, FW-D5/D10/D12/D16,
 * plan Decisions 1–3, 5, 6, 9) — the pure half of the sanctioned, cascade-free,
 * no-gating Founders Weekend transition.
 *
 * PLAIN module by convention (`progress-core.ts`'s posture): no next/supabase/
 * react imports, so it is importable under vitest and `tsx`. The db-taking core
 * is `fw-checkin-core.ts`; the `"use server"` shell is `actions/fw-checkin.ts`.
 *
 * ── Why FW gets its own executor rather than a mode of the Path's
 *
 * `move_path_task` is CORRECT for the Path and wrong for FW (origin FW-D12).
 * Its verify arm unlocks the next task and may open a criterion review; its
 * revoke arm returns an open review and re-asserts the original-verifier rule.
 * Every one of those is a gating decision, and FW has no gating: a guide drills
 * to any task in the catalog and taps it. So FW gets a SIBLING RPC —
 * `fw_move_task` — and the Path's tested surface stays frozen. The two share the
 * events table, not code (plan Decision 1).
 *
 * ── The three encodings this module is the source of truth for
 *
 * The action→target map and the per-action legal-from sets exist in SQL as well
 * as here — in `supabase/migrations/20260730120000_fw_move_task.sql` and again in
 * `20260731120000_fw_client_id_scoped.sql`, which re-scopes the idempotency key
 * and is the definition the live database runs.
 * `__tests__/fw-move-task-parity.test.ts` parses BOTH and pins them so a drift on either side fails a test rather than an
 * event weekend (the `progress-core.ts` parity idiom, and the reason it exists:
 * docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
 * parse-migration-file-2026-07-22.md).
 */

import { clampToNow } from "./sync-rules";
import { type TaskState } from "./transition-table";

/* ══════════════════════════════════════════ the action set and its targets ══ */

/**
 * The guide's entire vocabulary. Deliberately NOT the Path's transition names:
 * one shared event log carries both write paths, and `checkmark`/`undo` in a row's
 * `transition` column is what tells a reader (and the board's read model) which
 * path wrote it. `path_fw_replay_rejects.action`'s CHECK already speaks exactly
 * this vocabulary — Unit 1 chose it before this module existed, and matching it
 * keeps one FW verb per concept across the schema.
 */
export const FW_ACTIONS = ["checkmark", "not_yet", "undo"] as const;
export type FwAction = (typeof FW_ACTIONS)[number];

/**
 * The from-INDEPENDENT target of each action — the "hardcoded target" rule the
 * Path executor also follows. The RPC receives the ACTION NAME and maps it to
 * these literals in its own SQL `CASE`; it never accepts a caller-supplied target
 * state, so a stale or tampered caller cannot smuggle a forged one in.
 */
export const FW_ACTION_TARGETS: Record<FwAction, TaskState> = {
  checkmark: "verified",
  not_yet: "not_yet",
  undo: "locked",
};

/**
 * THE LEGAL-FROM SET IS THE UPDATE'S WHERE PREDICATE — that identity is the
 * whole of FW's race safety, inherited from `move_path_task`, and the parity test
 * asserts it structurally because a node-only test setup cannot run true
 * concurrency (plan Decision 2).
 *
 * Read each set as a product rule, not a state-machine artifact:
 *
 *   checkmark — every state except its own target. FW-D5: NO GATING. A guide
 *               reaches any task in the catalog by drill-down and taps it, so
 *               there is no predecessor to satisfy and no `available` to wait
 *               for. The one exclusion (`verified`) is what makes a mis-tap on a
 *               finished task a silent no-op instead of a second bell.
 *
 *   not_yet   — the same, MINUS `verified`. A verified task is not downgraded by
 *               a stray tap; the guide undoes first, deliberately. (Its own
 *               target is excluded here too, but a not-yet tap onto `not_yet` is
 *               not refused — it takes the re-attempt arm below.)
 *
 *   undo      — the two DECISION states only. Undo reverts a decision; it is not
 *               a general reset. From a Path work state (`available`,
 *               `in_progress`, `submitted`) there is no FW decision to revert,
 *               and stamping `locked` there would erase a real position.
 */
export const FW_ACTION_LEGAL_FROM: Record<FwAction, readonly TaskState[]> = {
  checkmark: ["locked", "available", "in_progress", "submitted", "not_yet"],
  not_yet: ["locked", "available", "in_progress", "submitted"],
  undo: ["verified", "not_yet"],
};

export function isFwAction(x: string): x is FwAction {
  return (FW_ACTIONS as readonly string[]).includes(x);
}

export function fwActionTarget(a: FwAction): TaskState {
  return FW_ACTION_TARGETS[a];
}

/* ══════════════════════════════════════════════════════════ the decision ══ */

/** Why a tap was refused. Both reasons are shown to the guide as copy, so they
 *  name the RECOVERY, not the rule that was broken. */
export type FwRefusalReason =
  /** not-yet onto a verified task — undo it first, on purpose. */
  | "undo_first"
  /** undo on a row holding no FW decision (a Path work state). */
  | "not_a_decision";

export type FwDecision =
  /** The row moves, an event is written. */
  | { kind: "apply"; to: TaskState }
  /** An event is written, the row does NOT move (not-yet onto `not_yet`). */
  | { kind: "re_attempt" }
  /** Nothing happens at all — no row change, NO EVENT. */
  | { kind: "already_done" }
  | { kind: "refused"; reason: FwRefusalReason };

/**
 * THE single predicate for "is this task already decided, and may this action
 * touch it?" — the one every layer asks and none re-derives.
 *
 * It is called in three places on purpose: the SQL mirrors it (parity-pinned),
 * `resultForFwEcho` re-derives a refusal's REASON from it so the guide's copy can
 * never disagree with the rule that produced the refusal, and Unit 8's queue
 * reduction will consult it to decide which offline op-sequences are legal to
 * collapse (plan Decision 9 — an `undo + decision` correction must never be
 * flattened to the bare decision, precisely because THIS table would refuse it).
 *
 * Writing a fourth, local version of "is it already decided?" is the failure mode
 * documented in docs/solutions/logic-errors/idempotent-primitive-plus-
 * unconditional-caller-rotated-a-live-credential-…-2026-07-23.md: two definitions
 * of the same predicate are a bug waiting for the case where they disagree.
 *
 * The four arms, in the order the SQL evaluates them:
 *
 *   1. legal-from hit                       → apply
 *   2. not-yet onto `not_yet`               → re_attempt  (checked BEFORE 3,
 *      because from === target here and arm 3 would otherwise swallow it)
 *   3. from === the action's own target      → already_done
 *   4. otherwise                             → refused
 */
export function decideFwAction({ action, from }: { action: FwAction; from: TaskState }): FwDecision {
  if (FW_ACTION_LEGAL_FROM[action].includes(from)) {
    return { kind: "apply", to: fwActionTarget(action) };
  }

  // A FRESH not-yet tap on an already-not-yet task appends a re-attempt event
  // and changes nothing. Repeat struggle is exactly the blocker signal FW-D4
  // exists to capture, and FW-R17 calls Not-yet a recorded state — so the second
  // tap is data, not noise. (A REPLAYED tap is filtered one layer down by the
  // client-id idempotency key, not here: freshness is not a property of the
  // decision table, it is a property of the tap.)
  if (action === "not_yet" && from === "not_yet") return { kind: "re_attempt" };

  if (from === fwActionTarget(action)) return { kind: "already_done" };

  return {
    kind: "refused",
    reason: action === "not_yet" ? "undo_first" : "not_a_decision",
  };
}

/* ═════════════════════════════════════════════════════ the RPC's echo union ══ */

/**
 * Every outcome `fw_move_task` can return. The RPC classifies under a row lock,
 * so this is the AUTHORITATIVE verdict — `decideFwAction` above is the same table
 * evaluated against a possibly-stale client view, and where they disagree the RPC
 * is right.
 */
export const FW_OUTCOMES = [
  /** Our UPDATE won: the row moved and one event was written. */
  "applied",
  /** No state change; a re-attempt event was appended. */
  "re_attempt",
  /** Nothing to do. NO EVENT — this is the bell-safety arm. */
  "already_done",
  /** Illegal from the row's current state. */
  "refused",
  /** This exact `client_id` was already recorded — an offline replay. */
  "replayed",
  /** No progress row exists for (student, task): a provisioning gap. */
  "missing",
  /** The cohort is not `kind='fw'`, or the student is not a member of it. */
  "cohort_invalid",
] as const;
export type FwOutcome = (typeof FW_OUTCOMES)[number];

/** Fail-closed narrowing at the service-role boundary — the `narrowTaskState`
 *  discipline. A bare `as FwOutcome` here would be a promise to the compiler with
 *  nothing behind it, on a value that decides whether a bell rings. */
export function narrowFwOutcome(x: unknown): FwOutcome | null {
  return typeof x === "string" && (FW_OUTCOMES as readonly string[]).includes(x)
    ? (x as FwOutcome)
    : null;
}

/** The row `fw_move_task` echoes back, already narrowed by the loader. */
export type FwEcho = {
  outcome: FwOutcome;
  /**
   * The row's state AFTER the call — ours if we won, the winner's if we lost.
   * NULL only for `missing`, where there is genuinely no row to describe. On any
   * other outcome a null state means the echo did not narrow (a renamed column, a
   * shape drift), and `resultForFwEcho` fails it closed rather than guessing.
   */
  state: TaskState | null;
  /** The decision's author; null once undone. */
  verifiedBy: string | null;
};

/* ════════════════════════════════════════════════ the per-student result ══ */

export type FwStudentResult =
  | { studentId: string; kind: "applied"; state: TaskState }
  | { studentId: string; kind: "re_attempt"; state: TaskState }
  | { studentId: string; kind: "already_done"; state: TaskState }
  | { studentId: string; kind: "replayed"; state: TaskState }
  | { studentId: string; kind: "refused"; reason: FwRefusalReason; state: TaskState }
  | { studentId: string; kind: "skipped"; reason: FwSkipReason }
  | {
      studentId: string;
      kind: "failed";
      reason: "unavailable" | "missing_progress" | "cohort_invalid";
    };

/**
 * Interpret one RPC echo for one student.
 *
 * The union is deliberately SEVEN-WAY rather than ok/not-ok, because every
 * downstream effect must branch on which kind of success it got. That is the
 * shape the Unit-2 composition bug argued for: "if a function can succeed by
 * either creating something or reusing something that already existed, any other
 * effect chained after that success needs its own branch on that distinction."
 * Here the chained effect is a bell in a room full of families, and
 * `already_done` / `replayed` are exactly the successes it must not fire on.
 *
 * A null echo — the RPC errored, or its row would not narrow — is `failed`, never
 * an optimistic success. An errored response is not proof the write failed, but
 * it is not proof it landed either, and FW's recovery for that is the guide
 * tapping again (idempotent by state, and by `client_id` when one is carried).
 */
export function resultForFwEcho(
  studentId: string,
  action: FwAction,
  echo: FwEcho | null
): FwStudentResult {
  if (echo === null) return { studentId, kind: "failed", reason: "unavailable" };

  // `missing` is the one outcome that legitimately carries no state.
  if (echo.outcome === "missing") return { studentId, kind: "failed", reason: "missing_progress" };
  if (echo.outcome === "cohort_invalid") {
    return { studentId, kind: "failed", reason: "cohort_invalid" };
  }
  // Every remaining outcome describes a REAL ROW the RPC held a lock on, so a
  // null state here is a shape drift, not a fact. Fail closed — reporting
  // "applied" with an unknown state would tell a guide their tap landed on a row
  // nobody can name.
  if (echo.state === null) return { studentId, kind: "failed", reason: "unavailable" };
  const state = echo.state;

  switch (echo.outcome) {
    case "applied":
      return { studentId, kind: "applied", state };
    case "re_attempt":
      return { studentId, kind: "re_attempt", state };
    case "already_done":
      return { studentId, kind: "already_done", state };
    case "replayed":
      return { studentId, kind: "replayed", state };
    case "refused": {
      // Re-derive the REASON from the same table the RPC refused by, rather than
      // widening the RPC's return with a reason string that could drift from it.
      const decision = decideFwAction({ action, from: state });
      if (decision.kind !== "refused") {
        // The RPC refused and this table would not have. That is parity DRIFT
        // between the SQL and this module — exactly what fw-move-task-parity
        // exists to prevent — so fail closed rather than hand the guide a
        // specific, plausible, possibly-wrong reason. "Try again / find staff"
        // is the honest answer when the two halves disagree about the rules.
        return { studentId, kind: "failed", reason: "unavailable" };
      }
      return { studentId, kind: "refused", reason: decision.reason, state };
    }
  }
}

/* ═══════════════════════════════════════════════════════════ batch planning ══ */

/** The cap the guide's batch picker enforces (Unit 4) and the write path
 *  re-enforces. Lives here so the picker imports it instead of re-typing 3. */
export const FW_BATCH_MAX = 3;

export type FwSkipReason =
  /** The student is not a member of the cohort being stamped (Decision 3). */
  | "not_in_cohort"
  /** Past FW_BATCH_MAX — reported, never silently dropped. */
  | "over_batch_max";

export type FwBatchTarget = { studentId: string; clientId: string | null };
export type FwBatchSkip = { studentId: string; reason: FwSkipReason };
export type FwBatchPlan = { targets: FwBatchTarget[]; skipped: FwBatchSkip[] };

/**
 * Turn a guide's selection into N per-student plans plus a truthful skip list.
 *
 * `cohortMemberIds` MUST come from an authoritative `path_cohort_members` read
 * for the cohort being stamped — this function cannot verify its own input, and
 * Decision 3 is that the cohort stamp is verified client context: always carried,
 * never inferred, never trusted. The actor half of `membership ∩ scope` is
 * already settled before this runs (`resolveFwActorForCohort` refused the request
 * outright if the actor cannot act in this cohort), so what remains here is the
 * membership half.
 *
 * Three properties the tests pin:
 *   - selection ORDER is preserved, so the result list reads like the picker;
 *   - duplicates collapse, because two calls sharing one `client_id` would make
 *     the second read as a replay and report a phantom skip;
 *   - the cap SKIPS the overflow rather than truncating, so a UI bug that sends
 *     four students produces a visible "not applied" line instead of a silent
 *     loss (the plan's no-silent-caps posture).
 */
export function planFwBatch(input: {
  studentIds: readonly string[];
  cohortMemberIds: readonly string[];
  clientIds?: Readonly<Record<string, string>>;
}): FwBatchPlan {
  const members = new Set(input.cohortMemberIds);
  const targets: FwBatchTarget[] = [];
  const skipped: FwBatchSkip[] = [];
  const seen = new Set<string>();

  for (const studentId of input.studentIds) {
    if (seen.has(studentId)) continue;
    seen.add(studentId);

    if (!members.has(studentId)) {
      skipped.push({ studentId, reason: "not_in_cohort" });
      continue;
    }
    // The cap counts students we would actually WRITE for, which is why it is
    // applied after the membership filter and after de-duplication.
    if (targets.length >= FW_BATCH_MAX) {
      skipped.push({ studentId, reason: "over_batch_max" });
      continue;
    }
    targets.push({ studentId, clientId: input.clientIds?.[studentId] ?? null });
  }

  return { targets, skipped };
}

/* ══════════════════════════════════════════════ First Dollar — the bell gate ══ */

/** The task the whole room's ceremony hangs on (FW-D16): the first dollar. */
export const FW_FIRST_DOLLAR_TASK_ID = "1.2.4";

export function isFirstDollarTask(taskId: string): boolean {
  return taskId === FW_FIRST_DOLLAR_TASK_ID;
}

/**
 * Which students, if any, just crossed the first-dollar line — the ONLY input the
 * celebration is allowed to fire on.
 *
 * The gate is `kind === "applied"`, and nothing else qualifies. `already_done`
 * means the room already rang the bell for that child; `replayed` means the tap
 * was captured during an outage and the physical bell rang then (plan Decision 5
 * — stale events update every aggregate silently, but the bell stays quiet);
 * `re_attempt` is not a verify at all. Firing on "the action succeeded" instead
 * of "this student newly verified" is precisely the composition bug Unit 2 shipped
 * and had to fix, with a bell instead of an email at the end of it.
 *
 * Returns student ids rather than a boolean so the surface can NAME who crossed —
 * a batched first dollar rings once and names all three (Decision 6).
 */
export function fwFirstDollarStudents(input: {
  taskId: string;
  action: FwAction;
  results: readonly FwStudentResult[];
}): string[] {
  if (input.action !== "checkmark" || !isFirstDollarTask(input.taskId)) return [];
  return input.results.filter((r) => r.kind === "applied").map((r) => r.studentId);
}

/* ═══════════════════════════════════════════════════ capture-time clamping ══ */

/**
 * The capture time an event is stamped with, clamped against the SERVER clock.
 *
 * Delegates to `clampToNow` — the Path's existing capture clamp — rather than
 * growing a second one. The device clock is untrusted input (docs/solutions/
 * best-practices/offline-sync-device-clock-is-untrusted-input-…-2026-07-22.md)
 * and an FW iPad that sat in a bag all summer is exactly the dead-RTC case that
 * function's 2025 floor was written for. The RPC re-clamps with
 * `least(coalesce(p_captured_at, now()), now())` as the boundary backstop; this
 * is the tested half.
 *
 * A missing value is `now`, UNCLAMPED — the online path supplies no capture time
 * because receipt time is the capture time, and reporting that as a clamp would
 * make the anomaly signal meaningless on the 99% path.
 */
export function clampFwCapturedAt(
  capturedAt: string | null | undefined,
  nowMs: number
): { value: string; clamped: boolean } {
  if (capturedAt === null || capturedAt === undefined || capturedAt === "") {
    return { value: new Date(nowMs).toISOString(), clamped: false };
  }
  const clamp = clampToNow(capturedAt, nowMs);
  return { value: clamp.value, clamped: clamp.clamped };
}
