import {
  canonicalProblemFromKey,
  factSetFor,
  type Band,
  type Problem,
  type TopicId,
} from "./problems";
import { encounterKind } from "./encounters";

export const SPRINT_SECONDS = 60;
export const SPRINT_LENGTH = 20;

export type SprintBracket = "g34" | "g56" | "g78" | "g910" | "g11" | "g12";
export const SPRINT_BRACKETS: {
  id: SprintBracket;
  label: string;
  contentBand: Band;
}[] = [
  { id: "g34", label: "Grades 3–4", contentBand: "g34" },
  { id: "g56", label: "Grades 5–6", contentBand: "g56" },
  { id: "g78", label: "Grades 7–8", contentBand: "g78" },
  { id: "g910", label: "Grades 9–10", contentBand: "g912" },
  { id: "g11", label: "Grade 11", contentBand: "g912" },
  { id: "g12", label: "Grade 12", contentBand: "g912" },
];

export type SprintAnswer = { key: string; response: string; ms: number };
export type SprintScore = {
  date: string;
  band: SprintBracket;
  correct: number;
  wrong: number;
  elapsedMs: number;
  score: number;
};
export type SprintRun = SprintScore & {
  answers: SprintAnswer[];
  /** Only a server-reserved run for this UTC date/bracket can affect the board. */
  ranked: boolean;
  attemptId?: string;
};
export type SprintBest = SprintScore;
export type SprintBoardRow = SprintScore & { rank: number; handle: string };
export type SprintStanding = {
  me: SprintBoardRow;
  ahead: SprintBoardRow | null;
  /** Final rank from the previous UTC day in the same bracket, when available. */
  previousRank?: number;
};
export type SprintBoardSnapshot = {
  rows: SprintBoardRow[];
  standing?: SprintStanding;
  attemptUsed: boolean;
  available: boolean;
};
export type SprintReservation = {
  reserved: boolean;
  attemptId?: string;
  reason?: "ranked_attempt_used" | "sign_in_required" | "unavailable";
};

const POOLS: Record<SprintBracket, TopicId[]> = {
  g34: ["add", "sub", "mul", "div", "dbl", "place"],
  g56: ["mul", "sq", "sqrt", "pow10", "gcd", "lcm"],
  g78: ["intadd", "intmul", "cube", "pow", "exprule", "pct2dec", "dec2pct"],
  g910: ["intadd", "intmul", "sq", "sqrt", "expquot", "suppcomp", "refangle"],
  g11: ["trigval", "refangle", "cofunc", "evallog", "expsolve", "vasymp", "amp", "midline"],
  g12: ["dstd", "dpower", "triglim", "evallog"],
};

function hashSeed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Canonical presentation as well as canonical identity for a fair board. */
export function dailySprintProblem(key: string): Problem | null {
  const problem = canonicalProblemFromKey(key);
  if (!problem) return null;
  const [topic, rest] = key.split(":");
  const prompt =
    topic === "mul" || topic === "add"
      ? rest
      : problem.prompt;
  return { ...problem, prompt };
}

export function dailySprintKeys(
  date: string,
  band: SprintBracket,
  length = SPRINT_LENGTH
): string[] {
  const contentBand =
    SPRINT_BRACKETS.find((candidate) => candidate.id === band)?.contentBand ?? "g912";
  const keys = POOLS[band]
    .filter((topic) => encounterKind(topic) === "quickfire")
    .flatMap((topic) => factSetFor(topic, contentBand) ?? [])
    .filter((key) => dailySprintProblem(key) !== null);
  const random = seededRandom(hashSeed(`${date}:${band}:daily-sprint-v1`));

  // Fisher-Yates gives everyone in a bracket the same order for the UTC day.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, Math.min(length, keys.length));
}

export function sprintScore(correct: number, wrong: number, elapsedMs: number): number {
  const boundedMs = Math.max(0, Math.min(SPRINT_SECONDS * 1000, Math.round(elapsedMs)));
  return correct * 100_000 - wrong * 3_000 - boundedMs;
}

