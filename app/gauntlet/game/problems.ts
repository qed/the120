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
import { judge, type AnswerRule, type EntryFormat } from "./answerRules";

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
  | "congruence"
  // Grade 9–12 (g912) — reuse numeric/choice engines only
  | "slope"
  | "linfn"
  | "evalquad"
  | "expquot"
  | "disc"
  | "dist"
  | "srt"
  | "sqrtbig"
  | "midpoint"
  // P4 — trig / precalc / calc (gauntletcontent.md forward inventory;
  // numeric/choice engines only — TF entries render as 2-option choice)
  | "refangle"
  | "trigval"
  | "cofunc"
  | "evallog"
  | "det2"
  | "limitsub"
  | "geoseries"
  | "dstd"
  | "chain"
  | "dpoint"
  | "critpt"
  | "defint"
  // C6 — new answer engines (fraction / short-expression / two-numbers):
  // the ranked picks that waited on input formats (#7, #21, #23, #25, #26)
  | "simpfrac"
  | "likterms"
  | "binom"
  | "slope2"
  | "factpair"
  | "dpower"
  | "dpoly"
  // C6 completion — the ±-unblocked single-number picks, the fraction
  // family, the percent family, and the factored-form entry
  | "intadd"
  | "intmul"
  | "evalexpr"
  | "solve1"
  | "solve2"
  | "pct2dec"
  | "dec2pct"
  | "pct2frac"
  | "fracadd"
  | "fracmul"
  | "fraccomp"
  | "factquad"
  // HS sweep batch 4 (2026-07-19) — algebra depth, trig reads, calc depth
  | "distlin"
  | "nextarith"
  | "nextgeo"
  | "expsolve"
  | "logrule"
  | "factgcf"
  | "suppcomp"
  | "coterm"
  | "trigq"
  | "recip"
  | "vasymp"
  | "hasymp"
  | "amp"
  | "midline"
  | "dsecond"
  | "veloc"
  | "antipow"
  | "triglim"
  | "ratiotest";

export type Band = "g34" | "g56" | "g78" | "g912";

export const BANDS: { id: Band; label: string }[] = [
  { id: "g34", label: "Grades 3–4" },
  { id: "g56", label: "Grades 5–6" },
  { id: "g78", label: "Grades 7–8" },
  { id: "g912", label: "Grades 9–12" },
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
  // Medium-rated in the doc (mental multi-step, not recall) — tier 2 so the
  // mastery/placement window is 6s, not 3s (Grade 12s were failing placement
  // here because 47×8 in 6s incl. typing is a Medium ask, not a fact recall)
  { id: "mul2x1", label: "2-digit × 1-digit", tier: 2 },
  { id: "place", label: "Place value", tier: 1 },
  { id: "fracof", label: "Fraction of a number", tier: 2 }, // Medium-rated (divide then multiply)
  { id: "sqrt", label: "Square roots", tier: 2 },
  { id: "pow", label: "Exponents", tier: 2 },
  { id: "exprule", label: "Exponent rules", tier: 2 },
  { id: "pyth", label: "Pythagorean triples", tier: 2 },
  { id: "prop", label: "Proportions", tier: 2 },
  { id: "gcd", label: "GCD", tier: 2 },
  { id: "lcm", label: "LCM", tier: 2 },
  { id: "denom", label: "Common denominator", tier: 2 },
  { id: "congruence", label: "Triangle congruence", tier: 2 },
  // Grade 9–12
  { id: "slope", label: "Slope from two points", tier: 2 },
  { id: "linfn", label: "Evaluate linear function", tier: 2 },
  { id: "evalquad", label: "Evaluate quadratic", tier: 2 },
  { id: "expquot", label: "Exponent quotient rule", tier: 2 },
  { id: "disc", label: "Discriminant & real roots", tier: 2 },
  { id: "dist", label: "Distance between points", tier: 2 },
  { id: "srt", label: "Special right triangles", tier: 2 },
  { id: "sqrtbig", label: "Simplify square roots", tier: 2 }, // √529 is a compute, not a recall
  { id: "midpoint", label: "Midpoint x-coordinate", tier: 2 },
  // P4 — trig / precalc / calc
  { id: "refangle", label: "Reference angles", tier: 2 },
  { id: "trigval", label: "Exact trig values", tier: 1 },
  { id: "cofunc", label: "Cofunction complements", tier: 2 },
  { id: "evallog", label: "Evaluate logarithms", tier: 1 },
  { id: "det2", label: "2×2 determinants", tier: 2 },
  { id: "limitsub", label: "Limits by substitution", tier: 2 },
  { id: "geoseries", label: "Geometric series convergence", tier: 2 },
  { id: "dstd", label: "Derivative table", tier: 1 },
  { id: "chain", label: "Chain rule (linear inner)", tier: 2 },
  { id: "dpoint", label: "Derivative at a point", tier: 2 },
  { id: "critpt", label: "Critical points", tier: 2 },
  { id: "defint", label: "Definite integrals", tier: 2 },
  // C6 answer-engine topics
  { id: "simpfrac", label: "Simplify fractions", tier: 2 },
  { id: "likterms", label: "Combine like terms", tier: 2 },
  { id: "binom", label: "Multiply binomials", tier: 2 },
  { id: "slope2", label: "Slope (fractions)", tier: 2 },
  { id: "factpair", label: "Sum & product pairs", tier: 2 },
  { id: "dpower", label: "Power rule", tier: 1 },
  { id: "dpoly", label: "Differentiate polynomials", tier: 2 },
  // C6 completion
  { id: "intadd", label: "Signed add & subtract", tier: 1 },
  { id: "intmul", label: "Sign rules ×/÷", tier: 1 },
  { id: "evalexpr", label: "Evaluate expressions", tier: 2 },
  { id: "solve1", label: "One-step equations", tier: 2 },
  { id: "solve2", label: "Two-step equations", tier: 2 },
  { id: "pct2dec", label: "Percent → decimal", tier: 1 },
  { id: "dec2pct", label: "Decimal → percent", tier: 1 },
  { id: "pct2frac", label: "Percent → fraction", tier: 2 },
  { id: "fracadd", label: "Add fractions", tier: 2 },
  { id: "fracmul", label: "Multiply fractions", tier: 2 },
  { id: "fraccomp", label: "Compare fractions", tier: 2 },
  { id: "factquad", label: "Factor quadratics", tier: 2 },
  // HS sweep batch 4
  { id: "distlin", label: "Distribute", tier: 1 },
  { id: "nextarith", label: "Arithmetic patterns", tier: 2 },
  { id: "nextgeo", label: "Geometric patterns", tier: 2 },
  { id: "expsolve", label: "Solve bˣ = k", tier: 1 },
  { id: "logrule", label: "Log product rule", tier: 2 },
  { id: "factgcf", label: "Factor out the GCF", tier: 2 },
  { id: "suppcomp", label: "Supplements & complements", tier: 2 },
  { id: "coterm", label: "Coterminal angles", tier: 2 },
  { id: "trigq", label: "Trig beyond Q1", tier: 2 },
  { id: "recip", label: "Reciprocal trig", tier: 2 },
  { id: "vasymp", label: "Vertical asymptotes", tier: 1 },
  { id: "hasymp", label: "Horizontal asymptotes", tier: 2 },
  { id: "amp", label: "Amplitude", tier: 1 },
  { id: "midline", label: "Midline", tier: 1 },
  { id: "dsecond", label: "Second derivatives", tier: 2 },
  { id: "veloc", label: "Velocity", tier: 2 },
  { id: "antipow", label: "Antiderivative power rule", tier: 1 },
  { id: "triglim", label: "Special trig limits", tier: 2 },
  { id: "ratiotest", label: "Ratio test", tier: 1 },
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
  /** C6 input format; defaults to single-number (numeric) / multiple-choice */
  entry?: EntryFormat;
  /** C6 accepted-answer rule; defaults to int-exact (numeric) / mc (choice) */
  rule?: AnswerRule;
  /** short-expression only: the token row's alphabet (beyond digits) */
  alphabet?: string[];
};

/** Resolved input format for a problem (legacy problems carry no entry field). */
export const entryOf = (p: Problem): EntryFormat =>
  p.entry ?? (p.kind === "choice" ? "multiple-choice" : "single-number");

/** Topic id off a fact key ("mul:7×8" → "mul"). */
export const topicOfKey = (key: string): TopicId => key.split(":")[0] as TopicId;

/** Topics answered on the Enter-to-submit surfaces — typing costs real seconds. */
const ENTER_ENTRY_TOPICS: ReadonlySet<TopicId> = new Set([
  "simpfrac", "likterms", "binom", "slope2", "factpair", "dpower", "dpoly",
  "pct2dec", "pct2frac", "fracadd", "fracmul", "factquad", "distlin", "factgcf",
]);

/**
 * Per-topic mastery window (tester feedback 2026-07-18: a flat 3s bar is
 * brutal in the later grades). Tier-1 recall keeps the 3s bar; tier-2 skills
 * get the doc's Medium band (6s); Enter-entry formats add typing time.
 */
export function masteryMsFor(topic: TopicId): number {
  const t = TOPICS.find((x) => x.id === topic);
  const base = !t || t.tier === 1 ? MASTERY_MS : MASTERY_MS * 2;
  return base + (ENTER_ENTRY_TOPICS.has(topic) ? 2500 : 0);
}

/** One judging door for every surface: the entry's rule decides. */
export const judgeAnswer = (p: Problem, entered: string): boolean =>
  judge(p.rule ?? (p.kind === "choice" ? "mc" : "int-exact"), entered, p.answer);

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
  mul: { g34: [2, 6], g56: [2, 10], g78: [2, 12], g912: [2, 15] },
  addMax: { g34: 12, g56: 20, g78: 50, g912: 100 },
  gcdFactors: {
    g34: [2, 3, 4, 5],
    g56: [2, 3, 4, 5, 6, 7],
    g78: [2, 3, 4, 5, 6, 7, 8, 9],
    g912: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  lcmPool: {
    g34: [2, 3, 4, 5, 6],
    g56: [2, 3, 4, 5, 6, 8, 10],
    g78: [2, 3, 4, 5, 6, 8, 9, 10, 12],
    g912: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15],
  },
  lcmCap: { g34: 40, g56: 90, g78: 144, g912: 240 },
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

