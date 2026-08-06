import { describe, expect, it } from "vitest";

import {
  buildFwTaskTree,
  compareFwTaskIds,
  fwDuplicateNameStudentIds,
  fwPickerHeadline,
  fwPickerRedirectsToSingleCohort,
  fwPhaseLabel,
  fwPhaseParamForTaskId,
  fwPhaseSlug,
  fwPickerZeroState,
  fwSearchDistanceBudget,
  fwSelectedPhaseKey,
  fwSidebarNames,
  fwUnfinishedStudents,
  FW_BRAND_SUFFIX,
  FW_OPS_CREATE_PATH,
  normalizeFwSearchTerm,
  searchFwRoster,
  summarizeFwResume,
  type FwRosterStudent,
  type FwUnfinishedCandidateRow,
} from "../fw-nav-rules";
import { parseFwActiveCohort, FW_PREF_UNKNOWN } from "../fw-device";
import type { ProgramContent, UnitTask } from "@/app/lib/fp/content/types";
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

/* ══════════════════════════════════════════════ the brand suffix (D1 Option A) ══ */

describe("FW_BRAND_SUFFIX", () => {
  it("names First Profit — the parent brand every guide-facing title must carry", () => {
    expect(FW_BRAND_SUFFIX).toContain("First Profit");
  });

  it("starts with a separator, so a page appends it to a title without supplying one", () => {
    // The separator travels WITH the constant: a page that concatenates
    // `${title}${FW_BRAND_SUFFIX}` must never produce "Founders WeekendFirst
    // Profit". Asserted as "leading non-word characters", not as one exact
    // spelling — the em-dash choice is the constant's to make.
    expect(FW_BRAND_SUFFIX).toMatch(/^\s*[^\w\s]/u);
    expect(FW_BRAND_SUFFIX.trimEnd()).toBe(FW_BRAND_SUFFIX);
  });
});

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

/* ═══════════════════════════════════ the student sidebar (redesign Unit 7, R18) ══ */

