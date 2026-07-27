import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FW_STORAGE_PROBE_TIMEOUT_MS } from "../fw-call";
import { fwQueueDbExists } from "../fw-queue";
import { FW_QUEUE_DB_NAME } from "../fw-sync-rules";

/**
 * `fwQueueDbExists()` — the only branching function in `fw-queue.ts`, and the one
 * signal that made the sign-out evidence gate sound rather than heuristic (B1).
 *
 * WHY THIS FILE EXISTS AT ALL, given `fw-queue.ts`'s header says nothing in it is
 * unit-testable. That header is about the STORE operations: `openFwDb`, transactions,
 * cursors — things node genuinely cannot run. This function touches exactly one
 * browser API, `indexedDB.databases()`, and it is the only member of that module that
 * makes a decision. A mutation campaign proved the point: removing its timeout left
 * the whole suite green, because nothing exercised it. `indexedDB` is a plain global
 * here, so a stub is enough, and the three-way branch plus the two failure modes are
 * all reachable.
 *
 * The NEVER-SETTLES case is the one that matters. `databases()` is documented to hang
 * rather than reject on some engines, and this runs before the sign-out flow reaches
 * its drain lock — an unbounded wait is an indefinitely disabled "Checking…" button
 * on a shared iPad at a live event, with a reload the only escape. A rejection is the
 * easy case; a promise that never settles is the one that actually breaks you.
 */

type FakeFactory = { databases?: () => Promise<{ name?: string }[]> };

function stubIndexedDb(factory: FakeFactory | undefined): void {
  Object.defineProperty(globalThis, "indexedDB", {
    value: factory,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  stubIndexedDb(undefined);
});

describe("fwQueueDbExists — asks whether the queue exists WITHOUT creating it", () => {
  it("reports true when the FW queue database is present", async () => {
    stubIndexedDb({
      databases: async () => [{ name: "some-other-db" }, { name: FW_QUEUE_DB_NAME }],
    });
    await expect(fwQueueDbExists()).resolves.toBe(true);
  });

  it("reports FALSE when it is absent — the answer that lets sign-out skip entirely", async () => {
    // The whole point of the gate: a database that does not exist holds no queue, and
    // opening it to find out would CREATE it on a browser that never ran FW.
    stubIndexedDb({ databases: async () => [{ name: "path-offline-queue" }] });
    await expect(fwQueueDbExists()).resolves.toBe(false);
  });

  it("reports false for an empty database list", async () => {
    stubIndexedDb({ databases: async () => [] });
    await expect(fwQueueDbExists()).resolves.toBe(false);
  });

  it("says 'could not look' where there is no indexedDB at all", async () => {
    stubIndexedDb(undefined);
    await expect(fwQueueDbExists()).resolves.toBeNull();
  });

  it("says 'could not look' on a browser without databases() — never a guess", async () => {
    // Pre-2024 engines. `lib.dom.d.ts` declares the method as required, so only a
    // runtime check can see this; `null` sends the pure gate to its legacy branch
    // rather than to a fabricated true or false.
    stubIndexedDb({});
    await expect(fwQueueDbExists()).resolves.toBeNull();
  });

  it("says 'could not look' when the call REJECTS", async () => {
    stubIndexedDb({
      databases: () => Promise.reject(new Error("storage policy denied")),
    });
    await expect(fwQueueDbExists()).resolves.toBeNull();
  });

  it("BOUNDED: a databases() call that never settles resolves to 'could not look'", async () => {
    // The mutation that survived the first campaign was simply deleting the timeout —
    // nothing reddened, because nothing exercised this function. Unbounded, this await
    // happens before the sign-out flow takes its lock, so the button sits on
    // "Checking…" forever with no verdict and no error.
    stubIndexedDb({ databases: () => new Promise(() => {}) });

    const pending = fwQueueDbExists();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(FW_STORAGE_PROBE_TIMEOUT_MS - 1);
    expect(settled).toBe(false); // still waiting, as it should be

    await vi.advanceTimersByTimeAsync(2);
    await expect(pending).resolves.toBeNull();
  });

  it("a slow-but-real answer inside the budget still lands", async () => {
    stubIndexedDb({
      databases: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([{ name: FW_QUEUE_DB_NAME }]), FW_STORAGE_PROBE_TIMEOUT_MS / 2)
        ),
    });
    const pending = fwQueueDbExists();
    await vi.advanceTimersByTimeAsync(FW_STORAGE_PROBE_TIMEOUT_MS / 2 + 1);
    await expect(pending).resolves.toBe(true);
  });
});
