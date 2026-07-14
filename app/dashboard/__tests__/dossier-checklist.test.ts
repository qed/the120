import { describe, expect, it } from "vitest";
import {
  type Academic,
  type Child,
  academicComplete,
  checklist,
  completeness,
  emptyChild,
  parseAcademics,
  planLabel,
} from "../data";
import { type ChildRow, childToRow, rowToChild } from "../store";

/** A complete non-Scholars child — every checklist item satisfied. */
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

const scholarsChild = (overrides: Partial<Child> = {}): Child =>
  child({ groupSlug: "scholars", workshopIds: ["competitive-chess"], ...overrides });

const labels = (c: Child) => checklist(c).map((i) => i.label);
const item = (c: Child, label: string) => checklist(c).find((i) => i.label === label)!;

describe("checklist (group-aware, R14)", () => {
  it("a complete non-Scholars child is 8/8 items, 100%", () => {
    const c = child();
    expect(checklist(c)).toHaveLength(8);
    expect(checklist(c).every((i) => i.done)).toBe(true);
    expect(completeness(c)).toBe(100);
  });

  it("a complete Scholars child (with a workshop) is 9/9 items, 100%", () => {
    const c = scholarsChild();
    expect(checklist(c)).toHaveLength(9);
    expect(checklist(c).every((i) => i.done)).toBe(true);
    expect(completeness(c)).toBe(100);
  });

  it("orders items: workshops (Scholars only) slots between academics and interests", () => {
    expect(labels(child())).toEqual([
      "Name",
      "Grade",
      "Birth year",
      "Current school",
      "A group",
      "Academics (a subject + plan)",
      "The kid's interests",
      "A project pitch",
    ]);
    expect(labels(scholarsChild())[6]).toBe("A workshop of interest");
  });

  it("an academics entry with subject+plan satisfies the academics item", () => {
    const c = child({ academics: [{ subject: "Reading", plan: "catch-up", goal: "" }] });
    expect(item(c, "Academics (a subject + plan)").done).toBe(true);
  });

  it("a subject without a plan does not count (when legacy subjects are empty)", () => {
    const c = child({ academics: [{ subject: "Math", plan: "", goal: "" }], subjects: [] });
    expect(academicComplete(c.academics[0])).toBe(false);
    expect(item(c, "Academics (a subject + plan)").done).toBe(false);
  });

  it("a legacy row (subjects populated, academics empty) satisfies via fallback", () => {
    const c = child({ academics: [], subjects: ["Math"] });
    expect(item(c, "Academics (a subject + plan)").done).toBe(true);
  });

  it('groupSlug "" leaves the group item undone and adds no workshops item', () => {
    const c = child({ groupSlug: "" });
    expect(item(c, "A group").done).toBe(false);
    expect(labels(c)).not.toContain("A workshop of interest");
    expect(checklist(c)).toHaveLength(8);
  });
});

describe("completeness at the >80% stall-nudge boundary", () => {
  it("Scholars missing only the workshop → 8/9 = 89 (eligible)", () => {
    const c = scholarsChild({ workshopIds: [] });
    expect(completeness(c)).toBe(89);
    expect(completeness(c)).toBeGreaterThan(80);
  });

  it("Scholars missing two items → 7/9 = 78 (not eligible)", () => {
    const c = scholarsChild({ workshopIds: [], projectPitch: "" });
    expect(completeness(c)).toBe(78);
    expect(completeness(c)).toBeLessThan(80);
  });

  it("non-Scholars missing one item → 7/8 = 88 (eligible)", () => {
    const c = child({ projectPitch: "" });
    expect(completeness(c)).toBe(88);
    expect(completeness(c)).toBeGreaterThan(80);
  });
});

