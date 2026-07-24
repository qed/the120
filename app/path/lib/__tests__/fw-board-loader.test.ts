import { describe, expect, it } from "vitest";

import { loadFwBoard, loadFwBoardShell, resolveFwBoardToken } from "../fw-board-loader";
import { hashFwBoardToken } from "../fw-board-token";
import { FW_TOMBSTONE_FIRST_NAME, FW_TOMBSTONE_LAST_NAME } from "../fw-ops-rules";

/**
 * The board loader (FW Unit 6) — the impure composition that gathers members,
 * lifetime progress, and THIS cohort's stamped events and folds them through the
 * pure read model. Tested with a fake Supabase client, because the composition is
 * where every FW unit has shipped a P1: the loader must read the grid from
 * LIFETIME progress and the weekend numbers from COHORT-STAMPED events (Decision
 * 16), keep an anonymized member's retained events counting while their name
 * stays off the board (Decision 10), and page every list read past the 1000-row
 * cliff. Halves that are each obvious; a composition that is not.
 *
 * `program_version_id` is the real "2026-27" so `getProgram` resolves through the
 * registry and the phase-word path is exercised, not stubbed.
 */

const BOSTON = "cohort-boston";
const HAMPTONS = "cohort-hamptons";
const VERSION = "2026-27";

type Row = Record<string, unknown>;

type Seed = {
  cohorts?: Row[];
  members?: Row[];
  profiles?: Row[];
  progress?: Row[];
  events?: Row[];
  tokens?: Row[];
  /** Force one table's read to error, to reach the `{ok:false}` branches. */
  failTable?: string | null;
};

/** A minimal read-only fake: `.select().eq()/.in()/.order()/.range()` (awaited by
 *  `fetchAllRows`) and `.maybeSingle()` (the cohort read). Deliberately smaller
 *  than the ops harness — the board only ever reads. */
function makeFakeDb(seed: Seed) {
  const tables: Record<string, Row[]> = {
    path_cohorts: (seed.cohorts ?? [
      { id: BOSTON, slug: "boston-2026-08", kind: "fw" },
      { id: HAMPTONS, slug: "hamptons-2026-08", kind: "fw" },
    ]).map((r) => ({ ...r })),
    path_cohort_members: (seed.members ?? []).map((r, i) => ({ id: `m${i}`, ...r })),
    path_student_profiles: (seed.profiles ?? []).map((r) => ({ ...r })),
    path_task_progress: (seed.progress ?? []).map((r, i) => ({ id: `p${i}`, ...r })),
    path_task_events: (seed.events ?? []).map((r) => ({ ...r })),
    path_fw_board_tokens: (seed.tokens ?? []).map((r) => ({ ...r })),
  };

  function query(table: string) {
    const eqs: [string, unknown][] = [];
    let inFilter: [string, unknown[]] | null = null;
    let orderBy: { col: string; ascending: boolean } | null = null;
    let rangeAt: [number, number] | null = null;
    let limitTo: number | null = null;

    const errored = () => seed.failTable === table;

    const rows = () => {
      let out = tables[table].filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          (!inFilter || inFilter[1].includes(r[inFilter[0]]))
      );
      if (orderBy) {
        const { col, ascending } = orderBy;
        out = [...out].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (rangeAt) out = out.slice(rangeAt[0], rangeAt[1] + 1);
      if (limitTo !== null) out = out.slice(0, limitTo);
      return out;
    };

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        eqs.push([col, val]);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        inFilter = [col, vals];
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, ascending: opts?.ascending !== false };
        return builder;
      },
      range(from: number, to: number) {
        rangeAt = [from, to];
        return builder;
      },
      limit(n: number) {
        limitTo = n;
        return builder;
      },
      async maybeSingle() {
        if (errored()) return { data: null, error: { message: `${table} read failed` } };
        const hit = rows()[0];
        return { data: hit ? { ...hit } : null, error: null };
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        const result = errored()
          ? { data: null, error: { message: `${table} read failed` } }
          : { data: rows().map((r) => ({ ...r })), error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  }

  return { from: (table: string) => query(table) } as never;
}

/** Fri-Sat-Sun Boston, ms. */
const SAT = "2026-08-22T15:00:00.000Z";
const satPlus = (ms: number) => new Date(Date.parse(SAT) + ms).toISOString();

function profile(id: string, first: string, last: string, band = "g6_8"): Row {
  return { id, first_name: first, last_name: last, band, program_version_id: VERSION };
}

function event(
  id: string,
  studentId: string,
  taskId: string,
  transition: "checkmark" | "not_yet" | "undo",
  opts: { at?: string; capturedAt?: string; actionId?: string | null; fromState?: string } = {}
): Row {
  const to = transition === "checkmark" ? "verified" : transition === "not_yet" ? "not_yet" : "locked";
  const at = opts.at ?? SAT;
  return {
    id,
    student_id: studentId,
    task_id: taskId,
    cohort_id: BOSTON,
    transition,
    from_state: opts.fromState ?? "locked",
    to_state: to,
    at,
    captured_at: opts.capturedAt ?? at,
    action_id: opts.actionId ?? null,
  };
}

