import { describe, expect, it } from "vitest";
import {
  MANIFEST_2026_27,
  assertMatchesManifest,
  getProgram,
  isStageMoment,
  manifestFor,
  registerProgram,
  registeredVersions,
  STAGE_MOMENT_CRITERIA,
} from "@/app/path/content/manifest";
import PROGRAM from "@/app/path/content/generated/program-2026-27";
import { pathSteps } from "@/app/2026-27/data";
import type { ProgramContent } from "@/app/path/content/types";

describe("manifest validation", () => {
  it("the generated module matches its manifest", () => {
    expect(() => assertMatchesManifest(PROGRAM)).not.toThrow();
  });

  it("names the specific mismatch when a phase is short", () => {
    const short: ProgramContent = {
      ...PROGRAM,
      phases: PROGRAM.phases.slice(0, 4),
    };
    expect(() => assertMatchesManifest(short)).toThrow(/expected 5 phases/);
  });

  it("catches a per-phase drift a total-only check would pass", () => {
    // Move one task from Build to Validate: still 125 tasks overall, but the
    // shape is wrong. This is the case a naive `length === 125` misses.
    const clone: ProgramContent = JSON.parse(JSON.stringify(PROGRAM));
    const moved = clone.phases[1].criteria[0].tasks.pop()!;
    clone.phases[2].criteria[0].tasks.push(moved);
    expect(() => assertMatchesManifest(clone)).toThrow(/per-phase/);
  });

  it("refuses an unknown version rather than guessing", () => {
    expect(() => manifestFor("2099-00")).toThrow(/Unknown program version/);
  });

  it("catches a criterion with no closing task — the 5.5.5 class of bug", () => {
    // Counts alone passed this: the package was the right SIZE while saying
    // the wrong THING.
    const clone: ProgramContent = JSON.parse(JSON.stringify(PROGRAM));
    const lastPhase = clone.phases.at(-1)!;
    const lastCriterion = lastPhase.criteria.at(-1)!;
    lastCriterion.tasks.at(-1)!.completesCriterion = false;
    expect(() => assertMatchesManifest(clone)).toThrow(
      /has 0 tasks marked completesCriterion/
    );
  });

  it("catches two closing tasks in one criterion", () => {
    const clone: ProgramContent = JSON.parse(JSON.stringify(PROGRAM));
    clone.phases[0].criteria[0].tasks[0].completesCriterion = true;
    expect(() => assertMatchesManifest(clone)).toThrow(/has 2 tasks marked/);
  });

  it("catches markdown left inside a Done-when line", () => {
    // That line is what a verifying adult reads and answers yes or no to.
    const clone: ProgramContent = JSON.parse(JSON.stringify(PROGRAM));
    clone.phases[0].criteria[0].tasks[0].doneWhen =
      "the one-liner is written. **This completes the criterion.**";
    expect(() => assertMatchesManifest(clone)).toThrow(/markdown bold markers/);
  });

  it("catches an empty title, body, or Done-when line", () => {
    const clone: ProgramContent = JSON.parse(JSON.stringify(PROGRAM));
    clone.phases[0].criteria[0].tasks[0].title = "";
    expect(() => assertMatchesManifest(clone)).toThrow(
      /empty title, body, or Done-when/
    );
  });
});

describe("getProgram returns an immutable view", () => {
  // Compile-time only — declared, never called, so it can't corrupt the shared
  // singleton that every other test reads. The `@ts-expect-error`s ARE the
  // assertion: if getProgram's return type stopped being DeepReadonly, these
  // lines would compile and `tsc` (part of the verification gate) would fail on
  // the now-unused directives.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _typeGuard() {
    const p = getProgram("2026-27");
    // @ts-expect-error — phases is readonly; no pushing into the shared object.
    p.phases.push(p.phases[0]);
    // @ts-expect-error — a task's fields are readonly too.
    p.phases[0].criteria[0].tasks[0].doneWhen = "corrupted";
  }

  it("still serves intact content (the type guard above never runs)", () => {
    expect(getProgram("2026-27").phases).toHaveLength(5);
  });
});

