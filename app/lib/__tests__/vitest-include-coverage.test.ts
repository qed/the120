import { describe, expect, it } from "vitest";
import { glob } from "tinyglobby";
import vitestConfig from "@/vitest.config";

/**
 * The allowlist tripwire (docs/solutions/test-failures/
 * vitest-include-allowlist-new-test-dirs-silently-never-run-2026-07-18.md).
 *
 * `vitest.config.ts`'s `include` is an ALLOWLIST, not a discovery rule. A test
 * file under a directory nobody added a glob for is never collected — and the
 * failure mode is the worst one available: `npm run test` stays GREEN, the
 * suite count goes up by zero, and the untested code reads as tested.
 *
 * The obvious mitigation — "put a canary test in the new directory" — cannot
 * work, because a canary in an uncollected directory is itself uncollected. It
 * cannot report its own absence. So the tripwire has to live somewhere already
 * covered, and it has to ask the question globally rather than per-directory.
 * `app/lib/**` has been on the allowlist since before this file existed.
 *
 * Written for Staff Front Door Unit 2, which added `app/staff/**`. That unit's
 * plan named "a new app/staff test never runs" as a risk whose mitigation was
 * "remember to add the glob in the same commit". This is that mitigation with
 * the remembering taken out.
 */

/** Where a `*.test.ts` file may live. Anything outside these is not a test. */
const SEARCH_ROOTS = ["app", "scripts", "supabase"];

/**
 * Expanded with `tinyglobby` — the same engine Vitest uses to expand `include`
 * — rather than a hand-rolled glob→RegExp converter, which would be a parallel
 * matcher that agrees with Vitest right up until it doesn't. If the dependency
 * ever moves, this file fails to import: loudly red, never silently green.
 */
const expand = (patterns: string[]) =>
  glob(patterns, { cwd: process.cwd(), absolute: false, dot: false });

describe("vitest.config include allowlist", () => {
  it("collects every test file in the repo", async () => {
    const include = vitestConfig.test?.include;
    // If `include` is ever dropped, Vitest falls back to its own defaults and
    // this test would silently start asserting nothing.
    expect(Array.isArray(include)).toBe(true);

    const [collected, everything] = await Promise.all([
      expand(include as string[]),
      expand(SEARCH_ROOTS.map((r) => `${r}/**/*.test.{ts,tsx}`)),
    ]);

    const collectedSet = new Set(collected);
    const orphans = everything.filter((f) => !collectedSet.has(f)).sort();

    // Named in the failure so the fix is obvious: add the directory's glob to
    // vitest.config.ts. The count is asserted too, because an empty `orphans`
    // is also what a broken expansion returns.
    expect(orphans).toEqual([]);
    expect(everything.length).toBeGreaterThan(0);
    expect(collected.length).toBeGreaterThanOrEqual(everything.length);
  });

  it("covers app/staff — the directory Unit 2 added (R1, R5a, R6)", async () => {
    // Pinned by name as well as by the sweep above: the sweep only reddens once
    // a test file EXISTS in an uncovered directory, so it cannot stop someone
    // deleting the glob while `app/staff` happens to be empty, and the next
    // person to add a staff test would inherit a silent green.
    const include = (vitestConfig.test?.include ?? []) as string[];
    expect(include.some((g) => g.startsWith("app/staff/"))).toBe(true);
  });
});
