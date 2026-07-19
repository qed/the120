import { BOSSES, type Boss } from "./bosses";
import { factSetFor, type Band, type TopicId } from "./problems";
import { isMastered, type FactStat } from "./mastery";

/**
 * Phase P — the Pathway (Peter, 2026-07-17). One ordered road from arithmetic
 * to calculus replaces every picker: no grade band, no topic chips. Each
 * pathway skill pins one (topic, band) parameter space from problems.ts and
 * carries its own 5-level boss ladder (P2). Placement (P1) and the per-skill
 * mastery grids (P3) read from here. Trig → calculus are declared but empty
 * until their generators land (P4) — the map shows where the road goes.
 */

export type AreaId = "arith" | "prealg" | "alg" | "geo" | "trig" | "precalc" | "calc";

export const AREAS: { id: AreaId; label: string; icon: string }[] = [
  { id: "arith", label: "Arithmetic", icon: "✚" },
  { id: "prealg", label: "Pre-Algebra", icon: "½" },
  { id: "alg", label: "Algebra", icon: "𝑥" },
  { id: "geo", label: "Geometry", icon: "△" },
  { id: "trig", label: "Trigonometry", icon: "∿" },
  { id: "precalc", label: "Pre-Calculus", icon: "ƒ" },
  { id: "calc", label: "Calculus", icon: "∫" },
];

export type Skill = {
  /** stable id — progression state is keyed on this, never reorder-sensitive */
  id: string;
  label: string;
  area: AreaId;
  topic: TopicId;
  /** parameter space (R tables) this skill draws from */
  band: Band;
};