describe("version registry (D27)", () => {
  it("resolves the generated version", () => {
    expect(registeredVersions()).toContain("2026-27");
    expect(getProgram("2026-27").phases).toHaveLength(5);
  });

  it("throws on an unregistered version — never falls back to latest", () => {
    // A pinned student whose version is missing must fail loudly. Falling back
    // is exactly how a content revision silently rewrites a child's tasks.
    expect(() => getProgram("2027-28")).toThrow(/not registered/);
  });

  it("keeps versions independent once more than one exists", () => {
    const fake: ProgramContent = { versionId: "test-only", phases: [] };
    registerProgram(fake);
    expect(getProgram("test-only").phases).toHaveLength(0);
    // The real version is untouched — old modules are permanent fixtures.
    expect(getProgram("2026-27").phases).toHaveLength(5);
  });
});

describe("stage moments", () => {
  it("is the fixed list of four live-audience criteria", () => {
    expect([...STAGE_MOMENT_CRITERIA]).toEqual(["2.5", "3.4", "4.5", "5.5"]);
  });

  it("identifies them and nothing else", () => {
    expect(isStageMoment("4.5")).toBe(true);
    expect(isStageMoment("1.1")).toBe(false);
    expect(isStageMoment("4.5.4")).toBe(false);
  });

  it("every stage-moment criterion exists in the content", () => {
    const ids = PROGRAM.phases.flatMap((p) => p.criteria.map((c) => c.id));
    for (const id of STAGE_MOMENT_CRITERIA) expect(ids).toContain(id);
  });
});

describe("structural reconciliation with app/2026-27/data.ts", () => {
  /**
   * NOT string equality. The two sources deliberately differ: the curriculum's
   * "Home-Study Adaptations of Cohort Moments" strips cohort references (3.4
   * drops "on a Saturday", 4.5 "to the cohort", 5.5 "at an intensive"), nine
   * more criteria are independently reworded, and the punctuation differs —
   * data.ts uses curly quotes where the markdown uses straight ones. A textual
   * assertion would fail the build on first run for all 25.
   */
  it("aligns phase count, order and keys", () => {
    expect(PROGRAM.phases).toHaveLength(pathSteps.length);
    expect(PROGRAM.phases.map((p) => p.key)).toEqual(
      pathSteps.map((s) => s.key)
    );
    expect(PROGRAM.phases.map((p) => p.num)).toEqual(
      pathSteps.map((s) => s.num)
    );
  });

  it("aligns criterion counts per phase — 5 published criteria each", () => {
    PROGRAM.phases.forEach((phase, i) => {
      expect(phase.criteria, phase.key).toHaveLength(
        pathSteps[i].criteria.length
      );
    });
  });

  it("gives every criterion an N.N id resolving to a data.ts index", () => {
    PROGRAM.phases.forEach((phase, phaseIndex) => {
      phase.criteria.forEach((criterion, criterionIndex) => {
        expect(criterion.id).toBe(`${phaseIndex + 1}.${criterionIndex + 1}`);
        // The link that matters: this criterion addresses a real published one.
        expect(pathSteps[phaseIndex].criteria[criterionIndex]).toBeTruthy();
      });
    });
  });

  it("permits wording to differ between curriculum and marketing", () => {
    // Documented explicitly so nobody 'fixes' this into a string comparison.
    const curriculum = PROGRAM.phases[2].criteria[3].passCriterion;
    const marketing = pathSteps[2].criteria[3];
    expect(curriculum.length).toBeGreaterThan(0);
    expect(marketing.length).toBeGreaterThan(0);
    // 3.4 is one of the adapted ones — the curriculum drops "on a Saturday".
    expect(curriculum).not.toBe(marketing);
  });

  it("fails if pathSteps is reordered", () => {
    const reordered = [pathSteps[1], pathSteps[0], ...pathSteps.slice(2)];
    expect(PROGRAM.phases.map((p) => p.key)).not.toEqual(
      reordered.map((s) => s.key)
    );
  });
});

describe("manifest constants", () => {
  it("declares the 2026-27 totals", () => {
    expect(MANIFEST_2026_27).toMatchObject({
      versionId: "2026-27",
      phases: 5,
      criteria: 25,
      tasks: 125,
      tasksPerPhase: [25, 26, 24, 25, 25],
    });
  });
});
