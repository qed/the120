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

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { fwRead, withFwTimeout } from "@/app/path/lib/fw-call";
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
  // this is normally a single resolve; request-memoized regardless). TRI-STATE, so a
  // transient auth-read blip is never mistaken for a revoke: `authorized` replays,
  // `unknown` retries, and a cohort in neither is a genuine revoke that rejects.
  const db = supabaseAdmin();
  const cohortIds = [...new Set(entries.map((e) => e.cohortId))];
  const authorizedCohortIds: string[] = [];
  const unknownCohortIds: string[] = [];
  for (const cohortId of cohortIds) {
    // Bound the resolution: it runs inside the client's Web Lock, so an unguarded
    // hang here would wedge the single-drainer (reliability P1b). A timeout is
    // treated as UNKNOWN — retry, never a permanent reject.
    const raced = await withFwTimeout(resolveFwActorForCohort(cohortId), `fw drain authz (${cohortId})`);
    if (raced.timedOut) {
      unknownCohortIds.push(cohortId);
      continue;
    }
    const { verdict } = raced.value;
    if (verdict.ok) {
      authorizedCohortIds.push(cohortId);
      continue;
    }
    if (verdict.reason === "no_session") return { ok: false, reason: "no_session" };
    // A refusal collapses "genuinely unauthorized" and "the auth read failed" into
    // one verdict. Probe DB reachability: if the probe ALSO fails, the refusal was a
    // blip → UNKNOWN (retry). If the probe succeeds, the refusal was genuine → a
    // revoke that rejects (reliability review's data-loss P1 — on venue wifi a blip
    // must never discard a guide's real captures to a staff-only reject).
    if (!(await probeCohortReadable(db, cohortId))) unknownCohortIds.push(cohortId);
  }

  const { outcomes } = await runFwDrain(db, {
    entries,
    sessionUserId: session.userId,
    authorizedCohortIds,
    unknownCohortIds,
    now: Date.now(),
  });

  return { ok: true, outcomes };
}

/** Whether the cohort row can be READ right now — a proxy for "was the earlier
 *  authorization refusal genuine, or a transient blip?" A successful read (row or
 *  not) means the DB was reachable, so the refusal stands; a read error means the
 *  auth reads likely blipped too, and the cohort's entries should retry. */
async function probeCohortReadable(db: SupabaseClient, cohortId: string): Promise<boolean> {
  const res = await fwRead(
    () => db.from("path_cohorts").select("id").eq("id", cohortId).maybeSingle(),
    `fw drain authz probe (${cohortId})`
  );
  return !res.error;
}
