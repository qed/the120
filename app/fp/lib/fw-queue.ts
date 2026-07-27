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
 * after a successful drain, clears BOTH stores (`clearFwQueueUnlessBlocked` +
 * `clearFwRoster`). The clearing is the caller's (the sign-out flow's) after
 * `decideFwSignOut` returns ok; this file only exposes the primitives — and the
 * queue primitive is CONDITIONAL by construction, never a blind wipe.
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

import { FW_STORAGE_PROBE_TIMEOUT_MS, withFwTimeout } from "./fw-call";
import {
  FW_QUEUE_DB_NAME,
  FW_QUEUE_DB_VERSION,
  FW_QUEUE_STORE,
  FW_ROSTER_STORE,
  type FwClearDisposition,
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

/**
 * Whether THIS document has ever opened (and therefore possibly CREATED) the queue
 * database — half of the sign-out evidence gate in `hasFwDeviceEvidence`.
 *
 * `indexedDB.open` creates the database as a side effect, so "is the queue empty?"
 * cannot be asked without first answering "was there ever a queue?". This flag plus
 * the persisted `fw.cacheOwner` key were the original answer — a page that captured,
 * drained or cached a roster has necessarily set one of them.
 *
 * (An earlier version of this comment ended "NOT `indexedDB.databases()`", on the
 * grounds that it is async and answers "does a database exist" rather than "did this
 * actor ever use FW". Unit 3 established that "does a database exist" is in fact the
 * better question — a database that does not exist holds no queue, and opening it is
 * exactly the harm — so `fwQueueDbExists()` below now uses it. The comment is
 * rewritten rather than deleted because it is the second false claim this docblock
 * has carried about that API.)
 *
 * ⚠️ THIS FLAG IS NOT SOUND ON ITS OWN (B1). `queueDbOpened` is per-DOCUMENT and
 * false on every fresh load, so on its own the gate rested entirely on a localStorage
 * key surviving independently of IndexedDB — two storage subsystems with independent
 * eviction. Evict the key while the queue survives and sign-out skipped the check
 * completely. Staff Front Door Unit 3 fixed that in `hasFwDeviceEvidence` with two
 * signals this flag never had: the SERVER-known "is this actor an FW guide", and
 * `fwQueueDbExists()` below. This flag now only answers on browsers where neither is
 * available, and it is kept because it is free and strictly additive.
 */
let queueDbOpened = false;

export function hasFwQueueDbOpened(): boolean {
  return queueDbOpened;
}

/**
 * Does the FW queue database EXIST on this origin — without creating it?
 *
 * The question the evidence gate is actually asking, answered directly rather than by
 * proxy. `false` means opening it would CREATE it, so there is definitionally nothing
 * to check; `true` means opening it creates nothing, so checking is free. Returns
 * `null` where `indexedDB.databases()` is unavailable (pre-2024 Safari; it has been
 * Baseline since May 2024) or rejects — never a guess, so the pure gate can decide
 * what "I could not look" means in one tested place.
 *
 * Deliberately does NOT set `queueDbOpened`: it opens nothing.
 *
 * BOUNDED. `databases()` is documented to HANG rather than reject on some engines and
 * storage states, and this is awaited by the sign-out flow before it even reaches the
 * drain lock — an unbounded wait here is an indefinitely disabled "Checking…" button
 * with a reload as the only escape, on a shared iPad at a live event. The heuristic
 * this replaced was synchronous and could not hang, so bounding it is what keeps the
 * swap a strict improvement. A timeout is disposed of exactly as a rejection is:
 * `null`, meaning "could not look", which the pure gate then fails closed on.
 *
 * `lib.dom.d.ts` declares `databases()` as a REQUIRED method of `IDBFactory`, so no
 * cast is needed to call it. The runtime `typeof` check stays anyway, because the
 * ambient type is a claim about the standard rather than about the browser in front of
 * us, and pre-2024 engines genuinely lack it.
 */
export async function fwQueueDbExists(): Promise<boolean | null> {
  if (typeof indexedDB === "undefined") return null;
  if (typeof indexedDB.databases !== "function") return null;
  try {
    const raced = await withFwTimeout(
      indexedDB.databases(),
      "indexedDB.databases",
      FW_STORAGE_PROBE_TIMEOUT_MS
    );
    if (raced.timedOut) return null;
    return raced.value.some((db) => db.name === FW_QUEUE_DB_NAME);
  } catch {
    return null;
  }
}

function openFwDb(): Promise<IDBDatabase> {
  queueDbOpened = true;
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

/**
 * The same raw read, but SERIALIZED through the write chain — so it observes every
 * enqueue that was issued before it, even one still mid-persist.
 *
 * The unserialized `listFwRawEntries` is fine for the indicator (a stale count
 * self-corrects on the next notify). The SIGN-OUT emptiness check is NOT: an
 * unserialized read can miss an in-flight `putFwEntry` from a just-tapped check-in,
 * report the queue empty, and let the destructive clear run — wiping the tap that
 * was about to commit (adversarial review's sign-out race). Reading through the
 * chain places this after any pending write.
 */
export function listFwRawEntriesSerialized(): Promise<unknown[]> {
  return enqueueWrite(async () => {
    const result = await withStore<unknown[]>(FW_QUEUE_STORE, "readonly", (store) => store.getAll());
    return result ?? [];
  });
}

export function deleteFwEntry(id: string): Promise<void> {
  return enqueueWrite(async () => {
    await withStore(FW_QUEUE_STORE, "readwrite", (store) => store.delete(id));
  });
}

/**
 * ⚠️ THERE IS NO UNCONDITIONAL `clearFwQueue()`, AND THAT IS DELIBERATE.
 *
 * One existed, and its only caller was `purgeFwResidue` — the identity-change purge
 * that destroyed an outgoing guide's undrained captures on every shared-iPad handover
 * (Staff Front Door Unit 3, B2). Once the handover reconcile was made to preserve
 * what it cannot ship, the export had zero callers. It is deleted rather than left
 * exported, following Unit 1's handling of `fwSignOutVerdict`: an unguarded
 * "empty the queue" primitive sitting one import away is how B2 comes back. Every
 * destructive path now goes through `clearFwQueueUnlessBlocked` and its disposition.
 */

/**
 * ATOMIC classify-and-clear: removes every record the caller's disposition says may go,
 * keeps the ones it says to preserve, and does NOTHING AT ALL if any record aborts — in
 * ONE transaction, serialized on the write chain.
 *
 * The sign-out flow's safety backstop (adversarial review's P0): even after the
 * verdict says the queue may be wiped, a check-in can be enqueued in the window
 * before the clear runs. A blind `store.clear()` would then wipe that
 * just-committed tap. By classifying and clearing inside one transaction that runs
 * AFTER every pending enqueue (the chain) and observes a consistent snapshot (the
 * transaction), a tap that raced in yields `abort` and the clear becomes a no-op —
 * the caller sees `cleared:false` and aborts sign-out rather than losing the tap.
 *
 * `disposition` IS THE POINT OF THE SIGNATURE. This used to be a bare `store.count()`,
 * which counted EVERY record — including the blocked tombstones and foreign entries
 * the verdict deliberately excluded from its own count. One blocked entry therefore
 * produced `ok` from the check and `cleared:false` from the act, and the guide got
 * "a check-in just came in — try again in a moment" forever, on a device where
 * nothing would ever change. The caller passes the SAME classification its verdict
 * used (`fwEntryClearDisposition`), so check and act cannot drift again; this driver
 * keeps no emptiness opinion of its own, exactly as the header demands.
 *
 * WHY THE SECOND PASS RE-CLASSIFIES rather than reusing the first pass's array: the
 * cursor walks the store in key order and `getAll()` returns its own array, and pairing
 * the two by index would be an assumption about IndexedDB's ordering guarantees that
 * this driver has no business making. `disposition` is pure, so evaluating it twice per
 * record is free of consequence and self-evidently correct — which matters more here
 * than one traversal, because getting it wrong deletes a child's check-in.
 *
 * A CURSOR, not per-id deletes: a record whose shape carries no usable `id` (corrupt,
 * or from a future schema) has nothing to delete BY, and `store.clear()` used to sweep
 * it. `cursor.delete()` removes the record in front of it whatever its shape, so the
 * selective clear does not quietly start accumulating garbage the blind one collected.
 *
 * A disposition that THROWS aborts the transaction, which rejects — and a rejected
 * clear is `cleared:false` at the caller. Failing closed is the correct direction:
 * the queue survives.
 */
export function clearFwQueueUnlessBlocked(
  disposition: (rawEntry: unknown) => FwClearDisposition
): Promise<{ cleared: boolean; blocking: number; remaining: number }> {
  return enqueueWrite(async () => {
    const db = await openFwDb();
    try {
      return await new Promise<{ cleared: boolean; blocking: number; remaining: number }>(
        (resolve, reject) => {
          const tx = db.transaction(FW_QUEUE_STORE, "readwrite");
          const store = tx.objectStore(FW_QUEUE_STORE);
          const allReq = store.getAll();
          let blocking = 0;
          let remaining = 0;
          allReq.onsuccess = () => {
            const records = (allReq.result ?? []) as unknown[];
            const dispositions = records.map(disposition);
            blocking = dispositions.filter((d) => d === "abort").length;
            if (blocking > 0) {
              // Nothing is touched, so everything is still here.
              remaining = records.length;
              return;
            }
            remaining = dispositions.filter((d) => d === "preserve").length;
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor) return;
              if (disposition(cursor.value) !== "preserve") cursor.delete();
              cursor.continue();
            };
          };
          tx.oncomplete = () => resolve({ cleared: blocking === 0, blocking, remaining });
          tx.onerror = () => reject(tx.error ?? new Error("clearUnlessBlocked failed"));
          tx.onabort = () => reject(tx.error ?? new Error("clearUnlessBlocked aborted"));
        }
      );
    } finally {
      db.close();
    }
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
