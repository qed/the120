import { describe, expect, it } from "vitest";
import { WORKSHOPS, checklist, emptyChild, type Child, type Workshop } from "../data";
import {
  GRADE_BANDS,
  filterWorkshops,
  firstIncompleteStep,
  resolveStep,
  stepForChecklistLabel,
  stepsForGroup,
  workshopMatches,
} from "../wizard-rules";

/** A complete non-Scholars draft — every checklist item satisfied. */
const child = (overrides: Partial<Child> = {}): Child => ({
  ...emptyChild("kid-1"),
  firstName: "Ada",
  lastName: "Lovelace",
  grade: 5,
  birthYear: "2015",
  currentSchool: "Maple Public School",
  groupSlug: "makers",
  academics: [{ subject: "Math", plan: "reach-ahead", goal: "Finish grade 7 math" }],
  interests: "robots, chess, and analytical engines",
  projectPitch: "Build a difference engine out of LEGO and document it.",
  ...overrides,
});

describe("stepsForGroup (group-aware step list, R6)", () => {
  it("Scholars get 6 steps (Workshops between Academics and Project)", () => {
    expect(stepsForGroup("scholars")).toEqual([
      "basics",
      "group",
      "academics",
      "workshops",
      "project",
      "review",
    ]);
  });

  it("every other group — and an unset group — gets 5 steps, no Workshops", () => {
    for (const slug of ["athletes", "founders", "makers", "givers", ""]) {
      const steps = stepsForGroup(slug);
      expect(steps).toHaveLength(5);
      expect(steps).not.toContain("workshops");
    }
  });

  it("re-derives when groupSlug changes (makers → scholars adds Workshops)", () => {
    expect(stepsForGroup("makers")).not.toContain("workshops");
    expect(stepsForGroup("scholars")).toContain("workshops");
  });
});

describe("stepForChecklistLabel (Review deep-links)", () => {
  it("maps every live checklist label to a concrete owning step (never the review fallback)", () => {
    for (const c of [child(), child({ groupSlug: "scholars" })]) {
      for (const item of checklist(c)) {
        expect(stepForChecklistLabel(item.label), item.label).not.toBe("review");
      }
    }
  });

  it("falls through to review for unknown labels", () => {
    expect(stepForChecklistLabel("Something renamed")).toBe("review");
  });
});

describe("firstIncompleteStep (resume, R3)", () => {
  it("an empty child resumes at Basics", () => {
    expect(firstIncompleteStep(emptyChild("kid-1"))).toBe("basics");
  });

  it("a child missing only the pitch resumes at Project & Interests", () => {
    expect(firstIncompleteStep(child({ projectPitch: "" }))).toBe("project");
  });

  it("a complete draft resumes at Review", () => {
    expect(firstIncompleteStep(child())).toBe("review");
  });

  it("a Scholars child missing only a workshop resumes at Workshops", () => {
    expect(firstIncompleteStep(child({ groupSlug: "scholars", workshopIds: [] }))).toBe(
      "workshops"
    );
  });

  it("a child with no group resumes at Group", () => {
    expect(
      firstIncompleteStep(
        child({ groupSlug: "", academics: [], interests: "", projectPitch: "" })
      )
    ).toBe("group");
  });
});

describe("resolveStep (current step invalid after a group switch)", () => {
  it("sitting on Workshops when the group switches to Makers routes to Project & Interests", () => {
    expect(resolveStep("workshops", "makers")).toBe("project");
  });

  it("leaves valid steps untouched", () => {
    expect(resolveStep("workshops", "scholars")).toBe("workshops");
    expect(resolveStep("academics", "makers")).toBe("academics");
    expect(resolveStep("review", "")).toBe("review");
  });
});

describe("workshop filter predicate (Unit 6)", () => {
  const ids = (ws: Workshop[]) => ws.map((w) => w.id).sort();

  it("Competition × 3–5 → exactly the six overlapping workshops", () => {
    expect(ids(filterWorkshops(WORKSHOPS, "Competition", "3-5"))).toEqual(
      [
        "botball-robotics",
        "competitive-chess",
        "history-on-trial",
        "i-said-what-i-said",
        "math-competitor-academy",
        "math-elite-academy",
      ].sort()
    );
  });

  it("Sciences × K–2 → exactly {board-game-masters, think-like-a-scientist}", () => {
    expect(ids(filterWorkshops(WORKSHOPS, "Sciences", "k-2"))).toEqual([
      "board-game-masters",
      "think-like-a-scientist",
    ]);
  });

  it("a K–8+ workshop appears in every band", () => {
    const chess = WORKSHOPS.find((w) => w.id === "competitive-chess")!;
    for (const band of GRADE_BANDS) {
      expect(workshopMatches(chess, "all", band.id), band.id).toBe(true);
    }
  });

  it("a 6–8+ workshop is excluded from K–2 and 3–5 but matches 6–8", () => {
    const w = WORKSHOPS.find((w) => w.id === "become-the-character")!;
    expect(w.grades).toBe("6–8+");
    expect(workshopMatches(w, "all", "k-2")).toBe(false);
    expect(workshopMatches(w, "all", "3-5")).toBe(false);
    expect(workshopMatches(w, "all", "6-8")).toBe(true);
    expect(workshopMatches(w, "all", "all")).toBe(true);
  });

  it("zero-match case (synthetic fixture — no real Track × Grade combination is empty)", () => {
    const synthetic: Workshop[] = [
      {
        id: "synthetic-upper",
        title: "Synthetic Upper",
        advisor: "Nobody",
        track: "Sciences",
        grades: "6–8",
        length: "60 min",
        description: "Fixture.",
      },
    ];
    expect(filterWorkshops(synthetic, "Sciences", "k-2")).toEqual([]);
    expect(filterWorkshops(synthetic, "Competition", "6-8")).toEqual([]);
    // Clearing filters (all × all) restores it.
    expect(filterWorkshops(synthetic, "all", "all")).toHaveLength(1);
  });

  it("no real Track × Grade combination on the live catalog is empty", () => {
    for (const track of ["Sciences", "Humanities", "Competition"] as const) {
      for (const band of GRADE_BANDS) {
        expect(
          filterWorkshops(WORKSHOPS, track, band.id).length,
          `${track} × ${band.id}`
        ).toBeGreaterThan(0);
      }
    }
  });
});
