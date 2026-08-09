/**
 * PURE decision rules for the parent-emailed 6-digit LOGIN CODE (fpv03 U3c) —
 * the second way a kid signs in to First Profit when the password is lost:
 * they type their username, we email their PARENT a 6-digit code, the kid
 * types the code, and the redeem mints the SAME FpSessionBody the password
 * door returns.
 *
 * No Next, no Supabase: request shapes, the code's format + TTL, the durable
 * guess cap, the outstanding-codes cap, the UNIFORM request response, the
 * refusal shaping, and the rate-limit keys. The impure sequencing lives in
 * ./login-code-core.ts; the wires are ./request/route.ts and
 * ./redeem/route.ts.
 *
 * ── THE THREAT MODEL, AGAINST THE HANDOFF'S ──
 * A 6-digit code is 10^6 of entropy — the OPPOSITE end of the spectrum from
 * the handoff's 256-bit code:
 *   1. HASH AT REST is decorative (10^6 preimages), kept anyway for hygiene.
 *   2. The consume CAS is CHILD-SCOPED (child_id + code_hash), never a global
 *      hash lookup — two families holding the same code is an ordinary event.
 *   3. THE LOAD-BEARING GUESS BOUND IS THE RATE LIMITER, NOT A DURABLE COUNTER
 *      (fpv03 U3c review, FIX 1). The v3 verify code locks an ATTEMPT the caller
 *      owns; here the username is guessable and public, so a durable per-code
 *      guess counter would let anyone lock a kid's only recovery door with six
 *      wrong codes. Instead THE CORRECT CODE ALWAYS REDEEMS, and brute force is
 *      bounded by a TIGHT redeem limiter (~5/15min per (ip,username), plus the
 *      per-IP cap): 5 tries per window against 10^6 is negligible, and no valid
 *      code can ever be locked. See login-code-store.ts's header.
 *   4. A ~10-minute TTL (the verify code's), not the handoff's 120s: the code
 *      crosses a parent's inbox and possibly a room, not one browser hop.
 *   5. UNIFORM RESPONSES. The request endpoint answers the SAME bytes whether
 *      or not the username exists (no enumeration); the redeem answers the
 *      login route's one byte-identical 401 for every failure, and its two
 *      failure paths issue an identical statement sequence.
 */

import { z } from "zod";
import {
  FP_LOGIN_CODE_REDEEM_IP_NAMESPACE,
  FP_LOGIN_CODE_REDEEM_NAMESPACE,
  FP_LOGIN_CODE_REQUEST_IP_NAMESPACE,
  FP_LOGIN_CODE_REQUEST_NAMESPACE,
  FP_LOGIN_CODE_REQUEST_PARENT_NAMESPACE,
  encodeRateLimitSegment,
} from "@/app/lib/fp/rate-limit-rules";
import { FP_SIGN_IN_REFUSAL_BODY } from "../login/login-rules";

/* ─────────────────────────────────────────────── the code + its bounds ──── */

export const LOGIN_CODE_LENGTH = 6;

/** "Expires in ten minutes" — the email says it, so this constant is it. */
export const LOGIN_CODE_TTL_MS = 10 * 60_000;

/**
 * Cap on live (unconsumed, unexpired) codes per child. Each outstanding code
 * is another 1-in-10^6 target AND another email in the parent's inbox; 3
 * covers "the first email was slow, we tapped again" without turning the
 * button into a mail loop. At the cap the request endpoint mails nothing —
 * and still answers the uniform body.
 */
export const MAX_OUTSTANDING_LOGIN_CODES = 3;

/**
 * Normalize what the kid typed to the canonical 6-digit string, or null.
 * Forgiving about whitespace (a code read aloud gets typed "123 456") and
 * fullwidth digits (NFKC), strict about everything else — a null is a wrong
 * guess, refused without any I/O.
 */
export function normalizeLoginCode(raw: string): string | null {
  const folded = raw.normalize("NFKC").replace(/[\s-]+/g, "");
  return /^[0-9]{6}$/.test(folded) ? folded : null;
}

/**
 * Format the CSPRNG integer the wire mints (crypto.randomInt(0, 1e6)) as the
 * zero-padded 6-digit code. Throws on an out-of-range value — a miscalled
 * generator must never quietly mint a short code.
 */
export function formatLoginCode(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 10 ** LOGIN_CODE_LENGTH) {
    throw new Error("formatLoginCode: out of range");
  }
  return String(n).padStart(LOGIN_CODE_LENGTH, "0");
}

/* ─────────────────────────────────────────────────────── request parsing ── */

// Username bounds match the login route's identifier schema (≤ 80).
const requestSchema = z.object({ username: z.string().min(1).max(80) }).strict();

export type ParsedCodeRequest = { ok: true; username: string } | { ok: false };

export function parseCodeRequest(body: unknown): ParsedCodeRequest {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, username: parsed.data.username };
}

// The redeem's code field is bounded loosely; normalizeLoginCode decides.
const redeemSchema = z
  .object({ username: z.string().min(1).max(80), code: z.string().min(1).max(20) })
  .strict();

