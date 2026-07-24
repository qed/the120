/**
 * The FW offline drain — the db-taking CORE (FW Unit 8).
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the `db` argument cannot serialize) and no
 * `import "server-only"` (so `__tests__/fw-sync-engine.test.ts` can drive it under
 * a fake Supabase client, and `npm run fw` can drive it against production).
 * `actions/fw-sync.ts` is the `"use server"` shell that gates the session, resolves
 * per-cohort authorization, and calls this with the service-role client; `FwPwa.tsx`
 * is the page-context client that reads IndexedDB, ships the queue here through that
 * action, and applies the outcomes back to IndexedDB.
 *
 * ── Why the composition lives here, tested ────────────────────────────────────
 * Every FW unit so far shipped a P1 in a COMPOSITION whose halves were each correct
 * and each tested — the write-path race, the authorless undo guard, the credential
 * rotation. This unit's fold is the loudest of them: reduce × same-actor-guard ×
 * replay × reject, over an append-only log, at a live event. So it is a plain core
 * with a fake-Supabase + seeded-queue harness, and the two files around it hold
 * nothing decision-bearing.
 *
 * ── The fold, per (student, task) ─────────────────────────────────────────────
 *   1. authorization — a cohort the re-authed session may NOT act in rejects every
 *      entry `reauth_failed` (the revoked-guide drain: all rejects, none applied).
 *   2. reduce (pure) — cancel pairs; keep `undo + decision` corrections in order.
 *   3. guard — a LEADING surviving undo reads the server row's `verified_by`; a
 *      cross-actor correction rejects `cross_actor_undo`, none of it replays.
 *   4. replay — each surviving op through `runFwCheckIn` (the SOLE write choke
 *      point — anonymized-student exclusion and cohort-stamp verification still
 *      apply), IN ORDER, HALTING the rest of a group's ops the moment one does not
 *      settle (an undo that did not land must not let its follow-on decision fire).
 *   5. interpret — settled deletes; a terminal refusal rejects; a blip retries.
 * A cancelled pair settles without any server call at all.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { fwRead, fwWrite, isUniqueViolation } from "./fw-call";
import { runFwCheckIn } from "./fw-checkin-core";
import { fwReplayRejectReasonCopy } from "./fw-ops-rules";
import { narrowTaskState } from "./progress-core";
import {
  clampFwReplayCapturedAt,
  groupFwEntriesByStudentTask,
  interpretFwReplayResult,
  planFwStudentTask,
  reduceFwOps,
  type FwDrainOutcome,
  type FwQueueEntry,
  type FwRejectReason,
  type FwServerRow,
} from "./fw-sync-rules";

/* ══════════════════════════════════════════════════════════ the per-entry outcome ══ */

export type { FwDrainOutcome };

export type FwDrainInput = {
  /** The recognized, in-scope entries to drain — the client has already narrowed
   *  them through `isRecognizedFwEntry` and `selectFwDrainable`. */
  entries: readonly FwQueueEntry[];
  /** The re-authenticated session's user id — the author every replayed event is
   *  stamped with (Decision 14 re-auth is the SAME guide, so this equals the
   *  entries' `actorUserId`; the action verifies that before it ever gets here). */
  sessionUserId: string;
  /** Cohort ids the session may currently act in — their entries replay. */
  authorizedCohortIds: readonly string[];
  /** Cohorts whose authorization could NOT be resolved because an auth READ failed
   *  (a venue-wifi blip), as distinct from a genuine revoke. Their entries RETRY —
   *  they must never be permanently rejected on a transient read error, which on the
   *  exact operating condition this feature exists for would silently discard a
   *  guide's real captures to a staff-only reject (reliability review). A cohort that
   *  is in NEITHER set is a genuine revoke and rejects `reauth_failed`. */
  unknownCohortIds?: readonly string[];
  now: number;
};

export type FwDrainResult = { outcomes: FwDrainOutcome[] };

/**
 * What the `drainFwQueue` Server Action returns. Lives HERE, in the plain module,
 * because a TYPE re-export from a `"use server"` file emits a
 * `registerServerReference()` that throws at module load (the Path's Unit-14
 * lesson, and the reason `FwCheckInActionResult` lives in `fw-checkin-core`). The
 * client imports it from here, not from the action.
 *
 * `no_session` is Decision 14's re-auth signal: a silently-refreshed cookie keeps
 * the session; a truly-expired one returns this, and the client prompts the SAME
 * guide for their password rather than auth-redirecting the cached shell.
 */
export type FwSyncActionResult =
  | { ok: true; outcomes: FwDrainOutcome[] }
  | { ok: false; reason: "no_session" | "invalid_input" };

