"use server";

/**
 * The FW offline-drain Server Action (FW Unit 8) — the same canon as every other
 * FW action: gate → zod → authorize → delegate to the tested core → typed result.
 *
 * DELIBERATELY THIN. The reduce × same-actor-guard × replay × reject fold — the
 * part both adversarial reviews found bugs in — lives in `fw-sync-engine.ts`'s
 * `runFwDrain`, driven by a fake-Supabase harness. This file only:
 *   1. re-authenticates the session (Decision 14 — a silent cookie refresh keeps
 *      it; a truly-expired session returns `no_session` and the client prompts the
 *      SAME guide, never auth-redirecting the cached shell);
 *   2. SCOPES the queue to the session's own captures, so a replay can never stamp
 *      one guide's tap under another's session (block-until-drained keeps the
 *      device with its guide, so this is normally a no-op, but the author the
 *      same-actor guard reads must never be forgeable);
 *   3. resolves, per distinct cohort, whether the session may still act there — a
 *      revoked grant drops the cohort from `authorizedCohortIds`, and `runFwDrain`
 *      records every entry for it as a `reauth_failed` reject SERVER-SIDE (the
 *      whole point of not leaving it on the possibly-revoked guide's device).
 *
 * No type is exported from this `"use server"` file — a type re-export registers a
 * server reference that throws at load. `FwSyncActionResult` and `FwDrainOutcome`
 * are imported from the plain core the client also reads.
 */

import { z } from "zod";

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { loadFwSession, resolveFwActorForCohort } from "@/app/path/lib/fw-auth";
import { runFwDrain, type FwSyncActionResult } from "@/app/path/lib/fw-sync-engine";
import type { FwQueueEntry } from "@/app/path/lib/fw-sync-rules";
import { FW_ACTIONS } from "@/app/path/lib/fw-rules";

const entrySchema = z.object({
  id: z.string().min(1).max(200),
  schemaVersion: z.number(),
  clientId: z.string().min(1).max(200),
  actionId: z.uuid(),
  studentId: z.uuid(),
  taskId: z.string().regex(/^\d+\.\d+\.\d+$/),
  action: z.enum(FW_ACTIONS),
  cohortId: z.uuid(),
  capturedAt: z.iso.datetime({ offset: true }),
  actorUserId: z.uuid(),
  enqueuedAt: z.iso.datetime({ offset: true }),
  attempts: z.number(),
  lastAttemptAt: z.string().nullable(),
  // The client never ships a blocked entry (they are excluded from the drain), but
  // the shape is accepted and ignored rather than rejected on a stray field.
  blocked: z.unknown().nullable().optional(),
});

// Bounded: a 20-minute outage for one guide is a few dozen taps; a payload far past
// that is a malformed drain, refused before it reaches a membership read.
const drainSchema = z.array(entrySchema).max(500);

export async function drainFwQueue(input: unknown): Promise<FwSyncActionResult> {
  const parsed = drainSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };

  // Re-auth at drain (Decision 14). `loadFwSession` uses `getUser()`, which is
  // revocation-sensitive and triggers Supabase's silent token refresh; a genuinely
  // expired session returns null here and the client re-prompts the same guide.
  const session = await loadFwSession();
  if (!session) return { ok: false, reason: "no_session" };

  // Scope to THIS session's own captures — the author the same-actor guard reads
  // must equal the session that stamps the replay, and that identity is only true
  // for the guide's own taps. Rebuilt from validated fields into clean entries
  // (blocked normalized to null — a blocked entry is never drained), so the drain
  // receives narrowed values, never a bare cast of an unchecked payload.
  const entries: FwQueueEntry[] = parsed.data
    .filter((e) => e.actorUserId === session.userId)
    .map((e) => ({
      id: e.id,
      schemaVersion: e.schemaVersion,
      clientId: e.clientId,
      actionId: e.actionId,
      studentId: e.studentId,
      taskId: e.taskId,
      action: e.action,
      cohortId: e.cohortId,
      capturedAt: e.capturedAt,
      actorUserId: e.actorUserId,
      enqueuedAt: e.enqueuedAt,
      attempts: e.attempts,
      lastAttemptAt: e.lastAttemptAt,
      blocked: null,
    }));
  if (entries.length === 0) return { ok: true, outcomes: [] };

  // One authorization resolution per distinct cohort (a guide works one weekend, so
  // this is normally a single resolve; request-memoized regardless).
  const cohortIds = [...new Set(entries.map((e) => e.cohortId))];
  const authorizedCohortIds: string[] = [];
  for (const cohortId of cohortIds) {
    const { verdict } = await resolveFwActorForCohort(cohortId);
    if (verdict.ok) authorizedCohortIds.push(cohortId);
  }

  const { outcomes } = await runFwDrain(supabaseAdmin(), {
    entries,
    sessionUserId: session.userId,
    authorizedCohortIds,
    now: Date.now(),
  });

  return { ok: true, outcomes };
}