export type ParsedCodeRedeem = { ok: true; username: string; code: string } | { ok: false };

export function parseCodeRedeem(body: unknown): ParsedCodeRedeem {
  const parsed = redeemSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, username: parsed.data.username, code: parsed.data.code };
}

/* ─────────────────────────────────────────────────────── uniform answers ── */

/**
 * THE ONE REQUEST RESPONSE — 200, byte-identical whether the username exists,
 * doesn't exist, is suppressed, is at the outstanding-codes cap, or the send
 * failed. Serialized ONCE at module load so no code path can accidentally
 * produce equal-looking-but-different bytes (the FP_SIGN_IN_REFUSAL_BODY
 * discipline applied to a success shape). The copy is the client's to show
 * verbatim; it promises nothing about the account.
 */
export const LOGIN_CODE_REQUEST_UNIFORM_BODY = JSON.stringify({
  ok: true,
  message: "If this account exists, we emailed the parent a code.",
});

export const LOGIN_CODE_REQUEST_STATUS = 200;

/** Every way the REDEEM says no — for logs and tests only; the wire output
 *  never varies with it (the login route's posture, same bytes). */
export type LoginCodeRefusalReason =
  | "malformed_request"
  | "invalid_code"
  | "not_child"
  | "rate_limited"
  | "outage";

export const LOGIN_CODE_REFUSAL_STATUS = 401;

/** The SAME string object the login route and the handoff exchange return —
 *  three doors, one refusal, no oracle telling an attacker which they hit. */
export function shapeLoginCodeRefusal(reason: LoginCodeRefusalReason): {
  status: typeof LOGIN_CODE_REFUSAL_STATUS;
  body: string;
} {
  void reason; // deliberately unused — the output must not vary with it
  return { status: LOGIN_CODE_REFUSAL_STATUS, body: FP_SIGN_IN_REFUSAL_BODY };
}

/**
 * WHICH REDEEM REFUSALS REFUND THE RATE-LIMIT STRIKE — the handoff's explicit
 * allowlist shape (whole-set asserted by test, never an `||` chain). Only
 * `outage` (our fault) refunds; `invalid_code` — the guess flood's product —
 * deliberately keeps its strike.
 */
export const LOGIN_CODE_REFUNDED_REFUSALS: readonly LoginCodeRefusalReason[] = ["outage"];

export const isLoginCodeInfraFailure = (reason: LoginCodeRefusalReason): boolean =>
  LOGIN_CODE_REFUNDED_REFUSALS.includes(reason);

/* ─────────────────────────────────────────────────────── rate-limit keys ── */

/**
 * Request keys: per-USERNAME (deliberately IP-independent — the harm bounded
 * is mail volume to one family, which an IP-scoped bucket would let a
 * distributed caller multiply) + the per-IP aggregate. Segments are
 * totally-escaped per the house IPv6/lone-surrogate learnings.
 */
export function deriveCodeRequestRateLimitKeys(
  ip: string,
  normalizedUsername: string
): { usernameKey: string; ipKey: string } {
  return {
    usernameKey: `${FP_LOGIN_CODE_REQUEST_NAMESPACE}:${encodeRateLimitSegment(normalizedUsername)}`,
    ipKey: `${FP_LOGIN_CODE_REQUEST_IP_NAMESPACE}:${encodeRateLimitSegment(ip)}`,
  };
}

/**
 * Per-PARENT-INBOX request key (fpv03 U3c review, FIX 2). Keyed on the RESOLVED
 * parent id ALONE — the harm is mail flooding a single family inbox, so varying
 * IP or child username must not buy more mail; only the parent identity bounds
 * it. `encodeRateLimitSegment` is TOTAL (a lone surrogate would otherwise throw
 * before the strike is recorded — the encodeuricomponent-is-not-total learning);
 * the parent id is our own UUID today, but it is encoded anyway so the key
 * derivation cannot become a 500 oracle if the keying identifier ever changes.
 */
export function deriveCodeRequestParentRateLimitKey(parentId: string): string {
  return `${FP_LOGIN_CODE_REQUEST_PARENT_NAMESPACE}:${encodeRateLimitSegment(parentId)}`;
}

/** Redeem per-IP key ALONE — recorded FIRST, before the body parse / classify
 *  early returns, so a malformed-request flood still burns the per-IP budget
 *  (fpv03 U3c review, FIX 1). The username bucket needs the classified name and
 *  is derived after. */
export function deriveCodeRedeemIpKey(ip: string): string {
  return `${FP_LOGIN_CODE_REDEEM_IP_NAMESPACE}:${encodeRateLimitSegment(ip)}`;
}

/** Redeem keys: (ip, username) + the per-IP aggregate — the login route's key
 *  discipline in this surface's own namespace. */
export function deriveCodeRedeemRateLimitKeys(
  ip: string,
  normalizedUsername: string
): { usernameKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    usernameKey: `${FP_LOGIN_CODE_REDEEM_NAMESPACE}:${ipEnc}:${encodeRateLimitSegment(normalizedUsername)}`,
    ipKey: `${FP_LOGIN_CODE_REDEEM_IP_NAMESPACE}:${ipEnc}`,
  };
}
