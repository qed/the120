import { describe, it, expect } from "vitest";
import {
  adaptivePlacementTail,
  areaGradeSpan,
  AREAS,
  fastMathGrade,
  PASS_LEVEL,
  PATHWAY,
  SKILL_GRADE,
  skillGrade,
  skillsOfGrade,
  summarizePlacement,
  type SkillProgress,
} from "../pathway";

/** Fast Math grade layer (Peter 2026-07-19, GT Alpha): every skill carries a
 *  grade 3–12, non-decreasing along the pathway so "your grade" is coherent. */

describe("SKILL_GRADE", () => {
  it("covers every pathway skill, grades 3–12", () => {
    for (const s of PATHWAY) {
      expect(SKILL_GRADE[s.id], s.id).toBeDefined();
      expect(SKILL_GRADE[s.id], s.id).toBeGreaterThanOrEqual(3);
      expect(SKILL_GRADE[s.id], s.id).toBeLessThanOrEqual(12);
    }
  });
  it("has no orphan entries (every graded id is on the pathway)", () => {
    for (const id of Object.keys(SKILL_GRADE)) {
      expect(PATHWAY.some((s) => s.id === id), id).toBe(true);
    }
  });
  it("is non-decreasing along the pathway", () => {
    for (let i = 1; i < PATHWAY.length; i++) {
      expect(
        skillGrade(PATHWAY[i].id),
        `${PATHWAY[i - 1].id} (${skillGrade(PATHWAY[i - 1].id)}) → ${PATHWAY[i].id}`
      ).toBeGreaterThanOrEqual(skillGrade(PATHWAY[i - 1].id));
    }
  });
  it("spans grade 3 at the start and grade 12 at the end", () => {
    expect(skillGrade(PATHWAY[0].id)).toBe(3);
    expect(skillGrade(PATHWAY[PATHWAY.length - 1].id)).toBe(12);
  });
});

describe("fastMathGrade", () => {
  it("fresh player is grade 3", () => {
    const fm = fastMathGrade({});
    expect(fm.grade).toBe(3);
    expect(fm.complete).toBe(false);
  });
  it("a gap holds your grade down; the frontier grade shows how far you reached", () => {
    // pass everything through algebra except one grade-6 skill (a gap)
    const gapId = "signed-add";
    const lastAlg = PATHWAY.findIndex((s) => s.id === "discriminant");
    const progress: SkillProgress = {};
    for (let i = 0; i <= lastAlg; i++) {
      if (PATHWAY[i].id !== gapId) progress[PATHWAY[i].id] = PASS_LEVEL;
    }
    const fm = fastMathGrade(progress);
    expect(fm.grade).toBe(6); // the gap's grade
    expect(fm.frontierGrade).toBe(9); // discriminant's grade
  });
  it("everything passed → grade 12 complete", () => {
    const progress: SkillProgress = {};
    for (const s of PATHWAY) progress[s.id] = PASS_LEVEL;
    const fm = fastMathGrade(progress);
    expect(fm.complete).toBe(true);
    expect(fm.grade).toBe(12);
  });
});

describe("areaGradeSpan", () => {
  it("every area has a sensible span", () => {
    for (const a of AREAS) {
      const span = areaGradeSpan(a.id);
      expect(span, a.id).not.toBeNull();
      expect(span![0], a.id).toBeLessThanOrEqual(span![1]);
    }
  });
  it("calculus is grade 12; arithmetic starts at grade 3", () => {
    expect(areaGradeSpan("calc")).toEqual([12, 12]);
    expect(areaGradeSpan("arith")![0]).toBe(3);
  });
});

describe("summarizePlacement", () => {
  it("keeps probing credit above an earlier failed grade", () => {
    const grade3 = skillsOfGrade(3);
    const grade4 = skillsOfGrade(4);
    const grade5 = skillsOfGrade(5);
    const summary = summarizePlacement([
      { grade: 3, passed: grade3.slice(0, 2), failed: [] },
      { grade: 4, passed: grade4.slice(0, 1), failed: grade4.slice(1, 3) },
      { grade: 5, passed: grade5.slice(0, 2), failed: [] },
    ]);

    expect(summary.frontierGrade).toBe(5);
    expect(summary.passed).toEqual(
      [...grade3, grade4[0], ...grade5].sort((a, b) => a - b)
    );
    expect(summary.gaps).toEqual(grade4.slice(1, 3));
    expect(summary.landing).toBe(grade4[1]);
  });

  it("does not turn one miss into a gap when the grade is proved 2-of-3", () => {
    const grade8 = skillsOfGrade(8);
    const summary = summarizePlacement([
      { grade: 8, passed: grade8.slice(0, 2), failed: grade8.slice(2, 3) },
    ]);

    expect(summary.frontierGrade).toBe(8);
    expect(summary.passed).toEqual(grade8);
    expect(summary.gaps).toEqual([]);
  });

  it("opens the full road after every station is proved", () => {
    const summary = summarizePlacement(
      [...new Set(PATHWAY.map((skill) => skillGrade(skill.id)))].map((grade) => ({
        grade,
        passed: skillsOfGrade(grade).slice(0, 2),
        failed: [],
      }))
    );

    expect(summary.passed).toHaveLength(PATHWAY.length);
    expect(summary.gaps).toEqual([]);
    expect(summary.frontierGrade).toBe(12);
  });
});

describe("adaptivePlacementTail", () => {
  it("replaces a long remaining climb with three spaced safety checks", () => {
    expect(adaptivePlacementTail(4, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual([7, 10, 12]);
  });

  it("keeps every remaining grade when the player is already near the top", () => {
    expect(adaptivePlacementTail(9, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual([10, 11, 12]);
  });

  it("sorts and deduplicates a supplied grade route", () => {
    expect(adaptivePlacementTail(4, [12, 7, 5, 7, 9, 6, 4, 3])).toEqual([6, 9, 12]);
  });
});