describe("store row mapping (group_slug / academics cutover)", () => {
  const row = (overrides: Partial<ChildRow> = {}): ChildRow => ({
    id: "kid-1",
    first_name: "Ada",
    last_name: "Lovelace",
    grade: 5,
    birth_year: "2015",
    current_school: "Maple Public School",
    photo: null,
    group_slug: "scholars",
    academics: [{ subject: "Math", plan: "reach-ahead", goal: "Finish grade 7 math" }],
    subjects: ["Math"],
    test_scores: "",
    workshop_ids: ["competitive-chess"],
    interests: "robots",
    project_pitch: "Build a difference engine.",
    portfolio_links: "",
    status: "draft",
    submitted_at: null,
    ...overrides,
  });

  it("childToRow round-trips `subjects` (state truth — the prefill-clear must persist)", () => {
    const r = childToRow(child({ subjects: ["Math", "Reading"] }), "parent-1");
    expect(r.subjects).toEqual(["Math", "Reading"]);
    expect(childToRow(child(), "parent-1").subjects).toEqual([]);
    expect(r.group_slug).toBe("makers");
    expect(r.academics).toEqual([{ subject: "Math", plan: "reach-ahead", goal: "Finish grade 7 math" }]);
  });

  it("childToRow omits status/submitted_at by default (never collides with the DB's one-way guard)", () => {
    const r = childToRow(child({ status: "submitted", submittedAt: "2026-07-01T00:00:00Z" }), "parent-1");
    expect("status" in r).toBe(false);
    expect("submitted_at" in r).toBe(false);
  });

  it("childToRow includeStatus: true emits status + submitted_at (explicit submit only)", () => {
    const r = childToRow(
      child({ status: "submitted", submittedAt: "2026-07-01T00:00:00Z" }),
      "parent-1",
      { includeStatus: true }
    );
    expect(r.status).toBe("submitted");
    expect(r.submitted_at).toBe("2026-07-01T00:00:00Z");
    const draft = childToRow(child(), "parent-1", { includeStatus: true });
    expect(draft.status).toBe("draft");
    expect(draft.submitted_at).toBeNull();
  });

  it("rowToChild maps group_slug and academics", () => {
    const c = rowToChild(row());
    expect(c.groupSlug).toBe("scholars");
    expect(c.academics).toEqual([{ subject: "Math", plan: "reach-ahead", goal: "Finish grade 7 math" }]);
    expect(c.subjects).toEqual(["Math"]); // legacy still read for fallback display
  });

  it("rowToChild tolerates null/garbage academics (→ [])", () => {
    expect(rowToChild(row({ academics: null })).academics).toEqual([]);
    expect(rowToChild(row({ academics: "garbage" })).academics).toEqual([]);
    expect(rowToChild(row({ academics: 42 })).academics).toEqual([]);
    expect(rowToChild(row({ group_slug: undefined as unknown as string })).groupSlug).toBe("");
  });

  it("a hand-built child round-trips preserving group + academics", () => {
    const original = scholarsChild();
    const back = rowToChild({ ...row(), ...childToRow(original, "parent-1") } as ChildRow);
    expect(back.groupSlug).toBe(original.groupSlug);
    expect(back.academics).toEqual(original.academics);
    expect(back.workshopIds).toEqual(original.workshopIds);
  });
});

describe("parseAcademics (tolerant per-element jsonb parse)", () => {
  it("non-arrays → []", () => {
    expect(parseAcademics(null)).toEqual([]);
    expect(parseAcademics(undefined)).toEqual([]);
    expect(parseAcademics("garbage")).toEqual([]);
    expect(parseAcademics(42)).toEqual([]);
    expect(parseAcademics({ subject: "Math" })).toEqual([]);
  });

  it("[{}] → one fully-empty entry (all fields coerced)", () => {
    expect(parseAcademics([{}])).toEqual([{ subject: "", plan: "", goal: "" }]);
  });

  it("[null] → dropped (typeof null is 'object' but it is not an entry)", () => {
    expect(parseAcademics([null])).toEqual([]);
  });

  it('["x"] → non-object elements dropped', () => {
    expect(parseAcademics(["x"])).toEqual([]);
  });

  it("wrong-typed fields coerce safely: {subject:123, plan:true, goal:null}", () => {
    expect(parseAcademics([{ subject: 123, plan: true, goal: null }])).toEqual([
      { subject: "", plan: "", goal: "" },
    ]);
  });

  it("unknown plan strings clamp to ''", () => {
    expect(parseAcademics([{ subject: "Math", plan: "world-domination", goal: "" }])).toEqual([
      { subject: "Math", plan: "", goal: "" },
    ]);
  });

  it("a valid mix parses: junk dropped, good entries preserved verbatim", () => {
    const good: Academic = { subject: "Math", plan: "reach-ahead", goal: "AMC 8" };
    expect(parseAcademics([null, "x", good, { subject: "Art" }])).toEqual([
      good,
      { subject: "Art", plan: "", goal: "" },
    ]);
  });
});

describe("planLabel", () => {
  it("maps each known plan id to its display label", () => {
    expect(planLabel("catch-up")).toBe("Catch-Up");
    expect(planLabel("reach-ahead")).toBe("Reach Ahead");
    expect(planLabel("get-solid")).toBe("Get Solid");
  });

  it("unknown and empty ids → ''", () => {
    expect(planLabel("world-domination")).toBe("");
    expect(planLabel("")).toBe("");
  });
});
