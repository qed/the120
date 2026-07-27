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
import { decideFwAction, type FwAction, FW_ACTIONS, FW_ACTION_LEGAL_FROM } from "./fw-rules";
import type { FwStudentResult } from "./fw-rules";
import type { TaskState } from "./transition-table";

/* ══════════════════════════════════════════════════ constants the drivers inline ══ */

/** IndexedDB identity for the FW capture queue + roster cache. A separate store
 *  family from the Path's `path-offline-queue` (Decision 8's block-until-drained
 *  posture diverges from the Path queue's keep-on-sign-out). KEPT STABLE across
 *  the /fp rename (Unit 10) — an internal store key, not a route; renaming it
 *  orphans an installed guide iPad's queued check-ins for zero user value. */
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
 * FW scope. `PathPwa` registers `/sw.js` at `/fp`; guides never load that
 * layout, so `FwPwa` registers the same worker at `/fp/fw`. Narrowing needs no
 * Service-Worker-Allowed header. `sw-discipline.test.ts` pins these to the SW.
 */
export const FW_SW_URL = "/sw.js";
export const FW_SW_SCOPE = "/fp/fw";

/**
 * The app-shell prefix the SW is allowed to cache NAVIGATIONS for — the single
 * narrowly-scoped exception to the pinned never-cache-navigations invariant
 * (Decision 15). The board token subtree is deliberately EXCLUDED (a live,
 * no-store poll surface whose token URL must never be cached).
 */
export const FW_APP_SHELL_PREFIX = "/fp/fw";
export const FW_BOARD_PREFIX = "/fp/fw/board";
/** Staff ops — cross-cohort, admin-privileged pages that were NEVER the offline
 *  target (staff run ops online). EXCLUDED from the app-shell caching exception so
 *  their authed HTML is never left in a shared iPad's SW cache (security review). */
export const FW_OPS_PREFIX = "/fp/fw/ops";

/** The SW cache holding the FW app-shell navigations — the single cache the
 *  never-cache-navigations exception writes to, swept on activate and cleared with
 *  the queue on sign-out (so a shared iPad keeps no authed shell for the next
 *  guide). `sw-discipline.test.ts` pins this string to `public/sw.js`. */
export const FW_SHELL_CACHE_NAME = "path-sw-fw-shell-v1";

/**
 * Whether a navigation path is a cacheable FW app-shell route — the single
 * predicate the never-cache-navigations EXCEPTION rests on (Decision 15). Under
 * `/fp/fw`, but NEVER the board token subtree (a live no-store poll surface whose
 * token URL must not be cached) and NEVER anything outside `/fp/fw` (every Path
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
  if (pathname === FW_OPS_PREFIX || pathname.startsWith(FW_OPS_PREFIX + "/")) return false;
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
      // Consecutive surviving undos COLLAPSE to one: undo is idempotent (a second
      // undo lands on the row the first already returned to `locked`), and keeping
      // both would leave a trailing undo unguarded — `planFwStudentTask` only checks
      // the LEADING undo's author, so a second surviving undo could revert a
      // concurrent cross-actor decision with no guard (adversarial review). At most
      // one surviving undo reaches the pre-outage state, and it is the one guarded.
      if (top && top.action === "undo") continue;
      stack.push(op); // a surviving undo — reverts a pre-outage decision
    } else {
      stack.push(op);
    }
  }
  return stack;
}

/**
 * Project the state a task view should SHOW, given the server's state and this
 * guide's own pending offline captures for that (student, task) (correctness review).
 *
 * The task page's server state comes from the last online render — which, mid-outage,
 * the SW serves from a STALE cached shell that predates the guide's own queued taps.
 * Without this, a guide who checkmarks offline, navigates away, and revisits sees the
 * task as untouched, and a raw not-yet then swallows their real correction into a
 * staff reject. Folding the pending ops (reduced, then applied through the canonical
 * decision table — never a second state machine) onto the server state shows the true
 * pending position, so the guide sees Undo instead of a conflicting fresh decision.
 *
 * AUTHOR-BLIND, so it is CONSERVATIVE about a leading surviving undo: this runs
 * client-side with no `verified_by`, and a queued undo that actually reverts ANOTHER
 * guide's decision will be held by the same-actor guard at drain (cross_actor_undo).
 * Optimistically showing it as reverted would invite the guide to layer a fresh
 * decision on top, which then rejects WITH the undo as one sequence — silently losing
 * a valid decision (adversarial re-review). So a reduced sequence that STARTS with an
 * undo projects the server state unchanged; the common case this exists for — a
 * pending checkmark on a stale-`locked` shell — is decision-led and unaffected.
 */
export function projectFwPendingState(server: TaskState, ops: readonly FwQueueEntry[]): TaskState {
  const reduced = reduceFwOps(ops);
  if (reduced[0]?.action === "undo") return server;
  let state = server;
  for (const op of reduced) {
    const decision = decideFwAction({ action: op.action, from: state });
    if (decision.kind === "apply") state = decision.to;
    // re_attempt / already_done / refused leave the state where it is.
  }
  return state;
}

/* ═══════════════════════════════════════════════════ the same-actor undo guard ══ */

/** The server row a surviving undo is evaluated against — the two fields the guard
 *  reads, no more. */
export type FwServerRow = { state: TaskState; verifiedBy: string | null };