/* ---------- Grade 9–12 (numeric/choice engines only) ---------- */

/** Signed term for readable prompts, e.g. 3 → "+ 3", -3 → "− 3" (unicode minus). */
const signed = (n: number) => (n < 0 ? `− ${-n}` : `+ ${n}`);

// slope from two points — integer slope only (dy divisible by dx)
function makeSlope(x1: number, y1: number, x2: number, y2: number): Problem {
  return {
    topic: "slope",
    key: `slope:${x1},${y1},${x2},${y2}`,
    prompt: `Slope of the line through (${x1}, ${y1}) and (${x2}, ${y2})`,
    answer: String((y2 - y1) / (x2 - x1)),
    kind: "numeric",
  };
}
function genSlope(): Problem {
  const m = pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]);
  const x1 = ri(-6, 6);
  const dx = ri(1, 6);
  const x2 = x1 + dx;
  const y1 = ri(-9, 9);
  return makeSlope(x1, y1, x2, y1 + m * dx);
}

// evaluate linear function f(x) = a·x + b at x0 (a,b nonzero for clean prompts)
function makeLinfn(a: number, b: number, x0: number): Problem {
  return {
    topic: "linfn",
    key: `linfn:${a},${b},${x0}`,
    prompt: `If f(x) = ${a}x ${signed(b)}, what is f(${x0})?`,
    answer: String(a * x0 + b),
    kind: "numeric",
  };
}
function genLinfn(): Problem {
  const a = ri(2, 9);
  const b = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  return makeLinfn(a, b, ri(-6, 9));
}

// evaluate quadratic f(x) = x² + b·x + c at x0
function makeEvalquad(b: number, c: number, x0: number): Problem {
  return {
    topic: "evalquad",
    key: `evalquad:${b},${c},${x0}`,
    prompt: `If f(x) = x² ${signed(b)}x ${signed(c)}, what is f(${x0})?`,
    answer: String(x0 * x0 + b * x0 + c),
    kind: "numeric",
  };
}
function genEvalquad(): Problem {
  const b = pick([-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6]);
  const c = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  return makeEvalquad(b, c, ri(-5, 5));
}

// exponent quotient rule — base^e1 ÷ base^e2 = base^n · n = e1 − e2
function makeExpQuot(base: string, e1: number, e2: number): Problem {
  return {
    topic: "expquot",
    key: `expquot:${base}:${e1}:${e2}`,
    prompt: `${base}${sup(e1)} ÷ ${base}${sup(e2)} = ${base}ⁿ · n = ?`,
    answer: String(e1 - e2),
    kind: "numeric",
  };
}
function genExpQuot(): Problem {
  const e1 = ri(3, 9);
  const e2 = ri(1, e1 - 1);
  return makeExpQuot(pick(["2", "3", "5", "10", "x"]), e1, e2);
}

// discriminant sign / real-root count (choice: 0, 1, or 2 real roots)
const ROOTCOUNTS = ["0", "1", "2"] as const;
function makeDisc(a: number, b: number, c: number): Problem {
  const d = b * b - 4 * a * c;
  return {
    topic: "disc",
    key: `disc:${a},${b},${c}`,
    prompt: `How many real solutions does ${a}x² ${signed(b)}x ${signed(c)} = 0 have?`,
    answer: d > 0 ? "2" : d === 0 ? "1" : "0",
    kind: "choice",
    choices: [...ROOTCOUNTS],
  };
}
function genDisc(): Problem {
  const a = ri(1, 5);
  const b = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const c = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  return makeDisc(a, b, c);
}

// distance between two grid points — integer distance via Pythagorean triples
function makeDist(x1: number, y1: number, x2: number, y2: number): Problem {
  const d = Math.round(Math.hypot(x2 - x1, y2 - y1));
  return {
    topic: "dist",
    key: `dist:${x1},${y1},${x2},${y2}`,
    prompt: `Distance between (${x1}, ${y1}) and (${x2}, ${y2})`,
    answer: String(d),
    kind: "numeric",
  };
}
function genDist(): Problem {
  const [a0, b0, c0] = pick(TRIPLES);
  const k = ri(1, Math.max(1, Math.floor(50 / c0)));
  const [dx, dy] = [a0 * k * pick([1, -1]), b0 * k * pick([1, -1])];
  const x1 = ri(-9, 9);
  const y1 = ri(-9, 9);
  return makeDist(x1, y1, x1 + dx, y1 + dy);
}

// special right triangle (30-60-90): short leg s, hypotenuse 2s (closed set)
function makeSrt(given: "short" | "hyp", s: number): Problem {
  if (given === "short") {
    return {
      topic: "srt",
      key: `srt:short:${s}`,
      prompt: `In a 30-60-90 right triangle the shorter leg is ${s}. How long is the hypotenuse?`,
      answer: String(2 * s),
      kind: "numeric",
    };
  }
  return {
    topic: "srt",
    key: `srt:hyp:${s}`,
    prompt: `In a 30-60-90 right triangle the hypotenuse is ${2 * s}. How long is the shorter leg?`,
    answer: String(s),
    kind: "numeric",
  };
}
const genSrt = () => makeSrt(pick(["short", "hyp"] as const), ri(1, 12));

// simplify a perfect-square radical to an integer — larger radicands than sqrt
function makeSqrtBig(root: number): Problem {
  return {
    topic: "sqrtbig",
    key: `sqrtbig:${root * root}`,
    prompt: `√${root * root}`,
    answer: String(root),
    kind: "numeric",
  };
}
const genSqrtBig = () => makeSqrtBig(ri(12, 30));

// midpoint x-coordinate — pick coords whose x-sum is even (integer answer)
function makeMidpoint(x1: number, y1: number, x2: number, y2: number): Problem {
  return {
    topic: "midpoint",
    key: `midpoint:${x1},${y1},${x2},${y2}`,
    prompt: `What is the x-coordinate of the midpoint of (${x1}, ${y1}) and (${x2}, ${y2})?`,
    answer: String((x1 + x2) / 2),
    kind: "numeric",
  };
}
function genMidpoint(): Problem {
  const x1 = ri(-9, 9);
  let x2 = ri(-9, 9);
  if ((x1 + x2) % 2 !== 0) x2 += x2 < 9 ? 1 : -1;
  return makeMidpoint(x1, ri(-9, 9), x2, ri(-9, 9));
}

/* ---------- P4 · trig / precalc / calc (gauntletcontent.md) ---------- */

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const subs = (n: number) => String(n).split("").map((d) => SUB[+d]).join("");

// trig.reference-angle — angles multiples of 5 in (90°, 360°) off the axes;
// Quadrant I excluded (answer would be the angle itself, a giveaway)
function makeRefangle(theta: number): Problem {
  const ref = theta < 180 ? 180 - theta : theta < 270 ? theta - 180 : 360 - theta;
  return {
    topic: "refangle",
    key: `refangle:${theta}`,
    prompt: `What is the reference angle of ${theta}°?`,
    answer: String(ref),
    kind: "numeric",
  };
}
function genRefangle(): Problem {
  let theta = 0;
  do theta = ri(19, 71) * 5; // 95°..355°
  while (theta === 180 || theta === 270);
  return makeRefangle(theta);
}

// geo.exact-trig-values — the 0°/30°/45°/60°/90° table with fixed option pools
const TRIGTABLE: Record<string, Record<number, string>> = {
  sin: { 0: "0", 30: "1/2", 45: "√2/2", 60: "√3/2", 90: "1" },
  cos: { 0: "1", 30: "√3/2", 45: "√2/2", 60: "1/2", 90: "0" },
  tan: { 0: "0", 30: "√3/3", 45: "1", 60: "√3" },
};
const TRIGPOOL: Record<string, string[]> = {
  sin: ["0", "1/2", "√2/2", "√3/2", "1"],
  cos: ["0", "1/2", "√2/2", "√3/2", "1"],
  tan: ["0", "√3/3", "1", "√3"],
};
function makeTrigval(fn: string, angle: number): Problem {
  const answer = TRIGTABLE[fn][angle];
  const others = TRIGPOOL[fn].filter((v) => v !== answer);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const choices = [answer, ...others.slice(0, 3)].sort(() => Math.random() - 0.5);
  return {
    topic: "trigval",
    key: `trigval:${fn}:${angle}`,
    prompt: `${fn} ${angle}° = ?`,
    answer,
    kind: "choice",
    choices,
  };
}
function genTrigval(): Problem {
  const fn = pick(["sin", "cos", "tan"]);
  const angle = pick(fn === "tan" ? [0, 30, 45, 60] : [0, 30, 45, 60, 90]);
  return makeTrigval(fn, angle);
}

// geo.trig-cofunction — sin θ = cos(90° − θ), both directions
function makeCofunc(fn: "sin" | "cos", angle: number): Problem {
  const other = fn === "sin" ? "cos" : "sin";
  return {
    topic: "cofunc",
    key: `cofunc:${fn}:${angle}`,
    prompt: `${fn} ${angle}° = ${other} ?°`,
    answer: String(90 - angle),
    kind: "numeric",
  };
}
function genCofunc(): Problem {
  return makeCofunc(pick(["sin", "cos"]), ri(1, 17) * 5);
}

