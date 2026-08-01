/**
 * First Profit parent-signup orchestration core (Slice B Unit 2; R9, R10, R11,
 * R16, R17). House core-module pattern: NO "use server", NO `server-only` — the
 * route hands in a service-role `db` and a small set of injected effects, and
 * tests hand in fakes. All the wire-shaping (CORS, origin, one refusal, rate
 * limit) lives in the thin route wrappers; all the DECISIONS about validation,
 * the launch gate, and rate-limit keys live in the pure signup-rules. This file
 * is the SEQUENCING between them and the database/auth/mail effects.
 *
 * ── START (provisionOrRecognizeAccount reuse + compensation) ──
 * createAttempt → provision the parent account+parents row → set the parent's
 * CHOSEN password on it → link parent_id → tag is_test on the CRM family →
 * mint+store the verification token → (is_test) auto-confirm OR (real) send the
 * mail. Any failure AFTER the account exists runs `cleanupAccount` (deleteUser,
 * which cascades the parents row) per the no-cross-call-transaction learning,
 * and marks the attempt abandoned. An existing email returns `existing_account`
 * (R10) — the accepted, rate-limited enumeration tradeoff — never a session.
 *
 * ── Where the parent's password comes from, and why (Rev 1) ──
 * provisionOrRecognizeAccount mints a RANDOM, never-disclosed password (its
 * funnel contract). But this flow must, at verify time, hand the SPA a real
 * parent session cross-origin — and the only session it can return in JSON is
 * one earned by `signInWithPassword`. So immediately after provisioning we
 * OVERWRITE the account password with the parent's CHOSEN password (the signup
 * form collected it, R14). The SPA holds that same password in memory; at
 * verify-completion it re-submits {token, email, password}. We redeem the token
 * (proving inbox control), confirm the email matches the token's attempt, then
 * `signInWithPassword(email, password)` on a stateless client and return
 * {access_token, refresh_token}. The token proves the inbox; the password
 * proves account ownership; neither alone yields a session. Obtaining the
 * session is idempotent (a lost-response retry re-signs-in the owner — R10);
 * the token's `verified_at` flip is single-use (the CAS).
 *
 * ── is_test (server-side only) ──
 * `is_test` is decided by signup-rules.launchGateVerdict from the email alone
 * (never a client field). For is_test rows the `@test.the120.invalid` inbox
 * can't receive mail, so start AUTO-CONFIRMS server-side (the same redeem CAS,
 * restricted to the is_test branch — never a general bypass) and skips the
 * send; verify-completion for those rows takes email+password with no token.
 */

import type { ProvisionInput, ProvisionResult } from "@/app/lib/funnel/account";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { sendEmail } from "@/app/lib/email";
import { escapeHtml } from "@/app/crm/lib/library-rules";
import {
  loadVerifiedTestAttemptByEmail,
  redeemVerification,
  sha256Hex,
  storeVerification,
  VERIFICATION_TTL_MS,
} from "./verify-store";

/* ------------------------------------------------------------------- deps */

export type SignupCoreDeps = {
  /** Service-role client — attempt-row + CRM-family I/O and the verify-store. */
  db: SupabaseClient;
  /** Reuse of app/lib/funnel/account.ts provisionOrRecognizeAccount (adapted
   *  cross-origin: the production wrapper skips the cookie session mint, since
   *  the parent session is delivered as JSON tokens at verify time). */
  provisionAccount: (input: ProvisionInput) => Promise<ProvisionResult>;
  /** Overwrite the freshly-provisioned account's password with the parent's
   *  chosen one (admin.updateUserById). */
  setParentPassword: (userId: string, password: string) => Promise<{ ok: boolean }>;
  /** Compensation: deleteUser (cascades the parents row) — the single unwind. */
  cleanupAccount: (userId: string) => Promise<void>;
  /** Stateless signInWithPassword → parent session tokens (never a cookie). */
  signInParent: (
    email: string,
    password: string
  ) => Promise<{ ok: true; accessToken: string; refreshToken: string } | { ok: false }>;
  sendMail: typeof sendEmail;
  /** 256-bit token minted at the impure boundary (crypto); injectable for tests. */
  mintToken: () => string;
  now: () => number;
};

/* --------------------------------------------------------------- START flow */

