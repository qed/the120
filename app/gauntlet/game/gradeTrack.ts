import {
  PASS_LEVEL,
  PATHWAY,
  SKILL_LEVELS,
  placementGrades,
  skillGrade,
  startableLevels,
  type SkillProgress,
} from "./pathway";

export const GRADE_TRACK_VERSION = 4 as const;

export type GradeTrackState = {
  version: typeof GRADE_TRACK_VERSION;
  /** The grade the student is currently proving or remediating. */
  activeGrade: number;
  /** A contiguous set of grades cleared by checkpoint or legacy evidence. */
  passedGrades: number[];
  /** Grades with a checkpoint attempt. Missing skills must be remediated first. */
  attemptedGrades: number[];
  /** Exact confirmed gaps from the latest checkpoint; unasked skills stay untested. */
  missionIds: string[];
};

export type GradeCheckpointResult = {
  grade: number;
  passed: number[];
  failed: number[];
  /** The check stopped after enough confirmed gaps; remaining skills are untested. */
  stoppedEarly?: boolean;
};

export type GradeAssignmentProgress = Record<string, number>;

export type GradeTrackStatus = "checkpoint" | "remediation" | "recheck" | "complete";

export type GradeAssignment = {
  /** Ready for repeated concepts: a future skill can have g4:* and g5:* assignments. */
  id: string;
  grade: number;
  skillId: string;
  skillIdx: number;
  /** Students working through a grade stop before the crown/checkpoint proof. */
  bossCap: number;
};

export const TRACK_GRADES = placementGrades();
export const FIRST_TRACK_GRADE = TRACK_GRADES[0] ?? 3;
export const LAST_TRACK_GRADE = TRACK_GRADES[TRACK_GRADES.length - 1] ?? 12;
export const WORKING_GRADE_BOSS_CAP = Math.max(PASS_LEVEL, SKILL_LEVELS - 1);

/**
 * Grade assignments are deliberately separate from skill concepts. The
 * current curriculum map has one assignment per concept; this shape can hold
 * repeated concepts once the human-authored Grades 3-8 map is approved.
 */
export const GRADE_ASSIGNMENTS: GradeAssignment[] = PATHWAY.map((skill, skillIdx) => {
  const grade = skillGrade(skill.id);
  return {
    id: `g${grade}:${skill.id}`,
    grade,
    skillId: skill.id,
    skillIdx,
    bossCap: WORKING_GRADE_BOSS_CAP,
  };
});

export function assignmentsOfGrade(grade: number): GradeAssignment[] {
  return GRADE_ASSIGNMENTS.filter((assignment) => assignment.grade === grade);
}

/**
 * Provisional, explicitly-authored grade-check blueprints. Repeated ids mean
 * the clean climb asks a second question from that skill; using ids instead
 * of array positions keeps an in-progress climb stable across curriculum
 * reorderings. These anchors are intentionally isolated for human curriculum
 * sign-off before the beta label is removed.
 */
export const GRADE_CHECKPOINT_SKILL_IDS: Readonly<Record<number, readonly string[]>> = {
  3: ["add-facts", "times-1", "div-facts"],
  4: ["place-value", "times-2", "mul-2x1"],
  5: ["pow-ten", "frac-of", "frac-of"],
  6: ["gcd", "simp-fractions", "mul-fractions"],
  7: ["signed-add", "add-fractions", "one-step-eq"],
  8: ["sign-rules", "sq-roots", "proportions", "two-step-eq", "pythagoras"],
  9: ["slope", "binomials", "factor-quads", "discriminant"],
  10: ["congruence", "distance", "midpoints", "trig-values"],
  11: ["trig-beyond-q1", "amplitude", "exp-solve", "logs", "limits"],
  12: ["power-rule", "diff-polys", "chain-rule", "deriv-at-point", "crit-points"],
};

