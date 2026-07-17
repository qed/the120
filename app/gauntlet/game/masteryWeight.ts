/**
 * Difficulty-weighted mastery weight (tournament scoring — plan Unit 3).
 *
 * The tournament score is the count of *distinct facts mastered* during the
 * window, each fact weighted by its content band. A g912 fact is worth more
 * than a g34 fact, so mastering harder content pulls the score up faster while
 * "play anything" stays fair (each fact scores once, so there is no grind).
 *
 * This is a PURE per-fact weight shared by both the client (display) and the
 * server mastery route (authoritative tally), so the two never drift.
 *
 * The ordering g34 < g56 < g78 < g912 is FIXED and must stay strictly
 * monotonic. The exact integer values are tunable — retune freely, but keep
 * the ordering intact.
 */

import type { Band } from "./problems";

export const BAND_MASTERY_WEIGHT: Record<Band, number> = {
  g34: 1,
  g56: 2,
  g78: 3,
  g912: 5,
};

/** Per-fact tournament weight for a content band. */
export function bandMasteryWeight(band: Band): number {
  return BAND_MASTERY_WEIGHT[band];
}
