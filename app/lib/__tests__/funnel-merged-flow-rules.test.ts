import { describe, expect, it } from "vitest";

import {
  FIRST_FORM_STEP,
  MERGED_FORM_STEPS,
  MERGED_NEXT_STEPS,
  formProgress,
  isMergedStep,
  mergedInitialStep,
  mergedLockVerdict,
  mergedNavCard,
  mergedProgressStep,
  resolveMergedStep,
  stepEditableInWalk,
  stepListForChild,
  terminalTreatment,
  type MergedFlowFacts,
  type MergedStep,
  type TerminalTreatment,
} from "@/app/lib/funnel/merged-flow-rules";
import {
  APPLICANT_STATES,
  type ApplicantState,
} from "@/app/lib/funnel/applicant-rules";
import { MINIAPP_STEPS, initialStepForFacts } from "@/app/lib/funnel/miniapp-rules";
import { PROGRESS_STEPS } from "@/app/lib/funnel/capture-rules";
import { nextStepsReachable } from "@/app/lib/funnel/deposit-rules";
import { stepsForGroup, wizardProgressStep } from "@/app/dashboard/wizard-rules";
import type { SeatStatus } from "@/app/dashboard/data";

/**
 * Unit 4's decision surface (R5, R6, R8, R9a, R11): the merged step union,
 * the rung mapper, the per-cohort list, the bucket-table landing + clamp,
 * the dual-vocabulary lock union, the form-progress predicate, and the
 * endings map — each swept exhaustively over both vocabularies, because the
 * legacy cohort is the least-tested one (the plan's named risk).
 */

/** Every value `children.status` can hold — mirrors the SeatStatus union. */
const SEAT_STATUSES: readonly SeatStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "invited",
  "offered",
  "member",
  "waitlisted",
];

const ALL_STEPS: readonly MergedStep[] = [
  ...MINIAPP_STEPS,
  "seam",
  ...MERGED_FORM_STEPS,
  ...MERGED_NEXT_STEPS,
];

/** A baseline facts row; every scenario states only what differs. */
const facts = (over: Partial<MergedFlowFacts> = {}): MergedFlowFacts => ({
  applicantState: null,
  status: "draft",
  doorConfirmed: false,
  hasProject: false,
  nextStepsReachable: false,
  formProgress: false,
  firstIncompleteFormStep: "basics",
  mergeFlagOn: true,
  ...over,
});

/* ─────────────────────────────── the vocabulary ─────────────────────────────── */

describe("the merged step vocabulary", () => {
  it("form steps ARE the wizard's list, in order — exhaustive, not a subset", () => {
    expect([...MERGED_FORM_STEPS]).toEqual(stepsForGroup(""));
    expect(FIRST_FORM_STEP).toBe("basics");
  });

  it("next-steps ids match the deposit-rules swipes", () => {
    expect([...MERGED_NEXT_STEPS]).toEqual(["progress", "goal", "seat"]);
  });

  it("the union has no duplicate ids across its four phases", () => {
    expect(new Set(ALL_STEPS).size).toBe(ALL_STEPS.length);
  });

  it("isMergedStep accepts every member and rejects everything else", () => {
    for (const s of ALL_STEPS) expect(isMergedStep(s)).toBe(true);
    for (const bad of ["", "wizard_1", "capture", "SEAM", null, undefined, 3, {}]) {
      expect(isMergedStep(bad)).toBe(false);
    }
  });

  it("does not touch MINIAPP_STEPS (still the seven build steps)", () => {
    expect([...MINIAPP_STEPS]).toEqual([
      "handoff",
      "doors",
      "templates",
      "quiz",
      "compose",
      "tasks",
      "reveal",
    ]);
  });
});

/* ─────────────────────────────── step → rung ─────────────────────────────── */

