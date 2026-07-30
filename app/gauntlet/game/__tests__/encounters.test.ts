import { describe, expect, it } from "vitest";
import { encounterKind, nextRaidBeat } from "../encounters";

describe("encounter classification", () => {
  it("keeps recall in quickfire and formula/visual work in Armor Break", () => {
    expect(encounterKind("mul")).toBe("quickfire");
    expect(encounterKind("dist")).toBe("puzzle");
    expect(encounterKind("sqrtbig")).toBe("puzzle");
    expect(encounterKind("congruence")).toBe("puzzle");
  });
});

describe("raid director", () => {
  it("opens with a burst, injects a puzzle, recovers after misses, and finishes fast", () => {
    expect(nextRaidBeat({ answered: 0, wrongStreak: 0, bossRatio: 1, hasPuzzle: false })).toBe("warmup");
    expect(nextRaidBeat({ answered: 4, wrongStreak: 0, bossRatio: 0.8, hasPuzzle: true })).toBe("puzzle");
    expect(nextRaidBeat({ answered: 5, wrongStreak: 1, bossRatio: 0.6, hasPuzzle: true })).toBe("recovery");
    expect(nextRaidBeat({ answered: 8, wrongStreak: 0, bossRatio: 0.2, hasPuzzle: true })).toBe("finisher");
  });
});
