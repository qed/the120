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
  GRADE_TRACK_VERSION,
  TRACK_GRADES,
  WORKING_GRADE_BOSS_CAP,
  applyGradeCheckpoint,
  applyGradeRecheck,
  assignmentFor,
  checkpointAssignmentsOfGrade,
  currentGradeSkillIdx,
  gradeTrackStatus,
  normalizeGradeTrack,
  pendingGradeMissions,
  pendingGradeRechecks,
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
    const checkpointSkills = checkpointAssignmentsOfGrade(3).map((assignment) => assignment.skillIdx);
    const passed = checkpointSkills.slice(0, 1);
    const failed = checkpointSkills.slice(1);

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

  it("offers a short recheck after the boss, then advances without replaying the grade", () => {
    const track = normalizeGradeTrack(null, {});
    const gradeSkills = checkpointAssignmentsOfGrade(3).map((assignment) => assignment.skillIdx);
    const applied = applyGradeCheckpoint(track, {}, {
      grade: 3,
      passed: gradeSkills.slice(0, 2),
      failed: gradeSkills.slice(2),
    });
    const remediated = { ...applied.progress };
    for (const index of gradeSkills.slice(2)) {
      const assignment = assignmentFor(3, PATHWAY[index].id)!;
      remediated[assignment.id] = PASS_LEVEL;
    }

    expect(gradeTrackStatus(applied.track, remediated)).toBe("recheck");
    const proof = pendingGradeRechecks(applied.track, remediated)[0];
    const proved = applyGradeRecheck(applied.track, remediated, proof.id, true);
    expect(proved.passedGrade).toBe(true);
    expect(proved.track.passedGrades).toEqual([3]);
    expect(proved.track.activeGrade).toBe(4);
  });

  it("collects every authored anchor gap while leaving non-anchor skills untested", () => {
    const track = normalizeGradeTrack(null, {});
    const gradeSkills = skillsOfGrade(3);
    const anchors = checkpointAssignmentsOfGrade(3).map((assignment) => assignment.skillIdx);
    const passed = anchors.slice(0, 1);
    const failed = anchors.slice(1);
    const nonAnchor = gradeSkills.find((index) => !anchors.includes(index))!;

    const applied = applyGradeCheckpoint(track, {}, {
      grade: 3,
      passed,
      failed,
    });

    expect(pendingGradeMissions(applied.track, applied.progress).map((mission) => mission.skillIdx))
      .toEqual(failed);
    expect(applied.progress[assignmentFor(3, PATHWAY[nonAnchor].id)!.id]).toBeUndefined();

    const remediated = { ...applied.progress };
    for (const index of failed) {
      remediated[assignmentFor(3, PATHWAY[index].id)!.id] = PASS_LEVEL;
    }
    expect(gradeTrackStatus(applied.track, remediated)).toBe("recheck");
  });

  it("turns an untouched checkpoint miss into one direct proof mission", () => {
    const assignment = assignmentFor(3, PATHWAY[skillsOfGrade(3)[0]].id)!;

    expect(preferredGradeMissionLevel({}, assignment)).toBe(PASS_LEVEL);
    expect(preferredGradeMissionLevel({ [assignment.id]: 1 }, assignment)).toBe(2);
  });

  it("turns a confirmed miss on a previously secure skill into one new proof mission", () => {
    const track = normalizeGradeTrack(null, {});
    const skillIdx = skillsOfGrade(3)[0];
    const assignment = assignmentFor(3, PATHWAY[skillIdx].id)!;
    const applied = applyGradeCheckpoint(
      track,
      { [assignment.id]: PASS_LEVEL },
      { grade: 3, passed: [], failed: [skillIdx] }
    );

    expect(applied.progress[assignment.id]).toBe(PASS_LEVEL - 1);
    expect(preferredGradeMissionLevel(applied.progress, assignment)).toBe(PASS_LEVEL);
    expect(gradeTrackStatus(applied.track, applied.progress)).toBe("remediation");
  });

  it("a clean checkpoint grants crown proof and immediately offers the next grade", () => {
    const track = normalizeGradeTrack(null, {});
    const checkpointSkills = checkpointAssignmentsOfGrade(3).map((assignment) => assignment.skillIdx);

    const applied = applyGradeCheckpoint(track, {}, {
      grade: 3,
      passed: checkpointSkills,
      failed: [],
    });

    expect(applied.passedGrade).toBe(true);
    expect(applied.track.passedGrades).toEqual([3]);
    expect(applied.track.activeGrade).toBe(4);
    expect(gradeTrackStatus(applied.track, applied.progress)).toBe("checkpoint");
    for (const index of skillsOfGrade(3)) {
      const assignment = assignmentFor(3, PATHWAY[index].id)!;
      expect(applied.progress[assignment.id]).toBe(SKILL_LEVELS);
    }
  });

  it("can chain clean grade checkpoints without remediation between them", () => {
    const start = normalizeGradeTrack(null, {});
    const grade3 = applyGradeCheckpoint(start, {}, {
      grade: 3,
      passed: checkpointAssignmentsOfGrade(3).map((assignment) => assignment.skillIdx),
      failed: [],
    });
    const grade4 = applyGradeCheckpoint(grade3.track, grade3.progress, {
      grade: 4,
      passed: checkpointAssignmentsOfGrade(4).map((assignment) => assignment.skillIdx),
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

  it("uses explicit 3–5 question blueprints for every grade", () => {
    for (const grade of TRACK_GRADES) {
      const checkpoint = checkpointAssignmentsOfGrade(grade);
      expect(checkpoint.length).toBeGreaterThanOrEqual(3);
      expect(checkpoint.length).toBeLessThanOrEqual(5);
      expect(checkpoint.every((assignment) => assignment.grade === grade)).toBe(true);
    }
  });

  it("prefers grade-scoped progress over a legacy concept value", () => {
    const assignment = GRADE_ASSIGNMENTS[0];
    const seeded = seedGradeAssignmentProgress(
      { [assignment.id]: 1 },
      { [assignment.skillId]: 4 }
    );

    expect(seeded[assignment.id]).toBe(1);
  });

  it("carries grade-scoped evidence forward when curriculum review moves a skill", () => {
    const assignment = assignmentFor(7, "signed-add")!;
    const seeded = seedGradeAssignmentProgress(
      { "g6:signed-add": PASS_LEVEL },
      {}
    );

    expect(seeded[assignment.id]).toBe(PASS_LEVEL);
    expect(seeded["g6:signed-add"]).toBeUndefined();
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

    expect(track.version).toBe(GRADE_TRACK_VERSION);
    expect(track.activeGrade).toBe(6);
    expect(track.passedGrades).toEqual([3, 4, 5]);
    expect(track.attemptedGrades).toEqual([]);
    expect(track.missionIds).toEqual([]);
    expect(gradeTrackStatus(track, {})).toBe("checkpoint");
  });

  it("upgrades v2 attempts into a fresh checkpoint without deleting skill evidence", () => {
    const gradeSkills = skillsOfGrade(3);
    const secured = assignmentFor(3, PATHWAY[gradeSkills[0]].id)!;
    const progress = { [secured.id]: PASS_LEVEL };
    const track = normalizeGradeTrack(
      { version: 2, passedGrades: [], attemptedGrades: [3] },
      progress
    );

    expect(track.version).toBe(GRADE_TRACK_VERSION);
    expect(track.attemptedGrades).toEqual([]);
    expect(track.missionIds).toEqual([]);
    expect(track.activeGrade).toBe(3);
    expect(progress[secured.id]).toBe(PASS_LEVEL);
    expect(gradeTrackStatus(track, progress)).toBe("checkpoint");
  });
});