describe("mergedProgressStep", () => {
  const rungIds = PROGRESS_STEPS.map((s) => s.id) as readonly string[];

  it("every MergedStep returns a valid ProgressStep or the documented past-ladder null", () => {
    for (const step of ALL_STEPS) {
      for (const submitted of [false, true]) {
        const rung = mergedProgressStep(step, submitted);
        if (rung === null) {
          // Only the next-steps screens sit past the ladder.
          expect(MERGED_NEXT_STEPS).toContain(step);
        } else {
          expect(rungIds).toContain(rung);
        }
      }
    }
  });

  it("build steps map to themselves (the satisfies coupling, consumed)", () => {
    for (const step of MINIAPP_STEPS) {
      expect(mergedProgressStep(step, false)).toBe(step);
      // A submitted read-only re-walk still narrates position, not status.
      expect(mergedProgressStep(step, true)).toBe(step);
    }
  });

  it("the seam shows reveal's rung", () => {
    expect(mergedProgressStep("seam", false)).toBe("reveal");
    expect(mergedProgressStep("seam", true)).toBe("reveal");
  });

  it("form steps DELEGATE to wizardProgressStep — pinned by the literal rung table", () => {
    // The delegation (one switch, one owner) plus the literal expectations,
    // so a drifted wizardProgressStep cannot silently drag this along.
    const table: Record<(typeof MERGED_FORM_STEPS)[number], string> = {
      basics: "wizard_1",
      group: "wizard_1",
      academics: "wizard_2",
      project: "wizard_2",
      review: "wizard_3",
    };
    for (const step of MERGED_FORM_STEPS) {
      expect(mergedProgressStep(step, false)).toBe(table[step]);
      expect(mergedProgressStep(step, false)).toBe(wizardProgressStep(step, false));
      expect(mergedProgressStep(step, true)).toBe("submitted");
      expect(mergedProgressStep(step, true)).toBe(wizardProgressStep(step, true));
    }
  });

  it("next-steps screens return null in every mode", () => {
    for (const step of MERGED_NEXT_STEPS) {
      expect(mergedProgressStep(step, false)).toBeNull();
      expect(mergedProgressStep(step, true)).toBeNull();
    }
  });
});

describe("mergedNavCard", () => {
  it("build steps carry the bar-only card; form steps the identity treatment", () => {
    expect(mergedNavCard("doors", "JANE DOE", false).kind).toBe("progress");
    expect(mergedNavCard("seam", "JANE DOE", false).kind).toBe("progress");
    for (const step of MERGED_FORM_STEPS) {
      expect(mergedNavCard(step, "JANE DOE", false).kind).toBe("progress_identity");
    }
  });

  it("next-steps take the post-ladder identity-only card", () => {
    for (const step of MERGED_NEXT_STEPS) {
      expect(mergedNavCard(step, "JANE DOE", false)).toEqual({
        kind: "identity",
        identity: "JANE DOE",
      });
    }
  });

  it("a submitted form step reads 100", () => {
    const card = mergedNavCard("review", "JANE DOE", true);
    expect(card).toMatchObject({ kind: "progress_identity", percent: 100 });
  });
});

/* ─────────────────────────────── per-cohort lists ─────────────────────────────── */

describe("stepListForChild", () => {
  it("dark flag: the list IS today's MINIAPP_STEPS, for every cohort", () => {
    expect(stepListForChild(facts({ mergeFlagOn: false }))).toBe(MINIAPP_STEPS);
    expect(
      stepListForChild(
        facts({ mergeFlagOn: false, applicantState: "offered", nextStepsReachable: true })
      )
    ).toBe(MINIAPP_STEPS);
  });

  it("funnel child, gate closed: build + seam + form (group SKIPPED, 2026-07-30), no next-steps", () => {
    expect(stepListForChild(facts({ applicantState: "project_created" }))).toEqual([
      ...MINIAPP_STEPS,
      "seam",
      ...MERGED_FORM_STEPS.filter((s) => s !== "group"),
    ]);
  });

  it("funnel child, gate open: next-steps append after review (group still skipped)", () => {
    expect(
      stepListForChild(facts({ applicantState: "offered", nextStepsReachable: true }))
    ).toEqual([
      ...MINIAPP_STEPS,
      "seam",
      ...MERGED_FORM_STEPS.filter((s) => s !== "group"),
      ...MERGED_NEXT_STEPS,
    ]);
  });

  it("legacy child: form steps only — build steps simply absent, not greyed", () => {
    expect(stepListForChild(facts({ status: "submitted" }))).toEqual([
      ...MERGED_FORM_STEPS,
    ]);
  });

  it("legacy offered child: form + next-steps (gate spans both vocabularies)", () => {
    expect(
      stepListForChild(facts({ status: "offered", nextStepsReachable: true }))
    ).toEqual([...MERGED_FORM_STEPS, ...MERGED_NEXT_STEPS]);
  });
});