export function checkpointAssignmentsOfGrade(grade: number): GradeAssignment[] {
  const assignments = assignmentsOfGrade(grade);
  const bySkill = new Map(assignments.map((assignment) => [assignment.skillId, assignment]));
  const authored = GRADE_CHECKPOINT_SKILL_IDS[grade]
    ?.map((skillId) => bySkill.get(skillId))
    .filter((assignment): assignment is GradeAssignment => !!assignment);
  return authored?.length ? authored : assignments.slice(0, 5);
}

export function assignmentFor(
  grade: number,
  skillId: string
): GradeAssignment | undefined {
  return GRADE_ASSIGNMENTS.find(
    (assignment) => assignment.grade === grade && assignment.skillId === skillId
  );
}

export function assignmentLevel(
  progress: GradeAssignmentProgress,
  assignment: GradeAssignment
): number {
  return progress[assignment.id] ?? 0;
}

function cleanMissionIds(value: unknown, grade: number): string[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(assignmentsOfGrade(grade).map((assignment) => assignment.id));
  return [...new Set(value.filter(
    (id): id is string => typeof id === "string" && valid.has(id)
  ))];
}

/** Confirmed checkpoint gaps that still need one proof mission. */
export function pendingGradeMissions(
  track: GradeTrackState,
  progress: GradeAssignmentProgress
): GradeAssignment[] {
  const missionSet = new Set(track.missionIds);
  return assignmentsOfGrade(track.activeGrade).filter(
    (assignment) =>
      missionSet.has(assignment.id) &&
      assignmentLevel(progress, assignment) < PASS_LEVEL
  );
}

/** Bosses already beaten for a gap, waiting on the two-question proof. */
export function pendingGradeRechecks(
  track: GradeTrackState,
  progress: GradeAssignmentProgress
): GradeAssignment[] {
  const missionSet = new Set(track.missionIds);
  return assignmentsOfGrade(track.activeGrade).filter(
    (assignment) =>
      missionSet.has(assignment.id) &&
      assignmentLevel(progress, assignment) >= PASS_LEVEL
  );
}

/**
 * A checkpoint miss should create one focused proof mission, not three warm-up
 * raids. Untouched assignments may start at the ordinary pass boss; once a
 * student has begun the assignment, play continues at the next boss normally.
 */
export function preferredGradeMissionLevel(
  progress: GradeAssignmentProgress,
  assignment: GradeAssignment
): number | undefined {
  const level = assignmentLevel(progress, assignment);
  const levels = startableLevels({ [assignment.skillId]: level }, assignment.skillId);
  return levels.at(-1);
}

/** Seed the new grade-scoped keys from legacy concept progress. */
export function seedGradeAssignmentProgress(
  raw: unknown,
  legacyProgress: SkillProgress
): GradeAssignmentProgress {
  const source = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const progress: GradeAssignmentProgress = {};
  for (const assignment of GRADE_ASSIGNMENTS) {
    const scoped = source[assignment.id];
    // Curriculum corrections can move a concept to a different grade, which
    // changes its gN:* assignment id. Carry the strongest prior scoped value
    // forward by stable skill id so beta players do not lose earned evidence.
    const movedScoped = Object.entries(source).reduce<number | undefined>(
      (best, [id, value]) => {
        if (!id.endsWith(`:${assignment.skillId}`)) return best;
        if (typeof value !== "number" || !Number.isFinite(value)) return best;
        return best === undefined ? value : Math.max(best, value);
      },
      undefined
    );
    const legacy = legacyProgress[assignment.skillId];
    const level = typeof scoped === "number" && Number.isFinite(scoped)
      ? scoped
      : movedScoped !== undefined
        ? movedScoped
      : typeof legacy === "number" && Number.isFinite(legacy)
        ? legacy
        : 0;
    if (level > 0) progress[assignment.id] = Math.min(SKILL_LEVELS, Math.max(0, level));
  }
  return progress;
}

export function mergeGradeAssignmentProgress(
  a: unknown,
  b: unknown,
  legacyProgress: SkillProgress
): GradeAssignmentProgress {
  const left = seedGradeAssignmentProgress(a, legacyProgress);
  const right = seedGradeAssignmentProgress(b, legacyProgress);
  const merged: GradeAssignmentProgress = {};
  for (const assignment of GRADE_ASSIGNMENTS) {
    const level = Math.max(left[assignment.id] ?? 0, right[assignment.id] ?? 0);
    if (level > 0) merged[assignment.id] = level;
  }
  return merged;
}

