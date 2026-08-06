/**
 * Pure decision rules for POST /api/fp/grade — the First Profit "ask-once"
 * birth-year capture (full-path cohort readiness plan, Unit 3; R9, R10) — plus
 * the school-year grade derivation the LOGIN route reuses to surface `grade`
 * at read time. No Next, no Supabase — only decisions, per the house
 * pure-module convention (../login/login-rules.ts is the sibling precedent,
 * and this module reuses its origin/IP contract via the route rather than
 * duplicating it).
 *
 * ── The school-year rule, stated once ──
 * Grades are derived from a bare BIRTH YEAR (children.birth_year, a text
 * column where '' is the unset sentinel — no birthday is stored). The chosen
 * North American convention: the school year starts SEPTEMBER 1 (UTC), and a
 * child is assumed to enter kindergarten (grade 0) in the calendar year they
 * turn 5. So for a school year starting in calendar year Y:
 *
 *     grade = (Y - birthYear) - 5
 *
 * e.g. born 2015, October 2026 (school year 2026-27) → grade 6; the same
 * child on 2026-08-31 (still school year 2025-26) → grade 5. With only a year
 * to work from, birthday-level cutoff precision is impossible; this is the
 * standard approximation and is off by at most one grade for fall-born kids.
 * UTC is used so the derivation is deterministic across server regions — a
 * few hours of skew around midnight at the boundary is immaterial for a
 * year-granularity value.
 *
 * ── The read/write asymmetry, on purpose ──
 * The WRITE (this route) REFUSES an implausible birth year — one whose
 * derived grade falls outside the program's 3-12 grade discipline
 * (gradeVerdict: refuse, never clamp). The READ (the login route's
 * resolveChildGrade) returns WHATEVER derives, unclamped, even outside 3-12:
 * a child legitimately ages past grade 12 across school years, and display
 * code (bandForGrade) already answers null outside the bands. Clamping at
 * read time would silently misband; refusing at read time would brick a
 * login. The write gate keeps garbage out; the read stays honest about what
 * the roster implies today.
 *
 * ── Provenance: fill a blank, never overwrite ──
 * `children.grade` is PARENT/STAFF-AUTHORITATIVE across The120 (progress-core
 * band derivation, AddFounder, provision-core's bandVerdictForGrade, the CRM
 * dossier, sibling-adoption conflict logic). The write route is therefore
 * FILL-ONLY: it reads the row first and writes only when BOTH birth_year and
 * grade are unset — a child-typed value fills a blank, never replaces roster
 * truth. When either is already set the route answers with the derived-at-read
 * value (resolveChildGrade) and performs no write. The SPA's ask-once flow
 * only fires on a null grade anyway; the fill-only read closes the
 * direct-call path.
 *
 * ── Refusal posture ──
 * ONE refusal. `shapeGradeRefusal` takes a reason (for the caller's logs and
 * tests) and deliberately ignores it: every refusal is the same 401 with a
 * byte-identical body (same copy as the login surface — one voice, no new
 * oracle). 403 exists only for a disallowed Origin. The session token IS the
 * identity — no code path branches on whether some OTHER account exists, so
 * no timing equalization is needed (see docs/solutions/security-issues/
 * constant-response-is-not-constant-timing-*.md).
 *
 * NEVER log the birth year or the derived grade — same rule as the login
 * route's never-log-credentials convention: both are child data.
 */

import { z } from "zod";
import { gradeVerdict } from "@/app/lib/funnel/child-rules";
import { SIGN_IN_FAILED_MESSAGE } from "@/app/fp/lib/provision-rules";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/fp/lib/rate-limit-rules";

/* ------------------------------------------------- school-year derivation */

/**
 * The calendar year the CURRENT school year started in (Sep 1 UTC boundary):
 * September–December → this year; January–August → last year.
 */
export function schoolYearStartYear(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 8 ? year : year - 1;
}

/**
 * Current grade from a birth year under the Sep-1 / kindergarten-at-5 rule
 * documented in the module header. Pure arithmetic — NO clamping, no range
 * check; callers that must refuse out-of-program values (the write path) run
 * the result through gradeVerdict themselves.
 */
export function gradeFromBirthYear(birthYear: number, now: Date): number {
  return schoolYearStartYear(now) - birthYear - 5;
}

/**
 * The READ-TIME resolution the login route uses (R9's derive-at-read rule, so
 * the value never goes stale across school years):
 *   1. `children.birth_year` when set (text; '' is the unset sentinel; only a
 *      strict digits-only string counts — parseInt's prefix-coercion is the
 *      same trap gradeVerdict documents) → derive the CURRENT grade;
 *   2. else the stored `children.grade` when it is an integer;
 *   3. else null.
 * UNCLAMPED by design — see the module header's read/write asymmetry note.
 */
