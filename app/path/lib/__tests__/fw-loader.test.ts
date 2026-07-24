import { describe, expect, it } from "vitest";

import {
  loadFwCohortRoster,
  loadFwMatchCandidates,
  loadFwStudentDrilldown,
} from "../fw-loader";
import { matchFwStudent } from "../fw-match-rules";
import { buildNormalizedFwName } from "../fw-provision-rules";

/**
 * The guide surface's read path (FW Unit 4), driven through a fake Supabase
 * client — the same harness posture as `fw-checkin-core.test.ts`, and for the
 * same reason the plan states twice: both Unit 2 and Unit 3 shipped a P1 in a
 * COMPOSITION whose halves were individually correct and individually tested.
 *
 * The composition here is three reads that must agree about who is in a cohort.
 * The one that matters most is `loadFwStudentDrilldown`'s membership gate — the
 * read-side of Decision 3, and the only thing standing between a URL edit and
 * another weekend's child.
 */

const BOSTON = "cohort-boston";
const HAMPTONS = "cohort-hamptons";

type Row = Record<string, unknown>;

type Seed = {
  members?: { student_id: string; cohort_id: string }[];
  profiles?: Row[];
  progress?: Row[];
  errors?: Partial<Record<string, string>>;
  /**
   * Rows returned VERBATIM for a table, bypassing the filters. Models the
   * server handing back a shape the query did not imply — a widened select, a
   * relaxed filter, a schema drift. Without it, a guard on the very column a
   * query filters on is untestable, and "the query makes this impossible" is
   * exactly the reasoning that leaves a fail-open cast behind when the query
   * later changes.
   */
  rawRows?: Partial<Record<string, Row[]>>;
  /** Tables whose read THROWS rather than returning `{data,error}`. */
  throws?: string[];
};

/**
 * A fake PostgREST builder covering the operators this module actually uses:
 * select / eq / in / maybeSingle, thenable at the end. Rows are filtered by the
 * accumulated predicates, so a query that forgets a filter returns MORE than it
 * should and the assertion below notices — which is the point of filtering here
 * rather than returning canned rows per call.
 */
/** PostgREST's server-side cap. The fake enforces it whether or not a query
 *  asked to be paged, exactly as the real one does — which is what lets the
 *  pagination test below fail when the loop is removed. */
const SERVER_MAX_ROWS = 1000;

function makeFakeDb(seed: Seed) {
  const tables: Record<string, Row[]> = {
    path_cohort_members: (seed.members ?? []).map((m) => ({ ...m })),
    path_student_profiles: (seed.profiles ?? []).map((p) => ({ ...p })),
    path_task_progress: (seed.progress ?? []).map((p) => ({ ...p })),
  };
  const queries: {
    table: string;
    eqs: [string, unknown][];
    ins: [string, unknown[]][];
    range: [number, number] | null;
  }[] = [];

  const db = {
    from(table: string) {
      const eqs: [string, unknown][] = [];
      const ins: [string, unknown[]][] = [];
      let range: [number, number] | null = null;
      const rows = () => {
        queries.push({ table, eqs: [...eqs], ins: [...ins], range });
        if (seed.throws?.includes(table)) throw new TypeError("fetch failed");
        const err = seed.errors?.[table];
        if (err) return { data: null, error: { message: err } };
        const raw = seed.rawRows?.[table];
        if (raw) return { data: raw.map((r) => ({ ...r })), error: null };
        const matched = (tables[table] ?? []).filter(
          (r) =>
            eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c] as never))
        );
        const from = range ? range[0] : 0;
        // `to` is inclusive in PostgREST; the server cap applies regardless.
        const to = range ? Math.min(range[1], from + SERVER_MAX_ROWS - 1) : SERVER_MAX_ROWS - 1;
        return { data: matched.slice(from, to + 1).map((r) => ({ ...r })), error: null };
      };
      const builder = {
        select: () => builder,
        eq: (c: string, v: unknown) => {
          eqs.push([c, v]);
          return builder;
        },
        in: (c: string, vs: unknown[]) => {
          ins.push([c, vs]);
          return builder;
        },
        range: (from: number, to: number) => {
          range = [from, to];
          return builder;
        },
        maybeSingle: async () => {
          const res = rows();
          return res.error ? res : { data: res.data?.[0] ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(rows()).then(resolve, reject),
      };
      return builder;
    },
  };
  return { db: db as never, queries };
}