describe("fwSidebarNames", () => {
  const labels = (rs: readonly FwRosterStudent[]) => fwSidebarNames(rs).map((n) => n.label);

  it("formats First + last initial with a period", () => {
    expect(labels([student({ firstName: "Maya", lastName: "Rodriguez" })])).toEqual(["Maya R."]);
  });

  it("sorts alphabetically — locale-aware and case-folded, id as the final tiebreak", () => {
    const roster = [
      student({ studentId: "s-b", firstName: "bella", lastName: "Ng" }),
      student({ studentId: "s-e", firstName: "Élodie", lastName: "Fournier" }),
      student({ studentId: "s-a", firstName: "Aaron", lastName: "Zeta" }),
    ];
    // "bella" (lowercase) between Aaron and Élodie; é folds to e so Élodie is
    // not exiled past Z the way a raw code-point sort would put it.
    expect(labels(roster)).toEqual(["Aaron Z.", "bella N.", "Élodie F."]);
  });

  it("carries the caller's richer entry type through un-narrowed", () => {
    const entries = [{ ...student({ firstName: "Maya", lastName: "Chen" }), extra: 7 }];
    expect(fwSidebarNames(entries)[0].student.extra).toBe(7);
  });

  it("extends colliding surnames until distinct — Maya Ro. / Maya Ru.", () => {
    const roster = [
      student({ studentId: "s-1", firstName: "Maya", lastName: "Rodriguez" }),
      student({ studentId: "s-2", firstName: "Maya", lastName: "Ruiz" }),
    ];
    expect(labels(roster)).toEqual(["Maya Ro.", "Maya Ru."]);
  });

  it("is deterministic and stable — input order never changes anyone's label or position", () => {
    const roster = [
      student({ studentId: "s-1", firstName: "Maya", lastName: "Rodriguez" }),
      student({ studentId: "s-2", firstName: "Maya", lastName: "Ruiz" }),
      student({ studentId: "s-3", firstName: "Aaron", lastName: "Zeta" }),
    ];
    const forward = fwSidebarNames(roster);
    const reversed = fwSidebarNames([...roster].reverse());
    expect(reversed).toEqual(forward);
    expect(forward.map((n) => n.student.studentId)).toEqual(["s-3", "s-1", "s-2"]);
  });

  it("collides case- and accent-insensitively, the same folding as the duplicate chip", () => {
    const roster = [
      student({ studentId: "s-1", firstName: "maya", lastName: "rodriguez" }),
      student({ studentId: "s-2", firstName: "Maya", lastName: "Ruiz" }),
    ];
    // "maya r." and "Maya R." are one pair to a guide's eye — both must extend.
    expect(labels(roster)).toEqual(["maya ro.", "Maya Ru."]);
  });

  it("does NOT extend across different initials or different first names", () => {
    const roster = [
      student({ studentId: "s-1", firstName: "Maya", lastName: "Rodriguez" }),
      student({ studentId: "s-2", firstName: "Maya", lastName: "Chen" }),
      student({ studentId: "s-3", firstName: "Mia", lastName: "Ruiz" }),
    ];
    expect(labels(roster).sort()).toEqual(["Maya C.", "Maya R.", "Mia R."]);
  });

  it("falls back to the FULL last name when no strictly-shorter prefix distinguishes", () => {
    // "Ro" is a prefix of "Rodriguez": any prefix short enough to abbreviate
    // "Ro" cannot tell them apart, and "Maya Ro" next to "Maya Ro." would be a
    // wrong-child trap. Both render whole, no period.
    const roster = [
      student({ studentId: "s-1", firstName: "Maya", lastName: "Ro" }),
      student({ studentId: "s-2", firstName: "Maya", lastName: "Rodriguez" }),
    ];
    expect(labels(roster)).toEqual(["Maya Ro", "Maya Rodriguez"]);
  });

  it("near-identical surnames fall back to full names too, not a nine-character 'prefix'", () => {
    // Distinguishing "Rodrigo" from "Rodriguez" needs 7 characters — the whole
    // of "Rodrigo" — so the strictly-shorter rule sends both to full names.
    const roster = [
      student({ studentId: "s-1", firstName: "Maya", lastName: "Rodriguez" }),
      student({ studentId: "s-2", firstName: "Maya", lastName: "Rodrigo" }),
    ];
    expect(labels(roster)).toEqual(["Maya Rodrigo", "Maya Rodriguez"]);
  });

  it("identical full names render identically — the band chip, not the label, disambiguates (G22)", () => {
    const roster = [
      student({ studentId: "s-1", firstName: "Maya", lastName: "Chen" }),
      student({ studentId: "s-2", firstName: "Maya", lastName: "Chen" }),
    ];
    expect(labels(roster)).toEqual(["Maya Chen", "Maya Chen"]);
    // …and the id tiebreak keeps even the identical pair stably ordered.
    expect(fwSidebarNames(roster).map((n) => n.student.studentId)).toEqual(["s-1", "s-2"]);
  });

  it("a missing last name renders the first name alone, and never throws", () => {
    expect(labels([student({ firstName: "Cher", lastName: "" })])).toEqual(["Cher"]);
    expect(labels([student({ firstName: "Cher", lastName: "   " })])).toEqual(["Cher"]);
  });

  it("returns an empty list for an empty roster", () => {
    expect(fwSidebarNames([])).toEqual([]);
  });

  it("three-way collisions resolve as a group at one shared prefix length", () => {
    const roster = [
      student({ studentId: "s-1", firstName: "Maya", lastName: "Rodriguez" }),
      student({ studentId: "s-2", firstName: "Maya", lastName: "Ruiz" }),
      student({ studentId: "s-3", firstName: "Maya", lastName: "Reyes" }),
    ];
    expect(labels(roster)).toEqual(["Maya Re.", "Maya Ro.", "Maya Ru."]);
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

/* ═════════════════════ the phase nav + the retired task route (Unit 8, R19/R21) ══ */

describe("fwPhaseSlug / fwPhaseLabel", () => {
  it("derives the URL slug and the single-word nav entry from the key — one source", () => {
    expect(fwPhaseSlug("SELL")).toBe("sell");
    expect(fwPhaseSlug("VALIDATE")).toBe("validate");
    expect(fwPhaseLabel("SELL")).toBe("Sell");
    expect(fwPhaseLabel("BUILD")).toBe("Build");
    expect(fwPhaseLabel("VALIDATE")).toBe("Validate");
    expect(fwPhaseLabel("GROW")).toBe("Grow");
    expect(fwPhaseLabel("SCALE")).toBe("Scale");
  });
});

describe("fwPhaseParamForTaskId — the retired task route's landing phase", () => {
  it("maps the leading component to the phase slug", () => {
    expect(fwPhaseParamForTaskId("1.1.1")).toBe("sell");
    expect(fwPhaseParamForTaskId("2.3.1")).toBe("build");
    expect(fwPhaseParamForTaskId("3.1.2")).toBe("validate");
    expect(fwPhaseParamForTaskId("4.5.5")).toBe("grow");
    expect(fwPhaseParamForTaskId("5.2.1")).toBe("scale");
  });

  it("returns null — never a throw — for anything that is not a real task id", () => {
    // The redirect runs on URLs only stale SW shells and bookmarks still hold;
    // a garbage id lands phase-less rather than erroring the bounce.
    expect(fwPhaseParamForTaskId("banana")).toBeNull();
    expect(fwPhaseParamForTaskId("9.1.1")).toBeNull();
    expect(fwPhaseParamForTaskId("0.1.1")).toBeNull();
    expect(fwPhaseParamForTaskId("1.2")).toBeNull();
    expect(fwPhaseParamForTaskId("")).toBeNull();
  });
});

describe("fwSelectedPhaseKey — ?phase= resolution", () => {
  const PHASES = [{ key: "SELL" as const }, { key: "BUILD" as const }];

  it("matches case-insensitively against the pinned program's own phases", () => {
    expect(fwSelectedPhaseKey(PHASES, "build")).toBe("BUILD");
    expect(fwSelectedPhaseKey(PHASES, "BUILD")).toBe("BUILD");
    expect(fwSelectedPhaseKey(PHASES, " sell ")).toBe("SELL");
  });

  it("falls back to the FIRST phase for absent, stale, or fabricated values", () => {
    // The param arrives from reloads, SW-cached shells, and redirects off the
    // retired task route — none of which may take the page down or land nowhere.
    expect(fwSelectedPhaseKey(PHASES, null)).toBe("SELL");
    expect(fwSelectedPhaseKey(PHASES, undefined)).toBe("SELL");
    expect(fwSelectedPhaseKey(PHASES, "")).toBe("SELL");
    expect(fwSelectedPhaseKey(PHASES, "scale")).toBe("SELL");
    expect(fwSelectedPhaseKey(PHASES, "<script>")).toBe("SELL");
  });

  it("is null only for an empty program (total, never throws)", () => {
    expect(fwSelectedPhaseKey([], "sell")).toBeNull();
  });

  it("agrees with the redirect: a task's derived param round-trips to its phase", () => {
    // The retired route computes ?phase= via fwPhaseParamForTaskId; the student
    // page resolves it via fwSelectedPhaseKey. If the two ever disagree, a
    // redirected task URL lands on the wrong phase silently — pinned here.
    const fiveKeys = [
      { key: "SELL" as const },
      { key: "BUILD" as const },
      { key: "VALIDATE" as const },
      { key: "GROW" as const },
      { key: "SCALE" as const },
    ];
    for (const [taskId, key] of [
      ["1.1.1", "SELL"],
      ["2.1.1", "BUILD"],
      ["3.1.1", "VALIDATE"],
      ["4.1.1", "GROW"],
      ["5.1.1", "SCALE"],
    ] as const) {
      expect(fwSelectedPhaseKey(fiveKeys, fwPhaseParamForTaskId(taskId))).toBe(key);
    }
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

/* ══════════════════════ the /fp/fw picker, by role (Unit 4; R13, R14) ══ */

/**
 * The three role-branched decisions on `/fp/fw`.
 *
 * ⚠️ THE OTHER HALF OF THIS LIVES IN `app/lib/staff-bar/__tests__/bar-wiring.test.ts`.
 * The rules are tested here; that `/fp/fw/(app)/page.tsx` actually CALLS them, and
 * re-derives none of them inline, is a property of the component source that only a
 * scan can reach (no jsdom). A reviewer noted the split is not obvious from either
 * file's name — consolidating the scans nearer the code they describe is an open
 * follow-up, recorded rather than done, because moving them means duplicating the
 * source-reading helpers into three files.
 *
 * They live here, in a pure module, for the reason the file header already gives and
 * the Staff Front Door plan repeats: this repo runs `environment: "node"` with no
 * jsdom, so an `isStaff ? … : …` written inline in `page.tsx` is a decision CI cannot
 * see. The previous unit's headline review finding was exactly that shape — two
 * decisions inline in a `.tsx` where flipping either left the whole suite green, found
 * independently by five reviewers.
 *
 * Every assertion below therefore pins BOTH branches and their difference. A test that
 * only checked the staff branch would pass on a rule that had stopped branching.
 */
describe("fwPickerRedirectsToSingleCohort — R14, staff are exempt", () => {
  it("redirects a guide who holds exactly one cohort", () => {
    // Decision 3, unchanged: one grant means one place to work and nothing to choose,
    // so the switcher never appears for them.
    expect(fwPickerRedirectsToSingleCohort({ isStaff: false, cohortCount: 1 })).toBe(true);
  });

  it("does NOT redirect staff who can see exactly one cohort", () => {
    // THE EXEMPTION, and the mutation guard for it. For staff, one cohort means "one
    // exists so far and more are coming" — the picker and the create path are exactly
    // what they need. Without this, R11–R13 are unreachable in the one-cohort state,
    // which is the state the system sits in from the first real weekend until the
    // second.
    expect(fwPickerRedirectsToSingleCohort({ isStaff: true, cohortCount: 1 })).toBe(false);
  });

  it("never redirects on zero or on two, for either role", () => {
    for (const isStaff of [false, true]) {
      for (const cohortCount of [0, 2, 5]) {
        expect(fwPickerRedirectsToSingleCohort({ isStaff, cohortCount }), `${isStaff}/${cohortCount}`).toBe(
          false
        );
      }
    }
  });
});

describe("fwPickerHeadline / fwPickerZeroState — R13, the two zeroes mean different things", () => {
  it("headlines differ by role", () => {
    expect(fwPickerHeadline(true)).not.toBe(fwPickerHeadline(false));
  });

  it("a guide's zero means NO GRANTS, and sends them to staff", () => {
    const zero = fwPickerZeroState(false);
    expect(zero.body).toMatch(/guide/i);
    expect(zero.body).toMatch(/staff/i);
    // A guide cannot create a weekend, and offering them the path would hand them a
    // 404 from a surface that refuses non-staff.
    expect(zero.create).toBeNull();
  });

  it("a staff member's zero means NONE EXIST, and offers the create path", () => {
    // Staff see every weekend, so their zero is a fact about the system rather than
    // about their own grants. Telling them to "ask The 120 staff" would be telling
    // them to ask themselves.
    const zero = fwPickerZeroState(true);
    expect(zero.body).not.toMatch(/ask/i);
    expect(zero.body).toMatch(/none|no founders weekend|don't exist|doesn't exist|not been/i);
    expect(zero.create).toEqual({ href: FW_OPS_CREATE_PATH, label: expect.any(String) });
    expect(zero.create?.label).toBeTruthy();
  });

  it("the guide's zero-state sentence is UNCHANGED from before the staff branch existed", () => {
    // The plan requires the guide's copy to stay exactly as it was -- R13 adds a staff
    // branch, it does not reword the guide one. Pinned as an exact string rather than
    // by keyword, because "still mentions guide and staff" is satisfied by a rewrite
    // that changes what a guide is told at the start of a shift.
    expect(fwPickerZeroState(false).body).toBe(
      "You're signed in, but you aren't a guide on any Founders Weekend cohort yet. Ask The 120 staff to add you."
    );
  });

  it("the two bodies are not the same sentence", () => {
    // The whole of R13 in one line: a rule that stopped branching would still satisfy
    // every "contains the word staff" assertion above, because both sentences can
    // legitimately contain it.
    expect(fwPickerZeroState(true).body).not.toBe(fwPickerZeroState(false).body);
  });

  it("the create path is the ops surface that actually holds the form", () => {
    // Pinned as a value, not just as "some string": the New weekend form lives at the
    // bottom of `/fp/fw/ops`, and a link to a page without it is a dead end offered to
    // someone who has just been told there is nothing here.
    expect(FW_OPS_CREATE_PATH).toBe("/fp/fw/ops");
  });
});

/* ═════════════════════════════════════════════════════ unfinished quick-creates ══ */

describe("fwUnfinishedStudents", () => {
  /**
   * The roster banner's classifier (todo 001) — which profiles are half-created
   * quick-creates a guide should be offered to FINISH. The reachable states
   * mirror `provisionFwStudent`'s strict write order (profile → membership →
   * materialization): a profile with no membership anywhere, and a member of
   * this cohort with no materialized rows. "Materialized without membership" is
   * deliberately NOT a case below, because materialization only runs after the
   * membership upsert succeeds — the state cannot exist.
   */
  const COHORT = "cohort-boston";

  const candidate = (
    over: Partial<FwUnfinishedCandidateRow> = {}
  ): FwUnfinishedCandidateRow => ({
    profileId: "p-maya",
    firstName: "Maya",
    lastName: "Chen",
    band: "g6_8",
    childId: null,
    noticeAttestedBy: "guide-1",
    memberCohortIds: [COHORT],
    materialized: true,
    ...over,
  });

  const run = (candidates: FwUnfinishedCandidateRow[]) =>
    fwUnfinishedStudents({ cohortId: COHORT, candidates });

  it("a fully-created student — member here, materialized — is NOT unfinished", () => {
    expect(run([candidate()])).toEqual([]);
  });

  it("a profile with NO membership anywhere is unfinished (the membership leg failed)", () => {
    expect(run([candidate({ memberCohortIds: [], materialized: null })])).toEqual([
      { profileId: "p-maya", firstName: "Maya", lastName: "Chen", band: "g6_8" },
    ]);
  });

  it("a member of THIS cohort with no materialized rows is unfinished (the materialization leg failed)", () => {
    // Reachable: the membership upsert precedes ensureFwStudentProgress in
    // provisionFwStudent, so the leg after it can fail with the row in place.
    // This student already renders as a roster row with a tap-dead tree.
    expect(run([candidate({ materialized: false })])).toEqual([
      { profileId: "p-maya", firstName: "Maya", lastName: "Chen", band: "g6_8" },
    ]);
  });

  it("import-path profiles are NEVER flagged — the importer stamps no attestation", () => {
    // The discriminator: quick-create stamps notice_attested_by on the profile
    // insert itself; the bulk importer always passes null (PROPOSED-3 rejected).
    // A half-imported row belongs to the importer's own exception/resume
    // machinery, not to a guide's banner — on EITHER arm.
    expect(run([candidate({ noticeAttestedBy: null, memberCohortIds: [] })])).toEqual([]);
    expect(run([candidate({ noticeAttestedBy: null, materialized: false })])).toEqual([]);
  });

  it("a Path (roster-child) profile is never flagged, whatever its rows look like", () => {
    expect(run([candidate({ childId: "child-1", memberCohortIds: [] })])).toEqual([]);
  });

  it("another weekend's member stays off this cohort's banner", () => {
    // The cross-cohort privacy line PROPOSED-1 draws: a Boston guide has no
    // business reading a Hamptons child's name, even a half-created one. Since
    // 2026-07-28 the loader's `intended_cohort_id` filter is the PRIMARY scope
    // (a candidate stamped for another cohort never reaches this classifier);
    // this membership screen is the second line, kept because the classifier's
    // contract must hold for whatever candidates it is handed.
    expect(run([candidate({ memberCohortIds: ["cohort-hamptons"], materialized: false })])).toEqual(
      []
    );
  });

  it("an UNDETERMINABLE materialization is not a failed leg", () => {
    // null mirrors verifyFwStudentLegs' `leg: null`: the check could not run
    // (no seeded sentinel task, a read blip). Flagging on it would put a
    // fully-created child on the banner over an outage.
    expect(run([candidate({ materialized: null })])).toEqual([]);
  });

  it("an anonymized tombstone is retired, not unfinished", () => {
    // Same exclusion as the roster read: a "Removed student" must never grow a
    // Finish setup button that would re-complete a record staff just retired.
    expect(
      run([candidate({ firstName: "Removed", lastName: "student", memberCohortIds: [] })])
    ).toEqual([]);
  });

  it("renders name-first, in a stable order, like the roster below the banner", () => {
    const out = run([
      candidate({ profileId: "p-z", firstName: "Zoe", lastName: "Ade", memberCohortIds: [] }),
      candidate({ profileId: "p-a", firstName: "Ana", lastName: "Ives", memberCohortIds: [] }),
    ]);
    expect(out.map((u) => u.profileId)).toEqual(["p-a", "p-z"]);
  });

  it("no candidates → no banner", () => {
    // The steady state of every healthy roster render — pinned so a refactor
    // that fabricates a row from nothing cannot pass.
    expect(run([])).toEqual([]);
  });

  it("one MIXED call filters and orders together — flagged rows out, in roster order", () => {
    // The arms above are each pinned in isolation; this is the one call shape
    // the roster page actually makes — a mixed candidate list — asserting that
    // filtering and ordering compose rather than merely each working alone.
    const out = run([
      candidate(), // fully created — out
      candidate({
        profileId: "p-z",
        firstName: "Zoe",
        lastName: "Ade",
        memberCohortIds: [],
        materialized: null,
      }), // membership leg failed — in
      candidate({
        profileId: "p-i",
        firstName: "Ivo",
        lastName: "Kade",
        noticeAttestedBy: null,
        memberCohortIds: [],
      }), // import-minted — out
      candidate({ profileId: "p-a", firstName: "Ana", lastName: "Ives", materialized: false }), // materialization leg failed — in
    ]);
    expect(out).toEqual([
      { profileId: "p-a", firstName: "Ana", lastName: "Ives", band: "g6_8" },
      { profileId: "p-z", firstName: "Zoe", lastName: "Ade", band: "g6_8" },
    ]);
  });
});