/* ─────────────────────────────── the landing matrix (R5) ─────────────────────────────── */

describe("mergedInitialStep — the bucket table, one row per bucket", () => {
  const rows: {
    name: string;
    over: Partial<MergedFlowFacts>;
    lands: MergedStep;
  }[] = [
    {
      name: "pre-application, no door → handoff (furthest provable build step)",
      over: { applicantState: "added" },
      lands: "handoff",
    },
    {
      // 2026-07-30: resume lands one step BACK (the last completed screen).
      name: "pre-application, door confirmed → doors (last completed, one back from templates)",
      over: { applicantState: "added", doorConfirmed: true },
      lands: "doors",
    },
    {
      name: "pre-application, project row → quiz (last completed, one back from compose)",
      over: { applicantState: "added", doorConfirmed: true, hasProject: true },
      lands: "quiz",
    },
    {
      // Item 44 (2026-07-30): project_created resumes on the COMPANY PAGE
      // the build produced, and walks forward from there.
      name: "project_created, NO form progress → compose (the company page)",
      over: { applicantState: "project_created", hasProject: true, doorConfirmed: true },
      lands: "compose",
    },
    {
      name: "mid-form (project_created + progress) → compose too (item 44: the company page first)",
      over: {
        applicantState: "project_created",
        hasProject: true,
        formProgress: true,
        firstIncompleteFormStep: "academics",
      },
      lands: "compose",
    },
    {
      name: "offered → FIRST form step, even mid-form (R3: review from the top)",
      over: {
        applicantState: "offered",
        nextStepsReachable: true,
        formProgress: true,
        firstIncompleteFormStep: "project",
      },
      lands: "basics",
    },
    {
      name: "submitted → first form step (read-only walk)",
      over: { applicantState: "submitted" },
      lands: "basics",
    },
    {
      name: "in_review → first form step",
      over: { applicantState: "in_review" },
      lands: "basics",
    },
    {
      name: "waitlisted → first form step",
      over: { applicantState: "waitlisted" },
      lands: "basics",
    },
    {
      name: "deposited → first form step",
      over: { applicantState: "deposited", nextStepsReachable: true },
      lands: "basics",
    },
    {
      name: "enrolled → first form step",
      over: { applicantState: "enrolled", nextStepsReachable: true },
      lands: "basics",
    },
    {
      name: "legacy draft → last completed form step (one back from firstIncompleteStep)",
      over: { status: "draft", firstIncompleteFormStep: "group" },
      lands: "basics",
    },
    {
      name: "legacy locked (submitted) → first form step",
      over: { status: "submitted", firstIncompleteFormStep: "group" },
      lands: "basics",
    },
    {
      name: "legacy invited → first form step",
      over: { status: "invited" },
      lands: "basics",
    },
    {
      name: "legacy member → first form step",
      over: { status: "member", nextStepsReachable: true },
      lands: "basics",
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      expect(mergedInitialStep(facts(row.over))).toBe(row.lands);
    });
  }

  it("unresolvable state fails open to the first form step — NEVER handoff", () => {
    const mangled = facts({
      applicantState: "mystery" as unknown as ApplicantState,
    });
    expect(mergedInitialStep(mangled)).toBe(FIRST_FORM_STEP);
    expect(mergedInitialStep(mangled)).not.toBe("handoff");
  });

  it("dark flag: landing defers to the existing mini-app behaviour", () => {
    for (const doorConfirmed of [false, true]) {
      for (const hasProject of [false, true]) {
        const f = facts({
          mergeFlagOn: false,
          applicantState: "added",
          doorConfirmed,
          hasProject,
        });
        expect(mergedInitialStep(f)).toBe(
          initialStepForFacts({ doorConfirmed, hasProject })
        );
      }
    }
  });
});