const settled = (e: FwQueueEntry): FwDrainOutcome => ({
  entryId: e.id,
  clientId: e.clientId,
  disposition: "settled",
});
const retry = (e: FwQueueEntry): FwDrainOutcome => ({
  entryId: e.id,
  clientId: e.clientId,
  disposition: "retry",
});
const rejected = (e: FwQueueEntry, reason: FwRejectReason): FwDrainOutcome => ({
  entryId: e.id,
  clientId: e.clientId,
  disposition: "rejected",
  reason,
  note: fwReplayRejectReasonCopy(reason),
});

/* ══════════════════════════════════════════════════════ the server-state read ══ */

/**
 * The current `path_task_progress` row for one (student, task) — the guard's ONLY
 * input, read solely for a leading surviving undo.
 *
 * TRI-STATE, like every FW read: `{ok:false}` on a read error (the drain then
 * RETRIES the group rather than guessing an author — a blip must never let a
 * cross-actor undo through on a fabricated "same actor"); `{ok:true, row:null}`
 * when there is genuinely no progress row (the RPC will report `missing`).
 */
export async function loadFwProgressRow(
  db: SupabaseClient,
  studentId: string,
  taskId: string
): Promise<{ ok: true; row: FwServerRow | null } | { ok: false }> {
  const res = await fwRead(
    () =>
      db
        .from("path_task_progress")
        .select("state, verified_by")
        .eq("student_id", studentId)
        .eq("task_id", taskId)
        .maybeSingle(),
    `progress read (${studentId}/${taskId})`
  );
  if (res.error) {
    console.error(`[fw/drain] progress read failed for ${studentId}/${taskId}: ${res.error.message}`);
    return { ok: false };
  }
  const row = res.data as { state?: unknown; verified_by?: unknown } | null;
  if (!row) return { ok: true, row: null };
  const state = narrowTaskState(row.state);
  if (state === null) {
    // A row that will not narrow is a shape drift, not a fact. Fail the READ
    // (retry) rather than fabricate a state the guard would trust.
    console.error(`[fw/drain] progress row for ${studentId}/${taskId} would not narrow its state`);
    return { ok: false };
  }
  return {
    ok: true,
    row: { state, verifiedBy: typeof row.verified_by === "string" ? row.verified_by : null },
  };
}

/* ══════════════════════════════════════════════════════════ the reject writer ══ */

/**
 * Record one reject in `path_fw_replay_rejects` — server-side, staff-visible, never
 * only on the possibly-revoked guide's device (Decision 9 / gap G11).
 *
 * IDEMPOTENT by (client_id, student_id, task_id): a drain that wrote the reject but
 * never heard back (so the client never tombstoned the entry, and re-ships it) must
 * not stack a second row. Probe-then-insert, tolerating the race exactly as Unit 5b's
 * anonymize audit does — the probe closes the common (sequential re-drain) case, and
 * the DB UNIQUE index (`path_fw_replay_rejects_client_scope_key`, Unit 9) closes the
 * genuinely-concurrent one (a device auto-drain racing a CLI `fw drain` of an
 * exported file): its 23505 is treated as success, because the row it collided with
 * IS the reject. Reuses the SAME reject shape and cohort/actor columns Unit 5b reads.
 *
 * `ok:false` means the write itself failed AND no row is present; the caller then
 * RETRIES the entry rather than tombstoning it, so a reject is never dropped on the
 * floor. A timed-out write (which may have landed) re-probes rather than reporting
 * failure blindly — the same self-healing posture as the anonymize audit.
 */
export async function writeFwReject(
  db: SupabaseClient,
  input: { entry: FwQueueEntry; reason: FwRejectReason }
): Promise<{ ok: boolean }> {
  const { entry, reason } = input;

  const probe = () =>
    fwRead(
      () =>
        db
          .from("path_fw_replay_rejects")
          .select("id")
          .eq("client_id", entry.clientId)
          .eq("student_id", entry.studentId)
          .eq("task_id", entry.taskId)
          .limit(1),
      `reject probe (${entry.clientId})`
    );

  const existing = await probe();
  if (existing.error) {
    console.error(`[fw/drain] reject probe failed for ${entry.clientId}: ${existing.error.message}`);
    return { ok: false };
  }
  if (Array.isArray(existing.data) && existing.data.length > 0) return { ok: true }; // already recorded

  const res = await fwWrite(
    () =>
      db.from("path_fw_replay_rejects").insert({
        student_id: entry.studentId,
        task_id: entry.taskId,
        // Nullable by design: an unresolved cohort is itself a rejection reason, and
        // a reject must always be recordable. We carry it when we have it.
        cohort_id: entry.cohortId,
        actor: entry.actorUserId,
        action: entry.action,
        reason,
        client_id: entry.clientId,
        captured_at: entry.capturedAt,
      }),
    `reject insert (${entry.clientId})`
  );
  if (!res.error) return { ok: true };
  // A unique violation means a concurrent drain already recorded this exact reject —
  // the row exists, so the record is present: success (the ON CONFLICT DO NOTHING the
  // partial unique index gives us, surfaced through the code rather than the SQL).
  if (isUniqueViolation(res.error)) return { ok: true };
  // Any other error (incl. a timed-out write that MAY have landed): re-probe rather
  // than blindly reporting failure, so a reject that actually committed is not re-run.
  console.error(`[fw/drain] reject insert failed for ${entry.clientId}: ${res.error.message}`);
  const after = await probe();
  return { ok: !after.error && Array.isArray(after.data) && after.data.length > 0 };
}

