"use server";

/**
 * The Path task-transition Server Action (T1 Unit 8). Same canon as the CRM
 * actions: gate → zod → authorize → decide → mutate via the service-role RPC →
 * interpret → typed result.
 *
 * Throw posture: this body NEVER throws from its own logic. Two externally-caused
 * throws are handled explicitly — `requirePathUser` may `redirect()` (a Next
 * control-flow throw a client caller still wraps in try/catch/finally), and the
 * loaders throw on a DB error / corrupt row / unresolved criterion, which this
 * action CATCHES and maps to a typed `unavailable`/`not_found`. So a caller only
 * ever sees a `TransitionResult` (plus the auth redirect).
 *
 * The layering, all defended by tests one layer down:
 *   - `requirePathUser` (auth.ts)        — who is calling (session + grants)
 *   - `resolveActorRole` (access-rules)  — student vs adult, from the grants
 *   - `evaluateTransition` (path-rules)  — is the transition LEGAL (R6, D6, …)
 *   - `move_path_task` (RPC)             — apply it ATOMICALLY (CAS, audit, cascade)
 *   - `resultForEcho` (progress-core)    — the CAS echo → client result
 *
 * No caller exists yet (the surfaces are Units 14–16); this establishes the
 * contract they consume.
 */

import { z } from "zod";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveActorRole } from "@/app/path/lib/access-rules";
import { evaluateTransition } from "@/app/path/lib/path-rules";
import {
  criterionIdOf,
  interpretEcho,
  isTaskTransition,
  resultForEcho,
  TASK_TRANSITIONS,
  transitionTarget,
  type TransitionResult,
} from "@/app/path/lib/progress-core";
import {
  loadCriterionSnapshot,
  loadStudentContext,
  moveTask,
  type StudentContext,
} from "@/app/path/lib/progress-loader";
import { notifyAfterTransition } from "@/app/path/lib/notify/send";
import type { CriterionSnapshot, TransitionCtx } from "@/app/path/lib/transition-table";

// NOTE: no `export type { TransitionResult }` here. This is a `"use server"`
// file, and even a TYPE re-export gets a registerServerReference() emitted for
// it by the use-server transform — the module then throws "TransitionResult is
// not defined" at load and takes every Path action down with it (found live in
// Unit 14's first mount). Import the type from progress-core instead.

const transitionSchema = z.object({
  studentId: z.uuid(),
  taskId: z.string().regex(/^\d+\.\d+\.\d+$/),
  // The enumerable set, so an invalid transition is a parse-time refusal and the
  // schema self-documents the valid moves for a future tool wrapper.
  transition: z.enum(TASK_TRANSITIONS),
  note: z.string().trim().max(2000).optional(),
  /** Client-supplied, skew-clamped submit time (Unit 11's offline queue). */
  submittedAt: z.iso.datetime({ offset: true }).optional(),
});

export async function applyTransition(input: unknown): Promise<TransitionResult> {
  // Gate: every Server Function verifies auth itself — the proxy matcher does not
  // reliably cover Server Actions (Next 16).
  const { userId, grants } = await requirePathUser();

  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { studentId, taskId, transition, note, submittedAt } = parsed.data;

  // `z.enum` already narrowed it, but keep the guard as the single source of the
  // task-vs-ceremony boundary (criterion/phase return are Unit 12).
  if (!isTaskTransition(transition)) return { ok: false, reason: "unknown_transition" };

  const db = supabaseAdmin();

  let student: StudentContext | null;
  let criterion: CriterionSnapshot;
  try {
    student = await loadStudentContext(db, studentId);
    if (!student) return { ok: false, reason: "not_found" };
    // A syntactically-valid but nonexistent criterion/task, or a corrupt row,
    // throws in the loader — caught here as a typed result, never a 500.
    criterion = await loadCriterionSnapshot(db, student, criterionIdOf(taskId));
  } catch (e) {
    console.error(`[path/transition] load failed for ${studentId}/${taskId}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  const task = criterion.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, reason: "not_found" };

  // Authorize AND classify the actor from the AUTHORITATIVE profile ids (never a
  // client field): a student drives student transitions on their own tasks, a
  // parent/guide the adult ones; a sibling (or stranger) resolves to null.
  const actorRole = resolveActorRole({
    grants,
    target: { kind: "profile", studentId: student.studentId, familyId: student.familyId, cohortId: student.cohortId },
  });
  if (actorRole === null) return { ok: false, reason: "forbidden" };

  // Decide legality with the pure engine. `decision.cascade` (successors,
  // criterionTo, notifications, awards) is intentionally NOT applied here — the
  // atomic RPC owns the cascade (Decision 5); Units 12/16 consume the notification
  // intents. Only the ok/refuse verdict is read.
  const ctx: TransitionCtx = {
    actorRole,
    actorId: userId,
    task,
    criterion,
    note: note ?? null,
    studentBand: student.band,
  };
  const decision = evaluateTransition(transition, ctx);
  if (!decision.ok) {
    // A replay of an already-applied transition (offline queue, or a fresh
    // re-read that already shows the target) is idempotent success, not an error
    // — the actor is already authorized (above) and there is nothing to do.
    if (decision.reason === "already_in_target_state") {
      return { ok: true, state: task.state, byCaller: false };
    }
    return { ok: false, reason: decision.reason };
  }

  // Apply atomically. `expectedFrom` is the snapshot state — the CAS predicate.
  const echo = await moveTask(db, {
    studentId,
    taskId,
    transition,
    expectedFrom: task.state,
    actor: userId, // student/adult both carry the caller's own auth id
    actorRole,
    band: student.band,
    submittedAt: submittedAt ?? null,
    note: note ?? null,
  });

  if (echo === null) {
    // "An errored response is not proof the write failed" — re-read once. If the
    // target is now reached we report success, but byCaller:FALSE — we could not
    // prove OUR CAS did it (a concurrent actor may have), so we never misattribute.
    let now;
    try {
      const reread = await loadCriterionSnapshot(db, student, criterionIdOf(taskId));
      now = reread.tasks.find((t) => t.id === taskId);
    } catch (e) {
      console.error(`[path/transition] re-read failed for ${studentId}/${taskId}:`, e);
      return { ok: false, reason: "unavailable" };
    }
    if (now && now.state === transitionTarget(transition)) {
      return { ok: true, state: now.state, byCaller: false };
    }
    return { ok: false, reason: "unavailable" };
  }

  const result = resultForEcho(interpretEcho({ from: task.state, to: transitionTarget(transition) }, echo), {
    transition,
    actorId: userId,
  });

  // Unit 12: durable notification. Derived from the authoritative event row the
  // RPC just appended (never the engine's stale cascade projection), enqueued
  // idempotently, and attempted inline for real-time delivery; the cron heals
  // anything this drops. Only when OUR CAS provably wrote — a superseded
  // caller's winner already enqueued the identical plan (same dedupe keys).
  // Never throws; a notification failure must never fail the transition.
  if (result.ok && result.byCaller) {
    await notifyAfterTransition(db, {
      studentId,
      familyId: student.familyId,
      programVersionId: student.programVersionId,
      taskId,
      criterionId: criterionIdOf(taskId),
      transition,
    });
  }

  return result;
}