export function resolveChildGrade(
  input: { birthYear: string; storedGrade: number | null },
  now: Date
): number | null {
  if (/^\d{4}$/.test(input.birthYear.trim())) {
    return gradeFromBirthYear(Number.parseInt(input.birthYear.trim(), 10), now);
  }
  if (typeof input.storedGrade === "number" && Number.isInteger(input.storedGrade)) {
    return input.storedGrade;
  }
  return null;
}

/* ----------------------------------------------------------- request parse */

// {birthYear: number} and nothing else load-bearing. `.strip()` (the zod
// default) drops stray keys rather than 401-refusing a future additive caller.
const gradeSchema = z
  .object({ birthYear: z.number().int() })
  .strip();

export type ParsedGradeRequest = { ok: true; birthYear: number } | { ok: false };

export function parseGradeRequest(body: unknown): ParsedGradeRequest {
  const parsed = gradeSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, birthYear: parsed.data.birthYear };
}

/* ------------------------------------------------------ write-side verdict */

export type BirthYearVerdict =
  | { ok: true; grade: number }
  | { ok: false; reason: "implausible_birth_year" };

/**
 * The WRITE gate: accept a birth year iff the grade it derives TODAY passes
 * the program's gradeVerdict discipline (integer, 3-12 — refuse, never
 * clamp). The plausible-birth-year window is therefore DERIVED from the grade
 * discipline rather than pinned as its own magic range: grade 3 ⇔ birth year
 * startYear-8, grade 12 ⇔ startYear-17, and both bounds move with the school
 * year automatically. A refusal reflects only the caller's own input — it is
 * shaped pre-DB and never touches account state.
 */
export function birthYearVerdict(birthYear: number, now: Date): BirthYearVerdict {
  if (!Number.isInteger(birthYear)) return { ok: false, reason: "implausible_birth_year" };
  const verdict = gradeVerdict(gradeFromBirthYear(birthYear, now));
  if (!verdict.ok) return { ok: false, reason: "implausible_birth_year" };
  return { ok: true, grade: verdict.grade };
}

/* --------------------------------------------------------- refusal shaping */

export type GradeRefusalReason =
  | "malformed_request"
  | "missing_token"
  | "invalid_token"
  | "not_child"
  | "implausible_birth_year"
  | "rate_limited"
  | "outage";

// Serialized ONCE at module load: refusals are byte-identical by construction,
// not by convention. Same copy as the login surface (one voice, no new oracle).
const REFUSAL_BODY = JSON.stringify({ success: false, error: SIGN_IN_FAILED_MESSAGE });

export const GRADE_REFUSAL_STATUS = 401;

/**
 * The reason parameter exists for the caller's structured logging and for the
 * tests that pin indistinguishability — the OUTPUT never varies with it.
 */
export function shapeGradeRefusal(reason: GradeRefusalReason): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: GRADE_REFUSAL_STATUS, body: REFUSAL_BODY };
}

/* ------------------------------------------------------------ bearer token */

type HeaderReader = { get(name: string): string | null };

/** The Bearer child-session token, or "" — mirrors the signup child route's
 *  extraction (case-insensitive scheme, trimmed). Never logged. */
export function extractBearerToken(headers: HeaderReader): string {
  const authz = headers.get("authorization") ?? "";
  return authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
}

/**
 * The UNVERIFIED `sub` claim of a JWT — the rate-limit BUCKET SEGMENT only,
 * NEVER an identity (identity comes from auth.getUser() after the gate). The
 * house discipline gates atomically BEFORE any DB I/O, so the per-user bucket
 * key must be derivable without a verification round-trip; an attacker who
 * forges the claim only fans out buckets, exactly as a typed name does on the
 * login surface, and the per-IP aggregate is the volume backstop either way.
 * Null for anything that does not even parse as a JWT — such a token can
 * never verify, so the caller refuses it pre-DB.
 */
export function unverifiedJwtSub(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- rate limiting */

/**
 * Modest budgets in this route's OWN namespace (never shared with login's):
 * the ask-once flow writes once per child ever, so 5 per (ip,user) window
 * covers a kid fiddling with the year picker while bounding a stolen-token
 * writer, and the per-IP aggregate is the flood backstop. Same window shape
 * as SIGN_IN_* by design.
 */
export const GRADE_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 5 };
export const GRADE_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 40 };

/**
 * Composite keys with BOTH segments `encodeURIComponent`-escaped before the
 * `:` join — an IPv6 ip or a `:` in a forged sub must never alias two
 * distinct (ip,user) pairs onto one bucket (see docs/solutions/security-
 * issues/composite-rate-limit-key-string-join-collides-*.md).
 *
 * `encodeRateLimitSegment` rather than a bare `encodeURIComponent`: the user
 * segment is `unverifiedJwtSub`'s output — an attacker-supplied string that can
 * contain a LONE SURROGATE, which makes encodeURIComponent THROW before either
 * strike is recorded, on a path this route runs pre-DB. Byte-identical output
 * for well-formed input (pinned by test).
 */
export function deriveGradeRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-grade:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-grade-ip:${ipEnc}`,
  };
}
