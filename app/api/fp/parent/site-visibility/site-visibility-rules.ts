/**
 * Pure decision rules for POST /api/fp/parent/site-visibility — the First
 * Profit SPA's cross-origin door for an authenticated PARENT to take ONE of
 * their own children's public pages OFFLINE, or put it back. No Next, no
 * Supabase — only decisions, per the house pure-module convention.
 *
 * The canonical sibling is ../reset-password/reset-password-rules.ts and this
 * module mirrors it wherever the two share a concern: ONE refusal body, its own
 * rate-limit namespaces, its own timeouts. Where they differ, the difference is
 * commented here.
 *
 * ── WHAT IS NOT RE-IMPLEMENTED ──
 * `setSitePublishedForParent` (@/app/lib/fp/fp-site-parent-core) is the SAME
 * core the120's own dashboard Server Action (`setFpSitePublishedAction`) calls.
 * It owns the ownership predicate, the DERIVATION of `profile_id` from the
 * authorized child row (the site is never addressed by a client-supplied key),
 * the never-published rule, and the operator-lock invariant. This door is the
 * HTTP/Bearer analogue of that action and adds nothing to it.
 *
 * ── OWNERSHIP IS THE SECURITY BOUNDARY, AND IT IS A WHERE CLAUSE ──
 * The `childId` in the body is an IDENTIFIER AND AUTHORIZES NOTHING: it goes
 * into the core's `.eq("id", childId).eq("parent_id", ctx.parentId)`, so a
 * child this parent does not own matches NO ROW. Nothing in this module can
 * widen that — it shapes a request and a refusal and holds no id at all.
 *
 * ── Never-log discipline (R3) ──
 * The bearer token, the handle and a child's name never reach a log line.
 * Nothing here embeds a value from its input in any string it produces.
 */

import { z } from "zod";
import { FP_PARENT_LOGIN_REFUSAL_BODY } from "../../parent-login/parent-login-rules";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/lib/fp/rate-limit-rules";
import type { ParentSiteRefusal } from "@/app/lib/fp/fp-site-parent-core";

/* ----------------------------------------------------------- request parse */

/**
 * `.strict()` — an unknown key is a malformed request, not a field to ignore.
 * A `handle` key in particular MUST be rejected rather than silently dropped:
 * the core addresses the site by a `profile_id` DERIVED from the authorized
 * child, and a caller that believes it named the page must never be told "ok"
 * while the server acted on a different one.
 *
 * `published` is a strict boolean — no "true"/1 coercion. This flips whether a
 * child's work is visible to the entire internet, and a value the caller and
 * the server might read differently is not acceptable on that switch.
 *
 * The `childId` is a UUID (see below), which is strictly tighter than the
 * core's own `parseToggleInput` length bound — so a body this schema accepts
 * can never be one the core then calls `bad_request` on.
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

const siteVisibilitySchema = z
  .object({ childId: UUID_CHILD_ID, published: z.boolean() })
  .strict();

export type ParsedSiteVisibilityRequest =
  | { ok: true; childId: string; published: boolean }
  | { ok: false };

export function parseSiteVisibilityRequest(body: unknown): ParsedSiteVisibilityRequest {
  const parsed = siteVisibilitySchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, childId: parsed.data.childId, published: parsed.data.published };
}

/* ------------------------------------------ THE ANSWER CONTRACT, STATED ONCE */

/**
 * ── THE ONE SOURCE OF TRUTH FOR "WHAT THIS DOOR RETURNS ON 200" ──
 * A bare `{ok:true}`. The door MUTATES; the SPA re-reads the roster (which
 * carries `site.published`) for the new state, so echoing a state here would be
 * a second answer to a question one door already owns — and two answers drift.
 * It also keeps this door from becoming a way to READ another surface's facts.
 *
 * Field ORDER is observable output: do not reorder.
 */
export type SiteVisibilityOkBody = { ok: true };

const SITE_VISIBILITY_OK_SHAPE: Record<keyof SiteVisibilityOkBody, true> = { ok: true };

/** Derived from the TYPE so drift is a compile error (the
 *  `PARENT_RESET_BODY_KEYS` key-pin discipline). The SPA mirrors this. */
export const SITE_VISIBILITY_OK_KEYS: readonly string[] = Object.keys(SITE_VISIBILITY_OK_SHAPE);

/** Serialized ONCE at module load, so the answer is byte-stable by
 *  construction rather than by convention. */
export const SITE_VISIBILITY_OK_BODY = JSON.stringify({
  ok: true,
} satisfies SiteVisibilityOkBody);

/* ------------------------------------------------- the refunded-strike set */

