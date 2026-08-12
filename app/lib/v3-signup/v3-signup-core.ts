import "server-only";

/**
 * The New User Flow v3 parent step, as one deps-injected core (plan
 * docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md, Unit 2; R1, R2, R8,
 * R9). Four entry points — start, verifyCode, resendCode, editEmail — each
 * taking `input: unknown` and returning a discriminated union.
 *
 * `server-only`, deliberately NOT `"use server"`. Every export of a
 * `"use server"` file is a client-callable Server Action AND its arguments
 * arrive from the wire, so a core with a `deps` parameter must never live in
 * one (docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-
 * use-server-file-server-action-boundary-2026-07-17.md). The thin wrappers that
 * ARE actions live in app/start/actions.ts; they build deps and call these.
 *
 * ── WHAT THIS UNIT REUSES, AND WHY IT IS NOT A SECOND SIGNUP ──
 * The account lifecycle stays where it is tested: `startSignup` in
 * app/api/fp/signup/signup-core.ts, now in `code` mode. That means v3 inherits
 * its attempt-row anchoring, its provision-or-recognize contract, its
 * compensation-on-any-post-creation-failure, and its stranded-account marker
 * unchanged. What v3 adds is (a) the 6-digit code instead of a link, (b) the
 * COOKIE session, and (c) `is_test` re-derived server-side on this path.
 *
 * ── THE SECURITY ORDER, RESTATED BECAUSE THIS PATH IS NEW ──
 * The parent's CHOSEN password is set ONLY inside verifyCode, AFTER the redeem
 * CAS has proved inbox control. START leaves the account on the random
 * never-disclosed password `provisionOrRecognizeAccount` generated, so an
 * attacker who submits a victim's email plus a password of their choosing
 * cannot sign in against Supabase's public /token endpoint. That is the
 * confirmed-account-with-known-password-before-inbox-proof learning
 * (docs/solutions/security-issues/...-2026-08-01.md) and it is load-bearing.
 *
 * ── NO BEARER HANDLE LEAVES THIS MODULE (review FIX 1, design A) ──
 * An earlier revision returned the `fp_signup_attempts` id from START and took
 * it back on verify/resend/edit. That id was a bearer credential in everything
 * but name, and the RESUME path handed out ANOTHER family's: submit a victim's
 * address, receive their live attempt id, then call edit-email — whose only
 * guard was `state === 'started' && !verifiedAt` — and it would `deleteUser`
 * the victim's account and retarget their row. The same missing check also let
 * a LOCKED attempt be laundered into a fresh one with a zeroed guess counter,
 * dissolving the 6-guess cap the whole 10^6-entropy design rests on.
 *
 * The fix is structural, not a patch on the guard:
 *   - START returns NO id. `code_sent` is a bare discriminator.
 *   - VERIFY and RESEND take the EMAIL the caller typed; the server re-derives
 *     the attempt (loadCodeAttemptForVerifyByEmail / loadPendingCodeAttemptBy
 *     Email). There is nothing to steal because nothing is handed out.
 *   - EDIT-EMAIL IS NON-DESTRUCTIVE. It no longer deletes an account, no longer
 *     abandons an attempt, and no longer takes an attempt id at all: it is a
 *     fresh signup for the corrected address. The mistyped address's attempt is
 *     left to expire and be reaped, and the orphaned passwordless account it
 *     owns is logged at ERROR in the stranded-account vocabulary.
 *   - The `codeGuessCount >= MAX_CODE_GUESSES` refusal is asserted at every
 *     point an attempt could be recycled (signup-core's resume; the redeem and
 *     rotate CAS predicates), as defense in depth on top of the above.
 * The typed CODE remains the only secret in the exchange, which is exactly the
 * property the durable counter and the 10-minute TTL are sized for.
 *
 * ── WHY THE COOKIE PROBE IS FIRST, BEFORE THE REDEEM ──
 * v3's whole reason to exist is that app/dashboard reads a COOKIE session
 * (dashboard-gate-core → `supabaseServer().auth.getUser()`), while the fp cores
 * hand back JSON tokens. So verifyCode must mint a cookie session — and the
 * cookie store silently swallows writes outside a Server Action, which would
 * make `signInWithPassword` report success while the browser receives nothing
 * (docs/solutions/logic-errors/cookie-probe-before-account-side-effect-
 * 2026-07-27.md). The probe therefore runs BEFORE the redeem CAS, not merely
 * before the sign-in: the CAS is single-use and irreversible, so burning the
 * parent's code and then discovering we cannot hand them a session would strand
 * them with no code and no way back in.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendCodeMail, startSignup, type SignupCoreDeps } from "@/app/api/fp/signup/signup-core";
import {
  bumpCodeGuessCount,
  CODE_RESEND_COOLDOWN_MS,
  loadCodeAttemptForVerifyByEmail,
  loadPendingCodeAttemptByEmail,
  MAX_CODE_GUESSES,
  redeemVerificationCode,
  rotateVerificationCode,
  sha256Hex,
  VERIFICATION_CODE_TTL_MS,
} from "@/app/api/fp/signup/verify-store";
import { isTestSignup, splitParentName, type SignupGateEnv } from "@/app/api/fp/signup/signup-rules";
import {
  normalizeTypedCode,
  parseV3EditEmail,
  parseV3Resend,
  parseV3Start,
  parseV3Verify,
} from "./v3-signup-rules";

/* ------------------------------------------------------------------- deps */

