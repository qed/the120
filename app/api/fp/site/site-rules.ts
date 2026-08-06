/**
 * Pure decision rules for the /api/fp/site/* surface — the First Profit public
 * -site registry endpoints (real-public-site plan, Unit 2: self-read,
 * availability, claim, publish). No Next, no Supabase — only decisions, per
 * the house pure-module convention (../login/login-rules.ts and
 * ../grade/grade-rules.ts are the sibling precedents; this module reuses their
 * origin/IP contract via the routes rather than duplicating it).
 *
 * The posture this encodes:
 *   - AUTH REFUSALS are the ONE generic 401 (byte-identical body, same copy as
 *     the login surface — no oracle): missing/invalid token, non-FP-child
 *     session, rate-limited, gated-off feature, outage. DESIGNED BRANCHES
 *     (taken / yours / invalid / already-claimed / locked) are 200-level
 *     structured results in the FP client's flat {ok:false} style — they are
 *     answers about the caller's OWN input and state, not refusals.
 *   - The child gate is fp_player_profiles: a session must resolve to an
 *     EXISTING fp_player_profiles row (not merely any authenticated JWT — the
 *     shared project's anon key can mint fresh authenticated principals, per
 *     the R20 record). The routes run that gate; this module shapes verdicts.
 *   - Handle validity / reserved / blocklist decisions live SERVER-SIDE here
 *     (the echo-the-server learning); the canonical primitives come from
 *     app/fp/lib/fp-public-site-rules.ts so the migration parity suite pins
 *     them once.
 *   - FEATURE GATE mirrors the signup launch gate (signup-rules.ts
 *     launchGateVerdict): fail-closed test-only default (unset = gated), with
 *     a per-account allowlist keyed on children.fp_username — the mechanism
 *     Unit 7 wants for a production Cedric-family test window. Checked AFTER
 *     the rate-limit strike (no allowed-vs-refused timing oracle), refused as
 *     the same generic 401.
 */

import { z } from "zod";
import { SIGN_IN_FAILED_MESSAGE } from "@/app/fp/lib/provision-rules";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/fp/lib/rate-limit-rules";
import {
  containsBlockedTerm,
  isReservedHandle,
  isValidHandle,
  normalizeHandle,
} from "@/app/fp/lib/fp-public-site-rules";

/* ----------------------------------------------------------- request parse */

// {handle} and nothing else load-bearing. `.strip()` (the zod default) drops
// stray keys — R24: a smuggled `profile_id`/`profileId` in the body does not
// even survive parsing; identity comes only from the session gate.
const handleSchema = z.object({ handle: z.string().min(1).max(80) }).strip();

export type ParsedHandleRequest = { ok: true; handle: string } | { ok: false };

export function parseHandleRequest(body: unknown): ParsedHandleRequest {
  const parsed = handleSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, handle: parsed.data.handle };
}

/* --------------------------------------------------------- refusal shaping */

export type SiteRefusalReason =
  | "malformed_request"
  | "missing_token"
  | "invalid_token"
  | "not_child"
  | "gate_refused"
  | "rate_limited"
  | "outage";

// Serialized ONCE at module load: refusals are byte-identical by construction,
// not by convention. Same copy as the login surface (one voice, no new oracle).
const REFUSAL_BODY = JSON.stringify({ success: false, error: SIGN_IN_FAILED_MESSAGE });

export const SITE_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for the
 *  tests that pin indistinguishability — the OUTPUT never varies with it. */
export function shapeSiteRefusal(reason: SiteRefusalReason): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: SITE_REFUSAL_STATUS, body: REFUSAL_BODY };
}

/* ------------------------------------------------------------ feature gate */

export type SiteGateEnv = {
  FP_SITE_TEST_ONLY?: string;
  FP_SITE_TEST_ALLOWLIST?: string;
};

export type SiteGateVerdict = { allowed: boolean; testOnly: boolean; isTest: boolean };

/**
 * Mirror of launchGateVerdict (signup-rules.ts), keyed on the child's
 * fp_username (FP children have no email). FAIL-CLOSED: FP_SITE_TEST_ONLY
 * unset/anything ≠ off|false|0 means the surface is allowlist-only, so a fresh
 * deploy can never open the claim/publish/availability surface by omission.
 * The allowlist is comma-separated fp_usernames, trimmed + lowercased, exact
 * match — the per-account production test window Unit 7 wants.
 */
