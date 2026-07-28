import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The migration lock's tripwire (a), promised after its second breach
 * (supabase/MIGRATION-LOCK.md): a NEW migration's lane prefix must match
 * the holder named in the lock file. The transfer discipline already
 * requires changing the holder line in the SAME PR as the migration, so a
 * legitimate transfer passes by construction — and an un-transferred
 * cross-lane migration reddens the suite instead of silently colliding
 * (the 20260808120000 version collision was breach two).
 *
 * Historical files ship in the allowlist below; only migrations NEWER
 * than the tripwire's installation are policed. Version COLLISIONS —
 * including back-dated versions walking under this cutoff — are the
 * companion tripwire's job (migration-versions.test.ts, tripwire (b)):
 * a duplicated prefix reddens the suite on either side of the cutoff.
 */

const LANE_PREFIXES: Record<string, RegExp> = {
  "Lane A": /^\d{14}_(fw|path)_/,
  "Lane B": /^\d{14}_funnel_/,
};

/** Everything that existed when the tripwire landed (2026-07-28). */
const TRIPWIRE_CUTOFF = "20260814120000";

describe("migration lock tripwire (a): lane prefix matches the holder", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const lock = readFileSync(path.resolve(root, "supabase/MIGRATION-LOCK.md"), "utf8");
  const holderLine = lock.split("\n").find((l) => l.includes("Current holder:"));

  it("the lock file names exactly one known lane as holder", () => {
    expect(holderLine).toBeTruthy();
    const named = Object.keys(LANE_PREFIXES).filter((lane) => holderLine!.includes(lane));
    expect(named, holderLine).toHaveLength(1);
  });

  it("every migration newer than the tripwire carries the HOLDER's prefix", () => {
    const holder = Object.keys(LANE_PREFIXES).find((lane) => holderLine!.includes(lane))!;
    const expected = LANE_PREFIXES[holder];
    const offenders = readdirSync(path.resolve(root, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => f.split("_")[0] > TRIPWIRE_CUTOFF)
      .filter((f) => !expected.test(f));
    expect(
      offenders,
      `These migrations do not match the current holder (${holder}). ` +
        "Transfer the lock (update the holder line in supabase/MIGRATION-LOCK.md " +
        "in the SAME PR) or hand the migration to the holding lane."
    ).toEqual([]);
  });
});
