/**
 * Pure offline-sync decision logic for Founders Weekend (FW Unit 8) — ALL of it.
 *
 * The SIBLING of `sync-rules.ts`, and deliberately a PARALLEL union rather than an
 * extension of it (the plan's deferred-to-implementation call, resolved here). The
 * Path's `QueueEntry` is evidence-shaped — media/link/log/submit, carrying Blobs
 * and TUS slots; FW's entry is a check-in TAP carrying an action, a cohort, and an
 * author. Folding one into the other would drag every evidence field through a
 * discriminant that means nothing here, and vice versa. What the two DO share is
 * the single clock (`clampToNow`) and the same architectural rule: this repo's
 * tests are node-only, so the IndexedDB queue (`fw-queue.ts`) and the drain engine
 * (`fw-sync-engine.ts`) must be THIN drivers over this module — nothing about
 * IndexedDB or the network is testable here, so nothing decision-bearing may live
 * there. Every branch they take is decided here and covered by
 * `__tests__/fw-sync-rules.test.ts`.
 *
 * ── The heart: reduce × same-actor-guard × reject (Decision 9) ─────────────────
 * A 20-minute outage loses nothing and MISLEADS nothing. The queue reduces per
 * (student, task) to the minimal LEGAL op-sequence from the pre-outage state —
 * pure checkmark/undo pairs cancel to nothing, but an `undo + decision` correction
 * is NEVER collapsed to the bare decision (which the write path would rightly
 * refuse). A surviving replayed undo applies only if the decision it reverts was
 * authored by the SAME actor (it reads `verified_by`, which `fw_move_task` stamps
 * on checkmark AND not_yet); a cross-actor offline correction rejects to staff.
 * Both adversarial reviews found live-event bugs in exactly this fold, so every
 * named matrix row is pinned test-first.
 *
 * ── Reused, never re-derived ──────────────────────────────────────────────────
 * `FwAction` and the reject vocabulary come from `fw-rules.ts` and the ops
 * surface's `fwReplayRejectReasonCopy` — a second legality model or a second reject
 * lexicon is a bug waiting for the case where the two disagree.
 */

import { clampToNow } from "./sync-rules";
import { type FwAction, FW_ACTIONS } from "./fw-rules";
import type { FwStudentResult } from "./fw-rules";
import type { TaskState } from "./transition-table";

/* ══════════════════════════════════════════════════ constants the drivers inline ══ */

/** IndexedDB identity for the FW capture queue + roster cache. A separate store
 *  family from the Path's `path-offline-queue` (Decision 8's block-until-drained
 *  posture diverges from the Path queue's keep-on-sign-out). */
export const FW_QUEUE_DB_NAME = "fw-offline-queue";
export const FW_QUEUE_DB_VERSION = 1;
/** The check-in tap queue. */
export const FW_QUEUE_STORE = "entries";
/** The offline roster cache (Decision 15 — IndexedDB, NOT the service worker). */
export const FW_ROSTER_STORE = "roster";

/**
 * The persisted entry-shape version, stamped on every entry at enqueue. The queue
 * is a CROSS-DEPLOY contract: an entry can sit on a guide's iPad through a
 * mid-weekend redeploy, so any change to a `FwQueueEntry` field shape MUST bump
 * this — `isRecognizedFwEntry` then routes the old shape to a surfaced tombstone
 * rather than feeding it raw into the drain's typed switches.
 */
export const FW_QUEUE_ENTRY_SCHEMA_VERSION = 1;

/** The roster cache's own shape version — bumped independently of the queue's, and
 *  the gate `isFwRosterCacheUsable` checks so a shape change never feeds the shell
 *  a roster it cannot render (Decision 15's version test). */
export const FW_ROSTER_CACHE_SCHEMA_VERSION = 1;

/**
 * The service worker (origin root, shared with the Path) registered at the NARROW
 * FW scope. `PathPwa` registers `/sw.js` at `/path`; guides never load that
 * layout, so `FwPwa` registers the same worker at `/path/fw`. Narrowing needs no
 * Service-Worker-Allowed header. `sw-discipline.test.ts` pins these to the SW.
 */
export const FW_SW_URL = "/sw.js";
export const FW_SW_SCOPE = "/path/fw";

/**
 * The app-shell prefix the SW is allowed to cache NAVIGATIONS for — the single
 * narrowly-scoped exception to the pinned never-cache-navigations invariant
 * (Decision 15). The board token subtree is deliberately EXCLUDED (a live,
 * no-store poll surface whose token URL must never be cached).
 */
export const FW_APP_SHELL_PREFIX = "/path/fw";
export const FW_BOARD_PREFIX = "/path/fw/board";

