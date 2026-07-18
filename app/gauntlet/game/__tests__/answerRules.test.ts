import { describe, it, expect } from "vitest";
import { judge, isAutoSubmit, padExtras } from "../answerRules";
import { factSetFor, problemFromKey, judgeAnswer, GENERATORS, type TopicId } from "../problems";

/**
 * C6 — the answer-normalization layer. Every accept/reject example below is
 * taken literally from gauntletcontent.md's Input-format and Accepted-answer
 * legends: the legend IS the spec, these tests pin the implementation to it.
 */

describe("int-exact", () => {
  it("legend examples", () => {
    expect(judge("int-exact", "56", "56")).toBe(true);
    expect(judge("int-exact", "056", "56")).toBe(true); // normalization
    expect(judge("int-exact", "65", "56")).toBe(false);
    expect(judge("int-exact", "-0", "0")).toBe(true);
  });
});

describe("two-numbers", () => {
  it("pair-unordered: both orders accepted", () => {
    expect(judge("pair-unordered", "7,12", "7,12")).toBe(true);
    expect(judge("pair-unordered", "12,7", "7,12")).toBe(true);
    expect(judge("pair-unordered", "7,21", "7,12")).toBe(false);
  });
  it("pair-ordered: stated order only", () => {
    expect(judge("pair-ordered", "3,-2", "3,-2")).toBe(true);
    expect(judge("pair-ordered", "-2,3", "3,-2")).toBe(false);
  });
});

describe("fraction", () => {
  it("frac-lowest-terms: value-equal AND lowest terms as entered", () => {
    expect(judge("frac-lowest-terms", "2/3", "2/3")).toBe(true);
    expect(judge("frac-lowest-terms", "4/6", "2/3")).toBe(false); // not lowest terms
    expect(judge("frac-lowest-terms", "0.67", "2/3")).toBe(false); // wrong format
  });
  it("sign moves to the numerator; 1/-2 → -1/2", () => {
    expect(judge("frac-lowest-terms", "1/-2", "-1/2")).toBe(true);
    expect(judge("frac-lowest-terms", "-1/2", "-1/2")).toBe(true);
  });
  it("frac-any-equivalent accepts equivalents", () => {
    expect(judge("frac-any-equivalent", "3/6", "1/2")).toBe(true);
    expect(judge("frac-any-equivalent", "2/3", "1/2")).toBe(false);
  });
});

describe("dec-exact", () => {
  it("legend examples: zero-insensitive, no tolerance", () => {
    expect(judge("dec-exact", ".350", "0.35")).toBe(true);
    expect(judge("dec-exact", "0.35", "0.35")).toBe(true);
    expect(judge("dec-exact", "0.349", "0.35")).toBe(false);
  });
});

describe("expr-commutative-ws", () => {
  it("legend examples: commutative reorder OK, no simplification", () => {
    expect(judge("expr-commutative-ws", "7+2x", "2x+7")).toBe(true);
    expect(judge("expr-commutative-ws", "x+x+7", "2x+7")).toBe(false);
    expect(judge("expr-commutative-ws", "2 x + 7", "2x+7")).toBe(true); // ws-insensitive
  });
  it("trinomials reorder term-wise", () => {
    expect(judge("expr-commutative-ws", "7x+x^2+12", "x^2+7x+12")).toBe(true);
    expect(judge("expr-commutative-ws", "x^2+7x+13", "x^2+7x+12")).toBe(false);
  });
  it("unicode minus from the pad equals ascii minus", () => {
    expect(judge("expr-commutative-ws", "6x−5", "6x-5")).toBe(true);
  });
});

describe("factored-commutative-ws", () => {
  it("legend examples: factor order free, expanded form wrong", () => {
    expect(judge("factored-commutative-ws", "(x+4)(x+3)", "(x+3)(x+4)")).toBe(true);
    expect(judge("factored-commutative-ws", "( x + 3 )( x + 4 )", "(x+3)(x+4)")).toBe(true);
    expect(judge("factored-commutative-ws", "x^2+7x+12", "(x+3)(x+4)")).toBe(false);
  });
});

