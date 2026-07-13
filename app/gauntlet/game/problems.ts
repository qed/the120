/**
 * Gauntlet problem engine.
 * - Grade bands scale ranges for the core arithmetic topics (B4).
 * - Every problem carries a stable `key` so the trainer can track per-fact
 *   speed/accuracy. Topics with a small enough parameter space expose their
 *   full fact set (factSetFor); serving focuses on unmastered facts and the
 *   Mastery Trial deals the whole set without replacement.
 * - Starter Twelve topics implement artifacts/gauntletcontent.md's ranked
 *   kernel picks (✦ starter subset) with the params specified there.
 */

import { isMastered, MASTERY_MS, type FactStat } from "./mastery";

export type TopicId =
  // core arithmetic (shipped picks #1/2/3/6)
  | "mul"
  | "div"
  | "add"
  | "sub"
  // Starter Twelve (gauntletcontent.md)
  | "sq"
  | "cube"
  | "sqrt"
  | "pow"
  | "dbl"
  | "pow10"
  | "fracof"
  | "place"
  | "mul2x1"
  | "pyth"
  | "prop"
  | "exprule"
  // earlier concept topics
  | "gcd"
  | "lcm"
  | "denom"
  | "congruence";

export type Band = "g34" | "g56" | "g78";

export const BANDS: { id: Band; label: string }[] = [
  { id: "g34", label: "Grades 3–4" },
  { id: "g56", label: "Grades 5–6" },
  { id: "g78", label: "Grades 7–8" },
];

export type Topic = { id: TopicId; label: string; tier: 1 | 2 };

/** tier 1 = number facts, tier 2 = skills & concepts. */
export const TOPICS: Topic[] = [
  { id: "mul", label: "Multiplication", tier: 1 },
  { id: "div", label: "Division", tier: 1 },
  { id: "add", label: "Addition", tier: 1 },
  { id: "sub", label: "Subtraction", tier: 1 },
  { id: "sq", label: "Squares", tier: 1 },
  { id: "cube", label: "Cubes", tier: 1 },
  { id: "dbl", label: "Double & halve", tier: 1 },
  { id: "pow10", label: "Powers of ten", tier: 1 },
  { id: "mul2x1", label: "2-digit × 1-digit", tier: 1 },
  { id: "place", label: "Place value", tier: 1 },
  { id: "fracof", label: "Fraction of a number", tier: 1 },
  { id: "sqrt", label: "Square roots", tier: 2 },
  { id: "pow", label: "Exponents", tier: 2 },
  { id: "exprule", label: "Exponent rules", tier: 2 },
  { id: "pyth", label: "Pythagorean triples", tier: 2 },
  { id: "prop", label: "Proportions", tier: 2 },
  { id: "gcd", label: "GCD", tier: 2 },
  { id: "lcm", label: "LCM", tier: 2 },
  { id: "denom", label: "Common denominator", tier: 2 },
  { id: "congruence", label: "Triangle congruence", tier: 2 },
];

export type TrianglePair = {
  a: { sides: [number, number, number]; marks: string[]; rotate: number };
  b: { sides: [number, number, number]; marks: string[]; rotate: number };
};

export type Problem = {
  topic: TopicId;
  /** stable fact identity, e.g. "mul:7×8" (commutative-normalized) */
  key: string;
  prompt: string;
  answer: string;
  kind: "numeric" | "choice";
  choices?: string[];
  triangle?: TrianglePair;
};

const ri = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
const lcm = (a: number, b: number) => (a * b) / gcd(a, b);

/** Unicode superscripts for the unicode-inline render entries. */
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number) => String(n).split("").map((d) => SUP[+d]).join("");

/* ---------- band ranges (core arithmetic) ---------- */

const R = {
  mul: { g34: [2, 6], g56: [2, 10], g78: [2, 12] },
  addMax: { g34: 12, g56: 20, g78: 50 },
  gcdFactors: { g34: [2, 3, 4, 5], g56: [2, 3, 4, 5, 6, 7], g78: [2, 3, 4, 5, 6, 7, 8, 9] },
  lcmPool: {
    g34: [2, 3, 4, 5, 6],
    g56: [2, 3, 4, 5, 6, 8, 10],
    g78: [2, 3, 4, 5, 6, 8, 9, 10, 12],
  },
  lcmCap: { g34: 40, g56: 90, g78: 144 },
} as const;

/* ---------- core arithmetic ---------- */