/** Ordered easiest → hardest. Appending is safe; renaming ids loses progress. */
export const PATHWAY: Skill[] = [
  // Arithmetic
  { id: "add-facts", label: "Addition facts", area: "arith", topic: "add", band: "g34" },
  { id: "sub-facts", label: "Subtraction facts", area: "arith", topic: "sub", band: "g34" },
  { id: "times-1", label: "Times tables I", area: "arith", topic: "mul", band: "g34" },
  { id: "div-facts", label: "Division facts", area: "arith", topic: "div", band: "g34" },
  { id: "dbl-halve", label: "Double & halve", area: "arith", topic: "dbl", band: "g34" },
  { id: "place-value", label: "Place value", area: "arith", topic: "place", band: "g34" },
  { id: "times-2", label: "Times tables II", area: "arith", topic: "mul", band: "g56" },
  { id: "mul-2x1", label: "2-digit × 1-digit", area: "arith", topic: "mul2x1", band: "g56" },
  { id: "pow-ten", label: "Powers of ten", area: "arith", topic: "pow10", band: "g56" },
  { id: "frac-of", label: "Fraction of a number", area: "arith", topic: "fracof", band: "g56" },
  { id: "signed-add", label: "Signed add & subtract", area: "arith", topic: "intadd", band: "g78" },
  { id: "sign-rules", label: "Sign rules ×/÷", area: "arith", topic: "intmul", band: "g78" },
  // Pre-Algebra
  { id: "squares", label: "Perfect squares", area: "prealg", topic: "sq", band: "g56" },
  { id: "sq-roots", label: "Square roots", area: "prealg", topic: "sqrt", band: "g56" },
  { id: "cubes", label: "Perfect cubes", area: "prealg", topic: "cube", band: "g78" },
  { id: "exponents", label: "Exponents", area: "prealg", topic: "pow", band: "g78" },
  { id: "exp-rules", label: "Exponent product rule", area: "prealg", topic: "exprule", band: "g78" },
  { id: "gcd", label: "Greatest common divisor", area: "prealg", topic: "gcd", band: "g56" },
  { id: "simp-fractions", label: "Simplify fractions", area: "prealg", topic: "simpfrac", band: "g56" },
  // g34 parameter spaces (tester feedback 2026-07-18: g56's LCM/LCD pairs —
  // e.g. LCD of 8 and 10 — read as too complicated this early in the road)
  { id: "lcm", label: "Least common multiple", area: "prealg", topic: "lcm", band: "g34" },
  { id: "denoms", label: "Common denominators", area: "prealg", topic: "denom", band: "g34" },
  { id: "mul-fractions", label: "Multiply fractions", area: "prealg", topic: "fracmul", band: "g56" },
  { id: "add-fractions", label: "Add fractions", area: "prealg", topic: "fracadd", band: "g56" },
  { id: "compare-fractions", label: "Compare fractions", area: "prealg", topic: "fraccomp", band: "g56" },
  { id: "proportions", label: "Proportions", area: "prealg", topic: "prop", band: "g78" },
  { id: "pct-to-dec", label: "Percent → decimal", area: "prealg", topic: "pct2dec", band: "g78" },
  { id: "dec-to-pct", label: "Decimal → percent", area: "prealg", topic: "dec2pct", band: "g78" },
  { id: "pct-to-frac", label: "Percent → fraction", area: "prealg", topic: "pct2frac", band: "g78" },
  { id: "arith-patterns", label: "Arithmetic patterns", area: "prealg", topic: "nextarith", band: "g78" },
  { id: "eval-expressions", label: "Evaluate expressions", area: "prealg", topic: "evalexpr", band: "g78" },
  { id: "one-step-eq", label: "One-step equations", area: "prealg", topic: "solve1", band: "g78" },
  { id: "two-step-eq", label: "Two-step equations", area: "prealg", topic: "solve2", band: "g78" },
  { id: "like-terms", label: "Combine like terms", area: "prealg", topic: "likterms", band: "g78" },
  { id: "distribute", label: "Distribute", area: "prealg", topic: "distlin", band: "g78" },
  // Algebra
  { id: "linear-fn", label: "Evaluate linear functions", area: "alg", topic: "linfn", band: "g912" },
  { id: "slope", label: "Slope from two points", area: "alg", topic: "slope", band: "g912" },
  { id: "slope-fractions", label: "Slope (fractions)", area: "alg", topic: "slope2", band: "g912" },
  { id: "quadratics", label: "Evaluate quadratics", area: "alg", topic: "evalquad", band: "g912" },
  { id: "factor-pairs", label: "Sum & product pairs", area: "alg", topic: "factpair", band: "g912" },
  { id: "binomials", label: "Multiply binomials", area: "alg", topic: "binom", band: "g912" },
  { id: "factor-quads", label: "Factor quadratics", area: "alg", topic: "factquad", band: "g912" },
  { id: "factor-gcf", label: "Factor out the GCF", area: "alg", topic: "factgcf", band: "g912" },
  { id: "geo-patterns", label: "Geometric patterns", area: "alg", topic: "nextgeo", band: "g912" },
  { id: "exp-quotient", label: "Exponent quotient rule", area: "alg", topic: "expquot", band: "g912" },
  { id: "simplify-roots", label: "Simplify square roots", area: "alg", topic: "sqrtbig", band: "g912" },
  { id: "discriminant", label: "Discriminant & real roots", area: "alg", topic: "disc", band: "g912" },
  // Geometry
  { id: "supp-comp", label: "Supplements & complements", area: "geo", topic: "suppcomp", band: "g78" },
  { id: "pythagoras", label: "Pythagorean triples", area: "geo", topic: "pyth", band: "g78" },
  { id: "congruence", label: "Triangle congruence", area: "geo", topic: "congruence", band: "g78" },
  { id: "distance", label: "Distance between points", area: "geo", topic: "dist", band: "g912" },
  { id: "midpoints", label: "Midpoints", area: "geo", topic: "midpoint", band: "g912" },
  { id: "special-rt", label: "Special right triangles", area: "geo", topic: "srt", band: "g912" },
  // Trigonometry (P4, from gauntletcontent.md's Trig/Precalc pass)
  { id: "ref-angles", label: "Reference angles", area: "trig", topic: "refangle", band: "g912" },
  { id: "coterminal", label: "Coterminal angles", area: "trig", topic: "coterm", band: "g912" },
  { id: "trig-values", label: "Exact trig values", area: "trig", topic: "trigval", band: "g912" },
  { id: "trig-beyond-q1", label: "Trig beyond Q1", area: "trig", topic: "trigq", band: "g912" },
  { id: "reciprocal-trig", label: "Reciprocal trig", area: "trig", topic: "recip", band: "g912" },
  { id: "cofunctions", label: "Cofunction complements", area: "trig", topic: "cofunc", band: "g912" },
  { id: "amplitude", label: "Amplitude", area: "trig", topic: "amp", band: "g912" },
  { id: "midline", label: "Midline", area: "trig", topic: "midline", band: "g912" },
  // Pre-Calculus
  { id: "exp-solve", label: "Solve bˣ = k", area: "precalc", topic: "expsolve", band: "g912" },
  { id: "logs", label: "Evaluate logarithms", area: "precalc", topic: "evallog", band: "g912" },
  { id: "log-rules", label: "Log product rule", area: "precalc", topic: "logrule", band: "g912" },
  { id: "determinants", label: "2×2 determinants", area: "precalc", topic: "det2", band: "g912" },
  { id: "limits", label: "Limits by substitution", area: "precalc", topic: "limitsub", band: "g912" },
  { id: "v-asymptotes", label: "Vertical asymptotes", area: "precalc", topic: "vasymp", band: "g912" },
  { id: "h-asymptotes", label: "Horizontal asymptotes", area: "precalc", topic: "hasymp", band: "g912" },
  { id: "geo-series", label: "Geometric series", area: "precalc", topic: "geoseries", band: "g912" },
  // Calculus (AP Calc AB + the first BC entry)
  { id: "trig-limits", label: "Special trig limits", area: "calc", topic: "triglim", band: "g912" },
  { id: "power-rule", label: "Power rule", area: "calc", topic: "dpower", band: "g912" },
  { id: "deriv-table", label: "Derivative table", area: "calc", topic: "dstd", band: "g912" },
  { id: "diff-polys", label: "Differentiate polynomials", area: "calc", topic: "dpoly", band: "g912" },
  { id: "chain-rule", label: "Chain rule", area: "calc", topic: "chain", band: "g912" },
  { id: "deriv-at-point", label: "Derivative at a point", area: "calc", topic: "dpoint", band: "g912" },
  { id: "second-derivs", label: "Second derivatives", area: "calc", topic: "dsecond", band: "g912" },
  { id: "velocity", label: "Velocity", area: "calc", topic: "veloc", band: "g912" },
  { id: "crit-points", label: "Critical points", area: "calc", topic: "critpt", band: "g912" },
  { id: "anti-power", label: "Antiderivative power rule", area: "calc", topic: "antipow", band: "g912" },
  { id: "def-integrals", label: "Definite integrals", area: "calc", topic: "defint", band: "g912" },
  { id: "ratio-test", label: "Ratio test", area: "calc", topic: "ratiotest", band: "g912" },
];

