/**
 * The IndexedDB capture queue — a THIN driver, zero decisions (T1 Unit 11).
 *
 * Every policy lives in sync-rules.ts (pure, tested); this file only moves
 * QueueEntry records in and out of IndexedDB. Blobs are stored directly via
 * structured clone — far cheaper than base64, and the File survives a killed
 * tab. Nothing here is unit-testable (node has no IndexedDB and this repo
 * runs node-only tests), which is exactly why nothing here may branch.
 *
 * Client-only: import from client components / the sync engine. Never from a
 * server component (indexedDB is accessed inside the functions, not at module
 * scope, so merely importing it stays env-less-build-safe).
 *
 * iOS durability caveat (the reason InstallPrompt exists): Safari wipes
 * IndexedDB after 7 days without interaction unless the app is installed to
 * the home screen. The queue is durable, not eternal — decideDurabilityWarning
 * (sync-rules) escalates whenever queued bytes exist un-installed.
 *
 * SIGN-OUT POSTURE (deliberate, security-reviewed): the queue is NOT cleared
 * on sign-out. Deleting un-synced evidence at sign-out is precisely the
 * permanent-loss failure this unit exists to prevent — entries persist so
 * their owner (or a parent, on a shared family device) drains them on a later
 * sign-in (`selectDrainable` scopes execution; PathPwa scopes display). The
 * at-rest residue on a genuinely shared NON-family browser is a T2 hardening
 * question (drained-only purge / at-rest encryption), recorded in the plan's
 * carry-forwards — never an auto-delete.
 *
 * WRITE ORDERING: every mutation (put/delete) is serialized through one
 * module-level promise chain. Each withStore call opens its own connection
 * and transaction, and IndexedDB does NOT guarantee commit order across
 * independent connections — an unawaited earlier put could otherwise land
 * AFTER a later awaited one (or after a delete) and resurrect stale state
 * (julik + correctness reviews, independently). Chaining makes call order ==
 * commit order structurally. Reads stay unserialized (they don't mutate).
 */

import { QUEUE_DB_NAME, QUEUE_DB_VERSION, QUEUE_STORE, type QueueEntry } from "./sync-rules";

/** Whether this browser can hold a queue at all (private-mode Safari can't). */
export function isQueueSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("queue db open failed"));
    req.onblocked = () => reject(new Error("queue db open blocked"));
  });
}

/** Run one operation in its own short-lived transaction, then close. */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | null> {
  const db = await openQueueDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, mode);
      const req = fn(tx.objectStore(QUEUE_STORE));
      tx.oncomplete = () => resolve(req ? req.result : null);
      tx.onerror = () => reject(tx.error ?? new Error("queue tx failed"));
      tx.onabort = () => reject(tx.error ?? new Error("queue tx aborted"));
    });
  } finally {
    db.close();
  }
}

/** The write chain — see WRITE ORDERING in the header. A failed write must
 *  not wedge the chain, so each link swallows into the returned promise
 *  (callers still see their own rejection). */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeChain.then(fn);
  writeChain = result.catch(() => {});
  return result;
}

/** Insert or replace one entry (put — the engine persists step changes by re-putting). */
export function putEntry(entry: QueueEntry): Promise<void> {
  return enqueueWrite(async () => {
    await withStore("readwrite", (store) => store.put(entry));
  });
}

export async function getEntry(id: string): Promise<QueueEntry | null> {
  const result = await withStore<QueueEntry | undefined>("readonly", (store) => store.get(id));
  return result ?? null;
}

export async function listEntries(): Promise<QueueEntry[]> {
  const result = await withStore<QueueEntry[]>("readonly", (store) => store.getAll());
  return result ?? [];
}

export function deleteEntry(id: string): Promise<void> {
  return enqueueWrite(async () => {
    await withStore("readwrite", (store) => store.delete(id));
  });
}
