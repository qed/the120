/**
 * Pure decision rules for the First Profit cross-origin PARENT SIGNUP route
 * (Slice B Unit 2; R9, R10, R11, R16, R17). No Next, no Supabase — only
 * decisions, per the house pure-module convention. The sibling precedent is
 * ../login/login-rules.ts, and this module deliberately REUSES its origin
 * allowlist + client-IP extraction (re-exported below) so the two public
 * cross-origin surfaces can never drift on what an allowed Origin is or where
 * the attested client IP comes from.
 *
 * The posture this encodes:
 *   - ONE generic refusal. `shapeSignupRefusal` ignores its reason: a bad
 *     Origin is a 403 with no body; a validation failure, a launch-gate
 *     refusal, a rate-limit, and an outage are all the SAME 401 with a
 *     byte-identical body. The ONLY response that varies is the deliberate,
 *     documented `existing_account` enumeration signal (R10) — an accepted,
 *     rate-limited tradeoff so the SPA can route a returning parent to
 *     login/attach — and it is shaped by the route, not here.
 *   - The CODE-LEVEL LAUNCH GATE (Plan Revision 3, P0). While
 *     `FP_SIGNUP_TEST_ONLY` is on (the DEFAULT — unset means ON), a signup is
 *     allowed ONLY if its parent email is on the server-side test-family
 *     allowlist. A refused non-test signup collapses into the SAME generic 401
 *     as every other refusal, so the gate is invisible on the wire. Lifting the
 *     gate is a deliberate, separately-reviewed env change, never client input.
 *   - `isTestSignup` is the server-side-ONLY test-family determination (never a
 *     client field): the `@test.the120.invalid` domain OR an explicit env
 *     allowlist. It feeds `fp_signup_attempts.is_test`, which affects CRM/GTM
 *     visibility only and NEVER gates consent/verification.
 *   - Rate-limit keys mirror login's discipline: an (ip,email) bucket plus an
 *     ip aggregate, both `encodeURIComponent`-escaped before joining so an
 *     IPv6 colon or an `@`/`:` in an address can never make two distinct pairs
 *     alias onto one bucket.
 */

import { z } from "zod";
import type { RateLimitConfig } from "@/app/lib/fp/rate-limit-rules";

// Reused verbatim from the login surface — same allowlist, same attested-IP
// rule. Re-exported so the route imports its whole origin/IP contract from one
// place and a reader sees the reuse is intentional, not incidental.
export {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
  type OriginVerdict,
} from "../login/login-rules";

/* ----------------------------------------------------------- request parse */

// The two child age bands mirror fp_parental_consent.child_age_band's check
// constraint exactly (migration 20260829120000) so a value that validates here
// can never be rejected at the consent write in Unit 3.
export const CHILD_AGE_BANDS = ["under_13", "13_to_15", "16_plus"] as const;
export type ChildAgeBand = (typeof CHILD_AGE_BANDS)[number];

// (Slice B U15) The former `credentialChoice` path selector is GONE from START:
// every child is created the one username+password way (U14), so START no longer
// records a choice. The field is dropped from the schema entirely, and — under
// `.strict()` — an in-flight FP client that still sends it is now REFUSED as an
// unknown key (the FP client is reconciled in the same unit).
const signupSchema = z
  .object({
    parentName: z.string().trim().min(1).max(120),
    // `.email()`-shaped with an explicit `@`; bounded like the funnel's schema.
    parentEmail: z.email().max(200),
    parentPassword: z.string().min(8).max(200),
    childFirstName: z.string().trim().min(1).max(80),
    childAgeBand: z.enum(CHILD_AGE_BANDS),
    // ISO date (YYYY-MM-DD). Optional: the age band is the required signal;
    // an exact DOB is captured when the parent supplies it (COPPA/GDPR-K).
    childDob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    jurisdiction: z.string().trim().min(2).max(100),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;

export type ParsedSignupRequest = { ok: true; data: SignupInput } | { ok: false };

export function parseSignupRequest(body: unknown): ParsedSignupRequest {
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, data: parsed.data };
}

/* ------------------------------------------------------- parent name split */

/**
 * The parents row (via provisionOrRecognizeAccount) needs first/last; the
 * signup form collects one name field. Split on the FIRST run of whitespace:
 * everything before is the first name, the remainder is the last name (which
 * may be empty). Both are trimmed. Deterministic and pure so the route and its
 * tests agree on exactly what lands in `parents`.
 */
export function splitParentName(parentName: string): { firstName: string; lastName: string } {
  const trimmed = parentName.trim();
  const idx = trimmed.search(/\s/);
  if (idx === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx).trim() };
}

/* -------------------------------------------------- launch gate (Rev 3, P0) */