/** The SW cache holding the FW app-shell navigations — the single cache the
 *  never-cache-navigations exception writes to, swept on activate and cleared with
 *  the queue on sign-out (so a shared iPad keeps no authed shell for the next
 *  guide). `sw-discipline.test.ts` pins this string to `public/sw.js`. */
export const FW_SHELL_CACHE_NAME = "path-sw-fw-shell-v1";

/**
 * Whether a navigation path is a cacheable FW app-shell route — the single
 * predicate the never-cache-navigations EXCEPTION rests on (Decision 15). Under
 * `/path/fw`, but NEVER the board token subtree (a live no-store poll surface whose
 * token URL must not be cached) and NEVER anything outside `/path/fw` (every Path
 * navigation keeps the original never-cache posture).
 *
 * `public/sw.js` carries a hand-mirrored copy (it is a plain worker script, not a
 * module); `sw-discipline.test.ts` pins the SW's copy to reference the same two
 * prefixes, and this function is tested directly so the SCOPING logic — not just the
 * constants — has behavioral coverage that reddens if the board is let in.
 */
export function isFwAppShellPath(pathname: string): boolean {
  if (pathname !== FW_APP_SHELL_PREFIX && !pathname.startsWith(FW_APP_SHELL_PREFIX + "/")) {
    return false;
  }
  if (pathname === FW_BOARD_PREFIX || pathname.startsWith(FW_BOARD_PREFIX + "/")) return false;
  return true;
}

/** Past this many failed drain attempts an entry stops AUTO-retrying and waits for
 *  a manual signal — the same "still trying" honesty the Path queue keeps, so a
 *  permanently-failing entry does not spin every foreground signal forever. */
export const FW_AUTO_RETRY_ATTEMPT_CEILING = 8;

/* ══════════════════════════════════════════════════════════ the queue entry ══ */

/**
 * One captured check-in tap. `id === clientId` by construction: one entry per tap,
 * so a drain re-run replays the SAME exactly-once key and the RPC's idempotency
 * makes it a no-op (`replayed`) rather than a duplicate event. A batch tap on N
 * students is N entries sharing one `actionId`, so the board still groups the
 * offline celebration by action even after the outage.
 */
export type FwQueueEntry = {
  /** Entry identity — equals `clientId` (one entry per tap). */
  id: string;
  /** See FW_QUEUE_ENTRY_SCHEMA_VERSION. */
  schemaVersion: number;
  /** The per-(student, task, tap) exactly-once key the RPC dedupes on. */
  clientId: string;
  /** Groups a batch captured in one tap (FW-D16) — shared across its N students. */
  actionId: string;
  studentId: string;
  taskId: string;
  action: FwAction;
  /** Decision 3: always carried, re-verified at drain — never inferred. */
  cohortId: string;
  /** Client clock at capture (ISO). Skew-clamped at replay against the server clock. */
  capturedAt: string;
  /** The guide whose device captured it — the same-actor guard's subject, and the
   *  reject row's `actor`. */
  actorUserId: string;
  /** Client clock at enqueue. Drain order and per-(student,task) capture order both
   *  key on it (id tiebreak, so the order is total and stable). */
  enqueuedAt: string;
  /** Failed drain attempts — the auto-retry ceiling reads it. */
  attempts: number;
  lastAttemptAt: string | null;
  /**
   * A terminal LOCAL tombstone written after a server-side reject — surfaced in
   * the queued indicator with its staff-visible note, dismissible, and excluded
   * from auto-drain. The authoritative record is the `path_fw_replay_rejects` row;
   * this is the copy the capturing guide sees so they are not left guessing.
   */
  blocked: { reason: FwRejectReason; note: string } | null;
};

/**
 * The FW-shaped fields any input claiming to be a queue entry must carry. The base
 * to enqueue a fresh entry (id/attempts/blocked defaulted by the driver).
 */
export type FwQueueEntryInput = {
  clientId: string;
  actionId: string;
  studentId: string;
  taskId: string;
  action: FwAction;
  cohortId: string;
  capturedAt: string;
  actorUserId: string;
};

/* ══════════════════════════════════════════════════════════ reject vocabulary ══ */

/**
 * Why a replay could not be applied. Every value is one the ops surface's
 * `fwReplayRejectReasonCopy` already renders — the reject lexicon is shared with
 * Unit 5b's reject list, not invented here, so a drain-written reason always has
 * human copy on the surface that displays it.
 */
