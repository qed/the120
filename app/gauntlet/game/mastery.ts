/**
 * Mastery model (Peter's spec, 2026-07-13):
 * every topic has a finite set of facts; a fact is MASTERED once you answer
 * it correctly under the time limit twice in a row. Serving then focuses on
 * the facts you haven't mastered, and the Mastery Trial tests the whole set.
 */

export type FactStat = {
  n: number;
  miss: number;
  avgMs: number;
  /** consecutive correct answers under MASTERY_MS (resets on miss or slow) */
  fastStreak: number;
};

export const MASTERY_MS = 3000;
export const MASTERY_REPS = 2;

export const isMastered = (f: FactStat | undefined): boolean =>
  !!f && (f.fastStreak ?? 0) >= MASTERY_REPS;
