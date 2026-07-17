import { describe, it, expect } from "vitest";
import { newlyMasteredKeys, buildMasteryBatch } from "../masteryBatch";
import { MASTERY_REPS, type FactStat } from "../mastery";

/** Concise FactStat with a given fastStreak (mastered when >= MASTERY_REPS). */
const stat = (fastStreak: number): FactStat => ({
  n: fastStreak,
  miss: 0,
  avgMs: 1000,
  fastStreak,
});

const MASTERED = stat(MASTERY_REPS); // crosses the threshold
const UNMASTERED = stat(MASTERY_REPS - 1); // one short

describe("newlyMasteredKeys", () => {
  it("includes a fact that went un-mastered → mastered", () => {
    const before = { a: UNMASTERED };
    const after = { a: MASTERED };
    expect(newlyMasteredKeys(before, after)).toEqual(["a"]);
  });

  it("includes a fact absent from `before` that is mastered in `after`", () => {
    expect(newlyMasteredKeys({}, { fresh: MASTERED })).toEqual(["fresh"]);
  });

  it("excludes a fact already mastered before the run", () => {
    const before = { a: MASTERED };
    const after = { a: MASTERED };
    expect(newlyMasteredKeys(before, after)).toEqual([]);
  });

  it("excludes a fact still un-mastered after the run", () => {
    const before = { a: UNMASTERED };
    const after = { a: UNMASTERED };
    expect(newlyMasteredKeys(before, after)).toEqual([]);
  });

  it("returns only the newly-crossed keys from a mixed state", () => {
    const before = {
      newly: UNMASTERED, // → mastered
      already: MASTERED, // stays mastered
      stuck: UNMASTERED, // stays un-mastered
    };
    const after = {
      newly: MASTERED,
      already: MASTERED,
      stuck: UNMASTERED,
      brandNew: MASTERED, // not in `before`
    };
    expect(newlyMasteredKeys(before, after).sort()).toEqual(["brandNew", "newly"]);
  });
});

describe("buildMasteryBatch", () => {
  it("produces the { batch_id, facts } shape with the injected id", () => {
    const batch = buildMasteryBatch(["a", "b"], "g78", "11111111-2222-3333-4444-555555555555");
    expect(batch).toEqual({
      batch_id: "11111111-2222-3333-4444-555555555555",
      facts: [
        { fact_key: "a", band: "g78" },
        { fact_key: "b", band: "g78" },
      ],
    });
  });

  it("attaches the run's band to every fact", () => {
    const batch = buildMasteryBatch(["x", "y", "z"], "g912", "batch-id");
    expect(batch.facts).toHaveLength(3);
    for (const f of batch.facts) {
      expect(f.band).toBe("g912");
    }
  });

  it("builds an empty facts array when nothing was mastered", () => {
    const batch = buildMasteryBatch([], "g34", "batch-id");
    expect(batch.facts).toEqual([]);
    expect(batch.batch_id).toBe("batch-id");
  });

  it("carries keys diffed straight from newlyMasteredKeys", () => {
    const keys = newlyMasteredKeys({ a: UNMASTERED }, { a: MASTERED, b: MASTERED });
    const batch = buildMasteryBatch(keys, "g56", "batch-id");
    expect(batch.facts.map((f) => f.fact_key).sort()).toEqual(["a", "b"]);
    expect(batch.facts.every((f) => f.band === "g56")).toBe(true);
  });
});
