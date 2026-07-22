/**
 * The Path progress engine — the transition table AS DATA (T1 Unit 7).
 *
 * This file is the specification. Brief §9.1 (task state machine), §9.2
 * (concurrency), §9.5 (verification integrity) and the plan's state diagram are
 * encoded here as an enumerable array of rows — not a `switch` — so tests
 * iterate the table and assert the invariant over the WHOLE set rather than
 * re-listing cases by hand. That discipline is exactly what caught the 5.5.5
 * miss in Unit 3 (docs/solutions/.../aggregate-invariants-not-fixture-spot-
 * checks-for-parsed-content-2026-07-21.md). Adding a transition is a data change.
 *
 * PURE: no next / supabase / react imports, and — deliberately — no getProgram
 * import either. Every row operates on an already-materialised snapshot handed
 * in via `TransitionCtx`. The version-pinned resolution that BUILDS those
 * snapshots from `getProgram(student.programVersionId)` (D27) lives one layer up
 * in `path-rules.ts`. Keeping content lookups out of the table is what lets the
 * table be enumerated in tests without registering a program.
 *
 * R6 lives here three ways, on purpose (belt, suspenders, and a second belt):
 *   1. `clampStudentTaskState` — the pure CLAMP mirroring `effectiveReviewStatus`
 *      (app/crm/lib/reviews-rules.ts): a forged student-supplied `verified`
 *      coerces back to the current state, for the DB-echo / tampered-client path.
 *   2. every row that a student may not drive carries `verifying: true`, and the
 *      engine refuses a student actor on any such row (`path-rules.ts`).
 *   3. the row's `actor` class must match exactly, so an `adult` row rejects a
 *      `student` actor even if (1) and (2) were ever loosened.
 *
 * ── CALLER OBLIGATIONS (this pure engine CANNOT verify these; every caller MUST) ──
 * Like `access-rules.ts`, the integrity this module enforces is only as strong
 * as the inputs it is handed. A caller (Unit 8's transition RPC / applier) MUST:
 *   1. Derive `actorRole`/`actorId` from the AUTHENTICATED session, never from a
 *      client-supplied field — the R6 gate and §9.5 identity check trust them.
 *   2. Build `task` / `criterion` (and `phase`) from the AUTHORITATIVE, COMPLETE
 *      DB rows for the student named by the route. The predecessor, display-block
 *      and criterion-aggregate derivations silently under-enforce on a partial
 *      task set (a missing earlier task reads as "no earlier task"), and
 *      `verifiedBy` on the DB row must be the real `actorId` that verified.
 *   3. Emit `null` (never `""`) for an unset `reviewOpenedAt`, and fail-closed
 *      narrow every DB state string into these unions before it reaches here
 *      (the `parseRoleGrant` pattern, one layer up).
 *   4. Treat `CascadeEffect` as a spec to APPLY atomically, switching on
 *      `cascade.scope`: write `taskTo` only for a `"task"` cascade, `phaseTo`
 *      only for a `"phase"` cascade, then apply `successors` and derive/write the
 *      criterion aggregate. Because `criterionTo` is computed from a point-in-time
 *      snapshot, two concurrent verifies of DIFFERENT tasks in one criterion can
 *      each compute a stale aggregate — the RPC must re-derive it from all
 *      siblings under the same CAS/transaction, not blind-write this value.
 *   5. Not re-COALESCE `snapshotBand` against a fresh DB read — it is resolved
 *      here (freeze-if-null); a second COALESCE against a stale read can misfire.
 *   6. `phase_return` is modeled but has NO T1 trigger, and must be invoked once
 *      per criterion (each call's `CascadeEffect` reports only the one criterion
 *      in `ctx.criterion`). It validates `returnedCriterionIds` membership against
 *      `ctx.phase.criterionIds` — so T2's phase-review unit MUST populate that
 *      with the phase's real criteria, exactly as the criterion loader populates
 *      `criterion.tasks`.
 *   7. `already_in_target_state` is returned WITHOUT running the row's precondition
 *      (identity/note/membership are not evaluated when the target state is already
 *      reached). Unit 8 must independently re-authorize the actor before treating
 *      an `already_in_target_state` verdict as a successful no-op — obligation #1
 *      still applies on that path.
 */