/** The subset of the environment the gate reads — passed IN so this stays pure. */
export type SignupGateEnv = {
  FP_SIGNUP_TEST_ONLY?: string | undefined;
  FP_SIGNUP_TEST_ALLOWLIST?: string | undefined;
};

/** The guarded test-family email domain (mirrors scripts/provision-path-family). */
export const TEST_SIGNUP_DOMAIN = "@test.the120.invalid";

/**
 * SERVER-SIDE ONLY test-family determination (never a client field): true iff
 * the parent email is under the guarded `@test.the120.invalid` domain OR listed
 * in the `FP_SIGNUP_TEST_ALLOWLIST` env (comma-separated, normalized). This is
 * the value that becomes `fp_signup_attempts.is_test` — CRM/GTM visibility
 * only, never a consent/verification bypass.
 */
export function isTestSignup(email: string, env: SignupGateEnv): boolean {
  const norm = email.trim().toLowerCase();
  if (norm.endsWith(TEST_SIGNUP_DOMAIN)) return true;
  const allow = (env.FP_SIGNUP_TEST_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(norm);
}

export type LaunchGateVerdict = { allowed: boolean; isTest: boolean; testOnly: boolean };

/**
 * The code-level launch gate. `testOnly` defaults to ON: only an explicit
 * `off`/`false`/`0` disables it, so a missing or typo'd env keeps the gate
 * CLOSED (fail-closed — a public launch must be a deliberate act). While
 * test-only is on, a signup is allowed iff it is a test-family signup; with the
 * gate lifted, every signup is allowed but test families are still tagged.
 */
export function launchGateVerdict(email: string, env: SignupGateEnv): LaunchGateVerdict {
  const isTest = isTestSignup(email, env);
  const raw = (env.FP_SIGNUP_TEST_ONLY ?? "").trim().toLowerCase();
  const testOnly = !["off", "false", "0"].includes(raw);
  return { allowed: testOnly ? isTest : true, isTest, testOnly };
}

/* --------------------------------------------------------- refusal shaping */

export type SignupRefusalReason =
  | "malformed_request"
  | "gate_refused"
  | "rate_limited"
  | "outage";

// The parent-facing copy is its own voice (this is a signup, not a child
// login) but the discipline is login's: serialized ONCE, byte-identical for
// every reason, no status/copy oracle.
export const SIGNUP_FAILED_MESSAGE =
  "We couldn't complete that request. Please check your details and try again.";
const REFUSAL_BODY = JSON.stringify({ success: false, error: SIGNUP_FAILED_MESSAGE });

export const SIGNUP_REFUSAL_STATUS = 401;

/** The reason is for the caller's logs/tests only — the output never varies. */
export function shapeSignupRefusal(reason: SignupRefusalReason): { status: 401; body: string } {
  void reason;
  return { status: SIGNUP_REFUSAL_STATUS, body: REFUSAL_BODY };
}

/* ---------------------------------------------------------- rate-limit keys */

/** (ip,email) bucket + ip aggregate, in a `fp-signup` namespace distinct from
 *  `fp-login` so the two surfaces' strikes never interact. Both segments are
 *  percent-encoded before the `:` join, so an IPv6 colon or an address `@`/`:`
 *  can never alias two distinct pairs into one bucket. */
export function deriveSignupRateLimitKeys(
  ip: string,
  email: string
): { emailKey: string; ipKey: string } {
  const ipEnc = encodeURIComponent(ip);
  return {
    emailKey: `fp-signup:${ipEnc}:${encodeURIComponent(email.trim().toLowerCase())}`,
    ipKey: `fp-signup-ip:${ipEnc}`,
  };
}

/**
 * Verify-completion keys — a DISTINCT `fp-signup-verify` namespace so a parent's
 * legitimate verify retries never drain the START budget for the same (ip,email)
 * and vice versa. Verify-completion re-checks the password via
 * signInWithPassword, so this bucket is the brute-force backstop for that door.
 */
export function deriveVerifyRateLimitKeys(
  ip: string,
  email: string
): { emailKey: string; ipKey: string } {
  const ipEnc = encodeURIComponent(ip);
  return {
    emailKey: `fp-signup-verify:${ipEnc}:${encodeURIComponent(email.trim().toLowerCase())}`,
    ipKey: `fp-signup-verify-ip:${ipEnc}`,
  };
}

/**
 * Signup is heavier than a login guess (it mints an account and sends mail),
 * so the per-(ip,email) budget is tight and the per-IP backstop bounds a single
 * source well below what enumerating an address list would need. Same
 * sliding-window shape as login's limits. Verify-completion reuses these.
 */
export const SIGNUP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 5 };
export const SIGNUP_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 60 * 60_000, limit: 20 };
