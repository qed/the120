import { describe, expect, it } from "vitest";
import {
  backfillUsernames,
  type AssignOutcome,
  type BackfillDb,
  type MissingChild,
} from "../backfill-fp-username-core";

/**
 * Backfill core (Slice B Unit 12) against an in-memory fake — no real DB. Proves
 * batching (keyset paging), idempotency (re-run fills only still-NULL rows and
 * never reassigns), global uniqueness (taken-set + suffixer + 23505 re-pick),
 * and the dry-run/apply split.
 */

type Row = { id: string; first_name: string; fp_username: string | null };

/** A fake children table with keyset-paged reads and a null-guarded assign,
 *  mirroring the real PostgREST-backed BackfillDb. `pageCalls` records the
 *  (after, limit) of every scan so a test can assert paging is bounded. */
function fakeDb(rows: Row[]) {
  const store = rows.map((r) => ({ ...r }));
  const pageMissingCalls: Array<{ afterId: string | null; limit: number }> = [];
  let assignConflictOnce: string | null = null; // username that 23505s exactly once

  const db: BackfillDb = {
    async pageUsernames(after, limit) {
      const all = store
        .map((r) => r.fp_username)
        .filter((u): u is string => u !== null)
        .sort();
      const start = after === null ? all : all.filter((u) => u > after);
      return start.slice(0, limit);
    },
    async pageMissing(afterId, limit): Promise<MissingChild[]> {
      pageMissingCalls.push({ afterId, limit });
      const sorted = [...store].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const start = sorted.filter((r) => r.fp_username === null && (afterId === null || r.id > afterId));
      return start.slice(0, limit).map((r) => ({ id: r.id, firstName: r.first_name }));
    },
    async assign(childId, username): Promise<AssignOutcome> {
      if (assignConflictOnce === username) {
        assignConflictOnce = null;
        return { outcome: "conflict" };
      }
      // Global unique-index simulation: refuse a username already held.
      if (store.some((r) => r.fp_username === username)) return { outcome: "conflict" };
      const row = store.find((r) => r.id === childId);
      if (!row) return { outcome: "error", message: `no row ${childId}` };
      if (row.fp_username !== null) return { outcome: "already_filled" };
      row.fp_username = username;
      return { outcome: "assigned" };
    },
  };
  return {
    db,
    store,
    pageMissingCalls,
    setConflictOnce: (u: string) => {
      assignConflictOnce = u;
    },
  };
}

const rows = (specs: Array<[string, string, string | null]>): Row[] =>
  specs.map(([id, first_name, fp_username]) => ({ id, first_name, fp_username }));

describe("backfillUsernames — dry-run (default)", () => {
  it("reports what it WOULD fill and writes NOTHING", async () => {
    const { db, store } = fakeDb(rows([
      ["c1", "Alex", null],
      ["c2", "Bella", null],
    ]));
    const s = await backfillUsernames(db, { apply: false });
    expect(s.apply).toBe(false);
    expect(s.scanned).toBe(2);
    expect(s.filled).toBe(2);
    expect(s.samples).toEqual([
      { childId: "c1", username: "alex" },
      { childId: "c2", username: "bella" },
    ]);
    // Nothing persisted.
    expect(store.every((r) => r.fp_username === null)).toBe(true);
  });
});

describe("backfillUsernames — apply", () => {
  it("fills every still-NULL child with a unique username", async () => {
    const { db, store } = fakeDb(rows([
      ["c1", "Alex", null],
      ["c2", "Bella", null],
    ]));
    const s = await backfillUsernames(db, { apply: true });
    expect(s.filled).toBe(2);
    expect(store.find((r) => r.id === "c1")?.fp_username).toBe("alex");
    expect(store.find((r) => r.id === "c2")?.fp_username).toBe("bella");
  });

  it("global uniqueness: two same-named children get distinct suffixed handles", async () => {
    const { db, store } = fakeDb(rows([
      ["c1", "Alex", null],
      ["c2", "Alex", null],
      ["c3", "Alex", null],
    ]));
    const s = await backfillUsernames(db, { apply: true });
    expect(s.filled).toBe(3);
    expect(s.suffixed).toBe(2);
    const handles = store.map((r) => r.fp_username).sort();
    expect(handles).toEqual(["alex", "alex2", "alex3"]);
  });

  it("seeds the taken-set from EXISTING usernames so a new child does not collide", async () => {
    const { db, store } = fakeDb(rows([
      ["c1", "Alex", "alex"], // already has one
      ["c2", "Alex", null], // must become alex2
    ]));
    const s = await backfillUsernames(db, { apply: true });
    expect(s.scanned).toBe(1); // only the NULL row scanned
    expect(store.find((r) => r.id === "c2")?.fp_username).toBe("alex2");
  });

  it("idempotent: a re-run fills nothing and reassigns nothing", async () => {
    const seeded = fakeDb(rows([
      ["c1", "Alex", null],
      ["c2", "Bella", null],
    ]));
    await backfillUsernames(seeded.db, { apply: true });
    const before = seeded.store.map((r) => r.fp_username);
    const second = await backfillUsernames(seeded.db, { apply: true });
    expect(second.scanned).toBe(0);
    expect(second.filled).toBe(0);
    expect(seeded.store.map((r) => r.fp_username)).toEqual(before);
  });

  it("unfoldable first name → 'student'-base fallback, counted", async () => {
    const { db, store } = fakeDb(rows([["c1", "🙂", null]]));
    const s = await backfillUsernames(db, { apply: true });
    expect(s.fallbacks).toBe(1);
    expect(store[0]?.fp_username).toBe("student");
  });

  it("resolves a 23505 conflict by re-picking the next suffix", async () => {
    const f = fakeDb(rows([["c1", "Alex", null]]));
    f.setConflictOnce("alex"); // the index rejects 'alex' once
    const s = await backfillUsernames(f.db, { apply: true });
    expect(s.conflictsResolved).toBe(1);
    expect(s.filled).toBe(1);
    expect(f.store[0]?.fp_username).toBe("alex2");
  });
});

describe("backfillUsernames — batching / paging", () => {
  it("keyset-pages the missing scan in bounded pages (never one whole-table read)", async () => {
    const many = rows(Array.from({ length: 5 }, (_, i) => [`c${i}`, `Kid${i}`, null] as [string, string, null]));
    const f = fakeDb(many);
    const s = await backfillUsernames(f.db, { apply: true, pageSize: 2 });
    expect(s.filled).toBe(5);
    // Every scan requested at most the page size ...
    expect(f.pageMissingCalls.every((c) => c.limit === 2)).toBe(true);
    // ... and the cursor advanced by id across pages (keyset, not offset 0 each
    // time). The scan stops on the short final page (length 1 < pageSize 2), so
    // no extra empty fetch is issued.
    expect(f.pageMissingCalls.map((c) => c.afterId)).toEqual([null, "c1", "c3"]);
  });

  it("rejects an out-of-range page size (guards the PostgREST 1000 cap)", async () => {
    const { db } = fakeDb(rows([["c1", "Alex", null]]));
    await expect(backfillUsernames(db, { apply: true, pageSize: 2000 })).rejects.toThrow(/out of range/);
  });
});

describe("backfillUsernames — fail loud", () => {
  it("throws on an unexpected assign error", async () => {
    const { db } = fakeDb(rows([["c1", "Alex", null]]));
    const broken: BackfillDb = {
      ...db,
      assign: async () => ({ outcome: "error", message: "permission denied" }),
    };
    await expect(backfillUsernames(broken, { apply: true })).rejects.toThrow(/permission denied/);
  });
});
