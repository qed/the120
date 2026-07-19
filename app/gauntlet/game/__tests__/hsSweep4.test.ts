import { describe, it, expect } from "vitest";
import { factSetFor, problemFromKey, judgeAnswer, GENERATORS, type TopicId } from "../problems";
import { judge } from "../answerRules";
import { PATHWAY } from "../pathway";

/** HS sweep batch 4 (2026-07-19) — samples literal from gauntletcontent.md. */

describe("authored samples", () => {
  it("Expand 3(x + 4) → 3x+12, order-free", () => {
    const p = problemFromKey("distlin:3,4")!;
    expect(p.answer).toBe("3x+12");
    expect(judgeAnswer(p, "12+3x")).toBe(true);
  });
  it("Next term: 3, 7, 11, 15 → 19", () => {
    expect(problemFromKey("nextarith:3,4")!.answer).toBe("19");
  });
  it("Next term: 2, 6, 18, 54 → 162", () => {
    const p = problemFromKey("nextgeo:2,3,4")!;
    expect(p.prompt).toContain("2, 6, 18, 54");
    expect(p.answer).toBe("162");
  });
  it("2ˣ = 32 → 5", () => {
    expect(problemFromKey("expsolve:2^5")!.answer).toBe("5");
  });
  it("log₆ 4 + log₆ 9 → 2", () => {
    expect(problemFromKey("logrule:6,4,9")!.answer).toBe("2");
  });
  it("Factor: 6x + 12 → 6(x+2); (x+2)6 also accepted; unfactored rejected", () => {
    const p = problemFromKey("factgcf:6,2")!;
    expect(p.answer).toBe("6(x+2)");
    expect(judgeAnswer(p, "6(x+2)")).toBe(true);
    expect(judgeAnswer(p, "6x+12")).toBe(false);
    expect(judge("factored-commutative-ws", "3(x+4)", "3(x+4)")).toBe(true);
    expect(judge("factored-commutative-ws", "2(x+4)", "3(x+4)")).toBe(false);
  });
  it("supplement of 68° → 112; complement of 40° → 50", () => {
    expect(problemFromKey("suppcomp:supp,68")!.answer).toBe("112");
    expect(problemFromKey("suppcomp:comp,40")!.answer).toBe("50");
  });
  it("coterminal with 405° → 45; with −90° → 270", () => {
    expect(problemFromKey("coterm:405")!.answer).toBe("45");
    expect(problemFromKey("coterm:-90")!.answer).toBe("270");
  });
  it("sin 150° = 1/2 with the paired-magnitude option set", () => {
    const p = problemFromKey("trigq:sin:150")!;
    expect(p.answer).toBe("1/2");
    expect(new Set(p.choices)).toEqual(new Set(["1/2", "−1/2", "√3/2", "−√3/2"]));
  });
  it("cos 135° = −√2/2; tan 240° = √3", () => {
    expect(problemFromKey("trigq:cos:135")!.answer).toBe("−√2/2");
    expect(problemFromKey("trigq:tan:240")!.answer).toBe("√3");
  });
  it("csc 30° = 2 with the flip trap in the options", () => {
    const p = problemFromKey("recip:csc:30")!;
    expect(p.answer).toBe("2");
    expect(p.choices).toContain("1/2"); // sin 30° — the reciprocal-forgotten trap
  });
  it("y = (x + 1)/(x − 3): vertical asymptote x = 3", () => {
    const p = problemFromKey("vasymp:3,1")!;
    expect(p.prompt).toContain("(x − 3)");
    expect(p.answer).toBe("3");
  });
  it("y = (6x + 1)/(2x − 5): horizontal asymptote y = 3; lower-degree band → 0", () => {
    expect(problemFromKey("hasymp:6,1,2,-5")!.answer).toBe("3");
    expect(problemFromKey("hasymp:0,4,3,2")!.answer).toBe("0");
  });
  it("y = −3 sin(2x) + 1: amplitude 3; y = 2 sin(3x) − 4: midline −4", () => {
    expect(problemFromKey("amp:-3,2,1,sin")!.answer).toBe("3");
    expect(problemFromKey("midline:2,3,-4,sin")!.answer).toBe("-4");
  });
  it("f(x) = x⁴ → f″(1) = 12", () => {
    expect(problemFromKey("dsecond:1,4,1")!.answer).toBe("12");
  });
  it("s(t) = t³ − 3t → velocity at t = 2 is 9", () => {
    expect(problemFromKey("veloc:3,1,3,2")!.answer).toBe("9");
  });
  it("∫x⁴ dx = xⁿ/n + C → n = 5", () => {
    expect(problemFromKey("antipow:4")!.answer).toBe("5");
  });
  it("lim sin(5x)/x → 5; sin(6x)/sin(2x) → 3; (1−cos x)/x → 0", () => {
    expect(problemFromKey("triglim:x,5")!.answer).toBe("5");
    expect(problemFromKey("triglim:s,6,2")!.answer).toBe("3");
    expect(problemFromKey("triglim:c")!.answer).toBe("0");
  });
  it("ratio test: L = 1/2 converges, L = 2 diverges, L = 1 inconclusive", () => {
    expect(problemFromKey("ratiotest:1/2")!.answer).toBe("Converges absolutely");
    expect(problemFromKey("ratiotest:2")!.answer).toBe("Diverges");
    expect(problemFromKey("ratiotest:1")!.answer).toBe("Test is inconclusive");
    expect(problemFromKey("ratiotest:∞")!.answer).toBe("Diverges");
  });
});

const SET_TOPICS: TopicId[] = [
  "distlin", "nextgeo", "expsolve", "logrule", "factgcf", "suppcomp",
  "trigq", "recip", "dsecond", "antipow", "triglim", "ratiotest",
];
const OPEN_TOPICS: TopicId[] = ["nextarith", "coterm", "vasymp", "hasymp", "amp", "midline", "veloc"];

describe("sets + generators", () => {
  it("set topics enumerate unique, capped, round-trippable sets", () => {
    for (const topic of SET_TOPICS) {
      const set = factSetFor(topic, "g912");
      expect(set, topic).not.toBeNull();
      expect(set!.length, topic).toBeGreaterThan(0);
      expect(set!.length, topic).toBeLessThanOrEqual(150);
      expect(new Set(set!).size, topic).toBe(set!.length);
      for (const key of set!) {
        const p = problemFromKey(key);
        expect(p, key).not.toBeNull();
        expect(p!.key, key).toBe(key);
        if (p!.kind === "choice") expect(p!.choices, key).toContain(p!.answer);
      }
    }
  });
  it("open generators are self-consistent and self-judging", () => {
    for (const topic of OPEN_TOPICS) {
      expect(factSetFor(topic, "g912"), topic).toBeNull();
      for (let i = 0; i < 50; i++) {
        const p = GENERATORS[topic]("g912");
        const rebuilt = problemFromKey(p.key);
        expect(rebuilt, p.key).not.toBeNull();
        expect(rebuilt!.answer, p.key).toBe(p.answer);
        if (p.kind === "numeric") expect(judgeAnswer(p, p.answer), p.key).toBe(true);
      }
    }
  });
  it("every batch-4 topic is on the pathway", () => {
    for (const t of [...SET_TOPICS, ...OPEN_TOPICS]) {
      expect(PATHWAY.some((s) => s.topic === t), t).toBe(true);
    }
  });
});
