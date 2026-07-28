import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { glob } from "tinyglobby";

/**
 * The retired FW task route's straggler catcher (ops-guide redesign Unit 8;
 * R21) — per the 2026-07-24 route-retirement playbook: a boundary-regex sweep
 * with a COUNT-BOUNDED allowlist, plus a non-vacuity check on the detector.
 *
 * Unit 8 turned `/fp/fw/cohort/[cohortId]/student/[studentId]/task/[taskId]`
 * into a server redirect. The route FILE legitimately survives (it IS the
 * redirect — SW shells keep serving old URLs, so it must never 404), but no
 * production source may still BUILD an href into it: a surviving builder means
 * some surface still sends guides to a page that bounces them straight back,
 * and — worse — reads as the capture surface Unit 9 replaced.
 *
 * The detector matches the two shapes a builder can take: the template form
 * (`…student/${id}/task…`) and a literal URL (`…/student/<seg>/task…`).
 * Comments are stripped before scanning (the playbook's aftermath: prose about
 * the retired route must not trip the scanner — fix the scan, never the
 * comment). Tests are excluded; fixtures that NAME old URLs (fw-sync-rules'
 * isFwAppShellPath cases) are legitimate regression pins, not stragglers.
 */

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
/** `app/fp/lib/__tests__/` → the repo root. Four levels up, from THIS file. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", `file://${TEST_DIR}`));

/** Same comment-strip as sw-discipline.test.ts, same reason. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const BUILDER_PATTERNS = [
  // Template builder: `student/${studentId}/task` (any expression in the hole).
  /student\/\$\{[^}]+\}\/task\b/,
  // Literal URL segment: `/student/<something>/task`.
  /\/student\/[\w.%-]+\/task\b/,
];

const buildsRetiredRoute = (code: string) => BUILDER_PATTERNS.some((p) => p.test(code));

/**
 * COUNT-BOUNDED allowlist (playbook rule 1) — currently EMPTY: after the Unit 8
 * sweep, zero production sources build the retired route. Entries added later
 * must carry an exact `count`, and the freshness assertion below reddens on a
 * dead entry in either direction.
 */
const ALLOWLIST: { file: string; literal: string; count: number }[] = [];

describe("no production source builds an href into the retired FW task route (Unit 8)", () => {
  it("the sweep finds zero stragglers outside the count-bounded allowlist", async () => {
    const files = await glob(["app/**/*.ts", "app/**/*.tsx", "public/**/*.js"], {
      cwd: REPO_ROOT,
      absolute: false,
      dot: false,
      ignore: ["**/__tests__/**"],
    });
    // An empty expansion would make every assertion below pass vacuously.
    expect(files.length).toBeGreaterThan(0);

    const stragglers: string[] = [];
    for (const raw of files) {
      const file = raw.replace(/\\/g, "/");
      let code = stripComments(readFileSync(`${REPO_ROOT}${raw}`, "utf8"));
      // Consume the per-file budget: strip at most `count` occurrences of each
      // allowlisted literal, so a reused literal beyond its cap still reddens.
      for (const a of ALLOWLIST) {
        if (a.file !== file) continue;
        let remaining = a.count;
        while (remaining > 0 && code.includes(a.literal)) {
          code = code.replace(a.literal, "");
          remaining -= 1;
        }
      }
      if (buildsRetiredRoute(code)) stragglers.push(file);
    }
    expect(stragglers).toEqual([]);
  });

  it("allowlist freshness — every entry names exactly its counted occurrences", () => {
    for (const a of ALLOWLIST) {
      const occurrences =
        readFileSync(`${REPO_ROOT}${a.file}`, "utf8").split(a.literal).length - 1;
      expect(occurrences, `${a.file} :: ${a.literal}`).toBe(a.count);
    }
  });

  it("the detector is not vacuous — it fires on both builder shapes it claims to catch", () => {
    // The exact shape the retired page's tree used (taskHrefPrefix + template).
    expect(
      buildsRetiredRoute("`/fp/fw/cohort/${cohortId}/student/${studentId}/task`")
    ).toBe(true);
    expect(buildsRetiredRoute('href={`${prefix}/student/${s.id}/task/${t.id}`}')).toBe(true);
    expect(buildsRetiredRoute('"/fp/fw/cohort/abc/student/xyz/task/1.2.4"')).toBe(true);
    // …and NOT on the student page itself, the Path's own /fp/task route, or the
    // redirect this unit added.
    expect(buildsRetiredRoute("`/fp/fw/cohort/${cohortId}/student/${studentId}`")).toBe(false);
    expect(buildsRetiredRoute("`/fp/task/${taskId}`")).toBe(false);
    expect(
      buildsRetiredRoute("`/fp/fw/cohort/${cohortId}/student/${studentId}${phase ? `?phase=${phase}` : \"\"}`")
    ).toBe(false);
  });
});
