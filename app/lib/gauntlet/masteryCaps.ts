/**
 * Tournament mastery plausibility caps (plan Unit 5 · B1 score integrity).
 *
 * PURE, no I/O — the only place the "how many of this batch do we CREDIT?"
 * decision lives, so it is unit-testable without a DB or the network. The
 * server route (`app/api/gauntlet/tournament/mastery/route.ts`) supplies the
 * batch + the caller's recent/daily mastery counts (read from the append-only
 * events table) and this decides the credited subset.
 *
 * Scoring model (2026-07-17): DIFFICULTY-WEIGHTED MASTERY, not XP. Each
 * distinct mastered fact is credited once (the events table's
 * `unique(user_id, fact_key)` makes replay inert), weighted by its content
 * band via `bandMasteryWeight`. This function does NOT re-derive per-answer
 * scoring — it only bounds the *rate* at which distinct facts may be credited.
 *
 * Two ceilings:
 *   1. A facts-mastered-per-minute rate ceiling over a recent rolling window.
 *      A fast-but-plausible player is CLAMPED (we credit up to the ceiling),
 *      never hard-rejected — caps bound the damage, they don't punish a good
 *      run. Only an *impossible* rate (above an absolute hard ceiling that no
 *      human sustains) rejects the whole batch as bot traffic.
 *   2. A per-user, per-day ceiling on distinct facts credited. Once hit,
 *      further batches credit 0 (but the route still logs — no throw).
 *
 * Every ceiling below is a TUNABLE default — retune against real play traces
 * (plan defers exact numbers). The knobs are commented at their definition.
 */

import type { Band } from "@/app/gauntlet/game/problems";
import { bandMasteryWeight } from "@/app/gauntlet/game/masteryWeight";

const MS_PER_MIN = 60_000;

/**
 * Sustainable facts-mastered-per-minute. Mastery = a fact answered correctly
 * under 3 s TWICE (the M5 model), so a *distinct* new fact costs real seconds
 * of play; 15/min (one every 4 s) is already a generous ceiling for a strong
 * player interleaving facts. Above this we clamp.
 */
const SUSTAINABLE_PER_MIN = 15;

/**
 * Absolute hard ceiling — above this rate the batch is impossible for a human
 * and is rejected outright as bot/replay traffic (~3× the sustainable rate).
 */
const ABSOLUTE_PER_MIN = 45;

/**
 * Per-user, per-day ceiling on distinct facts credited. Distinct facts are
 * finite anyway; 500 newly-mastered facts in one day is already extraordinary,
 * so this is a generous backstop against a day-long grind/bot, not a normal
 * player's wall.
 */
const DAILY_CEILING = 500;

/**
 * Burst grace: the minimum facts allowed in any single window regardless of
 * how short it is, so a legitimate quick burst posted after a few seconds
 * isn't clamped away by rounding on a tiny elapsed time.
 */
const RATE_GRACE = 8;

/**
 * Floor on the rate window (min) used for BOTH the clamp and the impossible
 * check, so a near-zero elapsed time can't divide into an infinite rate (or a
 * zero ceiling). 0.25 min = 15 s.
 */
const MIN_RATE_WINDOW_MIN = 0.25;

/** A newly-mastered fact submitted by the client. */
export interface MasteryFact {
  fact_key: string;
  band: Band;
}

export interface MasteryCapInput {
  /** Newly-mastered facts in this batch. */
  facts: MasteryFact[];
  /** Facts the user already mastered within the recent rate window. */
  priorInWindow: number;
  /** Elapsed duration of the recent rate window, in ms. */
  windowMs: number;
  /** Facts the user has already been credited today (for the daily ceiling). */
  priorToday: number;
}

export interface CreditedFact {
  fact_key: string;
  band: Band;
  weight: number;
}

export type CapReason = "rate_impossible" | "rate_clamped" | "daily_ceiling";

export interface MasteryCapResult {
  credited: CreditedFact[];
  rejected: number;
  reason?: CapReason;
}

/**
 * Decide how many facts from `facts` to credit given the caller's recent and
 * daily mastery counts. Pure — same input always yields the same result.
 */
export function masteryCaps(input: MasteryCapInput): MasteryCapResult {
  const facts = input.facts ?? [];
  const submitted = facts.length;
  if (submitted === 0) return { credited: [], rejected: 0 };

  const elapsedMin = Math.max((input.windowMs ?? 0) / MS_PER_MIN, MIN_RATE_WINDOW_MIN);
  const priorInWindow = Math.max(0, input.priorInWindow ?? 0);
  const priorToday = Math.max(0, input.priorToday ?? 0);

  // Impossible-rate guard: the window total implies a rate no human sustains →
  // reject the whole batch (bot / replay), credit nothing.
  const impliedRate = (priorInWindow + submitted) / elapsedMin;
  if (impliedRate > ABSOLUTE_PER_MIN) {
    return { credited: [], rejected: submitted, reason: "rate_impossible" };
  }

  // Clamp ceiling: how many NEW facts the sustainable rate allows in this
  // window, given what was already mastered in it, with a burst grace floor.
  const windowCap = Math.max(RATE_GRACE, Math.ceil(SUSTAINABLE_PER_MIN * elapsedMin));
  const allowByRate = Math.max(0, windowCap - priorInWindow);

  // Daily ceiling: how many more facts may be credited today.
  const allowByDay = Math.max(0, DAILY_CEILING - priorToday);

  const allow = Math.min(submitted, allowByRate, allowByDay);

  const credited: CreditedFact[] = facts.slice(0, allow).map((f) => ({
    fact_key: f.fact_key,
    band: f.band,
    weight: bandMasteryWeight(f.band),
  }));

  const rejected = submitted - credited.length;
  if (rejected === 0) return { credited, rejected: 0 };

  // The daily ceiling is the binding constraint when it is the tighter of the
  // two; otherwise the rate clamp is what trimmed the batch.
  const reason: CapReason = allowByDay <= allowByRate ? "daily_ceiling" : "rate_clamped";
  return { credited, rejected, reason };
}
