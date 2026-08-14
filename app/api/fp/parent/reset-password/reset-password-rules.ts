/**
 * Pure decision rules for POST /api/fp/parent/reset-password — the First Profit
 * SPA's cross-origin door for an authenticated PARENT to reset ONE of their own
 * children's First Profit passwords. No Next, no Supabase — only decisions, per
 * the house pure-module convention.
 *
 * The sibling is ../roster/roster-rules.ts (the parent dashboard's read door),
 * and this module mirrors it wherever the two share a concern: the parent
 * door's ONE refusal body, its own rate-limit namespaces, its own timeouts.
 * Where they differ, the difference is commented here.
 *
 * ── WHY THIS DOOR MINTS AND THE DASHBOARD'S OWN FORM DOES NOT ──
 * the120's dashboard reset (`resetKidPasswordAction`) takes a password the
 * PARENT TYPED. This door takes none: the fpv04 SPA has no password field on
 * the reset path — it mirrors the fpv04 CHILD MINT, where the server invents a
 * memorable `word-word-NN` value and shows it to the parent EXACTLY ONCE. So
 * the request body carries only `childId`, the password is minted here with
 * ../../signup/mint-rules `mintMemorablePassword`, and it is returned in the
 * 200 and NEVER logged, never stored in plaintext, never echoed anywhere else.
 *
 * ── WHAT IS NOT RE-IMPLEMENTED ──
 * The reset itself is `resetKidPassword` in
 * @/app/lib/v3-signup/kid-credentials-core — the SAME core the Server Action
 * calls. It owns the ownership predicate, the name-overlap rule and the
 * password floor; there is deliberately no second reset path, because two
 * implementations of "may this caller change this child's password" is exactly
 * the drift this repo has already paid for once.
 *
 * ── OWNERSHIP IS THE SECURITY BOUNDARY ──
 * Unlike the roster door, this route DOES take a caller-supplied id. That makes
 * the core's `.eq("id", childId).eq("parent_id", ctx.parentId)` WHERE-clause
 * predicate the entire authorization, and `ctx.parentId` is what
 * `auth.getUser()` returned for the presented bearer — never the token's own
 * `sub` claim, never a body field. Nothing in this module can widen that: it
 * shapes a request and a refusal and holds no id at all.
 *
 * ── Never-log discipline (R3) ──
 * The MINTED PASSWORD and the bearer token never reach a log line, and neither
 * does an `fp_username`. Nothing here embeds a value from its input in any
 * string it produces.
 */

import { z } from "zod";
import { FP_PARENT_LOGIN_REFUSAL_BODY } from "../../parent-login/parent-login-rules";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/lib/fp/rate-limit-rules";

/* ----------------------------------------------------------- request parse */

/**
 * `.strict()` — an unknown key is a malformed request, not a field to ignore.
 * A `password` key in particular MUST be rejected rather than silently dropped:
 * this door mints, and a caller that believes it is setting a password must
 * never be told "ok" while the server used a different value.
 *
 * The 100-character ceiling matches the core's own `parseKidPasswordInput`
 * bound, so a body this schema accepts can never be one the core then calls
 * `bad_request` on for length.
 */
/**
 * ⚠ A UUID, NOT "a non-empty string" (fpv04 U8b review, SEC-1).
 *
 * `children.id` is a `uuid` column, so a non-UUID does not miss the row — it
 * makes PostgREST answer 22P02 (invalid input syntax), which every site here
 * reads as OUR failure: the outcome is `outage`, and `outage` REFUNDS both
 * rate-limit strikes. A caller could therefore loop `{"childId":"x"}` forever,
 * paying a token verification and a service-role round trip each time while
 * the budget never fills — the documented volume control on the doors that
 * move a child's password, photo permission and public visibility, bypassed by
 * a malformed field.
 *
 * Refusing it at the schema makes it `malformed_request` instead: the strike
 * stands, and no DB round trip happens at all.
 */
const UUID_CHILD_ID = z.string().uuid();
const resetPasswordSchema = z.object({ childId: UUID_CHILD_ID }).strict();

export type ParsedParentResetRequest = { ok: true; childId: string } | { ok: false };

export function parseParentResetRequest(body: unknown): ParsedParentResetRequest {
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, childId: parsed.data.childId };
}

/* ------------------------------------------ THE RESET CONTRACT, STATED ONCE */

/**
 * ── THE ONE SOURCE OF TRUTH FOR "WHAT THIS DOOR RETURNS" ──
 * `password` is the newly minted plaintext, and this response is the ONLY place
 * it will ever exist outside the auth store's hash: the SPA shows it on the
 * one-time reveal screen exactly as it shows a freshly minted child's. There is
 * no second read, no email, no log line.
 *
 * `fpUsername` rides along because the reveal screen shows the pair — a parent
 * helping a kid sign in needs both halves, and the SPA must not have to join
 * this response against a separately-fetched roster to render one card.
 *
 * `childId` is echoed so a client with two resets in flight can match the
 * response to the card that asked for it.
 *
 * Field ORDER is observable output: do not reorder.
 */
export type ParentResetPasswordBody = {
  ok: true;
  childId: string;
  fpUsername: string;
  password: string;
};

/** Derived from the TYPE so drift is a compile error (the FpParentSessionBody /
 *  FpChildMintBody key-pin discipline). The SPA mirrors this array. */
const PARENT_RESET_BODY_SHAPE: Record<keyof ParentResetPasswordBody, true> = {
  ok: true,
  childId: true,
  fpUsername: true,
  password: true,
};