const profile = (over: Row = {}): Row => {
  const row: Row = {
    id: "s-maya",
    first_name: "Maya",
    last_name: "Chen",
    band: "g6_8",
    program_version_id: "2026-27",
    ...over,
  };
  // Derived, never defaulted: a fixture whose normalized_name disagreed with its
  // own name would make every match assertion below meaningless.
  return {
    normalized_name: buildNormalizedFwName(String(row.first_name), String(row.last_name)),
    ...row,
  };
};

const BASE: Seed = {
  members: [
    { student_id: "s-maya", cohort_id: BOSTON },
    { student_id: "s-aa", cohort_id: BOSTON },
    { student_id: "s-ham", cohort_id: HAMPTONS },
  ],
  profiles: [
    profile(),
    profile({ id: "s-aa", first_name: "Aaron", last_name: "Zeta", band: "g3_5" }),
    profile({ id: "s-ham", first_name: "Rae", last_name: "Kim", band: "g9_12" }),
  ],
};

/* ══════════════════════════════════════════════════════════════════ the roster ══ */

describe("loadFwCohortRoster", () => {
  it("returns only THIS cohort's students, with names and bands", async () => {
    const { db } = makeFakeDb(BASE);
    const res = await loadFwCohortRoster(db, BOSTON);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.students.map((s) => s.studentId).sort()).toEqual(["s-aa", "s-maya"]);
    expect(res.students.find((s) => s.studentId === "s-aa")).toMatchObject({
      firstName: "Aaron",
      band: "g3_5",
    });
  });

  it("folds each student's decided rows into their resume chip (G21)", async () => {
    const { db } = makeFakeDb({
      ...BASE,
      progress: [
        { student_id: "s-maya", task_id: "1.1.1", state: "verified" },
        { student_id: "s-maya", task_id: "1.2.10", state: "verified" },
        { student_id: "s-maya", task_id: "1.3.1", state: "not_yet" },
      ],
    });
    const res = await loadFwCohortRoster(db, BOSTON);
    if (!res.ok) throw new Error("unreachable");
    expect(res.students.find((s) => s.studentId === "s-maya")?.resume).toEqual({
      furthestTaskId: "1.3.1",
      verified: 2,
      notYet: 1,
    });
    // A student nobody has tapped gets an empty chip, not a missing one.
    expect(res.students.find((s) => s.studentId === "s-aa")?.resume).toEqual({
      furthestTaskId: null,
      verified: 0,
      notYet: 0,
    });
  });

  it("asks the database for the two decided states — not for 11,250 rows", async () => {
    // Pulling every row and filtering in memory works at a desk and does not
    // work on venue wifi at ninety students. Pinned because it is invisible.
    const { db, queries } = makeFakeDb({ ...BASE, progress: [] });
    await loadFwCohortRoster(db, BOSTON);
    const progressQuery = queries.find((q) => q.table === "path_task_progress");
    expect(progressQuery?.ins.find(([c]) => c === "state")?.[1]).toEqual(["verified", "not_yet"]);
  });

  it("reads PAST the 1000-row server cap — the resume chips are not truncated", async () => {
    // Measured against production, not imagined: seeding the 30-student
    // rehearsal cohort put 3,750 progress rows in the table and an unranged
    // select returned exactly 1,000 with no error. At ninety students a
    // weekend's DECIDED rows alone clear the cap, so two thirds of the roster
    // would have carried a silently under-reported chip — worse as the weekend
    // went on, and invisible to any fixture-sized test.
    const students = Array.from({ length: 30 }, (_, i) => `s-${i}`);
    const { db, queries } = makeFakeDb({
      members: students.map((student_id) => ({ student_id, cohort_id: BOSTON })),
      profiles: students.map((id, i) =>
        profile({ id, first_name: `Student${i}`, last_name: "Test" })
      ),
      progress: students.flatMap((student_id) =>
        // 60 decided rows each = 1,800 rows: two pages, and the second one is
        // where every chip past student ~16 lives.
        Array.from({ length: 60 }, (_, t) => ({
          student_id,
          task_id: `1.1.${t + 1}`,
          state: "verified",
        }))
      ),
    });

    const res = await loadFwCohortRoster(db, BOSTON);
    if (!res.ok) throw new Error("unreachable");
    expect(res.students).toHaveLength(30);
    // EVERY student, not just the ones that fit in page one.
    for (const s of res.students) expect(s.resume.verified).toBe(60);
    // And it genuinely paged rather than getting lucky.
    expect(queries.filter((q) => q.table === "path_task_progress").length).toBeGreaterThan(1);
  });

  it("refuses rather than truncating when a read blows past the page bound", async () => {
    // 16 pages × 1000 is the bound. A result this large is a data fault, and a
    // partial list is indistinguishable from a complete one downstream.
    const students = ["s-0"];
    const { db } = makeFakeDb({
      members: students.map((student_id) => ({ student_id, cohort_id: BOSTON })),
      profiles: [profile({ id: "s-0" })],
      progress: Array.from({ length: 16_001 }, (_, t) => ({
        student_id: "s-0",
        task_id: `1.1.${t}`,
        state: "verified",
      })),
    });
    expect(await loadFwCohortRoster(db, BOSTON)).toEqual({ ok: false });
  });

  it("is an empty roster, not a failure, for a cohort with no members", async () => {
    const { db } = makeFakeDb({ members: [], profiles: [] });
    expect(await loadFwCohortRoster(db, BOSTON)).toEqual({ ok: true, students: [] });
  });

  it("reports a read failure rather than an empty roster", async () => {
    // The distinction the copy depends on: "no students yet" and "we couldn't
    // load them" send a guide to two completely different places at 8:55am.
    for (const table of ["path_cohort_members", "path_student_profiles", "path_task_progress"]) {
      const { db } = makeFakeDb({ ...BASE, errors: { [table]: "boom" } });
      expect(await loadFwCohortRoster(db, BOSTON)).toEqual({ ok: false });
    }
  });

  it("drops one unreadable profile rather than losing the whole roster", async () => {
    const { db } = makeFakeDb({
      ...BASE,
      profiles: [profile(), profile({ id: "s-aa", band: null })],
    });
    const res = await loadFwCohortRoster(db, BOSTON);
    if (!res.ok) throw new Error("unreachable");
    expect(res.students.map((s) => s.studentId)).toEqual(["s-maya"]);
  });
});