// alg2.evaluate-log — memorized powers; negative band (log₂ ½) rides the ± key
const LOGBASES: Record<number, [number, number]> = { 2: [-2, 6], 3: [-1, 4], 5: [-1, 3], 10: [0, 3] };
function makeEvallog(base: number, exp: number): Problem {
  const arg = exp >= 0 ? String(Math.pow(base, exp)) : `1/${Math.pow(base, -exp)}`;
  return {
    topic: "evallog",
    key: `evallog:${base}^${exp}`,
    prompt: `log${subs(base)} ${arg} = ?`,
    answer: String(exp),
    kind: "numeric",
  };
}
function genEvallog(): Problem {
  const base = pick([2, 3, 5, 10]);
  const [lo, hi] = LOGBASES[base];
  return makeEvallog(base, ri(lo, hi));
}

// trig.determinant-2x2 — ad − bc, nonzero in the base band
function makeDet2(a: number, b: number, c: number, d: number): Problem {
  return {
    topic: "det2",
    key: `det2:${a},${b},${c},${d}`,
    prompt: `det [${a} ${b}; ${c} ${d}] = ?`,
    answer: String(a * d - b * c),
    kind: "numeric",
  };
}
function genDet2(): Problem {
  for (let i = 0; i < 20; i++) {
    const [a, b, c, d] = [ri(-9, 9), ri(-9, 9), ri(-9, 9), ri(-9, 9)];
    const det = a * d - b * c;
    if (det !== 0 && Math.abs(det) <= 99) return makeDet2(a, b, c, d);
  }
  return makeDet2(3, 1, 4, 2);
}

// trig.limit-by-substitution — continuity recognition + substitute-and-evaluate
function makeLimitsub(a: number, b: number, c: number, p: number): Problem {
  const terms =
    (a === 0 ? "" : a === 1 ? "x²" : a === -1 ? "−x²" : `${a}x²`) +
    (b === 0 ? "" : ` ${signed(b)}x`) +
    (c === 0 ? "" : ` ${signed(c)}`);
  return {
    topic: "limitsub",
    key: `limitsub:${a},${b},${c},${p}`,
    prompt: `lim (x → ${p}) of ${terms.trim()}`,
    answer: String(a * p * p + b * p + c),
    kind: "numeric",
  };
}
function genLimitsub(): Problem {
  for (let i = 0; i < 20; i++) {
    const a = pick([-2, -1, 1, 1, 2]); // degree ≤ 2, keep x² common
    const b = ri(-5, 5);
    const c = pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]);
    const p = ri(-4, 4);
    const ans = a * p * p + b * p + c;
    if (ans >= -40 && ans <= 60) return makeLimitsub(a, b, c, p);
  }
  return makeLimitsub(1, 3, -1, 2);
}

// trig.geometric-series-converges — |r| < 1 judgment; r = ±1 is the trap.
// First terms fixed per |r| so 4 leading terms stay integers.
const GEOSERIES: Record<string, [number, number, number, number]> = {
  "1/2": [8, 4, 2, 1],
  "1/3": [27, 9, 3, 1],
  "2/3": [27, 18, 12, 8],
  "3/4": [64, 48, 36, 27],
  "1": [5, 5, 5, 5],
  "3/2": [8, 12, 18, 27],
  "2": [1, 2, 4, 8],
  "3": [1, 3, 9, 27],
};
function makeGeoseries(ratio: string, negative: boolean): Problem {
  const terms = GEOSERIES[ratio];
  const shown = terms
    .map((t, i) => (i === 0 ? String(t) : negative && i % 2 === 1 ? `− ${t}` : `+ ${t}`))
    .join(" ");
  const converges = ["1/2", "1/3", "2/3", "3/4"].includes(ratio);
  return {
    topic: "geoseries",
    key: `geoseries:${negative ? "-" : ""}${ratio}`,
    prompt: `True or false: ${shown} + ⋯ converges`,
    answer: converges ? "True" : "False",
    kind: "choice",
    choices: ["True", "False"],
  };
}
function genGeoseries(): Problem {
  return makeGeoseries(pick(Object.keys(GEOSERIES)), Math.random() < 0.5);
}

// calcab.derivative-standard-table — fixed option pools per fact family
const DSTD: Record<string, { prompt: string; answer: string; pool: string[] }> = {
  sin: { prompt: "d/dx sin x = ?", answer: "cos x", pool: ["cos x", "−cos x", "sin x", "−sin x"] },
  cos: { prompt: "d/dx cos x = ?", answer: "−sin x", pool: ["−sin x", "sin x", "cos x", "−cos x"] },
  tan: { prompt: "d/dx tan x = ?", answer: "sec²x", pool: ["sec²x", "sec x tan x", "cot x", "−sec²x"] },
  exp: { prompt: "d/dx eˣ = ?", answer: "eˣ", pool: ["eˣ", "x·eˣ", "eˣ⁻¹", "ln x"] },
  ln: { prompt: "d/dx ln x = ?", answer: "1/x", pool: ["1/x", "x", "ln x", "1/x²"] },
  recip: { prompt: "d/dx 1/x = ?", answer: "−1/x²", pool: ["−1/x²", "1/x²", "−1/x", "ln x"] },
  sqrt: { prompt: "d/dx √x = ?", answer: "1/(2√x)", pool: ["1/(2√x)", "2√x", "√x/2", "1/√x"] },
};
function makeDstd(fam: string): Problem {
  const f = DSTD[fam];
  return {
    topic: "dstd",
    key: `dstd:${fam}`,
    prompt: f.prompt,
    answer: f.answer,
    kind: "choice",
    choices: [...f.pool].sort(() => Math.random() - 0.5),
  };
}
const genDstd = (): Problem => makeDstd(pick(Object.keys(DSTD)));

// calcab.chain-rule-linear-inner — outer from the table, inner ax; options
// permute the coefficient (missing/present), sign, and inner argument
function makeChain(outer: "sin" | "cos" | "exp", a: number): Problem {
  if (outer === "exp") {
    return {
      topic: "chain",
      key: `chain:exp:${a}`,
      prompt: `d/dx e^(${a}x) = ?`,
      answer: `${a}e^(${a}x)`,
      kind: "choice",
      choices: [`${a}e^(${a}x)`, `e^(${a}x)`, `${a}eˣ`, `${a}x·e^(${a}x)`].sort(() => Math.random() - 0.5),
    };
  }
  const other = outer === "sin" ? "cos" : "sin";
  const sign = outer === "sin" ? "" : "−";
  const flip = outer === "sin" ? "−" : "";
  return {
    topic: "chain",
    key: `chain:${outer}:${a}`,
    prompt: `d/dx ${outer}(${a}x) = ?`,
    answer: `${sign}${a} ${other} ${a}x`,
    kind: "choice",
    choices: [
      `${sign}${a} ${other} ${a}x`,
      `${sign}${other} ${a}x`,
      `${flip}${a} ${other} ${a}x`,
      `${sign}${a} ${other} x`,
    ].sort(() => Math.random() - 0.5),
  };
}
const genChain = (): Problem => makeChain(pick(["sin", "cos", "exp"]), ri(2, 9));

// calcab.derivative-at-point — monomials axⁿ; f′(x₀) = a·n·x₀ⁿ⁻¹
function makeDpoint(a: number, n: number, x0: number): Problem {
  return {
    topic: "dpoint",
    key: `dpoint:${a},${n},${x0}`,
    prompt: `f(x) = ${a === 1 ? "" : a}x${sup(n)}. f′(${x0}) = ?`,
    answer: String(a * n * Math.pow(x0, n - 1)),
    kind: "numeric",
  };
}
function genDpoint(): Problem {
  const a = ri(1, 5);
  const n = ri(2, 4);
  const x0 = pick([-3, -2, -1, 1, 2, 3]);
  return makeDpoint(a, n, x0);
}