describe("submit model + pad surface", () => {
  it("only single-number auto-submits", () => {
    expect(isAutoSubmit("single-number")).toBe(true);
    for (const f of ["two-numbers", "fraction", "decimal", "short-expression"] as const) {
      expect(isAutoSubmit(f)).toBe(false);
    }
  });
  it("extras per format", () => {
    expect(padExtras("fraction")).toEqual(["/"]);
    expect(padExtras("two-numbers")).toEqual([","]);
    expect(padExtras("short-expression", ["x", "^"])).toEqual(["x", "^"]);
    expect(padExtras("single-number")).toEqual([]);
  });
});

describe("C6 topics (authored samples)", () => {
  it("simplify 6/8 → 3/4, lowest terms enforced", () => {
    const p = problemFromKey("simpfrac:6/8")!;
    expect(p.answer).toBe("3/4");
    expect(judgeAnswer(p, "3/4")).toBe(true);
    expect(judgeAnswer(p, "6/8")).toBe(false);
  });
  it("5x + 3x → 8x", () => {
    const p = problemFromKey("likterms:5+3")!;
    expect(judgeAnswer(p, "8x")).toBe(true);
    expect(judgeAnswer(p, "8")).toBe(false);
  });
  it("(x+3)(x+4) → x^2+7x+12 in any term order, unexpanded wrong", () => {
    const p = problemFromKey("binom:3,4")!;
    expect(p.answer).toBe("x^2+7x+12");
    expect(judgeAnswer(p, "12+7x+x^2")).toBe(true);
    expect(judgeAnswer(p, "(x+3)(x+4)")).toBe(false);
  });
  it("slope through (1,2) and (4,4) → 2/3", () => {
    const p = problemFromKey("slope2:1,2,4,4")!;
    expect(p.answer).toBe("2/3");
    expect(judgeAnswer(p, "2/3")).toBe(true);
    expect(judgeAnswer(p, "4/6")).toBe(false);
  });
  it("sum 7 product 12 → 3,4 either order", () => {
    const p = problemFromKey("factpair:3,4")!;
    expect(judgeAnswer(p, "4,3")).toBe(true);
    expect(judgeAnswer(p, "3,4")).toBe(true);
    expect(judgeAnswer(p, "2,6")).toBe(false);
  });
  it("d/dx x⁵ → 5x^4", () => {
    const p = problemFromKey("dpower:5")!;
    expect(judgeAnswer(p, "5x^4")).toBe(true);
    expect(judgeAnswer(p, "5x^5")).toBe(false);
  });
  it("d/dx (3x² + 5x − 4) → 6x+5, order-free", () => {
    const p = problemFromKey("dpoly:2,3,5,4")!;
    expect(p.answer).toBe("6x+5");
    expect(judgeAnswer(p, "5+6x")).toBe(true);
    expect(judgeAnswer(p, "6x+5-0")).toBe(false);
  });
});

describe("C6 sets + generators", () => {
  it("factpair and dpower enumerate round-trippable sets", () => {
    for (const topic of ["factpair", "dpower"] as TopicId[]) {
      const set = factSetFor(topic, "g912");
      expect(set).not.toBeNull();
      for (const key of set!) {
        const p = problemFromKey(key);
        expect(p, key).not.toBeNull();
        expect(p!.key, key).toBe(key);
      }
    }
  });
  it("open C6 generators produce self-consistent keys and self-judging answers", () => {
    for (const topic of ["simpfrac", "likterms", "binom", "slope2", "dpoly"] as TopicId[]) {
      for (let i = 0; i < 50; i++) {
        const p = GENERATORS[topic]("g912");
        const rebuilt = problemFromKey(p.key);
        expect(rebuilt, p.key).not.toBeNull();
        expect(rebuilt!.answer, p.key).toBe(p.answer);
        expect(judgeAnswer(p, p.answer), p.key).toBe(true); // canonical answer accepted
      }
    }
  });
});
