/**
 * Pure decision rules for /api/fp/parent-login — the PARENT twin of the child
 * login door (fpv04 Unit 3; plan decision 4). No Next, no Supabase — only
 * decisions, per the house pure-module convention. The sibling precedent is
 * ../login/login-rules.ts, whose origin allowlist + attested-IP rule are
 * re-exported below so the cross-origin surfaces can never drift on what an
 * allowed Origin is.
 *
 * ── WHY A SEPARATE DOOR, WITH ITS OWN CONTRACT ──
 * The child doors share the pinned `FpSessionBody` contract, and the deployed
 * FP client adopts ANY token pair from that shape without reading a kind field
 * — so a discriminated response on the shared door was rejected in plan review
 * (forking `FpSessionBody` opens a window where parent credentials sign the
 * parent into the KID app). This door has its OWN body (`FpParentSessionBody`)
 * that no deployed client adopts: only the fpv04 s02 client, which tries the
 * child door first and this door second, will ever call it.
 *
 * The posture this encodes:
 *   - ONE refusal. `shapeParentLoginRefusal` ignores its reason: a bad Origin
 *     is a 403 with no body; everything else — validation, gate, rate limit,
 *     bad credentials, NON-PARENT account, outage — is the same 401 with a
 *     byte-identical body. No status or copy oracle.
 *   - NO ACCOUNT-EXISTENCE ORACLE, by construction rather than by a dummy: the
 *     identifier here is the real auth EMAIL, so an unknown address and a
 *     wrong password each cost exactly ONE signInWithPassword round-trip and
 *     Supabase answers `invalid_credentials` for both. (The child door needs
 *     its equalizing dummy auth because a username miss would otherwise skip
 *     the /token call; this door has no candidate scan to skip.)
 *   - FAIL-CLOSED LAUNCH GATE with a FOUNDER-SCOPED test path.
 *     `FP_PARENT_LOGIN_LIVE` is affirmative-only (`1`/`true`/`on` after
 *     trim+lowercase — the FP_HANDOFF_LANDING_LIVE spellings); unset, empty,
 *     `0`, a typo = OFF. While OFF, only a caller whose email is on the
 *     founder allowlist (`FP_SIGNUP_TEST_ALLOWLIST`, or the guarded
 *     `@test.the120.invalid` domain — the same `isTestSignup` identity the
 *     signup doors use) may pass, for prod-testing; every other caller gets
 *     the uniform refusal even with valid credentials. Identity-scoped, never
 *     a global test mode, invisible on the wire.
 */

import { z } from "zod";
import { isTestSignup } from "../signup/signup-rules";
import {
  FP_PARENT_LOGIN_IP_NAMESPACE,
  FP_PARENT_LOGIN_NAMESPACE,
} from "@/app/lib/fp/rate-limit-rules";

// Reused verbatim from the login surface — same allowlist, same attested-IP
// rule, same auth-error classification. Re-exported so the route imports its
// whole origin/IP contract from one place.
export {
  buildAllowedOrigins,
  checkOrigin,
  classifyAuthError,
  extractClientIp,
  type OriginVerdict,
} from "../login/login-rules";

/* ----------------------------------------------------------- request parse */

const parentLoginSchema = z
  .object({
    email: z.email().max(200),
    password: z.string().min(1).max(200),
  })
  .strict();

export type ParsedParentLoginRequest =
  | { ok: true; email: string; password: string }
  | { ok: false };

export function parseParentLoginRequest(body: unknown): ParsedParentLoginRequest {
  const parsed = parentLoginSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, email: parsed.data.email, password: parsed.data.password };
}

/* --------------------------------------- THE PARENT SESSION CONTRACT, ONCE */

/**
 * ── THE ONE SOURCE OF TRUTH FOR "WHAT THE PARENT DOOR RETURNS" ──
 * Deliberately NOT `FpSessionBody` and never to be merged with it (module
 * header). Kept minimal: the tokens the SPA `setSession`s with, plus the two
 * parent facts the fpv04 dashboard shell needs to greet and label the session
 * (`email` is the sign-in identity; `firstName` is the greeting, null when the
 * parents row has none). Field ORDER is observable output: do not reorder.
 */
export type FpParentSessionBody = {
  access_token: string;
  refresh_token: string;
  parent: { email: string; firstName: string | null };
};

/** Derived from the TYPE so drift is a compile error (FpSessionBody's key-pin
 *  discipline). Tests read these arrays; they can never pin a stale shape. */
const FP_PARENT_SESSION_BODY_SHAPE: Record<keyof FpParentSessionBody, true> = {
  access_token: true,
  refresh_token: true,
  parent: true,
};