/* ─────────────────────────────── the clamp (C2) ─────────────────────────────── */

describe("resolveMergedStep — a step outside the child's list resolves as if absent", () => {
  it("no param → the landing", () => {
    expect(resolveMergedStep(null, facts({ applicantState: "added" }))).toBe("handoff");
  });

  it("a valid in-list step resolves to itself", () => {
    const f = facts({ applicantState: "project_created" });
    expect(resolveMergedStep("quiz", f)).toBe("quiz");
    expect(resolveMergedStep("seam", f)).toBe("seam");
    const offered = facts({ applicantState: "offered", nextStepsReachable: true });
    expect(resolveMergedStep("goal", offered)).toBe("goal");
  });

  it("?step=goal for a submitted child (locked) resolves to review — the explaining terminal, not bare basics", () => {
    expect(resolveMergedStep("goal", facts({ applicantState: "submitted" }))).toBe(
      "review"
    );
  });

  it("?step=seat for a waitlisted child resolves to review (the waitlist arm explains)", () => {
    expect(resolveMergedStep("seat", facts({ applicantState: "waitlisted" }))).toBe(
      "review"
    );
    // Legacy vocabulary too: a null-state waitlisted child is equally locked.
    expect(resolveMergedStep("seat", facts({ status: "waitlisted" }))).toBe("review");
  });

  it("a next-step id on an UNLOCKED child keeps the plain clamp (no review shortcut)", () => {
    // A legacy draft is not locked — the demotion arm must not fire. (The
    // re-landing is the one-back resume: basics, one back from group.)
    expect(
      resolveMergedStep("goal", facts({ status: "draft", firstIncompleteFormStep: "group" }))
    ).toBe("basics");
    // A pre-application funnel child is not locked either.
    expect(resolveMergedStep("seat", facts({ applicantState: "added" }))).toBe("handoff");
  });

  it("?step=doors for a legacy child clamps (build steps absent from the list)", () => {
    expect(
      resolveMergedStep("doors", facts({ status: "draft", firstIncompleteFormStep: "group" }))
    ).toBe("basics");
  });

  it("demotion refresh: standing on goal, gate revoked mid-walk → lands on review, the arm that explains", () => {
    // Yesterday: offered, on "goal". Today: staff moved them back to
    // in_review — the refresh resolves the SAME URL against the new facts,
    // and a LOCKED child holding a next-step URL lands on the review
    // terminal (under-review/waitlist copy), never bare basics.
    const demoted = facts({ applicantState: "in_review", nextStepsReachable: false });
    expect(resolveMergedStep("goal", demoted)).toBe("review");
  });

  it("garbage steps clamp too — never a throw, never handoff for legacy, never the review shortcut", () => {
    expect(resolveMergedStep("wizard_1", facts({ status: "submitted" }))).toBe("basics");
    expect(resolveMergedStep("", facts({ applicantState: "added" }))).toBe("handoff");
  });

  it("dark flag: form steps are not reachable — clamps to today's landing (demotion arm stays dark too)", () => {
    const dark = facts({ mergeFlagOn: false, applicantState: "added" });
    expect(resolveMergedStep("basics", dark)).toBe("handoff");
    expect(resolveMergedStep("doors", dark)).toBe("doors");
    // A next-step id under the dark flag must never resolve to "review" —
    // the dark shell has no arm for it.
    const darkLocked = facts({ mergeFlagOn: false, applicantState: "submitted" });
    expect(resolveMergedStep("goal", darkLocked)).toBe(
      initialStepForFacts({ doorConfirmed: false, hasProject: false })
    );
  });
});

