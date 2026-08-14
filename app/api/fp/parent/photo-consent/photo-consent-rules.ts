/**
 * Pure decision rules for POST /api/fp/parent/photo-consent — the First Profit
 * SPA's cross-origin door for an authenticated PARENT to GRANT or WITHDRAW
 * photo/cover permission for ONE of their own children. No Next, no Supabase —
 * only decisions, per the house pure-module convention.
 *
 * The canonical sibling is ../reset-password/reset-password-rules.ts and this
 * module mirrors it wherever the two share a concern: ONE refusal body, its own
 * rate-limit namespaces, its own timeouts. Where they differ, the difference is
 * commented here.
 *
 * ── WHAT IS NOT RE-IMPLEMENTED ──
 * `revokeChildPhotoConsent` and `captureLegacyChildConsent`
 * (@/app/lib/v3-signup/kid-credentials-core) are the SAME cores the120's own
 * dashboard Server Actions call. They own the ownership predicate, the
 * tombstone-then-mark ordering, the bind-to-rendered consent echo and the
 * evidence blob. There is deliberately no second writer of
 * `fp_parental_consent`: two implementations of "may this caller change this
 * child's photo permission" is exactly the drift this repo has already paid for
 * once.
 *
 * ── OWNERSHIP IS THE SECURITY BOUNDARY, AND IT LIVES IN THE CORE ──
 * The `childId` in the body is an IDENTIFIER AND AUTHORIZES NOTHING: it goes
 * into each core's WHERE clause beside the parent id `auth.getUser()` returned,
 * so a child this parent does not own matches NO ROW. Nothing in this module
 * can widen that — it shapes a request and a refusal and holds no id at all.
 *
 * ── THE ONE NON-401 ANSWER, AND WHY IT IS NOT A STATUS CODE ──
 * A GRANT whose echoed policy version/hash no longer matches what the server
 * renders is `stale_policy`, and the caller MUST be able to tell it apart:
 * the honest fix is "re-present the current text", and a byte-identical 401
 * would instead tell a parent to try again forever against text that will never
 * match. So it is answered as `200 {ok:false, reason:"stale_policy"}` — a
 * SUCCESSFUL HTTP exchange reporting a business outcome, never a status code,
 * so it can never be confused with an authorization refusal by a client (or a
 * proxy, or a log query) that reads status alone. Every authorization-shaped
 * refusal remains the byte-identical 401.
 *
 * ── Never-log discipline (R3) ──
 * The bearer token, the parent's email, the consent hash and a child's name
 * never reach a log line. Nothing here embeds a value from its input in any
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
 * TWO strict shapes, discriminated on `action`. `.strict()` on each member — an
 * unknown key is a malformed request, not a field to ignore.
 *
 * ⚠ THERE IS NO `childAgeBand` IN THE GRANT BODY, AND ITS ABSENCE IS A RULE.
 * `fp_parental_consent.child_age_band` is a NOT NULL column of a LEGAL EVIDENCE
 * record, and the caller is a browser SPA that holds no age for the child. It
 * is derived SERVER-SIDE from the child row (see the route), exactly as the
 * parent email, IP and user-agent are. A caller that sends one is REFUSED
 * rather than silently overruled, for the reason the reset door refuses a
 * caller-supplied password: a caller that believes it is setting a value must
 * never be told "ok" while the server used a different one — least of all on
 * the record that says how old a child was when their parent consented.
 *
 * The 100-character `childId` ceiling matches both cores' own bounds, so a body
 * this schema accepts can never be one a core then calls `bad_request` on for
 * length. The consent echo bounds are generous but finite: the version is a
 * dotted date and the hash a hex digest, and neither is parsed here — the
 * SERVER's `consentVerdict` inside the core decides whether they bind.
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
const childIdSchema = UUID_CHILD_ID;

const withdrawSchema = z
  .object({ childId: childIdSchema, action: z.literal("withdraw") })
  .strict();

const grantSchema = z
  .object({
    childId: childIdSchema,
    action: z.literal("grant"),
    consentVersion: z.string().min(1).max(100),
    consentHash: z.string().min(1).max(200),
  })
  .strict();

const photoConsentSchema = z.discriminatedUnion("action", [withdrawSchema, grantSchema]);

export type ParsedPhotoConsentRequest =
  | { ok: true; action: "withdraw"; childId: string }
  | { ok: true; action: "grant"; childId: string; consentVersion: string; consentHash: string }
  | { ok: false };

export function parsePhotoConsentRequest(body: unknown): ParsedPhotoConsentRequest {
  const parsed = photoConsentSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return parsed.data.action === "withdraw"
    ? { ok: true, action: "withdraw", childId: parsed.data.childId }
    : {
        ok: true,
        action: "grant",
        childId: parsed.data.childId,
        consentVersion: parsed.data.consentVersion,
        consentHash: parsed.data.consentHash,
      };
}

/* ------------------------------------------ THE ANSWER CONTRACT, STATED ONCE */

