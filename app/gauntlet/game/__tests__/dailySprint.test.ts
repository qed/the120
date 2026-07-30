import { describe, expect, it } from "vitest";
import {
  dailySprintKeys,
  dailySprintProblem,
  nearbyTarget,
  officialSprintElapsed,
  sprintBracketForGrade,
  sprintScore,
  type SprintBoardRow,
} from "../dailySprint";

describe("daily sprint", () => {
  it("builds the same 20-key deck for a date and band", () => {
    const a = dailySprintKeys("2026-07-28", "g56");
    const b = dailySprintKeys("2026-07-28", "g56");
    expect(a).toEqual(b);
    expect(a).toHaveLength(20);
    expect(new Set(a).size).toBe(20);
  });

  it.each(["g34", "g56", "g78", "g910", "g11", "g12"] as const)(
    "has a full quickfire deck for %s",
    (band) => {
      expect(dailySprintKeys("2026-07-28", band)).toHaveLength(20);
    }
  );

  it("keeps upper-grade players in curriculum-sized brackets", () => {
    expect(sprintBracketForGrade(9)).toBe("g910");
    expect(sprintBracketForGrade(10)).toBe("g910");
    expect(sprintBracketForGrade(11)).toBe("g11");
    expect(sprintBracketForGrade(12)).toBe("g12");
  });

  it("keeps calculus out of the Grades 9–10 Sprint", () => {
    const topics = dailySprintKeys("2026-07-28", "g910").map(
      (key) => key.split(":")[0]
    );
    expect(topics).not.toContain("dstd");
    expect(topics).not.toContain("dpower");
    expect(topics).not.toContain("triglim");
  });

  it("changes its deck across days", () => {
    expect(dailySprintKeys("2026-07-28", "g78")).not.toEqual(
      dailySprintKeys("2026-07-29", "g78")
    );
  });

  it("keeps pre-official guest practice off today's exact deck", () => {
    const official = dailySprintKeys("2026-07-28", "g56");
    const guestPractice = dailySprintKeys(
      "2026-07-28:guest-practice:1234",
      "g56"
    );
    expect(guestPractice).toHaveLength(20);
    expect(guestPractice).not.toEqual(official);
  });

  it("uses reservation wall time and gives incomplete runs the full minute", () => {
    expect(officialSprintElapsed(1_000, 10_000, 28_000, true)).toBe(18_000);
    expect(officialSprintElapsed(22_000, 10_000, 28_000, true)).toBe(22_000);
    expect(officialSprintElapsed(4_000, 10_000, 15_000, false)).toBe(60_000);
    expect(officialSprintElapsed(4_000, 10_000, 90_000, true)).toBe(60_000);
  });

  it("canonicalizes prompt and choice order for every player", () => {
    const problemA = dailySprintProblem("mul:7×8");
    const problemB = dailySprintProblem("mul:7×8");
    expect(problemA).toEqual(problemB);
    expect(problemA?.prompt).toBe("7×8");
  });

  it("scores accuracy first and finds the nearest player ahead", () => {
    expect(sprintScore(12, 0, 60_000)).toBeGreaterThan(sprintScore(11, 0, 1_000));
    const rows = [
      { score: 900, rank: 1 },
      { score: 700, rank: 2 },
      { score: 500, rank: 3 },
    ].map((row) => ({
      ...row,
      handle: `R${row.rank}`,
      date: "2026-07-28",
      band: "g34",
      correct: 1,
      wrong: 0,
      elapsedMs: 1,
    })) as SprintBoardRow[];
    expect(nearbyTarget(rows, 650)?.handle).toBe("R2");
  });
});