// calcab.critical-point-quadratic — x = −b/2a; c is decorative but the key
// must rebuild the exact prompt, so c derives deterministically from (a, x*)
function makeCritpt(a: number, xstar: number): Problem {
  const b = -2 * a * xstar;
  const c = ((a + Math.abs(xstar)) % 9) + 1;
  return {
    topic: "critpt",
    key: `critpt:${a},${xstar}`,
    prompt: `f(x) = ${a === 1 ? "" : a}x² ${signed(b)}x ${signed(c)}. Critical point at x = ?`,
    answer: String(xstar),
    kind: "numeric",
  };
}
function genCritpt(): Problem {
  return makeCritpt(ri(1, 4), pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
}

// calcab.definite-integral-power — ∫₀ᵇ axⁿ dx with a = k(n+1) (integer
// antiderivative), zero lower bound, answers ∈ [1, 99]
function makeDefint(a: number, n: number, bnd: number): Problem {
  const k = a / (n + 1);
  return {
    topic: "defint",
    key: `defint:${a},${n},${bnd}`,
    prompt: `∫${subs(0)}${sup(bnd)} ${a === 1 ? "" : a}x${n === 1 ? "" : sup(n)} dx = ?`,
    answer: String(k * Math.pow(bnd, n + 1)),
    kind: "numeric",
  };
}
function genDefint(): Problem {
  for (let i = 0; i < 20; i++) {
    const n = ri(1, 3);
    const k = ri(1, 4);
    const bnd = ri(1, 4);
    const ans = k * Math.pow(bnd, n + 1);
    if (ans >= 1 && ans <= 99) return makeDefint(k * (n + 1), n, bnd);
  }
  return makeDefint(3, 2, 2);
}

/* ---------- C6 · answer-engine topics (gauntletcontent.md ranked picks) ---------- */

// prealg.simplify-fraction (#7) — (a·g)/(b·g) with gcd(a,b)=1; frac-lowest-terms
function makeSimpfrac(a: number, b: number, g: number): Problem {
  return {
    topic: "simpfrac",
    key: `simpfrac:${a * g}/${b * g}`,
    prompt: `Write ${a * g}/${b * g} in lowest terms`,
    answer: `${a}/${b}`,
    kind: "numeric",
    entry: "fraction",
    rule: "frac-lowest-terms",
  };
}
function genSimpfrac(): Problem {
  for (let i = 0; i < 30; i++) {
    const a = ri(1, 9);
    const b = ri(2, 9);
    const g = ri(2, 6);
    if (gcd(a, b) === 1 && a !== b && b * g <= 54) return makeSimpfrac(a, b, g);
  }
  return makeSimpfrac(3, 4, 2);
}

// prealg.combine-like-terms (#23) — 2–3 like terms, coeffs [1,12], sums ≤ 99
function makeLikterms(coeffs: number[]): Problem {
  const sum = coeffs.reduce((s, c) => s + c, 0);
  return {
    topic: "likterms",
    key: `likterms:${coeffs.join("+")}`,
    prompt: `Simplify ${coeffs.map((c) => `${c}x`).join(" + ")}`,
    answer: `${sum}x`,
    kind: "numeric",
    entry: "short-expression",
    rule: "expr-commutative-ws",
    alphabet: ["x"],
  };
}
function genLikterms(): Problem {
  const n = pick([2, 2, 3]);
  const coeffs = Array.from({ length: n }, () => ri(1, 12));
  return makeLikterms(coeffs);
}

// alg1.multiply-binomials (#21) — monic (x+a)(x+b); expanded trinomial answer
function makeBinom(a: number, b: number): Problem {
  const mid = a + b;
  const midStr = mid === 0 ? "" : mid > 0 ? `+${mid}x` : `${mid}x`;
  const cStr = a * b > 0 ? `+${a * b}` : `${a * b}`;
  const term = (v: number) => (v > 0 ? `x + ${v}` : `x − ${-v}`);
  return {
    topic: "binom",
    key: `binom:${Math.min(a, b)},${Math.max(a, b)}`,
    prompt: `Multiply: (${term(a)})(${term(b)})`,
    answer: `x^2${midStr}${cStr}`,
    kind: "numeric",
    entry: "short-expression",
    rule: "expr-commutative-ws",
    alphabet: ["x", "^", "+", "-"],
  };
}
function genBinom(): Problem {
  // base band all-positive; signed band mixes ± (vanishing middle excluded)
  for (let i = 0; i < 20; i++) {
    const signed = Math.random() < 0.4;
    const a = signed ? pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]) : ri(1, 9);
    const b = signed ? pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]) : ri(1, 9);
    if (a + b !== 0) return makeBinom(a, b);
  }
  return makeBinom(3, 4);
}

// alg1.slope-two-points (#25) — non-integer slopes in lowest terms; fraction
function makeSlope2(x1: number, y1: number, x2: number, y2: number): Problem {
  const dy = y2 - y1;
  const dx = x2 - x1;
  const g = gcd(Math.abs(dy), Math.abs(dx));
  const sign = dy * dx < 0 ? -1 : 1;
  return {
    topic: "slope2",
    key: `slope2:${x1},${y1},${x2},${y2}`,
    prompt: `Slope through (${x1}, ${y1}) and (${x2}, ${y2})`,
    answer: `${sign * Math.abs(dy / g)}/${Math.abs(dx / g)}`,
    kind: "numeric",
    entry: "fraction",
    rule: "frac-lowest-terms",
  };
}
function genSlope2(): Problem {
  for (let i = 0; i < 30; i++) {
    const q = ri(2, 9); // run (denominator), slope non-integer
    let p = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    if (Math.abs(p) % q === 0) continue; // integer slope — excluded band
    if (gcd(Math.abs(p), q) !== 1) continue; // keep the stated pair in lowest terms
    const x1 = ri(-9, 9 - q);
    const y1 = p > 0 ? ri(-9, 9 - p) : ri(-9 - p, 9);
    return makeSlope2(x1, y1, x1 + q, y1 + p);
  }
  return makeSlope2(1, 2, 4, 4);
}

// alg1.factor-pairs-sum-product (#26, no-MC-fallback) — pinned all-positive band
function makeFactpair(m: number, n: number): Problem {
  return {
    topic: "factpair",
    key: `factpair:${Math.min(m, n)},${Math.max(m, n)}`,
    prompt: `Two numbers with sum ${m + n} and product ${m * n}`,
    answer: `${Math.min(m, n)},${Math.max(m, n)}`,
    kind: "numeric",
    entry: "two-numbers",
    rule: "pair-unordered",
  };
}
const genFactpair = (): Problem => makeFactpair(ri(2, 12), ri(2, 12));

// calcab.derivative-power-rule — d/dx xⁿ → nx^(n−1); n ∈ [2, 9]
function makeDpower(n: number): Problem {
  return {
    topic: "dpower",
    key: `dpower:${n}`,
    prompt: `d/dx x${sup(n)}`,
    answer: n === 2 ? "2x" : `${n}x^${n - 1}`,
    kind: "numeric",
    entry: "short-expression",
    rule: "expr-commutative-ws",
    alphabet: ["x", "^"],
  };
}
const genDpower = (): Problem => makeDpower(ri(2, 9));

// calcab.differentiate-polynomial — 3 terms, degree 2–3, coeffs [1,9]
function makeDpoly(a: number, b: number, c: number, deg: number): Problem {
  const lead = deg === 3 ? `${a}x³` : `${a}x²`;
  const dLead = deg === 3 ? `${3 * a}x^2` : `${2 * a}x`;
  return {
    topic: "dpoly",
    key: `dpoly:${deg},${a},${b},${c}`,
    prompt: `d/dx (${lead} + ${b}x − ${c})`,
    answer: `${dLead}+${b}`,
    kind: "numeric",
    entry: "short-expression",
    rule: "expr-commutative-ws",
    alphabet: ["x", "^", "+", "-"],
  };
}
const genDpoly = (): Problem => makeDpoly(ri(1, 9), ri(1, 9), ri(1, 9), pick([2, 3]));

/* ---------- C6 completion (gauntletcontent.md; ± pad + engines) ---------- */

const neg = (n: number) => (n < 0 ? `(−${-n})` : String(n));

// fk.integer-add-sub — operands [−20,20], all sign combos; answers [−40,40]
function makeIntadd(op: "add" | "sub", a: number, b: number): Problem {
  return {
    topic: "intadd",
    key: `intadd:${op},${a},${b}`,
    prompt: `${a < 0 ? `−${-a}` : a} ${op === "add" ? "+" : "−"} ${neg(b)}`,
    answer: String(op === "add" ? a + b : a - b),
    kind: "numeric",
  };
}
function genIntadd(): Problem {
  const a = ri(-20, 20);
  const b = ri(-20, 20);
  return makeIntadd(pick(["add", "sub"]), a, b);
}

// fk.integer-mul-div — factors [−12,12] excl 0/±1; division always exact
function makeIntmul(op: "mul" | "div", a: number, b: number): Problem {
  if (op === "mul") {
    return {
      topic: "intmul",
      key: `intmul:mul,${a},${b}`,
      prompt: `${neg(a)} × ${neg(b)}`,
      answer: String(a * b),
      kind: "numeric",
    };
  }
  return {
    topic: "intmul",
    key: `intmul:div,${a},${b}`,
    prompt: `${a < 0 ? `−${-a}` : a} ÷ ${neg(b)}`,
    answer: String(a / b),
    kind: "numeric",
  };
}
function genIntmul(): Problem {
  const mag = () => ri(2, 12) * pick([1, -1]);
  if (Math.random() < 0.5) return makeIntmul("mul", mag(), mag());
  const d = mag();
  const q = mag();
  return makeIntmul("div", d * q, d);
}

// prealg.evaluate-expression — ax+b, a(x+b), x²+a; signed band x ∈ [−9,−2]
function makeEvalexpr(form: "lin" | "paren" | "sq", a: number, b: number, x: number): Problem {
  const prompts = {
    lin: `${a}x + ${b} when x = ${x}`,
    paren: `${a}(x + ${b}) when x = ${x}`,
    sq: `x² + ${a} when x = ${x}`,
  };
  const answers = {
    lin: a * x + b,
    paren: a * (x + b),
    sq: x * x + a,
  };
  return {
    topic: "evalexpr",
    key: `evalexpr:${form},${a},${b},${x}`,
    prompt: prompts[form],
    answer: String(answers[form]),
    kind: "numeric",
  };
}
function genEvalexpr(): Problem {
  const form = pick(["lin", "paren", "sq"] as const);
  const x = Math.random() < 0.3 ? ri(-9, -2) : ri(2, 9); // signed band ~30%
  return makeEvalexpr(form, ri(1, 9), ri(1, 9), x);
}

// prealg.solve-one-step-equation — one inverse-operation read, all four ops
function makeSolve1(op: "add" | "sub" | "mul" | "div", p: number, q: number): Problem {
  switch (op) {
    case "add": // x + p = q
      return { topic: "solve1", key: `solve1:add,${p},${q}`, prompt: `x + ${p} = ${q}. x = ?`, answer: String(q - p), kind: "numeric" };
    case "sub": // x − p = q
      return { topic: "solve1", key: `solve1:sub,${p},${q}`, prompt: `x − ${p} = ${q}. x = ?`, answer: String(q + p), kind: "numeric" };
    case "mul": // p·x = q
      return { topic: "solve1", key: `solve1:mul,${p},${q}`, prompt: `${p}x = ${q}. x = ?`, answer: String(q / p), kind: "numeric" };
    case "div": // x ÷ p = q
      return { topic: "solve1", key: `solve1:div,${p},${q}`, prompt: `x ÷ ${p} = ${q}. x = ?`, answer: String(p * q), kind: "numeric" };
  }
}
function genSolve1(): Problem {
  const op = pick(["add", "sub", "mul", "div"] as const);
  if (op === "add") {
    const p = ri(2, 25);
    // signed band: x + 9 = 4 admits negative answers
    return makeSolve1("add", p, Math.random() < 0.25 ? ri(2, p - 1) : ri(p + 1, 50));
  }
  if (op === "sub") return makeSolve1("sub", ri(2, 25), ri(1, 25));
  if (op === "mul") {
    const a = ri(2, 12);
    return makeSolve1("mul", a, a * ri(2, 12));
  }
  return makeSolve1("div", ri(2, 12), ri(2, 12));
}