export type V3SignupDeps = {
  /** The SAME injected-effect bundle the fp signup routes build — reused whole
   *  so v3 cannot drift from the tested account lifecycle. `signInParent` is
   *  unused on this path (v3 mints a cookie, not JSON tokens); `mintToken` is
   *  unused in code mode. */
  signup: SignupCoreDeps;
  /**
   * Throws when `cookies()` is not writable in this context. Same probe API,
   * same context, inert payload — the funnel's `assertCookiesWritable`
   * precedent. Called BEFORE the redeem CAS (module header).
   */
  assertCookiesWritable: () => Promise<void>;
  /** `signInWithPassword` on the COOKIE-BOUND server client, which is what
   *  writes the session cookies app/dashboard's gate later reads. */
  signInCookieSession: (email: string, password: string) => Promise<{ ok: boolean }>;
  /** The slice of env `isTestSignup` reads. Passed in so the core stays pure of
   *  `process.env` and a test can drive both classifications. */
  env: SignupGateEnv;
};

const db = (deps: V3SignupDeps): SupabaseClient => deps.signup.db;
const nowIso = (deps: V3SignupDeps): string => new Date(deps.signup.now()).toISOString();

/* -------------------------------------------------------------- 1. start */

export type V3StartResult =
  /** A code is on its way to that inbox. Carries NOTHING (review FIX 1): the
   *  attempt id stays server-side, and the code step re-submits the email. */
  | { kind: "code_sent" }
  /** This email already belongs to an account we cannot resume into: route to
   *  sign-in. The documented, rate-limited enumeration tradeoff — see
   *  v3-signup-rules' header, which enumerates EVERY branch of this union. */
  | { kind: "existing_account" }
  /** A prior attempt for this email burned its durable guess budget. */
  | { kind: "locked" }
  /** This email holds a live LINK attempt at the firstprofit.school door: tell
   *  them to check their inbox for the link, never to sign in (review FIX 4). */
  | { kind: "pending_elsewhere" }
  /** A re-issue onto an existing attempt failed. "Try again", NOT "go sign in"
   *  — this family has no password and sign-in cannot succeed (review FIX 2). */
  | { kind: "retryable" }
  | { kind: "failed" };

export type V3RequestContext = {
  /** Attested client IP (the action extracts it from request headers). */
  ip: string;
  ua: string;
};

