import { describe, it, expect } from "vitest";
import { prizeBandLabel, factsMasteredLabel } from "../FoundingBoard";
import { PRIZE_BANDS } from "@/app/lib/tournament";

describe("prizeBandLabel", () => {
  it("returns the human label for every declared prize band", () => {
    for (const { id, label } of PRIZE_BANDS) {
      expect(prizeBandLabel(id)).toBe(label);
    }
  });

  it("falls back to the raw id for an unknown band", () => {
    expect(prizeBandLabel("nope")).toBe("nope");
  });
});

describe("factsMasteredLabel", () => {
  it("is singular for exactly one fact", () => {
    expect(factsMasteredLabel(1)).toBe("1 fact mastered");
  });

  it("is plural for zero and many facts", () => {
    expect(factsMasteredLabel(0)).toBe("0 facts mastered");
    expect(factsMasteredLabel(12)).toBe("12 facts mastered");
  });
});
