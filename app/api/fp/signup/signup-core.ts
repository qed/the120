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
  loadPendingCodeAttemptByEmail,
  loadPendingRealAttemptByEmail,
  loadVerifiedTestAttemptByEmail,
  MAX_CODE_GUESSES,
  redeemVerification,
  redeemVerificationCode,
  sha256Hex,
  storeVerification,
  storeVerificationCode,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_TTL_MS,
} from "./verify-store";
import { authMailVerdict } from "@/app/lib/auth-mail-guard";
import { buildCodeEmail } from "@/app/lib/v3-signup/v3-signup-rules";

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
  /** 256-bit token minted at the impure boundary (crypto); injectable for tests.
   *  LINK mode only — unused when start runs in `code` mode. */
  mintToken: () => string;
  /** 6-digit numeric code minted at the impure boundary (crypto `randomInt`);
   *  injectable for tests. CODE mode only (v3 /start) — the link routes pass a
   *  stub, exactly as they already stub the deps they do not use. */
  mintCode: () => string;
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
   *  the same SPA they started on. LINK mode only; code mode sends no link and
   *  ignores this field. */
  originBase: string;
  /**
   * WHICH EMAIL SECRET THIS START MINTS (New User Flow v3, Unit 2):
   *   - `link` (the default, and everything before v3) — a 256-bit token in
   *     `verification_token_hash` / `verification_expires_at`, emailed as a
   *     clickable link, 60-minute TTL. The firstprofit.school HTTP front door.
   *   - `code` — a typed 6-digit code in `verification_code_hash` /
   *     `code_expires_at` / `code_guess_count`, 10-minute TTL. The the120.school
   *     v3 `/start` Server Actions.
   * The two modes touch DISJOINT columns, so the same email can have one live
   * attempt at each front door without either clobbering the other's secret
   * (migration 20260914120000's header is the authority). Resume dispatches on
   * the mode too — see tryResumePending.
   */
  mode?: "link" | "code";
};

export type StartSignupResult =
  | { kind: "started"; attemptId: string }
  | { kind: "existing_account" }
  /** CODE mode only: a live prior attempt for this email has already burned its
   *  durable guess budget (verify-store MAX_CODE_GUESSES). Re-issuing a code
   *  there would mail a secret that can never be redeemed, and minting a FRESH
   *  attempt would hand the caller a fresh counter — which is exactly the hole
   *  the durable counter exists to close. So the start refuses and says so. */
  | { kind: "locked" }
  /** CODE mode only (review FIX 4): this email has no code attempt to resume,
   *  but it DOES hold a live firstprofit.school LINK attempt. `existing_account`
   *  would route the family to a sign-in they cannot pass (the account exists
   *  because that other door created it, and no password is set until the link
   *  is clicked), so the two are distinguished. The FP HTTP door maps this onto
   *  its generic refusal — it is unreachable from there, link mode never
   *  produces it. */
  | { kind: "pending_elsewhere" }
  /** CODE mode only (review FIX 2): a live pending attempt WAS found, but
   *  re-issuing its code failed (store or mail). The family is not a returning
   *  account holder and must not be told to sign in — this is a "try again"
   *  state, and the prior attempt id is on an ERROR line for ops. */
  | { kind: "retryable" }
  | { kind: "failed" };

