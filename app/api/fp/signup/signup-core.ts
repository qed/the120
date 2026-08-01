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
 * createAttempt → provision the parent account+parents row → link parent_id →
 * tag is_test on the CRM family → mint+store the verification token → (is_test)
 * auto-confirm OR (real) send the mail. Any failure AFTER the account exists
 * runs `cleanupAccount` (deleteUser, which cascades the parents row) per the
 * no-cross-call-transaction learning, and marks the attempt abandoned.
 *
 * ── SECURITY INVARIANT — no session before inbox proof (review P0) ──
 * START does NOT set the parent's chosen password. The account is created by
 * provisionOrRecognizeAccount with a RANDOM, never-disclosed password and stays
 * that way through START, so an attacker who POSTs a victim's email + a chosen
 * password CANNOT sign in against Supabase's public /token endpoint (they don't
 * know the random password; a reset would mail the victim; updateUser needs a
 * session). The parent's CHOSEN password (which the SPA collected, R14, and
 * re-submits at verify) is set ONLY inside verifyCompletion, AFTER inbox proof —
 * the redeemed token for a real family, or the is_test server-side auto-confirm
 * for a guarded test family. Redeem inbox → set password → sign in → return
 * tokens (Rev 1). The token proves the inbox; the password proves account
 * ownership; a session is unobtainable for an email until its token is redeemed.
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
  loadPendingRealAttemptByEmail,
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
  /** Set the account password to the parent's CHOSEN one — called ONLY from
   *  verifyCompletion, after inbox proof (review P0). admin.updateUserById. */
  setParentPassword: (userId: string, password: string) => Promise<{ ok: boolean }>;
  /** Compensation: deleteUser (cascades the parents row) — the single unwind.
   *  Returns ok:false when the delete itself failed so the caller can leave a
   *  durable marker for the stranded account. */
  cleanupAccount: (userId: string) => Promise<{ ok: boolean }>;
  /** Stateless signInWithPassword → parent session tokens (never a cookie).
   *  A classified failure: `outage` distinguishes a DB/network fault (release
   *  the rate-limit strike) from a genuine wrong password (strike stands). */
  signInParent: (
    email: string,
    password: string
  ) =>
    | Promise<
        | { ok: true; accessToken: string; refreshToken: string }
        | { ok: false; outage: boolean }
      >;
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
    // R10 + review P2 (lost-response resume): an existing email is USUALLY a
    // returning parent → route to login/attach. But a retry after a lost START
    // success ALSO lands here — the account exists because WE just made it.
    // Distinguish them: if a prior attempt for this email is still live (state
    // 'started', a token minted, unexpired, unverified), refresh its token and
    // resend, resuming verification instead of dead-ending into login.
    const resumed = await tryResumePending(deps, input, email, attemptId);
    if (resumed) return resumed;
    await markAbandoned(db, attemptId);
    return { kind: "existing_account" };
  }
  if (provisioned.kind !== "provisioned") {
    console.error(`[fp/signup] provision failed: ${provisioned.reason}`);
    await markAbandoned(db, attemptId);
    return { kind: "failed" };
  }
  const userId = provisioned.userId;

  // From here, the parent account EXISTS: every failure compensates it. The
  // account keeps its RANDOM provisioning password throughout START — the
  // parent's chosen password is set only after inbox proof, in verifyCompletion.
  const abort = async (stage: string): Promise<StartSignupResult> => {
    console.error(`[fp/signup] start aborting at ${stage} for attempt ${attemptId} — compensating`);
    const cleaned = await deps.cleanupAccount(userId);
    // Durable stranded-account marker (review P2): the on-delete-set-null FK
    // nulls parent_id when deleteUser SUCCEEDS, so an abandoned row that still
    // carries parent_id means the compensation failed and a real account is
    // stranded — discoverable via `state='abandoned' AND parent_id IS NOT NULL`.
    // We deliberately do NOT clear parent_id here; the FK is the marker.
    if (!cleaned.ok) {
      console.error(
        `[fp/signup] STRANDED ACCOUNT ${userId} (attempt ${attemptId}): deleteUser failed during compensation — needs manual cleanup (state='abandoned' AND parent_id IS NOT NULL)`
      );
    }
    await markAbandoned(db, attemptId);
    return { kind: "failed" };
  };

  // 3. Link the attempt to the parent account.
  const linked = await db
    .from("fp_signup_attempts")
    .update({ parent_id: userId, updated_at: new Date(deps.now()).toISOString() })
    .eq("id", attemptId);
  if (linked.error) {
    console.error(`[fp/signup] parent_id link failed: ${linked.error.message}`);
    return abort("link-parent");
  }

  // 4. Tag the CRM family (server-side is_test UPDATE on the trigger-created
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

  // 5. Mint + store the verification token (hash at rest, TTL).
  const token = deps.mintToken();
  const tokenHash = sha256Hex(token);
  const nowMs = deps.now();
  const stored = await storeVerification(db, {
    attemptId,
    tokenHash,
    expiresAtIso: new Date(nowMs + VERIFICATION_TTL_MS).toISOString(),
  });
  if (!stored) return abort("store-token");

  // 6a. is_test: auto-confirm server-side (the SAME redeem CAS, restricted to
  //     this is_test branch), skip the (undeliverable) mail. A non-verified
  //     result would leave the account permanently unverifiable (a retry hits
  //     existing_account), so treat it like every other post-creation failure
  //     and compensate (review P2).
  if (input.isTest) {
    const confirmed = await redeemVerification(db, {
      tokenHash,
      nowIso: new Date(deps.now()).toISOString(),
    });
    if (confirmed.status !== "verified") {
      console.error(`[fp/signup] is_test auto-confirm did not verify: ${confirmed.status}`);
      return abort("auto-confirm");
    }
    return { kind: "started", attemptId };
  }

  // 6b. Real family: send the verification mail (escaped greeting). A send
  //     failure strands the parent (no way to verify), so compensate and let
  //     them cleanly retry (R10 resumability).
  const sent = await sendVerificationMail(deps, {
    email,
    parentName: input.parentName,
    originBase: input.originBase,
    token,
  });
  if (!sent) return abort("send-mail");

  return { kind: "started", attemptId };
}

