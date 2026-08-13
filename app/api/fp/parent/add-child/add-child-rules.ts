/**
 * Pure decision rules for POST /api/fp/parent/add-child — the First Profit
 * SPA's cross-origin door for an ALREADY SIGNED-IN parent to BEGIN adding a
 * second (third, …) child from the fpv04 parent dashboard. No Next, no
 * Supabase — only decisions, per the house pure-module convention.
 *
 * The siblings are ../roster/roster-rules.ts and
 * ../reset-password/reset-password-rules.ts, and this module mirrors them
 * wherever the three share a concern: the parent door's ONE refusal body, its
 * own rate-limit namespaces, its own timeouts. Where they differ, the
 * difference is commented here.
 *
 * ── WHAT THE DOOR IS FOR (and why it cannot be skipped) ──
 * The fpv04 consent and child-mint doors take NO attempt id (the email-keyed
 * design; ../../signup/attempt-resolve.ts) — they resolve the NEWEST attempt
 * owned by the authenticated parent. Reusing the parent's ORIGINAL signup
 * attempt for a second kid does not work: that attempt is in state
 * `child_created`, and ../../signup/child-core.ts treats a second mint on a
 * `child_created` attempt as an IDEMPOTENT REPLAY and returns the EXISTING
 * child rather than minting a new one. A parent tapping "add another child"
 * would be handed their FIRST child back. So a FRESH attempt row must exist
 * before the existing doors can do their existing jobs, and minting it is the
 * whole of this door's work.
 *
 * ── THE REQUEST HAS NO PARAMETERS. Not "none needed" — none ACCEPTED. ──
 * Like the roster door, and for the same reason: everything this route writes
 * is derived server-side from the authenticated identity, so there is
 * deliberately no code path that reads a caller-supplied value and therefore no
 * code path to forget to check one. `is_test` in particular is derived from the
 * parent's own stored email through ../../signup/signup-rules `isTestSignup`,
 * never taken from the client — the same server-side-only determination the
 * signup doors make.
 *
 * ── AND THE RESPONSE CARRIES NO ATTEMPT ID ──
 * `{ok: true}` and nothing else. Handing the SPA the id it never needed would
 * re-open the id-bearing-resume class that the email-keyed design closed
 * (attempt-resolve.ts' header). The client learns only that the next screen may
 * proceed.
 *
 * ── Never-log discipline (R3) ──
 * Nothing here embeds a value from its input in any string it produces, and the
 * route never logs the parent's email, the bearer token, or a child's anything.
 */

import { FP_PARENT_LOGIN_REFUSAL_BODY } from "../../parent-login/parent-login-rules";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/lib/fp/rate-limit-rules";

/* ------------------------------------------ THE CONTRACT, STATED ONCE */

/**
 * ── THE ONE SOURCE OF TRUTH FOR "WHAT THIS DOOR RETURNS" ──
 * A bare acknowledgement. The attempt id is deliberately absent (module
 * header); so is anything about the parent or their existing children, which
 * the roster door already serves and this one has no business duplicating.
 *
 * Field ORDER is observable output: do not reorder.
 */
export type ParentAddChildBody = { ok: true };

/** Derived from the TYPE so drift is a compile error (the FpParentSessionBody /
 *  ParentResetPasswordBody key-pin discipline). The SPA mirrors this array. */
const PARENT_ADD_CHILD_BODY_SHAPE: Record<keyof ParentAddChildBody, true> = { ok: true };

export const PARENT_ADD_CHILD_BODY_KEYS: readonly string[] = Object.keys(
  PARENT_ADD_CHILD_BODY_SHAPE
);

export const PARENT_ADD_CHILD_BODY = JSON.stringify({ ok: true });

/* --------------------------------------------------------- refusal shaping */

export type ParentAddChildRefusalReason =
  | "missing_token"
  | "invalid_token"
  | "not_parent"
  /** The `parents` row carries no usable email, so `parent_email` (NOT NULL on
   *  fp_signup_attempts) and the `is_test` determination both have no honest
   *  source. Refuse rather than write a blank one: a blank address would make
   *  the row invisible to every email-keyed resolver and would silently read as
   *  "not a test family" for a family that is one. */
  | "no_parent_email"
  | "rate_limited"
  | "outage";

/**
 * The parent door's copy, byte-identical for every reason and IDENTICAL to what
 * /api/fp/parent-login, /api/fp/parent/roster and /api/fp/parent/reset-password
 * answer. Same bytes on purpose: the dashboard's fetch layer sees ONE refusal
 * shape whether the session expired, was never a parent's, or hit the limiter —
 * and no probe of this URL learns anything a failed sign-in would not already
 * have told them.
 */
export const PARENT_ADD_CHILD_REFUSAL_BODY = FP_PARENT_LOGIN_REFUSAL_BODY;