/* ══════════════════════════════════════════════════════════════ the drain ══ */

/** Replay ONE op through the sole write choke point. Returns the disposition and
 *  whether it settled (so the caller can halt the rest of an ordered group).
 *
 *  `expectedVerifiedBy` is the offline-only undo CAS author (Unit 9): non-null ONLY
 *  for a leading undo the same-actor guard already checked, so the RPC applies it
 *  atomically — only while `verified_by` still matches. A concurrent cross-actor
 *  decision landing between the guard read and this replay then echoes
 *  `cross_actor_undo` (a terminal reject) instead of reverting the new decision. */
async function replayFwOp(
  db: SupabaseClient,
  op: FwQueueEntry,
  sessionUserId: string,
  now: number,
  expectedVerifiedBy: string | null
): Promise<{ disposition: "settled" | "retry"; reject: FwRejectReason | null }> {
  const res = await runFwCheckIn(db, {
    actorUserId: sessionUserId,
    cohortId: op.cohortId,
    taskId: op.taskId,
    action: op.action,
    studentIds: [op.studentId],
    clientIds: { [op.studentId]: op.clientId },
    // Clamp here too (the RPC re-clamps as the boundary backstop): an iPad that sat
    // in a bag all summer is the dead-RTC case the floor was written for.
    capturedAt: clampFwReplayCapturedAt(op.capturedAt, now),
    // The batch's shared id, so an offline three-student tap still groups into one
    // board celebration on drain instead of three.
    actionId: op.actionId,
    expectedVerifiedBy,
    now,
  });

  if (!res.ok) return { disposition: "retry", reject: null }; // unavailable — a blip
  const result = res.outcomes[0];
  if (!result) return { disposition: "retry", reject: null };

  const verdict = interpretFwReplayResult(result);
  if (verdict.kind === "settled") return { disposition: "settled", reject: null };
  if (verdict.kind === "retry") return { disposition: "retry", reject: null };
  return { disposition: "retry", reject: verdict.reason };
}

/**
 * Drain a queue of captured taps. See the file header for the five-step fold; the
 * ordering guarantees worth restating:
 *
 *   - a cancelled pair NEVER hits the network (it settles from the reduction alone);
 *   - within a (student, task) group the ops replay IN ORDER and HALT on the first
 *     non-settle, because an `undo + not_yet` correction is only legal if the undo
 *     lands first — attempting the not_yet against a still-verified row would mint a
 *     spurious `undo_first` reject for a correction that is actually fine;
 *   - a guard-read failure retries the whole surviving group rather than fabricating
 *     an author.
 */
