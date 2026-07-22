/**
 * The Path progress engine (T1 Unit 7) — pure decision logic over the
 * transition table. This is the heart of the product and the only part this
 * repo's node-only test setup can genuinely defend, so every reachable branch is
 * tested (two branches are forward-compat seams for T2/T3 — `gate_closed` via
 * `ctx.submitGate`, and §9.5's post-clear guard — and are covered as such).
 *
 * Two responsibilities:
 *   1. `evaluateTransition` — apply the table to a materialised context: state
 *      match, R6 / actor gate, precondition, then the declarative cascade.
 *      Returns a typed verdict, NEVER throws (a refused transition is data, not
 *      an exception).
 *   2. Resolve every task / criterion lookup through the STUDENT'S PINNED
 *      program version (D27) via `getProgram(versionId)` — never a "current" or
 *      "latest" global. Publishing a newer version is invisible to a pinned
 *      student, exactly as a staff grade correction is invisible to an in-review
 *      task. An unknown version throws (from `getProgram`); it never falls back.
 *
 * See `transition-table.ts` for the CALLER OBLIGATIONS this pure layer trusts
 * (server-derived actor identity, authoritative/complete snapshots, atomic
 * application of the cascade).
 *
 * PURE: no next / supabase / react imports. The only side effect a caller must
 * have arranged is importing the pinned version's generated module, so
 * `getProgram` can resolve it (Unit 3's barrel note).
 */

import { getProgram } from "@/app/path/content/manifest";
import type { Band, DeepReadonly, ProgramContent } from "@/app/path/content/types";

import {
  TRANSITIONS,
  type CascadeEffect,
  type CriterionState,
  type PhaseState,
  type TaskSnapshot,
  type TaskState,
  type TransitionCtx,
  type TransitionName,
  type TransitionRefusal,
} from "./transition-table";

// Re-exported here as the engine's read API; defined in transition-table.ts so
// the table's own preconditions can consult them without a circular import.
export { isDisplayBlocked, isSubmittable } from "./transition-table";

export type TransitionOutcome =
  | { ok: true; to: TaskState | CriterionState | PhaseState; cascade: CascadeEffect }
  | { ok: false; reason: TransitionRefusal };

/* ---------------------------------------------------------- the evaluator */

/**
 * The one scope-state a row reads for its `from`. Each transition name maps to
 * exactly one row, so the name determines the scope (asserted by a table test).
 * Returns `undefined` for a phase-scope transition whose `ctx.phase` is missing,
 * so the guard below FAILS CLOSED (no_such_transition) rather than defaulting to
 * a legal state that happens to match the only phase-scope row's `from`.
 */
function currentStateForScope(
  scope: "task" | "criterion" | "phase",
  ctx: TransitionCtx
): string | undefined {
  if (scope === "task") return ctx.task.state;
  if (scope === "criterion") return ctx.criterion.state;
  return ctx.phase?.state; // undefined when omitted → fails the from-match, closed
}

/**
 * Evaluate a requested transition against the table. Order matters and mirrors
 * the plan's layering: existence → state match → R6 → actor class → precondition
 * → cascade. R6 is checked BEFORE the generic actor-class match so a student
 * attempting a verifying transition always reports `actor_not_permitted` for the
 * R6 reason, not an incidental class mismatch.
 */
export function evaluateTransition(name: TransitionName, ctx: TransitionCtx): TransitionOutcome {
  const row = TRANSITIONS.find((r) => r.name === name);
  if (!row) return { ok: false, reason: "no_such_transition" };

  const current = currentStateForScope(row.scope, ctx);
  if (current !== row.from) {
    // Distinguish "ahead" (already AT the target — idempotent no-op) from
    // "behind"/inapplicable, so Unit 8's echo interpretation can adopt the DB
    // value on the ahead case instead of looping (coerce-not-raise / three-way
    // echo doc). A missing phase (current === undefined) is never the target.
    if (current !== undefined && current === row.to) {
      return { ok: false, reason: "already_in_target_state" };
    }
    return { ok: false, reason: "no_such_transition" };
  }

  // R6 (belt): a student may never drive a verifying transition, whatever the
  // client posts. Enumerated across the whole table by the tests.
  if (row.verifying && ctx.actorRole === "student") {
    return { ok: false, reason: "actor_not_permitted" };
  }

  // Actor class (suspenders): exact match. `student` rows reject `adult` because
  // a parent acting for a young child does so in the CHILD'S session (→ student);
  // an adult in their own session has no business driving the child's own steps.
  if (ctx.actorRole !== row.actor) {
    return { ok: false, reason: "actor_not_permitted" };
  }

  const pre = row.precondition(ctx);
  if (!pre.ok) return { ok: false, reason: pre.reason };

  return { ok: true, to: row.to, cascade: row.cascade(ctx) };
}

/* ------------------------------------------------------------ band snapshot */

/**
 * The band a task's variant renders under. The snapshot taken at first
 * `available` wins; a later `StudentProfile.band` change (a birthday, a
 * re-assessment) never moves an already-available task's variant — the same
 * "snapshot so a correction can't move a child's bar mid-flight" rule as the
 * review status. Falls back to the live band only before the snapshot exists.
 */
export function effectiveBand(task: TaskSnapshot, studentBand: Band): Band {
  return task.snapshotBand ?? studentBand;
}

/* ---------------------------------------- version-pinned content resolution */

type CriterionContent = DeepReadonly<ProgramContent>["phases"][number]["criteria"][number];

/** Find a criterion in the PINNED program (D27). Throws if the version has no
 *  such criterion — a pinned lookup that misses is a bug, never a silent empty. */
function findCriterion(versionId: string, criterionId: string): CriterionContent {
  const program = getProgram(versionId); // throws on unknown version (never "latest")
  for (const phase of program.phases) {
    const criterion = phase.criteria.find((c) => c.id === criterionId);
    if (criterion) return criterion;
  }
  throw new Error(
    `Criterion "${criterionId}" not found in program version "${versionId}". ` +
      `A pinned lookup must resolve or throw — never fall back to another version.`
  );
}

/** The task ids of a criterion, seq order, from the pinned version. */
export function criterionTaskIds(versionId: string, criterionId: string): string[] {
  return findCriterion(versionId, criterionId).tasks.map((t) => t.id);
}

/**
 * The id of the task whose verification opens the criterion review — the task
 * flagged `completesCriterion` (§9.3 trigger). For 2.3 that is the SIXTH task,
 * not the fifth; resolving through the pinned version is what makes the engine
 * agnostic to the fact that criteria have variable task counts.
 */
export function reviewTriggerTaskId(versionId: string, criterionId: string): string {
  const criterion = findCriterion(versionId, criterionId);
  const closer = criterion.tasks.find((t) => t.completesCriterion);
  if (!closer) {
    throw new Error(
      `Criterion "${criterionId}" in version "${versionId}" has no task flagged ` +
        `completesCriterion — the manifest validation should have caught this.`
    );
  }
  return closer.id;
}
