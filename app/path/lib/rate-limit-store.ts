import "server-only";

/**
 * In-memory event store behind the pure rate-limit rules (T1 Unit 6, R29).
 *
 * DELIBERATELY per-instance and best-effort: the plan forbids new tables in
 * Unit 6, and at T1's scale (a handful of consenting test families, TP-1 gates
 * public launch) an in-memory sliding window on a warm Vercel Fluid Compute
 * instance is a real throttle — instances are reused across requests, so the
 * window survives between attempts. The honest limitations, on the record:
 *   - a cold start or a second warm instance starts with an empty window, so
 *     the limit is per-instance, not global;
 *   - eviction past MAX_RATE_LIMIT_BUCKETS fails OPEN for the evicted key.
 * A durable, shared store (a table or KV) is the carry-forward before TP-1
 * lifts the test-families-only posture.
 *
 * NOT a "use server" file (its exports would become public Server Actions an
 * attacker could call to clear buckets); `server-only` keeps it out of client
 * bundles, where a second, always-empty store would silently no-op. All
 * decision logic lives in rate-limit-rules.ts (pure, tested); this module only
 * holds the timestamps.
 */

import {
  evaluateRateLimit,
  pruneEvents,
  type RateLimitConfig,
  type RateLimitDecision,
} from "./rate-limit-rules";

/** Bounded so an attacker iterating keys (names) cannot grow memory unbounded. */
export const MAX_RATE_LIMIT_BUCKETS = 5000;

const buckets = new Map<string, number[]>();

/** Evaluate WITHOUT recording — call before the guarded work. Prunes as it goes. */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): RateLimitDecision {
  const pruned = pruneEvents(buckets.get(key) ?? [], now, config.windowMs);
  if (pruned.length === 0) {
    buckets.delete(key);
  } else {
    buckets.set(key, pruned);
  }
  return evaluateRateLimit({ events: pruned, now, windowMs: config.windowMs, limit: config.limit });
}

/**
 * Record one counted event (a sign-in FAILURE, a slot MINT). Re-inserts the
 * bucket so Map insertion order approximates recency, making the eviction
 * below oldest-first.
 */
export function recordRateLimitEvent(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): void {
  const pruned = pruneEvents(buckets.get(key) ?? [], now, config.windowMs);
  pruned.push(now);
  buckets.delete(key);
  buckets.set(key, pruned);
  if (buckets.size > MAX_RATE_LIMIT_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
}

/** Forget a key entirely — the on-success reset for sign-in. */
export function clearRateLimitBucket(key: string): void {
  buckets.delete(key);
}

/** Test isolation only. */
export function resetRateLimitStoreForTests(): void {
  buckets.clear();
}
