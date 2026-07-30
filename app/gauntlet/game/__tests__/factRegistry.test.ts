import { describe, expect, it } from "vitest";
import { PATHWAY } from "../pathway";
import { GENERATORS, factSetFor } from "../problems";
import {
  canonicalFactBand,
  makeNativeTrialDeck,
  uniqueTrialSources,
} from "../factRegistry";
import { buildCanonicalMasteryBatch } from "../masteryBatch";

describe("canonicalFactBand", () => {
  it("rejects unknown and non-canonical fact keys", () => {
    expect(canonicalFactBand("not-a-topic:anything")).toBeNull();
    expect(canonicalFactBand("mul:999×999")).toBeNull();
    expect(canonicalFactBand("")).toBeNull();
  });

  it("uses the easier band when multiplication inventories overlap", () => {
    expect(factSetFor("mul", "g34")).toContain("mul:3×4");
    expect(factSetFor("mul", "g56")).toContain("mul:3×4");
    expect(canonicalFactBand("mul:3×4")).toBe("g34");
    expect(canonicalFactBand("mul:8×9")).toBe("g56");
  });

  it("round-trips generated pathway facts into server-owned bands", () => {
    for (const skill of PATHWAY) {
      for (let i = 0; i < 8; i++) {
        const fact = GENERATORS[skill.topic](skill.band);
        const canonical = canonicalFactBand(fact.key);
        expect(canonical, `${skill.id}: ${fact.key}`).not.toBeNull();
      }
    }
  });
});

describe("native-band trial and batches", () => {
  it("builds each trial inventory in its authored band", () => {
    const sources = [
      { topic: "mul" as const, band: "g34" as const },
      { topic: "sq" as const, band: "g56" as const },
    ];
    const deck = makeNativeTrialDeck(sources);
    const expected = [
      ...factSetFor("mul", "g34")!,
      ...factSetFor("sq", "g56")!,
    ];
    expect([...deck].sort()).toEqual([...expected].sort());
  });

  it("de-duplicates repeated topic/band sources", () => {
    const source = { topic: "sq" as const, band: "g56" as const };
    expect(uniqueTrialSources([source, source])).toEqual([source]);
  });

  it("ignores caller-selected bands and batches canonical ones per fact", () => {
    const batch = buildCanonicalMasteryBatch(
      ["mul:3×4", "mul:8×9", "not-a-topic:anything", "mul:3×4"],
      "11111111-2222-3333-4444-555555555555"
    );
    expect(batch.facts).toEqual([
      { fact_key: "mul:3×4", band: "g34" },
      { fact_key: "mul:8×9", band: "g56" },
    ]);
  });
});
