/**
 * Program manifests and the version registry (T1 Unit 3).
 *
 * Two jobs:
 *
 *  1. Declare each program version's totals, and assert a parse against them.
 *     Totals live in a per-version manifest rather than as constants in code,
 *     so a curriculum revision ships a new manifest and a new generated module
 *     — not a validator edit.
 *
 *  2. Resolve a version id to its content. NOTHING imports a generated module
 *     directly: students are pinned to a program version (D27), so once a
 *     second version exists a hard-coded `import … from "./generated/program-
 *     2026-27"` would quietly serve the wrong content to a pinned student.
 *     Old modules are permanent fixtures — never deleted, never regenerated in
 *     place — because a pinned student still reads theirs.
 */

import type { DeepReadonly, ProgramContent, ProgramManifest } from "./types";

/**
 * Criteria that end on a live audience. A fixed list of four, per the app
 * design brief — derivable, so never parsed. Drives the "Live moment" badge on
 * the task card and, in T3, PathEvent linkage.
 */
export const STAGE_MOMENT_CRITERIA: readonly string[] = [
  "2.5",
  "3.4",
  "4.5",
  "5.5",
];

export function isStageMoment(criterionId: string): boolean {
  return STAGE_MOMENT_CRITERIA.includes(criterionId);
}

export const MANIFEST_2026_27: ProgramManifest = {
  versionId: "2026-27",
  label: "The Path 1.0 — 2026-27",
  phases: 5,
  criteria: 25,
  tasks: 125,
  // Not uniform: Build carries an extra task, Validate one fewer.
  tasksPerPhase: [25, 26, 24, 25, 25],
};

export const MANIFESTS: readonly ProgramManifest[] = [MANIFEST_2026_27];

export function manifestFor(versionId: string): ProgramManifest {
  const m = MANIFESTS.find((x) => x.versionId === versionId);
  if (!m) {
    throw new Error(
      `Unknown program version "${versionId}". Known: ${MANIFESTS.map(
        (x) => x.versionId
      ).join(", ")}. A student pinned to an unknown version must fail loudly, ` +
        `never fall back to "latest" — that is how a content revision silently ` +
        `rewrites a child's remaining tasks.`
    );
  }
  return m;
}

/**
 * Assert parsed content against its manifest. Throws with the specific
 * mismatch — a silently short package is the failure mode that matters, and it
 * is invisible at runtime.
 */
export function assertMatchesManifest(
  content: ProgramContent,
  manifest: ProgramManifest = manifestFor(content.versionId)
): void {
  const where = `program ${content.versionId}`;

  if (content.phases.length !== manifest.phases) {
    throw new Error(
      `${where}: expected ${manifest.phases} phases, parsed ${content.phases.length}.`
    );
  }

  const criteria = content.phases.flatMap((p) => p.criteria);
  if (criteria.length !== manifest.criteria) {
    throw new Error(
      `${where}: expected ${manifest.criteria} criteria, parsed ${criteria.length}.`
    );
  }

  const tasks = criteria.flatMap((c) => c.tasks);
  if (tasks.length !== manifest.tasks) {
    throw new Error(
      `${where}: expected ${manifest.tasks} tasks, parsed ${tasks.length}.`
    );
  }

  const perPhase = content.phases.map((p) =>
    p.criteria.reduce((n, c) => n + c.tasks.length, 0)
  );
  const expected = manifest.tasksPerPhase;
  if (perPhase.length !== expected.length ||
      perPhase.some((n, i) => n !== expected[i])) {
    throw new Error(
      `${where}: per-phase task counts ${perPhase.join("/")} do not match the ` +
        `manifest's ${expected.join("/")}. A total-only check would have passed ` +
        `this — tasks per criterion is variable (2.3 has six, 3.4 has four).`
    );
  }

  /*
   * Field-level checks. Cardinality alone is not enough: a parse where the
   * final task of the program was flagged incomplete, and shipped raw markdown
   * inside its Done-when line, passed every count above. Counts prove the
   * package is the right SIZE, not that it says the right THING.
   */

  for (const criterion of criteria) {
    const closers = criterion.tasks.filter((t) => t.completesCriterion);
    if (closers.length !== 1) {
      throw new Error(
        `${where}: criterion ${criterion.id} has ${closers.length} tasks marked ` +
          `completesCriterion; exactly one must close each criterion. ` +
          `${closers.length === 0
            ? "A closing marker whose wording differs from the others will not match."
            : `Marked: ${closers.map((t) => t.id).join(", ")}.`}`
      );
    }
  }

  for (const task of tasks) {
    if (/\*\*/.test(task.doneWhen)) {
      throw new Error(
        `${where}: task ${task.id}'s Done-when line still contains markdown ` +
          `bold markers: "${task.doneWhen}". This is the line a verifying adult ` +
          `reads and answers yes or no to — it must be prose, not source.`
      );
    }
    if (!task.doneWhen.trim() || !task.title.trim() || !task.body.trim()) {
      throw new Error(
        `${where}: task ${task.id} has an empty title, body, or Done-when line.`
      );
    }
  }
}

/* ── version registry ──────────────────────────────────────────────────── */

type ProgramLoader = () => ProgramContent;

const REGISTRY = new Map<string, ProgramLoader>();

/**
 * Register a version's content. The generated module calls this on import;
 * `scripts/build-path-content.ts` writes the module that does so.
 */
export function registerProgram(content: ProgramContent): void {
  REGISTRY.set(content.versionId, () => content);
}

/**
 * Resolve a version id to its content.
 *
 * Callers pass the STUDENT'S PINNED version (D27), never a "current" global.
 * An unknown id throws rather than falling back.
 *
 * Returns `DeepReadonly` — the registry hands back a shared reference, so the
 * type stops a consumer mutating the one curriculum object every student on
 * this version reads from.
 */
export function getProgram(versionId: string): DeepReadonly<ProgramContent> {
  const loader = REGISTRY.get(versionId);
  if (!loader) {
    throw new Error(
      `Program version "${versionId}" is not registered. Registered: ` +
        `${[...REGISTRY.keys()].join(", ") || "(none)"}. Import the generated ` +
        `module for this version before resolving it.`
    );
  }
  return loader();
}

export function registeredVersions(): string[] {
  return [...REGISTRY.keys()];
}
