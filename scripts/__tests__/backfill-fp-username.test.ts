import { describe, expect, it } from "vitest";
import {
  backfillUsernames,
  type AssignOutcome,
  type BackfillDb,
  type MissingChild,
} from "../backfill-fp-username-core";
// Importing the ENTRYPOINT module (not just -core) is the loadability proof: if
// its dep chain ever transitively pulled in `server-only`/next, this import would
// crash the suite exactly as `tsx` would (docs/solutions/build-issues/
// a-standalone-script-...-die-at-load-run-the-entrypoint). The entrypoint guards
// its own main() so this import does NOT fire a real run.
import { makeDb, runBackfill } from "../backfill-fp-username";

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
  const pageUsernamesCalls: Array<{ after: string | null; limit: number }> = [];
  let assignConflictOnce: string | null = null; // username that 23505s exactly once

  const db: BackfillDb = {
    async pageUsernames(after, limit) {
      pageUsernamesCalls.push({ after, limit });
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
    pageUsernamesCalls,
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
      { childId: "c1", username: "alex@firstprofit.school" },
      { childId: "c2", username: "bella@firstprofit.school" },
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
    expect(store.find((r) => r.id === "c1")?.fp_username).toBe("alex@firstprofit.school");
    expect(store.find((r) => r.id === "c2")?.fp_username).toBe("bella@firstprofit.school");
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
    expect(handles).toEqual(["alex2@firstprofit.school", "alex3@firstprofit.school", "alex@firstprofit.school"]);
  });

  it("seeds the taken-set from EXISTING usernames so a new child does not collide", async () => {
    const { db, store } = fakeDb(rows([
      ["c1", "Alex", "alex@firstprofit.school"], // already has one
      ["c2", "Alex", null], // must become alex2
    ]));
    const s = await backfillUsernames(db, { apply: true });
    expect(s.scanned).toBe(1); // only the NULL row scanned
    expect(store.find((r) => r.id === "c2")?.fp_username).toBe("alex2@firstprofit.school");
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
    expect(store[0]?.fp_username).toBe("student@firstprofit.school");
  });

  it("multi-word / hyphenated existing names backfill to dash-FREE `^[a-z0-9]+$` handles (no fail-loud abort) — the P0 seam", async () => {
    // Pre-fix these folded to mary-jane / anna-lee, which the CHECK rejects (23514);
    // the backfill's fail-loud on the first non-benign error would abort the whole
    // run on the first existing dashed name. They must now backfill cleanly to
    // alnum-only handles.
    const { db, store } = fakeDb(rows([
      ["c1", "Mary Jane", null],
      ["c2", "Anna-Lee", null],
      ["c3", "Lily  Rose  ", null],
    ]));
    const s = await backfillUsernames(db, { apply: true });
    expect(s.filled).toBe(3);
    expect(s.fallbacks).toBe(0);
    expect(store.find((r) => r.id === "c1")?.fp_username).toBe("maryjane@firstprofit.school");
    expect(store.find((r) => r.id === "c2")?.fp_username).toBe("annalee@firstprofit.school");
    expect(store.find((r) => r.id === "c3")?.fp_username).toBe("lilyrose@firstprofit.school");
    for (const r of store) expect(r.fp_username).toMatch(/^[a-z0-9]+@firstprofit\.school$/);
  });

  it("resolves a 23505 conflict by re-picking the next suffix", async () => {
    const f = fakeDb(rows([["c1", "Alex", null]]));
    f.setConflictOnce("alex@firstprofit.school"); // the index rejects 'alex' once
    const s = await backfillUsernames(f.db, { apply: true });
    expect(s.conflictsResolved).toBe(1);
    expect(s.filled).toBe(1);
    expect(f.store[0]?.fp_username).toBe("alex2@firstprofit.school");
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

  it("seeds the taken-set across ALL username pages: a new same-base child is pushed past EVERY existing page (no seed truncation)", async () => {
    // Three existing 'alex*' handles span TWO pages at pageSize 2 (["alex","alex2"]
    // then ["alex3"]). A new NULL 'Alex' child must land on alex4 — proving the
    // seed paged through the SECOND page. The tell that seeding (not the 23505
    // re-pick) did the work is conflictsResolved === 0: had the seed truncated at
    // page 1, the mint would have proposed alex3, hit the index, and needed a
    // conflict re-pick. (Guards the seed-truncation regression the design prevents.)
    const f = fakeDb(rows([
      ["c1", "Alex", "alex@firstprofit.school"],
      ["c2", "Alex", "alex2@firstprofit.school"],
      ["c3", "Alex", "alex3@firstprofit.school"],
      ["c4", "Alex", null],
    ]));
    const s = await backfillUsernames(f.db, { apply: true, pageSize: 2 });
    expect(s.scanned).toBe(1); // only the NULL row
    expect(f.store.find((r) => r.id === "c4")?.fp_username).toBe("alex4@firstprofit.school");
    expect(s.conflictsResolved).toBe(0); // the seed prevented any index conflict
    expect(s.suffixed).toBe(1);
    // The username seed actually PAGED (more than one bounded read, cursor-advanced).
    expect(f.pageUsernamesCalls.length).toBeGreaterThan(1);
    expect(f.pageUsernamesCalls.every((c) => c.limit === 2)).toBe(true);
  });
});

