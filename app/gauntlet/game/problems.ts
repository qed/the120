/**
 * MathRaiders problem engine.
 * - Grade bands scale ranges (B4).
 * - Every problem carries a stable `key` so the adaptive trainer can track
 *   per-fact speed/accuracy and re-serve weak facts (B1).
 * - Congruence problems randomize rotation and mark placement (B5).
 */

export type TopicId =
  | "mul"
  | "div"
  | "add"
  | "sub"
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

export type Topic = { id: TopicId; label: string };

export const TOPICS: Topic[] = [
  { id: "mul", label: "Multiplication" },
  { id: "div", label: "Division" },
  { id: "add", label: "Addition" },
  { id: "sub", label: "Subtraction" },
  { id: "gcd", label: "GCD" },
  { id: "lcm", label: "LCM" },
  { id: "denom", label: "Common denominator" },
  { id: "congruence", label: "Triangle congruence" },
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

/* ---------- band ranges ---------- */

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

/* ---------- generators ---------- */

function makeMul(a: number, b: number): Problem {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return { topic: "mul", key: `mul:${lo}×${hi}`, prompt: `${a} × ${b}`, answer: String(a * b), kind: "numeric" };
}
function genMul(band: Band): Problem {
  const [lo, hi] = R.mul[band];
  return makeMul(ri(lo, hi), ri(lo, hi));
}

function makeDiv(dividend: number, divisor: number): Problem {
  return {
    topic: "div",
    key: `div:${dividend}÷${divisor}`,
    prompt: `${dividend} ÷ ${divisor}`,
    answer: String(dividend / divisor),
    kind: "numeric",
  };
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
    key: `denom:${d1},${d2}`,
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

  // random placement: offset which sides/angles carry the marks (B5)
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

/* ---------- adaptive serving (B1) ---------- */

const GENERATORS: Record<TopicId, (band: Band) => Problem> = {
  mul: genMul,
  div: genDiv,
  add: genAdd,
  sub: genSub,
  gcd: genGcd,
  lcm: genLcm,
  denom: genDenom,
  congruence: () => genCongruence(),
};

/** Rebuild a specific fact from its key (arithmetic topics only). */
export function problemFromKey(key: string): Problem | null {
  const [topic, rest] = key.split(":");
  try {
    if (topic === "mul") {
      const [a, b] = rest.split("×").map(Number);
      return Math.random() < 0.5 ? makeMul(a, b) : makeMul(b, a);
    }
    if (topic === "div") {
      const [a, b] = rest.split("÷").map(Number);
      return makeDiv(a, b);
    }
    if (topic === "add") {
      const [a, b] = rest.split("+").map(Number);
      return Math.random() < 0.5 ? makeAdd(a, b) : makeAdd(b, a);
    }
    if (topic === "sub") {
      const [a, b] = rest.split("−").map(Number);
      return makeSub(a, b);
    }
    if (topic === "gcd") {
      const [a, b] = rest.split(",").map(Number);
      return makeGcd(a, b);
    }
    if (topic === "lcm") {
      const [a, b] = rest.split(",").map(Number);
      return makeLcm(a, b);
    }
    if (topic === "denom") {
      const [d1, d2] = rest.split(",").map(Number);
      return makeDenom(ri(1, d1 - 1), d1, ri(1, d2 - 1), d2);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Next problem: ~35% of the time (when weak facts exist for the active topics)
 * re-serves a weak fact; otherwise generates fresh at the band's difficulty.
 */
export function nextProblem(topics: TopicId[], band: Band, weakKeys: string[] = []): Problem {
  const eligible = weakKeys.filter((k) => topics.includes(k.split(":")[0] as TopicId) && !k.startsWith("congruence"));
  if (eligible.length && Math.random() < 0.35) {
    const p = problemFromKey(pick(eligible));
    if (p) return p;
  }
  const id = topics.length ? pick(topics) : "mul";
  return GENERATORS[id](band);
}