/**
 * WHICH CORE REFUSALS HAND THE RATE-LIMIT STRIKE BACK — AS AN ALLOWLIST,
 * ASSERTED AS A WHOLE SET (the `KID_CREDENTIALS_REFUNDED_OUTCOMES` idiom).
 *
 * ⚠ THE DEFAULT MUST BE "NOT REFUNDABLE", AND AN `if (reason === "outage")` AT
 * THE CALL SITE IS NOT THAT. A refusal added to `ParentSiteRefusal` later must
 * be non-refundable by default rather than by whoever remembers to check: a
 * refunded `forbidden` makes probing another family's child ids free (the
 * refunded-strike-refunds-the-attacker learning, 2026-08-05).
 *
 * Only OUR faults are here. `outage` is the whole set.
 */
export const SITE_VISIBILITY_REFUNDED_REFUSALS: readonly ParentSiteRefusal[] = ["outage"];

/** EVERY refusal the core can return. Listed so the test can sweep the
 *  complement of the allowlist and prove a new member defaults to "no
 *  refund". */
export const SITE_VISIBILITY_REFUSALS: readonly ParentSiteRefusal[] = [
  "bad_request",
  "forbidden",
  "no-site",
  "never-published",
  "outage",
];

/** The ONE predicate the route calls. Allowlist membership, nothing else. */
export const refundsSiteVisibilityStrike = (reason: ParentSiteRefusal): boolean =>
  SITE_VISIBILITY_REFUNDED_REFUSALS.includes(reason);

/* --------------------------------------------------------- refusal shaping */

export type SiteVisibilityRefusalReason =
  | "missing_token"
  | "invalid_token"
  | "malformed_request"
  | "not_parent"
  | "rate_limited"
  /**
   * The CORE refused: the child is not this parent's (or does not exist), the
   * child has no page, or the page was never published so there is nothing to
   * restore. Collapsed into ONE reason on purpose — a caller must not be able
   * to tell "not yours" from "no such child" from "no page", and the core
   * already makes the first two indistinguishable by construction. The SPA
   * never offers a control the core would refuse anyway, because the roster
   * tells it the page's real state.
   */
  | "core_refused"
  | "outage";

/**
 * The parent door's copy, byte-identical for every reason and IDENTICAL to what
 * /api/fp/parent-login, /api/fp/parent/roster, /api/fp/parent/reset-password
 * and /api/fp/parent/photo-consent answer. Same bytes on purpose: the SPA's
 * fetch layer sees ONE refusal shape whether the session expired, was never a
 * parent's, or named another family's child.
 */
export const SITE_VISIBILITY_REFUSAL_BODY = FP_PARENT_LOGIN_REFUSAL_BODY;

export const SITE_VISIBILITY_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for the
 *  tests that pin indistinguishability — the OUTPUT never varies with it. */
export function shapeSiteVisibilityRefusal(
  reason: SiteVisibilityRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: SITE_VISIBILITY_REFUSAL_STATUS, body: SITE_VISIBILITY_REFUSAL_BODY };
}

/* ---------------------------------------------------------- rate limiting */

/**
 * This door's OWN namespaces and budgets — never shared with the parent LOGIN
 * buckets, never with the roster's, and never with the reset or photo-consent
 * doors'. A parent who has just spent their reset budget must still be able to
 * pull a page offline: taking a child's work off the public internet is the
 * most time-critical thing a parent can ask this API for, and it must never be
 * queued behind unrelated activity on their own account.
 *
 * SIZING: a visibility flip is RARE and deliberate — a page goes offline for a
 * reason and comes back for a reason. 20 per (ip,parent) per 15 minutes is the
 * same budget as the reset and photo-consent doors, keeping ONE documented
 * sizing rationale for "how often may a parent change a child's account state".
 * It is not a security floor — the core's WHERE-clause predicate refuses a
 * foreign child no matter how many times it is asked — it is volume.
 *
 * The per-IP aggregate is DOUBLE the per-parent one, matching every sibling
 * door. Both are PINNED by test so any future retune is a deliberate edit.
 */
export const SITE_VISIBILITY_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 20 };
export const SITE_VISIBILITY_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 40 };

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
export function deriveSiteVisibilityRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-parent-site-visibility:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-parent-site-visibility-ip:${ipEnc}`,
  };
}

/* ------------------------------------------------------------ time budgets */

/**
 * The cap on any single Supabase round trip this route makes. Nothing in the
 * Supabase client sets a fetch timeout, so an unwrapped call can hang until the
 * platform's own ceiling. Deliberately the same 8 s as every sibling door's,
 * but its OWN constant, because nothing about this route should change when one
 * of those is retuned.
 */
export const SITE_VISIBILITY_READ_TIMEOUT_MS = 8_000;

/**
 * The whole-invocation deadline, as a duration from the first line of the
 * handler. Per-call timeouts do NOT bound their sum, and this route makes
 * several: token verify, parent gate, and the core's four (child, profile,
 * current site, the UPDATE). The route takes ONE deadline at entry and refuses
 * once it is spent, so the last word is always OUR refusal with OUR CORS
 * headers rather than the platform's CORS-less error page — a different
 * response shape, and therefore an oracle.
 */
export const SITE_VISIBILITY_TOTAL_BUDGET_MS = 30_000;
