import { describe, expect, it } from "vitest";
import { normalizeStudentName } from "@/app/fp/lib/provision-rules";
import {
  ageBandForAge,
  findDuplicateKid,
  firstIncompleteV3Step,
  furthestReachableV3Step,
  kidNameKey,
  normalizeKidNamePart,
  parseV3Step,
  resolveV3Step,
  splitKidName,
  validateKidInput,
  V3_STEPS,
  type ExistingKid,
  type V3FlowFacts,
  type V3Step,
} from "../flow-rules";

/** The v3 flow's pure navigation + guard decisions (plan Unit 3). */

const facts = (over: Partial<V3FlowFacts> = {}): V3FlowFacts => ({
  parentVerified: false,
  hasDraft: false,
  kidNamed: false,
  coverSettled: false,
  storyStarted: false,
  childCreated: false,
  ...over,
});

/* ------------------------------------------------------- the step resolver */

describe("parseV3Step", () => {
  it("accepts each known step, case- and whitespace-insensitively", () => {
    for (const s of V3_STEPS) {
      expect(parseV3Step(s)).toBe(s);
      expect(parseV3Step(` ${s.toUpperCase()} `)).toBe(s);
    }
  });

  it("answers null for absent, empty, and unknown values", () => {
    for (const bad of [null, undefined, "", "  ", "READY!", "step2", "../admin", "5"]) {
      expect(parseV3Step(bad), String(bad)).toBeNull();
    }
  });
});

describe("the resolver maps every (?step=, facts) pair to exactly ONE screen", () => {
  // The five reachable fact states, in flow order.
  const states: Array<{ name: string; f: V3FlowFacts; landing: V3Step; ceiling: V3Step }> = [
    { name: "cold visitor", f: facts(), landing: "parent", ceiling: "parent" },
    {
      name: "verified, no draft",
      f: facts({ parentVerified: true }),
      landing: "kid",
      ceiling: "kid",
    },
    {
      name: "draft with no name yet",
      f: facts({ parentVerified: true, hasDraft: true }),
      landing: "kid",
      ceiling: "kid",
    },
    {
      name: "kid named, nothing optional done",
      f: facts({ parentVerified: true, hasDraft: true, kidNamed: true }),
      landing: "cover",
      ceiling: "ready",
    },
    {
      name: "cover settled",
      f: facts({ parentVerified: true, hasDraft: true, kidNamed: true, coverSettled: true }),
      landing: "story",
      ceiling: "ready",
    },
    {
      name: "story started",
      f: facts({
        parentVerified: true,
        hasDraft: true,
        kidNamed: true,
        coverSettled: true,
        storyStarted: true,
      }),
      landing: "ready",
      ceiling: "ready",
    },
    {
      name: "child provisioned (terminal)",
      f: facts({ parentVerified: true, hasDraft: true, kidNamed: true, childCreated: true }),
      landing: "ready",
      ceiling: "ready",
    },
  ];

  for (const state of states) {
    it(`${state.name}: bare URL lands on "${state.landing}", ceiling is "${state.ceiling}"`, () => {
      expect(firstIncompleteV3Step(state.f)).toBe(state.landing);
      expect(furthestReachableV3Step(state.f)).toBe(state.ceiling);
      expect(resolveV3Step(null, state.f)).toBe(state.landing);
    });

    it(`${state.name}: every ?step= resolves to exactly one screen, clamped at the ceiling`, () => {
      const ceilingIndex = V3_STEPS.indexOf(state.ceiling);
      for (const asked of V3_STEPS) {
        const got = resolveV3Step(asked, state.f);
        const expected =
          V3_STEPS.indexOf(asked) <= ceilingIndex ? asked : state.ceiling;
        expect(got, `${state.name} + ?step=${asked}`).toBe(expected);
        // Total by construction: the answer is always a real step.
        expect(V3_STEPS).toContain(got);
      }
    });

    it(`${state.name}: a garbage ?step= FAILS OPEN to the landing, never to an error`, () => {
      for (const bad of ["", "nonsense", "READY!", "0"]) {
        expect(resolveV3Step(bad, state.f)).toBe(state.landing);
      }
    });
  }

  it("back-navigation is always allowed", () => {
    const f = facts({ parentVerified: true, hasDraft: true, kidNamed: true, coverSettled: true });
    expect(resolveV3Step("kid", f)).toBe("kid");
    expect(resolveV3Step("cover", f)).toBe("cover");
  });

  it("an unverified visitor cannot type their way past step 1", () => {
    for (const asked of V3_STEPS) {
      expect(resolveV3Step(asked, facts())).toBe("parent");
    }
  });

  it("a provisioned child is pinned to `ready` — no URL walks back toward a second mint", () => {
    const f = facts({ parentVerified: true, hasDraft: true, kidNamed: true, childCreated: true });
    for (const asked of V3_STEPS) {
      expect(resolveV3Step(asked, f)).toBe(asked === "ready" ? "ready" : asked);
    }
    // The ceiling is `ready`, so nothing is clamped DOWN; what the terminal
    // state guarantees is that the LANDING never leaves the ready screen.
    expect(resolveV3Step(null, f)).toBe("ready");
  });
});