/* ═══════════════════════════════════════════════ one student's drill-down ══ */

describe("loadFwStudentDrilldown — the read-side of Decision 3", () => {
  it("returns the student, their pinned version, and their task states", async () => {
    const { db } = makeFakeDb({
      ...BASE,
      progress: [
        { student_id: "s-maya", task_id: "1.1.1", state: "verified" },
        { student_id: "s-maya", task_id: "1.1.2", state: "locked" },
        { student_id: "s-ham", task_id: "1.1.1", state: "verified" },
      ],
    });
    const res = await loadFwStudentDrilldown(db, { cohortId: BOSTON, studentId: "s-maya" });
    expect(res).toEqual({
      ok: true,
      value: {
        student: { studentId: "s-maya", firstName: "Maya", lastName: "Chen", band: "g6_8" },
        programVersionId: "2026-27",
        states: { "1.1.1": "verified", "1.1.2": "locked" },
      },
    });
  });

  it("REFUSES a student who is not a member of the active cohort", async () => {
    // The URL-edit case. `resolveFwActorForCohort` proves the guide may act in
    // Boston; it says nothing about which children are in it. Without this gate
    // a Hamptons child's name, band, and full progress render to a Boston guide
    // and the refusal only arrives at the tap.
    const { db } = makeFakeDb(BASE);
    expect(await loadFwStudentDrilldown(db, { cohortId: BOSTON, studentId: "s-ham" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("gives the same answer for a student who does not exist at all", async () => {
    const { db } = makeFakeDb(BASE);
    expect(await loadFwStudentDrilldown(db, { cohortId: BOSTON, studentId: "nope" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("checks membership BEFORE reading the profile — no read, no leak", async () => {
    const { db, queries } = makeFakeDb(BASE);
    await loadFwStudentDrilldown(db, { cohortId: BOSTON, studentId: "s-ham" });
    expect(queries.map((q) => q.table)).toEqual(["path_cohort_members"]);
  });

  it("says `unavailable`, not `not_found`, when a member's profile is not FW-shaped", async () => {
    // A data fault is not an authorization answer: telling a guide the child in
    // front of them does not exist would send them to create a duplicate.
    const { db } = makeFakeDb({
      ...BASE,
      profiles: [profile({ band: null })],
    });
    expect(await loadFwStudentDrilldown(db, { cohortId: BOSTON, studentId: "s-maya" })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("reports a read failure on each of its three queries", async () => {
    for (const table of ["path_cohort_members", "path_student_profiles", "path_task_progress"]) {
      const { db } = makeFakeDb({ ...BASE, errors: { [table]: "boom" } });
      const res = await loadFwStudentDrilldown(db, { cohortId: BOSTON, studentId: "s-maya" });
      expect(res).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("drops a corrupt progress row instead of failing the tree", async () => {
    const { db } = makeFakeDb({
      ...BASE,
      progress: [
        { student_id: "s-maya", task_id: "1.1.1", state: "verified" },
        { student_id: "s-maya", task_id: "1.1.2", state: "haunted" },
      ],
    });
    const res = await loadFwStudentDrilldown(db, { cohortId: BOSTON, studentId: "s-maya" });
    if (!res.ok) throw new Error("unreachable");
    // The dropped task still renders — as `locked`, tappable, and truthful at
    // the RPC. A corrupt state must not make a task unreachable.
    expect(res.value.states).toEqual({ "1.1.1": "verified" });
  });
});

/* ═════════════════════════════════════════════ PROPOSED-1: the match lookup ══ */

describe("loadFwMatchCandidates", () => {
  const KEY = buildNormalizedFwName("Maya", "Chen");

  it("returns the candidate with every cohort it belongs to", async () => {
    const { db } = makeFakeDb({
      ...BASE,
      members: [
        { student_id: "s-maya", cohort_id: BOSTON },
        { student_id: "s-maya", cohort_id: HAMPTONS },
      ],
    });
    expect(await loadFwMatchCandidates(db, KEY)).toEqual({
      ok: true,
      candidates: [
        {
          profileId: "s-maya",
          normalizedName: KEY,
          band: "g6_8",
          cohortIds: [BOSTON, HAMPTONS],
          source: "profile",
        },
      ],
    });
  });

  it("feeds matchFwStudent end to end — a returner reads as same-cohort here", async () => {
    const { db } = makeFakeDb({
      ...BASE,
      members: [
        { student_id: "s-maya", cohort_id: BOSTON },
        { student_id: "s-maya", cohort_id: HAMPTONS },
      ],
    });
    const loaded = await loadFwMatchCandidates(db, KEY);
    if (!loaded.ok) throw new Error("unreachable");
    expect(
      matchFwStudent({
        firstName: "Maya",
        lastName: "Chen",
        cohortId: BOSTON,
        candidates: loaded.candidates,
      })
    ).toEqual({
      kind: "same_cohort",
      matches: [{ profileId: "s-maya", band: "g6_8", source: "profile" }],
    });
  });

  it("returns a candidate with NO memberships rather than skipping it", async () => {
    const { db } = makeFakeDb({ ...BASE, members: [] });
    const res = await loadFwMatchCandidates(db, KEY);
    if (!res.ok) throw new Error("unreachable");
    expect(res.candidates[0].cohortIds).toEqual([]);
  });

  it("does not query memberships at all when nothing matched the name", async () => {
    const { db, queries } = makeFakeDb(BASE);
    expect(await loadFwMatchCandidates(db, buildNormalizedFwName("Nobody", "Here"))).toEqual({
      ok: true,
      candidates: [],
    });
    expect(queries.map((q) => q.table)).toEqual(["path_student_profiles"]);
  });

  it("short-circuits an empty key without touching the database", async () => {
    // An empty normalized name is not a wildcard. Sending it would select every
    // row whose column is '' — which is exactly the blank-key match the matcher
    // refuses one layer up.
    const { db, queries } = makeFakeDb(BASE);
    expect(await loadFwMatchCandidates(db, "")).toEqual({ ok: true, candidates: [] });
    expect(queries).toEqual([]);
  });

  it("FAILS the lookup on a malformed normalized_name, not just a bad band", async () => {
    // The column this lookup FILTERS on, so a non-string could not match today —
    // which is exactly why it was the field left un-narrowed. Pinning it makes
    // fail-closed a property of the code rather than of one query's shape
    // (security review).
    const { db } = makeFakeDb({
      ...BASE,
      rawRows: { path_student_profiles: [{ ...profile(), normalized_name: 12345 }] },
    });
    expect(await loadFwMatchCandidates(db, KEY)).toEqual({ ok: false });
  });

  it("FAILS the lookup on an unreadable candidate — never silently drops one", async () => {
    // The asymmetry with the roster read, and the reason for it: a dropped
    // candidate makes the matcher answer `none` for a child who already has an
    // account, and quick-create then mints them a second one with a suffixed
    // address their family is told is theirs.
    const { db } = makeFakeDb({
      ...BASE,
      profiles: [profile(), profile({ id: "s-dupe", band: "g4_5" })],
    });
    expect(await loadFwMatchCandidates(db, KEY)).toEqual({ ok: false });
  });

  it("reports a read failure on either query", async () => {
    for (const table of ["path_student_profiles", "path_cohort_members"]) {
      const { db } = makeFakeDb({ ...BASE, errors: { [table]: "boom" } });
      expect(await loadFwMatchCandidates(db, KEY)).toEqual({ ok: false });
    }
  });
});

/* ══════════════════════════ the shapes that are NOT `{data, error}` ══ */

describe("reads that throw rather than returning an error", () => {
  // supabase-js reports most failures in band, but a network abort can THROW —
  // and a thrown error in a Server Component walks straight past every typed
  // `{ok:false}` branch and out of the render (reliability review). The fake
  // could not previously express this shape, so the gap was untestable.
  it("turns a thrown roster read into a typed refusal, not an escaped exception", async () => {
    for (const table of ["path_cohort_members", "path_student_profiles", "path_task_progress"]) {
      const { db } = makeFakeDb({ ...BASE, throws: [table] });
      await expect(loadFwCohortRoster(db, BOSTON)).resolves.toEqual({ ok: false });
    }
  });

  it("turns a thrown drill-down read into `unavailable`, never `not_found`", async () => {
    for (const table of ["path_cohort_members", "path_student_profiles", "path_task_progress"]) {
      const { db } = makeFakeDb({ ...BASE, throws: [table] });
      await expect(
        loadFwStudentDrilldown(db, { cohortId: BOSTON, studentId: "s-maya" })
      ).resolves.toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("turns a thrown match lookup into a failed check, never a false `none`", async () => {
    // `none` would send the guide straight to "New student" and mint a second
    // permanent account for a child who already has one.
    const { db } = makeFakeDb({ ...BASE, throws: ["path_student_profiles"] });
    await expect(
      loadFwMatchCandidates(db, buildNormalizedFwName("Maya", "Chen"))
    ).resolves.toEqual({ ok: false });
  });
});

/* ═══════════════════════════════════ the remaining fail-closed branches ══ */

describe("malformed rows the review found untested", () => {
  it("FAILS the match lookup on a malformed MEMBERSHIP row, not just a bad profile", async () => {
    const { db } = makeFakeDb({
      ...BASE,
      rawRows: { path_cohort_members: [{ student_id: "s-maya", cohort_id: 42 }] },
    });
    expect(await loadFwMatchCandidates(db, buildNormalizedFwName("Maya", "Chen"))).toEqual({
      ok: false,
    });
  });

  it("drops a malformed progress row from the ROSTER's resume path too", async () => {
    // The drill-down's equivalent branch was tested; this one — the path the
    // resume chips are built from — was not (testing review).
    const { db } = makeFakeDb({
      ...BASE,
      progress: [
        { student_id: "s-maya", task_id: "1.1.1", state: "verified" },
        { student_id: "s-maya", task_id: "1.1.2", state: "haunted" },
        { student_id: "s-maya", task_id: 999, state: "verified" },
      ],
    });
    const res = await loadFwCohortRoster(db, BOSTON);
    if (!res.ok) throw new Error("unreachable");
    expect(res.students.find((s) => s.studentId === "s-maya")?.resume).toEqual({
      furthestTaskId: "1.1.1",
      verified: 1,
      notYet: 0,
    });
  });
});