describe("loadFwBoard — happy path", () => {
  it("draws the grid from lifetime progress and the weekend numbers from stamped events", async () => {
    const db = makeFakeDb({
      members: [
        { student_id: "a", cohort_id: BOSTON },
        { student_id: "b", cohort_id: BOSTON },
      ],
      profiles: [profile("a", "Maya", "Chen"), profile("b", "Sam", "Diaz")],
      progress: [
        { student_id: "a", task_id: "1.1.1", state: "verified" },
        { student_id: "a", task_id: "1.2.4", state: "verified" },
        { student_id: "b", task_id: "1.1.1", state: "not_yet" },
      ],
      events: [
        event("e1", "a", "1.1.1", "checkmark", { at: SAT }),
        event("e2", "a", "1.2.4", "checkmark", { at: satPlus(1000), actionId: "batch" }),
      ],
    });

    const res = await loadFwBoard(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.cohortSlug).toBe("boston-2026-08");
    expect(res.data.model.grid).toHaveLength(2);
    // Grid from progress (lifetime): a's cells filled, b's not_yet.
    const a = res.data.model.grid.find((r) => r.studentId === "a")!;
    expect(a.cells).toEqual({ "1.1.1": "verified", "1.2.4": "verified" });
    expect(a.displayName).toBe("Maya C.");
    // Weekend from events: two checkmarks, XP = 1 + 1, one first dollar (1.2.4).
    expect(res.data.model.weekendXp).toBe(2);
    expect(res.data.model.firstDollarCount).toBe(1);
    expect(res.data.model.ticker).toHaveLength(2);
    // The phase word came from the real program, not a bare task id.
    expect(res.data.model.ticker.some((l) => l.label.startsWith("Sell "))).toBe(true);
    // Grid columns are built from the pinned program: 5 phases, 125 tasks.
    expect(res.data.columns).toHaveLength(5);
    expect(res.data.columns[0].name).toBe("Sell");
    expect(res.data.columns.flatMap((c) => c.taskIds)).toHaveLength(125);
  });

  it("counts a replayed 1.2.4 in XP and the counter but fires no celebration (G5), through the real loader", async () => {
    const db = makeFakeDb({
      members: [{ student_id: "a", cohort_id: BOSTON }],
      profiles: [profile("a", "Maya", "Chen")],
      progress: [{ student_id: "a", task_id: "1.2.4", state: "verified" }],
      events: [
        // Drained from a 20-minute outage: captured_at far behind the insert.
        event("e1", "a", "1.2.4", "checkmark", {
          at: SAT,
          capturedAt: satPlus(-20 * 60_000),
          actionId: "old",
        }),
      ],
    });

    const res = await loadFwBoard(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.model.firstDollarCount).toBe(1);
    expect(res.data.model.weekendXp).toBe(1);
    expect(res.data.model.celebrations).toEqual([]);
  });
});