/**
 * The states that carry a stamped author — the only ones the guard gates. DERIVED
 * from `undo`'s legal-from set (the RPC-parity-pinned canonical fact), never a
 * second hand-typed copy: `fw_move_task`'s UPDATE guards undo with exactly this set,
 * and a future change to it must be felt here automatically or the guard would gate
 * the wrong states (maintainability review — the "second legality model" trap this
 * module's own header warns against).
 */
const FW_DECISION_STATES: readonly TaskState[] = FW_ACTION_LEGAL_FROM.undo;

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
      // The offline-only CAS refused the undo — the decision it targeted changed
      // authors between the guard read and this replay (Unit 9). A terminal reject
      // with the SAME reason the client-side same-actor guard raises, because to
      // staff it is the same fact: an offline undo of a check-in that is not the
      // guide's to revert.
      if (result.reason === "cross_actor_undo") return { kind: "reject", reason: "cross_actor_undo" };
      return { kind: "retry" }; // unavailable
  }
}

/* ═══════════════════════════════════════════ the drain's per-entry outcome ══ */

/**
 * What `runFwDrain` reports for ONE entry — the wire shape the drain action returns
 * to the client. Lives HERE (pure) rather than in `fw-sync-engine.ts` so the
 * client's apply step can be a thin driver over `applyFwDrainOutcome` without
 * importing the db-taking core, and so both sides share one definition.
 */
export type FwDrainOutcome =
  /** The effect landed (or the pair cancelled) — the client deletes the entry. */
  | { entryId: string; clientId: string; disposition: "settled" }
  /** A server-side reject was recorded — the client tombstones the entry with the
   *  human copy so the capturing guide is not left guessing. */
  | { entryId: string; clientId: string; disposition: "rejected"; reason: FwRejectReason; note: string }
  /** No answer arrived — the client keeps the entry and the next signal retries. */
  | { entryId: string; clientId: string; disposition: "retry" };

/** The IndexedDB mutation one outcome implies, decided purely so the client loop is
 *  a thin driver and the branch set is COMPILER-ENFORCED exhaustive (a new
 *  disposition trips the `never` default, rather than silently degrading to a
 *  retry — api-contract + kieran-typescript review). */
export type FwOutcomeMutation =
  | { op: "delete" }
  | { op: "put"; entry: FwQueueEntry };