/**
 * Step 1: name + email + password + the terms affirmation.
 *
 * `is_test` is RE-DERIVED HERE from the email alone through the very same
 * `isTestSignup` the HTTP route calls — never a client field, and never
 * inherited from the request. The v3 path deliberately does NOT consult
 * `launchGateVerdict`/`FP_SIGNUP_TEST_ONLY`: that gate governs the
 * firstprofit.school HTTP door only. v3's `/start` door has no launch gate of
 * its own — it is open on deploy, by owner decision.
 */
export async function v3StartSignup(
  deps: V3SignupDeps,
  input: unknown,
  ctx: V3RequestContext
): Promise<V3StartResult> {
  const parsed = parseV3Start(input);
  if (!parsed.ok) return { kind: "failed" };
  const data = parsed.data;
  const email = data.parentEmail.trim().toLowerCase();
  const { firstName, lastName } = splitParentName(data.parentName);

  const result = await startSignup(deps.signup, {
    parentEmail: email,
    parentFirstName: firstName,
    parentLastName: lastName,
    parentName: data.parentName,
    parentPassword: data.parentPassword,
    isTest: isTestSignup(email, deps.env),
    ip: ctx.ip,
    ua: ctx.ua,
    // Code mode sends no link, so there is no origin to return the parent to.
    originBase: "",
    mode: "code",
  });

  switch (result.kind) {
    case "started":
      // `result.attemptId` is DELIBERATELY DROPPED HERE. This is the boundary
      // the whole FIX 1 design rests on: signup-core still tracks the attempt
      // internally (both modes share one `started` shape), but nothing that
      // identifies a row crosses into a client-reachable result.
      return { kind: "code_sent" };
    case "existing_account":
      return { kind: "existing_account" };
    case "locked":
      return { kind: "locked" };
    case "pending_elsewhere":
      return { kind: "pending_elsewhere" };
    case "retryable":
      return { kind: "retryable" };
    default:
      return { kind: "failed" };
  }
}

/* --------------------------------------------------------- 2. verify code */

export type V3VerifyResult =
  /** Inbox proved, password set, COOKIE session minted. `attemptId` IS returned
   *  here — and only here — because the caller has now proved inbox control,
   *  and steps 2+ (consent, createChild) are attempt-scoped. */
  | { kind: "verified"; attemptId: string; parentId: string }
  | { kind: "invalid_code"; guessesRemaining: number }
  | { kind: "expired" }
  | { kind: "locked" }
  /**
   * The redeem CAS SUCCEEDED — inbox control is proved and the single-use code
   * is spent — but a step after it did not (review FIX 5). Distinct from
   * `failed` (which a wrong code also produces) for two reasons: the client
   * must KEEP the typed code rather than clear the input, because re-submitting
   * the SAME code lands on the redeem's `already` branch and recovers
   * end-to-end; and ops can filter this from ordinary bad guesses.
   */
  | { kind: "post_verify_failed" }
  | { kind: "failed" };

/**
 * TRACKED FOLLOW-UP (fpv04 U3): `verifyCodeCompletion` in
 * app/api/fp/signup/signup-core.ts is this function's tokens-in-JSON twin —
 * the shared redeem/guess/lock sequence should be extracted into one core;
 * until then any fix here MUST be mirrored in the twin.
 */
