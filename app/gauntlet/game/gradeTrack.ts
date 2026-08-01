import {
  PASS_LEVEL,
  PATHWAY,
  SKILL_LEVELS,
  placementGrades,
  skillGrade,
  startableLevels,
  type SkillProgress,
} from "./pathway";

export const GRADE_TRACK_VERSION = 2 as const;

export type GradeTrackState = {
  version: typeof GRADE_TRACK_VERSION;
  /** The grade the student is currently proving or remediating. */
  activeGrade: number;
  /** A contiguous set of grades cleared by checkpoint or legacy evidence. */
  passedGrades: number[];
  /** Grades with a checkpoint attempt. Missing skills must be remediated first. */
  attemptedGrades: number[];
};

export type GradeCheckpointResult = {
  grade: number;
  passed: number[];
  failed: number[];
};

export type GradeAssignmentProgress = Record<string, number>;

export type GradeTrackStatus = "checkpoint" | "remediation" | "complete";

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
    const legacy = legacyProgress[assignment.skillId];
    const level = typeof scoped === "number" && Number.isFinite(scoped)
      ? scoped
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
    // first incomplete grade. Only an actual v2 miss starts remediation.
    attemptedGrades: [],
  };
}

export function gradeTrackStatus(
  track: GradeTrackState,
  progress: GradeAssignmentProgress
): GradeTrackStatus {
  if (track.passedGrades.length === TRACK_GRADES.length) return "complete";
  if (!track.attemptedGrades.includes(track.activeGrade)) return "checkpoint";
  return gradeIsSecure(progress, track.activeGrade) ? "checkpoint" : "remediation";
}

/** The exact next unmet assignment inside the active grade. */
export function currentGradeSkillIdx(
  track: GradeTrackState,
  progress: GradeAssignmentProgress
): number {
  const assignments = assignmentsOfGrade(track.activeGrade);
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
  const required = new Set(assignments.map((assignment) => assignment.skillIdx));
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

  if (!passedGrade) {
    return {
      progress: nextProgress,
      passedGrade: false,
      track: {
        ...track,
        attemptedGrades: cleanGrades([...track.attemptedGrades, grade]),
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
    },
    progress
  );
}
