/**
 * T1 Unit 4 — build the seed rows for the content skeleton.
 *
 * Plain module: no `server-only`, no `"use server"`. Both the seed script
 * (`scripts/seed-path-content.ts`, run under tsx) and the vitest suite import
 * it, and `server-only` throws under tsx transitively — the same constraint
 * that shaped Unit 3's parser.
 *
 * Turns a parsed `ProgramContent` into the four flat row sets the content
 * tables hold. Decision 7: the database stores ONLY structural identity —
 * stable slug ids, sequence, version, and the parent FK. Every string of
 * curriculum prose (title, body, Done-when, band variants) stays in the
 * generated TS module and never enters SQL, which is what structurally avoids
 * the recorded em-dash seed-drift incident.
 *
 * FK targets are derived from the CONTENT TREE, not by string-splitting ids: a
 * task's criterion is the criterion it is nested under, a criterion's phase is
 * the phase it is nested under. The nesting is then cross-checked against the
 * ids so a malformed package (a task that does not belong under its criterion)
 * raises here rather than emitting an orphan row whose FK insert fails opaquely
 * — or worse, whose FK happens to resolve to the wrong parent.
 *
 * DEFENSE IN DEPTH. `parseCurriculum` (the only producer on the sanctioned
 * markdown → generated-module path) already assigns strictly-incrementing
 * ids/seqs, so a well-generated package cannot reach the throws below. These
 * checks exist for the OTHER producers this unit's `ProgramContent` contract
 * invites — a hand-edited or mis-generated module in T2/T3. Two families:
 *   1. Parent/child prefix agreement (a task under the wrong criterion).
 *   2. Global uniqueness of phase nums/seqs, criterion ids, and task ids. This
 *      is not redundant with (1): two criteria with id "1.1" under different
 *      phases both pass the local prefix check, then collide on the composite
 *      PK — `ON CONFLICT DO NOTHING` keeps the first, and the second's tasks
 *      silently FK to the WRONG criterion. That is exactly the "resolve to the
 *      wrong parent" failure the paragraph above promises to prevent, and only
 *      a uniqueness check actually prevents it.
 */

import type { DeepReadonly, ProgramContent } from "./types";

/** One row of `path_program_versions`. `is_current` designates the pin target. */
export type VersionRow = {
  id: string;
  is_current: boolean;
};

/** One row of `path_phases`. */
export type PhaseRow = {
  program_version_id: string;
  num: string;
  phase_key: string;
  /** Global ordinal within the version, 1..5 — unique across the version. */
  seq: number;
};

/** One row of `path_criteria`. */
export type CriterionRow = {
  program_version_id: string;
  criterion_id: string;
  phase_num: string;
  /** 1-based WITHIN this phase — NOT globally unique. Do not `ORDER BY seq` across the table. */
  seq: number;
};

/** One row of `path_unit_tasks`. */
export type TaskRow = {
  program_version_id: string;
  task_id: string;
  criterion_id: string;
  /** 1-based WITHIN this criterion — NOT globally unique. Do not `ORDER BY seq` across the table. */
  seq: number;
};

export type ProgramRows = {
  version: VersionRow;
  phases: PhaseRow[];
  criteria: CriterionRow[];
  tasks: TaskRow[];
};

/** The criterion-prefix of a task id: everything before the final dot. */
function criterionPrefixOf(taskId: string): string {
  const lastDot = taskId.lastIndexOf(".");
  return lastDot === -1 ? taskId : taskId.slice(0, lastDot);
}

/** The phase-prefix of a criterion id: everything before the first dot. */
function phasePrefixOf(criterionId: string): string {
  const firstDot = criterionId.indexOf(".");
  return firstDot === -1 ? criterionId : criterionId.slice(0, firstDot);
}

/**
 * Build the seed rows for one program version.
 *
 * @param content   parsed program content (the pinned version's, in practice)
 * @param opts.isCurrent whether this version is the provisioning default
 * @throws if the content tree is structurally inconsistent — an orphan task or
 *   criterion (naming both ids), or a duplicate phase num/seq, criterion id, or
 *   task id — never emits a row that would orphan or FK to the wrong parent.
 */