export async function v3VerifyCode(
  deps: V3SignupDeps,
  input: unknown
): Promise<V3VerifyResult> {
  const parsed = parseV3Verify(input);
  if (!parsed.ok) return { kind: "failed" };
  const { password } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const code = normalizeTypedCode(parsed.data.code);

  // FAIL CLOSED BEFORE THE IRREVERSIBLE STEP. The redeem CAS below is
  // single-use; if this context cannot persist a session cookie there is no
  // point burning the parent's code to discover it (module header).
  try {
    await deps.assertCookiesWritable();
  } catch {
    console.error(
      "[fp/v3-signup] cookies not writable in this context — refusing to verify (call from a Server Action)"
    );
    return { kind: "failed" };
  }

  // THE ATTEMPT IS RE-DERIVED FROM THE EMAIL, never taken from the caller
  // (review FIX 1). The redeem CAS stays attempt-scoped — it is simply scoped
  // to an id the SERVER chose, which is what makes a 6-digit hash collision
  // between two live families harmless.
  const found = await loadCodeAttemptForVerifyByEmail(db(deps), email);
  if (!found.ok) return { kind: "failed" };
  if (!found.attempt) {
    // No live code attempt for this address. Answered as an ordinary wrong
    // guess — same shape, same cost, no strike released — so "is there a
    // signup in flight for this address?" is not a question this action
    // answers. Nothing is written, so no counter can be driven from here.
    return { kind: "invalid_code", guessesRemaining: MAX_CODE_GUESSES - 1 };
  }
  const attemptId = found.attempt.id;

  const redeemed = await redeemVerificationCode(db(deps), {
    attemptId,
    codeHash: sha256Hex(code),
    nowIso: nowIso(deps),
  });

  switch (redeemed.status) {
    case "error":
      return { kind: "failed" };
    case "locked":
      return { kind: "locked" };
    case "expired":
      return { kind: "expired" };
    case "invalid": {
      // A wrong guess is DURABLY counted before we answer, so the count
      // survives a cold start, a second instance, and a restart.
      const bumped = await bumpCodeGuessCount(db(deps), {
        attemptId,
        nowIso: nowIso(deps),
      });
      if (!bumped.ok) {
        // FAIL CLOSED on CAS-retry exhaustion (review FIX 3). Exhaustion is
        // caused by concurrent guessing against one row — an attacker, not an
        // outage — and the store has locked the attempt. Reporting `locked`
        // (not `failed`) is also what stops the action from REFUNDING the
        // volumetric strike, so the guess is free of neither control.
        return bumped.reason === "exhausted" ? { kind: "locked" } : { kind: "failed" };
      }
      const remaining = Math.max(MAX_CODE_GUESSES - bumped.count, 0);
      return remaining === 0
        ? { kind: "locked" }
        : { kind: "invalid_code", guessesRemaining: remaining };
    }
    case "verified":
    case "already":
      break;
  }

  const attempt = redeemed.attempt;
  // Belt-and-braces: the resolver selected this row BY this email, so a
  // mismatch here would mean the row changed underneath us. `parentId` is the
  // real check — an attempt with no account cannot take a password.
  if (!attempt || attempt.parentEmail.trim().toLowerCase() !== email || !attempt.parentId) {
    console.error("[fp/v3-signup] verify email/attempt mismatch or missing parent_id");
    return { kind: "failed" };
  }

  // Inbox proof established → NOW the account may take the chosen password.
  // Everything from here is POST-REDEEM: the code is spent, so a failure must
  // NOT look like a wrong code (review FIX 5).
  const pw = await deps.signup.setParentPassword(attempt.parentId, password);
  if (!pw.ok) {
    console.error(
      `[fp/v3-signup] POST-REDEEM FAILURE (set password) for attempt ${attemptId} — the code is spent; re-submitting it recovers via the redeem's 'already' branch`
    );
    return { kind: "post_verify_failed" };
  }

  const signedIn = await deps.signInCookieSession(email, password);
  if (!signedIn.ok) {
    console.error(
      `[fp/v3-signup] POST-REDEEM FAILURE (cookie session mint) for attempt ${attemptId} — the code is spent; re-submitting it recovers via the redeem's 'already' branch`
    );
    return { kind: "post_verify_failed" };
  }

  return { kind: "verified", attemptId: attempt.id, parentId: attempt.parentId };
}

/* --------------------------------------------------------- 3. resend code */