/**
 * ── THE ONE SOURCE OF TRUTH FOR "WHAT THIS DOOR RETURNS ON 200" ──
 * A bare `{ok:true}`. The door MUTATES; the SPA re-reads the roster (which
 * carries `photoConsentOpen`) for the new state, so echoing a state here would
 * be a second answer to a question one door already owns — and two answers
 * drift.
 *
 * Field ORDER is observable output: do not reorder.
 */
export type PhotoConsentOkBody = { ok: true };

/** The ONE non-refusal failure. See the module header for why this is a 200. */
export type PhotoConsentStaleBody = { ok: false; reason: "stale_policy" };

const PHOTO_CONSENT_OK_SHAPE: Record<keyof PhotoConsentOkBody, true> = { ok: true };
const PHOTO_CONSENT_STALE_SHAPE: Record<keyof PhotoConsentStaleBody, true> = {
  ok: true,
  reason: true,
};

/** Derived from the TYPES so drift is a compile error (the
 *  `PARENT_RESET_BODY_KEYS` key-pin discipline). The SPA mirrors these. */
export const PHOTO_CONSENT_OK_KEYS: readonly string[] = Object.keys(PHOTO_CONSENT_OK_SHAPE);
export const PHOTO_CONSENT_STALE_KEYS: readonly string[] =
  Object.keys(PHOTO_CONSENT_STALE_SHAPE);

/** Serialized ONCE at module load, so both answers are byte-stable by
 *  construction rather than by convention. */
export const PHOTO_CONSENT_OK_BODY = JSON.stringify({ ok: true } satisfies PhotoConsentOkBody);
export const PHOTO_CONSENT_STALE_BODY = JSON.stringify({
  ok: false,
  reason: "stale_policy",
} satisfies PhotoConsentStaleBody);

/* --------------------------------------------------------- refusal shaping */

export type PhotoConsentRefusalReason =
  | "missing_token"
  | "invalid_token"
  | "malformed_request"
  | "not_parent"
  | "rate_limited"
  /**
   * The CORE refused: the child is not this parent's (or does not exist), or
   * the request was malformed in a way only the core can see. Collapsed into
   * ONE reason on purpose — a caller must not be able to tell "not yours" from
   * "no such child", and the core already makes the two indistinguishable by
   * construction.
   */
  | "core_refused"
  | "outage";

/**
 * The parent door's copy, byte-identical for every reason and IDENTICAL to what
 * /api/fp/parent-login, /api/fp/parent/roster and /api/fp/parent/reset-password
 * answer. Same bytes on purpose: the SPA's fetch layer sees ONE refusal shape
 * whether the session expired, was never a parent's, or named another family's
 * child — and no probe of this URL learns anything a failed sign-in would not
 * already have told them.
 */
export const PHOTO_CONSENT_REFUSAL_BODY = FP_PARENT_LOGIN_REFUSAL_BODY;

