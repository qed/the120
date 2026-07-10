/**
 * MathRaiders problem engine.
 * Numeric topics auto-submit when the typed answer reaches the expected length;
 * choice topics (triangle congruence) render options.
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

export type Topic = {
  id: TopicId;
  label: string;
  short: string;
};

export const TOPICS: Topic[] = [
  { id: "mul", label: "Multiplication 0–12", short: "×" },
  { id: "div", label: "Division 0–12", short: "÷" },
  { id: "add", label: "Addition to 20", short: "+" },
  { id: "sub", label: "Subtraction to 20", short: "−" },
  { id: "gcd", label: "GCD", short: "GCD" },
  { id: "lcm", label: "LCM", short: "LCM" },
  { id: "denom", label: "Common denominator", short: "a/b" },
  { id: "congruence", label: "Triangle congruence", short: "△" },
];

export type TrianglePair = {
  /** side lengths + marked angles for the two triangles, for SVG rendering */
  a: { sides: [number, number, number]; marks: string[] };
  b: { sides: [number, number, number]; marks: string[] };
};

export type Problem = {
  topic: TopicId;
  /** display parts, e.g. ["7", "×", "8"] or a sentence for gcd/lcm */
  prompt: string;
  /** correct answer as string */
  answer: string;
  /** numeric → type the answer; choice → pick one */
  kind: "numeric" | "choice";
  choices?: string[];
  triangle?: TrianglePair;
};

const ri = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
const lcm = (a: number, b: number) => (a * b) / gcd(a, b);

/* ---------- generators ---------- */

function genMul(): Problem {
  const a = ri(2, 12);
  const b = ri(2, 12);
  return { topic: "mul", prompt: `${a} × ${b}`, answer: String(a * b), kind: "numeric" };
}

function genDiv(): Problem {
  const b = ri(2, 12);
  const q = ri(2, 12);
  return { topic: "div", prompt: `${b * q} ÷ ${b}`, answer: String(q), kind: "numeric" };
}

function genAdd(): Problem {
  const a = ri(2, 18);
  const b = ri(2, 20 - Math.min(a, 18));
  return { topic: "add", prompt: `${a} + ${b}`, answer: String(a + b), kind: "numeric" };
}

function genSub(): Problem {
  const a = ri(5, 20);
  const b = ri(1, a - 1);
  return { topic: "sub", prompt: `${a} − ${b}`, answer: String(a - b), kind: "numeric" };
}

function genGcd(): Problem {
  const g = pick([2, 3, 4, 5, 6, 7, 8]);
  const a = g * pick([2, 3, 4, 5]);
  let b = g * pick([2, 3, 4, 5, 6]);
  if (a === b) b = g * 7;
  return {
    topic: "gcd",
    prompt: `GCD(${Math.max(a, b)}, ${Math.min(a, b)})`,
    answer: String(gcd(a, b)),
    kind: "numeric",
  };
}

function genLcm(): Problem {
  const a = pick([2, 3, 4, 5, 6, 8, 9, 10, 12]);
  let b = pick([2, 3, 4, 5, 6, 8, 9, 10, 12]);
  if (a === b) b = a === 12 ? 8 : 12;
  const ans = lcm(a, b);
  if (ans > 120) return genLcm();
  return { topic: "lcm", prompt: `LCM(${a}, ${b})`, answer: String(ans), kind: "numeric" };
}

/** Least common denominator of two fractions. */
function genDenom(): Problem {
  const d1 = pick([2, 3, 4, 5, 6, 8, 10, 12]);
  let d2 = pick([2, 3, 4, 5, 6, 8, 10, 12]);
  if (d1 === d2) d2 = d1 === 12 ? 8 : 12;
  const n1 = ri(1, d1 - 1);
  const n2 = ri(1, d2 - 1);
  const ans = lcm(d1, d2);
  if (ans > 96) return genDenom();
  return {
    topic: "denom",
    prompt: `Least common denominator of ${n1}/${d1} and ${n2}/${d2}`,
    answer: String(ans),
    kind: "numeric",
  };
}

/**
 * Triangle congruence: show two triangles with tick/angle marks and ask which
 * criterion proves congruence (or "Not enough info").
 */
const CRITERIA = ["SSS", "SAS", "ASA", "AAS"] as const;

function genCongruence(): Problem {
  const correct = pick([...CRITERIA, "Not enough info"] as string[]);
  // Base triangle side lengths (visual only)
  const sides: [number, number, number] = [ri(60, 90), ri(70, 100), ri(80, 110)];

  // marks per criterion: s = side tick, A = angle arc (positions 0..2)
  const marksFor: Record<string, string[]> = {
    SSS: ["s0", "s1", "s2"],
    SAS: ["s0", "A1", "s1"],
    ASA: ["A0", "s1", "A2"],
    AAS: ["A0", "A1", "s2"],
    "Not enough info": pick([["s0", "s1"], ["A0", "A1"], ["s0", "A2"]]),
  };
  const marks = marksFor[correct];

  return {
    topic: "congruence",
    prompt: "Which criterion proves these triangles congruent?",
    answer: correct,
    kind: "choice",
    choices: [...CRITERIA, "Not enough info"],
    triangle: {
      a: { sides, marks },
      b: { sides, marks },
    },
  };
}

const GENERATORS: Record<TopicId, () => Problem> = {
  mul: genMul,
  div: genDiv,
  add: genAdd,
  sub: genSub,
  gcd: genGcd,
  lcm: genLcm,
  denom: genDenom,
  congruence: genCongruence,
};

export function nextProblem(topics: TopicId[]): Problem {
  const id = topics.length ? pick(topics) : "mul";
  return GENERATORS[id]();
}
