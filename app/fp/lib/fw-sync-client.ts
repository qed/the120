/**
 * The FW offline client orchestration (FW Unit 8) — the page-context half of the
 * drain, and the ONLY code that touches IndexedDB.
 *
 * First Profit splits its client engine (`sync-engine.ts`) from its PWA shell
 * (`PathPwa`); FW mirrors that split. `fw-sync-engine.ts` is the db-taking drain
 * CORE (harness-tested, runs server-side via the action or in the CLI); THIS module
 * is the client loop that reads the IndexedDB queue, ships it through the
 * `drainFwQueue` action, and applies the outcomes back — plus the enqueue path, the
 * roster cache, the queued-summary subscription, and the sign-out verdict. `FwPwa`
 * wires the foreground signals to it and renders the indicator.
 *
 * Client-only: `indexedDB`/`navigator` are touched inside functions, never at
 * module scope, so importing this stays env-less-build-safe. Nothing here is
 * unit-testable (node has no IndexedDB), which is why every decision it takes comes
 * from `fw-sync-rules.ts` (pure, tested) and every write goes through
 * `runFwCheckIn` at the far end.
 *
 * DRAINS FROM PAGE CONTEXT, never the service worker — iOS kills a backgrounded SW
 * mid-request. The SW's Background Sync only posts "path-drain" back to open pages,
 * which lands on the same foreground kick as `online`/`visibilitychange`.
 */

import { isNextRedirect } from "@/app/fp/lib/next-redirect";
import { drainFwQueue } from "@/app/fp/lib/actions/fw-sync";
import { FW_ACTION_TIMEOUT_MS, withFwTimeout } from "@/app/fp/lib/fw-call";
import {
  clearFwQueue,
  clearFwQueueIfEmpty,
  clearFwRoster,
  deleteFwEntry,
  getFwRoster,
  hasFwQueueDbOpened,
  isFwQueueSupported,
  listFwRawEntries,
  listFwRawEntriesSerialized,
  putFwEntry,
  putFwRoster,
} from "@/app/fp/lib/fw-queue";
import {
  applyFwDrainOutcome,
  classifyFwSignOutQueue,
  FW_AUTO_RETRY_ATTEMPT_CEILING,
  FW_QUEUE_ENTRY_SCHEMA_VERSION,
  FW_ROSTER_CACHE_SCHEMA_VERSION,
  FW_SHELL_CACHE_NAME,
  isFwRosterCacheUsable,
  partitionFwQueue,
  runFwSignOutFlow,
  selectFwDrainable,
  summarizeFwQueue,
  type FwCachedRosterStudent,
  type FwDeviceEvidence,
  type FwQuarantinedRecord,
  type FwQueueEntry,
  type FwQueueEntryInput,
  type FwQueueSummary,
  type FwRosterCache,
  type FwSignOutOutcome,
} from "@/app/fp/lib/fw-sync-rules";

/* ══════════════════════════════════════════════════════════ subscription ══ */

const listeners = new Set<() => void>();
let authRequired = false;

/** Subscribe to queue mutations (the indicator re-reads on change). */
export function subscribeFwQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when the last drain hit a truly-expired session — surfaced as a re-auth
 *  prompt (Decision 14), never an auth-redirect of the cached shell. */
export function isFwAuthRequired(): boolean {
  return authRequired;
}

function notify(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch (e) {
      console.error("[fw/sync] queue listener threw:", e);
    }
  }
}

const nowIso = () => new Date().toISOString();

/* ══════════════════════════════════════════════════════════════ enqueue ══ */

export type FwEnqueueResult =
  | { ok: true; ids: string[] }
  /** Private-mode Safari has no IndexedDB — the caller shows the "this device
   *  cannot capture offline" warning and the tap is refused rather than lost. */
  | { ok: false; reason: "unsupported" }
  | { ok: false; reason: "storage_failed"; ids: string[] };

