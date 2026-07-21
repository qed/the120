/**
 * Generate the committed content module for a program version (T1 Unit 3).
 *
 *   npx tsx scripts/build-path-content.ts
 *
 * Parses the curriculum brief, asserts it against the version's manifest, and
 * writes `app/path/content/generated/program-<version>.ts`.
 *
 * Why a committed generated module rather than parsing at runtime, or seeding
 * prose into Postgres:
 *   - Curriculum prose never enters SQL, so the recorded em-dash-flattening
 *     drift (a later UPDATE keyed on seed text matching zero rows) cannot recur.
 *   - The content is diffable in git, so a curriculum edit shows up in review.
 *   - No DB round-trip to render a task.
 *
 * Old generated modules are PERMANENT. Students are pinned to a version (D27);
 * regenerating a published version in place would rewrite a child's remaining
 * tasks mid-year.
 *
 * This script runs under `tsx`, which is why nothing it imports may sit behind
 * `import "server-only"` — that throws outside Next's bundler, transitively.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseCurriculum } from "../app/path/content/parse-curriculum";
import { assertMatchesManifest, manifestFor } from "../app/path/content/manifest";

const VERSION_ID = process.argv[2] ?? "2026-27";

const SOURCE_PATH = path.resolve(
  process.cwd(),
  "artifacts/The Path/the-path-home-study-curriculum-brief.md"
);

const OUT_DIR = path.resolve(process.cwd(), "app/path/content/generated");
const OUT_PATH = path.join(OUT_DIR, `program-${VERSION_ID}.ts`);

function main() {
  const manifest = manifestFor(VERSION_ID);

  let source: string;
  try {
    source = readFileSync(SOURCE_PATH, "utf8");
  } catch {
    console.error(
      `[build-path-content] cannot read ${SOURCE_PATH}\n` +
        `The curriculum brief is the parser's only input and must be a tracked ` +
        `file — otherwise this build works on one machine and nowhere else.`
    );
    process.exit(1);
  }

  const content = parseCurriculum(source, VERSION_ID);
  assertMatchesManifest(content, manifest);

  const tasks = content.phases.flatMap((p) =>
    p.criteria.flatMap((c) => c.tasks)
  );

  const banner = `/**
 * GENERATED — do not edit by hand.
 *
 * Source: artifacts/The Path/the-path-home-study-curriculum-brief.md
 * Built by: scripts/build-path-content.ts
 * Version: ${VERSION_ID} (${manifest.label})
 * Totals: ${manifest.phases} phases, ${manifest.criteria} criteria, ${manifest.tasks} tasks (${manifest.tasksPerPhase.join("/")})
 *
 * This module is PERMANENT once a student is pinned to this version (D27).
 * A curriculum revision ships a NEW version and a NEW module beside this one —
 * it never regenerates this file, because a pinned student still reads it.
 */`;

  const body = `${banner}

import { registerProgram } from "../manifest";
import type { ProgramContent } from "../types";

export const PROGRAM_${VERSION_ID.replace(/-/g, "_")}: ProgramContent = ${JSON.stringify(
    content,
    null,
    2
  )} as const;

registerProgram(PROGRAM_${VERSION_ID.replace(/-/g, "_")});

export default PROGRAM_${VERSION_ID.replace(/-/g, "_")};
`;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, body, "utf8");

  console.log(
    `[build-path-content] wrote ${path.relative(process.cwd(), OUT_PATH)}\n` +
      `  ${content.phases.length} phases · ${content.phases.flatMap((p) => p.criteria).length} criteria · ${tasks.length} tasks\n` +
      `  per phase: ${content.phases
        .map((p) => p.criteria.reduce((n, c) => n + c.tasks.length, 0))
        .join("/")}`
  );
}

main();
