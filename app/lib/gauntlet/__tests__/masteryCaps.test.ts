import { describe, expect, it } from "vitest";
import { masteryCaps, type MasteryFact } from "../masteryCaps";
import { bandMasteryWeight } from "@/app/gauntlet/game/masteryWeight";

/** Build n facts on a given band with distinct keys. */
function facts(n: number, band: MasteryFact["band"] = "g34"): MasteryFact[] {
  return Array.from({ length: n }, (_, i) => ({ fact_key: `${band}:fact:${i}`, band }));
}

const MINUTE = 60_000;

describe("masteryCaps — happy path", () => {
  it("credits the whole batch when well under every ceiling", () => {
    const res = masteryCaps({
      facts: facts(5, "g78"),
      priorInWindow: 0,
      windowMs: MINUTE,
      priorToday: 0,
    });
    expect(res.credited).toHaveLength(5);
    expect(res.rejected).toBe(0);
    expect(res.reason).toBeUndefined();
  });

  it("attaches the band mastery weight to each credited fact", () => {
    const res = masteryCaps({
      facts: [
        { fact_key: "a", band: "g34" },
        { fact_key: "b", band: "g912" },
      ],
      priorInWindow: 0,
      windowMs: MINUTE,
      priorToday: 0,
    });
    expect(res.credited.map((c) => c.weight)).toEqual([
      bandMasteryWeight("g34"),
      bandMasteryWeight("g912"),
    ]);
    // g912 must out-weigh g34 (difficulty-weighted mastery).
    expect(bandMasteryWeight("g912")).toBeGreaterThan(bandMasteryWeight("g34"));
  });

  it("is a no-op for an empty batch", () => {
    const res = masteryCaps({ facts: [], priorInWindow: 0, windowMs: MINUTE, priorToday: 0 });
    expect(res.credited).toHaveLength(0);
    expect(res.rejected).toBe(0);
  });
});

describe("masteryCaps — over-rate batch is clamped (not rejected)", () => {
  it("credits up to the sustainable ceiling and rejects the remainder", () => {
    // 30 facts in a 1-minute window: over the sustainable rate but not
    // impossible → clamp, don't reject the batch.
    const submitted = 30;
    const res = masteryCaps({
      facts: facts(submitted),
      priorInWindow: 0,
      windowMs: MINUTE,
      priorToday: 0,
    });
    expect(res.credited.length).toBeGreaterThan(0);
    expect(res.credited.length).toBeLessThan(submitted);
    expect(res.rejected).toBe(submitted - res.credited.length);
    expect(res.reason).toBe("rate_clamped");
  });

  it("accounts for facts already mastered in the window", () => {
    // Same 1-min window but the user already mastered some in it → fewer new
    // ones fit under the ceiling than a fresh window would allow.
    const fresh = masteryCaps({
      facts: facts(30),
      priorInWindow: 0,
      windowMs: MINUTE,
      priorToday: 0,
    });
    const withPrior = masteryCaps({
      facts: facts(30),
      priorInWindow: 10,
      windowMs: MINUTE,
      priorToday: 0,
    });
    expect(withPrior.credited.length).toBeLessThan(fresh.credited.length);
  });
});

describe("masteryCaps — daily ceiling reached", () => {
  it("credits 0 without throwing once the daily ceiling is hit", () => {
    const res = masteryCaps({
      facts: facts(5),
      priorInWindow: 0,
      windowMs: MINUTE,
      priorToday: 10_000, // far past any sane daily ceiling
    });
    expect(res.credited).toHaveLength(0);
    expect(res.rejected).toBe(5);
    expect(res.reason).toBe("daily_ceiling");
  });
});

describe("masteryCaps — impossible rate is rejected", () => {
  it("rejects the whole batch above the absolute per-minute ceiling", () => {
    // 100 facts claimed in 1 second → impossible for a human.
    const res = masteryCaps({
      facts: facts(100),
      priorInWindow: 0,
      windowMs: 1_000,
      priorToday: 0,
    });
    expect(res.credited).toHaveLength(0);
    expect(res.rejected).toBe(100);
    expect(res.reason).toBe("rate_impossible");
  });

  it("a small burst in a tiny window is clamped, not rejected", () => {
    // A few facts posted after a couple seconds is a plausible burst → the
    // grace floor credits them rather than rejecting as impossible.
    const res = masteryCaps({
      facts: facts(3),
      priorInWindow: 0,
      windowMs: 2_000,
      priorToday: 0,
    });
    expect(res.credited).toHaveLength(3);
    expect(res.rejected).toBe(0);
  });
});