export async function startSignup(
  deps: SignupCoreDeps,
  input: StartSignupInput
): Promise<StartSignupResult> {
  const { db } = deps;
  const email = input.parentEmail.trim().toLowerCase();
  const mode = input.mode ?? "link";

  // 1. The attempt row is the anchor for the whole multi-step signup (R10).
  const inserted = await db
    .from("fp_signup_attempts")
    .insert({
      parent_email: email,
      state: "started",
      is_test: input.isTest,
      ip: input.ip,
      ua: input.ua,
      // Explicit rather than left to the column DEFAULT (migration
      // 20260914120000). The durable code-guess counter is a security control,
      // and a control that only exists when a default fires is one an absent
      // column silently disables — code-mode's redeem and rotate CAS both
      // FILTER on this column, so a NULL there would make them match nothing.
      code_guess_count: 0,
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

  // 5/6. Mint, store and deliver the verification secret FOR THIS MODE. Code
  //      mode is a self-contained branch that touches only the code columns;
  //      the link path below it is byte-for-byte what it always was.
  if (mode === "code") {
    const code = deps.mintCode();
    const codeHash = sha256Hex(code);
    const nowMs = deps.now();
    const stored = await storeVerificationCode(db, {
      attemptId,
      codeHash,
      expiresAtIso: new Date(nowMs + VERIFICATION_CODE_TTL_MS).toISOString(),
      nowIso: new Date(nowMs).toISOString(),
    });
    if (!stored) return abort("store-code");

    // is_test: same server-side auto-confirm as link mode (the guarded
    // `@test.the120.invalid` inbox cannot receive the code), through the SAME
    // attempt-scoped CAS — never a general bypass.
    if (input.isTest) {
      const confirmed = await redeemVerificationCode(db, {
        attemptId,
        codeHash,
        nowIso: new Date(deps.now()).toISOString(),
      });
      if (confirmed.status !== "verified") {
        console.error(`[fp/signup] is_test code auto-confirm did not verify: ${confirmed.status}`);
        return abort("auto-confirm");
      }
      return { kind: "started", attemptId };
    }

    const sent = await sendCodeMail(deps, { email, parentName: input.parentName, code });
    if (!sent) return abort("send-code-mail");
    return { kind: "started", attemptId };
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
 * Lost-response resume (review P2), MODE-AWARE since v3 Unit 2.
 *
 * `provisionOrRecognizeAccount` said `existing_account`, which is usually a
 * returning parent — but it is ALSO what a retry after a lost START success
 * looks like, because the account exists only because WE just made it. This
 * function decides which, and it must do so PER MODE: the same email can
 * legitimately hold one live firstprofit.school LINK attempt and one v3 CODE
 * attempt at the same time, and neither may rotate the other's secret.
 *
 * The dispatch is STRUCTURAL, not a convention: each mode's resume read filters
 * on ITS OWN secret column being non-null (`verification_token_hash` vs
 * `verification_code_hash`), so a pure link attempt is invisible to the code
 * branch and vice versa. There is no shared row-selection to get wrong.
 *
 * is_test attempts are auto-confirmed at start (verified_at set) in BOTH modes,
 * so they never match either branch — this path is real families only.
 */
async function tryResumePending(
  deps: SignupCoreDeps,
  input: StartSignupInput,
  email: string,
  currentAttemptId: string
): Promise<StartSignupResult | null> {
  return (input.mode ?? "link") === "code"
    ? tryResumePendingCode(deps, input, email, currentAttemptId)
    : tryResumePendingLink(deps, input, email, currentAttemptId);
}

/** LINK mode — unchanged from Slice B. Only unexpired attempts resume; an
 *  expired link attempt still dead-ends in `existing_account`, because a link
 *  family's front door has its own resend and its own 60-minute window. */
async function tryResumePendingLink(
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

/**
 * CODE mode — the v3 re-issue hook. Two behaviours the link branch does not
 * have, both required by the plan:
 *
 *  1. NO EXPIRY FILTER on the pending read. "Return the next day with the same
 *     email" must re-issue a FRESH code on the SAME attempt rather than
 *     dead-ending in `existing_account`: the account exists because we created
 *     it at start and it has no password yet, so `existing_account` would route
 *     the family to a sign-in they cannot pass.
 *
 *  2. THE LOCK IS RESPECTED. If the prior attempt has already burned its
 *     durable guess budget, this does NOT mint a new code (that would mail a
 *     secret the redeem CAS can never accept) and does NOT start a clean
 *     attempt (that would reset the counter, making "start again" the
 *     unlimited-guesses button that "resend does not reset" exists to prevent).
 *     It reports `locked` and abandons the duplicate row.
 *
 * The re-issue writes only `verification_code_hash` / `code_expires_at`; the
 * counter rides along untouched, by construction (storeVerificationCode never
 * writes it).
 *
 *  3. A RE-ISSUE FAILURE IS `retryable`, NEVER `existing_account` (review
 *     FIX 2). Before this fix a store or mail fault fell through to the
 *     caller's `existing_account`, which routes to sign-in — impossible for a
 *     code-mode account that has never had a password set. Worse, on a MAIL
 *     failure the prior code had already been overwritten with one nobody
 *     received, so the family lost the code they had. The state is retryable
 *     and is reported as such; the prior attempt id goes on an ERROR line
 *     because the row stays `started` and therefore never appears in the
 *     `state='abandoned' AND parent_id IS NOT NULL` ops query.
 *
 *  4. A LIVE LINK ATTEMPT IS ITS OWN ANSWER (review FIX 4). No code attempt to
 *     resume plus a live firstprofit.school link attempt is `pending_elsewhere`,
 *     not `existing_account` — the family should check their inbox for the
 *     link, not attempt a sign-in that cannot succeed.
 *
 * ⚠ The attempt id this returns NEVER reaches an unauthenticated client. The
 * v3 core maps `started` onto a bare `code_sent`, and verify/resend re-derive
 * the attempt from the typed address (review FIX 1, design A). Returning it
 * here keeps ONE `started` shape across both modes; the link door's own
 * attemptId disclosure is a separate, already-audited decision.
 */
async function tryResumePendingCode(
  deps: SignupCoreDeps,
  input: StartSignupInput,
  email: string,
  currentAttemptId: string
): Promise<StartSignupResult | null> {
  const pending = await loadPendingCodeAttemptByEmail(deps.db, email, currentAttemptId);
  if (!pending.ok) return null;
  if (!pending.attempt) {
    // Nothing of ours to resume. Before dead-ending the family into a sign-in
    // they cannot pass, check the OTHER front door (review FIX 4).
    const link = await loadPendingRealAttemptByEmail(
      deps.db,
      email,
      new Date(deps.now()).toISOString(),
      currentAttemptId
    );
    if (link.ok && link.attempt) {
      await markAbandoned(deps.db, currentAttemptId);
      return { kind: "pending_elsewhere" };
    }
    return null;
  }
  const prior = pending.attempt;

  if (prior.codeGuessCount >= MAX_CODE_GUESSES) {
    await markAbandoned(deps.db, currentAttemptId);
    return { kind: "locked" };
  }

  const code = deps.mintCode();
  const nowMs = deps.now();
  const stored = await storeVerificationCode(deps.db, {
    attemptId: prior.id,
    codeHash: sha256Hex(code),
    expiresAtIso: new Date(nowMs + VERIFICATION_CODE_TTL_MS).toISOString(),
    nowIso: new Date(nowMs).toISOString(),
  });
  if (!stored) return resumeReissueFailed(deps, prior.id, currentAttemptId, "store-code");
  const sent = await sendCodeMail(deps, { email, parentName: input.parentName, code });
  if (!sent) return resumeReissueFailed(deps, prior.id, currentAttemptId, "send-code-mail");
  await markAbandoned(deps.db, currentAttemptId);
  return { kind: "started", attemptId: prior.id };
}

/**
 * The re-issue gave up (review FIX 2). The PRIOR attempt is left exactly as it
 * is — `started`, still owning its account — so a later retry can re-issue onto
 * it once the fault clears. Only the duplicate row this call inserted is
 * abandoned (it never acquired a parent_id, so it cannot pollute the stranded
 * marker). The ERROR line names the prior attempt because nothing else will:
 * the row is not `abandoned`, so the documented SQL marker query cannot see it.
 */
async function resumeReissueFailed(
  deps: SignupCoreDeps,
  priorAttemptId: string,
  currentAttemptId: string,
  stage: string
): Promise<StartSignupResult> {
  console.error(
    `[fp/signup] CODE RE-ISSUE FAILED at ${stage} for prior attempt ${priorAttemptId} — the family cannot sign in (no password was ever set) and must retry; the row stays state='started' and is INVISIBLE to the abandoned-marker query`
  );
  await markAbandoned(deps.db, currentAttemptId);
  return { kind: "retryable" };
}

/**
 * The 6-digit code mail. Wrapped by the auth-mail guard
 * (app/lib/auth-mail-guard.ts) in its VALUE form: the core's contract is a
 * typed verdict, never a throw, so a refused recipient is logged and reported
 * as a send failure (which compensates the account) rather than thrown through
 * the Server Action boundary. Parent addresses are outside the student mail
 * domain and pass; the guard is here so a future recipient change cannot put
 * auth mail into a child's inbox without tripping it.
 */
async function sendCodeMail(
  deps: SignupCoreDeps,
  input: { email: string; parentName: string; code: string }
): Promise<boolean> {
  const guard = authMailVerdict(input.email);
  if (!guard.allowed) {
    console.error(`[fp/signup] refusing v3 code mail — ${guard.reason}`);
    return false;
  }
  const mail = buildCodeEmail({
    parentName: input.parentName,
    code: input.code,
    ttlMinutes: Math.round(VERIFICATION_CODE_TTL_MS / 60_000),
  });
  const sent = await deps.sendMail({
    to: input.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  if (!sent.ok) {
    console.error(`[fp/signup] v3 code send failed: ${sent.error ?? "unknown"}`);
    return false;
  }
  return true;
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

/**
 * Mark an attempt abandoned. EXPORTED since v3 Unit 2 for the edit-email path,
 * which abandons the in-flight attempt before starting a fresh one — the same
 * terminal state every other give-up path here writes, so there is exactly one
 * vocabulary for "this attempt is over".
 *
 * ⚠ The stranded-account marker convention rides on this state: an `abandoned`
 * row that STILL carries `parent_id` means a compensation `deleteUser` failed
 * and a real auth account is stranded (the FK is on-delete-set-null, so a
 * successful delete nulls it). Any caller that abandons an attempt whose
 * account it is NOT also deleting would manufacture false positives in that ops
 * query — which is why v3's edit-email compensates the account first.
 */
export async function markAttemptAbandoned(
  db: SupabaseClient,
  attemptId: string
): Promise<{ ok: boolean }> {
  return markAbandoned(db, attemptId);
}

/**
 * ── IT IS A CAS, AND IT REPORTS (review FIX 1 + FIX 6) ──
 *
 * `WHERE state='started' AND verified_at IS NULL` makes a RACING VERIFY WIN
 * DETERMINISTICALLY: an abandon that arrives after the redeem CAS stamped
 * `verified_at` matches zero rows and leaves the row alone, so the corrupt
 * combination (`verified_at` set on a row marked `abandoned`) is unreachable
 * rather than merely unlikely. The loser is not an error — it is the designed
 * outcome — so it is classified by re-reading rather than logged as a fault.
 *
 * And it returns `{ok:false}` on a genuine write failure rather than swallowing
 * it: the row then stays `started`, INVISIBLE to the documented
 * `state='abandoned' AND parent_id IS NOT NULL` marker query while still
 * holding a real account. That is the same class of silent orphan as a failed
 * `deleteUser`, so it is logged at the same STRANDED severity — one grep finds
 * both.
 */
async function markAbandoned(
  db: SupabaseClient,
  attemptId: string
): Promise<{ ok: boolean }> {
  const res = await db
    .from("fp_signup_attempts")
    .update({ state: "abandoned", updated_at: new Date().toISOString() })
    .eq("id", attemptId)
    .eq("state", "started")
    .is("verified_at", null)
    .select("id");
  if (res.error) {
    console.error(
      `[fp/signup] STRANDED ATTEMPT ${attemptId}: mark-abandoned failed (${res.error.message}) — the row stays state='started' and does NOT match the abandoned-marker query; needs manual cleanup`
    );
    return { ok: false };
  }
  if ((((res.data as unknown[] | null) ?? []).length) > 0) return { ok: true };

  // Zero rows: either a racing verify won (correct, nothing to do) or the row
  // is gone/already terminal. Classify so only the genuinely surprising case
  // reaches the STRANDED vocabulary.
  const found = await db
    .from("fp_signup_attempts")
    .select("id, state, verified_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (found.error) {
    console.error(
      `[fp/signup] STRANDED ATTEMPT ${attemptId}: mark-abandoned matched no row and the classify read failed (${found.error.message})`
    );
    return { ok: false };
  }
  const row = found.data as { state?: unknown; verified_at?: unknown } | null;
  if (row && (row.verified_at != null || row.state === "verified")) {
    // A verify beat us to it. The attempt is NOT abandoned, and must not be.
    return { ok: true };
  }
  if (row && row.state === "abandoned") return { ok: true }; // already terminal
  console.error(
    `[fp/signup] STRANDED ATTEMPT ${attemptId}: mark-abandoned matched no row (state=${String(row?.state ?? "missing")}) — needs manual cleanup`
  );
  return { ok: false };
}