/** P4 — authored in gauntletcontent.md, not yet in the engine; shown as
 *  dashed "coming" chips after an area's playable skills. */
export const COMING_SOON: Record<string, string[]> = {
  trig: ["Period reads", "Solve sin θ = k", "Double-angle evaluate"],
  precalc: ["Vectors & matrices", "Function composition", "Counting & probability"],
  calc: ["Tangent lines", "u-substitution", "More series tests (BC)"],
};

/* ------------------------------------------------------------------ */
/*  Progression (P2): 5 boss levels per skill                          */
/* ------------------------------------------------------------------ */

export const SKILL_LEVELS = 5;
/** Clearing this level "passes" the skill and unlocks the next one. */
export const PASS_LEVEL = 3;

export type SkillProgress = Record<string, number>; // skill id -> highest level beaten (0–5)

/** Boss for a skill level. L1–L4 walk the roster; L5 is the enraged finale. */
export function bossForLevel(level: number): Boss {
  if (level >= SKILL_LEVELS) {
    const vex = BOSSES[BOSSES.length - 1];
    return { ...vex, name: `${vex.name} Prime`, title: "Enraged Core", hp: 2600, glow: "#fbbf24" };
  }
  return BOSSES[Math.min(level, BOSSES.length) - 1];
}

export const skillLevel = (progress: SkillProgress, id: string) => progress[id] ?? 0;

