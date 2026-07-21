import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCurriculum } from "@/app/path/content/parse-curriculum";
import { assertMatchesManifest } from "@/app/path/content/manifest";
import PROGRAM from "@/app/path/content/generated/program-2026-27";

/**
 * The committed generated module and the parser can drift: someone edits the
 * curriculum and forgets to re-run `scripts/build-path-content.ts`, or someone
 * hand-edits the generated file. `build-path-content.ts` is not wired into a
 * pretest hook, so this test is the gate — it re-parses the source in-process
 * and compares.
 *
 * If this fails, run `npx tsx scripts/build-path-content.ts` and commit the
 * result (only if the curriculum genuinely changed and no student is yet
 * pinned to this version — a pinned version's module is permanent, D27).
 */
describe("generated module tracks the parser", () => {
  const source = readFileSync(
    path.resolve(
      process.cwd(),
      "artifacts/The Path/the-path-home-study-curriculum-brief.md"
    ),
    "utf8"
  );
  const fresh = parseCurriculum(source, "2026-27");

  it("matches a fresh parse of the source byte-for-byte", () => {
    expect(JSON.stringify(PROGRAM)).toBe(JSON.stringify(fresh));
  });

  it("the committed module passes the full field-level manifest check", () => {
    // Not just counts — one closer per criterion, no markdown in Done-when.
    expect(() => assertMatchesManifest(PROGRAM)).not.toThrow();
  });
});
