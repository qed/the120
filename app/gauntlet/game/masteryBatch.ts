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
 * The band the run was played in travels with each fact; the server weights it
 * (masteryWeight.ts) and de-dupes per (user_id, fact_key) so a fact credits
 * exactly once. This is separate from and additive to the casual cloud save.
 */

import { isMastered, type FactStat } from "./mastery";
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
