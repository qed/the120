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
import { type ChildRow, childToRow, rowToChild, submitStatusPatch } from "../store";
import { dossierChecklist, dossierCompleteness as crmCompleteness } from "@/app/crm/lib/reviews-rules";
import { dossierCompleteness as nurtureCompleteness } from "@/app/lib/nurture/rules";

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

describe("checklist (EIGHT items for every group since the Workshops removal, U12/R46)", () => {
  it("a complete non-Scholars child is 8/8 items, 100%", () => {
    const c = child();
    expect(checklist(c)).toHaveLength(8);
    expect(checklist(c).every((i) => i.done)).toBe(true);
    expect(completeness(c)).toBe(100);
  });

  it("a Scholars child reaches 100% WITHOUT any workshop pick — the plan's named trap, closed", () => {
    // Pre-U12: 9 items, stranded at 8/9 = 89 with canSubmit requiring 100.
    const c = scholarsChild({ workshopIds: [] });
    expect(checklist(c)).toHaveLength(8);
    expect(completeness(c)).toBe(100);
  });

  it("every group reaches 100% on the same 8 labels — characterized across the whole set", () => {
    for (const slug of ["athletes", "founders", "givers", "makers", "scholars"]) {
      const c = child({ groupSlug: slug });
      expect(labels(c), slug).toEqual([
        "Name",
        "Grade",
        "Birth year",
        "Current school",
        "A group",
        "Academics (a subject + plan)",
        "The kid's interests",
        "A project pitch",
      ]);
      expect(completeness(c), slug).toBe(100);
    }
  });

  it("a LEGACY Scholars row with stored workshop_ids (raw shape) still computes 8 items — picks ignored, not crashed on", () => {
    const c = scholarsChild({ workshopIds: ["the-peace-table", "competitive-chess"] });
    expect(checklist(c)).toHaveLength(8);
    expect(labels(c)).not.toContain("A workshop of interest");
    expect(completeness(c)).toBe(100);
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
  it("any group missing one item → 7/8 = 88 (eligible); missing two → 75 (not eligible)", () => {
    for (const slug of ["makers", "scholars"]) {
      expect(completeness(child({ groupSlug: slug, projectPitch: "" })), slug).toBe(88);
      expect(
        completeness(child({ groupSlug: slug, projectPitch: "", interests: "" })),
        slug
      ).toBe(75);
    }
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
    workshop_ids: ["competitive-chess"],
    interests: "robots",
    project_pitch: "Build a difference engine.",
    portfolio_links: "",
    child_email: null,
    child_email_none: null,
    status: "draft",
    submitted_at: null,
    applicant_state: null,
    arrived_at: null,
    ...overrides,
  });

  it("childToRow round-trips `subjects` (state truth — the prefill-clear must persist)", () => {
    const r = childToRow(child({ subjects: ["Math", "Reading"] }), "parent-1");
    expect(r.subjects).toEqual(["Math", "Reading"]);
    expect(childToRow(child(), "parent-1").subjects).toEqual([]);
    expect(r.group_slug).toBe("makers");
    expect(r.academics).toEqual([{ subject: "Math", plan: "reach-ahead", goal: "Finish grade 7 math" }]);
  });

  it("childToRow NEVER emits status/submitted_at — upserts must not carry them (the guard's INSERT arm poisons EXCLUDED.status to 'draft')", () => {
    const r = childToRow(child({ status: "submitted", submittedAt: "2026-07-01T00:00:00Z" }), "parent-1");
    expect("status" in r).toBe(false);
    expect("submitted_at" in r).toBe(false);
  });

  it("submitStatusPatch always emits 'submitted' (never passes through local state)", () => {
    const p = submitStatusPatch(child({ status: "submitted", submittedAt: "2026-07-01T00:00:00Z" }));
    expect(p.status).toBe("submitted");
    expect(p.submitted_at).toBe("2026-07-01T00:00:00Z");
    expect(typeof p.updated_at).toBe("string");
    // A stale/misused caller can't smuggle another status into the flip,
    // and submitted_at is never null alongside status='submitted'.
    const draft = submitStatusPatch(child());
    expect(draft.status).toBe("submitted");
    expect(typeof draft.submitted_at).toBe("string");
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

  it("a hand-built child round-trips preserving group + academics + the child email pair (R48)", () => {
    const original = scholarsChild({ childEmail: "kid@example.com", childEmailNone: false });
    const back = rowToChild({ ...row(), ...childToRow(original, "parent-1") } as ChildRow);
    expect(back.groupSlug).toBe(original.groupSlug);
    expect(back.academics).toEqual(original.academics);
    expect(back.workshopIds).toEqual(original.workshopIds);
    expect(back.childEmail).toBe("kid@example.com");
    expect(back.childEmailNone).toBe(false);
  });

  it("rowToChild tolerates rows fetched WITHOUT the R48 columns (old select) — empty, not crashed", () => {
    const c = rowToChild(row({ child_email: null, child_email_none: null }));
    expect(c.childEmail).toBe("");
    expect(c.childEmailNone).toBe(false);
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

describe("the three lockstep mirrors agree (R14 — compared directly, no renderer)", () => {
  /** One child, three shapes: the dashboard Child, the CRM DossierFields,
   *  and the nurture raw row. Same facts, three functions, one percentage.
   *  Fixtures include a LEGACY stored workshop pick (raw shape) — ignored
   *  identically by all three since the removal. */
  const cases: { label: string; c: Child }[] = [
    { label: "complete scholars, legacy picks", c: scholarsChild({ workshopIds: ["the-peace-table"] }) },
    { label: "complete makers", c: child() },
    { label: "scholars missing pitch", c: scholarsChild({ projectPitch: "" }) },
    { label: "no group, nothing else", c: child({ groupSlug: "", academics: [], subjects: [], interests: "", projectPitch: "" }) },
    { label: "legacy subjects fallback", c: child({ academics: [], subjects: ["Math"] }) },
  ];

  for (const { label, c } of cases) {
    it(`${label}: parent meter, CRM queue, and stall nudge report the same number`, () => {
      const parentPct = completeness(c);
      const crmItems = dossierChecklist({
        firstName: c.firstName,
        lastName: c.lastName,
        grade: c.grade === "" ? null : c.grade,
        birthYear: c.birthYear,
        currentSchool: c.currentSchool,
        groupSlug: c.groupSlug,
        academics: c.academics,
        subjects: c.subjects,
        workshopIds: c.workshopIds,
        interests: c.interests,
        projectPitch: c.projectPitch,
      });
      const crmPct = crmCompleteness({
        firstName: c.firstName,
        lastName: c.lastName,
        grade: c.grade === "" ? null : c.grade,
        birthYear: c.birthYear,
        currentSchool: c.currentSchool,
        groupSlug: c.groupSlug,
        academics: c.academics,
        subjects: c.subjects,
        workshopIds: c.workshopIds,
        interests: c.interests,
        projectPitch: c.projectPitch,
      });
      const nurturePct = nurtureCompleteness({
        id: "kid-1",
        parent_id: "p1",
        applicant_state: null,
        first_name: c.firstName,
        last_name: c.lastName,
        grade: c.grade === "" ? null : c.grade,
        birth_year: c.birthYear,
        current_school: c.currentSchool,
        group_slug: c.groupSlug,
        academics: c.academics,
        subjects: c.subjects,
        workshop_ids: c.workshopIds,
        interests: c.interests,
        project_pitch: c.projectPitch,
        status: "draft",
        updated_at: "2026-07-28T00:00:00Z",
      });
      expect(crmPct, "crm vs parent").toBe(parentPct);
      expect(nurturePct, "nurture vs parent").toBe(parentPct);
      expect(crmItems.map((i) => i.label)).toEqual(checklist(c).map((i) => i.label));
    });
  }
});

describe("raw-shape parity: the fixtures the plan demanded (not the sanitizer's output)", () => {
  it("an out-of-vocabulary plan string is INCOMPLETE in all three mirrors", () => {
    // Pre-fix, by execution: parent (via parseAcademics' clamp) said 88
    // while CRM and nurture accepted any non-empty plan and said 100.
    const rawAcademics = [{ subject: "Math", plan: "world-domination", goal: "" }];
    const base = child({ subjects: [] });

    const parentPct = completeness(
      rowToChild({
        id: base.id, first_name: base.firstName, last_name: base.lastName,
        grade: 5, birth_year: base.birthYear, current_school: base.currentSchool,
        photo: null, group_slug: base.groupSlug, academics: rawAcademics,
        subjects: [], workshop_ids: [], interests: base.interests,
        project_pitch: base.projectPitch, portfolio_links: "",
        child_email: null, child_email_none: null, status: "draft", submitted_at: null,
        applicant_state: null, arrived_at: null,
      })
    );
    const crmPct = crmCompleteness({
      firstName: base.firstName, lastName: base.lastName, grade: 5,
      birthYear: base.birthYear, currentSchool: base.currentSchool,
      groupSlug: base.groupSlug, academics: rawAcademics, subjects: [],
      workshopIds: [], interests: base.interests, projectPitch: base.projectPitch,
    });
    const nurturePct = nurtureCompleteness({
      id: "kid-1",
      parent_id: "p1", applicant_state: null, first_name: base.firstName, last_name: base.lastName,
      grade: 5, birth_year: base.birthYear, current_school: base.currentSchool,
      group_slug: base.groupSlug, academics: rawAcademics, subjects: [],
      workshop_ids: [], interests: base.interests, project_pitch: base.projectPitch,
      status: "draft", updated_at: "2026-07-28T00:00:00Z",
    });
    expect(parentPct).toBe(88);
    expect(crmPct).toBe(88);
    expect(nurturePct).toBe(88);
  });
});