export function buildProgramRows(
  content: DeepReadonly<ProgramContent>,
  opts: { isCurrent: boolean }
): ProgramRows {
  const programVersionId = content.versionId;

  const phases: PhaseRow[] = [];
  const criteria: CriterionRow[] = [];
  const tasks: TaskRow[] = [];

  // Global-uniqueness guards (see the "defense in depth" note above). A
  // collision here would otherwise reach the DB as a silent ON CONFLICT DO
  // NOTHING skip, leaving a child row FK'd to the wrong surviving parent.
  const seenPhaseNums = new Set<string>();
  const seenPhaseSeqs = new Set<number>();
  const seenCriterionIds = new Set<string>();
  const seenTaskIds = new Set<string>();

  for (const phase of content.phases) {
    if (seenPhaseNums.has(phase.num)) {
      throw new Error(
        `Malformed content in ${programVersionId}: duplicate phase num "${phase.num}".`
      );
    }
    if (seenPhaseSeqs.has(phase.seq)) {
      throw new Error(
        `Malformed content in ${programVersionId}: duplicate phase seq ${phase.seq} ` +
          `(phase "${phase.num}"). Two phases sharing a seq make criterion ids ambiguous.`
      );
    }
    seenPhaseNums.add(phase.num);
    seenPhaseSeqs.add(phase.seq);

    phases.push({
      program_version_id: programVersionId,
      num: phase.num,
      phase_key: phase.key,
      seq: phase.seq,
    });

    for (const criterion of phase.criteria) {
      // A criterion's id is `phaseSeq.criterionSeq` (e.g. "1.1" in phase 1).
      // If its phase-prefix does not match the phase it is nested under, the
      // package is malformed and its phase FK would resolve to the wrong phase.
      if (phasePrefixOf(criterion.id) !== String(phase.seq)) {
        throw new Error(
          `Malformed content in ${programVersionId}: criterion "${criterion.id}" ` +
            `is nested under phase ${phase.num} (seq ${phase.seq}) but its id does ` +
            `not sit under that phase. A criterion must belong to the phase whose ` +
            `sequence prefixes its id.`
        );
      }

      if (seenCriterionIds.has(criterion.id)) {
        throw new Error(
          `Malformed content in ${programVersionId}: duplicate criterion id "${criterion.id}". ` +
            `A second criterion with this id would collide on the composite PK and its tasks ` +
            `would FK to the first criterion, not this one.`
        );
      }
      seenCriterionIds.add(criterion.id);

      criteria.push({
        program_version_id: programVersionId,
        criterion_id: criterion.id,
        phase_num: phase.num,
        seq: criterion.seq,
      });

      for (const task of criterion.tasks) {
        // A task's id is `criterionId.taskSeq` (e.g. "1.1.1" under "1.1"). If
        // its criterion-prefix does not match the criterion it is nested under,
        // it is an orphan — emitting the row would point its criterion FK at a
        // criterion it does not belong to.
        if (criterionPrefixOf(task.id) !== criterion.id) {
          throw new Error(
            `Malformed content in ${programVersionId}: task "${task.id}" is nested ` +
              `under criterion "${criterion.id}" but its id does not sit under that ` +
              `criterion. A task must belong to the criterion whose id prefixes its own.`
          );
        }

        if (seenTaskIds.has(task.id)) {
          throw new Error(
            `Malformed content in ${programVersionId}: duplicate task id "${task.id}".`
          );
        }
        seenTaskIds.add(task.id);

        tasks.push({
          program_version_id: programVersionId,
          task_id: task.id,
          criterion_id: criterion.id,
          seq: task.seq,
        });
      }
    }
  }

  return {
    version: { id: programVersionId, is_current: opts.isCurrent },
    phases,
    criteria,
    tasks,
  };
}

/**
 * One idempotent upsert against one content table.
 *
 * The `onConflict` columns are a discriminated-union LITERAL tied to each
 * table, colocated with the row types they key — the single source of truth
 * the seed script consumes, instead of four hand-typed strings floating in an
 * `object[]` at the call site. `onConflict` MUST name exactly the PRIMARY KEY
 * columns declared in the migration
 * (supabase/migrations/20260721120000_path_program_content.sql); the drift test
 * in __tests__/seed-rows.test.ts pins these so a change to either side is
 * deliberate, not a silent mismatch that turns the no-op re-run into a
 * constraint error or a wrong dedup key.
 */