export type StartSignupInput = {
  parentEmail: string;
  parentFirstName: string;
  parentLastName: string;
  parentName: string; // as typed, for the email greeting (escaped)
  parentPassword: string;
  isTest: boolean;
  ip: string;
  ua: string;
  /** The validated request Origin — the verification link returns the parent to
   *  the same SPA they started on. */
  originBase: string;
};

export type StartSignupResult =
  | { kind: "started"; attemptId: string }
  | { kind: "existing_account" }
  | { kind: "failed" };

export async function startSignup(
  deps: SignupCoreDeps,
  input: StartSignupInput
): Promise<StartSignupResult> {
  const { db } = deps;
  const email = input.parentEmail.trim().toLowerCase();

  // 1. The attempt row is the anchor for the whole multi-step signup (R10).
  const inserted = await db
    .from("fp_signup_attempts")
    .insert({
      parent_email: email,
      state: "started",
      is_test: input.isTest,
      ip: input.ip,
      ua: input.ua,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    console.error(`[fp/signup] attempt insert failed: ${inserted.error?.message ?? "no row"}`);
    return { kind: "failed" };
  }
  const attemptId = String((inserted.data as { id: unknown }).id);

  // 2. Provision the parent account + parents row (email_exists → existing).
  const provisioned = await deps.provisionAccount({
    email,
    firstName: input.parentFirstName,
    lastName: input.parentLastName,
  });
  if (provisioned.kind === "existing_account") {
    // R10: a returning parent. The attempt is a no-op audit row; abandon it so
    // it never looks like a live in-flight signup. Never a session (enumeration
    // signal only — the SPA routes to login/attach).
    await markAbandoned(db, attemptId);
    return { kind: "existing_account" };
  }
  if (provisioned.kind !== "provisioned") {
    console.error(`[fp/signup] provision failed: ${provisioned.reason}`);
    await markAbandoned(db, attemptId);
    return { kind: "failed" };
  }
  const userId = provisioned.userId;

  // From here, the parent account EXISTS: every failure compensates it.
  const abort = async (stage: string): Promise<StartSignupResult> => {
    console.error(`[fp/signup] start aborting at ${stage} for attempt ${attemptId} — compensating`);
    await deps.cleanupAccount(userId);
    await markAbandoned(db, attemptId);
    return { kind: "failed" };
  };

  // 3. Overwrite the random provision password with the parent's chosen one, so
  //    verify-completion's signInWithPassword can mint the session (Rev 1).
  const pw = await deps.setParentPassword(userId, input.parentPassword);
  if (!pw.ok) return abort("set-password");

  // 4. Link the attempt to the parent account.
  const linked = await db
    .from("fp_signup_attempts")
    .update({ parent_id: userId, updated_at: new Date(deps.now()).toISOString() })
    .eq("id", attemptId);
  if (linked.error) {
    console.error(`[fp/signup] parent_id link failed: ${linked.error.message}`);
    return abort("link-parent");
  }

  // 5. Tag the CRM family (server-side is_test UPDATE on the trigger-created
  //    row). VISIBILITY ONLY (R17) — best-effort, never fails the signup.
  if (input.isTest) {
    const tagged = await db
      .from("families")
      .update({ is_test: true })
      .eq("parent_id", userId);
    if (tagged.error) {
      console.error(`[fp/signup] is_test family tag failed for ${userId}: ${tagged.error.message}`);
    }
  }

  // 6. Mint + store the verification token (hash at rest, TTL).
  const token = deps.mintToken();
  const tokenHash = sha256Hex(token);
  const nowMs = deps.now();
  const stored = await storeVerification(db, {
    attemptId,
    tokenHash,
    expiresAtIso: new Date(nowMs + VERIFICATION_TTL_MS).toISOString(),
  });
  if (!stored) return abort("store-token");

  // 7a. is_test: auto-confirm server-side (the SAME redeem CAS, restricted to
  //     this is_test branch), skip the (undeliverable) mail. Not fatal if it
  //     fails — the row simply stays unverified and the test can retry.
  if (input.isTest) {
    const confirmed = await redeemVerification(db, {
      tokenHash,
      nowIso: new Date(deps.now()).toISOString(),
    });
    if (confirmed.status !== "verified") {
      console.error(`[fp/signup] is_test auto-confirm did not verify: ${confirmed.status}`);
    }
    return { kind: "started", attemptId };
  }

  // 7b. Real family: send the verification mail (escaped greeting). The link
  //     returns the parent to the SPA, which re-submits {token,email,password}.
  //     A send failure strands the parent (no way to verify), so compensate and
  //     let them cleanly retry (R10 resumability).
  const link = `${input.originBase}/signup/verify?token=${token}`;
  const greeting = escapeHtml(input.parentName.trim());
  const sent = await deps.sendMail({
    to: email,
    subject: "Verify your email to finish setting up First Profit",
    text:
      `Hi ${input.parentName.trim()},\n\n` +
      `Confirm this email to finish creating your family's First Profit account:\n\n${link}\n\n` +
      `This link works once and expires in an hour. If you didn't start this, you can ignore it.`,
    html:
      `<p>Hi ${greeting},</p>` +
      `<p>Confirm this email to finish creating your family's First Profit account:</p>` +
      `<p><a href="${link}">Verify your email</a></p>` +
      `<p>This link works once and expires in an hour. If you didn't start this, you can ignore it.</p>`,
  });
  if (!sent.ok) {
    console.error(`[fp/signup] verification send failed: ${sent.error ?? "unknown"}`);
    return abort("send-mail");
  }

  return { kind: "started", attemptId };
}

/* -------------------------------------------------- VERIFY-COMPLETION flow */

export type VerifyCompletionInput = {
  /** Present for a real click; absent for the is_test tokenless path. */
  token?: string;
  email: string;
  password: string;
};

export type VerifyCompletionResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false };