/**
 * Queue one tap's per-student captures.
 *
 * With no `clientIds`, each student gets a FRESH `clientId` (the entry id IS that
 * key), so two offline not_yet taps on one task are two distinct re-attempt captures.
 * The BACKSTOP path (an online tap that failed to reach the server) passes the
 * `clientIds` the failed call already used, so the drain's replay lands on the RPC's
 * idempotency key and cannot double-apply if the online write had in fact partly
 * landed. The batch shares one `actionId`, so the board still groups the celebration.
 */
export async function enqueueFwCheckIns(p: {
  cohortId: string;
  taskId: string;
  action: FwQueueEntry["action"];
  actorUserId: string;
  studentIds: readonly string[];
  actionId: string;
  capturedAt: string;
  /** Explicit per-student keys for the backstop path; minted fresh when absent. */
  clientIds?: Readonly<Record<string, string>>;
}): Promise<FwEnqueueResult> {
  if (!isFwQueueSupported()) return { ok: false, reason: "unsupported" };
  const ids: string[] = [];
  for (const studentId of p.studentIds) {
    const clientId = p.clientIds?.[studentId] ?? crypto.randomUUID();
    const input: FwQueueEntryInput = {
      clientId,
      actionId: p.actionId,
      studentId,
      taskId: p.taskId,
      action: p.action,
      cohortId: p.cohortId,
      capturedAt: p.capturedAt,
      actorUserId: p.actorUserId,
    };
    const entry: FwQueueEntry = {
      ...input,
      id: clientId,
      schemaVersion: FW_QUEUE_ENTRY_SCHEMA_VERSION,
      enqueuedAt: nowIso(),
      attempts: 0,
      lastAttemptAt: null,
      blocked: null,
    };
    try {
      await putFwEntry(entry);
      ids.push(entry.id);
    } catch (e) {
      console.error("[fw/sync] enqueue persist failed:", e);
      return { ok: false, reason: "storage_failed", ids };
    }
  }
  notify();
  return { ok: true, ids };
}

/** This guide's own pending (non-blocked) captures for one (student, task) — the
 *  task view folds them onto the server state so a revisit mid-outage reflects the
 *  guide's own queued taps, not the stale cached shell (correctness review). */
export async function readPendingFwOpsFor(input: {
  cohortId: string;
  studentId: string;
  taskId: string;
  actorUserId: string;
}): Promise<FwQueueEntry[]> {
  if (!isFwQueueSupported()) return [];
  try {
    const { recognized } = await scanFwQueue();
    return recognized.filter(
      (e) =>
        !e.blocked &&
        e.actorUserId === input.actorUserId &&
        e.cohortId === input.cohortId &&
        e.studentId === input.studentId &&
        e.taskId === input.taskId
    );
  } catch {
    return [];
  }
}

/** Dismiss a tombstoned (rejected) entry the guide has read — the reject is already
 *  recorded server-side, so this only clears the local note. */
export async function dismissFwEntry(id: string): Promise<void> {
  await deleteFwEntry(id);
  notify();
}

/* ══════════════════════════════════════════════════════════ queue reading ══ */

async function scanFwQueue(): Promise<{
  recognized: FwQueueEntry[];
  quarantined: FwQuarantinedRecord[];
}> {
  return partitionFwQueue(await listFwRawEntries());
}

/** This session's own, non-blocked captures — the drain's scope. Expressed through
 *  the SAME classifier the sign-out verdict and the queue clear read, so "what this
 *  guide still owes the server" has exactly one definition in this app. */
async function readDrainableFwEntries(actorUserId: string): Promise<FwQueueEntry[]> {
  return classifyFwSignOutQueue(await listFwRawEntries(), actorUserId).drainable;
}

/** The queued-indicator's counts, scoped to this session (a shared device could
 *  hold a prior guide's residue, but block-until-drained clears it on sign-out).
 *  Quarantined records surface in `attention` so a check-in this build can't drain
 *  is visible and dismissible rather than invisible. */
export async function readFwQueueSummary(actorUserId: string): Promise<FwQueueSummary> {
  try {
    const { recognized, quarantined } = await scanFwQueue();
    const base = summarizeFwQueue(selectFwDrainable(recognized, actorUserId));
    return { queuedCount: base.queuedCount, attention: [...base.attention, ...quarantined] };
  } catch {
    return { queuedCount: 0, attention: [] };
  }
}