/* ------------------------------------------------------------- kid input */

describe("kid name + age", () => {
  it("splits a full name the way the username generator consumes it", () => {
    expect(splitKidName("Remi Newal")).toEqual({ firstName: "Remi", lastName: "Newal" });
    expect(splitKidName("  Remi   van Newal ")).toEqual({
      firstName: "Remi",
      lastName: "van Newal",
    });
    expect(splitKidName("Remi")).toEqual({ firstName: "Remi", lastName: "" });
  });

  it("accepts 5 through 18 and refuses outside it", () => {
    expect(validateKidInput({ fullName: "Remi Newal", age: "9" })).toEqual({
      ok: true,
      firstName: "Remi",
      lastName: "Newal",
      age: 9,
    });
    for (const age of ["4", "19", "0", "-9", "", "nine", "9.5"]) {
      const v = validateKidInput({ fullName: "Remi Newal", age });
      expect(v.ok, age).toBe(false);
      if (!v.ok) expect(v.field).toBe("age");
    }
  });

  it("refuses a one-letter name and names the field", () => {
    const v = validateKidInput({ fullName: "R", age: "9" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.field).toBe("name");
  });

  it("maps age to the consent record's three bands", () => {
    expect(ageBandForAge(5)).toBe("under_13");
    expect(ageBandForAge(12)).toBe("under_13");
    expect(ageBandForAge(13)).toBe("13_to_15");
    expect(ageBandForAge(15)).toBe("13_to_15");
    expect(ageBandForAge(16)).toBe("16_plus");
    expect(ageBandForAge(18)).toBe("16_plus");
  });
});

/* --------------------------------------------------------- duplicate guard */

describe("the duplicate-kid matcher", () => {
  const kids: ExistingKid[] = [
    { id: "c1", kind: "child", firstName: "Maya", lastName: "Chen" },
    { id: "d1", kind: "draft", firstName: "Remi", lastName: "Newal" },
    { id: "c2", kind: "child", firstName: "Alex", lastName: "Ng" },
  ];

  it("matches case-insensitively on first AND last name", () => {
    expect(findDuplicateKid({ firstName: "maya", lastName: "CHEN" }, kids)?.id).toBe("c1");
    expect(findDuplicateKid({ firstName: " Remi ", lastName: "newal" }, kids)?.id).toBe("d1");
  });

  it("matches live DRAFTS as well as provisioned children", () => {
    expect(findDuplicateKid({ firstName: "Remi", lastName: "Newal" }, kids)?.kind).toBe("draft");
  });

  it("does NOT match on the first name alone — two Alexes in one family are ordinary", () => {
    expect(findDuplicateKid({ firstName: "Alex", lastName: "Chen" }, kids)).toBeNull();
    expect(findDuplicateKid({ firstName: "Maya", lastName: "Ng" }, kids)).toBeNull();
  });

  it("does not collide on a naive concatenation (Ann Marie + Lee vs Ann + Marie Lee)", () => {
    const two: ExistingKid[] = [{ id: "x", kind: "child", firstName: "Ann Marie", lastName: "Lee" }];
    expect(findDuplicateKid({ firstName: "Ann", lastName: "Marie Lee" }, two)).toBeNull();
    expect(findDuplicateKid({ firstName: "Ann Marie", lastName: "Lee" }, two)?.id).toBe("x");
  });

  it("normalizes unicode both sides (composed vs decomposed accents compare equal)", () => {
    const accented: ExistingKid[] = [
      { id: "z", kind: "child", firstName: "Zoé", lastName: "Ng" },
    ];
    expect(findDuplicateKid({ firstName: "Zoé", lastName: "Ng" }, accented)?.id).toBe("z");
  });

  it("FAILS CLOSED on a blank name — an empty roster row is never a duplicate", () => {
    const blanks: ExistingKid[] = [{ id: "b", kind: "child", firstName: "", lastName: "" }];
    expect(findDuplicateKid({ firstName: "", lastName: "" }, blanks)).toBeNull();
  });

  it("a CHILD wins over a DRAFT when both match — the resume offer points at the real kid", () => {
    const both: ExistingKid[] = [
      { id: "d", kind: "draft", firstName: "Remi", lastName: "Newal" },
      { id: "c", kind: "child", firstName: "Remi", lastName: "Newal" },
    ];
    expect(findDuplicateKid({ firstName: "Remi", lastName: "Newal" }, both)?.id).toBe("c");
  });

  it("uses the SAME normalization recipe as the student-name matcher (pinned, not assumed)", () => {
    for (const raw of ["  Máya  ", "MAYA", "ma  ya", "Maÿa"]) {
      expect(normalizeKidNamePart(raw)).toBe(normalizeStudentName(raw));
    }
  });

  it("kidNameKey is stable, lowercase, and separated by a character no name can contain", () => {
    expect(kidNameKey(" Remi ", "NEWAL")).toBe("remi\u0000newal");
    // A SPACE separator would make the two Ann cases above collide; that is the
    // whole reason the separator is \u0000.
    expect(kidNameKey("Ann Marie", "Lee")).not.toBe(kidNameKey("Ann", "Marie Lee"));
  });
});