export const PHOTO_CONSENT_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for the
 *  tests that pin indistinguishability — the OUTPUT never varies with it. */
export function shapePhotoConsentRefusal(
  reason: PhotoConsentRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: PHOTO_CONSENT_REFUSAL_STATUS, body: PHOTO_CONSENT_REFUSAL_BODY };
}

/* ---------------------------------------------------------- rate limiting */

/**
 * This door's OWN namespaces and budgets — never shared with the parent LOGIN
 * buckets, never with the roster's, never with the reset door's, and never with
 * the dashboard Server Action's `fp-v3-kid-*` buckets.
 *
 * ⚠ THE SEPARATION IS THE POINT HERE MORE THAN ANYWHERE. Sharing one bucket
 * across the dashboard's three kid actions was fixed once already (v3 Unit 8
 * review, FIX 6) for exactly this case: A PARENT EXERCISING A PRIVACY RIGHT
 * MUST NOT BE REFUSED BECAUSE OF UNRELATED ACTIVITY ON THEIR OWN ACCOUNT. A
 * parent who has just looped the password reset must still be able to withdraw
 * photo permission this minute.
 *
 * SIZING: granting or withdrawing photo permission is a decision, not a
 * workflow — a family does it once, occasionally twice. 20 per (ip,parent) per
 * 15 minutes is the same budget as the reset door's, keeping ONE documented
 * sizing rationale for "how often may a parent change a child's account state",
 * and it is not a security floor: the cores' WHERE-clause predicates refuse a
 * foreign child no matter how many times they are asked.
 *
 * The per-IP aggregate is DOUBLE the per-parent one, matching every sibling
 * door: two parents on one household NAT both fit, a scripted caller does not.
 * Both are PINNED by test so any future retune is a deliberate edit.
 */
export const PHOTO_CONSENT_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 20 };
export const PHOTO_CONSENT_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 40 };

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
export function derivePhotoConsentRateLimitKeys(
  ip: string,
  userSegment: string,
  /** ⚠ THE TWO DIRECTIONS DO NOT SHARE A BUDGET (U8b review, SEC-4).
   *
   *  A `stale_policy` answer is a real failed attempt and correctly keeps its
   *  strike, so a client holding a cached bundle after a policy deploy can burn
   *  the whole budget retrying a GRANT. If the buckets were shared, that parent
   *  would then be unable to WITHDRAW photo permission for fifteen minutes, and
   *  would be told the same opaque 401 an attacker gets — on the direction with
   *  the time-critical privacy meaning. Withdrawal is the direction a parent
   *  must always be able to exercise. */
  action: "grant" | "withdraw"
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  const ns = `fp-parent-photo-consent-${action}`;
  return {
    userKey: `${ns}:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `${ns}-ip:${ipEnc}`,
  };
}

/* ------------------------------------------------------------ time budgets */

/**
 * The cap on any single Supabase round trip this route makes. Nothing in the
 * Supabase client sets a fetch timeout, so an unwrapped call can hang until the
 * platform's own ceiling. Deliberately the same 8 s as every sibling door's — a
 * waiting parent is the same waiting human — but its OWN constant, because
 * nothing about this route should change when one of those is retuned.
 */
export const PHOTO_CONSENT_READ_TIMEOUT_MS = 8_000;

/**
 * The whole-invocation deadline, as a duration from the first line of the
 * handler. Per-call timeouts do NOT bound their sum, and this route makes
 * several: token verify, parent gate, the age-band read, and the core's own
 * reads and writes (a withdrawal touches the tombstone plus every active
 * consent row). The route takes ONE deadline at entry and refuses once it is
 * spent, so the last word is always OUR refusal with OUR CORS headers rather
 * than the platform's CORS-less error page — a different response shape, and
 * therefore an oracle.
 */
export const PHOTO_CONSENT_TOTAL_BUDGET_MS = 30_000;