/* ─────────────────────────────── form progress ─────────────────────────────── */

describe("formProgress — keys only on fields no automated path writes", () => {
  const empty = {
    lastName: "",
    currentSchool: "",
    academics: [] as unknown[],
    interests: "",
    portfolioLinks: "",
    childEmail: "",
    childEmailNone: false,
  };

  it("a prefill-seeded row (birth_year + project_pitch + capture/doors seeds) has NO progress", () => {
    // The seeded fields — first_name, grade, group_slug, birth_year,
    // project_pitch — are not even inputs to the predicate: a row where
    // ONLY seeders have written reads as untouched.
    expect(formProgress(empty)).toBe(false);
  });

  it("each family-typed residue field alone counts as progress", () => {
    expect(formProgress({ ...empty, lastName: "Kestrel" })).toBe(true);
    expect(formProgress({ ...empty, currentSchool: "Maple PS" })).toBe(true);
    expect(formProgress({ ...empty, academics: [{ subject: "math", plan: "advance" }] })).toBe(true);
    expect(formProgress({ ...empty, interests: "robots" })).toBe(true);
    expect(formProgress({ ...empty, portfolioLinks: "https://example.com" })).toBe(true);
    expect(formProgress({ ...empty, childEmail: "kid@example.com" })).toBe(true);
    // "Don't have one" is a deliberate answer (R48) — it counts.
    expect(formProgress({ ...empty, childEmailNone: true })).toBe(true);
  });

  it("whitespace is not progress", () => {
    expect(
      formProgress({ ...empty, lastName: "  ", currentSchool: "\t", interests: " " })
    ).toBe(false);
  });
});

/* ─────────────────────────────── the lock union (R8) ─────────────────────────────── */

describe("mergedLockVerdict — the dual-vocabulary union", () => {
  it("legacy: null state locks on ANY non-draft status", () => {
    for (const status of SEAT_STATUSES) {
      expect(mergedLockVerdict({ applicantState: null, status })).toBe(
        status !== "draft"
      );
    }
  });

  it("funnel: the ladder's edit horizon decides, whatever the status column says", () => {
    const expectLocked: Record<ApplicantState, boolean> = {
      added: false,
      project_created: false,
      submitted: true,
      in_review: true,
      offered: true,
      waitlisted: true,
      deposited: true,
      enrolled: true,
    };
    for (const state of APPLICANT_STATES) {
      // Funnel children sit at status "draft" until C2 — but the verdict
      // must hold for every status pairing (the overlap trap).
      for (const status of SEAT_STATUSES) {
        expect(mergedLockVerdict({ applicantState: state, status })).toBe(
          expectLocked[state]
        );
      }
    }
  });
});

