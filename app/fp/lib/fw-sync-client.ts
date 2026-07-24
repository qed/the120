/**
 * The FW offline client orchestration (FW Unit 8) — the page-context half of the
 * drain, and the ONLY code that touches IndexedDB.
 *
 * The Path splits its client engine (`sync-engine.ts`) from its PWA shell
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
import {
  clearFwQueue,
  clearFwQueueIfEmpty,
  clearFwRoster,
  deleteFwEntry,
  getFwRoster,
  isFwQueueSupported,
  listFwRawEntries,
  listFwRawEntriesSerialized,
  putFwEntry,
  putFwRoster,
} from "@/app/fp/lib/fw-queue";
import {
  applyFwDrainOutcome,
  decideFwSignOut,
  FW_AUTO_RETRY_ATTEMPT_CEILING,
  FW_QUEUE_ENTRY_SCHEMA_VERSION,
  FW_ROSTER_CACHE_SCHEMA_VERSION,
  FW_SHELL_CACHE_NAME,
  isFwRosterCacheUsable,
  isRecognizedFwEntry,
  selectFwDrainable,
  summarizeFwQueue,
  type FwCachedRosterStudent,
  type FwQueueEntry,
  type FwQueueEntryInput,
  type FwQueueSummary,
  type FwRosterCache,
  type FwSignOutVerdict,
} from "@/app/fp/lib/fw-sync-rules";

/** A note for a record this app version cannot drain (future schema / corrupt) —
 *  surfaced, dismissible, never silently dropped. */
const FW_QUARANTINE_NOTE =
  "This saved check-in is from a different app version and can't be sent. Dismiss it, or update the app and sign in again.";

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

/** One quarantined record — a shape this app version cannot drain, surfaced by id
 *  and note so it can be shown and dismissed. */
type FwQuarantined = { id: string; note: string };

/**
 * Partition a raw IndexedDB read into drainable entries and quarantined records.
 *
 * A record that fails `isRecognizedFwEntry` (a future schema, a corrupt shape) is
 * NOT cast into a `FwQueueEntry` it does not satisfy — the previous version wrote
 * `{...record, blocked} as FwQueueEntry`, but adding `blocked` never fixed what made
 * it unrecognized, so it failed recognition again on every later read and vanished
 * from every view (kieran-typescript / reliability / api-contract review: it could
 * then be silently destroyed by sign-out). Instead it is surfaced directly from the
 * raw record by its id, with its own note, on every scan — no write, no lying cast,
 * never a silent drop of a child's captured check-in.
 */
function partitionFwQueue(raw: readonly unknown[]): {
  recognized: FwQueueEntry[];
  quarantined: FwQuarantined[];
} {
  const recognized: FwQueueEntry[] = [];
  const quarantined: FwQuarantined[] = [];
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

async function scanFwQueue(): Promise<{ recognized: FwQueueEntry[]; quarantined: FwQuarantined[] }> {
  return partitionFwQueue(await listFwRawEntries());
}

/** This session's own, non-blocked captures — the drain's scope. */
async function readDrainableFwEntries(actorUserId: string): Promise<FwQueueEntry[]> {
  const { recognized } = await scanFwQueue();
  return selectFwDrainable(recognized, actorUserId).filter((e) => !e.blocked);
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

/**
 * Drain the queue once. Reads IndexedDB, ships the drainable set through the
 * `drainFwQueue` action (which re-authes, scopes to this session's captures,
 * resolves per-cohort authorization, and runs the tested fold), then applies the
 * per-entry outcomes: settled → delete, rejected → local tombstone with the
 * staff-visible note, retry → attempts++.
 *
 * Single-drainer via Web Locks (an offline three-tab guide iPad must not ship the
 * same queue thrice). Background signals skip when a drain is running; a caller
 * that passes `wait` queues behind it instead — a user-waited-on sign-out drain
 * must never silently lose the lock race.
 */
export async function runFwClientDrain(ctx: FwDrainCtx, opts: FwDrainOptions = {}): Promise<void> {
  if (!isFwQueueSupported()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const run = async () => {
    authRequired = false;
    const drainable = await readDrainableFwEntries(ctx.actorUserId);
    const runnable = opts.includeStuck
      ? drainable
      : drainable.filter((e) => e.attempts < FW_AUTO_RETRY_ATTEMPT_CEILING);
    if (runnable.length === 0) return;

    let res;
    try {
      res = await drainFwQueue(runnable);
    } catch (e) {
      if (isNextRedirect(e)) {
        authRequired = true;
        notify();
        return;
      }
      console.error("[fw/sync] drain action threw:", e);
      return;
    }

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
  };

  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    if (opts.wait) {
      await navigator.locks.request("fw-offline-drain", run);
    } else {
      await navigator.locks.request("fw-offline-drain", { ifAvailable: true }, async (lock) => {
        if (lock) await run();
      });
    }
    return;
  }
  const turn = fallbackDrainChain.then(run);
  fallbackDrainChain = turn.catch(() => {});
  if (opts.wait) await turn;
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
 * The sign-out verdict for this device's queue (Decision 8).
 *
 * Reads through the SERIALIZED path so an in-flight enqueue is observed (not raced
 * past — the adversarial P0). A read FAILURE returns `unreadable` and BLOCKS sign-out
 * rather than failing open: a queue we cannot read must never be destroyed on the
 * strength of not being able to see it (correctness / adversarial review — the old
 * fail-open path let a transient IndexedDB error wipe undrained captures). Quarantined
 * records block with `needs_attention` — un-landed captures a blind clear would lose.
 */
export async function fwSignOutVerdict(actorUserId: string): Promise<FwSignOutVerdict> {
  if (!isFwQueueSupported()) return { ok: true };
  try {
    const { recognized, quarantined } = partitionFwQueue(await listFwRawEntriesSerialized());
    const drainable = selectFwDrainable(recognized, actorUserId).filter((e) => !e.blocked);
    return decideFwSignOut({
      queuedCount: drainable.length,
      quarantinedCount: quarantined.length,
      online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    });
  } catch (e) {
    console.error("[fw/sync] sign-out queue read failed:", e);
    return { ok: false, reason: "unreadable", queuedCount: 0 };
  }
}

/**
 * Clear ALL residue — the queue, the roster cache, AND the cached app shell — after
 * an allowed sign-out (Decision 8). Never an auto-purge: only the sign-out flow and
 * the identity reconcile call this.
 *
 * The queue clear is ATOMIC-if-empty: even after the verdict passed, a check-in can
 * be enqueued before the clear runs, and a blind wipe would lose it (adversarial P0).
 * `clearFwQueueIfEmpty` no-ops if a tap raced in; this returns `{ cleared }` so the
 * caller can ABORT sign-out rather than proceed having lost a tap. Clearing the SW
 * shell cache means a shared iPad keeps no authed roster HTML for the next guide.
 */
export async function clearFwResidue(): Promise<{ cleared: boolean }> {
  let cleared = true;
  if (isFwQueueSupported()) {
    try {
      cleared = (await clearFwQueueIfEmpty()).cleared;
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