export type FwRejectReason =
  /** The same-actor undo guard held a cross-actor offline correction for staff. */
  | "cross_actor_undo"
  /** The write path refused the replay — the state had already moved. */
  | "guard_refused"
  /** The student is not a member of the stamped cohort / the cohort is not fw. */
  | "cohort_unresolved"
  /** The capturing guide could not be re-authenticated / is no longer authorized. */
  | "reauth_failed"
  /** No progress row exists for (student, task) — a provisioning gap. */
  | "missing_progress";

/* ══════════════════════════════════════════════════ the minimal-legal reduction ══ */

/** Whether an action carries a guide's DECISION (as opposed to reverting one). */
function isFwDecisionAction(action: FwAction): boolean {
  return action === "checkmark" || action === "not_yet";
}

/**
 * Reduce one queue's ops to the minimal legal op-sequence, folding in CAPTURE
 * order (Decision 9).
 *
 * A stack fold: a decision pushes; an `undo` pops the immediately-preceding QUEUED
 * decision if there is one (the pair cancels — whatever the pre-outage state was,
 * a decision and its own undo net to nothing), otherwise it SURVIVES to be
 * replayed against the pre-outage decision. The rule that the plan-review
 * correction turns on falls straight out: `undo + decision` never collapses to the
 * bare decision, because the undo has no queued decision to cancel and is kept in
 * place ahead of the fresh decision.
 *
 * NOT sorted by `capturedAt` — `enqueuedAt` is the queue's own monotonic clock and
 * the capture order that matters is the order taps were enqueued, which an NTP
 * correction on `capturedAt` could otherwise scramble (the Path queue's lesson:
 * queue membership/order is the invariant, wall-clock is display only).
 */
export function reduceFwOps(ops: readonly FwQueueEntry[]): FwQueueEntry[] {
  const ordered = orderFwEntries(ops);
  const stack: FwQueueEntry[] = [];
  for (const op of ordered) {
    if (op.action === "undo") {
      const top = stack[stack.length - 1];
      if (top && isFwDecisionAction(top.action)) {
        stack.pop(); // a decision and its undo cancel to nothing
        continue;
      }
      stack.push(op); // a surviving undo — reverts a pre-outage decision
    } else {
      stack.push(op);
    }
  }
  return stack;
}

/* ═══════════════════════════════════════════════════ the same-actor undo guard ══ */

/** The server row a surviving undo is evaluated against — the two fields the guard
 *  reads, no more. */
export type FwServerRow = { state: TaskState; verifiedBy: string | null };

/** The two states that carry a stamped author — the only ones the guard gates. */
const FW_DECISION_STATES: readonly TaskState[] = ["verified", "not_yet"];

/**
 * May this surviving undo apply? (Decision 9's author check.)
 *
 * Only a decision it did NOT author is held: a null/absent server row or a
 * non-decision state means there is nothing to revert (the undo will no-op at
 * replay), and a decision authored by the SAME guide is theirs to revert. A
 * decision by ANOTHER guide — or one whose author will not read as a string (a
 * shape drift on the column the whole guard rests on) — fails CLOSED to reject,
 * so a cross-actor undo never lands on the strength of an unreadable author.
 */
export function evaluateFwSameActorGuard(input: {
  server: FwServerRow | null;
  undoActor: string;
}): "apply" | "reject" {
  const { server, undoActor } = input;
  if (server === null) return "apply";
  if (!FW_DECISION_STATES.includes(server.state)) return "apply";
  return server.verifiedBy === undoActor ? "apply" : "reject";
}

/* ══════════════════════════════ the composed per-student-task drain plan ══ */

export type FwStudentTaskPlan = {
  /** Ops to replay through `runFwCheckIn`, in order. */
  replay: FwQueueEntry[];
  /** Ops the guard held before any replay, with the machine reason. */
  reject: { entry: FwQueueEntry; reason: FwRejectReason }[];
};

/**
 * Plan the drain for ONE (student, task): reduce, then apply the same-actor guard
 * to a leading surviving undo.
 *
 * The guard only ever concerns a leading undo, because reduction already cancelled
 * any queued decision an undo could revert — so the only undo that reaches the
 * pre-outage state is one at the FRONT of the reduced sequence. When it fails the
 * guard the WHOLE reduced sequence rejects with `cross_actor_undo`: the plan is
 * explicit that a cross-actor correction rejects to staff as a unit (a following
 * `not_yet` could not legally land without the undo anyway).
 *
 * `server` is only consulted for the leading-undo case; the drain reads it solely
 * then. A `null` server here means "no progress row" (or unread because there is
 * no leading undo), not "read failed" — the engine keeps a failed read as a retry
 * and never calls this with a lie.
 */