function makeMul(a: number, b: number): Problem {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return { topic: "mul", key: `mul:${lo}×${hi}`, prompt: `${a} × ${b}`, answer: String(a * b), kind: "numeric" };
}
function genMul(band: Band): Problem {
  const [lo, hi] = R.mul[band];
  return makeMul(ri(lo, hi), ri(lo, hi));
}

function makeDiv(dividend: number, divisor: number): Problem {
  return { topic: "div", key: `div:${dividend}÷${divisor}`, prompt: `${dividend} ÷ ${divisor}`, answer: String(dividend / divisor), kind: "numeric" };
}
function genDiv(band: Band): Problem {
  const [lo, hi] = R.mul[band];
  const b = ri(lo, hi);
  const q = ri(lo, hi);
  return makeDiv(b * q, b);
}

function makeAdd(a: number, b: number): Problem {
  return { topic: "add", key: `add:${Math.min(a, b)}+${Math.max(a, b)}`, prompt: `${a} + ${b}`, answer: String(a + b), kind: "numeric" };
}
function genAdd(band: Band): Problem {
  const max = R.addMax[band];
  const a = ri(2, max - 2);
  const b = ri(2, Math.max(2, max - a));
  return makeAdd(a, b);
}

function makeSub(a: number, b: number): Problem {
  return { topic: "sub", key: `sub:${a}−${b}`, prompt: `${a} − ${b}`, answer: String(a - b), kind: "numeric" };
}
function genSub(band: Band): Problem {
  const max = R.addMax[band];
  const a = ri(4, max);
  return makeSub(a, ri(1, a - 1));
}

/* ---------- Starter Twelve (specs: gauntletcontent.md ranked picks) ---------- */

// fk.perfect-squares — bases ∈ [2,15]
function makeSq(base: number): Problem {
  return { topic: "sq", key: `sq:${base}`, prompt: `${base}${sup(2)}`, answer: String(base * base), kind: "numeric" };
}
const genSq = () => makeSq(ri(2, 15));

// fk.perfect-cubes — bases ∈ [2,6] core (recall, not computation)
function makeCube(base: number): Problem {
  return { topic: "cube", key: `cube:${base}`, prompt: `${base}${sup(3)}`, answer: String(base ** 3), kind: "numeric" };
}
const genCube = () => makeCube(ri(2, 6));

// prealg.square-root — radicands the squares of [2,15]
function makeSqrt(root: number): Problem {
  return { topic: "sqrt", key: `sqrt:${root * root}`, prompt: `√${root * root}`, answer: String(root), kind: "numeric" };
}
const genSqrt = () => makeSqrt(ri(2, 15));

// prealg.evaluate-exponent — base ∈ [2,10], exp ∈ [2,4]; exp-4 restricted to bases 2–5
function makePow(base: number, exp: number): Problem {
  return { topic: "pow", key: `pow:${base}^${exp}`, prompt: `${base}${sup(exp)}`, answer: String(base ** exp), kind: "numeric" };
}
function genPow(): Problem {
  const exp = ri(2, 4);
  const base = exp === 4 ? ri(2, 5) : ri(2, 10);
  return makePow(base, exp);
}

// fk.doubling-halving — double n ∈ [13,99]; halve even n ∈ [12,98] + round hundreds ≤ 400
function makeDbl(op: "double" | "half", n: number): Problem {
  return {
    topic: "dbl",
    key: `dbl:${op}:${n}`,
    prompt: op === "double" ? `Double ${n}` : `Half of ${n}`,
    answer: String(op === "double" ? n * 2 : n / 2),
    kind: "numeric",
  };
}
function genDbl(): Problem {
  if (Math.random() < 0.5) return makeDbl("double", ri(13, 99));
  const n = Math.random() < 0.8 ? ri(6, 49) * 2 : pick([100, 200, 300, 400]);
  return makeDbl("half", n);
}

// fk.powers-of-ten — place shifts of 1–4; positive-integer answers ≤ 6 digits
function makePow10(op: "mul" | "div", n: number, p: number): Problem {
  const t = 10 ** p;
  return {
    topic: "pow10",
    key: `pow10:${op}:${n}:${p}`,
    prompt: op === "mul" ? `${n} × ${t.toLocaleString("en-CA")}` : `${(n * t).toLocaleString("en-CA")} ÷ ${t.toLocaleString("en-CA")}`,
    answer: op === "mul" ? String(n * t) : String(n),
    kind: "numeric",
  };
}
function genPow10(): Problem {
  const op = Math.random() < 0.5 ? "mul" : "div";
  const p = ri(1, 4);
  const nMax = Math.floor(999999 / 10 ** p);
  return makePow10(op, ri(2, Math.min(99, nMax)), p);
}

