import { describe, expect, it } from "vitest";

import {
  buildFwTaskTree,
  compareFwTaskIds,
  fwBatchStudentIds,
  fwDuplicateNameStudentIds,
  fwSearchDistanceBudget,
  normalizeFwSearchTerm,
  searchFwRoster,
  summarizeFwResume,
  toggleFwBatchExtra,
  type FwRosterStudent,
} from "../fw-nav-rules";
import { FW_BATCH_MAX } from "../fw-rules";
import { parseFwActiveCohort, FW_PREF_UNKNOWN } from "../fw-device";
import type { ProgramContent, UnitTask } from "@/app/path/content/types";
import type { TaskState } from "../transition-table";

/**
 * The guide's navigation decisions (FW Unit 4) — roster search, duplicate
 * disambiguation, the resume chip (G21), the drill-down tree, and the batch
 * picker's cap. Written before the module: these are the rules that decide
 * whether the minute-loop finds the right child, and none of them is
 * inspectable once it is buried in a component.
 */

const student = (over: Partial<FwRosterStudent> = {}): FwRosterStudent => ({
  studentId: "s-1",
  firstName: "Maya",
  lastName: "Chen",
  band: "g6_8",
  ...over,
});

const ROSTER: FwRosterStudent[] = [
  student({ studentId: "s-maya", firstName: "Maya", lastName: "Chen" }),
  student({ studentId: "s-mayb", firstName: "Mayabelle", lastName: "Ortiz" }),
  student({ studentId: "s-jose", firstName: "José", lastName: "Álvarez" }),
  student({ studentId: "s-jean", firstName: "Jean-Luc", lastName: "O'Brien" }),
  student({ studentId: "s-aa", firstName: "Aaron", lastName: "Zeta" }),
];

const ids = (rs: readonly FwRosterStudent[]) => rs.map((r) => r.studentId);

/* ══════════════════════════════════════════════════════════════ normalization ══ */

describe("normalizeFwSearchTerm", () => {
  it("folds case, accents, and punctuation the way a guide types", () => {
    expect(normalizeFwSearchTerm("José")).toBe("jose");
    expect(normalizeFwSearchTerm("O’Brien")).toBe("obrien");
    expect(normalizeFwSearchTerm("  Jean-Luc  ")).toBe("jean luc");
  });

  it("NEVER throws on the characters the identity normalizer refuses", () => {
    // buildNormalizedFwName throws on homoglyphs and control characters,
    // because minting an address from one is unrecoverable. A SEARCH BOX has no
    // such consequence and must not explode mid-keystroke — the guide is typing
    // into it with a child waiting. Deliberately a different, lenient function.
    expect(() => normalizeFwSearchTerm("Mаya")).not.toThrow();
    expect(() => normalizeFwSearchTerm("Ma‮ya")).not.toThrow();
  });

  it("reduces a query of pure punctuation to the empty string", () => {
    expect(normalizeFwSearchTerm("--,,")).toBe("");
  });
});

/* ═══════════════════════════════════════════════════════════════════ search ══ */