export function planFwStudentTask(input: {
  ops: readonly FwQueueEntry[];
  server: FwServerRow | null;
}): FwStudentTaskPlan {
  const reduced = reduceFwOps(input.ops);
  if (reduced.length === 0) return { replay: [], reject: [] };

  const leading = reduced[0];
  if (leading.action === "undo") {
    const guard = evaluateFwSameActorGuard({ server: input.server, undoActor: leading.actorUserId });
    if (guard === "reject") {
      return {
        replay: [],
        reject: reduced.map((entry) => ({ entry, reason: "cross_actor_undo" as const })),
      };
    }
  }
  return { replay: reduced, reject: [] };
}

/* ═══════════════════════════════════════════ replay-outcome interpretation ══ */

export type FwReplayDisposition =
  /** The effect landed (or was already there) — delete the entry. */
  | { kind: "settled" }
  /** A terminal server-side reject — record it and tombstone the entry locally. */
  | { kind: "reject"; reason: FwRejectReason }
  /** No answer arrived (timeout/blip) — keep the entry and try the next signal. */
  | { kind: "retry" };

/**
 * Fold one `runFwCheckIn` per-student result into a drain disposition.
 *
 * The four success shapes all SETTLE, including `already_done` — a replay against
 * an already-verified task is a no-op, NOT a reject (the plan's named error row).
 * A refusal or a definite failure REJECTS with a shared-lexicon reason. Only
 * `unavailable` — a timeout or an echo that would not narrow — RETRIES, because it
 * is neither proof the write landed nor proof it did not, and the recovery is the
 * next drain signal, not a permanent reject that would bury a capture staff never
 * needed to see.
 */
export function interpretFwReplayResult(result: FwStudentResult): FwReplayDisposition {
  switch (result.kind) {
    case "applied":
    case "re_attempt":
    case "already_done":
    case "replayed":
      return { kind: "settled" };
    case "refused":
      return { kind: "reject", reason: "guard_refused" };
    case "skipped":
      // not_in_cohort → the stamp did not resolve; over_batch_max cannot occur on a
      // single-student replay, but rejects rather than silently vanishing.
      return { kind: "reject", reason: "cohort_unresolved" };
    case "failed":
      if (result.reason === "missing_progress") return { kind: "reject", reason: "missing_progress" };
      if (result.reason === "cohort_invalid") return { kind: "reject", reason: "cohort_unresolved" };
      return { kind: "retry" }; // unavailable
  }
}

/* ══════════════════════════════════════════ block-until-drained sign-out ══ */

export type FwSignOutVerdict =
  | { ok: true }
  | { ok: false; reason: "queued_offline" | "drain_first"; queuedCount: number };

/**
 * The sign-out verdict (Decision 8 / gap G1).
 *
 * A shared guide iPad rotates operators, so its queue must never be abandoned:
 * signing out with queued items OFFLINE is refused with a count (no drain is
 * possible, and no new sign-in is possible either — the accepted, stated
 * consequence is that the device stays with its guide until reconnect). ONLINE,
 * the queue CAN drain, so sign-out asks to drain first; the caller runs a drain
 * and re-checks. Only an empty queue allows sign-out — at which point the caller
 * clears the queue AND the roster cache residue.
 */
export function decideFwSignOut(input: { queuedCount: number; online: boolean }): FwSignOutVerdict {
  if (input.queuedCount === 0) return { ok: true };
  return input.online
    ? { ok: false, reason: "drain_first", queuedCount: input.queuedCount }
    : { ok: false, reason: "queued_offline", queuedCount: input.queuedCount };
}

/* ═══════════════════════════════════════════════════ roster cache (Decision 15) ══ */

/** One cached roster row — names and band, the fields the offline shell renders
 *  and the batch picker searches. Deliberately NOT the resume chips (a decided-rows
 *  scan the outage cannot refresh anyway). */
export type FwCachedRosterStudent = {
  studentId: string;
  firstName: string;
  lastName: string;
  band: string;
};

/**
 * The persisted roster cache. `buildId` is informational (a staleness signal), NOT
 * a hard gate — a content-only redeploy must not wipe the roster a guide is mid-loop
 * with. `schemaVersion` IS the gate: a shape change invalidates.
 */
export type FwRosterCache = {
  schemaVersion: number;
  buildId: string;
  cohortId: string;
  students: FwCachedRosterStudent[];
  cachedAt: string;
};

/**
 * Whether a cached roster may back the offline shell (Decision 15's version test).
 *
 * Usable iff it is for THIS cohort and its shape matches this app version. A
 * `buildId` difference alone — a mid-weekend deploy that did not change the entry
 * shape — leaves it usable, so the deploy does not wedge the cached shell; only a
 * `schemaVersion` bump does, and then the shell refetches online rather than
 * rendering a shape it cannot.
 */
