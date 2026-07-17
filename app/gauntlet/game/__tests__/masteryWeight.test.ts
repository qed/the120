import { describe, it, expect } from "vitest";
import { bandMasteryWeight, BAND_MASTERY_WEIGHT } from "../masteryWeight";
import { BANDS } from "../problems";

describe("bandMasteryWeight", () => {
  it("is strictly monotonic across g34 < g56 < g78 < g912", () => {
    expect(bandMasteryWeight("g34")).toBeLessThan(bandMasteryWeight("g56"));
    expect(bandMasteryWeight("g56")).toBeLessThan(bandMasteryWeight("g78"));
    expect(bandMasteryWeight("g78")).toBeLessThan(bandMasteryWeight("g912"));
  });

  it("returns a positive weight for every declared band", () => {
    for (const { id } of BANDS) {
      expect(bandMasteryWeight(id)).toBeGreaterThan(0);
      expect(bandMasteryWeight(id)).toBe(BAND_MASTERY_WEIGHT[id]);
    }
  });
});