// fk.fraction-of-number — den ∈ [2,10], num ∈ [1,den−1], whole divisible by den, ∈ [6,60]
function makeFracOf(num: number, den: number, whole: number): Problem {
  return {
    topic: "fracof",
    key: `fracof:${num}/${den}:${whole}`,
    prompt: `${num}/${den} of ${whole}`,
    answer: String((whole / den) * num),
    kind: "numeric",
  };
}
function genFracOf(): Problem {
  const den = ri(2, 10);
  const num = ri(1, den - 1);
  const lo = Math.max(1, Math.ceil(6 / den));
  const whole = den * ri(lo, Math.floor(60 / den));
  return makeFracOf(num, den, whole);
}

// fk.place-value — 3–5 digit whole numbers, ones→thousands; answer is one digit
const PLACES = ["ones", "tens", "hundreds", "thousands"] as const;
function makePlace(n: number, placeIdx: number): Problem {
  const digit = Math.floor(n / 10 ** placeIdx) % 10;
  return {
    topic: "place",
    key: `place:${n}:${placeIdx}`,
    prompt: `In ${n.toLocaleString("en-CA")}, which digit is in the ${PLACES[placeIdx]} place?`,
    answer: String(digit),
    kind: "numeric",
  };
}
function genPlace(): Problem {
  const digits = ri(3, 5);
  const n = ri(10 ** (digits - 1), 10 ** digits - 1);
  return makePlace(n, ri(0, Math.min(3, digits - 1)));
}

// fk.two-digit-times-one-digit — 2-digit ∈ [13,49] excl. multiples of 10, 1-digit ∈ [3,9]
function makeMul2x1(a: number, b: number): Problem {
  return { topic: "mul2x1", key: `mul2x1:${a}×${b}`, prompt: `${a} × ${b}`, answer: String(a * b), kind: "numeric" };
}
function genMul2x1(): Problem {
  let a = ri(13, 49);
  if (a % 10 === 0) a += 1;
  return makeMul2x1(a, ri(3, 9));
}

// prealg.pythagorean-hypotenuse — named triples + integer multiples (hypotenuse ≤ 50)
const TRIPLES: [number, number, number][] = [
  [3, 4, 5],
  [5, 12, 13],
  [8, 15, 17],
  [7, 24, 25],
];
function makePyth(a: number, b: number, c: number, missing: "hyp" | "leg"): Problem {
  if (missing === "hyp") {
    return {
      topic: "pyth",
      key: `pyth:${a},${b},${c}:hyp`,
      prompt: `A right triangle has legs ${a} and ${b}. How long is the hypotenuse?`,
      answer: String(c),
      kind: "numeric",
    };
  }
  return {
    topic: "pyth",
    key: `pyth:${a},${b},${c}:leg`,
    prompt: `A right triangle has a leg ${b} and hypotenuse ${c}. How long is the other leg?`,
    answer: String(a),
    kind: "numeric",
  };
}
function genPyth(): Problem {
  const [a0, b0, c0] = pick(TRIPLES);
  const k = ri(1, Math.max(1, Math.floor(50 / c0)));
  const [a, b, c] = [a0 * k, b0 * k, c0 * k];
  return Math.random() < 0.6 ? makePyth(a, b, c, "hyp") : makePyth(a, b, c, "leg");
}

// prealg.solve-proportion — a/b in lowest terms (a,b ∈ [1,9]), scale ∈ [2,9]; unknown rotates
function makeProp(a: number, b: number, k: number, pos: 0 | 1 | 2 | 3): Problem {
  const vals = [a, b, a * k, b * k];
  const show = vals.map((v, i) => (i === pos ? "x" : String(v)));
  return {
    topic: "prop",
    key: `prop:${a}:${b}:${k}:${pos}`,
    prompt: `${show[0]}/${show[1]} = ${show[2]}/${show[3]} · x = ?`,
    answer: String(vals[pos]),
    kind: "numeric",
  };
}
function genProp(): Problem {
  let a = ri(1, 9);
  let b = ri(2, 9);
  const g = gcd(a, b);
  a /= g;
  b /= g;
  if (a === b) b = a + 1;
  return makeProp(a, b, ri(2, 9), ri(0, 3) as 0 | 1 | 2 | 3);
}

