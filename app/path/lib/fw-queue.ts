/**
 * The Founders Weekend IndexedDB store — a THIN driver, zero decisions (FW Unit 8).
 *
 * Two stores in one database family: the check-in tap QUEUE and the offline ROSTER
 * cache (Decision 15 — the roster lives in IndexedDB, not the service worker, so
 * the `public/sw.js` amendment stays scoped to the FW app shell). Every policy
 * lives in `fw-sync-rules.ts` (pure, tested); this file only moves records in and
 * out. Nothing here is unit-testable (node has no IndexedDB and this repo runs
 * node-only tests), which is exactly why nothing here may branch — the drain engine
 * and its fake-IndexedDB harness carry the logic.
 *
 * SIGN-OUT POSTURE (Decision 8, the deliberate DIVERGENCE from the Path queue):
 * the Path's `offline-queue.ts` is NOT cleared on sign-out because a family device
 * protects a child's evidence across sessions. A shared guide iPad is the opposite
 * case — it rotates operators — so FW BLOCKS sign-out while items are queued and,
 * after a successful drain, clears BOTH stores (`clearFwQueue` + `clearFwRoster`).
 * The clearing is the caller's (the sign-out flow's) after `decideFwSignOut`
 * returns ok; this file only exposes the primitives.
 *
 * Client-only: import from client components / the drain engine / the roster
 * loader's client seam. `indexedDB` is touched inside the functions, not at module
 * scope, so merely importing stays env-less-build-safe.
 *
 * WRITE ORDERING: every queue mutation is serialized through one module-level
 * promise chain, exactly as the Path driver does — IndexedDB does not guarantee
 * commit order across independent connections, so an unawaited earlier put could
 * otherwise land after a later delete and resurrect a drained tap. Reads stay
 * unserialized (they do not mutate).
 */

import {
  FW_QUEUE_DB_NAME,
  FW_QUEUE_DB_VERSION,
  FW_QUEUE_STORE,
  FW_ROSTER_STORE,
  type FwQueueEntry,
  type FwRosterCache,
} from "./fw-sync-rules";

/** The single key the roster cache is stored under (one active cohort per device;
 *  a switch overwrites it — the cache is a convenience, never a second roster). */
const ROSTER_KEY = "active";

/** Whether this browser can hold a queue at all (private-mode Safari cannot) — the
 *  sign-in warning (`isQueueSupported() failure → persistent warning`) reads it. */
export function isFwQueueSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function openFwDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FW_QUEUE_DB_NAME, FW_QUEUE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FW_QUEUE_STORE)) {
        db.createObjectStore(FW_QUEUE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FW_ROSTER_STORE)) {
        // A plain key/value store — one roster row under ROSTER_KEY, no keyPath.
        db.createObjectStore(FW_ROSTER_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("fw queue db open failed"));
    req.onblocked = () => reject(new Error("fw queue db open blocked"));
  });
}

/** Run one operation in its own short-lived transaction, then close. */
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | null> {
  const db = await openFwDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req ? req.result : null);
      tx.onerror = () => reject(tx.error ?? new Error("fw queue tx failed"));
      tx.onabort = () => reject(tx.error ?? new Error("fw queue tx aborted"));
    });
  } finally {
    db.close();
  }
}

/** The write chain — see WRITE ORDERING in the header. A failed write must not
 *  wedge the chain, so each link swallows into the returned promise (callers still
 *  see their own rejection). */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeChain.then(fn);
  writeChain = result.catch(() => {});
  return result;
}

/* ══════════════════════════════════════════════════════════ the tap queue ══ */

export function putFwEntry(entry: FwQueueEntry): Promise<void> {
  return enqueueWrite(async () => {
    await withStore(FW_QUEUE_STORE, "readwrite", (store) => store.put(entry));
  });
}

export async function getFwEntry(id: string): Promise<FwQueueEntry | null> {
  const result = await withStore<FwQueueEntry | undefined>(FW_QUEUE_STORE, "readonly", (store) =>
    store.get(id)
  );
  return result ?? null;
}

/** Raw records — the drain narrows them through `isRecognizedFwEntry` before
 *  touching a typed field, so this returns `unknown[]` deliberately. */
export async function listFwRawEntries(): Promise<unknown[]> {
  const result = await withStore<unknown[]>(FW_QUEUE_STORE, "readonly", (store) => store.getAll());
  return result ?? [];
}

export function deleteFwEntry(id: string): Promise<void> {
  return enqueueWrite(async () => {
    await withStore(FW_QUEUE_STORE, "readwrite", (store) => store.delete(id));
  });
}

/** Empty the tap queue — the sign-out flow calls this ONLY after a drain the
 *  verdict allowed (Decision 8), never as an auto-purge. */
export function clearFwQueue(): Promise<void> {
  return enqueueWrite(async () => {
    await withStore(FW_QUEUE_STORE, "readwrite", (store) => store.clear());
  });
}

/* ══════════════════════════════════════════════════════════ the roster cache ══ */

export function putFwRoster(cache: FwRosterCache): Promise<void> {
  return enqueueWrite(async () => {
    await withStore(FW_ROSTER_STORE, "readwrite", (store) => store.put(cache, ROSTER_KEY));
  });
}

export async function getFwRoster(): Promise<FwRosterCache | null> {
  const result = await withStore<FwRosterCache | undefined>(FW_ROSTER_STORE, "readonly", (store) =>
    store.get(ROSTER_KEY)
  );
  return result ?? null;
}

/** Clear the cached roster — with the queue, on an allowed sign-out (Decision 8). */
export function clearFwRoster(): Promise<void> {
  return enqueueWrite(async () => {
    await withStore(FW_ROSTER_STORE, "readwrite", (store) => store.clear());
  });
}