/* ══════════════════════════════════════════════════════════════ the drain ══ */

export type FwDrainCtx = { actorUserId: string };
export type FwDrainOptions = { wait?: boolean; includeStuck?: boolean };

let fallbackDrainChain: Promise<void> = Promise.resolve();

/** The single-drainer lock name. An offline three-tab guide iPad must not ship the
 *  same queue thrice, and the sign-out sequence must not have a background drain land
 *  a tap between its check and its act. */
const FW_DRAIN_LOCK = "fw-offline-drain";

/**
 * Run `fn` under the single-drainer lock, WAITING for it if another holder has it.
 *
 * THE ONE PLACE THE LOCK IS TAKEN — read this before adding a second. Web Locks are
 * NOT reentrant: a function that acquires `fw-offline-drain` and then calls another
 * function that acquires it again does not error, it HANGS forever (or, on the
 * `ifAvailable` path, silently skips the inner work and returns as though it ran).
 * The sign-out sequence must hold the lock across verdict → drain → re-verdict →
 * clear, so it passes `drainFwQueueOnce` — the LOCK-FREE inner drain — as its drain
 * port, and takes the lock here exactly once for the whole sequence.
 *
 * Falls back to a module-level promise chain where `navigator.locks` is absent (older
 * Safari): single-document serialization only, which is what that browser can offer.
 */
function withFwDrainLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    return navigator.locks.request(FW_DRAIN_LOCK, fn) as Promise<T>;
  }
  const turn = fallbackDrainChain.then(fn);
  fallbackDrainChain = turn.then(
    () => {},
    () => {}
  );
  return turn;
}

/**
 * ONE drain pass — LOCK-FREE by design. Callers hold `fw-offline-drain` themselves
 * (see `withFwDrainLock`); nothing in here may acquire it.
 *
 * Reads IndexedDB, ships the drainable set through the `drainFwQueue` action (which
 * re-authes, scopes to this session's captures, resolves per-cohort authorization,
 * and runs the tested fold), then applies the per-entry outcomes: settled → delete,
 * rejected → local tombstone with the staff-visible note, retry → attempts++.
 */
async function drainFwQueueOnce(ctx: FwDrainCtx, opts: FwDrainOptions = {}): Promise<void> {
  authRequired = false;
  const drainable = await readDrainableFwEntries(ctx.actorUserId);
  const runnable = opts.includeStuck
    ? drainable
    : drainable.filter((e) => e.attempts < FW_AUTO_RETRY_ATTEMPT_CEILING);
  if (runnable.length === 0) return;

  let raced;
  try {
    // BOUNDED. `withFwTimeout` server-side bounds only what runs AFTER the request
    // lands; a captive portal that silently drops it produces a fetch that never
    // settles. This await happens while `fw-offline-drain` is held, and Web Locks are
    // cross-document — so an unbounded wait here wedges every later drain AND every
    // future sign-out in every tab, with a reload the only escape.
    raced = await withFwTimeout(drainFwQueue(runnable), "drain action", FW_ACTION_TIMEOUT_MS);
  } catch (e) {
    if (isNextRedirect(e)) {
      authRequired = true;
      notify();
      return;
    }
    console.error("[fw/sync] drain action threw:", e);
    return;
  }

  // A timeout is NOT a failed drain — the request may still land server-side, and
  // every entry is idempotent by `clientId`. So dispose of it exactly as the throw
  // branch above does: leave the queue untouched, do NOT advance attempts, do NOT
  // claim the session expired. The sign-out sequence's re-verdict then observes an
  // unchanged queue and returns `drain_stalled`, whose copy names the captive portal
  // instead of looping on "try again in a moment" — the state this unit added.
  if (raced.timedOut) {
    notify();
    return;
  }
  const res = raced.value;

  if (!res.ok) {
    if (res.reason === "no_session") {
      authRequired = true;
      notify();
      return;
    }
    // invalid_input: the WHOLE batch failed server-side validation. With the
    // stricter isRecognizedFwEntry this should be unreachable for client-recognized
    // entries, but if it ever happens, ADVANCE attempts so the batch reaches the
    // auto-retry ceiling and surfaces as "still trying" — never a silent no-op that
    // re-ships the identical failing batch forever with no guide-visible signal
    // (api-contract review).
    for (const entry of runnable) {
      await putFwEntry({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso() });
    }
    notify();
    return;
  }

  // Look outcomes up in the batch we already hold, rather than re-reading each
  // entry from IndexedDB (performance review), and apply the mutation the pure,
  // exhaustive `applyFwDrainOutcome` decides — so a future disposition is a compile
  // error, not a silent retry.
  const byId = new Map(runnable.map((e) => [e.id, e]));
  for (const outcome of res.outcomes) {
    const entry = byId.get(outcome.entryId);
    if (!entry) continue;
    const mutation = applyFwDrainOutcome(entry, outcome, nowIso());
    if (mutation.op === "delete") await deleteFwEntry(outcome.entryId);
    else await putFwEntry(mutation.entry);
  }
  notify();
}