/** Server-authoritative wall time prevents a client from submitting fake speed. */
export function officialSprintElapsed(
  answerMs: number,
  startedAtMs: number,
  completedAtMs: number,
  completedDeck: boolean
): number {
  if (!completedDeck) return SPRINT_SECONDS * 1000;
  const wallMs =
    Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
      ? Math.max(0, completedAtMs - startedAtMs)
      : answerMs;
  return Math.min(
    SPRINT_SECONDS * 1000,
    Math.max(0, Math.round(answerMs), Math.round(wallMs))
  );
}

export function sprintBracketForGrade(grade: number): SprintBracket {
  if (grade <= 4) return "g34";
  if (grade <= 6) return "g56";
  if (grade <= 8) return "g78";
  if (grade <= 10) return "g910";
  if (grade === 11) return "g11";
  return "g12";
}

export const sprintBestKey = (date: string, band: SprintBracket) => `${date}:${band}`;

export function nearbyTarget(
  rows: SprintBoardRow[],
  ownScore: number
): SprintBoardRow | null {
  return (
    rows
      .filter((row) => row.score > ownScore)
      .sort((a, b) => a.score - b.score)[0] ?? null
  );
}

export function standingGapCopy(standing: SprintStanding): string | null {
  const { me, ahead } = standing;
  if (!ahead) return null;
  const correctGap = ahead.correct - me.correct;
  if (correctGap > 0) {
    return `${correctGap} more correct ${correctGap === 1 ? "answer" : "answers"} to match ${ahead.handle}'s accuracy`;
  }
  const missGap = me.wrong - ahead.wrong;
  if (missGap > 0) {
    return `${missGap} fewer ${missGap === 1 ? "miss" : "misses"} to close on ${ahead.handle}`;
  }
  const timeGap = Math.max(100, me.elapsedMs - ahead.elapsedMs);
  return `${(timeGap / 1000).toFixed(1)}s faster to pass ${ahead.handle}`;
}

export function rankMovementCopy(standing: SprintStanding): string | null {
  if (!standing.previousRank) return null;
  const movement = standing.previousRank - standing.me.rank;
  if (movement > 0) return `▲ ${movement} rank${movement === 1 ? "" : "s"} vs yesterday`;
  if (movement < 0) return `▼ ${Math.abs(movement)} rank${movement === -1 ? "" : "s"} vs yesterday`;
  return "Same rank as yesterday";
}

export function personalBestCopy(
  current: Pick<SprintScore, "correct" | "wrong" | "elapsedMs" | "score">,
  previous?: Pick<SprintScore, "correct" | "wrong" | "elapsedMs" | "score">
): string | null {
  if (!previous || current.score <= previous.score) return null;
  const correctGain = current.correct - previous.correct;
  if (correctGain > 0) {
    return `Personal best · +${correctGain} correct`;
  }
  const missGain = previous.wrong - current.wrong;
  if (missGain > 0) {
    return `Personal best · ${missGain} fewer ${missGain === 1 ? "miss" : "misses"}`;
  }
  const fasterMs = previous.elapsedMs - current.elapsedMs;
  return fasterMs > 0
    ? `Personal best · ${(fasterMs / 1000).toFixed(1)}s faster`
    : "New personal best";
}

/** Clearly-labelled offline targets keep the result useful before sign-in. */
export function practiceGhosts(date: string, band: SprintBracket): SprintBoardRow[] {
  const base = hashSeed(`${date}:${band}:ghosts`) % 4;
  return [
    { rank: 3, handle: "BRONZE GHOST", date, band, correct: 8 + base, wrong: 2, elapsedMs: 52_000, score: sprintScore(8 + base, 2, 52_000) },
    { rank: 2, handle: "SILVER GHOST", date, band, correct: 13 + base, wrong: 1, elapsedMs: 47_000, score: sprintScore(13 + base, 1, 47_000) },
    { rank: 1, handle: "GOLD GHOST", date, band, correct: 17 + base, wrong: 0, elapsedMs: 42_000, score: sprintScore(17 + base, 0, 42_000) },
  ];
}