export type V3ResendResult =
  | { kind: "sent" }
  /** Too soon since the last code — the CAS refused, no new code was minted. */
  | { kind: "cooldown" }
  | { kind: "locked" }
  | { kind: "failed" };

/**
 * Resend. Three properties, all enforced by the WRITE rather than by a check:
 *   - the cooldown is a CAS predicate, so two racing clicks mint ONE code;
 *   - a locked attempt cannot rotate (`code_guess_count < MAX_CODE_GUESSES` is
 *     in the same predicate), so resend can never be used to unlock;
 *   - the counter is not in the update's payload at all, so resend cannot reset
 *     it even by accident.
 *
 * Mail-failure honesty: the new code is minted BEFORE the send (we cannot email
 * a code we have not generated), so a provider failure leaves the attempt with
 * a rotated, undelivered code. That state is RETRYABLE — the parent resends
 * again after the cooldown — and it is never a half-created verified account:
 * nothing here touches `verified_at`, `state`, or the password.
 */
export async function v3ResendCode(
  deps: V3SignupDeps,
  input: unknown
): Promise<V3ResendResult> {
  const parsed = parseV3Resend(input);
  if (!parsed.ok) return { kind: "failed" };
  const email = parsed.data.email.trim().toLowerCase();

  // Same email-keyed resolution as verify (review FIX 1) — no client-held id.
  // `null` exclude: this call inserted no duplicate row to skip.
  const pending = await loadPendingCodeAttemptByEmail(db(deps), email, null);
  if (!pending.ok) return { kind: "failed" };
  if (!pending.attempt) {
    // Nothing live for this address. Answered as `cooldown`, the branch that
    // costs a strike and discloses nothing: a `failed` here would refund the
    // strike and turn resend into a free "does a signup exist?" probe.
    return { kind: "cooldown" };
  }
  // Defense in depth (review FIX 1): the rotate CAS already carries
  // `code_guess_count < MAX_CODE_GUESSES`, but refusing a locked attempt before
  // minting anything means no code is ever generated for a row that can never
  // redeem one.
  if (pending.attempt.codeGuessCount >= MAX_CODE_GUESSES) return { kind: "locked" };
  const attemptId = pending.attempt.id;

  const nowMs = deps.signup.now();
  const code = deps.signup.mintCode();
  const rotated = await rotateVerificationCode(db(deps), {
    attemptId,
    codeHash: sha256Hex(code),
    expiresAtIso: new Date(nowMs + VERIFICATION_CODE_TTL_MS).toISOString(),
    // "the current code was minted at least COOLDOWN ago", expressed against
    // the stored EXPIRY (= mintedAt + TTL). See rotateVerificationCode.
    cooldownBeforeIso: new Date(
      nowMs + VERIFICATION_CODE_TTL_MS - CODE_RESEND_COOLDOWN_MS
    ).toISOString(),
    nowIso: new Date(nowMs).toISOString(),
  });
  if (rotated === "locked") return { kind: "locked" };
  if (rotated === "cooldown") return { kind: "cooldown" };
  if (rotated !== "rotated") return { kind: "failed" };

  // ── THROUGH THE GUARDED CHOKEPOINT, NOT AROUND IT (whole-branch review,
  //    finding 1) ──
  // This used to call `deps.signup.sendMail(...)` raw, which made it the ONLY
  // unguarded auth-mail send in the v3 tree: `authMailVerdict` never ran, so a
  // 6-digit code — password-reset-equivalent — could in principle reach a
  // dormant, password-less @the120.school student inbox, where it is "neither
  // visible nor recoverable". It was not independently reachable, but only
  // because of an invariant in ANOTHER module (a guard-refused start aborts to
  // `abandoned`, so no `started` row survives for resend to find). A control
  // that holds only by a distant module's behaviour is a control that stops
  // holding without anyone noticing. `sendCodeMail` is now the single guarded
  // send site for every v3 code mail, start and resend alike.
  const sent = await sendCodeMail(deps.signup, {
    // The address the ROW carries, not the one the caller typed — they are the
    // same by construction (the row was selected by it) and using the row's
    // makes that non-negotiable.
    email: pending.attempt.parentEmail,
    // The attempt row does not carry the typed display name, and re-deriving one
    // from the address would guess at a person's name in their own inbox. A
    // resend greets without a name rather than inventing one.
    parentName: "",
    code,
    // Resends of the SAME code within Resend's dedupe window are the same mail;
    // a rotated code is a different one, so the key includes the code hash.
    idempotencyKey: `fp-v3-code:${attemptId}:${sha256Hex(code).slice(0, 32)}`,
  });
  if (!sent) {
    // sendCodeMail has already logged the specific cause (a guard refusal or a
    // provider error). Both are the same answer to the family: no code went out,
    // try again — never a half-created verified account.
    console.error(`[fp/v3-signup] resend send failed for attempt ${attemptId}`);
    return { kind: "failed" };
  }
  return { kind: "sent" };
}

