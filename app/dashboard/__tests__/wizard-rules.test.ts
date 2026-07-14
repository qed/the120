import { describe, expect, it } from "vitest";
import {
  RETIRED_WORKSHOPS,
  WORKSHOPS,
  checklist,
  emptyChild,
  hasLiveWorkshopPick,
  workshopById,
  type Child,
} from "../data";
import {
  DEFAULT_TRACK,
  TRACK_FILTERS,
  WORKSHOP_MAX,
  filterWorkshops,
  firstIncompleteStep,
  resolveStep,
  sanitizeWorkshopSelection,
  stepForChecklistLabel,
  stepsForGroup,
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

describe("workshop track filter (R5–R7)", () => {
  const RETIRED_IDS = [
    "the-peace-table",
    "board-game-masters",
    "food-lab-challenge",
    "passport-mission",
    "toy-inventors",
  ];

  it("defaults to Sciences and offers exactly the three tracks — no 'all'", () => {
    expect(DEFAULT_TRACK).toBe("Sciences");
    expect(TRACK_FILTERS.map((t) => t.id)).toEqual(["Sciences", "Humanities", "Competition"]);
  });

  it("each track returns only its own, non-empty slice of the catalog", () => {
    for (const t of TRACK_FILTERS) {
      const ws = filterWorkshops(WORKSHOPS, t.id);
      expect(ws.length, t.id).toBeGreaterThan(0);
      expect(ws.every((w) => w.track === t.id), t.id).toBe(true);
    }
  });

  it("the three tracks partition the whole catalog (no workshop is orphaned)", () => {
    const total = TRACK_FILTERS.reduce(
      (sum, t) => sum + filterWorkshops(WORKSHOPS, t.id).length,
      0
    );
    expect(total).toBe(WORKSHOPS.length);
  });

  it("the 5 retired K–2 workshops are tombstones: resolvable for display, never selectable", () => {
    expect(RETIRED_WORKSHOPS.map((w) => w.id).sort()).toEqual([...RETIRED_IDS].sort());
    for (const id of RETIRED_IDS) {
      expect(WORKSHOPS.some((w) => w.id === id), id).toBe(false);
      expect(workshopById(id)?.title, id).toBeTruthy();
    }
    expect(workshopById("no-such-workshop")).toBeUndefined();
  });
});

describe("sanitizeWorkshopSelection (R8 cap + retired-id cleanup)", () => {
  it("passes through 1–3 valid ids unchanged", () => {
    const picks = WORKSHOPS.slice(0, 3).map((w) => w.id);
    expect(sanitizeWorkshopSelection(picks)).toEqual(picks);
    expect(sanitizeWorkshopSelection(picks.slice(0, 1))).toEqual(picks.slice(0, 1));
    expect(sanitizeWorkshopSelection([])).toEqual([]);
  });

  it("trims more than WORKSHOP_MAX valid ids to the first 3", () => {
    const picks = WORKSHOPS.slice(0, 5).map((w) => w.id);
    expect(sanitizeWorkshopSelection(picks)).toEqual(picks.slice(0, WORKSHOP_MAX));
  });

  it("drops retired ids before trimming", () => {
    const live = WORKSHOPS.slice(0, 3).map((w) => w.id);
    expect(sanitizeWorkshopSelection(["the-peace-table", ...live])).toEqual(live);
  });

  it("an all-retired selection empties", () => {
    expect(sanitizeWorkshopSelection(["the-peace-table", "toy-inventors"])).toEqual([]);
  });

  it("the checklist re-flags workshops for a RAW retired-only selection (unsanitized store state)", () => {
    // The production path: checklist/completeness read the raw stored ids,
    // not the wizard's sanitized view. A legacy Scholars row whose only picks
    // are retired must NOT count as complete, or the meter reads 100% while
    // the workshops step shows "0 of 3".
    const c = child({ groupSlug: "scholars", workshopIds: ["the-peace-table", "toy-inventors"] });
    const item = checklist(c).find((i) => i.label === "A workshop of interest")!;
    expect(item.done).toBe(false);
  });

  it("hasLiveWorkshopPick: one live id among retired ids satisfies the item", () => {
    const live = WORKSHOPS[0].id;
    expect(hasLiveWorkshopPick(["the-peace-table", live])).toBe(true);
    expect(hasLiveWorkshopPick(["the-peace-table"])).toBe(false);
    expect(hasLiveWorkshopPick([])).toBe(false);
    const c = child({ groupSlug: "scholars", workshopIds: ["the-peace-table", live] });
    expect(checklist(c).find((i) => i.label === "A workshop of interest")!.done).toBe(true);
  });

  it("cap is count-based, not track-based — a cross-track selection survives", () => {
    const picks = TRACK_FILTERS.map((t) => filterWorkshops(WORKSHOPS, t.id)[0].id);
    expect(sanitizeWorkshopSelection(picks)).toEqual(picks);
  });
});
