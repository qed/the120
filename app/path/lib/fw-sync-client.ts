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

import { isNextRedirect } from "@/app/path/lib/next-redirect";
import { drainFwQueue } from "@/app/path/lib/actions/fw-sync";
import {
  clearFwQueue,
  clearFwRoster,
  deleteFwEntry,
  getFwEntry,
  getFwRoster,
  isFwQueueSupported,
  listFwRawEntries,
  putFwEntry,
  putFwRoster,
} from "@/app/path/lib/fw-queue";
import {
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
} from "@/app/path/lib/fw-sync-rules";

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
 * Queue one tap's per-student captures. Each gets a FRESH `clientId` (the entry id
 * IS that key), so two offline not_yet taps on one task are two distinct
 * re-attempt captures — never one collapsed by the online ledger's reuse
 * semantics, which exist for ambiguous ONLINE retries and do not apply here. The
 * batch shares one `actionId`, so the board still groups the celebration on drain.
 */
export async function enqueueFwCheckIns(p: {
  cohortId: string;
  taskId: string;
  action: FwQueueEntry["action"];
  actorUserId: string;
  studentIds: readonly string[];
  actionId: string;
  capturedAt: string;
}): Promise<FwEnqueueResult> {
  if (!isFwQueueSupported()) return { ok: false, reason: "unsupported" };
  const ids: string[] = [];
  for (const studentId of p.studentIds) {
    const clientId = crypto.randomUUID();
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

/** Dismiss a tombstoned (rejected) entry the guide has read — the reject is already
 *  recorded server-side, so this only clears the local note. */
export async function dismissFwEntry(id: string): Promise<void> {
  await deleteFwEntry(id);
  notify();
}

/* ══════════════════════════════════════════════════════════ queue reading ══ */

/**
 * Read the queue, quarantining any record this app version cannot drain (a future
 * schema or a corrupt row) as a surfaced, dismissible tombstone — never fed raw
 * into the drain, never silently dropped (the queue is a cross-deploy contract).
 */
async function listRecognizedFwEntries(): Promise<FwQueueEntry[]> {
  const raw = await listFwRawEntries();
  const recognized: FwQueueEntry[] = [];
  for (const record of raw) {
    if (isRecognizedFwEntry(record)) {
      recognized.push(record);
      continue;
    }
    const shell = record as { id?: unknown; blocked?: unknown };
    if (typeof shell.id === "string" && !shell.blocked) {
      try {
        await putFwEntry({
          ...(record as object),
          blocked: {
            reason: "reauth_failed",
            note: "This saved check-in is from a different app version and can't be sent. Dismiss it, or update the app and sign in again.",
          },
        } as FwQueueEntry);
        notify();
      } catch (e) {
        console.error("[fw/sync] could not quarantine unrecognized entry:", e);
      }
    }
  }
  return recognized;
}

/** This session's own, non-blocked captures — the drain's scope and the sign-out
 *  count both read it. */
async function readDrainableFwEntries(actorUserId: string): Promise<FwQueueEntry[]> {
  const all = await listRecognizedFwEntries();
  return selectFwDrainable(all, actorUserId).filter((e) => !e.blocked);
}

/** The queued-indicator's counts, scoped to this session (a shared device could
 *  hold a prior guide's residue, but block-until-drained clears it on sign-out). */
export async function readFwQueueSummary(actorUserId: string): Promise<FwQueueSummary> {
  try {
    const all = await listRecognizedFwEntries();
    return summarizeFwQueue(selectFwDrainable(all, actorUserId));
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
      }
      return;
    }

    for (const outcome of res.outcomes) {
      if (outcome.disposition === "settled") {
        await deleteFwEntry(outcome.entryId);
        continue;
      }
      const entry = await getFwEntry(outcome.entryId);
      if (!entry) continue;
      if (outcome.disposition === "rejected") {
        // A LOCAL tombstone with the staff-visible note — the authoritative record
        // is the path_fw_replay_rejects row the drain already wrote.
        await putFwEntry({ ...entry, blocked: { reason: outcome.reason, note: outcome.note } });
      } else {
        await putFwEntry({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso() });
      }
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

/** The cached roster for a cohort, or null if there is none or its shape predates
 *  this app version (Decision 15's version gate — a deploy that did not change the
 *  shape leaves it usable). */
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

/** The sign-out verdict for this device's queue (Decision 8). Reads the drainable
 *  count and connectivity; the caller drains (online) or shows the count (offline). */
export async function fwSignOutVerdict(actorUserId: string): Promise<FwSignOutVerdict> {
  if (!isFwQueueSupported()) return { ok: true };
  try {
    const drainable = await readDrainableFwEntries(actorUserId);
    return decideFwSignOut({
      queuedCount: drainable.length,
      online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    });
  } catch {
    // A queue we cannot read must not trap a guide on the device forever.
    return { ok: true };
  }
}

/** Clear ALL residue — the queue, the roster cache, AND the cached app shell —
 *  after an allowed sign-out (Decision 8). Never an auto-purge: only the sign-out
 *  flow calls this, and only once `fwSignOutVerdict` returned ok. Clearing the SW
 *  shell cache too means a shared iPad keeps no authed roster HTML for the next
 *  guide (the IndexedDB stores and the SW cache are cleared together). */
export async function clearFwResidue(): Promise<void> {
  if (isFwQueueSupported()) {
    try {
      await clearFwQueue();
      await clearFwRoster();
      notify();
    } catch (e) {
      console.error("[fw/sync] residue clear failed:", e);
    }
  }
  if (typeof caches !== "undefined") {
    try {
      await caches.delete(FW_SHELL_CACHE_NAME);
    } catch (e) {
      console.error("[fw/sync] shell cache clear failed:", e);
    }
  }
}

export { isFwQueueSupported };