import type { Band } from "@/app/path/content/types";

/* ------------------------------------------------------------------- states */

// The state literals are the SINGLE source of truth (the access-rules.ts idiom):
// the TaskState/CriterionState/PhaseState types are DERIVED from these arrays, so
// a type can never gain a member the runtime array (and the legal-states tests)
// miss, and vice versa. Adding a state is a one-line array edit.

/** The six task states (brief §9.1). `not_yet` is a resting state, not a
 *  transient — a task sits there until the student resumes it. */
export const TASK_STATES = [
  "locked",
  "available",
  "in_progress",
  "submitted",
  "not_yet",
  "verified",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

/**
 * Criterion states for T1. `cleared` (the crest-awarding Tier 2 ceremony) is
 * T2 — its absence here is deliberate: T1 opens the review and can return it,
 * but does not close it. `returned` holds until every task re-verifies.
 */
export const CRITERION_STATES = ["active", "review_underway", "returned"] as const;
export type CriterionState = (typeof CRITERION_STATES)[number];

/**
 * Phase states. Phase review / seal / countersign is T2 (scope boundary); this
 * set exists only so `phase_return` — which the plan requires the table to
 * model — has a legal `from`/`to`. No T1 trigger reaches `sealed`.
 */
export const PHASE_STATES = ["locked", "active", "review_underway", "sealed", "returned"] as const;
export type PhaseState = (typeof PHASE_STATES)[number];

export type TransitionScope = "task" | "criterion" | "phase";

/**
 * Who is acting. `adult` = a verifying parent (or, in T2, a guide). Identity —
 * "the SAME verifier who made it" (§9.5) — is a separate check on `actorId`,
 * not a class. `system` is the automatic unlock cascade; no human drives it.
 *
 * Parent-acting-as-child is NOT a fourth class: per the plan's accepted trust
 * boundary, a parent who submits for a young child does so IN the child's
 * session, so the engine sees `student`. R6 still holds because the verify
 * happens in the parent's own session (`adult`).
 */
export type ActorClass = "student" | "adult" | "system";

export type TransitionName =
  | "unlock"
  | "open"
  | "submit"
  | "withdraw"
  | "verify"
  | "not_yet"
  | "resume"
  | "revoke"
  | "criterion_return"
  | "phase_return";

/* ---------------------------------------------------------------- snapshots */

/** One task's progress row, reduced to what the state machine reads. Built by
 *  the resolver in `path-rules.ts` from the pinned program joined with DB rows. */
export type TaskSnapshot = {
  id: string;
  /** 1-based sequence within the criterion; predecessor math reads this. */
  seq: number;
  state: TaskState;
  /** Set when the criterion review opens; withdraw is legal only while unset (D6).
   *  MUST be `null` (never `""`) for "not opened" — see caller obligations. */
  reviewOpenedAt: string | null;
  /** The user id that recorded the verification — §9.5 actor-scoped revoke. */
  verifiedBy: string | null;
  /** Band frozen at first `available`; null until then. `effectiveBand` reads it. */
  snapshotBand: Band | null;
};

export type CriterionSnapshot = {
  id: string;
  state: CriterionState;
  /** Every task of the criterion, seq order — predecessor / last-task /
   *  display-block derivations read the whole set. MUST be complete (see
   *  caller obligations): a missing earlier task reads as "no earlier task". */
  tasks: TaskSnapshot[];
};

export type PhaseSnapshot = {
  id: string;
  state: PhaseState;
  /** The phase's criterion ids. `phase_return` validates `returnedCriterionIds`
   *  against this — the criterion_return membership guard, at phase scope. T2's
   *  phase-review unit populates it from the phase's real criteria. */
  criterionIds: string[];
};

export type GateStatus = { open: true } | { open: false; reason: string };

/** Everything a transition needs, already materialised (no content lookups). */
export type TransitionCtx = {
  actorRole: ActorClass;
  /** The acting user's id; required for §9.5 revoke identity match, null for system. */
  actorId: string | null;
  /** The task being transitioned. For criterion/phase-scope rows this is a
   *  placeholder — those rows read `criterion` / `returnedTaskIds` instead, and
   *  their cascade never sets `taskTo`, so the placeholder is never written. */
  task: TaskSnapshot;
  criterion: CriterionSnapshot;
  /** Present only for phase-scope transitions (`phase_return`); a phase-scope
   *  transition with this omitted fails closed (no_such_transition). */
  phase?: PhaseSnapshot;
  /** Required note for `not_yet` and `criterion_return` (§9.1). */
  note?: string | null;
  /** The student's live band, snapshotted onto the task at `unlock`. */
  studentBand?: Band | null;
  /** Task ids reverted by `criterion_return`; each must be a member of `criterion`. */
  returnedTaskIds?: string[];
  /** Criterion ids reopened by `phase_return`. */
  returnedCriterionIds?: string[];
  /** The submit gate (D: additive math gate). T1 leaves this undefined → open;
   *  T3 populates it from the math-gate result, closing submit additively. */
  submitGate?: GateStatus;
};

/* -------------------------------------------------------------- refusals */

export type TransitionRefusal =
  | "no_such_transition"
  | "already_in_target_state"
  | "actor_not_permitted"
  | "review_already_opened"
  | "note_required"
  | "not_original_verifier"
  | "predecessor_unverified"
  | "display_blocked"
  | "nothing_to_return"
  | "unknown_returned_task"
  | "unknown_returned_criterion"
  | "gate_closed";

export type PreconditionResult = { ok: true } | { ok: false; reason: TransitionRefusal };

/* ---------------------------------------------------------------- effects */

/** Awards are immutable (D23): a reopened criterion renders its crest
 *  PROVISIONAL, never withdrawn. The cascade never emits a revocation. */
export type AwardEffect = "none" | "provisional";

/**
 * A notification intent — Unit 12 maps `kind` to durable delivery, and the
 * register (Trail/HQ) is resolved at READ time (Unit 16), never stored. The
 * kinds distinguish the three reopen scopes (`reopened` = one task, via revoke;
 * `criterion_returned` / `phase_returned` = the wider ceremonies) so Unit 16 can
 * render distinct copy from the event kind alone. Callers still persist the
 * originating ids/note alongside each intent — `kind` names the event, not its
 * subject. `audience` is only what T1 actually PRODUCES; Unit 12 extends it (a
 * `guide` audience for §13's countersign/digest paths) when those channels land.
 */
export type NotificationIntent = {
  audience: "student" | "parents";
  kind:
    | "submitted"
    | "verified"
    | "not_yet"
    | "review_underway"
    | "reopened"
    | "criterion_returned"
    | "phase_returned";
};

export type TaskStateChange = { taskId: string; to: TaskState };

/** Fields common to every cascade, whatever its scope. */
type CascadeBase = {
  /** Follow-on task changes: the next task unlocking, or tasks reverted on return. */
  successors: TaskStateChange[];
  /** The criterion's resulting state (always meaningful; unchanged where a
   *  transition does not affect the aggregate). */
  criterionTo: CriterionState;
  awards: AwardEffect;
  notifications: NotificationIntent[];
};

/**
 * The cascade is a DISCRIMINATED UNION on `scope`, so `taskTo`/`phaseTo`/
 * `snapshotBand` exist ONLY on the scope where they are load-bearing — a
 * task-scope cascade that forgot `taskTo`, or a criterion-scope cascade that set
 * one, is a COMPILE error, not hand-discipline. Unit 8's applier narrows on
 * `cascade.scope` and the type then hands it exactly the fields it may write.
 */
export type TaskCascade = CascadeBase & {
  scope: "task";
  /** The primary task's resulting state — the one field the applier persists. */
  taskTo: TaskState;
  /** For a transition INTO `available`: the band to freeze if not already set. */
  snapshotBand?: Band | null;
};
export type CriterionCascade = CascadeBase & { scope: "criterion" };
export type PhaseCascade = CascadeBase & { scope: "phase"; phaseTo: PhaseState };
export type CascadeEffect = TaskCascade | CriterionCascade | PhaseCascade;

/** The cascade variant a row of scope `S` must return. */
type CascadeForScope<S extends TransitionScope> = S extends "task"
  ? TaskCascade
  : S extends "criterion"
    ? CriterionCascade
    : PhaseCascade;

/** One transition row, keyed on scope so `from`/`to` are the scope's own state
 *  union (a typo'd literal is a COMPILE error) and its `cascade` returns exactly
 *  the cascade variant that scope allows. */
type Row<S extends TransitionScope, St extends string> = {
  name: TransitionName;
  scope: S;
  from: St;
  to: St;
  actor: ActorClass;
  /** An adult verifying action a student may never drive (R6). Enumerated by tests. */
  verifying: boolean;
  precondition: (ctx: TransitionCtx) => PreconditionResult;
  cascade: (ctx: TransitionCtx) => CascadeForScope<S>;
};

export type TransitionRow =
  | Row<"task", TaskState>
  | Row<"criterion", CriterionState>
  | Row<"phase", PhaseState>;

/* ------------------------------------------------------------ R6 pure clamp */

/** Task states a `student` actor may legitimately reach. Everything else
 *  (`verified`, `not_yet`, `locked`) is an adult / system outcome. */
export const STUDENT_REACHABLE_STATES: readonly TaskState[] = [
  "available",
  "in_progress",
  "submitted",
];

/**
 * R6 as a pure CLAMP — the direct mirror of `effectiveReviewStatus`. A forged
 * student-supplied target coerces back to `current`: no tampered client can
 * move a task to `verified` or `not_yet`, whatever it posts. This is the
 * echo-interpretation / DB-trust path; the table's per-row `verifying` gate is
 * the request-time path. Both are enumerated in the tests.
 */
export function clampStudentTaskState(requested: TaskState, current: TaskState): TaskState {
  return STUDENT_REACHABLE_STATES.includes(requested) ? requested : current;
}

/* ------------------------------------------------------------- submit gate */

/**
 * The submit gate hook (D: additive math gate). T1 reads `ctx.submitGate`, which
 * T1 callers never set — so the gate is open by default. T3's math gate populates
 * `ctx.submitGate` with `{ open: false, reason }`, and `submit`'s precondition
 * refuses with `gate_closed` — substantive with ZERO change to the transition.
 *
 * NOTE: `evaluateTransition` surfaces only the `gate_closed` reason code, not the
 * `reason` string — a consumer that needs the specific gate reason must keep the
 * original `ctx.submitGate`. If T3 needs reason-specific UI, prefer a structured
 * `{ code, message }` over free text before wiring it, to avoid a breaking change.
 */
export function submitGateStatus(ctx: TransitionCtx): GateStatus {
  return ctx.submitGate ?? { open: true };
}

/* ------------------------------------------------------ display-block rules */

/**
 * A verified (or otherwise actionable) task that sits LATER in sequence than any
 * non-verified sibling is display-blocked: it renders (append-only history
 * intact) but cannot be re-opened, re-submitted, or re-verified until the
 * earlier task re-clears. In normal forward flow this is never true — sequential
 * unlocking guarantees predecessors verify first — so it fires ONLY after a
 * `revoke` or `criterion_return` reopens an earlier task. This is the pure
 * derivation behind the plan's "later verified tasks stay verified but become
 * display-blocked and un-submittable", and the guard `open`/`submit`/`resume`/
 * `verify` consult so the ENGINE enforces it, not just the UI. (`revoke` does NOT
 * consult it: it is a REVIEWER correction, not student forward progress, and §9.5
 * lets the original verifier un-verify any task they verified.)
 *
 * Lives here (not in path-rules.ts) so the table's own preconditions can call it
 * without a circular import; `path-rules.ts` re-exports it as the read API.
 */
export function isDisplayBlocked(task: TaskSnapshot, criterion: CriterionSnapshot): boolean {
  return criterion.tasks.some((t) => t.seq < task.seq && t.state !== "verified");
}

/** A task is submittable only from `in_progress` and only when not blocked by an
 *  unresolved earlier task (the un-submittable half of a return). */
export function isSubmittable(task: TaskSnapshot, criterion: CriterionSnapshot): boolean {
  return task.state === "in_progress" && !isDisplayBlocked(task, criterion);
}

/* ----------------------------------------------------------- table helpers */

const OK: PreconditionResult = { ok: true };
const refuse = (reason: TransitionRefusal): PreconditionResult => ({ ok: false, reason });

const bySeq = (tasks: readonly TaskSnapshot[], seq: number): TaskSnapshot | undefined =>
  tasks.find((t) => t.seq === seq);

const allVerified = (tasks: readonly TaskSnapshot[]): boolean =>
  tasks.length > 0 && tasks.every((t) => t.state === "verified");

/**
 * The criterion's state after a transition, derived from the PROJECTED tasks.
 * Once a review has opened, an incomplete criterion is `returned` (a return is
 * in progress) and holds there until every task re-verifies; otherwise `active`.
 */
function nextCriterionState(prev: CriterionState, tasks: readonly TaskSnapshot[]): CriterionState {
  if (allVerified(tasks)) return "review_underway";
  return prev === "review_underway" || prev === "returned" ? "returned" : "active";
}

/** Apply a set of task state changes to the criterion's tasks (for projecting
 *  the post-transition state the criterion aggregate is derived from). Pure —
 *  returns a fresh array, never mutates the input snapshot. */
function applyChanges(
  tasks: readonly TaskSnapshot[],
  changes: readonly TaskStateChange[]
): TaskSnapshot[] {
  const m = new Map(changes.map((c) => [c.taskId, c.to]));
  return tasks.map((t) => (m.has(t.id) ? { ...t, state: m.get(t.id)! } : t));
}

/* --------------------------------------------------------------- the table */

export const TRANSITIONS: readonly TransitionRow[] = [
  /* locked → available (system): the predecessor verified, or this is the
   * criterion's first task. Freezes the band (first `available`). */
  {
    name: "unlock",
    scope: "task",
    from: "locked",
    to: "available",
    actor: "system",
    verifying: false,
    precondition: (ctx) => {
      const pred = bySeq(ctx.criterion.tasks, ctx.task.seq - 1);
      if (pred && pred.state !== "verified") return refuse("predecessor_unverified");
      return OK;
    },
    cascade: (ctx) => ({
      scope: "task",
      taskTo: "available",
      successors: [],
      criterionTo: nextCriterionState(
        ctx.criterion.state,
        applyChanges(ctx.criterion.tasks, [{ taskId: ctx.task.id, to: "available" }])
      ),
      awards: "none",
      notifications: [],
      // First `available` freezes the band; if already snapshotted, keep it.
      snapshotBand: ctx.task.snapshotBand ?? ctx.studentBand ?? null,
    }),
  },

  /* available → in_progress (student): opening or adding evidence (§9.1). Refused
   * while display-blocked by an unresolved earlier task (post-return). */
  {
    name: "open",
    scope: "task",
    from: "available",
    to: "in_progress",
    actor: "student",
    verifying: false,
    precondition: (ctx) =>
      isDisplayBlocked(ctx.task, ctx.criterion) ? refuse("display_blocked") : OK,
    cascade: (ctx) => ({
      scope: "task",
      taskTo: "in_progress",
      successors: [],
      criterionTo: ctx.criterion.state,
      awards: "none",
      notifications: [],
    }),
  },

  /* in_progress → submitted (student): refused while display-blocked, then the
   * math gate (T3) is consulted. */
  {
    name: "submit",
    scope: "task",
    from: "in_progress",
    to: "submitted",
    actor: "student",
    verifying: false,
    precondition: (ctx) => {
      if (isDisplayBlocked(ctx.task, ctx.criterion)) return refuse("display_blocked");
      const gate = submitGateStatus(ctx);
      return gate.open ? OK : refuse("gate_closed");
    },
    cascade: (ctx) => ({
      scope: "task",
      taskTo: "submitted",
      successors: [],
      criterionTo: ctx.criterion.state,
      awards: "none",
      // §13: evidence submitted → the parent is told (real-time, default).
      notifications: [{ audience: "parents", kind: "submitted" }],
    }),
  },

  /* submitted → in_progress (student): withdraw, legal only before review opens
   * (D6). `!reviewOpenedAt` treats null AND "" as "not opened". */
  {
    name: "withdraw",
    scope: "task",
    from: "submitted",
    to: "in_progress",
    actor: "student",
    verifying: false,
    precondition: (ctx) =>
      !ctx.task.reviewOpenedAt ? OK : refuse("review_already_opened"),
    cascade: (ctx) => ({
      scope: "task",
      taskTo: "in_progress",
      successors: [],
      criterionTo: ctx.criterion.state,
      awards: "none",
      notifications: [],
    }),
  },

  /* submitted → verified (adult): NO earlier task in the criterion may be
   * unverified (not merely the immediate predecessor — a multi-task return could
   * leave an earlier gap). Refuses `predecessor_unverified` — deliberately a
   * DIFFERENT reason from the student actions' `display_blocked`, though both
   * derive from `isDisplayBlocked`: this is the reviewer-facing "verify in order",
   * that is the student-facing "you can't work ahead". Unlocks the next task, or
   * opens the review when this was the last. */
  {
    name: "verify",
    scope: "task",
    from: "submitted",
    to: "verified",
    actor: "adult",
    verifying: true,
    precondition: (ctx) =>
      isDisplayBlocked(ctx.task, ctx.criterion) ? refuse("predecessor_unverified") : OK,
    cascade: (ctx) => {
      const next = bySeq(ctx.criterion.tasks, ctx.task.seq + 1);
      const successors: TaskStateChange[] =
        next && next.state === "locked" ? [{ taskId: next.id, to: "available" }] : [];
      const projected = applyChanges(ctx.criterion.tasks, [
        { taskId: ctx.task.id, to: "verified" },
        ...successors,
      ]);
      const criterionTo = nextCriterionState(ctx.criterion.state, projected);
      const notifications: NotificationIntent[] = [{ audience: "student", kind: "verified" }];
      if (criterionTo === "review_underway") {
        notifications.push({ audience: "student", kind: "review_underway" });
      }
      return {
        scope: "task",
        taskTo: "verified",
        successors,
        criterionTo,
        awards: "none",
        notifications,
      };
    },
  },

  /* submitted → not_yet (adult): requires a note (§9.1). Evidence stays intact. */
  {
    name: "not_yet",
    scope: "task",
    from: "submitted",
    to: "not_yet",
    actor: "adult",
    verifying: true,
    precondition: (ctx) =>
      ctx.note && ctx.note.trim() !== "" ? OK : refuse("note_required"),
    cascade: (ctx) => ({
      scope: "task",
      taskTo: "not_yet",
      successors: [],
      criterionTo: nextCriterionState(
        ctx.criterion.state,
        applyChanges(ctx.criterion.tasks, [{ taskId: ctx.task.id, to: "not_yet" }])
      ),
      awards: "none",
      notifications: [{ audience: "student", kind: "not_yet" }],
    }),
  },

  /* not_yet → in_progress (student): the student resumes; evidence intact.
   * Refused while display-blocked by an unresolved earlier task. */
  {
    name: "resume",
    scope: "task",
    from: "not_yet",
    to: "in_progress",
    actor: "student",
    verifying: false,
    precondition: (ctx) =>
      isDisplayBlocked(ctx.task, ctx.criterion) ? refuse("display_blocked") : OK,
    cascade: (ctx) => ({
      scope: "task",
      taskTo: "in_progress",
      successors: [],
      criterionTo: ctx.criterion.state,
      awards: "none",
      notifications: [],
    }),
  },

  /* verified → not_yet (adult): revoke, ONLY by the original verifier (§9.5).
   * Later verified tasks stay verified but are display-blocked (derived) — never
   * relocked. `!actorId` and a null `verifiedBy` both fail closed. */
  {
    name: "revoke",
    scope: "task",
    from: "verified",
    to: "not_yet",
    actor: "adult",
    verifying: true,
    precondition: (ctx) => {
      // §9.5: revocation is legal only until the criterion review clears. In T1 a
      // criterion never reaches `cleared` (that ceremony is T2), so there is no
      // clear-state guard to write yet — T2 adds `cleared` to CriterionState and a
      // guard here refusing it.
      // `.trim()` fails closed on a whitespace-only id, so two blank identities
      // from an upstream auth slip can never read as "the same verifier".
      if (
        !ctx.actorId?.trim() ||
        !ctx.task.verifiedBy?.trim() ||
        ctx.actorId !== ctx.task.verifiedBy
      ) {
        return refuse("not_original_verifier");
      }
      return OK;
    },
    cascade: (ctx) => ({
      scope: "task",
      taskTo: "not_yet",
      successors: [],
      criterionTo: nextCriterionState(
        ctx.criterion.state,
        applyChanges(ctx.criterion.tasks, [{ taskId: ctx.task.id, to: "not_yet" }])
      ),
      awards: "provisional", // D23 — provisional, never withdrawn.
      notifications: [{ audience: "student", kind: "reopened" }],
    }),
  },

  /* review_underway → returned (adult): the criterion-review "returned" outcome
   * (§9.3). Named tasks flip to not_yet; ids must all be members of the criterion
   * so a stale/garbage list can't flip the criterion to `returned` with nothing
   * actually reverted. Later verified tasks stay verified but display-blocked. */
  {
    name: "criterion_return",
    scope: "criterion",
    from: "review_underway",
    to: "returned",
    actor: "adult",
    verifying: true,
    precondition: (ctx) => {
      const ids = ctx.returnedTaskIds ?? [];
      if (ids.length === 0) return refuse("nothing_to_return");
      const known = new Set(ctx.criterion.tasks.map((t) => t.id));
      if (!ids.every((id) => known.has(id))) return refuse("unknown_returned_task");
      if (!ctx.note || ctx.note.trim() === "") return refuse("note_required");
      return OK;
    },
    cascade: (ctx) => {
      const returned = new Set(ctx.returnedTaskIds ?? []);
      const successors: TaskStateChange[] = ctx.criterion.tasks
        .filter((t) => returned.has(t.id))
        .map((t) => ({ taskId: t.id, to: "not_yet" as TaskState }));
      return {
        scope: "criterion",
        // No taskTo — criterion scope; the applier writes only successors + aggregate.
        successors,
        // Derived, not hardcoded: a validated non-empty return always yields
        // `returned`, and this stays correct if the projection ever changes.
        criterionTo: nextCriterionState(
          ctx.criterion.state,
          applyChanges(ctx.criterion.tasks, successors)
        ),
        awards: "provisional", // D23
        notifications: [{ audience: "student", kind: "criterion_returned" }],
      };
    },
  },

  /* review_underway → returned (adult), PHASE scope: the phase-review "returned"
   * outcome (§9.4) reopens named criteria. Phase review is T2 (no T1 trigger);
   * modeled here because the plan requires the table to name phase_return. A
   * phase-scope call with `ctx.phase` omitted fails closed in path-rules.ts. See
   * caller obligation #6: this row cannot validate criterion membership (a
   * PhaseSnapshot has no criterion list), so T2 must add that before wiring it. */
  {
    name: "phase_return",
    scope: "phase",
    from: "review_underway",
    to: "returned",
    actor: "adult",
    verifying: true,
    precondition: (ctx) => {
      const ids = ctx.returnedCriterionIds ?? [];
      if (ids.length === 0) return refuse("nothing_to_return");
      // Membership guard, mirrored from criterion_return: a stale/garbage id can't
      // flip the phase to `returned` with no real criterion reopened.
      const known = new Set(ctx.phase?.criterionIds ?? []);
      if (!ids.every((id) => known.has(id))) return refuse("unknown_returned_criterion");
      return OK;
    },
    cascade: (ctx) => {
      const reopened = new Set(ctx.returnedCriterionIds ?? []);
      const criterionTo: CriterionState = reopened.has(ctx.criterion.id)
        ? "returned"
        : ctx.criterion.state;
      return {
        scope: "phase",
        // No taskTo — phase scope.
        successors: [],
        criterionTo,
        phaseTo: "returned",
        awards: "provisional", // D23
        notifications: [{ audience: "student", kind: "phase_returned" }],
      };
    },
  },
] as const;