export const PARENT_ADD_CHILD_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for the
 *  tests that pin indistinguishability — the OUTPUT never varies with it. */
export function shapeParentAddChildRefusal(
  reason: ParentAddChildRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: PARENT_ADD_CHILD_REFUSAL_STATUS, body: PARENT_ADD_CHILD_REFUSAL_BODY };
}

/* ---------------------------------------------------------- rate limiting */

/**
 * This door's OWN namespaces and budgets — never shared with the parent LOGIN
 * buckets, the ROSTER buckets, the RESET buckets, or the signup doors'. A
 * parent who has just spent their add-child budget must still be able to sign
 * in, load their dashboard and reset a kid's password; a dashboard refresh loop
 * must not cost them the ability to add a child.
 *
 * SIZING: adding a child is RARE — a family does it once per kid, ever, and
 * most families do it once or twice in the product's whole lifetime. The number
 * is nonetheless pinned to a REASON rather than to "rare, so pick something
 * small": 10 is `MAX_CHILDREN_PER_FAMILY` (../../signup/child-core.ts;
 * redeclared there from the funnel's own constant for the same
 * plain-module reason it is not imported here). At exactly that budget the
 * LIMITER can never be the thing that stops a legitimate family from filling
 * their roster in one sitting — a co-op family provisioning all ten kids on a
 * Sunday afternoon fits — while an eleventh call is refused by the mint's own
 * cap anyway, so nothing beyond the cap is worth spending a round trip on.
 *
 * It is far tighter than the roster's 120 on purpose: that door READS, this one
 * WRITES A ROW on every single call and has no natural idempotency to collapse
 * a loop into one row (see the route's header on why a fresh row per journey is
 * the correct and safe design). The limiter IS the volumetric bound on that row
 * growth, and the seven-day orphan sweep (app/lib/v3-signup/draft-reaper-*) is
 * the collector behind it.
 *
 * The per-IP aggregate is DOUBLE the per-parent one, matching the roster and
 * reset doors' ratio: two parents on one household NAT both fit, a scripted
 * caller does not. Both are PINNED by test so any future retune is a deliberate
 * edit.
 */
export const PARENT_ADD_CHILD_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 10 };
export const PARENT_ADD_CHILD_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 20 };

/**
 * Composite keys with BOTH segments escaped before the `:` join — an IPv6 ip or
 * a `:` in a forged sub must never alias two distinct (ip,user) pairs onto one
 * bucket (see docs/solutions/security-issues/
 * composite-rate-limit-key-string-join-collides-*.md).
 *
 * `encodeRateLimitSegment` rather than a bare `encodeURIComponent`: the user
 * segment is an attacker-supplied JWT `sub`, and a LONE SURROGATE in it makes
 * encodeURIComponent THROW — which on this route would land BEFORE either
 * strike is recorded, bypassing throttling entirely. This function is total.
 */
export function deriveParentAddChildRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-parent-add-child:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-parent-add-child-ip:${ipEnc}`,
  };
}

/* ------------------------------------------------------------ time budgets */

/**
 * The cap on any single Supabase round trip this route makes. Nothing in the
 * Supabase client sets a fetch timeout, so an unwrapped call can hang until the
 * platform's own ceiling. Deliberately the same 8 s as its two siblings' — a
 * waiting parent is the same waiting human — but its OWN constant, because
 * nothing about this route should change when those are retuned.
 */
export const PARENT_ADD_CHILD_READ_TIMEOUT_MS = 8_000;

/**
 * The whole-invocation deadline, as a duration from the first line of the
 * handler. Per-call timeouts do NOT bound their sum, and this route makes
 * three round trips: token verify, parent gate, attempt insert. The route takes
 * ONE deadline at entry and refuses once it is spent, so the last word is
 * always OUR refusal with OUR CORS headers rather than the platform's CORS-less
 * error page — a different response shape, and therefore an oracle.
 */
export const PARENT_ADD_CHILD_TOTAL_BUDGET_MS = 30_000;

/* ------------------------------------------------------------ email hygiene */

/**
 * The stored parent address, normalized exactly the way every other writer of
 * `fp_signup_attempts.parent_email` normalizes it (signup-core's
 * `input.parentEmail.trim().toLowerCase()`), so a row this door writes is
 * byte-identical in that column to one the signup door would have written for
 * the same family — which is what keeps the email-keyed resolvers in
 * ../../signup/verify-store.ts consistent across the two origins.
 *
 * Returns null for anything that is not a usable address, which the route turns
 * into `no_parent_email` rather than a blank write.
 */
export function normalizeParentEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const norm = raw.trim().toLowerCase();
  if (norm.length === 0 || !norm.includes("@")) return null;
  return norm;
}