/**
 * Lost-response resume (review P2). Returns a `started` result (with the PRIOR
 * attempt's id) when a live pending attempt for this email is found and its
 * verification mail is refreshed+resent; otherwise null (the caller falls
 * through to the `existing_account` signal). is_test attempts are auto-confirmed
 * at start (verified_at set), so they never match here — this path is real
 * families only.
 */
async function tryResumePending(
  deps: SignupCoreDeps,
  input: StartSignupInput,
  email: string,
  currentAttemptId: string
): Promise<StartSignupResult | null> {
  const pending = await loadPendingRealAttemptByEmail(
    deps.db,
    email,
    new Date(deps.now()).toISOString(),
    currentAttemptId
  );
  if (!pending.ok || !pending.attempt) return null;

  // Refresh the token ON THE PRIOR attempt (we never kept the original raw
  // token — only its hash), then resend. The current duplicate row is abandoned.
  const token = deps.mintToken();
  const stored = await storeVerification(deps.db, {
    attemptId: pending.attempt.id,
    tokenHash: sha256Hex(token),
    expiresAtIso: new Date(deps.now() + VERIFICATION_TTL_MS).toISOString(),
  });
  if (!stored) return null; // fall through to existing_account; the dup is cleaned below by caller
  const sent = await sendVerificationMail(deps, {
    email,
    parentName: input.parentName,
    originBase: input.originBase,
    token,
  });
  if (!sent) return null;
  await markAbandoned(deps.db, currentAttemptId);
  return { kind: "started", attemptId: pending.attempt.id };
}

async function sendVerificationMail(
  deps: SignupCoreDeps,
  input: { email: string; parentName: string; originBase: string; token: string }
): Promise<boolean> {
  const link = `${input.originBase}/signup/verify?token=${input.token}`;
  const name = input.parentName.trim();
  const greeting = escapeHtml(name);
  const sent = await deps.sendMail({
    to: input.email,
    subject: "Verify your email to finish setting up First Profit",
    text:
      `Hi ${name},\n\n` +
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
    return false;
  }
  return true;
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
  // `outage` (a DB/auth fault) tells the route to release the rate-limit strike;
  // `invalid` (bad/expired token, email mismatch, wrong password) keeps it.
  | { ok: false; reason: "invalid" | "outage" };

/**
 * Complete verification and hand back the parent session tokens (Rev 1). The
 * parent's chosen password is set HERE — only after inbox proof (review P0):
 *   - token present  → redeem CAS (verify inbox), confirm the token's attempt
 *                       belongs to this email, set the password, then sign in.
 *   - token absent    → is_test only: require a verified is_test attempt for
 *                       this email (auto-confirmed at start), set the password,
 *                       then sign in.
 * The password is always required and re-verified via signInWithPassword, so a
 * replayed or leaked token can never mint a session on its own. Obtaining the
 * session is idempotent (a lost-response retry re-signs-in the owner — R10);
 * the token's `verified_at` flip is single-use (the CAS).
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
    if (redeemed.status === "error") return { ok: false, reason: "outage" };
    // `verified` (just now) and `already` (a prior successful verify) both
    // authorize sign-in; expired/invalid refuse (a bad request, not an outage).
    if (redeemed.status !== "verified" && redeemed.status !== "already") {
      return { ok: false, reason: "invalid" };
    }
    const attempt = redeemed.attempt;
    // The token's attempt must belong to the submitted email — otherwise a
    // stolen token could be paired with a different account's credentials.
    if (!attempt || attempt.parentEmail.trim().toLowerCase() !== email || !attempt.parentId) {
      console.error(`[fp/signup] verify email/token mismatch or missing parent_id`);
      return { ok: false, reason: "invalid" };
    }
    return await setPasswordAndSignIn(deps, attempt.parentId, email, input.password);
  }

  // Tokenless: is_test families only (the invalid inbox can't return a token).
  const found = await loadVerifiedTestAttemptByEmail(db, email);
  if (!found.ok) return { ok: false, reason: "outage" };
  if (!found.attempt || !found.attempt.parentId) return { ok: false, reason: "invalid" };
  return await setPasswordAndSignIn(deps, found.attempt.parentId, email, input.password);
}

async function setPasswordAndSignIn(
  deps: SignupCoreDeps,
  userId: string,
  email: string,
  password: string
): Promise<VerifyCompletionResult> {
  // Inbox proof is established; NOW the account may take the parent's chosen
  // password (review P0). A failure here is our DB/auth fault → outage.
  const pw = await deps.setParentPassword(userId, password);
  if (!pw.ok) return { ok: false, reason: "outage" };
  const signed = await deps.signInParent(email, password);
  if (!signed.ok) return { ok: false, reason: signed.outage ? "outage" : "invalid" };
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
