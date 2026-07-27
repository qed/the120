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
    // BOTH seeded lines (1.1.1 and 1.2.4 — both phase 1) resolve their phase word
    // from the real program; `.every` (not `.some`) so a break on one task id
    // cannot hide behind the other (testing review).
    expect(res.data.model.ticker.every((l) => l.label.startsWith("Sell "))).toBe(true);
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

  it("drops a malformed progress row and a malformed event row, keeping the good ones", async () => {
    // Mutation-confirmed gap (testing review): the narrowing/drop branches for
    // progress and event rows had no coverage.
    const db = makeFakeDb({
      members: [{ student_id: "a", cohort_id: BOSTON }],
      profiles: [profile("a", "Maya", "Chen")],
      progress: [
        { student_id: "a", task_id: "1.1.1", state: "verified" },
        { student_id: "a", task_id: null, state: "verified" }, // malformed → dropped
        { student_id: "a", task_id: "1.1.2", state: "banana" }, // unnarrowable state → dropped
      ],
      events: [
        event("e1", "a", "1.1.1", "checkmark"),
        { id: "bad", student_id: "a", task_id: "1.2.1", cohort_id: BOSTON, transition: "checkmark", from_state: "locked", to_state: "banana", at: SAT }, // bad to_state → dropped
      ],
    });
    const res = await loadFwBoard(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Only the good progress cell renders; only the good event counts.
    expect(res.data.model.grid[0].cells).toEqual({ "1.1.1": "verified" });
    expect(res.data.model.rollups.checkmarks).toBe(1);
  });

  it("falls back to insert time when an event's captured_at is missing (fresh, not silenced)", async () => {
    // A missing captured_at must read as == insert (a live tap), so a genuine first
    // dollar still rings rather than being treated as an anomaly.
    const db = makeFakeDb({
      members: [{ student_id: "a", cohort_id: BOSTON }],
      profiles: [profile("a", "Maya", "Chen")],
      events: [
        { id: "e1", student_id: "a", task_id: "1.2.4", cohort_id: BOSTON, transition: "checkmark", from_state: "locked", to_state: "verified", at: SAT, action_id: "x" }, // no captured_at
      ],
    });
    const res = await loadFwBoard(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.model.firstDollarCount).toBe(1);
    expect(res.data.model.celebrations).toHaveLength(1); // fresh (gap 0)
  });
});

describe("loadFwBoardShell — the PII-free server shell", () => {
  it("returns the title and the column skeleton, and NO student data", async () => {
    const db = makeFakeDb({
      members: [{ student_id: "a", cohort_id: BOSTON }],
      profiles: [profile("a", "Maya", "Chen")],
    });
    const shell = await loadFwBoardShell(db, { cohortId: BOSTON });
    if (shell === null) throw new Error("shell unexpectedly null for an active cohort");
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
    if (shell === null) throw new Error("shell unexpectedly null for an active cohort");
    expect(shell.cohortSlug).toBe("boston-2026-08");
    expect(shell.columns).toEqual([]);
  });

  it("FAILS CLOSED (null) when the shell's cohort read errors — changed by Unit 8, deliberately", async () => {
    // This test used to pin the opposite: a shell read error degraded to a
    // slug-less shell so the page still painted. Unit 8's archived fence changes
    // the failure semantics on purpose — the shell now refuses (null → the page's
    // bare notFound) whenever the cohort row cannot be READ, because a retired
    // weekend must not be able to hide behind a blip and paint a titled shell.
    // Same fail-closed posture as the token resolve one function up.
    const db = makeFakeDb({ failTable: "path_cohorts" });
    expect(await loadFwBoardShell(db, { cohortId: BOSTON })).toBeNull();
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

  it("refuses an existing-but-malformed token row (no cohort_id / expires_at) — one 404", async () => {
    // A genuine data-shape fault must collapse to the same {ok:false}, never a
    // cohort (testing review).
    const noCohort = tokenSeed([
      { token_hash: hashFwBoardToken("m1"), cohort_id: null, expires_at: LIVE, revoked_at: null },
    ]);
    const noExpiry = tokenSeed([
      { token_hash: hashFwBoardToken("m2"), cohort_id: BOSTON, expires_at: null, revoked_at: null },
    ]);
    expect(await resolveFwBoardToken(noCohort, { token: "m1", nowMs: NOW })).toEqual({ ok: false });
    expect(await resolveFwBoardToken(noExpiry, { token: "m2", nowMs: NOW })).toEqual({ ok: false });
  });
});

describe("Unit 8 — the archived fence at the READ (R25, 404 semantics)", () => {
  const NOW = Date.parse("2026-08-22T15:00:00Z");
  it("archived_at set directly in SQL WITHOUT revoking → the token resolve refuses (read-property, not side-effect)", async () => {
    // THE test that distinguishes the fence from the archive sequence's side
    // effects: no revoke ran, the token row is live and unexpired — only the
    // COHORT is archived, the state a manual SQL archive (or the pre-Unit-7 world)
    // produces. The read must refuse on the cohort's own state, so the caller's
    // bare 404 clears the projector frame. A 503-shaped failure would make the
    // poller HOLD its last frame — children's names on screen indefinitely.
    const db = makeFakeDb({
      cohorts: [
        { id: BOSTON, slug: "boston-2026-08", kind: "fw", archived_at: "2026-08-24T00:00:00Z" },
      ],
      tokens: [
        {
          id: "t1",
          cohort_id: BOSTON,
          token_hash: hashFwBoardToken("live-token"),
          expires_at: "2027-01-01T00:00:00Z",
          revoked_at: null,
        },
      ],
    });
    expect(
      await resolveFwBoardToken(db, { token: "live-token", nowMs: NOW })
    ).toEqual({ ok: false });
  });

  it("an UNREADABLE cohort row refuses too — the unauthenticated door never falls open on a blip", async () => {
    const db = makeFakeDb({
      tokens: [
        {
          id: "t1",
          cohort_id: BOSTON,
          token_hash: hashFwBoardToken("live-token"),
          expires_at: "2027-01-01T00:00:00Z",
          revoked_at: null,
        },
      ],
      failTable: "path_cohorts",
    });
    expect(
      await resolveFwBoardToken(db, { token: "live-token", nowMs: NOW })
    ).toEqual({ ok: false });
  });

  it("an ACTIVE cohort's live token still resolves — the fence did not close the working door", async () => {
    const db = makeFakeDb({
      tokens: [
        {
          id: "t1",
          cohort_id: BOSTON,
          token_hash: hashFwBoardToken("live-token"),
          expires_at: "2027-01-01T00:00:00Z",
          revoked_at: null,
        },
      ],
    });
    expect(
      await resolveFwBoardToken(db, { token: "live-token", nowMs: NOW })
    ).toEqual({ ok: true, cohortId: BOSTON });
  });

  it("the SHELL refuses an archived cohort with null — the page paints no titled shell for a retired weekend", async () => {
    const db = makeFakeDb({
      cohorts: [
        { id: BOSTON, slug: "boston-2026-08", kind: "fw", archived_at: "2026-08-24T00:00:00Z" },
      ],
    });
    expect(await loadFwBoardShell(db, { cohortId: BOSTON })).toBeNull();
  });
});