// prealg.solve-two-step-equation — ax + b = c; undo the constant, then the coefficient
function makeSolve2(a: number, b: number, x: number): Problem {
  return {
    topic: "solve2",
    key: `solve2:${a},${b},${x}`,
    prompt: `${a}x ${signed(b)} = ${a * x + b}. x = ?`,
    answer: String(x),
    kind: "numeric",
  };
}
function genSolve2(): Problem {
  for (let i = 0; i < 20; i++) {
    const a = ri(2, 9);
    const b = pick([-15, -12, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15]);
    const x = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    if (Math.abs(a * x + b) <= 99) return makeSolve2(a, b, x);
  }
  return makeSolve2(3, 5, 5);
}

// prealg.percent-to-decimal — shift the point; decimal entry, dec-exact
function makePct2dec(p: number): Problem {
  return {
    topic: "pct2dec",
    key: `pct2dec:${p}`,
    prompt: `Write ${p}% as a decimal`,
    answer: String(p / 100),
    kind: "numeric",
    entry: "decimal",
    rule: "dec-exact",
  };
}
const genPct2dec = (): Problem => makePct2dec(ri(1, 150));

// prealg.decimal-to-percent — the percent NUMBER, so plain single-number
function makeDec2pct(p: number): Problem {
  return {
    topic: "dec2pct",
    key: `dec2pct:${p}`,
    prompt: `Write ${p / 100} as a percent (number only)`,
    answer: String(p),
    kind: "numeric",
  };
}
const genDec2pct = (): Problem => makeDec2pct(ri(1, 150));

// prealg.percent-to-fraction — over 100 and reduce; gcd(p,100) ≥ 4 always
function makePct2frac(p: number): Problem {
  const g = gcd(p, 100);
  return {
    topic: "pct2frac",
    key: `pct2frac:${p}`,
    prompt: `Write ${p}% as a fraction in lowest terms`,
    answer: `${p / g}/${100 / g}`,
    kind: "numeric",
    entry: "fraction",
    rule: "frac-lowest-terms",
  };
}
function genPct2frac(): Problem {
  for (let i = 0; i < 30; i++) {
    const p = ri(1, 99);
    if (gcd(p, 100) >= 4) return makePct2frac(p);
  }
  return makePct2frac(40);
}

// prealg.fraction-add-unlike — LCD ≤ 24; lowest-terms answers, improper allowed
const FRACDENOMS = [2, 3, 4, 5, 6, 8, 10, 12];
function makeFracadd(n1: number, d1: number, n2: number, d2: number): Problem {
  const L = lcm(d1, d2);
  const num = n1 * (L / d1) + n2 * (L / d2);
  const g = gcd(num, L);
  return {
    topic: "fracadd",
    key: `fracadd:${n1}/${d1}+${n2}/${d2}`,
    prompt: `${n1}/${d1} + ${n2}/${d2}`,
    answer: `${num / g}/${L / g}`,
    kind: "numeric",
    entry: "fraction",
    rule: "frac-lowest-terms",
  };
}
function genFracadd(): Problem {
  for (let i = 0; i < 30; i++) {
    const d1 = pick(FRACDENOMS);
    const d2 = pick(FRACDENOMS);
    if (d1 === d2 || lcm(d1, d2) > 24) continue;
    const n1 = ri(1, d1 - 1);
    const n2 = ri(1, d2 - 1);
    const L = lcm(d1, d2);
    if ((n1 * (L / d1) + n2 * (L / d2)) % L === 0) continue; // integer sums are a different shape
    return makeFracadd(n1, d1, n2, d2);
  }
  return makeFracadd(1, 2, 1, 3);
}

// prealg.fraction-multiply — at least one cross-cancellation; denominator ≤ 24
function makeFracmul(n1: number, d1: number, n2: number, d2: number): Problem {
  const num = n1 * n2;
  const den = d1 * d2;
  const g = gcd(num, den);
  return {
    topic: "fracmul",
    key: `fracmul:${n1}/${d1}×${n2}/${d2}`,
    prompt: `${n1}/${d1} × ${n2}/${d2}`,
    answer: `${num / g}/${den / g}`,
    kind: "numeric",
    entry: "fraction",
    rule: "frac-lowest-terms",
  };
}
function genFracmul(): Problem {
  for (let i = 0; i < 40; i++) {
    const [n1, d1, n2, d2] = [ri(1, 9), ri(2, 9), ri(1, 9), ri(2, 9)];
    if (gcd(n1, d2) === 1 && gcd(n2, d1) === 1) continue; // need a cross-cancellation
    const den = (d1 * d2) / gcd(n1 * n2, d1 * d2);
    if (den > 24 || den === 1) continue; // lowest-terms denominator ≤ 24, keep fractional
    return makeFracmul(n1, d1, n2, d2);
  }
  return makeFracmul(2, 3, 3, 4);
}

// prealg.compare-fractions — verify a claimed inequality; cross-multiply
function makeFraccomp(n1: number, d1: number, n2: number, d2: number): Problem {
  return {
    topic: "fraccomp",
    key: `fraccomp:${n1}/${d1}>${n2}/${d2}`,
    prompt: `True or false: ${n1}/${d1} > ${n2}/${d2}`,
    answer: n1 * d2 > n2 * d1 ? "True" : "False",
    kind: "choice",
    choices: ["True", "False"],
    rule: "tf",
  };
}
function genFraccomp(): Problem {
  for (let i = 0; i < 40; i++) {
    const [d1, d2] = [ri(2, 12), ri(2, 12)];
    const n1 = ri(1, d1 - 1);
    const n2 = ri(1, d2 - 1);
    const diff = Math.abs(n1 / d1 - n2 / d2);
    if (diff === 0 || diff > 1 / 6) continue; // close enough to force cross-multiplication
    return makeFraccomp(n1, d1, n2, d2);
  }
  return makeFraccomp(3, 5, 2, 3);
}

// alg1.factor-simple-quadratic — pinned band: monic, both roots ∈ [1, 9]
function makeFactquad(r: number, s: number): Problem {
  const [lo, hi] = [Math.min(r, s), Math.max(r, s)];
  return {
    topic: "factquad",
    key: `factquad:${lo},${hi}`,
    prompt: `Factor: x² ${signed(lo + hi)}x ${signed(lo * hi)}`,
    answer: `(x+${lo})(x+${hi})`,
    kind: "numeric",
    entry: "short-expression",
    rule: "factored-commutative-ws",
    alphabet: ["x", "+", "(", ")"],
  };
}
const genFactquad = (): Problem => makeFactquad(ri(1, 9), ri(1, 9));

/* ---------- HS sweep batch 4 (gauntletcontent.md, 2026-07-19) ---------- */

