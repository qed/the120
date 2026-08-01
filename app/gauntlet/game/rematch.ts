import {
  canonicalProblemFromKey,
  masteryMsFor,
  topicOfKey,
} from "./problems";

type ReviewableResult = {
  key: string;
  ms: number;
  correct: boolean;
};

/** Misses first, then the slowest correct facts that exceeded their own topic's pace. */
export function rematchKeysFromResults(
  results: readonly ReviewableResult[],
  limit = 5
): string[] {
  const misses = results.filter((result) => !result.correct);
  const slow = results
    .filter(
      (result) =>
        result.correct && result.ms > masteryMsFor(topicOfKey(result.key))
    )
    .sort((a, b) => b.ms - a.ms);
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const result of [...misses, ...slow]) {
    if (seen.has(result.key) || !canonicalProblemFromKey(result.key)) continue;
    seen.add(result.key);
    keys.push(result.key);
    if (keys.length >= Math.max(0, limit)) break;
  }
  return keys;
}
