"use server";

/**
 * The Path criterion-review ceremony action (T1 Unit 12, §9.3): a reviewing
 * adult RETURNS an in-review criterion, naming the tasks to redo and why. Same
 * canon as `applyTransition`: gate → zod → authorize → decide with the pure
 * engine → mutate via the service-role RPC → interpret the echo → typed result.
 * The body never throws from its own logic; `requirePathUser` may `redirect()`
 * (clients wrap in try/catch/finally).
 *
 * The decide is ATTEMPT-BASED, not a simple CAS on a task row (the Unit 8
 * carry-forward): `return_path_criterion` targets the exact (student,
 * criterion, attempt) row the reviewer saw, only while review_underway, under
 * the same advisory lock `path_maybe_open_review` takes — so a decide can
 * never interleave with an open, and at most one review_underway row per
 * criterion can exist (the maybeSingle invariant Unit 8 asked this unit to
 * confirm holds through the return/reopen path).
 *
 * Two-parent race: first decide wins; the loser sees the winner's identity and
 * time (`superseded`), never an error. A reviewer whose view predates a whole
 * return/re-complete cycle sees `stale_review` — refresh to truth.
 *
 * NOTE: the export list here is ACTIONS ONLY (the use-server-type-reexport
 * learning): `CriterionReturnActionResult` lives in progress-core.ts and is
 * imported, exactly as transition.ts imports `TransitionResult`.
 */

import { z } from "zod";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveActorRole } from "@/app/path/lib/access-rules";
import { evaluateTransition } from "@/app/path/lib/path-rules";
import {
  interpretReturnEcho,
  type CriterionReturnActionResult,
} from "@/app/path/lib/progress-core";
import {
  loadCriterionSnapshot,
  loadStudentContext,
  returnCriterion,
  type StudentContext,
} from "@/app/path/lib/progress-loader";
import { latestCriterionReview, notifyCriterionReturned } from "@/app/path/lib/notify/send";
import type { CriterionSnapshot, CriterionState, TransitionCtx } from "@/app/path/lib/transition-table";

const returnSchema = z.object({
  studentId: z.uuid(),
  criterionId: z.string().regex(/^\d+\.\d+$/),
  /** The attempt the reviewer SAW — the decide targets exactly this row. */
  attempt: z.number().int().min(1),
  returnedTaskIds: z.array(z.string().regex(/^\d+\.\d+\.\d+$/)).min(1).max(10),
  note: z.string().trim().min(1).max(2000),
});

/** Narrow a review-row state string into the criterion-state the engine reads;
 *  anything unrecognized (cleared is T2) maps to `active`, whose from-match
 *  then refuses — fail closed, never a guessed legality. */
function criterionStateFromReview(state: string | null): CriterionState {
  return state === "review_underway" || state === "returned" ? state : "active";
}

export async function applyCriterionReturn(input: unknown): Promise<CriterionReturnActionResult> {
  const { userId, grants } = await requirePathUser();

  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { studentId, criterionId, attempt, returnedTaskIds, note } = parsed.data;

  const db = supabaseAdmin();

  let student: StudentContext | null;
  let criterion: CriterionSnapshot;
  let review;
  try {
    student = await loadStudentContext(db, studentId);
    if (!student) return { ok: false, reason: "not_found" };
    criterion = await loadCriterionSnapshot(db, student, criterionId);
    review = await latestCriterionReview(db, studentId, criterionId);
  } catch (e) {
    console.error(`[path/review] load failed for ${studentId}/${criterionId}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  // Authorize from the AUTHORITATIVE profile ids; only an adult reviews.
  const actorRole = resolveActorRole({
    grants,
    target: {
      kind: "profile",
      studentId: student.studentId,
      familyId: student.familyId,
      cohortId: student.cohortId,
    },
  });
  if (actorRole === null) return { ok: false, reason: "forbidden" };

  if (!review) return { ok: false, reason: "not_found" }; // no review has ever opened
  if (review.attempt !== attempt) return { ok: false, reason: "stale_review" };
  if (review.state === "returned") {
    // The exact attempt the reviewer saw was already returned — idempotent
    // success by the OTHER decider (actor is already authorized above; mirrors
    // applyTransition's already_in_target_state path). The pre-read carries
    // the winner's identity and time, so this branch reports the SAME shape
    // as the raced-decide path below — never a timestamp-less "just now".
    return {
      ok: true,
      byCaller: false,
      winner: { decidedBy: review.decidedBy ?? null, decidedAt: review.decidedAt ?? null },
    };
  }

  // Decide legality with the pure engine (note, membership, actor class). The
  // criterion state comes from the REVIEW row, not the placeholder "active".
  if (criterion.tasks.length === 0) return { ok: false, reason: "unavailable" };
  const ctx: TransitionCtx = {
    actorRole,
    actorId: userId,
    task: criterion.tasks[0], // criterion-scope rows never read/write the task
    criterion: { ...criterion, state: criterionStateFromReview(review.state) },
    note,
    returnedTaskIds: [...returnedTaskIds],
  };
  const decision = evaluateTransition("criterion_return", ctx);
  if (!decision.ok) {
    if (decision.reason === "actor_not_permitted") return { ok: false, reason: "forbidden" };
    if (decision.reason === "note_required") return { ok: false, reason: "note_required" };
    if (decision.reason === "unknown_returned_task") return { ok: false, reason: "unknown_returned_task" };
    if (decision.reason === "nothing_to_return") return { ok: false, reason: "nothing_to_return" };
    // no_such_transition here means the criterion is not in review.
    return { ok: false, reason: "not_in_review" };
  }

  const echo = await returnCriterion(db, {
    studentId,
    criterionId,
    attempt,
    returnedTaskIds,
    actor: userId,
    note,
  });

  if (echo === undefined) {
    // "An errored response is not proof the write failed" — re-read once. If
    // the attempt row is now returned we report success, but byCaller:false —
    // we cannot prove OUR decide did it.
    const reread = await latestCriterionReview(db, studentId, criterionId);
    if (reread && reread.attempt === attempt && reread.state === "returned") {
      return { ok: true, byCaller: false };
    }
    return { ok: false, reason: "unavailable" };
  }

  const outcome = interpretReturnEcho(echo, attempt);
  switch (outcome.kind) {
    case "applied": {
      // Enqueue + flag the student-facing notification trail (in-app event,
      // supersede of the reopened celebrations). Never throws; cron heals.
      // `review.id` is the decided attempt row (the decide is attempt-based,
      // targeting exactly the pre-read row) — no non-null assertion needed.
      await notifyCriterionReturned(db, {
        review: {
          id: review.id,
          studentId,
          scope: "criterion",
          scopeId: criterionId,
          attempt,
          state: "returned",
          note,
          decidedAt: echo?.decidedAt ?? new Date().toISOString(),
        },
        returnedTaskIds,
      });
      return { ok: true, byCaller: true };
    }
    case "superseded":
      return { ok: true, byCaller: false, winner: { decidedBy: outcome.decidedBy, decidedAt: outcome.decidedAt } };
    case "stale":
      return { ok: false, reason: "stale_review" };
    case "retry":
      return { ok: false, reason: "retry" };
    case "not_found":
      return { ok: false, reason: "not_found" };
  }
}