export function applyFwDrainOutcome(
  entry: FwQueueEntry,
  outcome: FwDrainOutcome,
  nowIso: string
): FwOutcomeMutation {
  switch (outcome.disposition) {
    case "settled":
      return { op: "delete" };
    case "rejected":
      // A LOCAL tombstone with the staff-visible note — the authoritative record is
      // the path_fw_replay_rejects row the drain already wrote.
      return { op: "put", entry: { ...entry, blocked: { reason: outcome.reason, note: outcome.note } } };
    case "retry":
      return { op: "put", entry: { ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso } };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/* ══════════════════════════════════════════ block-until-drained sign-out ══ */

/**
 * How the queue's raw records bear on sign-out — the SINGLE classification both the
 * verdict and the destructive clear read.
 *
 * THE DEFECT THIS SHAPE EXISTS TO KILL: sign-out asks two questions — "may this
 * device sign out?" and "may this queue be destroyed?" — and they are the same
 * question asked of each record. They used to be answered by two hand-written
 * predicates that disagreed: the verdict counted only `drainable`, while
 * `clearFwQueueIfEmpty` used a bare `store.count()` that counted EVERYTHING. A
 * device holding exactly one blocked or one foreign entry was therefore told
 * sign-out was allowed and then told a check-in had raced in — permanently, with no
 * surface to act on. Both sides now fold over THIS partition, so a future divergence
 * is a compile-or-test failure rather than a wedged iPad at a live event.
 *
 * The five classes, and why each falls where it does:
 *   - `drainable`        this guide's un-landed taps. Must be sent before sign-out.
 *   - `ownBlocked`       this guide's taps with a server-recorded reject. The
 *                        authoritative record is the `path_fw_replay_rejects` row;
 *                        the local tombstone is only the note they have now read, so
 *                        clearing it destroys nothing that is not already recorded.
 *   - `quarantined`      a shape this build cannot drain. An UN-LANDED capture that a
 *                        blind clear would lose — must be dismissed by a human first.
 *   - `foreignUndrained` another account's un-landed work. REFUSES: no drain under
 *                        this session can ship it (the drain scopes to the signed-in
 *                        actor by design), so clearing it would silently destroy a
 *                        different guide's captures.
 *   - `foreignBlocked`   another account's already-rejected work — clearable for the
 *                        same reason `ownBlocked` is, and it is not this guide's note
 *                        to read anyway.
 */
export type FwSignOutQueueClassification = {
  drainable: FwQueueEntry[];
  ownBlocked: FwQueueEntry[];
  quarantined: FwQuarantinedRecord[];
  foreignUndrained: FwQueueEntry[];
  foreignBlocked: FwQueueEntry[];
};

/**
 * Partition a raw queue read for the sign-out decision. Reuses `partitionFwQueue`
 * (recognition) and `selectFwDrainable` (the actor scope) rather than re-deriving
 * either — a second recognition model is the bug this module's header warns about.
 */
export function classifyFwSignOutQueue(
  raw: readonly unknown[],
  actorUserId: string
): FwSignOutQueueClassification {
  const { recognized, quarantined } = partitionFwQueue(raw);
  const own = selectFwDrainable(recognized, actorUserId);
  const foreign = recognized.filter((e) => e.actorUserId !== actorUserId);
  return {
    drainable: own.filter((e) => e.blocked === null),
    ownBlocked: own.filter((e) => e.blocked !== null),
    quarantined,
    foreignUndrained: foreign.filter((e) => e.blocked === null),
    foreignBlocked: foreign.filter((e) => e.blocked !== null),
  };
}

/**
 * How many records stand between this device and an allowed, destructive clear —
 * the ONE definition of "the queue is not empty enough to wipe."
 */
export function countFwSignOutBlockers(queue: FwSignOutQueueClassification): number {
  return queue.drainable.length + queue.quarantined.length + queue.foreignUndrained.length;
}

/**
 * Whether ONE raw record forbids the queue being cleared — the predicate
 * `clearFwQueueIfEmpty` counts with, inside its own transaction.
 *
 * Deliberately expressed as `countFwSignOutBlockers(classifyFwSignOutQueue([raw]))`
 * rather than as a hand-written test of the same conditions: the check and the act
 * then agree BY CONSTRUCTION, because they are literally the same two functions. The
 * clear may not simply re-use the verdict's count — a tap can be enqueued in the
 * window between them, which is why the count is re-taken inside the transaction —
 * but it must re-take it with the same rule.
 */
export function fwEntryBlocksSignOutClear(raw: unknown, actorUserId: string): boolean {
  return countFwSignOutBlockers(classifyFwSignOutQueue([raw], actorUserId)) > 0;
}

/**
 * What this device is holding, in the four numbers any chrome needs to describe it —
 * the staff bar's queue chip reads exactly this (Unit 3, R24).
 *
 * Derived from the SAME classification the verdict and the clear fold over, so the
 * chip can never say "nothing queued" on a device whose sign-out is about to refuse.
 * `summarizeFwQueue` is a different thing and stays: it is the `/fp/fw` indicator's
 * own-captures count, already scoped by the caller.
 */
export type FwDeviceQueueState = {
  /** This account's own captures still to send. */
  queuedCount: number;
  /** Another account's un-landed captures, sitting on this device. */
  foreignCount: number;
  /** Records this app version cannot drain — a human must dismiss them. */
  attentionCount: number;
  /** The last drain hit a genuinely expired session. */
  authRequired: boolean;
  online: boolean;
};

export function summarizeFwDeviceQueue(input: {
  queue: FwSignOutQueueClassification;
  authRequired: boolean;
  online: boolean;
}): FwDeviceQueueState {
  return {
    queuedCount: input.queue.drainable.length,
    foreignCount: input.queue.foreignUndrained.length,
    attentionCount: input.queue.quarantined.length,
    authRequired: input.authRequired,
    online: input.online,
  };
}

/** A refused sign-out, split out so the copy switch can be exhaustive over the
 *  reasons alone (a missed case is TS2366, not a blank message at a live event). */
export type FwSignOutRefusal = {
  ok: false;
  reason:
    /** Queued own captures, no network — the device stays with its guide. */
    | "queued_offline"
    /** Queued own captures, online — the caller drains and re-checks. */
    | "drain_first"
    /** A drain already ran and the queue did not move (captive portal / dead uplink). */
    | "drain_stalled"
    /** The session expired before the queue could be sent — re-auth, don't retry. */
    | "session_expired"
    /** Another account's un-landed work is on this device. */
    | "foreign_queue"
    /** Quarantined records a human must dismiss. */
    | "needs_attention"
    /** Minted by the caller on a queue-read failure — sign-out must never fail OPEN
     *  on an unread queue and then destroy it. */
    | "unreadable";
  queuedCount: number;
};

export type FwSignOutVerdict = { ok: true } | FwSignOutRefusal;

/**
 * The sign-out verdict (Decision 8 / gap G1).
 *
 * A shared guide iPad rotates operators, so its queue must never be abandoned:
 * signing out with queued items OFFLINE is refused with a count (no drain is
 * possible, and no new sign-in is possible either — the accepted, stated consequence
 * is that the device stays with its guide until reconnect). ONLINE, the queue CAN
 * drain, so sign-out asks to drain first; the caller runs a drain and re-checks.
 * QUARANTINED entries (a shape this app version can't drain) block with
 * `needs_attention` — un-landed captures a blind clear would destroy, so the guide
 * must dismiss them first (never a silent drop). Only a queue with NOTHING blocking
 * allows sign-out — at which point the caller clears the queue, the roster cache,
 * and the shell cache.
 *
 * REFUSAL PRECEDENCE — every refusal must name something the guide can actually do
 * from the surface they are standing on, so the order is "what is true first":
 *   1. foreign undrained — no drain, no reconnect and no re-auth by THIS guide can
 *      resolve it, so naming anything else sends them round a loop that cannot close.
 *   2. offline — dominates an expired session, because re-authenticating is itself
 *      impossible offline.
 *   3. expired session — a drain returning `no_session` used to leave the verdict at
 *      `drain_first` forever while the copy claimed the captures were "still sending."
 *   4. drained-and-unchanged — `navigator.onLine` is TRUE behind a venue captive
 *      portal, so repeating `drain_first` is an infinite "try again in a moment."
 *   5. quarantined-only — last, because a drain clears the drainable ones first.
 */
export function decideFwSignOut(input: {
  queue: FwSignOutQueueClassification;
  online: boolean;
  /** The client's `isFwAuthRequired()` — the last drain hit a truly-expired session. */
  authRequired?: boolean;
  /** True on the RE-check, after the caller has already run one waited drain. */
  drainAttempted?: boolean;
}): FwSignOutVerdict {
  const { queue } = input;
  if (countFwSignOutBlockers(queue) === 0) return { ok: true };

  if (queue.foreignUndrained.length > 0) {
    return { ok: false, reason: "foreign_queue", queuedCount: queue.foreignUndrained.length };
  }

  const queuedCount = queue.drainable.length;
  if (queuedCount > 0) {
    if (!input.online) return { ok: false, reason: "queued_offline", queuedCount };
    if (input.authRequired) return { ok: false, reason: "session_expired", queuedCount };
    return input.drainAttempted
      ? { ok: false, reason: "drain_stalled", queuedCount }
      : { ok: false, reason: "drain_first", queuedCount };
  }

  // Only quarantined records remain — dismissible, but never silently wiped.
  return { ok: false, reason: "needs_attention", queuedCount: queue.quarantined.length };
}

/* ═══════════════════════════════════════════════ the device-evidence gate ══ */

/**
 * What this device shows of ever having run Founders Weekend.
 *
 * `unknown` is NOT a third state of the world — it is the read itself having thrown
 * (Safari's storage policy can reject `localStorage` outright). It is carried as data
 * so the fail-closed choice is made in one tested place rather than in a `catch`.
 */
export type FwDeviceEvidence =
  | {
      kind: "read";
      /** The `fw.cacheOwner` localStorage key, written on every FW mount. */
      cacheOwner: string | null;
      /** Whether THIS document has ever opened the queue database. */
      queueDbOpened: boolean;
      /**
       * Whether the queue database EXISTS on this origin, from
       * `indexedDB.databases()` — `null` where that call is unavailable or threw.
       * The one signal that answers the question directly rather than by proxy.
       */
      queueDbExists: boolean | null;
    }
  | { kind: "unknown" };

/**
 * Should sign-out look at the FW queue at all?
 *
 * `openFwDb()` CREATES the queue database as a side effect of asking whether it is
 * empty. On the browser of a staff member who has never opened Founders Weekend that
 * is pure harm: if the open rejects (Safari storage policy, a locked-down profile,
 * `onblocked` behind another tab) the verdict is `unreadable` and their sign-out is
 * blocked permanently on a queue that never existed.
 *
 * ── B1, and why the order below is the fix (Staff Front Door Unit 3) ───────────
 * This gate used to be `cacheOwner !== null || queueDbOpened`, and that FAILED OPEN.
 * `cacheOwner === null && !queueDbOpened` is indistinguishable from "this device
 * holds an undrained queue but localStorage was evicted" — localStorage and
 * IndexedDB evict independently, and `queueDbOpened` is per-DOCUMENT and false on
 * every fresh load. Sign-out then skipped the queue check entirely and abandoned
 * verified check-ins on a shared iPad. Four reviewers converged on it. It was
 * unreachable only because `FwPwa` opened the database on every mount of the layout
 * that rendered the sign-out button — incidental coupling, and the staff bar mounts
 * outside that group.
 *
 * The fix is NOT a harder client-storage heuristic. It is two signals the heuristic
 * never had, checked before it:
 *
 *   1. `actorIsFwGuide` — SERVER-KNOWN at the layout that mounts the bar (the actor
 *      holds at least one `guide` grant). Storage-independent by construction, so no
 *      eviction of anything can hide it. A guide's queue is always checked, full
 *      stop. Staff hold no grants by design (`fw-auth.ts`), so this stays FALSE for
 *      the CRM-only staff member the gate exists to protect — it is a real branch,
 *      not a constant.
 *   2. `queueDbExists` — `indexedDB.databases()`, which asks the question directly.
 *      If the database does not exist there is definitionally no queue AND opening it
 *      would create it, so skipping is both safe and the whole point. If it DOES
 *      exist, opening it creates nothing, so checking is free. (An older comment
 *      dismissed `databases()` because "Safari lacks it" — true of pre-2024 Safari
 *      only. It is Baseline since May 2024. Where it is genuinely absent the value is
 *      `null` and the legacy heuristic still answers, for non-guides only.)
 *
 * Fails CLOSED on `unknown`: "I could not look" must never be read as "there is
 * nothing here," because the act it authorises is destructive.
 */
export function hasFwDeviceEvidence(input: {
  evidence: FwDeviceEvidence;
  /** SERVER-KNOWN: this actor holds an FW guide grant. See (1) above. */
  actorIsFwGuide: boolean;
}): boolean {
  if (input.actorIsFwGuide) return true;
  const { evidence } = input;
  if (evidence.kind === "unknown") return true;
  if (evidence.queueDbExists !== null) return evidence.queueDbExists;
  return evidence.cacheOwner !== null || evidence.queueDbOpened;
}

/* ═══════════════════════════════════════════════ the residue clear ══ */

/**
 * What a residue clear actually managed to destroy — all three parts, reported
 * SEPARATELY (Staff Front Door Unit 3, B3).
 *
 * The old shape was `{ cleared: boolean }` computed solely from the queue step: a
 * throwing `clearFwRoster()` or `caches.delete()` was logged and swallowed, so the
 * function reported success while its own comment promised "all three residues
 * together, or none". `runFwSignOutFlow` read that as authorisation to end the
 * session, and a previous guide's cached roster — children's first and last names —
 * plus the authenticated app shell survived for the next operator, who was told the
 * sign-out had worked.
 */
export type FwResidueClearResult = {
  /** The tap queue was emptied (or held nothing that blocks a clear). */
  queueCleared: boolean;
  /** The IndexedDB roster cache was cleared, or was deliberately not attempted. */
  rosterCleared: boolean;
  /** The service-worker app-shell cache was deleted, or was not attempted. */
  shellCleared: boolean;
};

/** Every residue is gone. The ONE definition — `runFwSignOutFlow` and the cache-owner
 *  reconcile both gate on it, so neither can drift back to reading the queue step
 *  alone. */
export function fwResidueFullyCleared(result: FwResidueClearResult): boolean {
  return result.queueCleared && result.rosterCleared && result.shellCleared;
}

/**
 * Which caller is clearing, and therefore what happens to the roster and shell caches
 * when the QUEUE could not be cleared.
 *
 *   - `sign_out` — all three together or none. An aborted sign-out (a tap raced in)
 *     must not leave the guide with a degraded offline shell on exactly the flaky
 *     connectivity that caused the race.
 *   - `handover` — the caches hold the PRIOR account's children's names and authed
 *     HTML. Keeping them protects nobody, so they go whatever the queue does.
 */
export type FwResiduePolicy = "sign_out" | "handover";

export function shouldClearFwCaches(policy: FwResiduePolicy, queueCleared: boolean): boolean {
  return policy === "handover" || queueCleared;
}

/* ═══════════════════════════════════════════════ the sign-out sequence ══ */

/**
 * The browser seams the sign-out sequence needs — every one of them an IndexedDB,
 * `navigator` or Web Locks call that cannot exist under a node-only test runner. The
 * sequence itself stays pure and lives here, because it IS the composition the live
 * defect lived in; written inline in the button it would be invisible to CI.
 */
export type FwSignOutPorts = {
  /** Evidence this device ever ran FW. Read BEFORE anything OPENS IndexedDB —
   *  `indexedDB.databases()` is async but creates nothing, which is the point. */
  readEvidence: () => Promise<FwDeviceEvidence>;
  /** Raw queue records, read behind any pending write. May reject — see `unreadable`. */
  readQueue: () => Promise<readonly unknown[]>;
  isOnline: () => boolean;
  isAuthRequired: () => boolean;
  /**
   * ONE drain pass, LOCK-FREE — the sequence already holds `fw-offline-drain` and
   * Web Locks are not reentrant, so a drain that re-acquired it would hang forever.
   */
  drain: () => Promise<void>;
  /**
   * Atomic check-and-clear under the predicate this sequence supplies. Re-counts
   * inside its own transaction (a tap can land in the gap) but with the SAME rule the
   * verdict used. Reports all three residues separately — see `FwResidueClearResult`.
   */
  clear: (
    blocksClear: (raw: unknown) => boolean,
    policy: FwResiduePolicy
  ) => Promise<FwResidueClearResult>;
  /**
   * Acquire the single-drainer lock and run `fn` under it. Held across
   * verdict → drain → re-verdict → clear, so a background drain in another tab cannot
   * land a tap between the check and the act. Acquired at EXACTLY this one level.
   */
  withDrainLock: <T>(fn: () => Promise<T>) => Promise<T>;
};

export type FwSignOutOutcome =
  /** Nothing is left to lose — the caller may end the session. */
  | { kind: "sign_out" }
  | { kind: "refused"; verdict: FwSignOutRefusal }
  /** A capture landed between the verdict and the clear, so the clear no-opped —
   *  abort rather than sign out having lost it. */
  | { kind: "raced" }
  /**
   * The queue went, but the roster cache or the app-shell cache did NOT (B3). The
   * session is deliberately left OPEN. The counter-argument is real and was weighed:
   * an un-ended session on a shared iPad is worse than a stale cache. It loses
   * because ending the session here is silent — the guide walks away believing the
   * handover was clean while children's names sit in a cache — whereas refusing puts
   * a sentence naming the remedy in front of the person still holding the device.
   */
  | { kind: "clear_failed" };

async function fwVerdictNow(
  ports: FwSignOutPorts,
  actorUserId: string,
  drainAttempted: boolean
): Promise<FwSignOutVerdict> {
  let raw: readonly unknown[];
  try {
    raw = await ports.readQueue();
  } catch {
    // Fail CLOSED: a queue we cannot read must never be destroyed on the strength of
    // not being able to see it (the old fail-open path let a transient IndexedDB error
    // wipe undrained captures).
    return { ok: false, reason: "unreadable", queuedCount: 0 };
  }
  return decideFwSignOut({
    queue: classifyFwSignOutQueue(raw, actorUserId),
    online: ports.isOnline(),
    authRequired: ports.isAuthRequired(),
    drainAttempted,
  });
}

/**
 * The whole block-until-drained sign-out: evidence gate → verdict → (drain →
 * re-verdict) → atomic clear.
 *
 * The evidence gate runs OUTSIDE the lock and before any IndexedDB call, so a staff
 * member who has never run Founders Weekend pays nothing and creates nothing. The
 * rest runs under ONE acquisition of `fw-offline-drain`: the verdict and the clear
 * must observe the same queue, and the drain between them is the reason the lock
 * exists at all. At most ONE drain is attempted — a second would be the same spin the
 * `drain_stalled` refusal exists to break.
 */
export async function runFwSignOutFlow(input: {
  actorUserId: string;
  /** SERVER-KNOWN at the layout: this actor holds an FW guide grant. See
   *  `hasFwDeviceEvidence` — this is B1's fix, and it must not be inferred client-side. */
  actorIsFwGuide: boolean;
  ports: FwSignOutPorts;
}): Promise<FwSignOutOutcome> {
  const { actorUserId, actorIsFwGuide, ports } = input;
  const evidence = await ports.readEvidence();
  if (!hasFwDeviceEvidence({ evidence, actorIsFwGuide })) return { kind: "sign_out" };

  return ports.withDrainLock(async () => {
    let verdict = await fwVerdictNow(ports, actorUserId, false);
    if (!verdict.ok && verdict.reason === "drain_first") {
      await ports.drain();
      verdict = await fwVerdictNow(ports, actorUserId, true);
    }
    if (!verdict.ok) return { kind: "refused", verdict };

    const result = await ports.clear(
      (raw) => fwEntryBlocksSignOutClear(raw, actorUserId),
      "sign_out"
    );
    if (!result.queueCleared) return { kind: "raced" };
    // B3: `queueCleared` alone is NOT authorisation to end the session. The roster
    // cache holds children's first and last names and the shell cache holds
    // authenticated HTML; either surviving is a handover leak, and reporting success
    // on top of it is the part that makes it invisible.
    return fwResidueFullyCleared(result) ? { kind: "sign_out" } : { kind: "clear_failed" };
  });
}

/* ═══════════════════════════════════════════ the cache-owner reconcile ══ */

/**
 * What the bar should do about the `fw.cacheOwner` key it just read.
 *
 * Split out from the sequence so the three-way choice is testable on its own, and so
 * "who may WRITE this key" is a single decision rather than an `if` in a component.
 *
 * `adopt` is deliberately NOT returned for a null owner on a non-FW surface. The key
 * means "the account whose roster/shell residue is on this device", and the staff bar
 * mounts on `/crm` and `/staff`, where no residue is created. Writing it there would
 * mark a browser that has never run Founders Weekend as holding FW residue — which is
 * precisely the input `hasFwDeviceEvidence`'s legacy branch reads, so the bar would
 * manufacture the evidence it later trusts.
 */
export type FwCacheOwnerAction = "none" | "adopt" | "reconcile";

export function decideFwCacheOwnerAction(input: {
  prior: string | null;
  actorUserId: string;
  /** True only where FW residue is actually created — the `/fp/fw` surfaces. */
  surfaceCreatesResidue: boolean;
}): FwCacheOwnerAction {
  if (input.prior === input.actorUserId) return "none";
  if (input.prior === null) return input.surfaceCreatesResidue ? "adopt" : "none";
  return "reconcile";
}

/** The browser seams the handover reconcile needs — same shape and same reasons as
 *  `FwSignOutPorts`, plus the owner key itself. */
export type FwReconcilePorts = Pick<
  FwSignOutPorts,
  "readQueue" | "isOnline" | "drain" | "clear" | "withDrainLock"
> & {
  /** The persisted owner, or `undefined` when the read itself threw. */
  readOwner: () => string | null | undefined;
  /** Persist the new owner. `false` when the write failed (private mode). */
  writeOwner: (owner: string) => boolean;
};

export type FwReconcileOutcome =
  /** Same account, or nothing recorded — no residue belongs to anyone else. */
  | { kind: "none" }
  /** First FW use on this device: the key was claimed, nothing was destroyed. */
  | { kind: "adopted" }
  /** A handover: every residue went and the key now names this actor. */
  | { kind: "reconciled" }
  /**
   * A handover where undrained captures were found and DELIBERATELY preserved. The
   * key is NOT advanced, so the device stays visibly un-reconciled and the next mount
   * tries again. Sign-out refuses on these via `foreign_queue` — which is the surface
   * that actually names the other guide.
   */
  | { kind: "queue_preserved"; preservedCount: number }
  /** A clear THREW. The key is not advanced, so this is retried rather than masked. */
  | { kind: "clear_failed" };

/**
 * Reconcile a device that changed hands (Staff Front Door Unit 3, B2).
 *
 * ── What this replaces, and why ────────────────────────────────────────────────
 * `reconcileFwCacheOwner` used to call an unconditional `purgeFwResidue()`, whose
 * docblock justified wiping the queue with *"block-until-drained already prevented an
 * offline handoff."* That argument holds only where a drain engine is mounted and
 * only when the outgoing guide actually tapped sign-out — and the purge fired on
 * EVERY mount where identity differed, which is the ordinary shared-iPad handover
 * after a crash, a revoked grant, or a forgotten sign-out. It then returned
 * `Promise<void>`, swallowing all three clears, while the caller advanced
 * `fw.cacheOwner` regardless: a failed purge was permanently masked, because the key
 * now matched and the mismatch never recurred.
 *
 * Both are fixed here, and the second is what makes the first stick: the key advances
 * ONLY on a fully successful clear, so a preserved queue or a throwing clear leaves
 * the device visibly un-reconciled.
 *
 * ── Why the drain is attempted but cannot save the prior guide ─────────────────
 * The drain scopes to the SIGNED-IN actor by design (`selectFwDrainable`), and the
 * server action re-authes as that session — so the prior owner's captures are
 * `foreignUndrained` and no drain under this session can ever ship them. The drain
 * here is for the entries that ARE this actor's; the prior owner's are preserved and
 * surfaced by sign-out's `foreign_queue` refusal, which names the account that has to
 * come back. Destroying them is the one thing this function must never do.
 */
export async function runFwCacheOwnerReconcile(input: {
  actorUserId: string;
  surfaceCreatesResidue: boolean;
  ports: FwReconcilePorts;
}): Promise<FwReconcileOutcome> {
  const { actorUserId, ports } = input;
  const prior = ports.readOwner();
  // A localStorage read that threw is treated as "no persisted owner", exactly as it
  // was before: with no prior owner there is no other account's residue to attribute,
  // and a device whose storage cannot be read cannot be reconciled against anything.
  const action = decideFwCacheOwnerAction({
    prior: prior === undefined ? null : prior,
    actorUserId,
    surfaceCreatesResidue: input.surfaceCreatesResidue,
  });
  if (action === "none") return { kind: "none" };
  if (action === "adopt") {
    ports.writeOwner(actorUserId);
    return { kind: "adopted" };
  }

  return ports.withDrainLock(async () => {
    // Ship what this session CAN ship before anything destructive runs. A read that
    // throws is not fatal here — the atomic clear below re-reads under its own
    // transaction and fails closed on its own.
    if (ports.isOnline()) {
      let drainable = 0;
      try {
        drainable = classifyFwSignOutQueue(await ports.readQueue(), actorUserId).drainable.length;
      } catch {
        drainable = 0;
      }
      if (drainable > 0) await ports.drain();
    }

    let preservedCount = 0;
    try {
      preservedCount = countFwSignOutBlockers(
        classifyFwSignOutQueue(await ports.readQueue(), actorUserId)
      );
    } catch {
      // Unknown, and the clear's own predicate is what actually decides. Reported as
      // 0 rather than guessed at; the queue is still protected by the atomic clear.
      preservedCount = 0;
    }

    const result = await ports.clear(
      (raw) => fwEntryBlocksSignOutClear(raw, actorUserId),
      "handover"
    );
    // A THROWN clear outranks a deliberately preserved queue: both leave the key
    // un-advanced, but only one of them is a fault, and collapsing them would put this
    // right back where B2 started — a failure indistinguishable from a policy.
    if (!result.rosterCleared || !result.shellCleared) return { kind: "clear_failed" };
    if (!result.queueCleared) return { kind: "queue_preserved", preservedCount };
    ports.writeOwner(actorUserId);
    return { kind: "reconciled" };
  });
}

/* ═══════════════════════════════════════════════════ sign-out copy ══ */

/**
 * The guide-facing sentence for one refusal. Extracted from the button and pure, for
 * two reasons: this repo runs node-only tests, so copy written inline in a `.tsx` is
 * untested; and the `default`-less switch makes a new refusal reason a COMPILE error
 * (TS2366 — not all code paths return a value) rather than a blank message on a
 * shared iPad at a live event.
 *
 * Every branch names an action available on the surface the guide is standing on.
 */
export function fwSignOutRefusalCopy(
  reason: FwSignOutRefusal["reason"],
  count: number,
  /**
   * WHERE the guide is standing. Only `needs_attention` differs, and it has to:
   * dismissing a quarantined record needs the queued-indicator banner, which `FwPwa`
   * renders on `/fp/fw` only. Off that subtree the old sentence named a control that
   * is not on the screen — the carried-forward gap the staff bar creates the moment
   * it puts this refusal on `/staff` and `/crm`. Defaulted, so the FW callers that
   * predate the bar are unchanged.
   */
  surface: FwSignOutSurface = "fw"
): string {
  const s = count === 1 ? "" : "s";
  const them = count === 1 ? "it" : "them";
  if (reason === "needs_attention" && surface === "elsewhere") {
    return `${count} saved check-in${s} couldn't be read by this app version. Open Founders Weekend and dismiss ${them} there, then sign out.`;
  }
  switch (reason) {
    case "queued_offline":
      return `${count} check-in${s} haven't sent yet. Stay signed in until you're back online — they'll send automatically.`;
    case "drain_first":
      return `${count} check-in${s} are still sending. Try again in a moment.`;
    case "drain_stalled":
      // NOT "try again in a moment" — behind a venue captive portal `onLine` is true
      // and that sentence is an infinite loop. Name the thing that is actually wrong.
      return `${count} check-in${s} couldn't be sent. This device looks connected but can't reach The 120 — open the wi-fi sign-in page, or stay signed in until the network is back.`;
    case "session_expired":
      return `Your session expired before ${count} check-in${s} could send. Sign in again to send ${them}, then sign out.`;
    case "foreign_queue":
      return `${count} check-in${s} on this device belong to another account and haven't sent. That guide needs to sign in here and let ${them} send before this device can be signed out.`;
    case "needs_attention":
      return `${count} saved check-in${s} couldn't be read by this app version. Dismiss ${them} in the banner, then sign out.`;
    case "unreadable":
      return "Couldn't check your saved check-ins just now. Try again in a moment.";
  }
}

/** Which chrome the sign-out was requested from. `/fp/fw` renders the queued
 *  indicator's dismiss banner; nothing else does. */
export type FwSignOutSurface = "fw" | "elsewhere";

/** The message for a whole sequence outcome, or `null` when the session may end.
 *  `default`-less for the same TS2366 reason as `fwSignOutRefusalCopy`. */
export function fwSignOutOutcomeCopy(
  outcome: FwSignOutOutcome,
  surface: FwSignOutSurface = "fw"
): string | null {
  switch (outcome.kind) {
    case "sign_out":
      return null;
    case "raced":
      return "A check-in just came in — try signing out again in a moment.";
    case "clear_failed":
      // B3. Names the only remedy that actually works when a cache delete keeps
      // failing, and says plainly that the device is not safe to hand over — because
      // the failure this replaces was reported to the guide as success.
      return "Your check-ins sent, but this device still holds Founders Weekend data and you're still signed in. Try again — if it keeps failing, don't hand this device over until someone clears the browser's site data.";
    case "refused":
      return fwSignOutRefusalCopy(outcome.verdict.reason, outcome.verdict.queuedCount, surface);
  }
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
    // The predicate claims `x is FwQueueEntry`, so it must verify EVERY field the
    // 14-field shape declares — not just the identity ones. `lastAttemptAt` is
    // required `string | null` (the server's zod schema enforces it too, so a
    // client-recognized entry that skipped this check would fail the batch parse and
    // stall the whole queue), and a malformed `blocked` would render a blank
    // staff-visible note (api-contract review).
    (e.lastAttemptAt === null || typeof e.lastAttemptAt === "string") &&
    isRecognizedFwBlocked(e.blocked) &&
    (e.schemaVersion === undefined || e.schemaVersion === FW_QUEUE_ENTRY_SCHEMA_VERSION)
  );
}

/** A `blocked` field is either null or a `{reason, note}` pair with string values —
 *  the shape `summarizeFwQueue` and the indicator read unguarded. */
function isRecognizedFwBlocked(b: unknown): boolean {
  if (b === null || b === undefined) return true;
  if (typeof b !== "object") return false;
  const rec = b as Record<string, unknown>;
  return typeof rec.reason === "string" && typeof rec.note === "string";
}

/** A note for a record this app version cannot drain (future schema / corrupt) —
 *  surfaced, dismissible, never silently dropped. */
export const FW_QUARANTINE_NOTE =
  "This saved check-in is from a different app version and can't be sent. Dismiss it, or update the app and sign in again.";

/** One quarantined record — a shape this app version cannot drain, surfaced by id
 *  and note so it can be shown and dismissed. Deliberately NOT a `FwQueueEntry`. */
export type FwQuarantinedRecord = { id: string; note: string };

/**
 * Partition a raw IndexedDB read into drainable entries and quarantined records.
 *
 * A record that fails `isRecognizedFwEntry` (a future schema, a corrupt shape) is
 * NOT cast into a `FwQueueEntry` it does not satisfy — an earlier version wrote
 * `{...record, blocked} as FwQueueEntry`, but adding `blocked` never fixed what made
 * it unrecognized, so it failed recognition again on every later read and vanished
 * from every view (kieran-typescript / reliability / api-contract review: it could
 * then be silently destroyed by sign-out). Instead it is surfaced directly from the
 * raw record by its id, with its own note, on every scan — no write, no lying cast,
 * never a silent drop of a child's captured check-in.
 *
 * PURE, and here rather than in the client wrapper, because the sign-out
 * classification is built on it and every sign-out decision must be testable under a
 * node-only runner. A record with no usable `id` is neither surfaced nor counted:
 * there is nothing to show the guide and nothing dismissible, so pretending it is
 * actionable would wedge sign-out on a record no surface can name.
 */
export function partitionFwQueue(raw: readonly unknown[]): {
  recognized: FwQueueEntry[];
  quarantined: FwQuarantinedRecord[];
} {
  const recognized: FwQueueEntry[] = [];
  const quarantined: FwQuarantinedRecord[] = [];
  for (const record of raw) {
    if (isRecognizedFwEntry(record)) {
      recognized.push(record);
      continue;
    }
    const shell = record as { id?: unknown; blocked?: unknown };
    if (typeof shell.id === "string") {
      const note =
        typeof shell.blocked === "object" &&
        shell.blocked !== null &&
        typeof (shell.blocked as { note?: unknown }).note === "string"
          ? (shell.blocked as { note: string }).note
          : FW_QUARANTINE_NOTE;
      quarantined.push({ id: shell.id, note });
    }
  }
  return { recognized, quarantined };
}

/* ═══════════════════════════════════════════════ grouping, ordering, scope ══ */

/** The reduction's grouping key — the cohort is in the key because two cohorts can
 *  never share a (student, task) drain sequence (a returner belongs to two). */
export function fwStudentTaskKey(entry: Pick<FwQueueEntry, "cohortId" | "studentId" | "taskId">): string {
  return `${entry.cohortId}\x00${entry.studentId}\x00${entry.taskId}`;
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