export function isFwRosterCacheUsable(
  cache: FwRosterCache | null,
  input: { cohortId: string; schemaVersion: number }
): boolean {
  if (cache === null) return false;
  if (cache.schemaVersion !== input.schemaVersion) return false;
  return cache.cohortId === input.cohortId;
}

/* ══════════════════════════════════════════ cross-deploy tolerant entry reader ══ */

const FW_ACTION_SET = new Set<string>(FW_ACTIONS);

/**
 * Whether a record read back from IndexedDB is a shape this app version can drain.
 * A record written by a FUTURE version (or corrupted) must never reach the drain's
 * typed switches — the engine tombstones it as a surfaced, dismissible needs-
 * attention entry instead. Never a silent drop: the record is a child's check-in.
 */
export function isRecognizedFwEntry(x: unknown): x is FwQueueEntry {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.clientId === "string" &&
    typeof e.actionId === "string" &&
    typeof e.studentId === "string" &&
    typeof e.taskId === "string" &&
    typeof e.action === "string" &&
    FW_ACTION_SET.has(e.action) &&
    typeof e.cohortId === "string" &&
    typeof e.capturedAt === "string" &&
    typeof e.actorUserId === "string" &&
    typeof e.enqueuedAt === "string" &&
    typeof e.attempts === "number" &&
    (e.schemaVersion === undefined || e.schemaVersion === FW_QUEUE_ENTRY_SCHEMA_VERSION)
  );
}

/* ═══════════════════════════════════════════════ grouping, ordering, scope ══ */

/** The reduction's grouping key — the cohort is in the key because two cohorts can
 *  never share a (student, task) drain sequence (a returner belongs to two). */
export function fwStudentTaskKey(entry: Pick<FwQueueEntry, "cohortId" | "studentId" | "taskId">): string {
  return `${entry.cohortId} ${entry.studentId} ${entry.taskId}`;
}

/** FIFO by `enqueuedAt`, id tiebreak — a total, stable order (the Path queue's
 *  `planDrain` sort, so two entries sharing a timestamp never reorder between
 *  passes). */
export function orderFwEntries(entries: readonly FwQueueEntry[]): FwQueueEntry[] {
  return [...entries].sort((a, b) => {
    const at = Date.parse(a.enqueuedAt);
    const bt = Date.parse(b.enqueuedAt);
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Group entries by (cohort, student, task), each group in capture order. */
export function groupFwEntriesByStudentTask(entries: readonly FwQueueEntry[]): Map<string, FwQueueEntry[]> {
  const groups = new Map<string, FwQueueEntry[]>();
  for (const entry of orderFwEntries(entries)) {
    const key = fwStudentTaskKey(entry);
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

/**
 * Only the signed-in guide's OWN captures are drainable. Block-until-drained keeps
 * a device's queue with its guide, so in practice every entry is theirs — but a
 * drain that stamped one guide's tap under another's session would forge an author
 * the same-actor guard then trusts, so this is defense in depth, not decoration.
 */
export function selectFwDrainable(
  entries: readonly FwQueueEntry[],
  actorUserId: string
): FwQueueEntry[] {
  return entries.filter((e) => e.actorUserId === actorUserId);
}

/* ═══════════════════════════════════════════════════ the queued indicator ══ */

export type FwQueueSummary = {
  /** Entries still awaiting a successful drain (blocked excluded). */
  queuedCount: number;
  /** Blocked entries needing a human, each with its staff-visible note. */
  attention: { id: string; note: string }[];
};

/** The three-state indicator's raw counts: n queued / (syncing is the engine's
 *  in-flight flag) / attention. */
export function summarizeFwQueue(entries: readonly FwQueueEntry[]): FwQueueSummary {
  let queuedCount = 0;
  const attention: FwQueueSummary["attention"] = [];
  for (const entry of entries) {
    if (entry.blocked) {
      attention.push({ id: entry.id, note: entry.blocked.note });
      continue;
    }
    queuedCount += 1;
  }
  return { queuedCount, attention };
}

/* ═══════════════════════════════════════════════════ capture-time clamping ══ */

/**
 * Clamp a capture time against the server clock at replay — reused from the Path's
 * `clampToNow` (a second clock is the bug this repo's offline-sync learning warns
 * against). Returns the clamped ISO value; the RPC re-clamps as the boundary
 * backstop.
 */
export function clampFwReplayCapturedAt(capturedAt: string, nowMs: number): string {
  return clampToNow(capturedAt, nowMs).value;
}