describe("searchFwRoster", () => {
  it("returns the whole roster, first-name alphabetical, for an empty query", () => {
    expect(ids(searchFwRoster(ROSTER, ""))).toEqual([
      "s-aa",
      "s-jean",
      "s-jose",
      "s-maya",
      "s-mayb",
    ]);
    expect(ids(searchFwRoster(ROSTER, "   "))).toEqual(ids(searchFwRoster(ROSTER, "")));
  });

  it("ranks a shorter prefix hit above a longer one — 'may' finds Maya first", () => {
    expect(ids(searchFwRoster(ROSTER, "may"))).toEqual(["s-maya", "s-mayb"]);
  });

  it("matches the last name as readily as the first", () => {
    expect(ids(searchFwRoster(ROSTER, "chen"))).toEqual(["s-maya"]);
  });

  it("matches across the whole name, so 'maya c' finds Maya Chen", () => {
    expect(ids(searchFwRoster(ROSTER, "maya c"))).toEqual(["s-maya"]);
  });

  it("finds an accented name typed in plain ASCII", () => {
    expect(ids(searchFwRoster(ROSTER, "jose"))).toEqual(["s-jose"]);
    expect(ids(searchFwRoster(ROSTER, "alvarez"))).toEqual(["s-jose"]);
  });

  it("finds a hyphenated name typed with a space, and vice versa", () => {
    expect(ids(searchFwRoster(ROSTER, "jean luc"))).toEqual(["s-jean"]);
    expect(ids(searchFwRoster(ROSTER, "jeanluc"))).toEqual(["s-jean"]);
  });

  it("tolerates a typo once the query is long enough to carry the signal", () => {
    // "chne" — transposed. Four characters, budget 1.
    expect(ids(searchFwRoster(ROSTER, "chne"))).toEqual(["s-maya"]);
  });

  it("does NOT fuzzy-match a one- or two-character query", () => {
    // At two characters everything is within distance 1 of everything; a fuzzy
    // hit there would put the whole roster on screen in rank order and the
    // guide would scroll past the child they typed.
    expect(ids(searchFwRoster(ROSTER, "ch"))).toEqual(["s-maya"]);
    expect(ids(searchFwRoster(ROSTER, "zz"))).toEqual([]);
  });

  it("returns nothing rather than everything when the query matches no one", () => {
    expect(searchFwRoster(ROSTER, "quixotic")).toEqual([]);
  });

  it("ranks a name that STARTS with the query above one that merely contains it", () => {
    // Two students, one match class apart. A guide typing the start of a name
    // means the start of a name; burying that hit under a mid-word one is how a
    // search box stops being trusted.
    const roster = [
      // "ana crossley" CONTAINS "ross" mid-word; neither name part starts with it.
      student({ studentId: "s-ana", firstName: "Ana", lastName: "Crossley" }),
      // "ross" is the whole last name — a prefix hit on a part.
      student({ studentId: "s-maya", firstName: "Maya", lastName: "Ross" }),
    ];
    expect(ids(searchFwRoster(roster, "ross"))).toEqual(["s-maya", "s-ana"]);
  });

  it("breaks a same-class tie by the TIGHTER hit, not alphabetically", () => {
    // Both are last-name prefix hits on "chen". Alphabetically Ali comes first;
    // the guide who typed the whole of Zoe's last name meant Zoe.
    const roster = [
      student({ studentId: "s-ali", firstName: "Ali", lastName: "Chenoweth" }),
      student({ studentId: "s-zoe", firstName: "Zoe", lastName: "Chen" }),
    ];
    expect(ids(searchFwRoster(roster, "chen"))).toEqual(["s-zoe", "s-ali"]);
  });

  it("orders exact-prefix hits ahead of fuzzy ones", () => {
    const roster = [
      student({ studentId: "s-fuzzy", firstName: "Aaronn", lastName: "Vance" }),
      student({ studentId: "s-exact", firstName: "Aaron", lastName: "Zeta" }),
    ];
    expect(ids(searchFwRoster(roster, "aaron"))).toEqual(["s-exact", "s-fuzzy"]);
  });

  it("is stable for two students with identical names", () => {
    const roster = [
      student({ studentId: "s-b", firstName: "Maya", lastName: "Chen" }),
      student({ studentId: "s-a", firstName: "Maya", lastName: "Chen" }),
    ];
    // Tie broken by studentId so the roster does not reshuffle between renders.
    expect(ids(searchFwRoster(roster, "maya"))).toEqual(["s-a", "s-b"]);
  });
});

describe("fwSearchDistanceBudget", () => {
  it("grows with the query and is zero for the shortest ones", () => {
    expect(fwSearchDistanceBudget(0)).toBe(0);
    expect(fwSearchDistanceBudget(2)).toBe(0);
    expect(fwSearchDistanceBudget(3)).toBe(1);
    expect(fwSearchDistanceBudget(5)).toBe(1);
    expect(fwSearchDistanceBudget(6)).toBe(2);
    expect(fwSearchDistanceBudget(40)).toBe(2);
  });
});

