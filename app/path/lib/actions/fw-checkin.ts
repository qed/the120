"use server";

/**
 * The FW check-in Server Action (FW Unit 3) — the same canon as every other
 * action in this repo: gate → zod → authorize → decide (pure) → mutate via the
 * service-role RPC → interpret → typed result.
 *
 * This file is DELIBERATELY THIN. The repo cannot unit-test a `"use server"`
 * module (it imports `next/headers`, which does not run outside the Next
 * runtime), and Unit 2 shipped a P1 that lived in exactly that blind spot. So
 * every decision below is either a one-line delegation to a tested module or a
 * mapping so mechanical that reading it is the test:
 *
 *   - `resolveFwActorForCohort` (fw-auth.ts)   — may this caller act HERE
 *   - `runFwCheckIn`            (fw-checkin-core.ts) — the whole write path
 *   - `fw-rules.ts`                            — every rule either of them applies
 *
 * Throw posture: this body never throws from its own logic and returns a typed
 * refusal for everything else. `resolveFwActorForCohort` can redirect only via
 * `requireFwSession`, which this action does not call — a session-less caller
 * gets `no_session` back, because a Server Action redirect is a control-flow
 * throw the guide's iPad would have to catch mid-tap.
 *
 * No caller exists yet (the guide surface is Unit 4); this establishes the
 * contract it consumes.
 */

import { z } from "zod";

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveFwActorForCohort } from "@/app/path/lib/fw-auth";
import { runFwCheckIn, type FwCheckInActionResult } from "@/app/path/lib/fw-checkin-core";
import { FW_ACTIONS, FW_BATCH_MAX } from "@/app/path/lib/fw-rules";

// NOTE: no `export type { FwCheckInActionResult }` here — a type re-export from a
// "use server" file registers a server reference that throws at module load.
// Import it from fw-checkin-core instead.

const fwCheckInSchema = z.object({
  /** Decision 3: the cohort stamp is ALWAYS carried by the client and ALWAYS
   *  verified server-side. Never inferred — ambiguous for a returner who belongs
   *  to two — and never trusted, which is what makes this the IDOR seam. */
  cohortId: z.uuid(),
  taskId: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** The enumerable set, so an unknown action is a parse-time refusal rather
   *  than a `raise exception` from inside the RPC. */
  action: z.enum(FW_ACTIONS),
  /** Capped at the picker's own maximum so an oversized batch is refused before
   *  it reaches a membership query, not after. */
  studentIds: z.array(z.uuid()).min(1).max(FW_BATCH_MAX),
  /** Per-student exactly-once keys from the offline queue (Unit 8). Opaque
   *  strings, bounded so a malformed drain cannot post an unbounded key. */
  clientIds: z.record(z.uuid(), z.string().min(1).max(200)).optional(),
  /** Client capture time; clamped server-side against an untrusted device clock. */
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  /** Supplied only by a replay, so a batch captured offline still rings ONE bell
   *  on drain instead of one per student. */
  actionId: z.uuid().optional(),
});

export async function applyFwCheckIn(input: unknown): Promise<FwCheckInActionResult> {
  const parsed = fwCheckInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { cohortId, taskId, action, studentIds, clientIds, capturedAt, actionId } = parsed.data;

  // Gate: every Server Function verifies auth itself — the proxy matcher does not
  // reliably cover Server Actions (Next 16). This resolves the actor FOR THIS
  // COHORT, loading the cohort row authoritatively: `kind` is what makes the
  // FW-D3 staff bridge apply, so a client-supplied kind would let any staff-claim
  // holder declare a Path cohort "fw" and write cascade-free events into a real
  // Path student's record.
  const { verdict, session } = await resolveFwActorForCohort(cohortId);
  if (!verdict.ok) {
    return {
      ok: false,
      // `cohort_not_found`, `cohort_not_fw` and `not_a_guide` all collapse to one
      // answer on purpose: distinguishing them would tell a caller which cohort
      // ids are real and which are Founders Weekend.
      reason: verdict.reason === "no_session" ? "no_session" : "forbidden",
    };
  }

  // Everything decision-bearing happens in here, against a fake client in tests.
  return runFwCheckIn(supabaseAdmin(), {
    // The AUTHORITATIVE session id, never a client field: it is what lands in
    // `verified_by` and in every event's `actor`, and Unit 8's same-actor undo
    // guard reads that column to decide whether a replayed undo may apply.
    actorUserId: session.userId,
    cohortId,
    taskId,
    action,
    studentIds,
    clientIds,
    capturedAt: capturedAt ?? null,
    actionId,
    now: Date.now(),
  });
}