export type UpsertStep =
  | { table: "path_program_versions"; rows: VersionRow[]; onConflict: "id" }
  | { table: "path_phases"; rows: PhaseRow[]; onConflict: "program_version_id,num" }
  | {
      table: "path_criteria";
      rows: CriterionRow[];
      onConflict: "program_version_id,criterion_id";
    }
  | {
      table: "path_unit_tasks";
      rows: TaskRow[];
      onConflict: "program_version_id,task_id";
    };

/**
 * The four upserts for one version, in FK order (parents before children) so a
 * child never references a not-yet-inserted parent.
 */
export function buildUpsertSteps(rows: ProgramRows): UpsertStep[] {
  return [
    { table: "path_program_versions", rows: [rows.version], onConflict: "id" },
    { table: "path_phases", rows: rows.phases, onConflict: "program_version_id,num" },
    {
      table: "path_criteria",
      rows: rows.criteria,
      onConflict: "program_version_id,criterion_id",
    },
    {
      table: "path_unit_tasks",
      rows: rows.tasks,
      onConflict: "program_version_id,task_id",
    },
  ];
}

/**
 * What the seed EXPECTS to be true in the DB after seeding every registered
 * version — derived from the rows actually built this run, never a literal.
 * A hard-coded total (e.g. 125) silently becomes a false failure the moment a
 * second version is registered.
 */
export type SeedExpectation = {
  versions: number;
  phases: number;
  criteria: number;
  tasks: number;
  /** The one version whose row must carry `is_current = true` (the pin target). */
  currentVersionId: string;
};

/** What the seed OBSERVES in the DB after seeding (from live counts + queries). */
export type SeedObservation = {
  versions: number;
  phases: number;
  criteria: number;
  tasks: number;
  /** Ids of every row where `is_current = true` — must be exactly `[currentVersionId]`. */
  currentVersionIds: string[];
};

/** Build the post-seed expectation from the rows built for each seeded version. */
export function expectationFromRows(
  built: ProgramRows[],
  currentVersionId: string
): SeedExpectation {
  return {
    versions: built.length,
    phases: built.reduce((n, r) => n + r.phases.length, 0),
    criteria: built.reduce((n, r) => n + r.criteria.length, 0),
    tasks: built.reduce((n, r) => n + r.tasks.length, 0),
    currentVersionId,
  };
}

/**
 * Reconcile observed DB state against the expectation. Returns a list of
 * human-readable mismatch messages (empty = all good).
 *
 * This replaces two weak checks the review flagged: a literal `count === 125`
 * (breaks on the second version) and a `criterion_id IS NULL` orphan probe that
 * is vacuous because the column is `NOT NULL` with an FK. Instead it counts the
 * bad condition where a bad condition is actually reachable: a per-table count
 * that disagrees with what was built, and — the load-bearing one — the
 * `is_current` pin, which Unit 6 reads to lock a student to a curriculum version
 * and which `ON CONFLICT DO NOTHING` cannot fix on a re-run once written wrong.
 */
export function checkSeed(
  expected: SeedExpectation,
  observed: SeedObservation
): string[] {
  const errors: string[] = [];
  const countChecks: Array<[string, number, number]> = [
    ["path_program_versions", expected.versions, observed.versions],
    ["path_phases", expected.phases, observed.phases],
    ["path_criteria", expected.criteria, observed.criteria],
    ["path_unit_tasks", expected.tasks, observed.tasks],
  ];
  for (const [table, exp, obs] of countChecks) {
    if (obs !== exp) errors.push(`${table}: expected ${exp} rows, found ${obs}.`);
  }

  const current = observed.currentVersionIds;
  if (current.length !== 1) {
    errors.push(
      `Expected exactly one is_current=true version, found ${current.length}` +
        `${current.length ? ` [${current.join(", ")}]` : ""}. Unit 6 pins new ` +
        `students to this row; zero or many is unrecoverable by a plain re-seed.`
    );
  } else if (current[0] !== expected.currentVersionId) {
    errors.push(
      `is_current pin is "${current[0]}", expected "${expected.currentVersionId}". ` +
        `A wrong pin cannot be corrected by re-running the seed (ON CONFLICT DO NOTHING).`
    );
  }

  return errors;
}