export async function runFwDrain(db: SupabaseClient, input: FwDrainInput): Promise<FwDrainResult> {
  const authorized = new Set(input.authorizedCohortIds);
  const unknown = new Set(input.unknownCohortIds ?? []);
  const groups = groupFwEntriesByStudentTask(selectDrainableGroups(input.entries));
  const outcomes: FwDrainOutcome[] = [];

  for (const [, ops] of groups) {
    const cohortId = ops[0].cohortId;

    // 1 ── authorization, TRI-STATE.
    if (!authorized.has(cohortId)) {
      // A cohort whose authorization could not be RESOLVED (an auth-read blip) must
      // RETRY, never permanently reject — on venue wifi a transient error would
      // otherwise silently discard a guide's real captures to a staff-only reject.
      if (unknown.has(cohortId)) {
        for (const op of ops) outcomes.push(retry(op));
        continue;
      }
      // A genuine revoke: reject every op server-side, none applied. The reject WRITE
      // still runs under the service-role db, so the record lands even though the
      // guide's own grant is gone — the whole point of not leaving it on their device.
      for (const op of ops) outcomes.push(await recordReject(db, op, "reauth_failed"));
      continue;
    }

    // 2 ── reduce. Cancelled entries settle with no server call.
    const reduced = reduceFwOps(ops);
    const survivingIds = new Set(reduced.map((o) => o.clientId));
    for (const op of ops) if (!survivingIds.has(op.clientId)) outcomes.push(settled(op));
    if (reduced.length === 0) continue;

    // 3 ── guard. Only a LEADING undo needs the server row.
    let server: FwServerRow | null = null;
    if (reduced[0].action === "undo") {
      const read = await loadFwProgressRow(db, reduced[0].studentId, reduced[0].taskId);
      if (!read.ok) {
        for (const op of reduced) outcomes.push(retry(op)); // don't guess an author
        continue;
      }
      server = read.row;
    }

    const plan = planFwStudentTask({ ops: reduced, server });
    for (const { entry, reason } of plan.reject) {
      outcomes.push(await recordReject(db, entry, reason));
    }

    // 4/5 ── replay in order, halting the group on the first non-settle.
    let halt: { disposition: "retry"; reject: FwRejectReason | null } | null = null;
    for (let i = 0; i < plan.replay.length; i += 1) {
      const op = plan.replay[i];
      if (halt) {
        // A prior op did not land: the follow-on cannot legally apply. If the prior
        // was a terminal reject, this is rejected with the same reason; otherwise it
        // waits for the next drain, when the earlier op will be re-attempted first.
        outcomes.push(halt.reject ? await recordReject(db, op, halt.reject) : retry(op));
        continue;
      }
      // The offline-only undo CAS (Unit 9): ONLY the LEADING undo carries the author
      // the same-actor guard just checked (`server.verifiedBy`), so the RPC applies it
      // atomically. Every following op — always a fresh decision after a surviving undo
      // — passes null, and the online path never reaches here. `server` was read above
      // exactly when `reduced[0]` is an undo, so it is populated for i === 0.
      const expectedVerifiedBy =
        i === 0 && op.action === "undo" ? (server?.verifiedBy ?? null) : null;
      const step = await replayFwOp(db, op, input.sessionUserId, input.now, expectedVerifiedBy);
      if (step.disposition === "settled") {
        outcomes.push(settled(op));
        continue;
      }
      if (step.reject) {
        outcomes.push(await recordReject(db, op, step.reject));
        halt = { disposition: "retry", reject: step.reject };
      } else {
        outcomes.push(retry(op));
        halt = { disposition: "retry", reject: null };
      }
    }
  }

  return { outcomes };
}

/** Write the reject row, then classify the entry — but if the WRITE fails, RETRY
 *  the entry instead of tombstoning it, so a reject is never lost to a stalled
 *  insert (the entry stays queued and the next drain re-records it, idempotently). */
async function recordReject(
  db: SupabaseClient,
  entry: FwQueueEntry,
  reason: FwRejectReason
): Promise<FwDrainOutcome> {
  const wrote = await writeFwReject(db, { entry, reason });
  return wrote.ok ? rejected(entry, reason) : retry(entry);
}

/** A blocked entry (a local reject tombstone) is never re-drained — it waits for a
 *  manual dismiss. `!e.blocked` rather than `=== null` so an entry that arrives with
 *  the field absent is treated as drainable, not silently dropped. */
function selectDrainableGroups(entries: readonly FwQueueEntry[]): readonly FwQueueEntry[] {
  return entries.filter((e) => !e.blocked);
}

/* ══════════════════════════════════════════════════════ agent-native inspection ══ */

/** A dry, no-write view of what a drain WOULD do to a queue — the CLI's
 *  `drain --plan` and the reason the reduction is inspectable without a mutation.
 *  Pure over the entries plus the caller-supplied server rows (keyed by
 *  `fwStudentTaskKey`), so an operator can see the fold before running it. */
export function planFwDrain(
  entries: readonly FwQueueEntry[],
  serverByKey: Map<string, FwServerRow | null>
): { key: string; replay: string[]; reject: { clientId: string; reason: FwRejectReason }[] }[] {
  const out: ReturnType<typeof planFwDrain> = [];
  for (const [key, ops] of groupFwEntriesByStudentTask(entries)) {
    const plan = planFwStudentTask({ ops, server: serverByKey.get(key) ?? null });
    out.push({
      key,
      replay: plan.replay.map((o) => `${o.action}:${o.clientId}`),
      reject: plan.reject.map((r) => ({ clientId: r.entry.clientId, reason: r.reason })),
    });
  }
  return out;
}
