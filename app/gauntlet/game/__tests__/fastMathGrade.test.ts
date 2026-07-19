import { describe, it, expect } from "vitest";
import {
  areaGradeSpan,
  AREAS,
  fastMathGrade,
  PASS_LEVEL,
  PATHWAY,
  SKILL_GRADE,
  skillGrade,
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
