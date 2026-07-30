/**
 * Tournament mastery batch-builder (plan Unit 6 — DIFFICULTY-WEIGHTED MASTERY).
 *
 * When a signed-in player masters new facts during live-phase tournament play,
 * the client posts those newly-mastered facts to
 * `POST /api/gauntlet/tournament/mastery` so they count toward the tournament
 * mastery board. This module holds the PURE, testable core of that post:
 *
 *   - `newlyMasteredKeys(before, after)` — which facts crossed from
 *     un-mastered → mastered between two per-fact states (the diff).
 *   - `buildMasteryBatch(keys, band, batchId)` — shape the request body
 *     `{ batch_id, facts:[{fact_key, band}] }`. The `batch_id` is INJECTED
 *     (the caller stamps `crypto.randomUUID()`) so the diff stays deterministic
 *     and unit-testable without touching global randomness.
 *
 * New callers resolve every key through the canonical fact registry, and the
 * server independently repeats that canonicalization before weighting it.
 * Events de-dupe per (user_id, season_id, fact_key).
 */

import { isMastered, type FactStat } from "./mastery";
import { canonicalFactBand } from "./factRegistry";
import type { Band } from "./problems";

export interface MasteryBatchFact {
  fact_key: string;
  band: Band;
}

export interface MasteryBatch {
  batch_id: string;
  facts: MasteryBatchFact[];
}

/**
 * Fact keys present in `after` that are mastered now but were NOT mastered in
 * `before` — i.e. the facts that newly crossed the mastery threshold this run.
 * Already-mastered and still-unmastered facts are excluded; a fact absent from
 * `before` counts as newly mastered if it is mastered in `after`.
 */
export function newlyMasteredKeys(
  before: Record<string, FactStat>,
  after: Record<string, FactStat>
): string[] {
  return Object.keys(after).filter(
    (k) => isMastered(after[k]) && !isMastered(before[k])
  );
}

/**
 * Build the POST body for a set of newly-mastered fact keys played in `band`.
 * `batchId` is passed in (deterministic/pure) — the caller stamps a real
 * `crypto.randomUUID()`.
 */
export function buildMasteryBatch(
  factKeys: string[],
  band: Band,
  batchId: string
): MasteryBatch {
  return {
    batch_id: batchId,
    facts: factKeys.map((fact_key) => ({ fact_key, band })),
  };
}

/**
 * Build a scoring batch using the canonical band owned by each fact instead of
 * one caller-selected run band. Unknown/non-round-trippable keys are omitted.
 */
export function buildCanonicalMasteryBatch(
  factKeys: string[],
  batchId: string
): MasteryBatch {
  const facts: MasteryBatchFact[] = [];
  for (const fact_key of [...new Set(factKeys)]) {
    const band = canonicalFactBand(fact_key);
    if (band) facts.push({ fact_key, band });
  }
  return { batch_id: batchId, facts };
}
