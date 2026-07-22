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
 * Atomically evaluate AND (if allowed) record — the race-free gate. checkRateLimit
 * + recordRateLimitEvent as two calls leaves a window: concurrent requests for one
 * key can all pass the check before any records, so the limit is exceeded under a
 * burst (Unit 6 review, correctness/security P1). This pair runs with NO await
 * between the read and the write, so on JS's single-threaded event loop it is
 * indivisible — interleaving is impossible. Callers gate on this, then RELEASE the
 * recorded event only on an outcome that is not a real attempt (a DB outage, not a
 * failed guess). Do the network/DB work AFTER this returns.
 */
export function checkAndRecordRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): RateLimitDecision {
  const pruned = pruneEvents(buckets.get(key) ?? [], now, config.windowMs);
  const decision = evaluateRateLimit({
    events: pruned,
    now,
    windowMs: config.windowMs,
    limit: config.limit,
  });
  if (!decision.allowed) {
    // Persist the pruned view even on refusal so a stale/expired bucket is cleaned.
    if (pruned.length === 0) buckets.delete(key);
    else buckets.set(key, pruned);
    return decision;
  }
  pruned.push(now);
  storeBucket(key, pruned);
  return decision;
}

/**
 * Record one counted event (a sign-in FAILURE, a slot MINT) without a prior
 * atomic check — the non-gate recording path (e.g. counting a failure whose gate
 * already passed).
 */
export function recordRateLimitEvent(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): void {
  const pruned = pruneEvents(buckets.get(key) ?? [], now, config.windowMs);
  pruned.push(now);
  storeBucket(key, pruned);
}

/**
 * Undo the single most-recent event for a key — for the "this wasn't a real
 * attempt" path (a DB/scan outage between the gate and the work), so an
 * infrastructure blip never consumes a caller's budget or strikes a name.
 */
export function releaseRateLimitEvent(key: string): void {
  const events = buckets.get(key);
  if (!events || events.length === 0) return;
  // Remove one occurrence of the maximum timestamp (the most recent), which is
  // the event this invocation most likely just recorded.
  let maxIdx = 0;
  for (let i = 1; i < events.length; i++) if (events[i] > events[maxIdx]) maxIdx = i;
  events.splice(maxIdx, 1);
  if (events.length === 0) buckets.delete(key);
  else buckets.set(key, events);
}

/** Forget a key entirely — the on-success reset for sign-in. */
export function clearRateLimitBucket(key: string): void {
  buckets.delete(key);
}

/** Test isolation only. */
export function resetRateLimitStoreForTests(): void {
  buckets.clear();
}

/**
 * Store a bucket and, if the map is over the cap, evict the bucket with the
 * FEWEST events (ties broken by oldest last-activity) rather than oldest-inserted.
 * FIFO-by-insertion let an attacker who had locked a victim's key (many events)
 * flush that lockout by flooding thousands of single-event throwaway keys until
 * the victim's was the oldest survivor (Unit 6 review, security P1). Fewest-first
 * protects an active lockout: a 5-strike bucket is never evicted while 1-event
 * throwaway buckets exist. Eviction still "fails open" for whatever IS evicted —
 * inherent to a bounded in-memory store — but the evicted key is now the least
 * consequential one, and the per-IP sign-in cap bounds the flood that reaches
 * here in the first place.
 */
function storeBucket(key: string, events: number[]): void {
  buckets.delete(key);
  buckets.set(key, events);
  if (buckets.size <= MAX_RATE_LIMIT_BUCKETS) return;
  let victimKey: string | undefined;
  let victimCount = Infinity;
  let victimRecency = Infinity;
  for (const [k, ev] of buckets) {
    if (k === key) continue; // never evict the bucket we just wrote
    const recency = ev.length ? Math.max(...ev) : -Infinity;
    if (ev.length < victimCount || (ev.length === victimCount && recency < victimRecency)) {
      victimKey = k;
      victimCount = ev.length;
      victimRecency = recency;
    }
  }
  if (victimKey !== undefined) buckets.delete(victimKey);
}
