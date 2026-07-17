import { describe, it, expect } from "vitest";
import {
  BANDS,
  TOPICS,
  GENERATORS,
  factSetFor,
  makeTrialDeck,
  type Band,
  type TopicId,
  type Problem,
} from "../problems";

const ALL_BANDS: Band[] = BANDS.map((b) => b.id);
const ALL_TOPICS: TopicId[] = TOPICS.map((t) => t.id);
const VALID_KINDS = new Set(["numeric", "choice"]);

function isValidProblem(p: Problem): void {
  expect(typeof p.key).toBe("string");
  expect(p.key.length).toBeGreaterThan(0);
  expect(VALID_KINDS.has(p.kind)).toBe(true);
  expect(typeof p.answer).toBe("string");
  expect(p.answer.length).toBeGreaterThan(0);
  if (p.kind === "choice") {
    expect(Array.isArray(p.choices)).toBe(true);
    expect(p.choices!).toContain(p.answer);
  }
}

describe("GENERATORS registry", () => {
  it("has an entry for every TopicId in TOPICS (exhaustive both ways)", () => {
    const genKeys = new Set(Object.keys(GENERATORS));
    const topicIds = new Set(ALL_TOPICS);
    expect(genKeys).toEqual(topicIds);
    for (const t of ALL_TOPICS) {
      expect(typeof GENERATORS[t]).toBe("function");
    }
  });

  it("no generator throws for any band (incl. g912) and yields valid problems", () => {
    for (const band of ALL_BANDS) {
      for (const topic of ALL_TOPICS) {
        for (let i = 0; i < 40; i++) {
          const p = GENERATORS[topic](band);
          expect(p.topic).toBe(topic);
          isValidProblem(p);
        }
      }
    }
  });

  it("GENERATORS[topic]('g912') returns valid in-range problems for every topic", () => {
    for (const topic of ALL_TOPICS) {
      for (let i = 0; i < 20; i++) {
        isValidProblem(GENERATORS[topic]("g912"));
      }
    }
  });
});

describe("g912 topic math (sampled correctness)", () => {
  it("pow: answer === base ** exp", () => {
    for (let i = 0; i < 50; i++) {
      const p = GENERATORS.pow("g912");
      const m = p.key.match(/^pow:(\d+)\^(\d+)$/)!;
      const [base, exp] = [Number(m[1]), Number(m[2])];
      expect(p.answer).toBe(String(base ** exp));
    }
  });

  it("sqrtbig: answer squared equals the radicand", () => {
    for (let i = 0; i < 50; i++) {
      const p = GENERATORS.sqrtbig("g912");
      const rad = Number(p.key.slice("sqrtbig:".length));
      expect(Number(p.answer) ** 2).toBe(rad);
      expect(Number(p.answer)).toBeGreaterThanOrEqual(12);
    }
  });

  it("slope: answer === (y2-y1)/(x2-x1) and is an integer", () => {
    for (let i = 0; i < 50; i++) {
      const p = GENERATORS.slope("g912");
      const [x1, y1, x2, y2] = p.key.slice("slope:".length).split(",").map(Number);
      expect(p.answer).toBe(String((y2 - y1) / (x2 - x1)));
      expect(Number.isInteger(Number(p.answer))).toBe(true);
    }
  });

  it("linfn: answer === a*x0 + b", () => {
    for (let i = 0; i < 50; i++) {
      const p = GENERATORS.linfn("g912");
      const [a, b, x0] = p.key.slice("linfn:".length).split(",").map(Number);
      expect(p.answer).toBe(String(a * x0 + b));
    }
  });

  it("evalquad: answer === x0^2 + b*x0 + c", () => {
    for (let i = 0; i < 50; i++) {
      const p = GENERATORS.evalquad("g912");
      const [b, c, x0] = p.key.slice("evalquad:".length).split(",").map(Number);
      expect(p.answer).toBe(String(x0 * x0 + b * x0 + c));
    }
  });

  it("expquot: answer === e1 - e2", () => {
    for (let i = 0; i < 50; i++) {
      const p = GENERATORS.expquot("g912");
      const [, , e1, e2] = p.key.split(":"); // expquot:<base>:<e1>:<e2>
      expect(p.answer).toBe(String(Number(e1) - Number(e2)));
    }
  });

  it("disc: answer is the real-root count of b^2-4ac", () => {
    for (let i = 0; i < 80; i++) {
      const p = GENERATORS.disc("g912");
      const [a, b, c] = p.key.slice("disc:".length).split(",").map(Number);
      const d = b * b - 4 * a * c;
      const expected = d > 0 ? "2" : d === 0 ? "1" : "0";
      expect(p.answer).toBe(expected);
      expect(p.kind).toBe("choice");
    }
  });

  it("dist: answer is an integer equal to the point distance", () => {
    for (let i = 0; i < 50; i++) {
      const p = GENERATORS.dist("g912");
      const [x1, y1, x2, y2] = p.key.slice("dist:".length).split(",").map(Number);
      const d = Math.hypot(x2 - x1, y2 - y1);
      expect(Number.isInteger(Number(p.answer))).toBe(true);
      expect(Number(p.answer)).toBe(Math.round(d));
      // triples guarantee an exact integer distance
      expect(Math.abs(d - Math.round(d))).toBeLessThan(1e-9);
    }
  });

  it("srt: 30-60-90 hypotenuse is twice the short leg", () => {
    for (let i = 0; i < 50; i++) {
      const p = GENERATORS.srt("g912");
      const parts = p.key.split(":"); // srt:short:s | srt:hyp:s
      const s = Number(parts[2]);
      expect(p.answer).toBe(parts[1] === "short" ? String(2 * s) : String(s));
    }
  });

  it("midpoint: answer === (x1+x2)/2 and is an integer", () => {
    for (let i = 0; i < 50; i++) {
      const p = GENERATORS.midpoint("g912");
      const [x1, , x2] = p.key.slice("midpoint:".length).split(",").map(Number);
      expect(p.answer).toBe(String((x1 + x2) / 2));
      expect(Number.isInteger(Number(p.answer))).toBe(true);
    }
  });
});

describe("closed-set g912 fact enumeration", () => {
  const closed: TopicId[] = ["srt", "sqrtbig"];

  for (const topic of closed) {
    it(`${topic}: non-empty fact set with no duplicate keys at g912`, () => {
      const set = factSetFor(topic, "g912");
      expect(set).not.toBeNull();
      expect(set!.length).toBeGreaterThan(0);
      expect(new Set(set!).size).toBe(set!.length);
    });
  }

  it("g912 band-sensitive arithmetic enumerates without duplicates (mul)", () => {
    const set = factSetFor("mul", "g912");
    expect(set).not.toBeNull();
    expect(new Set(set!).size).toBe(set!.length);
  });

  it("makeTrialDeck deals the full closed g912 set", () => {
    const set = factSetFor("srt", "g912")!;
    const deck = makeTrialDeck(["srt"], "g912");
    expect([...deck].sort()).toEqual([...set].sort());
  });
});
