import { describe, expect, it } from "vitest";
import {
  PASS_LEVEL,
  PATHWAY,
  SKILL_LEVELS,
  skillsOfGrade,
  type SkillProgress,
} from "../pathway";
import {
  GRADE_ASSIGNMENTS,
  TRACK_GRADES,
  WORKING_GRADE_BOSS_CAP,
  applyGradeCheckpoint,
  assignmentFor,
  currentGradeSkillIdx,
  gradeTrackStatus,
  normalizeGradeTrack,
  preferredGradeMissionLevel,
  seedGradeAssignmentProgress,
} from "../gradeTrack";

describe("sequential grade track", () => {
  it("starts every new player with the Grade 3 checkpoint", () => {
    const track = normalizeGradeTrack(null, {});

    expect(track.activeGrade).toBe(3);
    expect(track.passedGrades).toEqual([]);
    expect(gradeTrackStatus(track, {})).toBe("checkpoint");
  });

  it("credits only demonstrated assignments after a failed checkpoint", () => {
    const track = normalizeGradeTrack(null, {});
    const gradeSkills = skillsOfGrade(3);
    const passed = gradeSkills.slice(0, 2);
    const failed = gradeSkills.slice(2);

    const applied = applyGradeCheckpoint(track, {}, { grade: 3, passed, failed });

    expect(applied.passedGrade).toBe(false);
    expect(applied.track.activeGrade).toBe(3);
    expect(gradeTrackStatus(applied.track, applied.progress)).toBe("remediation");
    for (const index of passed) {
      const assignment = assignmentFor(3, PATHWAY[index].id)!;
      expect(applied.progress[assignment.id]).toBe(PASS_LEVEL);
    }
    expect(currentGradeSkillIdx(applied.track, applied.progress)).toBe(failed[0]);
  });

  it("offers the same checkpoint again after every missed skill is secure", () => {
    const track = normalizeGradeTrack(null, {});
    const gradeSkills = skillsOfGrade(3);
    const applied = applyGradeCheckpoint(track, {}, {
      grade: 3,
      passed: gradeSkills.slice(0, 1),
      failed: gradeSkills.slice(1),
    });
    const remediated = { ...applied.progress };
    for (const index of gradeSkills.slice(1)) {
      const assignment = assignmentFor(3, PATHWAY[index].id)!;
      remediated[assignment.id] = PASS_LEVEL;
    }

    expect(gradeTrackStatus(applied.track, remediated)).toBe("checkpoint");
  });

  it("turns an untouched checkpoint miss into one direct proof mission", () => {
    const assignment = assignmentFor(3, PATHWAY[skillsOfGrade(3)[0]].id)!;

    expect(preferredGradeMissionLevel({}, assignment)).toBe(PASS_LEVEL);
    expect(preferredGradeMissionLevel({ [assignment.id]: 1 }, assignment)).toBe(2);
  });

  it("a clean checkpoint grants crown proof and immediately offers the next grade", () => {
    const track = normalizeGradeTrack(null, {});
    const gradeSkills = skillsOfGrade(3);

    const applied = applyGradeCheckpoint(track, {}, {
      grade: 3,
      passed: gradeSkills,
      failed: [],
    });

    expect(applied.passedGrade).toBe(true);
    expect(applied.track.passedGrades).toEqual([3]);
    expect(applied.track.activeGrade).toBe(4);
    expect(gradeTrackStatus(applied.track, applied.progress)).toBe("checkpoint");
    for (const index of gradeSkills) {
      const assignment = assignmentFor(3, PATHWAY[index].id)!;
      expect(applied.progress[assignment.id]).toBe(SKILL_LEVELS);
    }
  });

  it("can chain clean grade checkpoints without remediation between them", () => {
    const start = normalizeGradeTrack(null, {});
    const grade3 = applyGradeCheckpoint(start, {}, {
      grade: 3,
      passed: skillsOfGrade(3),
      failed: [],
    });
    const grade4 = applyGradeCheckpoint(grade3.track, grade3.progress, {
      grade: 4,
      passed: skillsOfGrade(4),
      failed: [],
    });

    expect(grade4.passedGrade).toBe(true);
    expect(grade4.track.passedGrades).toEqual([3, 4]);
    expect(grade4.track.activeGrade).toBe(5);
    expect(gradeTrackStatus(grade4.track, grade4.progress)).toBe("checkpoint");
  });

  it("offers existing players a checkpoint at their earliest incomplete grade without deleting higher evidence", () => {
    const progress: SkillProgress = {};
    const grade3 = skillsOfGrade(3);
    for (const index of grade3.slice(1)) progress[PATHWAY[index].id] = PASS_LEVEL;
    for (const index of skillsOfGrade(4)) progress[PATHWAY[index].id] = PASS_LEVEL;

    const assignmentProgress = seedGradeAssignmentProgress(null, progress);
    const track = normalizeGradeTrack(null, assignmentProgress);

    expect(track.activeGrade).toBe(3);
    expect(track.passedGrades).toEqual([]);
    expect(track.attemptedGrades).toEqual([]);
    expect(gradeTrackStatus(track, assignmentProgress)).toBe("checkpoint");
    expect(progress[PATHWAY[skillsOfGrade(4)[0]].id]).toBe(PASS_LEVEL);
    expect(currentGradeSkillIdx(track, assignmentProgress)).toBe(grade3[0]);
  });

  it("keeps curriculum concepts separate from stable grade assignments", () => {
    expect(GRADE_ASSIGNMENTS).toHaveLength(PATHWAY.length);
    expect(new Set(GRADE_ASSIGNMENTS.map((assignment) => assignment.id)).size).toBe(PATHWAY.length);
    expect(GRADE_ASSIGNMENTS.every((assignment) => TRACK_GRADES.includes(assignment.grade))).toBe(true);
    expect(GRADE_ASSIGNMENTS.every((assignment) => assignment.bossCap === WORKING_GRADE_BOSS_CAP)).toBe(true);
    expect(WORKING_GRADE_BOSS_CAP).toBe(SKILL_LEVELS - 1);
  });

  it("prefers grade-scoped progress over a legacy concept value", () => {
    const assignment = GRADE_ASSIGNMENTS[0];
    const seeded = seedGradeAssignmentProgress(
      { [assignment.id]: 1 },
      { [assignment.skillId]: 4 }
    );

    expect(seeded[assignment.id]).toBe(1);
  });

  it("ignores a stale checkpoint result from a different active grade", () => {
    const track = normalizeGradeTrack(null, {});
    const result = applyGradeCheckpoint(track, {}, {
      grade: 4,
      passed: skillsOfGrade(4),
      failed: [],
    });

    expect(result.track).toBe(track);
    expect(result.progress).toEqual({});
    expect(result.passedGrade).toBe(false);
  });

  it("upgrades the conservative v1 migration into a fresh checkpoint", () => {
    const track = normalizeGradeTrack(
      { version: 1, activeGrade: 6, passedGrades: [3, 4, 5], attemptedGrades: [6] },
      {}
    );

    expect(track.version).toBe(2);
    expect(track.activeGrade).toBe(6);
    expect(track.passedGrades).toEqual([3, 4, 5]);
    expect(track.attemptedGrades).toEqual([]);
    expect(gradeTrackStatus(track, {})).toBe("checkpoint");
  });
});