describe("stepEditableInWalk", () => {
  it("an unlocked walk is fully editable", () => {
    for (const step of ALL_STEPS) {
      expect(stepEditableInWalk(step, false, false)).toBe(true);
    }
  });

  it("a locked walk is read-only except group (pre-deposit) and goal", () => {
    for (const step of ALL_STEPS) {
      const expected = step === "group" || step === "goal";
      expect(stepEditableInWalk(step, true, false)).toBe(expected);
    }
  });

  it("group editable at submitted + no deposit in BOTH vocabularies", () => {
    const funnelSubmitted = mergedLockVerdict({
      applicantState: "submitted",
      status: "draft",
    });
    const legacySubmitted = mergedLockVerdict({
      applicantState: null,
      status: "submitted",
    });
    expect(funnelSubmitted).toBe(true);
    expect(legacySubmitted).toBe(true);
    expect(stepEditableInWalk("group", funnelSubmitted, false)).toBe(true);
    expect(stepEditableInWalk("group", legacySubmitted, false)).toBe(true);
  });

  it("group locks once a deposit is paid", () => {
    expect(stepEditableInWalk("group", true, true)).toBe(false);
  });

  it("an UNKNOWN deposit fact (null — the read failed) fails closed on a locked walk", () => {
    // The group exception needs a PROVEN false: null must never render an
    // editable group step whose save writeGroup would then refuse.
    expect(stepEditableInWalk("group", true, null)).toBe(false);
    for (const step of ALL_STEPS) {
      if (step === "goal" || step === "group") continue;
      expect(stepEditableInWalk(step, true, null)).toBe(false);
    }
    // Goal's write exception is deposit-independent — null included.
    expect(stepEditableInWalk("goal", true, null)).toBe(true);
  });

  it("a pre-submit (unlocked) walk is unaffected by an unknown deposit fact", () => {
    for (const step of ALL_STEPS) {
      expect(stepEditableInWalk(step, false, null)).toBe(true);
    }
  });

  it("goal stays writable for every next-steps-reachable state, deposit or not (M1)", () => {
    for (const state of ["offered", "deposited", "enrolled"] as const) {
      const locked = mergedLockVerdict({ applicantState: state, status: "draft" });
      expect(locked).toBe(true);
      expect(stepEditableInWalk("goal", locked, false)).toBe(true);
      expect(stepEditableInWalk("goal", locked, true)).toBe(true);
    }
  });
});

/* ─────────────────────────────── the endings map (R9/R9a, I1) ─────────────────────────────── */

describe("terminalTreatment", () => {
  const TREATMENTS: readonly TerminalTreatment[] = [
    "submit",
    "finish_build",
    "under_review",
    "waitlisted",
    "next_steps",
  ];

  it("is total over ApplicantState ∪ SeatStatus — every pairing maps to a defined treatment", () => {
    for (const state of [...APPLICANT_STATES, null] as const) {
      for (const status of SEAT_STATUSES) {
        const t = terminalTreatment({
          applicantState: state,
          status,
          // The REAL predicate, verbatim (R11) — never a re-implementation.
          nextStepsReachable: nextStepsReachable({ applicantState: state, status }),
        });
        expect(TREATMENTS).toContain(t);
      }
    }
  });

  const row = (
    applicantState: ApplicantState | null,
    status: SeatStatus
  ): TerminalTreatment =>
    terminalTreatment({
      applicantState,
      status,
      nextStepsReachable: nextStepsReachable({ applicantState, status }),
    });

  it("added → finish_build: no legal submit edge, whatever the project row says (C1)", () => {
    expect(row("added", "draft")).toBe("finish_build");
  });

  it("project_created → submit (review-which-submits, R9)", () => {
    expect(row("project_created", "draft")).toBe("submit");
  });

  it("funnel submitted/in_review → under_review; waitlisted → waitlisted", () => {
    expect(row("submitted", "draft")).toBe("under_review");
    expect(row("in_review", "draft")).toBe("under_review");
    expect(row("waitlisted", "draft")).toBe("waitlisted");
  });

  it("next-steps-reachable states end at next_steps, both vocabularies", () => {
    expect(row("offered", "draft")).toBe("next_steps");
    expect(row("deposited", "draft")).toBe("next_steps");
    expect(row("enrolled", "draft")).toBe("next_steps");
    expect(row(null, "offered")).toBe("next_steps");
    expect(row(null, "member")).toBe("next_steps");
  });

  it("legacy statuses map through the SeatStatus vocabulary", () => {
    expect(row(null, "draft")).toBe("submit");
    expect(row(null, "submitted")).toBe("under_review");
    expect(row(null, "in_review")).toBe("under_review");
    expect(row(null, "invited")).toBe("under_review");
    expect(row(null, "waitlisted")).toBe("waitlisted");
  });

  it("a widened string degrades to the no-controls terminal, never a submit", () => {
    expect(
      terminalTreatment({
        applicantState: "mystery" as unknown as ApplicantState,
        status: "draft",
        nextStepsReachable: false,
      })
    ).toBe("under_review");
  });
});