export function siteGateVerdict(fpUsername: string | null, env: SiteGateEnv): SiteGateVerdict {
  const allowlist = (env.FP_SITE_TEST_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isTest =
    fpUsername !== null && allowlist.includes(fpUsername.trim().toLowerCase());
  const raw = (env.FP_SITE_TEST_ONLY ?? "").trim().toLowerCase();
  const testOnly = !["off", "false", "0"].includes(raw);
  return { allowed: testOnly ? isTest : true, isTest, testOnly };
}

/* ----------------------------------------------------------- status logic */

// The status ladder is SHARED with the parent-surface core (one copy rule —
// Unit 2 review item): it lives in fp-public-site-rules.ts and is re-exported
// here for this surface's consumers.
export {
  deriveSiteStatus,
  type SiteRowFlags,
  type SiteStatus,
} from "@/app/fp/lib/fp-public-site-rules";

/* ---------------------------------------------------------- handle verdict */

export type HandleShapeVerdict = { ok: true; handle: string } | { ok: false; reason: "invalid" };

/**
 * Normalize + validate a candidate handle through the FULL server pipeline:
 * shape (charset/length) → reserved → blocklist. One verdict for all three —
 * the kid-facing answer is "that one can't be used", and collapsing the
 * reasons keeps the response from teaching filter-dodging.
 */
export function handleShapeVerdict(rawHandle: string): HandleShapeVerdict {
  const handle = normalizeHandle(rawHandle);
  if (!isValidHandle(handle)) return { ok: false, reason: "invalid" };
  if (isReservedHandle(handle)) return { ok: false, reason: "invalid" };
  if (containsBlockedTerm(handle)) return { ok: false, reason: "invalid" };
  return { ok: true, handle };
}

/* ------------------------------------------------------------- suggestions */

/** Bounded suggestion fan-out (candidates generated, not returned raw — every
 *  candidate still passes handleShapeVerdict + a taken check). */
export const SUGGESTION_CANDIDATE_LIMIT = 8;
export const SUGGESTION_RESULT_LIMIT = 3;

/**
 * Deterministic variants for a taken handle (plan: simple deterministic
 * variants first): digit suffixes then two friendly tails, each clipped to the
 * 20-char cap before validation. Candidates that fail the shape/reserved/
 * blocklist pipeline are dropped HERE — a suggestion must be claimable by
 * construction (the taken check is the caller's DB-side step).
 */
export function suggestHandleCandidates(base: string): string[] {
  const stem = normalizeHandle(base).slice(0, 18);
  const raw = [
    ...["2", "3", "4", "5", "7", "8", "9"].map((d) => `${stem}${d}`),
    `${normalizeHandle(base).slice(0, 15)}-co`,
  ];
  const out: string[] = [];
  for (const candidate of raw) {
    const clipped = candidate.slice(0, 20);
    const verdict = handleShapeVerdict(clipped);
    if (verdict.ok && !out.includes(verdict.handle)) out.push(verdict.handle);
    if (out.length >= SUGGESTION_CANDIDATE_LIMIT) break;
  }
  return out;
}

/* ------------------------------------------------ 23505 conflict classifier */

export type ClaimConflictKind = "handle" | "profile" | "other";

/**
 * Classify a claim INSERT unique-violation by which constraint fired (matching
 * profile-rules.ts classifyInsertConflict's message-sniffing approach —
 * PostgREST surfaces the constraint name in message/details):
 *   handle  → the handle UNIQUE lost the race / already claimed by another →
 *             the designed `taken` branch
 *   profile → this profile already holds a row (PK) → re-read and answer
 *             idempotently (own handle) or `already-claimed` (different one)
 */
export function classifyClaimConflict(text: string): ClaimConflictKind {
  const lowered = text.toLowerCase();
  if (lowered.includes("handle")) return "handle";
  if (lowered.includes("pkey") || lowered.includes("profile_id")) return "profile";
  return "other";
}

/* ---------------------------------------------------------- rate limiting */

/**
 * Own `fp-site*` namespaces (never shared with login/grade). Budgets: the
 * availability bucket is deliberately ROOMY (a learner cycling suggestions in
 * onboarding must never be locked out of claiming — flow analyzer item 11);
 * claim/publish are write endpoints with modest budgets; the self-read rides
 * hydrate + room-open. Per-IP aggregates are the flood backstop.
 */
export const SITE_READ_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 60 };
export const SITE_AVAILABILITY_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 60 };
export const SITE_CLAIM_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 10 };
export const SITE_PUBLISH_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 10 };
export const SITE_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 240 };

/**
 * Composite keys with BOTH segments escaped before the `:` join (the
 * composite-key collision learning — IPv6 ips carry `:`). The user segment is
 * the token's unverified sub, a BUCKET KEY only, never an identity
 * (grade-rules pins the rationale).
 *
 * `encodeRateLimitSegment` rather than a bare `encodeURIComponent`: the user
 * segment is an attacker-supplied JWT `sub` that this route never charset-
 * validates, and a LONE SURROGATE in it makes encodeURIComponent THROW —
 * before either strike is recorded, on a path the routes run pre-DB. Output is
 * byte-identical to the bare call for well-formed input (pinned by test).
 * Contrast ../login/login-rules.ts, which is safe WITHOUT the helper only
 * because classifyIdentifier's USERNAME_FORMAT regex rejects a surrogate
 * before the derivation runs.
 */
export function deriveSiteRateLimitKeys(
  endpoint: "read" | "availability" | "claim" | "publish",
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-site-${endpoint}:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-site-ip:${ipEnc}`,
  };
}
