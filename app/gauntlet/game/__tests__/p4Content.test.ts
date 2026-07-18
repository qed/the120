import { describe, it, expect } from "vitest";
import { factSetFor, problemFromKey, GENERATORS, type TopicId } from "../problems";
import { AREAS, PATHWAY } from "../pathway";

/**
 * P4 — trig / precalc / calc content (gauntletcontent.md forward inventory).
 * Fact sets must round-trip through problemFromKey (the trial deck, placement,
 * and weak-fact re-serve all depend on it), and the math must match the
 * authored samples.
 */

const SET_TOPICS: TopicId[] = [
  "refangle",
  "trigval",
  "cofunc",
  "evallog",
  "geoseries",
  "dstd",
  "chain",
  "dpoint",
  "critpt",
  "defint",
];
const OPEN_TOPICS: TopicId[] = ["det2", "limitsub"];

describe("P4 fact sets", () => {
  it("every set topic enumerates a unique, capped, round-trippable set", () => {
    for (const topic of SET_TOPICS) {
      const set = factSetFor(topic, "g912");
      expect(set, topic).not.toBeNull();
      expect(set!.length, topic).toBeGreaterThan(0);
      expect(set!.length, topic).toBeLessThanOrEqual(150);
      expect(new Set(set!).size, `${topic} keys unique`).toBe(set!.length);
      for (const key of set!) {
        const p = problemFromKey(key);
        expect(p, key).not.toBeNull();
        expect(p!.key, `${key} round-trips`).toBe(key);
        expect(p!.answer.length, key).toBeGreaterThan(0);
        if (p!.kind === "choice") expect(p!.choices, key).toContain(p!.answer);
      }
    }
  });

  it("open-ended P4 topics generate self-consistent keys", () => {
    for (const topic of OPEN_TOPICS) {
      expect(factSetFor(topic, "g912")).toBeNull();
      for (let i = 0; i < 50; i++) {
        const p = GENERATORS[topic]("g912");
        const rebuilt = problemFromKey(p.key);
        expect(rebuilt, p.key).not.toBeNull();
        expect(rebuilt!.answer, p.key).toBe(p.answer);
      }
    }
  });
});

describe("P4 sampled correctness (authored samples from gauntletcontent.md)", () => {
  it("reference angle of 150° is 30", () => {
    expect(problemFromKey("refangle:150")!.answer).toBe("30");
  });
  it("sin 60° = √3/2", () => {
    expect(problemFromKey("trigval:sin:60")!.answer).toBe("√3/2");
  });
  it("sin 40° = cos 50°", () => {
    expect(problemFromKey("cofunc:sin:40")!.answer).toBe("50");
  });
  it("log₂ 32 = 5 and log₂ 1/4 = −2", () => {
    const p = problemFromKey("evallog:2^5")!;
    expect(p.prompt).toContain("32");
    expect(p.answer).toBe("5");
    const neg = problemFromKey("evallog:2^-2")!;
    expect(neg.prompt).toContain("1/4");
    expect(neg.answer).toBe("-2");
  });
  it("det [3 1; 4 2] = 2", () => {
    expect(problemFromKey("det2:3,1,4,2")!.answer).toBe("2");
  });
  it("lim (x → 2) of x² + 3x − 1 = 9", () => {
    expect(problemFromKey("limitsub:1,3,-1,2")!.answer).toBe("9");
  });
  it("8 + 4 + 2 + 1 converges; ratio 1 and ratio 2 do not", () => {
    expect(problemFromKey("geoseries:1/2")!.answer).toBe("True");
    expect(problemFromKey("geoseries:1")!.answer).toBe("False");
    expect(problemFromKey("geoseries:2")!.answer).toBe("False");
  });
  it("d/dx sin x = cos x with the authored option pool", () => {
    const p = problemFromKey("dstd:sin")!;
    expect(p.answer).toBe("cos x");
    expect(new Set(p.choices)).toEqual(new Set(["cos x", "−cos x", "sin x", "−sin x"]));
  });
  it("d/dx sin(3x) = 3 cos 3x", () => {
    expect(problemFromKey("chain:sin:3")!.answer).toBe("3 cos 3x");
  });
  it("f(x) = x³ → f′(2) = 12", () => {
    expect(problemFromKey("dpoint:1,3,2")!.answer).toBe("12");
  });
  it("f(x) = x² − 6x + c → critical point at x = 3", () => {
    const p = problemFromKey("critpt:1,3")!;
    expect(p.prompt).toContain("− 6x");
    expect(p.answer).toBe("3");
  });
  it("∫₀² 3x² dx = 8", () => {
    expect(problemFromKey("defint:3,2,2")!.answer).toBe("8");
  });
});

describe("P4 pathway wiring", () => {
  it("trig, precalc, and calc areas all have playable skills", () => {
    for (const area of ["trig", "precalc", "calc"]) {
      expect(AREAS.some((a) => a.id === area)).toBe(true);
      expect(
        PATHWAY.filter((s) => s.area === area).length,
        `${area} populated`
      ).toBeGreaterThanOrEqual(3);
    }
  });
  it("every pathway skill's topic has a generator", () => {
    for (const s of PATHWAY) {
      expect(typeof GENERATORS[s.topic], s.id).toBe("function");
    }
  });
});