function validGrade(value: unknown): value is number {
  return typeof value === "number" && TRACK_GRADES.includes(value);
}

function cleanGrades(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(validGrade))].sort((a, b) => a - b);
}

function contiguousPassed(value: unknown): number[] {
  const claimed = new Set(cleanGrades(value));
  const passed: number[] = [];
  for (const grade of TRACK_GRADES) {
    if (!claimed.has(grade)) break;
    passed.push(grade);
  }
  return passed;
}

export function gradeProgress(
  progress: GradeAssignmentProgress,
  grade: number
): { secure: number; total: number } {
  const assignments = assignmentsOfGrade(grade);
  return {
    secure: assignments.filter(
      (assignment) => assignmentLevel(progress, assignment) >= PASS_LEVEL
    ).length,
    total: assignments.length,
  };
}

export function gradeIsSecure(progress: GradeAssignmentProgress, grade: number): boolean {
  const gradeState = gradeProgress(progress, grade);
  return gradeState.total > 0 && gradeState.secure === gradeState.total;
}

function firstUnpassedGrade(passedGrades: readonly number[]): number {
  const passed = new Set(passedGrades);
  return TRACK_GRADES.find((grade) => !passed.has(grade)) ?? LAST_TRACK_GRADE;
}

/**
 * Upgrade an old save without erasing progress. Fully evidenced leading grades
 * are grandfathered as passed; the earliest incomplete grade becomes the
 * active remediation grade. Brand-new players always begin at Grade 3.
 */
export function normalizeGradeTrack(
  raw: unknown,
  progress: GradeAssignmentProgress
): GradeTrackState {
  if (raw && typeof raw === "object") {
    const candidate = raw as {
      version?: unknown;
      passedGrades?: unknown;
      attemptedGrades?: unknown;
      missionIds?: unknown;
    };
    if (candidate.version === GRADE_TRACK_VERSION) {
      const passedGrades = contiguousPassed(candidate.passedGrades);
      const complete = passedGrades.length === TRACK_GRADES.length;
      const activeGrade = complete ? LAST_TRACK_GRADE : firstUnpassedGrade(passedGrades);
      return {
        version: GRADE_TRACK_VERSION,
        activeGrade,
        passedGrades,
        attemptedGrades: cleanGrades(candidate.attemptedGrades),
        missionIds: complete ? [] : cleanMissionIds(candidate.missionIds, activeGrade),
      };
    }
    if (candidate.version === 3) {
      const passedGrades = contiguousPassed(candidate.passedGrades);
      const complete = passedGrades.length === TRACK_GRADES.length;
      const activeGrade = complete ? LAST_TRACK_GRADE : firstUnpassedGrade(passedGrades);
      return {
        version: GRADE_TRACK_VERSION,
        activeGrade,
        passedGrades,
        attemptedGrades: cleanGrades(candidate.attemptedGrades),
        missionIds: complete ? [] : cleanMissionIds(candidate.missionIds, activeGrade),
      };
    }
    // v2 treated every unasked skill as a mission after an attempt. v3 cannot
    // know which were confirmed gaps, so offer one fresh checkpoint instead
    // of preserving accidental grind. Existing skill evidence stays intact.
    if (candidate.version === 2) {
      const passedGrades = contiguousPassed(candidate.passedGrades);
      const complete = passedGrades.length === TRACK_GRADES.length;
      const activeGrade = complete ? LAST_TRACK_GRADE : firstUnpassedGrade(passedGrades);
      return {
        version: GRADE_TRACK_VERSION,
        activeGrade,
        passedGrades,
        attemptedGrades: [],
        missionIds: [],
      };
    }
    // v1 conservatively treated the first incomplete legacy grade as already
    // attempted, which forced returning beta players to grind before seeing a
    // checkpoint. v2 offers that checkpoint once; genuine v2 failures remain.
    if (candidate.version === 1) {
      const passedGrades = contiguousPassed(candidate.passedGrades);
      const complete = passedGrades.length === TRACK_GRADES.length;
      return {
        version: GRADE_TRACK_VERSION,
        activeGrade: complete ? LAST_TRACK_GRADE : firstUnpassedGrade(passedGrades),
        passedGrades,
        attemptedGrades: [],
        missionIds: [],
      };
    }
  }

  const hasProgress = Object.keys(progress).length > 0;
  if (!hasProgress) {
    return {
      version: GRADE_TRACK_VERSION,
      activeGrade: FIRST_TRACK_GRADE,
      passedGrades: [],
      attemptedGrades: [],
      missionIds: [],
    };
  }

  const passedGrades: number[] = [];
  for (const grade of TRACK_GRADES) {
    if (!gradeIsSecure(progress, grade)) break;
    passedGrades.push(grade);
  }
  const complete = passedGrades.length === TRACK_GRADES.length;
  const activeGrade = complete ? LAST_TRACK_GRADE : firstUnpassedGrade(passedGrades);
  return {
    version: GRADE_TRACK_VERSION,
    activeGrade,
    passedGrades,
    // Existing players keep their evidence and receive one checkpoint at the
    // first incomplete grade. Only an actual v3 confirmed gap starts remediation.
    attemptedGrades: [],
    missionIds: [],
  };
}