/**
 * Drain the queue once, under the single-drainer lock.
 *
 * Background signals SKIP when a drain is already running (`ifAvailable`); a caller
 * that passes `wait` queues behind it instead — a user-waited-on drain must never
 * silently lose the lock race. The sign-out sequence does NOT call this: it holds the
 * lock itself and calls `drainFwQueueOnce` directly (Web Locks are not reentrant).
 */
export async function runFwClientDrain(ctx: FwDrainCtx, opts: FwDrainOptions = {}): Promise<void> {
  if (!isFwQueueSupported()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const run = () => drainFwQueueOnce(ctx, opts);

  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    if (opts.wait) {
      await withFwDrainLock(run);
    } else {
      await navigator.locks.request(FW_DRAIN_LOCK, { ifAvailable: true }, async (lock) => {
        if (lock) await run();
      });
    }
    return;
  }
  const turn = withFwDrainLock(run);
  if (opts.wait) await turn;
  else void turn.catch(() => {});
}

/* ══════════════════════════════════════════════════════════ foreground signals ══ */

/**
 * Wire the drain to its foreground signals — module start (`load`), `online`,
 * `visibilitychange → visible`, and the SW's "path-drain" nudge (the shared worker
 * posts it; a FW page and a Path page are never open together, so the tag is
 * reused rather than forking the SW's sync handler). Returns a cleanup.
 */
export function startFwSyncEngine(ctx: FwDrainCtx): () => void {
  const kick = () => void runFwClientDrain(ctx).catch((e) => console.error("[fw/sync] drain failed:", e));
  kick();

  const onOnline = () => kick();
  const onVisibility = () => {
    if (document.visibilityState === "visible") kick();
  };
  const onSwMessage = (event: MessageEvent) => {
    if (event.data === "path-drain") kick();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);
  navigator.serviceWorker?.addEventListener("message", onSwMessage);

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker?.removeEventListener("message", onSwMessage);
  };
}

/* ══════════════════════════════════════════════════════════ the roster cache ══ */

/**
 * Seed the offline roster (Decision 15) — called on every roster render, so
 * "session start" and "refresh on every successful action" both fall out of the
 * RSC lifecycle (a tap triggers `router.refresh()`, which re-renders the roster and
 * re-seeds here with the walk-in another device just created).
 */
export async function cacheFwRoster(p: {
  cohortId: string;
  buildId: string;
  students: FwCachedRosterStudent[];
}): Promise<void> {
  if (!isFwQueueSupported()) return;
  try {
    await putFwRoster({
      schemaVersion: FW_ROSTER_CACHE_SCHEMA_VERSION,
      buildId: p.buildId,
      cohortId: p.cohortId,
      students: p.students,
      cachedAt: nowIso(),
    });
  } catch (e) {
    console.error("[fw/sync] roster cache write failed (non-fatal):", e);
  }
}