/** Highest pathway index with a passed skill — the player's frontier. */
export function highestPassedIdx(progress: SkillProgress): number {
  let hi = -1;
  for (let i = 0; i < PATHWAY.length; i++) {
    if (skillLevel(progress, PATHWAY[i].id) >= PASS_LEVEL) hi = i;
  }
  return hi;
}

/**
 * Frontier unlock: everything up to one past your furthest passed skill is
 * open — including GAPS behind the frontier (a Grade 12 rusty at 2×1-digit
 * multiplication still gets calculus; the gap stays marked, not a prison).
 */
export function isUnlocked(progress: SkillProgress, idx: number): boolean {
  if (idx <= 0) return true;
  if (skillLevel(progress, PATHWAY[idx - 1].id) >= PASS_LEVEL) return true;
  return idx <= highestPassedIdx(progress) + 1;
}

/**
 * Where CONTINUE points: hole-filling first — the earliest unlocked skill
 * that isn't passed; once everything reachable is passed, the earliest not
 * fully mastered (L5); else the last skill.
 */
export function currentSkillIdx(progress: SkillProgress): number {
  for (let i = 0; i < PATHWAY.length; i++) {
    if (!isUnlocked(progress, i)) break;
    if (skillLevel(progress, PATHWAY[i].id) < PASS_LEVEL) return i;
  }
  for (let i = 0; i < PATHWAY.length; i++) {
    if (!isUnlocked(progress, i)) break;
    if (skillLevel(progress, PATHWAY[i].id) < SKILL_LEVELS) return i;
  }
  return PATHWAY.length - 1;
}

/**
 * Levels a player may launch for a skill: the next unbeaten level — plus the
 * PASS_LEVEL jump on an untouched skill (the built-in fast-track: strong kids
 * clear L3 in one raid instead of grinding L1→L2→L3).
 */
export function startableLevels(progress: SkillProgress, id: string): number[] {
  const lvl = skillLevel(progress, id);
  if (lvl >= SKILL_LEVELS) return [];
  const next = lvl + 1;
  return lvl === 0 && next < PASS_LEVEL ? [next, PASS_LEVEL] : [next];
}

/* ------------------------------------------------------------------ */
/*  Mastery view (P3) + placement/seeding (P1)                         */
/* ------------------------------------------------------------------ */

export function skillMastery(
  skill: Skill,
  facts: Record<string, FactStat>
): { mastered: number; seen: number; total: number } | null {
  const set = factSetFor(skill.topic, skill.band);
  if (!set) return null;
  let mastered = 0;
  let seen = 0;
  for (const k of set) {
    const f = facts[k];
    if (isMastered(f)) mastered++;
    else if (f && f.n > 0) seen++;
  }
  return { mastered, seen, total: set.length };
}

/**
 * Returning players (facts but no pathway progress): credit levels from what
 * their fact stats already prove, so nobody restarts a road they've walked.
 */
export function seedProgressFromFacts(facts: Record<string, FactStat>): SkillProgress {
  const progress: SkillProgress = {};
  for (const skill of PATHWAY) {
    const m = skillMastery(skill, facts);
    if (!m || m.total === 0) continue;
    const ratio = m.mastered / m.total;
    const lvl = ratio >= 0.8 ? PASS_LEVEL : ratio >= 0.4 ? 2 : ratio >= 0.15 ? 1 : 0;
    if (lvl > 0) progress[skill.id] = lvl;
  }
  return progress;
}

/** Placement credit: exactly the skills whose probes were clean pass — gaps
 *  (double-failed skills) stay at 0 and remain the CONTINUE priority. */
export function placementProgress(passedIdxs: number[]): SkillProgress {
  const progress: SkillProgress = {};
  for (const i of passedIdxs) {
    if (i >= 0 && i < PATHWAY.length) progress[PATHWAY[i].id] = PASS_LEVEL;
  }
  return progress;
}

/** Topics a player has reached (for the Mastery Trial's deck). */
export function unlockedTopics(progress: SkillProgress): TopicId[] {
  const topics: TopicId[] = [];
  for (let i = 0; i < PATHWAY.length; i++) {
    if (!isUnlocked(progress, i)) break;
    if (!topics.includes(PATHWAY[i].topic)) topics.push(PATHWAY[i].topic);
  }
  return topics;
}