export function gradeTrackStatus(
  track: GradeTrackState,
  progress: GradeAssignmentProgress
): GradeTrackStatus {
  if (track.passedGrades.length === TRACK_GRADES.length) return "complete";
  if (pendingGradeRechecks(track, progress).length > 0) return "recheck";
  if (pendingGradeMissions(track, progress).length > 0) return "remediation";
  return "checkpoint";
}

/** The exact next unmet assignment inside the active grade. */
export function currentGradeSkillIdx(
  track: GradeTrackState,
  progress: GradeAssignmentProgress
): number {
  const assignments = assignmentsOfGrade(track.activeGrade);
  const pendingMission = pendingGradeMissions(track, progress)[0];
  if (pendingMission) return pendingMission.skillIdx;
  const unmet = assignments.find(
    (assignment) => assignmentLevel(progress, assignment) < PASS_LEVEL
  );
  return unmet?.skillIdx ?? assignments[0]?.skillIdx ?? 0;
}

/**
 * Apply one grade checkpoint. A clean sweep earns crown proof (Boss N) for
 * the grade and offers the next grade. Otherwise only clean assignments are
 * credited at the ordinary pass level and the misses become remediation.
 */
export function applyGradeCheckpoint(
  track: GradeTrackState,
  progress: GradeAssignmentProgress,
  result: GradeCheckpointResult
): { track: GradeTrackState; progress: GradeAssignmentProgress; passedGrade: boolean } {
  const grade = track.activeGrade;
  if (result.grade !== grade) {
    return { track, progress, passedGrade: false };
  }
  const assignments = assignmentsOfGrade(grade);
  const required = new Set(
    checkpointAssignmentsOfGrade(grade).map((assignment) => assignment.skillIdx)
  );
  const passed = new Set(
    result.passed.filter((index) => required.has(index))
  );
  const failed = new Set(
    result.failed.filter((index) => required.has(index))
  );
  const passedGrade =
    required.size > 0 &&
    failed.size === 0 &&
    [...required].every((index) => passed.has(index));

  const nextProgress = { ...progress };
  for (const index of passed) {
    const assignment = assignments.find((candidate) => candidate.skillIdx === index);
    if (!assignment) continue;
    nextProgress[assignment.id] = Math.max(
      nextProgress[assignment.id] ?? 0,
      passedGrade ? SKILL_LEVELS : PASS_LEVEL
    );
  }

  if (passedGrade) {
    // A grade check is a placement-out assessment. Once its authored anchors
    // are clean, every assignment in that grade is credited so the student is
    // not sent back to grind material the grade check just placed them past.
    for (const assignment of assignments) {
      nextProgress[assignment.id] = Math.max(
        nextProgress[assignment.id] ?? 0,
        SKILL_LEVELS
      );
    }
  }

  const failedAssignments = [...failed]
    .map((index) => assignments.find((candidate) => candidate.skillIdx === index))
    .filter((assignment): assignment is GradeAssignment => !!assignment);

  // A confirmed checkpoint miss creates exactly one proof raid even when the
  // skill was secure before this retry. Untested skills are left untouched.
  for (const assignment of failedAssignments) {
    const current = nextProgress[assignment.id] ?? 0;
    if (current >= PASS_LEVEL) nextProgress[assignment.id] = PASS_LEVEL - 1;
  }

  if (!passedGrade) {
    return {
      progress: nextProgress,
      passedGrade: false,
      track: {
        ...track,
        attemptedGrades: cleanGrades([...track.attemptedGrades, grade]),
        missionIds: failedAssignments.map((assignment) => assignment.id),
      },
    };
  }

  const passedGrades = contiguousPassed([...track.passedGrades, grade]);
  const complete = passedGrades.length === TRACK_GRADES.length;
  return {
    progress: nextProgress,
    passedGrade: true,
    track: {
      version: GRADE_TRACK_VERSION,
      activeGrade: complete ? LAST_TRACK_GRADE : firstUnpassedGrade(passedGrades),
      passedGrades,
      attemptedGrades: track.attemptedGrades,
      missionIds: [],
    },
  };
}