export const PARENT_RESET_BODY_KEYS: readonly string[] = Object.keys(PARENT_RESET_BODY_SHAPE);

/* --------------------------------------------------------- refusal shaping */

export type ParentResetRefusalReason =
  | "missing_token"
  | "invalid_token"
  | "malformed_request"
  | "not_parent"
  | "rate_limited"
  /**
   * The CORE refused: the child is not this parent's (or does not exist), holds
   * no First Profit account, or every minted candidate collided with the kid's
   * own name. Collapsed into ONE reason on purpose — a caller must not be able
   * to tell "not yours" from "no such child" from "not enrolled", and the core
   * already makes the first two indistinguishable by construction.
   */
  | "core_refused"
  | "outage";

/**
 * The parent door's copy, byte-identical for every reason and IDENTICAL to what
 * /api/fp/parent-login and /api/fp/parent/roster answer. Same bytes on purpose:
 * the dashboard's fetch layer sees ONE refusal shape whether the session
 * expired, was never a parent's, named another family's child, or hit the
 * limiter — and no probe of this URL learns anything a failed sign-in would not
 * already have told them.
 *
 * ⚠ In particular there is no `weak_password` carve-out here, unlike the
 * dashboard Server Action. That action may explain itself because the parent
 * TYPED the value and can fix it; nothing the caller sent decides the password
 * on this door, so a specific message would describe only a server-side
 * re-roll — and would double as an oracle for whether the child is theirs.
 */
export const PARENT_RESET_REFUSAL_BODY = FP_PARENT_LOGIN_REFUSAL_BODY;

export const PARENT_RESET_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for the
 *  tests that pin indistinguishability — the OUTPUT never varies with it. */
export function shapeParentResetRefusal(
  reason: ParentResetRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: PARENT_RESET_REFUSAL_STATUS, body: PARENT_RESET_REFUSAL_BODY };
}

/* ---------------------------------------------------------- rate limiting */

/**
 * This door's OWN namespaces and budgets — never shared with the parent LOGIN
 * buckets, never with the roster buckets, and never with the dashboard Server
 * Action's `fp-v3-kid-reset` buckets. A parent who has just spent their reset
 * budget must still be able to sign in and still be able to load their
 * dashboard; a dashboard refresh loop must not cost them a reset.
 *
 * SIZING: a reset is RARE — a family does this a handful of times a year, once
 * per kid who forgot a password, plus the odd retry. 20 per (ip,parent) per 15
 * minutes is deliberately the SAME budget as `V3_KID_RESET_RATE_LIMIT`, which
 * is the same journey through a different door; keeping the two numbers equal
 * means a parent cannot pick the cheaper surface, and it keeps one documented
 * sizing rationale for "how often may a parent reset a kid's password".
 *
 * It is far tighter than the roster's 120 on purpose: that door READS, this one
 * MUTATES a credential, and every call here invalidates the password a child
 * may currently be logged in with. It is not a security floor — the core's
 * WHERE-clause predicate refuses a foreign child no matter how many times it is
 * asked, so there is no enumeration to slow down — it is volume, and the cost
 * of a loop is a kid whose password changes under them.
 *
 * The per-IP aggregate is DOUBLE the per-parent one, matching the roster door's
 * ratio: two parents on one household NAT both fit, a scripted caller does not.
 * Both are PINNED by test so any future retune is a deliberate edit.
 */
export const PARENT_RESET_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 20 };
export const PARENT_RESET_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 40 };

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
export function deriveParentResetRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-parent-reset:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-parent-reset-ip:${ipEnc}`,
  };
}

/* ------------------------------------------------------------ time budgets */

/**
 * The cap on any single Supabase round trip this route makes. Nothing in the
 * Supabase client sets a fetch timeout, so an unwrapped call can hang until the
 * platform's own ceiling. Deliberately the same 8 s as the roster door's — a
 * waiting parent is the same waiting human — but its OWN constant, because
 * nothing about this route should change when that one is retuned.
 */
export const PARENT_RESET_READ_TIMEOUT_MS = 8_000;

/**
 * The whole-invocation deadline, as a duration from the first line of the
 * handler. Per-call timeouts do NOT bound their sum, and this route can make
 * several: token verify, parent gate, the core's reads + the auth write (once
 * per mint attempt), and the username read. The route takes ONE deadline at
 * entry and refuses once it is spent, so the last word is always OUR refusal
 * with OUR CORS headers rather than the platform's CORS-less error page — a
 * different response shape, and therefore an oracle.
 */
export const PARENT_RESET_TOTAL_BUDGET_MS = 30_000;

/**
 * How many memorable candidates may be minted before giving up.
 *
 * A minted password always clears the R29 student floor by construction
 * (mint-rules: every word is 4-8 lowercase letters and none contains a
 * denylist substring), so the ONLY realistic re-roll cause is the name-overlap
 * rule — a kid whose first or last name IS one of the forty wordlist words.
 * `validateStudentPassword` matches on tokens of 3+ characters, so e.g. an
 * "Ember" or a "Hazel" has roughly a 1-in-20 chance per roll of colliding; five
 * attempts puts an exhausted mint at under one in three million per reset, and
 * exhaustion is then classified as OUR fault (refunded strike), not theirs.
 *
 * Bounded rather than open on purpose: each attempt is a full core call, and an
 * unbounded loop against a stuck RNG would burn the whole invocation budget.
 */
export const PARENT_RESET_MAX_MINT_ATTEMPTS = 5;