/**
 * The cached roster for a cohort, or null if there is none or its shape predates
 * this app version (Decision 15's version gate — a deploy that did not change the
 * shape leaves it usable).
 *
 * SCOPE NOTE (review): the offline-roster RENDER is currently served by the SW's
 * cached app-shell HTML (which already contains the last online roster), so this
 * versioned IndexedDB read is the Decision-15 store's accessor — load-bearing for a
 * CLIENT-RENDERED offline fallback (offline navigation to a not-yet-visited page,
 * the batch picker over the cached ≤90 names) that the Aug 17 on-device dry run will
 * shape. Unvisited-page offline navigation is a documented Unit-9 limitation, not a
 * silent one. The WRITE (`cacheFwRoster`), the version policy, and the sign-out clear
 * are all consumed today.
 */
export async function readUsableFwRoster(cohortId: string): Promise<FwRosterCache | null> {
  if (!isFwQueueSupported()) return null;
  try {
    const cache = await getFwRoster();
    return isFwRosterCacheUsable(cache, {
      cohortId,
      schemaVersion: FW_ROSTER_CACHE_SCHEMA_VERSION,
    })
      ? cache
      : null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════ block-until-drained sign-out ══ */

/**
 * What this device shows of ever having run Founders Weekend — the gate that keeps
 * `openFwDb()` (which CREATES the database) away from a browser that never needed it.
 *
 * A `localStorage` read can THROW under a locked-down storage policy; that is carried
 * out as `{kind:"unknown"}` rather than swallowed, so `hasFwDeviceEvidence` makes the
 * fail-closed choice in one tested place. Deliberately NOT `indexedDB.databases()`:
 * Safari does not implement it, and Safari is the shared iPad's browser.
 */
function readFwDeviceEvidence(): FwDeviceEvidence {
  try {
    const cacheOwner =
      typeof window === "undefined" ? null : window.localStorage.getItem(FW_CACHE_OWNER_KEY);
    return { kind: "read", cacheOwner, queueDbOpened: hasFwQueueDbOpened() };
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * Clear ALL residue — the queue, the roster cache, AND the cached app shell — after
 * an allowed sign-out (Decision 8). Never an auto-purge: only the sign-out flow calls
 * this.
 *
 * The queue clear is ATOMIC under `blocksClear`: even after the verdict passed, a
 * check-in can be enqueued before the clear runs, and a blind wipe would lose it
 * (adversarial P0). `clearFwQueueIfEmpty` no-ops if a blocking record raced in; this
 * returns `{ cleared }` so the caller can ABORT sign-out rather than proceed having
 * lost a tap. Clearing the SW shell cache means a shared iPad keeps no authed roster
 * HTML for the next guide.
 *
 * `blocksClear` comes from the sequence that already took the verdict — see
 * `clearFwQueueIfEmpty`'s docblock for why passing it in, rather than counting here,
 * is the whole point.
 */
export async function clearFwResidue(
  blocksClear: (rawEntry: unknown) => boolean
): Promise<{ cleared: boolean }> {
  let cleared = true;
  if (isFwQueueSupported()) {
    try {
      cleared = (await clearFwQueueIfEmpty(blocksClear)).cleared;
    } catch (e) {
      console.error("[fw/sync] residue clear failed:", e);
      cleared = false;
    }
  }
  // ABORT-SAFE: if a tap raced in (queue not cleared), the sign-out aborts — so the
  // roster cache and shell cache must be KEPT too, or the guide is left with a
  // degraded offline shell on the flaky connectivity that caused the race. Clear all
  // three residues together, or none (adversarial re-review regression).
  if (!cleared) return { cleared };
  if (isFwQueueSupported()) {
    try {
      await clearFwRoster();
      notify();
    } catch (e) {
      console.error("[fw/sync] roster clear failed:", e);
    }
  }
  if (typeof caches !== "undefined") {
    try {
      await caches.delete(FW_SHELL_CACHE_NAME);
    } catch (e) {
      console.error("[fw/sync] shell cache clear failed:", e);
    }
  }
  return { cleared };
}

/**
 * The whole block-until-drained sign-out for this device — evidence gate, verdict,
 * one drain, re-verdict, atomic clear.
 *
 * All this does is bind browser seams to `runFwSignOutFlow`; the sequence, its
 * ordering and every refusal live in the pure module, where a node-only runner can
 * reach them. Two bindings are load-bearing and must not be "simplified":
 *
 *   - `drain` is `drainFwQueueOnce`, the LOCK-FREE inner drain — NOT
 *     `runFwClientDrain`. The flow already holds `fw-offline-drain` via
 *     `withDrainLock`, and Web Locks are not reentrant, so wiring the lock-taking
 *     wrapper in here would hang sign-out forever rather than fail loudly.
 *   - `clear` receives the predicate the flow derived from the SAME classification
 *     its verdict used, so the emptiness test that destroys the queue and the verdict
 *     authorising it can no longer disagree.
 *
 * A device with no FW residue at all (a CRM-only staff member) never opens IndexedDB
 * and never takes the lock — the flow's evidence gate returns before either.
 */
export function runFwSignOut(actorUserId: string): Promise<FwSignOutOutcome> {
  return runFwSignOutFlow({
    actorUserId,
    ports: {
      readEvidence: readFwDeviceEvidence,
      readQueue: async () => {
        if (!isFwQueueSupported()) return [];
        try {
          return await listFwRawEntriesSerialized();
        } catch (e) {
          console.error("[fw/sync] sign-out queue read failed:", e);
          throw e;
        }
      },
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
      isAuthRequired: isFwAuthRequired,
      drain: () => drainFwQueueOnce({ actorUserId }, { wait: true, includeStuck: true }),
      clear: clearFwResidue,
      withDrainLock: withFwDrainLock,
    },
  });
}

/**
 * Force-clear ALL residue unconditionally — for the identity-change case, where the
 * data belongs to a DIFFERENT guide and must not survive. Unlike `clearFwResidue`,
 * this does NOT gate on emptiness (a prior guide's un-drained taps are theirs to lose
 * on a device that changed hands, and block-until-drained already prevented an
 * offline handoff). Used only by `reconcileFwCacheOwner`.
 */
async function purgeFwResidue(): Promise<void> {
  if (isFwQueueSupported()) {
    try {
      await clearFwQueue();
      await clearFwRoster();
      notify();
    } catch (e) {
      console.error("[fw/sync] residue purge failed:", e);
    }
  }
  if (typeof caches !== "undefined") {
    try {
      await caches.delete(FW_SHELL_CACHE_NAME);
    } catch (e) {
      console.error("[fw/sync] shell cache purge failed:", e);
    }
  }
}

/** localStorage key naming the guide whose residue (queue, roster cache, SW shell)
 *  is currently on this device. */
const FW_CACHE_OWNER_KEY = "fw.cacheOwner";

/**
 * Ensure the device's cached residue belongs to the CURRENT guide (security review).
 *
 * The SW app-shell cache holds authenticated roster HTML, and the roster/queue caches
 * hold names — none of it session-scoped. Sign-out clears it, but a session that ends
 * WITHOUT the sign-out button (app killed, grant revoked, forgotten) leaves it for
 * whoever authenticates next. On every FW mount this compares the current guide to the
 * stored owner; on a mismatch it PURGES all residue before the new guide can be served
 * a prior guide's cached authed page offline. Called from `FwPwa` on mount.
 */
export async function reconcileFwCacheOwner(actorUserId: string): Promise<void> {
  if (typeof window === "undefined") return;
  let prior: string | null = null;
  try {
    prior = window.localStorage.getItem(FW_CACHE_OWNER_KEY);
  } catch {
    /* private mode — no persisted owner; treat as a fresh device */
  }
  if (prior !== null && prior !== actorUserId) {
    await purgeFwResidue();
  }
  try {
    window.localStorage.setItem(FW_CACHE_OWNER_KEY, actorUserId);
  } catch {
    /* private mode — the reconcile still purged; nothing more to persist */
  }
}

export { isFwQueueSupported };