/* ═════════════════════════════════════════════════════════ duplicate names ══ */

describe("fwDuplicateNameStudentIds", () => {
  it("flags every student sharing a display name, and only them", () => {
    const roster = [
      student({ studentId: "s-1", firstName: "Maya", lastName: "Chen" }),
      student({ studentId: "s-2", firstName: "Maya", lastName: "Chen" }),
      student({ studentId: "s-3", firstName: "Aaron", lastName: "Zeta" }),
    ];
    expect([...fwDuplicateNameStudentIds(roster)].sort()).toEqual(["s-1", "s-2"]);
  });

  it("treats names that differ only by accent or punctuation as the same name", () => {
    // They read identically on a roster row at arm's length, which is exactly
    // when the band chip has to be there.
    const roster = [
      student({ studentId: "s-1", firstName: "José", lastName: "Álvarez" }),
      student({ studentId: "s-2", firstName: "Jose", lastName: "Alvarez" }),
    ];
    expect([...fwDuplicateNameStudentIds(roster)].sort()).toEqual(["s-1", "s-2"]);
  });

  it("returns an empty set for a roster with no collisions", () => {
    expect(fwDuplicateNameStudentIds(ROSTER).size).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════ the resume chip ══ */

describe("compareFwTaskIds", () => {
  it("orders numerically, not lexically — 1.2.10 comes after 1.2.9", () => {
    expect(compareFwTaskIds("1.2.9", "1.2.10")).toBeLessThan(0);
    expect(compareFwTaskIds("1.10.1", "1.9.1")).toBeGreaterThan(0);
    expect(compareFwTaskIds("2.1.1", "1.9.9")).toBeGreaterThan(0);
    expect(compareFwTaskIds("1.2.4", "1.2.4")).toBe(0);
  });
});

describe("summarizeFwResume (G21)", () => {
  const rows = (xs: [string, TaskState][]) => xs.map(([taskId, state]) => ({ taskId, state }));

  it("names the furthest DECIDED task and counts both decisions", () => {
    expect(
      summarizeFwResume(
        rows([
          ["1.1.1", "verified"],
          ["1.2.10", "verified"],
          ["1.2.4", "not_yet"],
          ["1.3.1", "locked"],
        ])
      )
    ).toEqual({ furthestTaskId: "1.2.10", verified: 2, notYet: 1 });
  });

  it("counts a not-yet as a position reached — the guide worked it", () => {
    expect(summarizeFwResume(rows([["3.4.2", "not_yet"]]))).toEqual({
      furthestTaskId: "3.4.2",
      verified: 0,
      notYet: 1,
    });
  });

  it("is empty for a fresh student — the chip renders nothing, not a zero", () => {
    expect(summarizeFwResume(rows([["1.1.1", "locked"]]))).toEqual({
      furthestTaskId: null,
      verified: 0,
      notYet: 0,
    });
    expect(summarizeFwResume([])).toEqual({ furthestTaskId: null, verified: 0, notYet: 0 });
  });

  it("ignores Path work states — only an FW DECISION is a position", () => {
    // A converted student could carry `available`/`in_progress`/`submitted`
    // rows. None of them is a guide's decision, and counting one would show a
    // resume chip for work no FW guide did.
    expect(
      summarizeFwResume(
        rows([
          ["1.1.1", "available"],
          ["1.1.2", "in_progress"],
          ["1.1.3", "submitted"],
        ])
      )
    ).toEqual({ furthestTaskId: null, verified: 0, notYet: 0 });
  });

  it("skips a malformed task id rather than sorting NaN to the top", () => {
    expect(
      summarizeFwResume(rows([["1.1.1", "verified"], ["banana", "verified"]]))
    ).toEqual({ furthestTaskId: "1.1.1", verified: 2, notYet: 0 });
  });

  it("names NO position when every decided row is malformed", () => {
    // The case compareFwTaskIds' fallback cannot cover: with no real id to lose
    // to, a garbage id would be seeded as the furthest position and rendered on
    // the roster chip.
    expect(summarizeFwResume(rows([["banana", "verified"], ["", "not_yet"]]))).toEqual({
      furthestTaskId: null,
      verified: 1,
      notYet: 1,
    });
  });
});

/* ════════════════════════════════════════════════════════════ the task tree ══ */

const task = (id: string, seq: number, over: Partial<UnitTask> = {}): UnitTask => ({
  id,
  seq,
  title: `Task ${id}`,
  body: "body",
  doneWhen: "done when",
  bandVariants: {},
  completesCriterion: false,
  ...over,
});

const PROGRAM: ProgramContent = {
  versionId: "test",
  phases: [
    {
      num: "01",
      key: "SELL",
      subtitle: "Learn to confidently sell anything.",
      seq: 1,
      criteria: [
        {
          id: "1.1",
          seq: 1,
          passCriterion: "Pass 1.1",
          tasks: [task("1.1.1", 1), task("1.1.2", 2, { completesCriterion: true })],
        },
        { id: "1.2", seq: 2, passCriterion: "Pass 1.2", tasks: [task("1.2.4", 1, { completesCriterion: true })] },
      ],
    },
    {
      num: "02",
      key: "BUILD",
      subtitle: "Build it.",
      seq: 2,
      criteria: [{ id: "2.1", seq: 1, passCriterion: "Pass 2.1", tasks: [task("2.1.1", 1, { completesCriterion: true })] }],
    },
  ],
};

describe("buildFwTaskTree", () => {
  it("exposes EVERY task in the catalog — no gating, ever (FW-D5)", () => {
    const tree = buildFwTaskTree({ program: PROGRAM, states: {} });
    const allTaskIds = tree.flatMap((p) => p.criteria.flatMap((c) => c.tasks.map((t) => t.id)));
    expect(allTaskIds).toEqual(["1.1.1", "1.1.2", "1.2.4", "2.1.1"]);
  });

  it("reads an absent progress row as `locked`, never as unreachable", () => {
    const tree = buildFwTaskTree({ program: PROGRAM, states: { "1.1.1": "verified" } });
    expect(tree[0].criteria[0].tasks.map((t) => t.state)).toEqual(["verified", "locked"]);
  });

  it("rolls decision counts up through criterion and phase", () => {
    const tree = buildFwTaskTree({
      program: PROGRAM,
      states: { "1.1.1": "verified", "1.1.2": "not_yet", "1.2.4": "verified" },
    });
    expect(tree[0].criteria[0]).toMatchObject({ id: "1.1", verified: 1, notYet: 1, total: 2 });
    expect(tree[0].criteria[1]).toMatchObject({ id: "1.2", verified: 1, notYet: 0, total: 1 });
    expect(tree[0]).toMatchObject({ num: "01", key: "SELL", verified: 2, notYet: 1, total: 3 });
    expect(tree[1]).toMatchObject({ num: "02", verified: 0, notYet: 0, total: 1 });
  });

  it("preserves the curriculum's own phase, criterion, and task order", () => {
    const tree = buildFwTaskTree({ program: PROGRAM, states: {} });
    expect(tree.map((p) => p.num)).toEqual(["01", "02"]);
    expect(tree[0].criteria.map((c) => c.id)).toEqual(["1.1", "1.2"]);
    expect(tree[0].criteria[0].tasks.map((t) => t.seq)).toEqual([1, 2]);
  });

  it("carries the criterion-closing marker through, so the tree can show it", () => {
    const tree = buildFwTaskTree({ program: PROGRAM, states: {} });
    expect(tree[0].criteria[0].tasks.map((t) => t.completesCriterion)).toEqual([false, true]);
  });

  it("ignores a state for a task the pinned program does not contain", () => {
    // A converted student, or a state map built from a different version. The
    // tree renders the PROGRAM, so a stray key must not invent a row.
    const tree = buildFwTaskTree({ program: PROGRAM, states: { "9.9.9": "verified" } });
    expect(tree.flatMap((p) => p.criteria.flatMap((c) => c.tasks.map((t) => t.id)))).not.toContain(
      "9.9.9"
    );
    expect(tree[0].verified).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════ the batch picker ══ */

describe("toggleFwBatchExtra", () => {
  const toggle = (extras: string[], studentId: string) =>
    toggleFwBatchExtra({ extras, studentId, primaryStudentId: "s-primary" });

  it("adds and removes a teammate", () => {
    expect(toggle([], "s-a")).toEqual({ ok: true, extras: ["s-a"] });
    expect(toggle(["s-a"], "s-a")).toEqual({ ok: true, extras: [] });
  });

  it("caps the whole selection at FW_BATCH_MAX, counting the primary", () => {
    const full = Array.from({ length: FW_BATCH_MAX - 1 }, (_, i) => `s-${i}`);
    expect(fwBatchStudentIds("s-primary", full)).toHaveLength(FW_BATCH_MAX);
    const refused = toggle(full, "s-one-too-many");
    expect(refused).toEqual({ ok: false, reason: "at_max", extras: full });
  });

  it("still allows REMOVING a teammate when the selection is full", () => {
    const full = Array.from({ length: FW_BATCH_MAX - 1 }, (_, i) => `s-${i}`);
    expect(toggle(full, "s-0")).toEqual({ ok: true, extras: full.slice(1) });
  });

  it("refuses to toggle the primary — they are the task view's own student", () => {
    expect(toggle(["s-a"], "s-primary")).toEqual({
      ok: false,
      reason: "is_primary",
      extras: ["s-a"],
    });
  });

  it("does not read FW_BATCH_MAX as a literal — the cap tracks the shared constant", () => {
    // Guards the exact thing the plan asked for ("do not retype 3"): if the
    // shared constant moved and this module kept a hard-coded 3, the selection
    // built from FW_BATCH_MAX below would be refused (or under-filled) here.
    const oneShyOfFull = Array.from({ length: FW_BATCH_MAX - 2 }, (_, i) => `s-${i}`);
    expect(toggle(oneShyOfFull, "s-last").ok).toBe(true);
  });
});

describe("fwBatchStudentIds", () => {
  it("puts the primary first — the result list reads like the picker", () => {
    expect(fwBatchStudentIds("s-primary", ["s-a", "s-b"])).toEqual(["s-primary", "s-a", "s-b"]);
  });

  it("never lists the primary twice, even if it leaks into extras", () => {
    expect(fwBatchStudentIds("s-primary", ["s-primary", "s-a"])).toEqual(["s-primary", "s-a"]);
  });
});

/* ════════════════════════════════════ the device preference parser ══ */

describe("parseFwActiveCohort", () => {
  it("reads a well-formed stored value", () => {
    expect(parseFwActiveCohort(JSON.stringify({ id: "c-1", slug: "boston" }))).toEqual({
      id: "c-1",
      slug: "boston",
    });
  });

  it("is null for every shape it cannot trust, and NEVER throws", () => {
    // The picker that reads this is the screen a guide starts their shift on.
    for (const raw of [
      null,
      FW_PREF_UNKNOWN,
      "not json at all",
      "null",
      '"a string"',
      "[]",
      JSON.stringify({ id: "c-1" }),
      JSON.stringify({ slug: "boston" }),
      JSON.stringify({ id: 42, slug: "boston" }),
    ]) {
      expect(() => parseFwActiveCohort(raw)).not.toThrow();
      expect(parseFwActiveCohort(raw)).toBeNull();
    }
  });
});