// prealg.exponent-product-rule — exponents ∈ [1,9], base from {2,3,5,10,x}
function makeExpRule(base: string, e1: number, e2: number): Problem {
  return {
    topic: "exprule",
    key: `exprule:${base}:${e1}:${e2}`,
    prompt: `${base}${sup(e1)} × ${base}${sup(e2)} = ${base}ⁿ · n = ?`,
    answer: String(e1 + e2),
    kind: "numeric",
  };
}
const genExpRule = () => makeExpRule(pick(["2", "3", "5", "10", "x"]), ri(1, 9), ri(1, 9));

/* ---------- earlier concept topics ---------- */

function makeGcd(a: number, b: number): Problem {
  const [x, y] = [Math.max(a, b), Math.min(a, b)];
  return { topic: "gcd", key: `gcd:${x},${y}`, prompt: `GCD(${x}, ${y})`, answer: String(gcd(x, y)), kind: "numeric" };
}
function genGcd(band: Band): Problem {
  const g = pick(R.gcdFactors[band]);
  const a = g * pick([2, 3, 4, 5]);
  let b = g * pick([2, 3, 4, 5, 6]);
  if (a === b) b = g * 7;
  return makeGcd(a, b);
}

function makeLcm(a: number, b: number): Problem {
  const [x, y] = [Math.min(a, b), Math.max(a, b)];
  return { topic: "lcm", key: `lcm:${x},${y}`, prompt: `LCM(${x}, ${y})`, answer: String(lcm(x, y)), kind: "numeric" };
}
function genLcm(band: Band): Problem {
  const pool: readonly number[] = R.lcmPool[band];
  const a = pick(pool);
  let b = pick(pool);
  if (a === b) b = pool[(pool.indexOf(a) + 1) % pool.length];
  if (lcm(a, b) > R.lcmCap[band]) return genLcm(band);
  return makeLcm(a, b);
}

function makeDenom(n1: number, d1: number, n2: number, d2: number): Problem {
  return {
    topic: "denom",
    key: `denom:${Math.min(d1, d2)},${Math.max(d1, d2)}`,
    prompt: `Least common denominator of ${n1}/${d1} and ${n2}/${d2}`,
    answer: String(lcm(d1, d2)),
    kind: "numeric",
  };
}
function genDenom(band: Band): Problem {
  const pool: readonly number[] = R.lcmPool[band];
  const d1 = pick(pool);
  let d2 = pick(pool);
  if (d1 === d2) d2 = pool[(pool.indexOf(d1) + 1) % pool.length];
  if (lcm(d1, d2) > R.lcmCap[band]) return genDenom(band);
  return makeDenom(ri(1, d1 - 1), d1, ri(1, d2 - 1), d2);
}

/* ---------- congruence (choice) ---------- */

const CRITERIA = ["SSS", "SAS", "ASA", "AAS"] as const;

function genCongruence(): Problem {
  const correct = pick([...CRITERIA, "Not enough info"] as const);
  const sides: [number, number, number] = [ri(60, 90), ri(70, 100), ri(80, 110)];
  const o = ri(0, 2);
  const s = (i: number) => `s${(i + o) % 3}`;
  const A = (i: number) => `A${(i + o) % 3}`;
  const marksFor: Record<string, string[]> = {
    SSS: [s(0), s(1), s(2)],
    SAS: [s(0), A(1), s(1)],
    ASA: [A(0), s(1), A(1)],
    AAS: [A(0), A(1), s(2)],
    "Not enough info": pick([[s(0), s(1)], [A(0), A(1)], [s(0), A(2)]]),
  };
  const marks = marksFor[correct];
  return {
    topic: "congruence",
    key: `congruence:${correct}`,
    prompt: "Which criterion proves these triangles congruent?",
    answer: correct,
    kind: "choice",
    choices: [...CRITERIA, "Not enough info"],
    triangle: {
      a: { sides, marks, rotate: ri(-25, 25) },
      b: { sides, marks, rotate: ri(-25, 25) + pick([0, 90, 180]) },
    },
  };
}

/* ---------- registry + adaptive serving ---------- */

const GENERATORS: Record<TopicId, (band: Band) => Problem> = {
  mul: genMul,
  div: genDiv,
  add: genAdd,
  sub: genSub,
  sq: genSq,
  cube: genCube,
  sqrt: genSqrt,
  pow: genPow,
  dbl: genDbl,
  pow10: genPow10,
  fracof: genFracOf,
  place: genPlace,
  mul2x1: genMul2x1,
  pyth: genPyth,
  prop: genProp,
  exprule: genExpRule,
  gcd: genGcd,
  lcm: genLcm,
  denom: genDenom,
  congruence: () => genCongruence(),
};

