import { describe, expect, it } from "vitest";
import vitestConfig from "@/vitest.config";

/**
 * Guards the vitest `include` allowlist from OUTSIDE the directories it grants.
 *
 * `include` is an explicit allowlist, so a test directory that falls out of it
 * stops running silently while the suite stays green — a recorded incident
 * (docs/solutions/test-failures/vitest-include-allowlist-new-test-dirs-silently
 * -never-run-2026-07-18.md).
 *
 * Two design constraints, both learned the hard way:
 *
 *  1. This file lives under `app/lib/**`, granted by a different entry, so it
 *     keeps running if the `app/path` glob is dropped. A guard inside
 *     `app/path/**` could not catch its own removal — it would go silent
 *     alongside the tests it was meant to protect.
 *
 *  2. It asserts against the RESOLVED `test.include` array, not the raw file
 *     text. A substring check would pass on a glob that had been commented out
 *     — the most likely way someone disables a directory — which is precisely
 *     the silent-drop this guard exists to prevent.
 */

const include = (vitestConfig as { test?: { include?: string[] } }).test?.include;

/** Every directory that owns tests must be granted by its own `include` entry. */
const REQUIRED_GLOBS = [
  "app/2026-27/**/__tests__/**/*.test.{ts,tsx}",
  "app/crm/__tests__/**/*.test.{ts,tsx}",
  "app/dashboard/__tests__/**/*.test.{ts,tsx}",
  "app/lib/**/__tests__/**/*.test.{ts,tsx}",
  "app/gauntlet/**/__tests__/**/*.test.{ts,tsx}",
  "app/api/**/__tests__/**/*.test.{ts,tsx}",
  "app/path/**/__tests__/**/*.test.{ts,tsx}",
];

describe("vitest include allowlist", () => {
  it("exposes a resolvable include array — the guard must not silently no-op", () => {
    // If the config shape ever changes, fail loudly here rather than letting
    // every assertion below pass vacuously against `undefined`.
    expect(Array.isArray(include)).toBe(true);
  });

  it.each(REQUIRED_GLOBS)("still grants %s", (glob) => {
    expect(include).toContain(glob);
  });

  it("grants the Path tree — removing it would silence the engine's whole suite", () => {
    // Called out separately because The Path's pure rule modules (the state
    // machine, access verdicts, sync reconciliation) are the only parts of that
    // feature this repo can defend at all — no jsdom, no component tests.
    expect(include).toContain("app/path/**/__tests__/**/*.test.{ts,tsx}");
  });
});