describe("loadFwBoard — anonymized members (Decision 10)", () => {
  it("keeps a removed student's events counting while their name stays off the board", async () => {
    const db = makeFakeDb({
      members: [
        { student_id: "keep", cohort_id: BOSTON },
        { student_id: "gone", cohort_id: BOSTON },
      ],
      profiles: [
        profile("keep", "Maya", "Chen"),
        // The anonymize tombstone: name removed, band kept, still FW-shaped.
        profile("gone", FW_TOMBSTONE_FIRST_NAME, FW_TOMBSTONE_LAST_NAME, "g9_12"),
      ],
      events: [
        event("e1", "keep", "1.1.1", "checkmark", { at: SAT }),
        event("e2", "gone", "1.2.4", "checkmark", { at: satPlus(1000) }),
      ],
    });

    const res = await loadFwBoard(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Only the name-bearing student is on the grid and in the ticker.
    expect(res.data.model.grid.map((r) => r.studentId)).toEqual(["keep"]);
    expect(res.data.model.ticker.every((l) => l.studentId === "keep")).toBe(true);
    // ...but the removed student's 1.2.4 still counts everywhere it should.
    expect(res.data.model.firstDollarCount).toBe(1);
    expect(res.data.model.rollups.checkmarks).toBe(2);
    expect(res.data.model.rollups.students).toBe(1);
    expect(res.data.model.celebrations).toEqual([]); // never named
  });
});

describe("loadFwBoard — degradation & defenses", () => {
  it("returns an empty (not failed) board for a cohort with no members", async () => {
    const db = makeFakeDb({ members: [] });
    const res = await loadFwBoard(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.model.grid).toEqual([]);
    expect(res.data.model.weekendXp).toBe(0);
  });

  it("refuses a token that points at a non-fw cohort (defense in depth)", async () => {
    const db = makeFakeDb({
      cohorts: [{ id: BOSTON, slug: "sept-path", kind: "path" }],
      members: [{ student_id: "a", cohort_id: BOSTON }],
      profiles: [profile("a", "Maya", "Chen")],
    });
    const res = await loadFwBoard(db, { cohortId: BOSTON });
    expect(res.ok).toBe(false);
  });

  it("fails the whole read (never a partial board) when the events read errors", async () => {
    const db = makeFakeDb({
      members: [{ student_id: "a", cohort_id: BOSTON }],
      profiles: [profile("a", "Maya", "Chen")],
      failTable: "path_task_events",
    });
    const res = await loadFwBoard(db, { cohortId: BOSTON });
    expect(res.ok).toBe(false);
  });

  it("drops a non-FW-shaped profile rather than rendering a nameless row", async () => {
    const db = makeFakeDb({
      members: [
        { student_id: "a", cohort_id: BOSTON },
        { student_id: "bad", cohort_id: BOSTON },
      ],
      profiles: [
        profile("a", "Maya", "Chen"),
        { id: "bad", first_name: "No", last_name: "Band", band: null, program_version_id: VERSION },
      ],
      events: [event("e1", "a", "1.1.1", "checkmark")],
    });
    const res = await loadFwBoard(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.model.grid.map((r) => r.studentId)).toEqual(["a"]);
  });
});

describe("loadFwBoardShell — the PII-free server shell", () => {
  it("returns the title and the column skeleton, and NO student data", async () => {
    const db = makeFakeDb({
      members: [{ student_id: "a", cohort_id: BOSTON }],
      profiles: [profile("a", "Maya", "Chen")],
    });
    const shell = await loadFwBoardShell(db, { cohortId: BOSTON });
    expect(shell.cohortSlug).toBe("boston-2026-08");
    expect(shell.columns).toHaveLength(5);
    expect(shell.columns[0].name).toBe("Sell");
    expect(shell.columns.flatMap((c) => c.taskIds)).toHaveLength(125);
    // The shell object carries columns + slug only — never a grid/model/name.
    expect(Object.keys(shell).sort()).toEqual(["cohortSlug", "columns"]);
  });

  it("still paints (empty columns) for a cohort with no resolvable members", async () => {
    const db = makeFakeDb({ members: [] });
    const shell = await loadFwBoardShell(db, { cohortId: BOSTON });
    expect(shell.cohortSlug).toBe("boston-2026-08");
    expect(shell.columns).toEqual([]);
  });
});

describe("resolveFwBoardToken — per-request validation, one 404 for all refusals", () => {
  const NOW = Date.parse(SAT);
  const LIVE = "2026-08-24T03:00:00.000Z"; // after SAT
  const PAST = "2026-08-20T03:00:00.000Z"; // before SAT

  const tokenSeed = (rows: Row[]) => makeFakeDb({ tokens: rows });

  it("resolves the cohort for a live, unrevoked, unexpired token", async () => {
    const db = tokenSeed([
      { token_hash: hashFwBoardToken("good"), cohort_id: BOSTON, expires_at: LIVE, revoked_at: null },
    ]);
    const res = await resolveFwBoardToken(db, { token: "good", nowMs: NOW });
    expect(res).toEqual({ ok: true, cohortId: BOSTON });
  });

  it("refuses a garbage token that matches no row — the same answer as every other refusal", async () => {
    const db = tokenSeed([
      { token_hash: hashFwBoardToken("good"), cohort_id: BOSTON, expires_at: LIVE, revoked_at: null },
    ]);
    expect(await resolveFwBoardToken(db, { token: "not-a-real-token", nowMs: NOW })).toEqual({
      ok: false,
    });
    expect(await resolveFwBoardToken(db, { token: "", nowMs: NOW })).toEqual({ ok: false });
  });

  it("refuses a revoked token, and an expired one, with no distinguishable answer", async () => {
    const revoked = tokenSeed([
      { token_hash: hashFwBoardToken("r"), cohort_id: BOSTON, expires_at: LIVE, revoked_at: SAT },
    ]);
    const expired = tokenSeed([
      { token_hash: hashFwBoardToken("e"), cohort_id: BOSTON, expires_at: PAST, revoked_at: null },
    ]);
    expect(await resolveFwBoardToken(revoked, { token: "r", nowMs: NOW })).toEqual({ ok: false });
    expect(await resolveFwBoardToken(expired, { token: "e", nowMs: NOW })).toEqual({ ok: false });
  });

  it("fails CLOSED on a token-lookup read error — never falls open to a cohort", async () => {
    const db = makeFakeDb({
      tokens: [{ token_hash: hashFwBoardToken("good"), cohort_id: BOSTON, expires_at: LIVE, revoked_at: null }],
      failTable: "path_fw_board_tokens",
    });
    expect(await resolveFwBoardToken(db, { token: "good", nowMs: NOW })).toEqual({ ok: false });
  });
});