/* ---------------------------------------------------------- 4. edit email */

/**
 * "That's the wrong address" before verifying — NON-DESTRUCTIVE since review
 * FIX 1.
 *
 * ── WHAT THIS USED TO DO, AND WHY IT WAS A P0 ──
 * It took an `attemptId`, authorized on `state === 'started' && !verifiedAt`
 * alone, called `cleanupAccount` (deleteUser) and retargeted the row. Its own
 * doc comment claimed "this only ever runs against an attempt the caller holds
 * … one THIS flow created" — which was FALSE, because the resume path returned
 * the PRIOR attempt's id to anyone who submitted that family's address. Knowing
 * a victim's email was therefore enough to delete their in-progress account.
 * The same guard never looked at `code_guess_count`, so a LOCKED attempt could
 * be laundered — delete, abandon, start again — into a fresh row with a zeroed
 * counter, making the 6-guess cap unlimited.
 *
 * ── WHAT IT DOES NOW ──
 * It is a fresh signup for the corrected address, full stop. No lookup, no
 * delete, no abandon, no attempt id — so there is no operation here an
 * unauthenticated caller could aim at somebody else's row. The mistyped
 * address's attempt is left alone: its code expires in ten minutes, the reaper
 * collects the row, and a parent who genuinely returns to that address gets the
 * resume re-issue (which is exactly why the resume path must keep working).
 *
 * ── THE ORPHAN, HANDLED HONESTLY ──
 * The cost is a real one: the mistyped address owns a passwordless auth account
 * nobody will ever use. That is a bookkeeping problem, not a security one, and
 * it is NOT worth an unauthenticated delete primitive. So it is logged at ERROR
 * in the same STRANDED vocabulary the compensation paths use. `previousEmail`
 * is used for that log line ONLY — never for a read, never for a write — and
 * newlines are stripped so an attacker-supplied value cannot forge log records.
 */
export async function v3EditEmail(
  deps: V3SignupDeps,
  input: unknown,
  ctx: V3RequestContext
): Promise<V3StartResult> {
  const parsed = parseV3EditEmail(input);
  if (!parsed.ok) return { kind: "failed" };
  const { previousEmail, ...startPayload } = parsed.data;

  if (previousEmail && previousEmail.trim().toLowerCase() !== startPayload.parentEmail.trim().toLowerCase()) {
    console.error(
      `[fp/v3-signup] STRANDED (orphaned) PENDING SIGNUP for ${previousEmail.replace(/[\r\n]/g, " ")} — edit-email corrected the address and deliberately left the prior passwordless account + attempt in place (no unauthenticated delete primitive; review FIX 1). Ops: fp_signup_attempts WHERE state='started' AND parent_id IS NOT NULL AND code_expires_at < now()`
    );
  }

  return v3StartSignup(deps, startPayload, ctx);
}
