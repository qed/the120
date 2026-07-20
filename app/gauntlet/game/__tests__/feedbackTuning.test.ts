import { describe, it, expect } from "vitest";
import { masteryMsFor, nextProblem, factSetFor } from "../problems";
import {
  currentSkillIdx,
  isUnlocked,
  PASS_LEVEL,
  PATHWAY,
  placementProgress,
  unlockedTopics,
  type SkillProgress,
} from "../pathway";

/**
 * Tester-feedback tuning (2026-07-18): per-topic mastery windows, and repeat
 * suppression on small fact sets.
 */

describe("masteryMsFor", () => {
  it("number facts keep the 3s bar", () => {
    expect(masteryMsFor("mul")).toBe(3000);
    expect(masteryMsFor("add")).toBe(3000);
    expect(masteryMsFor("trigval")).toBe(3000); // tap recall
  });
  it("later-grade skills get the Medium band (6s)", () => {
    expect(masteryMsFor("dpoint")).toBe(6000);
    expect(masteryMsFor("lcm")).toBe(6000);
    expect(masteryMsFor("denom")).toBe(6000);
    expect(masteryMsFor("critpt")).toBe(6000);
  });
  it("doc-rated upper-Medium / figure-scan topics get 9s", () => {
    // distance: "Medium's ceiling, 5–8s"; congruence: figure-reading counts
    // as thinking time (the doc's own calibration anchor)
    expect(masteryMsFor("dist")).toBe(9000);
    expect(masteryMsFor("congruence")).toBe(9000);
    expect(masteryMsFor("defint")).toBe(9000);
    expect(masteryMsFor("dsecond")).toBe(9000);
    expect(masteryMsFor("veloc")).toBe(9000);
    expect(masteryMsFor("logrule")).toBe(9000);
  });
  it("doc-Medium mental-compute topics are NOT on the 3s recall bar", () => {
    // Grade 12s were failing placement at 2-digit×1-digit because 47×8 in 6s
    // (incl. typing) was being treated as fact recall
    expect(masteryMsFor("mul2x1")).toBe(6000);
    expect(masteryMsFor("fracof")).toBe(6000);
    expect(masteryMsFor("sqrtbig")).toBe(6000);
  });
  it("Enter-entry formats add typing time", () => {
    expect(masteryMsFor("fracadd")).toBe(8500); // 6000 + 2500
    expect(masteryMsFor("factquad")).toBe(8500);
    expect(masteryMsFor("dpower")).toBe(5500); // tier-1 recall + typed entry
  });
});

describe("repeat suppression", () => {
  it("never serves the same fact back-to-back, even on tiny sets (cube: 5 facts)", () => {
    const recent: string[] = [];
    let backToBack = 0;
    for (let i = 0; i < 200; i++) {
      const p = nextProblem(["cube"], "g78", {}, recent);
      if (recent.length && recent[recent.length - 1] === p.key) backToBack++;
      recent.push(p.key);
    }
    expect(backToBack).toBe(0);
  });

  it("spreads serves across a small set instead of hammering a few", () => {
    const set = factSetFor("cube", "g78")!;
    const recent: string[] = [];
    const counts = new Map<string, number>();
    for (let i = 0; i < 250; i++) {
      const p = nextProblem(["cube"], "g78", {}, recent);
      counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
      recent.push(p.key);
    }
    // every fact gets served, and no fact dominates
    expect(counts.size).toBe(set.length);
    const max = Math.max(...counts.values());
    expect(max).toBeLessThan(250 * 0.4);
  });

  it("frontier unlock: a gap behind the frontier stays open, doesn't lock the road", () => {
    // Grade 12 places past everything up to algebra EXCEPT 2×1-digit (idx of mul-2x1)
    const gapIdx = PATHWAY.findIndex((s) => s.id === "mul-2x1");
    const frontierIdx = PATHWAY.findIndex((s) => s.id === "linear-fn");
    const passed = Array.from({ length: frontierIdx + 1 }, (_, i) => i).filter((i) => i !== gapIdx);
    const progress: SkillProgress = placementProgress(passed);

    // the gap itself is unlocked (playable), not a prison
    expect(isUnlocked(progress, gapIdx)).toBe(true);
    // the skill after the gap is unlocked via its passed predecessor's pass
    expect(isUnlocked(progress, gapIdx + 1)).toBe(true);
    // one past the frontier is open; two past is not
    expect(isUnlocked(progress, frontierIdx + 1)).toBe(true);
    expect(isUnlocked(progress, frontierIdx + 2)).toBe(false);
    // CONTINUE points at the gap first — hole-filling
    expect(currentSkillIdx(progress)).toBe(gapIdx);
    // the trial still tests everything reached, gap included
    const topics = unlockedTopics(progress);
    expect(topics).toContain(PATHWAY[gapIdx].topic);
    expect(topics).toContain(PATHWAY[frontierIdx].topic);
  });

  it("placementProgress credits exactly the passed skills", () => {
    const progress = placementProgress([0, 1, 3]);
    expect(progress[PATHWAY[0].id]).toBe(PASS_LEVEL);
    expect(progress[PATHWAY[1].id]).toBe(PASS_LEVEL);
    expect(progress[PATHWAY[2].id]).toBeUndefined(); // the gap
    expect(progress[PATHWAY[3].id]).toBe(PASS_LEVEL);
  });

  it("eases focus when only a few facts remain unmastered (mixes mastered back in)", () => {
    const set = factSetFor("sq", "g56")!; // 14 facts
    // master all but two
    const facts: Record<string, { n: number; miss: number; avgMs: number; fastStreak: number }> = {};
    for (const k of set.slice(0, set.length - 2)) {
      facts[k] = { n: 5, miss: 0, avgMs: 1500, fastStreak: 3 };
    }
    const recent: string[] = [];
    let unmasteredServes = 0;
    for (let i = 0; i < 300; i++) {
      const p = nextProblem(["sq"], "g56", facts, recent);
      if (!facts[p.key]) unmasteredServes++;
      recent.push(p.key);
    }
    // focused, but no longer ~85% hammering of the last two facts
    expect(unmasteredServes / 300).toBeGreaterThan(0.2);
    expect(unmasteredServes / 300).toBeLessThan(0.75);
  });
});
