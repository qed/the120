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

/** Insert or replace one entry (put — the engine persists progress by re-putting). */
export async function putEntry(entry: QueueEntry): Promise<void> {
  await withStore("readwrite", (store) => store.put(entry));
}

export async function getEntry(id: string): Promise<QueueEntry | null> {
  const result = await withStore<QueueEntry | undefined>("readonly", (store) => store.get(id));
  return result ?? null;
}

export async function listEntries(): Promise<QueueEntry[]> {
  const result = await withStore<QueueEntry[]>("readonly", (store) => store.getAll());
  return result ?? [];
}

export async function deleteEntry(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}
