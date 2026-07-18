import { describe, it, expect } from "vitest";
import { factSetFor, problemFromKey, judgeAnswer, GENERATORS, type TopicId } from "../problems";
import { PATHWAY } from "../pathway";

/**
 * C6 completion — the ±-unblocked single-number picks, the fraction family,
 * the percent family, and the factored-form entry. Samples are literal from
 * gauntletcontent.md.
 */

describe("authored samples", () => {
  it("−7 + 12 → 5 (fk.integer-add-sub)", () => {
    const p = problemFromKey("intadd:add,-7,12")!;
    expect(p.prompt).toBe("−7 + 12");
    expect(p.answer).toBe("5");
  });
  it("(−3) × (−4) → 12 (fk.integer-mul-div)", () => {
    const p = problemFromKey("intmul:mul,-3,-4")!;
    expect(p.answer).toBe("12");
  });
  it("−12 ÷ 3 → −4, always exact", () => {
    expect(problemFromKey("intmul:div,-12,3")!.answer).toBe("-4");
  });
  it("3x + 2 when x = 4 → 14 (prealg.evaluate-expression)", () => {
    expect(problemFromKey("evalexpr:lin,3,2,4")!.answer).toBe("14");
  });
  it("x + 7 = 12 → 5; signed band x + 9 = 4 → −5 (solve-one-step)", () => {
    expect(problemFromKey("solve1:add,7,12")!.answer).toBe("5");
    expect(problemFromKey("solve1:add,9,4")!.answer).toBe("-5");
  });
  it("3x + 5 = 20 → 5 (solve-two-step)", () => {
    const p = problemFromKey("solve2:3,5,5")!;
    expect(p.prompt).toContain("3x + 5 = 20");
    expect(p.answer).toBe("5");
  });
  it("35% → 0.35 under dec-exact, .350 accepted (percent-to-decimal)", () => {
    const p = problemFromKey("pct2dec:35")!;
    expect(p.answer).toBe("0.35");
    expect(judgeAnswer(p, ".350")).toBe(true);
    expect(judgeAnswer(p, "0.349")).toBe(false);
  });
  it("0.07 → 7 (decimal-to-percent, number only)", () => {
    const p = problemFromKey("dec2pct:7")!;
    expect(p.prompt).toContain("0.07");
    expect(p.answer).toBe("7");
  });
  it("40% → 2/5 in lowest terms (percent-to-fraction)", () => {
    const p = problemFromKey("pct2frac:40")!;
    expect(p.answer).toBe("2/5");
    expect(judgeAnswer(p, "40/100")).toBe(false);
  });
  it("1/2 + 1/3 → 5/6; improper allowed: 1/2 + 2/3 → 7/6 (fraction-add-unlike)", () => {
    expect(problemFromKey("fracadd:1/2+1/3")!.answer).toBe("5/6");
    expect(problemFromKey("fracadd:1/2+2/3")!.answer).toBe("7/6");
  });
  it("2/3 × 3/4 → 1/2 (fraction-multiply)", () => {
    const p = problemFromKey("fracmul:2/3×3/4")!;
    expect(p.answer).toBe("1/2");
    expect(judgeAnswer(p, "6/12")).toBe(false); // lowest terms enforced
  });
  it("3/5 > 2/3 → False (compare-fractions)", () => {
    expect(problemFromKey("fraccomp:3/5>2/3")!.answer).toBe("False");
  });
  it("x² + 7x + 12 → (x+3)(x+4), factor order free, expanded wrong", () => {
    const p = problemFromKey("factquad:3,4")!;
    expect(p.prompt).toContain("x² + 7x + 12");
    expect(judgeAnswer(p, "(x+4)(x+3)")).toBe(true);
    expect(judgeAnswer(p, "x^2+7x+12")).toBe(false);
  });
});

describe("sets + generators", () => {
  it("pct2dec/dec2pct/pct2frac/factquad enumerate round-trippable sets", () => {
    const sizes: Record<string, number> = { pct2dec: 150, dec2pct: 150, factquad: 45 };
    for (const topic of ["pct2dec", "dec2pct", "pct2frac", "factquad"] as TopicId[]) {
      const set = factSetFor(topic, "g78");
      expect(set, topic).not.toBeNull();
      if (sizes[topic]) expect(set!.length, topic).toBe(sizes[topic]);
      for (const key of set!) {
        const p = problemFromKey(key);
        expect(p, key).not.toBeNull();
        expect(p!.key, key).toBe(key);
      }
    }
  });
  it("open generators self-consistent + canonical answers accepted", () => {
    for (const topic of ["intadd", "intmul", "evalexpr", "solve1", "solve2", "fracadd", "fracmul", "fraccomp"] as TopicId[]) {
      for (let i = 0; i < 50; i++) {
        const p = GENERATORS[topic]("g78");
        const rebuilt = problemFromKey(p.key);
        expect(rebuilt, p.key).not.toBeNull();
        expect(rebuilt!.answer, p.key).toBe(p.answer);
        if (p.kind === "numeric") expect(judgeAnswer(p, p.answer), p.key).toBe(true);
      }
    }
  });
  it("fracadd answers are always in lowest terms and non-integer", () => {
    for (let i = 0; i < 60; i++) {
      const p = GENERATORS.fracadd("g78");
      const [n, d] = p.answer.split("/").map(Number);
      expect(d, p.key).toBeGreaterThan(1);
      const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
      expect(g(n, d), p.key).toBe(1);
    }
  });
  it("the pathway wires every new topic", () => {
    for (const t of ["intadd", "intmul", "evalexpr", "solve1", "solve2", "pct2dec", "dec2pct", "pct2frac", "fracadd", "fracmul", "fraccomp", "factquad"]) {
      expect(PATHWAY.some((s) => s.topic === t), t).toBe(true);
    }
  });
});
