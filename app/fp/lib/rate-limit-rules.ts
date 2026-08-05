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

/**
 * PROPOSED-1's quick-create match lookup (FW Unit 4): each lookup is the counted
 * event, keyed by the calling guide.
 *
 * The lookup answers "does a student with this name exist, here or elsewhere?"
 * for an arbitrary typed name, which makes it a name-probe oracle in the hands
 * of a compromised guide session. It is already a narrow one — the cross-cohort
 * answer carries no band, id, or cohort — so this bounds volume rather than
 * information. 60 per 10 minutes is far past a real check-in table's walk-in
 * rate (the busiest hour of the busiest weekend is a few dozen) and far below
 * what enumerating a name list needs.
 */
/**
 * The residue beacon's durable insert (Staff Front Door Unit 6). Generous — a
 * legitimate device reports at most once per handover or refused sign-out — but
 * present, because the action is an open HTTP endpoint and the table it writes is
 * one a human at a desk ACTS on (security review: unbounded, any authenticated
 * account could flood it into noise).
 */
export const FW_RESIDUE_REPORT_RATE_LIMIT: RateLimitConfig = { windowMs: 10 * 60_000, limit: 20 };

export const FW_MATCH_LOOKUP_RATE_LIMIT: RateLimitConfig = { windowMs: 10 * 60_000, limit: 60 };

/* ───────────────── New User Flow v3 parent step (v3 Unit 2) ───────────────── */

/**
 * The v3 `/start` Server Actions get their OWN namespaces so their strikes can
 * never interact with `fp-signup` (the firstprofit.school HTTP front door) or
 * `fp-login`. Two live front doors share the `fp_signup_attempts` table; they
 * must not share a rate-limit bucket, or a spike at one would lock out the
 * other for the same family.
 *
 * ⚠ BOTH of these are VOLUMETRIC BACKSTOPS ONLY. This store is in-memory,
 * per-instance, and empty on cold start (see rate-limit-store.ts' own header),
 * so nothing security-load-bearing may rest on it. The control that actually
 * bounds code guessing is the DURABLE `code_guess_count` on the attempt row
 * (app/api/fp/signup/verify-store.ts MAX_CODE_GUESSES). These limits exist to
 * bound VOLUME — mail sends, account-creation probes, request floods — not to
 * bound guesses.
 */
export const V3_START_NAMESPACE = "fp-v3-start";
export const V3_START_IP_NAMESPACE = "fp-v3-start-ip";
export const V3_VERIFY_NAMESPACE = "fp-v3-verify";
export const V3_VERIFY_IP_NAMESPACE = "fp-v3-verify-ip";

/** Start is the heavy door — it mints an auth account and sends mail — so the
 *  per-(ip,email) budget is tight; it still covers a typo'd password, an
 *  edit-email, and a couple of retries in one sitting. */
export const V3_START_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 5 };

/** The per-IP backstop a varying email cannot dodge. Generous enough for a
 *  school open-house on one NAT, far below what enumerating a list needs. */
export const V3_START_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 60 * 60_000, limit: 20 };

/** Verify + resend share this per-(ip,email) budget. Sized ABOVE
 *  MAX_CODE_GUESSES on purpose: the durable counter is what must decide a
 *  lockout, and a volumetric limit that bit first would mask it (and would
 *  reset itself on the next cold start, which the durable counter never does). */
export const V3_VERIFY_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 20 };

export const V3_VERIFY_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 60 * 60_000, limit: 100 };

/* ─────────────── New User Flow v3 steps 2-5 (v3 Unit 3, review FIX 7) ─────── */

/**
 * The signed-in half of the v3 flow (add-kid, edit-kid, save-story, provision)
 * gets a per-PARENT budget.
 *
 * It was justified as "not a public surface", which is true and insufficient: a
 * single verified session can loop `v3AddKidAction` with `differentChild: true`,
 * and each call mints an `fp_signup_attempts` row + an `fp_parental_consent`
 * row + a draft carrying a minor's name — all of it BEFORE
 * `MAX_CHILDREN_PER_FAMILY` gets a say, since that cap lives inside
 * `createChild` at provisioning time. The durable ceiling is
 * `V3_MAX_ACTIVE_DRAFTS_PER_PARENT` (app/lib/v3-signup/v3-onboarding-core.ts);
 * this bounds the remaining reachable abuse, which is the add → provision →
 * add CYCLE (each cycle frees a draft slot by consuming it).
 *
 * Sized so an honest family never notices: adding three kids in one sitting,
 * with back-navigation, story edits and a provisioning retry each, is well under
 * 40 calls. Volumetric only, per the store's own header — the load-bearing
 * bounds are the draft cap above and the family cap in child-core.
 */
export const V3_ONBOARDING_NAMESPACE = "fp-v3-onboarding";

export const V3_ONBOARDING_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 40 };

/* ─────────────── New User Flow v3 cover generation (v3 Unit 4) ───────────── */

/**
 * `POST /api/fp/cover`. Its OWN namespace — never the onboarding action budget —
 * because the cover endpoint is a ROUTE HANDLER reachable independently of the
 * Server Actions, and because a family re-running their cover a few times must
 * not spend the budget that their provisioning retry needs.
 *
 * Recorded on the ATTESTED CLIENT IP, before any authorization work, because at
 * that point in the request there is no authenticated identity to key on — the
 * whole point of putting the limiter first is that it costs nothing and bounds
 * unauthenticated floods before the session probe and the DB reads.
 *
 * ⚠ VOLUMETRIC ONLY, like every bucket in this module (the store is in-memory
 * and empty on cold start). The load-bearing per-kid ceiling is the DURABLE
 * `generation_count` column on `fp_onboarding_drafts` / `children`, enforced by
 * a compare-and-set on the observed value (app/api/fp/cover/cover-core.ts,
 * COVER_GENERATION_CAP). A family behind one NAT with three kids, each redrawing
 * a few times, stays far inside this.
 */
export const V3_COVER_NAMESPACE = "fp-v3-cover";

export const V3_COVER_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 30 };

/* ─────────────── New User Flow v3 handoff exchange (v3 Unit 5) ──────────── */

/**
 * `POST /api/fp/handoff/exchange` — the CROSS-ORIGIN, UNAUTHENTICATED door that
 * turns a one-time code into a child's session. Its own namespace for the same
 * reason `fp-login` has one: a flood here must never spend (or be spent by) the
 * budget of any other surface, and the exchange is the only v3 bucket keyed on
 * an anonymous caller.
 *
 * Recorded on the ATTESTED CLIENT IP, BEFORE any work — the login route's
 * ordering. At that point the request carries nothing but a code, so there is no
 * identity to key on, and the limiter is what bounds a code-guessing flood
 * before a single DB round trip.
 *
 * ⚠ VOLUMETRIC ONLY, like every bucket here (in-memory, per-instance, empty on
 * cold start). Nothing security-load-bearing rests on it: the code is >=128 bits
 * of CSPRNG, stored only as sha256, single-use by a CAS, and dead after 120
 * seconds. Guessing it is not a thing this limit is holding back — it is holding
 * back VOLUME.
 *
 * Sized for the real caller: one exchange per handoff, plus a retry or two if a
 * tab is reloaded. A family device behind one NAT signing several kids in one
 * after another stays far inside 20/15min.
 */
export const V3_HANDOFF_NAMESPACE = "fp-v3-handoff";

export const V3_HANDOFF_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 20 };

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