/** Rebuild a specific fact from its key (weak-fact re-serve; all numeric topics). */
export function problemFromKey(key: string): Problem | null {
  const [topic, ...restParts] = key.split(":");
  const rest = restParts.join(":");
  try {
    switch (topic) {
      case "mul": {
        const [a, b] = rest.split("×").map(Number);
        return Math.random() < 0.5 ? makeMul(a, b) : makeMul(b, a);
      }
      case "div": {
        const [a, b] = rest.split("÷").map(Number);
        return makeDiv(a, b);
      }
      case "add": {
        const [a, b] = rest.split("+").map(Number);
        return Math.random() < 0.5 ? makeAdd(a, b) : makeAdd(b, a);
      }
      case "sub": {
        const [a, b] = rest.split("−").map(Number);
        return makeSub(a, b);
      }
      case "sq":
        return makeSq(Number(rest));
      case "cube":
        return makeCube(Number(rest));
      case "sqrt":
        return makeSqrt(Math.round(Math.sqrt(Number(rest))));
      case "pow": {
        const [b, e] = rest.split("^").map(Number);
        return makePow(b, e);
      }
      case "dbl":
        return makeDbl(restParts[0] as "double" | "half", Number(restParts[1]));
      case "pow10":
        return makePow10(restParts[0] as "mul" | "div", Number(restParts[1]), Number(restParts[2]));
      case "fracof": {
        const [num, den] = restParts[0].split("/").map(Number);
        return makeFracOf(num, den, Number(restParts[1]));
      }
      case "place":
        return makePlace(Number(restParts[0]), Number(restParts[1]));
      case "mul2x1": {
        const [a, b] = rest.split("×").map(Number);
        return makeMul2x1(a, b);
      }
      case "pyth": {
        const [a, b, c] = restParts[0].split(",").map(Number);
        return makePyth(a, b, c, restParts[1] as "hyp" | "leg");
      }
      case "prop":
        return makeProp(
          Number(restParts[0]),
          Number(restParts[1]),
          Number(restParts[2]),
          Number(restParts[3]) as 0 | 1 | 2 | 3
        );
      case "exprule":
        return makeExpRule(restParts[0], Number(restParts[1]), Number(restParts[2]));
      case "gcd": {
        const [a, b] = rest.split(",").map(Number);
        return makeGcd(a, b);
      }
      case "lcm": {
        const [a, b] = rest.split(",").map(Number);
        return makeLcm(a, b);
      }
      case "denom": {
        const [d1, d2] = rest.split(",").map(Number);
        return makeDenom(ri(1, d1 - 1), d1, ri(1, d2 - 1), d2);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/* ---------- fact sets (mastery model) ---------- */

/** Above this size a topic is treated as open-ended (no mastery set). */
const FACT_SET_CAP = 150;

function enumerateFacts(topic: TopicId, band: Band): string[] | null {
  const keys: string[] = [];
  switch (topic) {
    case "mul": {
      const [lo, hi] = R.mul[band];
      for (let a = lo; a <= hi; a++) for (let b = a; b <= hi; b++) keys.push(`mul:${a}×${b}`);
      return keys;
    }
    case "div": {
      const [lo, hi] = R.mul[band];
      for (let d = lo; d <= hi; d++) for (let q = lo; q <= hi; q++) keys.push(`div:${d * q}÷${d}`);
      return keys;
    }
    case "add": {
      const max = R.addMax[band];
      for (let a = 2; a <= max - 2; a++) for (let b = a; b <= max - a; b++) keys.push(`add:${a}+${b}`);
      return keys;
    }
    case "sub": {
      const max = R.addMax[band];
      for (let a = 4; a <= max; a++) for (let b = 1; b < a; b++) keys.push(`sub:${a}−${b}`);
      return keys;
    }
    case "sq":
      for (let n = 2; n <= 15; n++) keys.push(`sq:${n}`);
      return keys;
    case "cube":
      for (let n = 2; n <= 6; n++) keys.push(`cube:${n}`);
      return keys;
    case "sqrt":
      for (let n = 2; n <= 15; n++) keys.push(`sqrt:${n * n}`);
      return keys;
    case "pow":
      for (let b = 2; b <= 10; b++) keys.push(`pow:${b}^2`, `pow:${b}^3`);
      for (let b = 2; b <= 5; b++) keys.push(`pow:${b}^4`);
      return keys;
    case "pyth":
      for (const [a, b, c] of TRIPLES) {
        for (let k = 1; k * c <= 50; k++) {
          keys.push(`pyth:${a * k},${b * k},${c * k}:hyp`, `pyth:${a * k},${b * k},${c * k}:leg`);
        }
      }
      return keys;
    case "gcd": {
      const set = new Set<string>();
      for (const g of R.gcdFactors[band]) {
        for (const m of [2, 3, 4, 5]) {
          for (const n of [2, 3, 4, 5, 6]) {
            const a = g * m;
            const b = a === g * n ? g * 7 : g * n;
            set.add(`gcd:${Math.max(a, b)},${Math.min(a, b)}`);
          }
        }
      }
      return [...set];
    }
    case "lcm":
    case "denom": {
      const pool: readonly number[] = R.lcmPool[band];
      const set = new Set<string>();
      for (const a of pool) {
        for (const b of pool) {
          if (a === b || lcm(a, b) > R.lcmCap[band]) continue;
          set.add(`${topic}:${Math.min(a, b)},${Math.max(a, b)}`);
        }
      }
      return [...set];
    }
    default:
      // dbl, pow10, fracof, place, mul2x1, prop, exprule, congruence:
      // parameter space too large or non-recall — open-ended.
      return null;
  }
}

const setCache = new Map<string, string[] | null>();

/** Full fact-key set for a topic at a band, or null for open-ended topics. */
export function factSetFor(topic: TopicId, band: Band): string[] | null {
  const ck = `${topic}:${band}`;
  if (!setCache.has(ck)) {
    const keys = enumerateFacts(topic, band);
    setCache.set(ck, keys && keys.length <= FACT_SET_CAP ? keys : null);
  }
  return setCache.get(ck)!;
}

export function masteryProgress(
  topic: TopicId,
  band: Band,
  facts: Record<string, FactStat>
): { mastered: number; total: number } | null {
  const set = factSetFor(topic, band);
  if (!set) return null;
  return { mastered: set.filter((k) => isMastered(facts[k])).length, total: set.length };
}

/** Shuffled union of the selected topics' fact sets (Mastery Trial deck). */
export function makeTrialDeck(topics: TopicId[], band: Band): string[] {
  const keys = topics.flatMap((t) => factSetFor(t, band) ?? []);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
}

/** How many problems back a fact must wait before it can be served again. */
const RECENT_WINDOW = 4;

/**
 * Next problem for battles.
 * Topics with a fact set serve ~85% from the unmastered pool (facts you've
 * struggled with weigh double), ~15% from mastered facts for retention, and
 * never repeat anything from the last RECENT_WINDOW problems when avoidable.
 * Open-ended topics generate fresh, with an occasional re-serve of a
 * struggling (unmastered) fact.
 */
export function nextProblem(
  topics: TopicId[],
  band: Band,
  facts: Record<string, FactStat> = {},
  recent: string[] = []
): Problem {
  const topic: TopicId = topics.length ? pick(topics) : "mul";
  const avoid = new Set(recent.slice(-RECENT_WINDOW));

  const set = factSetFor(topic, band);
  if (set) {
    const unmastered = set.filter((k) => !isMastered(facts[k]));
    const pool =
      unmastered.length && (unmastered.length === set.length || Math.random() < 0.85)
        ? unmastered
        : set;
    const candidates = pool.filter((k) => !avoid.has(k));
    const weighted: string[] = [];
    for (const k of candidates.length ? candidates : pool) {
      weighted.push(k);
      const f = facts[k];
      if (f && (f.miss > 0 || f.avgMs > MASTERY_MS)) weighted.push(k);
    }
    const p = problemFromKey(pick(weighted));
    if (p) return p;
  }

  const struggling = Object.keys(facts).filter((k) => {
    if (!k.startsWith(`${topic}:`) || avoid.has(k) || isMastered(facts[k])) return false;
    const f = facts[k];
    return f.miss / f.n > 0.2 || f.avgMs > MASTERY_MS;
  });
  if (struggling.length && Math.random() < 0.3) {
    const p = problemFromKey(pick(struggling));
    if (p) return p;
  }
  for (let i = 0; i < 8; i++) {
    const p = GENERATORS[topic](band);
    if (!avoid.has(p.key)) return p;
  }
  return GENERATORS[topic](band);
}