// alg1.distribute-linear (pinned calibration) — Expand 3(x + 4) → 3x+12
function makeDistlin(a: number, c: number): Problem {
  return {
    topic: "distlin",
    key: `distlin:${a},${c}`,
    prompt: `Expand ${a}(x ${signed(c)})`,
    answer: `${a}x${a * c > 0 ? "+" : ""}${a * c}`,
    kind: "numeric",
    entry: "short-expression",
    rule: "expr-commutative-ws",
    alphabet: ["x", "+", "-"],
  };
}
const genDistlin = (): Problem =>
  makeDistlin(ri(2, 9), pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

// prealg.next-term-arithmetic — spot the common difference, apply once
function makeNextarith(a: number, d: number): Problem {
  const terms = [a, a + d, a + 2 * d, a + 3 * d];
  return {
    topic: "nextarith",
    key: `nextarith:${a},${d}`,
    prompt: `Next term: ${terms.join(", ")}, …`,
    answer: String(a + 4 * d),
    kind: "numeric",
  };
}
function genNextarith(): Problem {
  return makeNextarith(ri(1, 20), pick([2, 3, 4, 5, 6, 7, 8, 9]) * pick([1, -1]));
}

// alg1.next-term-geometric — spot the ratio, one product; answers ≤ 1000
function makeNextgeo(a: number, r: number, n: number): Problem {
  const terms = Array.from({ length: n }, (_, i) => a * Math.pow(r, i));
  return {
    topic: "nextgeo",
    key: `nextgeo:${a},${r},${n}`,
    prompt: `Next term: ${terms.join(", ")}, …`,
    answer: String(a * Math.pow(r, n)),
    kind: "numeric",
  };
}
function genNextgeo(): Problem {
  for (let i = 0; i < 20; i++) {
    const a = ri(1, 5);
    const r = pick([2, 3, 4, 5, 10]);
    const n = pick([3, 4]);
    if (a * Math.pow(r, n) <= 1000) return makeNextgeo(a, r, n);
  }
  return makeNextgeo(2, 3, 3);
}

// alg2.exponential-solve-common-base — 2ˣ = 32 → 5 (memorized powers)
function makeExpsolve(b: number, e: number): Problem {
  return {
    topic: "expsolve",
    key: `expsolve:${b}^${e}`,
    prompt: `${b}ˣ = ${Math.pow(b, e)}. x = ?`,
    answer: String(e),
    kind: "numeric",
  };
}
const genExpsolve = (): Problem => makeExpsolve(pick([2, 3, 4, 5, 10]), ri(2, 6));

// alg2.log-product-rule — log₆ 4 + log₆ 9 → 2 (sum of logs = log of the product)
function makeLogrule(b: number, m: number, n: number): Problem {
  const k = Math.round(Math.log(m * n) / Math.log(b));
  return {
    topic: "logrule",
    key: `logrule:${b},${Math.min(m, n)},${Math.max(m, n)}`,
    prompt: `log${subs(b)} ${m} + log${subs(b)} ${n} = ?`,
    answer: String(k),
    kind: "numeric",
  };
}
function genLogrule(): Problem {
  const set = factSetFor("logrule", "g912");
  const key = set![Math.floor(Math.random() * set!.length)];
  return problemFromKey(key)!;
}

// alg1.factor-gcf — Factor: 6x + 12 → 6(x+2); coefficients ≤ 72
function makeFactgcf(g: number, b: number): Problem {
  return {
    topic: "factgcf",
    key: `factgcf:${g},${b}`,
    prompt: `Factor: ${g}x ${signed(g * b)}`,
    answer: `${g}(x${b > 0 ? "+" : ""}${b})`,
    kind: "numeric",
    entry: "short-expression",
    rule: "factored-commutative-ws",
    alphabet: ["x", "+", "-", "(", ")"],
  };
}
function genFactgcf(): Problem {
  for (let i = 0; i < 20; i++) {
    const g = ri(2, 9);
    const b = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    if (Math.abs(g * b) <= 72) return makeFactgcf(g, b);
  }
  return makeFactgcf(6, 2);
}

// geo.supplement-complement — to 90° or to 180°, then subtract
function makeSuppcomp(kind: "supp" | "comp", theta: number): Problem {
  return {
    topic: "suppcomp",
    key: `suppcomp:${kind},${theta}`,
    prompt: `What is the ${kind === "supp" ? "supplement" : "complement"} of ${theta}°?`,
    answer: String((kind === "supp" ? 180 : 90) - theta),
    kind: "numeric",
  };
}
function genSuppcomp(): Problem {
  const kind = pick(["supp", "comp"] as const);
  return makeSuppcomp(kind, ri(1, kind === "supp" ? 35 : 17) * 5);
}

// trig.coterminal-angle — one or two ±360 adjustments into [0°, 360°)
function makeCoterm(theta: number): Problem {
  return {
    topic: "coterm",
    key: `coterm:${theta}`,
    prompt: `Which angle in [0°, 360°) is coterminal with ${theta}°?`,
    answer: String(((theta % 360) + 360) % 360),
    kind: "numeric",
  };
}
function genCoterm(): Problem {
  let theta = 0;
  do theta = ri(-144, 216) * 5; // [−720°, 1080°], multiples of 5
  while (theta >= 0 && theta < 360);
  return makeCoterm(theta);
}

// trig.exact-trig-any-quadrant — reference angle + ASTC sign on the Q1 table
const TRIGQ_ANGLES = [120, 135, 150, 210, 225, 240, 300, 315, 330];
const TRIGQ_ALT: Record<string, Record<number, string>> = {
  sin: { 30: "√3/2", 45: "1/2", 60: "1/2" },
  cos: { 30: "√3/2", 45: "1/2", 60: "1/2" },
  tan: { 30: "√3", 45: "√3", 60: "√3/3" },
};
function makeTrigq(fn: string, theta: number): Problem {
  const ref = theta < 180 ? 180 - theta : theta < 270 ? theta - 180 : 360 - theta;
  const mag = TRIGTABLE[fn][ref];
  const q = theta < 180 ? 2 : theta < 270 ? 3 : 4;
  const positive = fn === "sin" ? q === 2 : fn === "cos" ? q === 4 : q === 3;
  const answer = positive ? mag : `−${mag}`;
  const alt = TRIGQ_ALT[fn][ref];
  const choices = [mag, `−${mag}`, alt, `−${alt}`].sort(() => Math.random() - 0.5);
  return {
    topic: "trigq",
    key: `trigq:${fn}:${theta}`,
    prompt: `${fn} ${theta}° = ?`,
    answer,
    kind: "choice",
    choices,
  };
}
const genTrigq = (): Problem => makeTrigq(pick(["sin", "cos", "tan"]), pick(TRIGQ_ANGLES));

// trig.reciprocal-trig-value — one table recall + one flip; rationalized forms
const RECIP_TABLE: Record<string, Record<number, string>> = {
  csc: { 30: "2", 45: "√2", 60: "2√3/3", 90: "1" },
  sec: { 0: "1", 30: "2√3/3", 45: "√2", 60: "2" },
  cot: { 30: "√3", 45: "1", 60: "√3/3", 90: "0" },
};
const RECIP_BASE: Record<string, string> = { csc: "sin", sec: "cos", cot: "tan" };
const RECIP_POOL = ["0", "1", "2", "√2", "√3", "√3/3", "2√3/3", "1/2", "√2/2", "√3/2"];
function makeRecip(fn: string, theta: number): Problem {
  const answer = RECIP_TABLE[fn][theta];
  const flip = TRIGTABLE[RECIP_BASE[fn]]?.[theta]; // the classic reciprocal-forgotten trap
  const opts = new Set<string>([answer]);
  if (flip && flip !== answer) opts.add(flip);
  for (const p of RECIP_POOL) {
    if (opts.size >= 4) break;
    opts.add(p);
  }
  return {
    topic: "recip",
    key: `recip:${fn}:${theta}`,
    prompt: `${fn} ${theta}° = ?`,
    answer,
    kind: "choice",
    choices: [...opts].sort(() => Math.random() - 0.5),
  };
}
function genRecip(): Problem {
  const fn = pick(["csc", "sec", "cot"]);
  return makeRecip(fn, pick(Object.keys(RECIP_TABLE[fn]).map(Number)));
}

// trig.vertical-asymptote — the denominator-zero read with a sign flip
function makeVasymp(a: number, c: number): Problem {
  return {
    topic: "vasymp",
    key: `vasymp:${a},${c}`,
    prompt: `y = (x ${signed(c)})/(x ${signed(-a)}). Vertical asymptote at x = ?`,
    answer: String(a),
    kind: "numeric",
  };
}
function genVasymp(): Problem {
  const a = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  let c = 0;
  do c = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  while (c === -a); // no shared factor — that family is identify-hole's
  return makeVasymp(a, c);
}

// trig.horizontal-asymptote — degree compare + leading-coefficient division;
// n1 = 0 marks the lower-degree-numerator band (answer 0)
function makeHasymp(n1: number, c1: number, d1: number, c2: number): Problem {
  const num = n1 === 0 ? `${c1}` : `${n1}x ${signed(c1)}`;
  return {
    topic: "hasymp",
    key: `hasymp:${n1},${c1},${d1},${c2}`,
    prompt: `y = (${num})/(${d1}x ${signed(c2)}). Horizontal asymptote at y = ?`,
    answer: String(n1 === 0 ? 0 : n1 / d1),
    kind: "numeric",
  };
}
function genHasymp(): Problem {
  const c1 = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const c2 = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const d1 = ri(1, 5);
  if (Math.random() < 0.3) return makeHasymp(0, Math.abs(c1), d1, c2); // answer-0 band
  const r = pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  return makeHasymp(r * d1, c1, d1, c2);
}

// trig.amplitude-from-equation — the |a| read; b and the shift are decorative
function makeAmp(a: number, b: number, c: number, fn: string): Problem {
  return {
    topic: "amp",
    key: `amp:${a},${b},${c},${fn}`,
    prompt: `y = ${a < 0 ? `−${-a}` : a} ${fn}(${b}x) ${signed(c)}. Amplitude?`,
    answer: String(Math.abs(a)),
    kind: "numeric",
  };
}
function genAmp(): Problem {
  const nz = [-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return makeAmp(pick(nz), ri(2, 4), pick(nz), pick(["sin", "cos"]));
}

// trig.midline-from-equation — the constant-term read, sign and all
function makeMidline(a: number, b: number, c: number, fn: string): Problem {
  return {
    topic: "midline",
    key: `midline:${a},${b},${c},${fn}`,
    prompt: `y = ${a} ${fn}(${b}x) ${signed(c)}. The midline is y = ?`,
    answer: String(c),
    kind: "numeric",
  };
}
function genMidline(): Problem {
  const nz = [-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return makeMidline(ri(2, 9), ri(2, 4), pick(nz), pick(["sin", "cos"]));
}

// calcab.second-derivative-power — f = axⁿ → f″(x₀) = a·n·(n−1)·x₀ⁿ⁻²
function makeDsecond(a: number, n: number, x0: number): Problem {
  return {
    topic: "dsecond",
    key: `dsecond:${a},${n},${x0}`,
    prompt: `f(x) = ${a === 1 ? "" : a}x${sup(n)}. f″(${x0}) = ?`,
    answer: String(a * n * (n - 1) * Math.pow(x0, n - 2)),
    kind: "numeric",
  };
}
const genDsecond = (): Problem => makeDsecond(ri(1, 3), ri(3, 5), pick([-2, -1, 1, 2]));

// calcab.velocity-from-position — v = s′, then evaluate
function makeVeloc(deg: number, a: number, b: number, t: number): Problem {
  const s = deg === 3 ? `${a === 1 ? "" : a}t³ − ${b}t` : `${a === 1 ? "" : a}t² − ${b}t`;
  const v = deg === 3 ? 3 * a * t * t - b : 2 * a * t - b;
  return {
    topic: "veloc",
    key: `veloc:${deg},${a},${b},${t}`,
    prompt: `s(t) = ${s}. The velocity at t = ${t}?`,
    answer: String(v),
    kind: "numeric",
  };
}
function genVeloc(): Problem {
  for (let i = 0; i < 20; i++) {
    const deg = pick([2, 3]);
    const a = ri(1, 5);
    const b = ri(1, 5);
    const t = ri(1, 4);
    const v = deg === 3 ? 3 * a * t * t - b : 2 * a * t - b;
    if (Math.abs(v) <= 60) return makeVeloc(deg, a, b, t);
  }
  return makeVeloc(3, 1, 3, 2);
}

// calcab.antiderivative-power-rule — ∫xⁿ dx = xᵐ/m + C; asking for m keeps it one digit
function makeAntipow(n: number): Problem {
  return {
    topic: "antipow",
    key: `antipow:${n}`,
    prompt: `∫x${n === 1 ? "" : sup(n)} dx = xⁿ/n + C. n = ?`,
    answer: String(n + 1),
    kind: "numeric",
  };
}
const genAntipow = (): Problem => makeAntipow(ri(1, 8));

// calcab.special-trig-limits — sin(ax)/x = a · sin(ax)/sin(bx) = a/b · (1−cos x)/x = 0
function makeTriglim(fam: string, a: number, b: number): Problem {
  if (fam === "c") {
    return { topic: "triglim", key: "triglim:c", prompt: "lim (x → 0) of (1 − cos x)/x", answer: "0", kind: "numeric" };
  }
  if (fam === "x") {
    return {
      topic: "triglim",
      key: `triglim:x,${a}`,
      prompt: `lim (x → 0) of sin(${a === 1 ? "" : a}x)/x`,
      answer: String(a),
      kind: "numeric",
    };
  }
  return {
    topic: "triglim",
    key: `triglim:s,${a},${b}`,
    prompt: `lim (x → 0) of sin(${a === 1 ? "" : a}x)/sin(${b === 1 ? "" : b}x)`,
    answer: String(a / b),
    kind: "numeric",
  };
}
function genTriglim(): Problem {
  const roll = Math.random();
  if (roll < 0.15) return makeTriglim("c", 0, 0);
  if (roll < 0.6) return makeTriglim("x", ri(1, 9), 0);
  const b = ri(1, 4);
  const k = ri(1, Math.floor(9 / b));
  return makeTriglim("s", k * b, b);
}

// calcbc.ratio-test-read — the L-vs-1 threshold; L = 1 is the trap
const RATIO_LS = ["0", "1/3", "1/2", "2/3", "1", "3/2", "2", "∞"];
const RATIO_OPTS = ["Converges absolutely", "Diverges", "Test is inconclusive"];
function makeRatiotest(L: string): Problem {
  const v = L === "∞" ? Infinity : L.includes("/") ? Number(L.split("/")[0]) / Number(L.split("/")[1]) : Number(L);
  return {
    topic: "ratiotest",
    key: `ratiotest:${L}`,
    prompt: `The ratio test gives L = ${L} for a series. The conclusion?`,
    answer: v < 1 ? RATIO_OPTS[0] : v > 1 ? RATIO_OPTS[1] : RATIO_OPTS[2],
    kind: "choice",
    choices: [...RATIO_OPTS],
  };
}
const genRatiotest = (): Problem => makeRatiotest(pick(RATIO_LS));

/* ---------- registry + adaptive serving ---------- */

export const GENERATORS: Record<TopicId, (band: Band) => Problem> = {
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
  slope: genSlope,
  linfn: genLinfn,
  evalquad: genEvalquad,
  expquot: genExpQuot,
  disc: genDisc,
  dist: genDist,
  srt: genSrt,
  sqrtbig: genSqrtBig,
  midpoint: genMidpoint,
  refangle: genRefangle,
  trigval: genTrigval,
  cofunc: genCofunc,
  evallog: genEvallog,
  det2: genDet2,
  limitsub: genLimitsub,
  geoseries: genGeoseries,
  dstd: genDstd,
  chain: genChain,
  dpoint: genDpoint,
  critpt: genCritpt,
  defint: genDefint,
  simpfrac: genSimpfrac,
  likterms: genLikterms,
  binom: genBinom,
  slope2: genSlope2,
  factpair: genFactpair,
  dpower: genDpower,
  dpoly: genDpoly,
  intadd: genIntadd,
  intmul: genIntmul,
  evalexpr: genEvalexpr,
  solve1: genSolve1,
  solve2: genSolve2,
  pct2dec: genPct2dec,
  dec2pct: genDec2pct,
  pct2frac: genPct2frac,
  fracadd: genFracadd,
  fracmul: genFracmul,
  fraccomp: genFraccomp,
  factquad: genFactquad,
  distlin: genDistlin,
  nextarith: genNextarith,
  nextgeo: genNextgeo,
  expsolve: genExpsolve,
  logrule: genLogrule,
  factgcf: genFactgcf,
  suppcomp: genSuppcomp,
  coterm: genCoterm,
  trigq: genTrigq,
  recip: genRecip,
  vasymp: genVasymp,
  hasymp: genHasymp,
  amp: genAmp,
  midline: genMidline,
  dsecond: genDsecond,
  veloc: genVeloc,
  antipow: genAntipow,
  triglim: genTriglim,
  ratiotest: genRatiotest,
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
      case "srt":
        return makeSrt(restParts[0] as "short" | "hyp", Number(restParts[1]));
      case "sqrtbig":
        return makeSqrtBig(Math.round(Math.sqrt(Number(rest))));
      case "refangle":
        return makeRefangle(Number(rest));
      case "trigval":
        return makeTrigval(restParts[0], Number(restParts[1]));
      case "cofunc":
        return makeCofunc(restParts[0] as "sin" | "cos", Number(restParts[1]));
      case "evallog": {
        const [b, e] = rest.split("^").map(Number);
        return makeEvallog(b, e);
      }
      case "det2": {
        const [a, b, c, d] = rest.split(",").map(Number);
        return makeDet2(a, b, c, d);
      }
      case "limitsub": {
        const [a, b, c, p] = rest.split(",").map(Number);
        return makeLimitsub(a, b, c, p);
      }
      case "geoseries":
        return makeGeoseries(rest.replace(/^-/, ""), rest.startsWith("-"));
      case "dstd":
        return makeDstd(rest);
      case "chain":
        return makeChain(restParts[0] as "sin" | "cos" | "exp", Number(restParts[1]));
      case "dpoint": {
        const [a, n, x0] = rest.split(",").map(Number);
        return makeDpoint(a, n, x0);
      }
      case "critpt": {
        const [a, x] = rest.split(",").map(Number);
        return makeCritpt(a, x);
      }
      case "defint": {
        const [a, n, bnd] = rest.split(",").map(Number);
        return makeDefint(a, n, bnd);
      }
      case "simpfrac": {
        const [num, den] = rest.split("/").map(Number);
        const g = gcd(num, den);
        return makeSimpfrac(num / g, den / g, g);
      }
      case "likterms":
        return makeLikterms(rest.split("+").map(Number));
      case "binom": {
        const [a, b] = rest.split(",").map(Number);
        return Math.random() < 0.5 ? makeBinom(a, b) : makeBinom(b, a);
      }
      case "slope2": {
        const [x1, y1, x2, y2] = rest.split(",").map(Number);
        return makeSlope2(x1, y1, x2, y2);
      }
      case "factpair": {
        const [m, n] = rest.split(",").map(Number);
        return makeFactpair(m, n);
      }
      case "dpower":
        return makeDpower(Number(rest));
      case "dpoly": {
        const [deg, a, b, c] = rest.split(",").map(Number);
        return makeDpoly(a, b, c, deg);
      }
      case "intadd": {
        const [op, a, b] = rest.split(",");
        return makeIntadd(op as "add" | "sub", Number(a), Number(b));
      }
      case "intmul": {
        const [op, a, b] = rest.split(",");
        return makeIntmul(op as "mul" | "div", Number(a), Number(b));
      }
      case "evalexpr": {
        const [form, a, b, x] = rest.split(",");
        return makeEvalexpr(form as "lin" | "paren" | "sq", Number(a), Number(b), Number(x));
      }
      case "solve1": {
        const [op, p, q] = rest.split(",");
        return makeSolve1(op as "add" | "sub" | "mul" | "div", Number(p), Number(q));
      }
      case "solve2": {
        const [a, b, x] = rest.split(",").map(Number);
        return makeSolve2(a, b, x);
      }
      case "pct2dec":
        return makePct2dec(Number(rest));
      case "dec2pct":
        return makeDec2pct(Number(rest));
      case "pct2frac":
        return makePct2frac(Number(rest));
      case "fracadd": {
        const [l, r2] = rest.split("+");
        const [n1, d1] = l.split("/").map(Number);
        const [n2, d2] = r2.split("/").map(Number);
        return makeFracadd(n1, d1, n2, d2);
      }
      case "fracmul": {
        const [l, r2] = rest.split("×");
        const [n1, d1] = l.split("/").map(Number);
        const [n2, d2] = r2.split("/").map(Number);
        return makeFracmul(n1, d1, n2, d2);
      }
      case "fraccomp": {
        const [l, r2] = rest.split(">");
        const [n1, d1] = l.split("/").map(Number);
        const [n2, d2] = r2.split("/").map(Number);
        return makeFraccomp(n1, d1, n2, d2);
      }
      case "factquad": {
        const [r, s] = rest.split(",").map(Number);
        return makeFactquad(r, s);
      }
      case "distlin": {
        const [a, c] = rest.split(",").map(Number);
        return makeDistlin(a, c);
      }
      case "nextarith": {
        const [a, d] = rest.split(",").map(Number);
        return makeNextarith(a, d);
      }
      case "nextgeo": {
        const [a, r, n] = rest.split(",").map(Number);
        return makeNextgeo(a, r, n);
      }
      case "expsolve": {
        const [b, e] = rest.split("^").map(Number);
        return makeExpsolve(b, e);
      }
      case "logrule": {
        const [b, m, n] = rest.split(",").map(Number);
        return Math.random() < 0.5 ? makeLogrule(b, m, n) : makeLogrule(b, n, m);
      }
      case "factgcf": {
        const [g, b] = rest.split(",").map(Number);
        return makeFactgcf(g, b);
      }
      case "suppcomp": {
        const [kind, theta] = rest.split(",");
        return makeSuppcomp(kind as "supp" | "comp", Number(theta));
      }
      case "coterm":
        return makeCoterm(Number(rest));
      case "trigq":
        return makeTrigq(restParts[0], Number(restParts[1]));
      case "recip":
        return makeRecip(restParts[0], Number(restParts[1]));
      case "vasymp": {
        const [a, c] = rest.split(",").map(Number);
        return makeVasymp(a, c);
      }
      case "hasymp": {
        const [n1, c1, d1, c2] = rest.split(",").map(Number);
        return makeHasymp(n1, c1, d1, c2);
      }
      case "amp": {
        const [a, b, c, fn] = rest.split(",");
        return makeAmp(Number(a), Number(b), Number(c), fn);
      }
      case "midline": {
        const [a, b, c, fn] = rest.split(",");
        return makeMidline(Number(a), Number(b), Number(c), fn);
      }
      case "dsecond": {
        const [a, n, x0] = rest.split(",").map(Number);
        return makeDsecond(a, n, x0);
      }
      case "veloc": {
        const [deg, a, b, t] = rest.split(",").map(Number);
        return makeVeloc(deg, a, b, t);
      }
      case "antipow":
        return makeAntipow(Number(rest));
      case "triglim": {
        if (rest === "c") return makeTriglim("c", 0, 0);
        const [fam, a, b] = rest.split(",");
        return makeTriglim(fam, Number(a), Number(b ?? 0));
      }
      case "ratiotest":
        return makeRatiotest(rest);
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
    case "sqrtbig":
      for (let n = 12; n <= 30; n++) keys.push(`sqrtbig:${n * n}`);
      return keys;
    case "srt":
      for (let s = 1; s <= 12; s++) keys.push(`srt:short:${s}`, `srt:hyp:${s}`);
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
    case "refangle":
      for (let t = 95; t <= 355; t += 5) {
        if (t !== 180 && t !== 270) keys.push(`refangle:${t}`);
      }
      return keys;
    case "trigval":
      for (const a of [0, 30, 45, 60, 90]) keys.push(`trigval:sin:${a}`, `trigval:cos:${a}`);
      for (const a of [0, 30, 45, 60]) keys.push(`trigval:tan:${a}`);
      return keys;
    case "cofunc":
      for (let a = 5; a <= 85; a += 5) keys.push(`cofunc:sin:${a}`, `cofunc:cos:${a}`);
      return keys;
    case "evallog":
      for (const [b, [lo, hi]] of Object.entries(LOGBASES)) {
        for (let e = lo; e <= hi; e++) keys.push(`evallog:${b}^${e}`);
      }
      return keys;
    case "geoseries":
      for (const r of Object.keys(GEOSERIES)) keys.push(`geoseries:${r}`, `geoseries:-${r}`);
      return keys;
    case "dstd":
      return Object.keys(DSTD).map((f) => `dstd:${f}`);
    case "chain":
      for (const outer of ["sin", "cos", "exp"]) {
        for (let a = 2; a <= 9; a++) keys.push(`chain:${outer}:${a}`);
      }
      return keys;
    case "dpoint":
      for (let a = 1; a <= 5; a++) {
        for (let n = 2; n <= 4; n++) {
          for (const x of [-3, -2, -1, 1, 2, 3]) keys.push(`dpoint:${a},${n},${x}`);
        }
      }
      return keys; // 90 keys — under the cap
    case "critpt":
      for (let a = 1; a <= 4; a++) {
        for (let x = -9; x <= 9; x++) {
          if (x !== 0) keys.push(`critpt:${a},${x}`);
        }
      }
      return keys; // 72 keys
    case "defint":
      for (let n = 1; n <= 3; n++) {
        for (let k = 1; k <= 4; k++) {
          for (let b = 1; b <= 4; b++) {
            if (k * Math.pow(b, n + 1) <= 99) keys.push(`defint:${k * (n + 1)},${n},${b}`);
          }
        }
      }
      return keys;
    case "factpair":
      // pinned all-positive calibration band (the signed band is a later tune)
      for (let m = 2; m <= 12; m++) for (let n = m; n <= 12; n++) keys.push(`factpair:${m},${n}`);
      return keys; // 66 keys
    case "dpower":
      for (let n = 2; n <= 9; n++) keys.push(`dpower:${n}`);
      return keys;
    case "pct2dec":
      for (let p = 1; p <= 150; p++) keys.push(`pct2dec:${p}`);
      return keys; // exactly the cap
    case "dec2pct":
      for (let p = 1; p <= 150; p++) keys.push(`dec2pct:${p}`);
      return keys;
    case "pct2frac":
      for (let p = 1; p <= 99; p++) {
        if (gcd(p, 100) >= 4) keys.push(`pct2frac:${p}`);
      }
      return keys;
    case "factquad":
      // pinned band: both roots ∈ [1, 9] (signed band is a later tune)
      for (let r = 1; r <= 9; r++) for (let s = r; s <= 9; s++) keys.push(`factquad:${r},${s}`);
      return keys; // 45 keys
    case "distlin":
      for (let a = 2; a <= 9; a++) {
        for (let c = -9; c <= 9; c++) {
          if (c !== 0) keys.push(`distlin:${a},${c}`);
        }
      }
      return keys; // 144 keys
    case "nextgeo":
      for (let a = 1; a <= 5; a++) {
        for (const r of [2, 3, 4, 5, 10]) {
          for (const n of [3, 4]) {
            if (a * Math.pow(r, n) <= 1000) keys.push(`nextgeo:${a},${r},${n}`);
          }
        }
      }
      return keys;
    case "expsolve":
      for (const b of [2, 3, 4, 5, 10]) for (let e = 2; e <= 6; e++) keys.push(`expsolve:${b}^${e}`);
      return keys; // 25 keys
    case "logrule": {
      for (const b of [2, 3, 5, 6, 10]) {
        for (let k = 1; k <= 4; k++) {
          const P = Math.pow(b, k);
          for (let m = 2; m * m <= P; m++) {
            if (P % m === 0 && P / m >= 2 && P / m <= 50 && m <= 50) keys.push(`logrule:${b},${m},${P / m}`);
          }
        }
      }
      return keys;
    }
    case "suppcomp":
      for (let t = 5; t <= 85; t += 5) keys.push(`suppcomp:comp,${t}`);
      for (let t = 5; t <= 175; t += 5) keys.push(`suppcomp:supp,${t}`);
      return keys; // 52 keys
    case "trigq":
      for (const fn of ["sin", "cos", "tan"]) for (const t of TRIGQ_ANGLES) keys.push(`trigq:${fn}:${t}`);
      return keys; // 27 keys
    case "recip":
      for (const fn of ["csc", "sec", "cot"]) {
        for (const t of Object.keys(RECIP_TABLE[fn])) keys.push(`recip:${fn}:${t}`);
      }
      return keys; // 12 keys
    case "factgcf":
      for (let g = 2; g <= 9; g++) {
        for (let b = -9; b <= 9; b++) {
          if (b !== 0 && Math.abs(g * b) <= 72) keys.push(`factgcf:${g},${b}`);
        }
      }
      return keys;
    case "dsecond":
      for (let a = 1; a <= 3; a++) {
        for (let n = 3; n <= 5; n++) {
          for (const x0 of [-2, -1, 1, 2]) keys.push(`dsecond:${a},${n},${x0}`);
        }
      }
      return keys; // 36 keys
    case "antipow":
      for (let n = 1; n <= 8; n++) keys.push(`antipow:${n}`);
      return keys;
    case "triglim": {
      keys.push("triglim:c");
      for (let a = 1; a <= 9; a++) keys.push(`triglim:x,${a}`);
      for (let b = 1; b <= 4; b++) {
        for (let k = 1; k * b <= 9; k++) keys.push(`triglim:s,${k * b},${b}`);
      }
      return [...new Set(keys)];
    }
    case "ratiotest":
      return RATIO_LS.map((L) => `ratiotest:${L}`);
    default:
      // dbl, pow10, fracof, place, mul2x1, prop, exprule, congruence, the
      // g912 open generators (slope, linfn, evalquad, expquot, disc, dist,
      // midpoint), the P4 open generators (det2, limitsub), and the C6 open
      // generators (simpfrac, likterms, binom, slope2, dpoly): parameter
      // space too large or non-recall — open-ended.
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

/** Longest no-repeat window; shrinks for small fact sets so the candidate
 *  pool never empties (tester feedback: same questions too often). */
const RECENT_WINDOW_MAX = 8;

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
  const limit = masteryMsFor(topic);

  const set = factSetFor(topic, band);
  // No-repeat window scales down for small sets so candidates never run dry
  // (cube has 5 facts; a fixed window of 8 would empty the pool instantly).
  const win = set ? Math.max(1, Math.min(RECENT_WINDOW_MAX, Math.floor(set.length / 2))) : RECENT_WINDOW_MAX;
  const avoid = new Set(recent.slice(-win));
  if (set) {
    const unmastered = set.filter((k) => !isMastered(facts[k]));
    // Focus eases off when only a few facts remain unmastered — hammering the
    // last 2–3 every serve is the "same questions over and over" complaint.
    const focusP = unmastered.length <= 3 ? 0.5 : 0.85;
    const pool =
      unmastered.length && (unmastered.length === set.length || Math.random() < focusP)
        ? unmastered
        : set;
    const candidates = pool.filter((k) => !avoid.has(k));
    const weighted: string[] = [];
    for (const k of candidates.length ? candidates : pool) {
      weighted.push(k);
      const f = facts[k];
      if (f && (f.miss > 0 || f.avgMs > limit)) weighted.push(k);
    }
    const p = problemFromKey(pick(weighted));
    if (p) return p;
  }

  const struggling = Object.keys(facts).filter((k) => {
    if (!k.startsWith(`${topic}:`) || avoid.has(k) || isMastered(facts[k])) return false;
    const f = facts[k];
    return f.miss / f.n > 0.2 || f.avgMs > limit;
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
