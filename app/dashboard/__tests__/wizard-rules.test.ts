import { describe, expect, it } from "vitest";
import {
  RETIRED_WORKSHOPS,
  WORKSHOPS,
  checklist,
  emptyChild,
  workshopById,
  type Child,
} from "../data";
import {
  birthYearForGrade,
  childEmailPatch,
  firstIncompleteStep,
  prefillDraft,
  resolveStep,
  stepForChecklistLabel,
  stepsForGroup,
  wizardProgressStep,
  type WizardStepId,
} from "../wizard-rules";
import { progressPercent } from "@/app/lib/funnel/capture-rules";

/** A complete draft — every checklist item satisfied. */
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

describe("stepsForGroup (ONE list since the Workshops removal, U12/R46)", () => {
  it("every group — Scholars included — gets the same 5 steps, no Workshops", () => {
    for (const slug of ["athletes", "founders", "makers", "givers", "scholars", ""]) {
      expect(stepsForGroup(slug)).toEqual(["basics", "group", "academics", "project", "review"]);
    }
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

  it("falls through to review for unknown labels — including the retired workshops label", () => {
    expect(stepForChecklistLabel("Something renamed")).toBe("review");
    expect(stepForChecklistLabel("A workshop of interest")).toBe("review");
  });
});

describe("firstIncompleteStep (resume, R3)", () => {
  it("an empty child resumes at Basics", () => {
    expect(firstIncompleteStep(emptyChild("kid-1"))).toBe("basics");
  });

  it("a child missing only the pitch resumes at Project & Interests", () => {
    expect(firstIncompleteStep(child({ projectPitch: "" }))).toBe("project");
  });

  it("a complete draft resumes at Review — a Scholars draft too, with NO workshop pick", () => {
    expect(firstIncompleteStep(child())).toBe("review");
    expect(firstIncompleteStep(child({ groupSlug: "scholars", workshopIds: [] }))).toBe("review");
  });

  it("a child with no group resumes at Group", () => {
    expect(
      firstIncompleteStep(
        child({ groupSlug: "", academics: [], interests: "", projectPitch: "" })
      )
    ).toBe("group");
  });
});

describe("resolveStep (stale stored step ids)", () => {
  it("a pre-U12 'workshops' step id routes to its successor, Project & Interests — for every group", () => {
    for (const slug of ["makers", "scholars", ""]) {
      expect(resolveStep("workshops", slug)).toBe("project");
    }
  });

  it("leaves valid steps untouched and routes garbage to project", () => {
    expect(resolveStep("academics", "makers")).toBe("academics");
    expect(resolveStep("review", "")).toBe("review");
    expect(resolveStep("nonsense", "makers")).toBe("project");
  });
});

describe("the workshop catalog stays for read-only legacy display", () => {
  it("workshopById resolves live and retired ids; unknown ids are undefined", () => {
    expect(workshopById(WORKSHOPS[0].id)?.title).toBeTruthy();
    expect(workshopById(RETIRED_WORKSHOPS[0].id)?.title).toBeTruthy();
    expect(workshopById("no-such-workshop")).toBeUndefined();
  });
});

describe("birthYearForGrade (R47 — as intended, not as literally worded)", () => {
  it("birth year DECREASES with grade: a grade-6 child aged 11 was born 2015", () => {
    // R47's literal "2026 − 11 + grade" INCREASES with grade and reaches
    // the future (grade 12 → 2027) — both U12 reviewers executed it. The
    // implemented formula is the requirement's own worked example.
    expect(birthYearForGrade(3)).toBe("2018");
    expect(birthYearForGrade(5)).toBe("2016");
    expect(birthYearForGrade(6)).toBe("2015");
    expect(birthYearForGrade(11)).toBe("2010");
    expect(birthYearForGrade(12)).toBe("2009");
  });

  it("never yields a future or implausible year for any offered grade", () => {
    for (let g = 3; g <= 12; g++) {
      const y = Number(birthYearForGrade(g));
      expect(y, String(g)).toBeLessThanOrEqual(2018);
      expect(y, String(g)).toBeGreaterThanOrEqual(2009);
    }
  });

  it("an unset or garbage grade yields no prefill", () => {
    expect(birthYearForGrade("")).toBe("");
    expect(birthYearForGrade(4.5 as number)).toBe("");
  });
});

describe("prefillDraft (R46/R47 — the funnel's work arrives pre-done)", () => {
  const project = { name: "The Skills Clinic", description: "Paid mini-clinics for younger kids." };

  it("fills an empty birth year from the grade and an empty pitch from the funnel project", () => {
    const c = prefillDraft(child({ birthYear: "", projectPitch: "" }), project);
    expect(c.birthYear).toBe("2016");
    expect(c.projectPitch).toBe("The Skills Clinic: Paid mini-clinics for younger kids.");
  });

  it("a PARTIAL projects row prefills nothing — ':' is not a pitch (reviewer, by execution)", () => {
    for (const partial of [
      { name: "", description: "" },
      { name: "Dog Walking", description: "" },
      { name: "", description: "Walks dogs." },
    ]) {
      expect(prefillDraft(child({ projectPitch: "" }), partial).projectPitch).toBe("");
    }
  });

  it("NEVER overwrites what a family already typed", () => {
    const typed = child({ birthYear: "2014", projectPitch: "My own words." });
    expect(prefillDraft(typed, project)).toBe(typed);
  });

  it("a direct applicant (no funnel project) gets no pitch prefill — Group and Project arrive NOT done", () => {
    const direct = prefillDraft(
      child({ groupSlug: "", birthYear: "", projectPitch: "", grade: "" }),
      null
    );
    expect(direct.projectPitch).toBe("");
    expect(direct.birthYear).toBe("");
    expect(checklist(direct).find((i) => i.label === "A group")!.done).toBe(false);
    expect(checklist(direct).find((i) => i.label === "A project pitch")!.done).toBe(false);
  });

  it("a funnel child arrives with Group and Project marked done (the plan's integration scenario)", () => {
    const funnelChild = prefillDraft(
      child({ groupSlug: "athletes", projectPitch: "", birthYear: "" }),
      project
    );
    expect(checklist(funnelChild).find((i) => i.label === "A group")!.done).toBe(true);
    expect(checklist(funnelChild).find((i) => i.label === "A project pitch")!.done).toBe(true);
  });
});

describe("childEmailPatch (R48)", () => {
  const none = { childEmail: "", childEmailNone: false };

  it("'Don't have one' records the FLAG without an address", () => {
    expect(childEmailPatch({ none: true }, { childEmail: "kid@x.com", childEmailNone: false }))
      .toEqual({ childEmail: "", childEmailNone: true });
  });

  it("typing an address clears the flag; clearing the address keeps it unset", () => {
    expect(childEmailPatch({ email: "kid@x.com" }, { childEmail: "", childEmailNone: true }))
      .toEqual({ childEmail: "kid@x.com", childEmailNone: false });
    expect(childEmailPatch({ email: "" }, none)).toEqual(none);
  });

  it("a whitespace-only address stores EMPTY and keeps the flag — the pair stays mutually exclusive", () => {
    expect(childEmailPatch({ email: "   " }, { childEmail: "", childEmailNone: true }))
      .toEqual({ childEmail: "", childEmailNone: true });
  });

  it("unticking the flag restores nothing but the ability to type", () => {
    expect(childEmailPatch({ none: false }, { childEmail: "", childEmailNone: true }))
      .toEqual({ childEmail: "", childEmailNone: false });
  });
});

/* ---------- nav card progress (U10 fidelity, X1/X2) ---------- */

describe("wizardProgressStep — the 80/90/96/100 rungs, finally consumed", () => {
  it("maps the five live steps onto the spec's three wizard rungs, monotone", () => {
    const expected: Record<WizardStepId, number> = {
      basics: 80,
      group: 80,
      academics: 90,
      project: 90,
      review: 96,
    };
    for (const [step, pct] of Object.entries(expected)) {
      expect(
        progressPercent(wizardProgressStep(step as WizardStepId, false)),
        step
      ).toBe(pct);
    }
    // Monotone through a straight walk of the live step order.
    const walk = stepsForGroup("makers").map((s) =>
      progressPercent(wizardProgressStep(s, false))
    );
    expect([...walk].sort((a, b) => a - b)).toEqual(walk);
  });

  it("submitted always reads 100, whatever step is showing", () => {
    for (const s of stepsForGroup("makers")) {
      expect(wizardProgressStep(s, true)).toBe("submitted");
    }
    expect(progressPercent(wizardProgressStep("review", true))).toBe(100);
  });
});