/**
 * Resolve one post-boss proof. A miss re-arms that exact mission; a clean
 * proof removes it. Clearing the last confirmed gap earns the grade without
 * replaying the already-finished grade check.
 */
export function applyGradeRecheck(
  track: GradeTrackState,
  progress: GradeAssignmentProgress,
  assignmentId: string,
  passed: boolean
): { track: GradeTrackState; progress: GradeAssignmentProgress; passedGrade: boolean } {
  const assignment = assignmentsOfGrade(track.activeGrade).find(
    (candidate) => candidate.id === assignmentId
  );
  if (!assignment || !track.missionIds.includes(assignmentId)) {
    return { track, progress, passedGrade: false };
  }

  const nextProgress = { ...progress };
  if (!passed) {
    nextProgress[assignment.id] = Math.min(
      nextProgress[assignment.id] ?? PASS_LEVEL,
      PASS_LEVEL - 1
    );
    return { track, progress: nextProgress, passedGrade: false };
  }

  nextProgress[assignment.id] = Math.max(
    nextProgress[assignment.id] ?? 0,
    SKILL_LEVELS
  );
  const missionIds = track.missionIds.filter((id) => id !== assignmentId);
  if (missionIds.length > 0) {
    return {
      progress: nextProgress,
      passedGrade: false,
      track: { ...track, missionIds },
    };
  }

  for (const gradeAssignment of assignmentsOfGrade(track.activeGrade)) {
    nextProgress[gradeAssignment.id] = Math.max(
      nextProgress[gradeAssignment.id] ?? 0,
      SKILL_LEVELS
    );
  }
  const passedGrades = contiguousPassed([...track.passedGrades, track.activeGrade]);
  const complete = passedGrades.length === TRACK_GRADES.length;
  return {
    progress: nextProgress,
    passedGrade: true,
    track: {
      version: GRADE_TRACK_VERSION,
      activeGrade: complete ? LAST_TRACK_GRADE : firstUnpassedGrade(passedGrades),
      passedGrades,
      attemptedGrades: track.attemptedGrades,
      missionIds: [],
    },
  };
}

export function mergeGradeTracks(
  a: unknown,
  b: unknown,
  progress: GradeAssignmentProgress
): GradeTrackState {
  const left = normalizeGradeTrack(a, progress);
  const right = normalizeGradeTrack(b, progress);
  return normalizeGradeTrack(
    {
      version: GRADE_TRACK_VERSION,
      passedGrades: [...left.passedGrades, ...right.passedGrades],
      attemptedGrades: [...left.attemptedGrades, ...right.attemptedGrades],
      missionIds: [...left.missionIds, ...right.missionIds],
    },
    progress
  );
}
