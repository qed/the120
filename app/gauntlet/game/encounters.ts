import type { Band, TopicId } from "./problems";

export type EncounterKind = "quickfire" | "puzzle";
export type RaidBeat = "warmup" | "pressure" | "puzzle" | "recovery" | "finisher";
export type RaidSource = { topic: TopicId; band: Band };

/**
 * Topics where reading, drawing, applying a formula, or constructing an
 * expression is the point. These still belong in Gauntlet raids, but not on a
 * raw speed leaderboard.
 */
const PUZZLE_TOPICS: ReadonlySet<TopicId> = new Set([
  "mul2x1",
  "fracof",
  "pyth",
  "prop",
  "congruence",
  "slope",
  "evalquad",
  "disc",
  "dist",
  "srt",
  "sqrtbig",
  "midpoint",
  "det2",
  "limitsub",
  "geoseries",
  "chain",
  "dpoint",
  "critpt",
  "defint",
  "simpfrac",
  "likterms",
  "binom",
  "slope2",
  "factpair",
  "dpoly",
  "evalexpr",
  "solve2",
  "pct2frac",
  "fracadd",
  "fracmul",
  "factquad",
  "nextarith",
  "nextgeo",
  "logrule",
  "factgcf",
  "trigq",
  "hasymp",
  "dsecond",
  "veloc",
  "antipow",
  "ratiotest",
]);

export const encounterKind = (topic: TopicId): EncounterKind =>
  PUZZLE_TOPICS.has(topic) ? "puzzle" : "quickfire";

export const encounterCopy = (topic: TopicId) =>
  encounterKind(topic) === "puzzle"
    ? {
        label: "POWER QUESTION",
        detail: "Solve this for a heavy hit and healing. Take your time — speed does not matter.",
      }
    : {
        label: "QUICKFIRE",
        detail: "A short recall or one-step problem. Fast, accurate answers build damage.",
      };

/**
 * A small raid director. It establishes a readable opening, injects the
 * selected puzzle skill regularly, gives a recovery beat after a miss, and
 * accelerates once the boss is nearly down.
 */
export function nextRaidBeat({
  answered,
  wrongStreak,
  bossRatio,
  hasPuzzle,
}: {
  answered: number;
  wrongStreak: number;
  bossRatio: number;
  hasPuzzle: boolean;
}): RaidBeat {
  if (!hasPuzzle && answered < 2) return "warmup";
  if (wrongStreak > 0) return "recovery";
  if (bossRatio <= 0.25) return "finisher";
  if (hasPuzzle && answered > 0 && answered % 4 === 0) return "puzzle";
  return "pressure";
}

export const raidBeatCopy: Record<RaidBeat, { label: string; hint: string }> = {
  warmup: { label: "WARMUP", hint: "Build your streak." },
  pressure: { label: "QUICKFIRE", hint: "Keep the pressure on." },
  puzzle: { label: "POWER QUESTION", hint: "Heavy hit + heal · speed does not matter." },
  recovery: { label: "RECOVERY", hint: "A clean answer gets your rhythm back." },
  finisher: { label: "FINISHER", hint: "The boss is exposed." },
};