const FP_PARENT_SESSION_PARENT_SHAPE: Record<keyof FpParentSessionBody["parent"], true> = {
  email: true,
  firstName: true,
};

export const FP_PARENT_SESSION_BODY_KEYS: readonly string[] = Object.keys(
  FP_PARENT_SESSION_BODY_SHAPE
);

export const FP_PARENT_SESSION_PARENT_KEYS: readonly string[] = Object.keys(
  FP_PARENT_SESSION_PARENT_SHAPE
);

/* --------------------------------------------------------- refusal shaping */

export type ParentLoginRefusalReason =
  | "malformed_request"
  | "gate_refused"
  | "bad_credentials"
  | "not_parent"
  | "rate_limited"
  | "outage";

/** This door's own copy — serialized ONCE, byte-identical for every reason.
 *  Deliberately NOT the child door's `FP_SIGN_IN_REFUSAL_BODY`: the contracts
 *  are separate on purpose, and the s02 client shows its own copy anyway. */
export const PARENT_LOGIN_FAILED_MESSAGE =
  "We couldn't sign you in. Please check your details and try again.";

export const FP_PARENT_LOGIN_REFUSAL_BODY = JSON.stringify({
  success: false,
  error: PARENT_LOGIN_FAILED_MESSAGE,
});

export const PARENT_LOGIN_REFUSAL_STATUS = 401;

/** The reason is for the caller's logs/tests only — the output never varies. */
export function shapeParentLoginRefusal(
  reason: ParentLoginRefusalReason
): { status: 401; body: string } {
  void reason;
  return { status: PARENT_LOGIN_REFUSAL_STATUS, body: FP_PARENT_LOGIN_REFUSAL_BODY };
}

/* ------------------------------------------------- launch gate (fail-closed) */

export type ParentLoginGateEnv = {
  FP_PARENT_LOGIN_TEST_ONLY?: string | undefined;
  FP_SIGNUP_TEST_ALLOWLIST?: string | undefined;
};

/**
 * PUBLIC-OPEN BY DEFAULT since fpv04 U6b-i, matching what the signup doors did
 * at U4 (t120 cb90cad) under the founder's standing decision: "deploy to
 * production live for all users. I don't want to have to set routes. I don't
 * want allowlists." There is no env for anyone to remember to set, so the
 * parent dashboard cannot ship dark by accident.
 *
 * The KILL-SWITCH keeps the affirmative-only spelling in the direction that
 * still matters: `FP_PARENT_LOGIN_TEST_ONLY` = `1`/`true`/`on`/`yes` closes
 * the door back to the founder allowlist. Unset, empty, or a typo reads OPEN —
 * the inversion of the old rule, and deliberate: the risk being defended
 * against is no longer "a typo opens a door too early" (the client is live)
 * but "a typo silently locks every parent out of their own dashboard".
 *
 * The legacy `FP_PARENT_LOGIN_LIVE` var is no longer read. It was affirmative
 * -only in the opposite direction, so leaving it wired would mean an unset
 * env closing the door the moment someone tidied the other flag away.
 */
export function isParentLoginTestOnly(raw: string | undefined | null): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export type ParentLoginGateVerdict = { allowed: boolean; live: boolean; isTest: boolean };

/**
 * The door-level verdict: OPEN to everyone unless the kill-switch is thrown,
 * in which case only the founder allowlist identity passes. The refusal for
 * everyone else is the SAME generic 401 — the gate is invisible on the wire.
 */
export function parentLoginGateVerdict(
  email: string,
  env: ParentLoginGateEnv
): ParentLoginGateVerdict {
  const live = !isParentLoginTestOnly(env.FP_PARENT_LOGIN_TEST_ONLY);
  const isTest = isTestSignup(email, { FP_SIGNUP_TEST_ALLOWLIST: env.FP_SIGNUP_TEST_ALLOWLIST });
  return { allowed: live || isTest, live, isTest };
}

/* ---------------------------------------------------------- rate-limit keys */

/** (ip,email) bucket + ip aggregate in this door's OWN namespaces (see
 *  rate-limit-rules for why they are never shared with the child door). Both
 *  segments percent-encoded before the `:` join — the IPv6/delimiter-collision
 *  defense every FP key derivation carries. */
export function deriveParentLoginRateLimitKeys(
  ip: string,
  email: string
): { emailKey: string; ipKey: string } {
  const ipEnc = encodeURIComponent(ip);
  return {
    emailKey: `${FP_PARENT_LOGIN_NAMESPACE}:${ipEnc}:${encodeURIComponent(email.trim().toLowerCase())}`,
    ipKey: `${FP_PARENT_LOGIN_IP_NAMESPACE}:${ipEnc}`,
  };
}
