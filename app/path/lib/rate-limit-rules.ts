/**
 * Pure rate-limit decisions (T1 Unit 6, R29) — the first throttle anywhere in
 * this repo, so it is written generic from day one: a sliding-window evaluator
 * that any guarded entry point configures for itself. Unit 6 uses it to bound
 * student sign-in attempts (a first name is far more guessable than an email
 * within a cohort); Unit 9's review carried forward the requirement that the
 * SAME module bound `requestUploadSlot` (in-flight resumable objects are
 * invisible to the quota sum until confirmed, so slot minting must be bounded).
 *
 * Pure by repo convention (no Next, no Supabase, no Date.now) — the decision is
 * the defensible layer; storage of the event timestamps is the caller's concern
 * (see rate-limit-store.ts for the in-memory store the actions use).
 *
 * Window semantics, stated precisely so tests can pin them:
 *   - an event is IN the window iff `now - t < windowMs` (an event exactly
 *     windowMs old has expired);
 *   - a FUTURE-stamped event (clock skew between instances) still counts —
 *     pruning it would fail open;
 *   - the attempt is denied once the in-window count REACHES `limit`, so with
 *     limit 5 the sixth attempt is refused before any verification runs;
 *   - a non-positive limit denies everything (fail closed on a bad config, per
 *     docs/solutions/best-practices/optional-field-default-sentinel-not-legal-
 *     state-guard-fails-open-2026-07-21.md's fail-closed rule).
 */

export type RateLimitConfig = {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Attempts allowed per window; the (limit+1)th in-window attempt is denied. */
  limit: number;
};

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

/**
 * Student sign-in (R29): 5 failed attempts in 15 minutes locks the name out;
 * the 6th attempt is rejected even with the correct password. Failures are the
 * counted event — the action records one per failed verification, keyed by the
 * normalized typed name (the guessable unit an attacker iterates on).
 */
export const SIGN_IN_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 5 };

/**
 * Per-IP sign-in backstop (Unit 6 review): the per-name limit alone can be
 * side-stepped by varying the typed name every request (a fresh bucket each
 * time), which both defeats throttling and forces an unfiltered candidate scan
 * per request. A coarse per-IP cap bounds that flood regardless of name — set
 * generously so a family (or several kids) behind one NAT never trips it, while
 * still capping a single source far below the thousands of distinct-name
 * requests the bucket-eviction attack needs.
 */
export const SIGN_IN_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 40 };

/**
 * Upload-slot minting (Unit 9 carry-forward): each successful mint is the
 * counted event, keyed by the calling user. 30 mints / 10 min never touches an
 * honest capture session (a handful of evidence items plus retries) while
 * bounding the start-but-never-finish abuse the quota sum cannot see.
 */
export const UPLOAD_SLOT_RATE_LIMIT: RateLimitConfig = { windowMs: 10 * 60_000, limit: 30 };

/**
 * Co-parent invite creation (Unit 15): each successful send is the counted
 * event, keyed by the inviting user. A family has at most one co-parent to
 * invite (R4 caps at two), so 5 / 15 min covers re-sends and typo corrections
 * while bounding an abusive mail loop from one account.
 */
export const INVITE_CREATE_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 5 };

/**
 * Invite acceptance (Unit 15): keyed by client IP — the accept action is
 * unauthenticated (the token is the credential), so this bounds token
 * guessing. Tokens are 256-bit random, making the limit belt-and-braces.
 */
export const INVITE_ACCEPT_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 10 };

/** Events still inside the window (future-stamped ones included). Non-mutating. */
export function pruneEvents(events: readonly number[], now: number, windowMs: number): number[] {
  return events.filter((t) => now - t < windowMs);
}

/**
 * Decide whether one more attempt is allowed given the recorded event times.
 * On denial, `retryAfterMs` is the wait until the OLDEST in-window event
 * expires (clamped to (0, windowMs]) — the earliest moment a retry can help.
 */
export function evaluateRateLimit({
  events,
  now,
  windowMs,
  limit,
}: {
  events: readonly number[];
  now: number;
} & RateLimitConfig): RateLimitDecision {
  if (limit <= 0) return { allowed: false, retryAfterMs: windowMs };

  const inWindow = pruneEvents(events, now, windowMs);
  if (inWindow.length < limit) return { allowed: true };

  const oldest = Math.min(...inWindow);
  const retryAfterMs = Math.min(Math.max(oldest + windowMs - now, 1), windowMs);
  return { allowed: false, retryAfterMs };
}