/**
 * Complete verification and hand back the parent session tokens (Rev 1). Every
 * failure returns the SAME `{ ok: false }` — the route maps it onto the one
 * generic refusal. The two paths:
 *   - token present  → redeem CAS (verify inbox), confirm the token's attempt
 *                       belongs to this email, then sign in.
 *   - token absent   → is_test only: require a verified is_test attempt for
 *                       this email (auto-confirmed at start), then sign in.
 * The password is always required and re-verified via signInWithPassword, so a
 * replayed or leaked token can never mint a session on its own.
 */
export async function verifyCompletion(
  deps: SignupCoreDeps,
  input: VerifyCompletionInput
): Promise<VerifyCompletionResult> {
  const { db } = deps;
  const email = input.email.trim().toLowerCase();

  if (input.token) {
    const tokenHash = sha256Hex(input.token);
    const redeemed = await redeemVerification(db, {
      tokenHash,
      nowIso: new Date(deps.now()).toISOString(),
    });
    // `verified` (just now) and `already` (a prior successful verify) both
    // authorize sign-in; everything else refuses.
    if (redeemed.status !== "verified" && redeemed.status !== "already") {
      return { ok: false };
    }
    const attempt = redeemed.attempt;
    // The token's attempt must belong to the submitted email — otherwise a
    // stolen token could be paired with a different account's credentials.
    if (!attempt || attempt.parentEmail.trim().toLowerCase() !== email) {
      console.error(`[fp/signup] verify email/token mismatch`);
      return { ok: false };
    }
    return await signInAndShape(deps, email, input.password);
  }

  // Tokenless: is_test families only (the invalid inbox can't return a token).
  const found = await loadVerifiedTestAttemptByEmail(db, email);
  if (!found.ok || !found.attempt) return { ok: false };
  return await signInAndShape(deps, email, input.password);
}

async function signInAndShape(
  deps: SignupCoreDeps,
  email: string,
  password: string
): Promise<VerifyCompletionResult> {
  const signed = await deps.signInParent(email, password);
  if (!signed.ok) return { ok: false };
  return { ok: true, accessToken: signed.accessToken, refreshToken: signed.refreshToken };
}

/* --------------------------------------------------------------- helpers */

async function markAbandoned(db: SupabaseClient, attemptId: string): Promise<void> {
  const res = await db
    .from("fp_signup_attempts")
    .update({ state: "abandoned", updated_at: new Date().toISOString() })
    .eq("id", attemptId);
  if (res.error) {
    console.error(`[fp/signup] mark abandoned failed for ${attemptId}: ${res.error.message}`);
  }
}