describe("backfillUsernames — concurrent-fill (already_filled) is benign, not an error", () => {
  it("a row scanned as missing but whose guarded assign matches 0 rows (filled by a concurrent run) is counted skipped, never thrown", async () => {
    // pageMissing surfaces c1 as still-NULL, but between the scan and our write a
    // concurrent run filled it, so assign's `where fp_username is null` matches 0
    // rows → outcome 'already_filled'. That is idempotency working, not a failure.
    let missingServed = false;
    const db: BackfillDb = {
      async pageUsernames() {
        return [];
      },
      async pageMissing() {
        if (missingServed) return [];
        missingServed = true;
        return [{ id: "c1", firstName: "Alex" }];
      },
      async assign(): Promise<AssignOutcome> {
        return { outcome: "already_filled" };
      },
    };
    const s = await backfillUsernames(db, { apply: true });
    expect(s.scanned).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.filled).toBe(0);
  });
});

/* ----------------------------------- entrypoint loadability + wiring smoke */

/** A minimal thenable Supabase-lite that answers only the two SELECT chains
 *  `makeDb` issues (username page vs missing page, disambiguated by columns). No
 *  network, no writes — enough to drive a dry-run through the real makeDb wiring. */
function fakeSupabase(missing: Array<{ id: string; first_name: string }>) {
  const from = () => {
    let cols = "";
    const b = {
      select(c: string) {
        cols = c;
        return b;
      },
      not: () => b,
      is: () => b,
      gt: () => b,
      order: () => b,
      limit: () => b,
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        const data = cols.includes("first_name")
          ? missing.map((m) => ({ id: m.id, first_name: m.first_name }))
          : []; // no existing usernames to seed
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return b;
  };
  return { from } as unknown as Parameters<typeof runBackfill>[0];
}

describe("backfill-fp-username ENTRYPOINT — loads and runs (dry-run wiring smoke)", () => {
  it("the entrypoint module imported clean and runBackfill drives makeDb + the core end-to-end (dry-run: no writes)", async () => {
    expect(typeof makeDb).toBe("function");
    const lines: string[] = [];
    const summary = await runBackfill(fakeSupabase([{ id: "c1", first_name: "Alex" }]), {
      apply: false,
      log: (l) => lines.push(l),
    });
    // The wiring executed: it scanned the missing child and reported what it WOULD
    // fill, writing nothing (dry-run) — proving the entrypoint's dep chain is
    // bundler-free (it loaded) AND its makeDb→core→report path runs.
    expect(summary.apply).toBe(false);
    expect(summary.scanned).toBe(1);
    expect(summary.filled).toBe(1);
    expect(summary.samples).toEqual([{ childId: "c1", username: "alex@firstprofit.school" }]);
    expect(lines.join("\n")).toContain("DRY-RUN");
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
