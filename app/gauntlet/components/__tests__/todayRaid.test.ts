import { describe, expect, it } from "vitest";
import { PATHWAY, skillGrade } from "../../game/pathway";
import { factSetFor } from "../../game/problems";
import type { FactStat } from "../../game/mastery";
import { todayRaidSkillIndex } from "../../GauntletGame";

describe("Today's Raid selector", () => {
  it("prioritizes the weakest skill in the latest earned grade", () => {
    const facts: Record<string, FactStat> = {};
    for (const skill of PATHWAY.filter((candidate) => skillGrade(candidate.id) === 3)) {
      if (skill.id === "div-facts") continue;
      for (const key of factSetFor(skill.topic, skill.band) ?? []) {
        facts[key] = { n: 2, miss: 0, avgMs: 1_500, fastStreak: 2 };
      }
    }

    const index = todayRaidSkillIndex([3], "2026-08-02", facts);
    expect(PATHWAY[index].id).toBe("div-facts");
  });
});
