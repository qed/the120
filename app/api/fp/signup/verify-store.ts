/**
 * The First Profit signup email-verification token store (Slice B Unit 2; R11).
 * A plain injected-db core — NO "use server", NO `server-only`: callers hand in
 * the service-role client, and tests hand in a from()-only fake, exactly like
 * ../login/profile-core.ts (which takes a `SupabaseClient` and lets tests cast
 * a chainable fake).
 *
 * This is the NEW, non-session-minting redeem the plan calls for (Rev 12):
 * it reuses the funnel token DISCIPLINE (256-bit random token minted by the
 * caller, only its sha256 hex stored at rest, single-use via a redeem-CAS, TTL)
 * but — unlike funnel_resume_tokens' redeem — it ONLY verifies inbox control by
 * stamping `verified_at`. It NEVER mints a Supabase session and never routes:
 * the parent session is obtained separately, cross-origin, in signup-core's
 * verify-completion (tokens-in-JSON, Rev 1).
 *
 * The token lives ON the fp_signup_attempts row (verification_token_hash,
 * verification_expires_at, verified_at) rather than in its own table — Unit 1's
 * schema anchors the whole multi-step signup on that single row.
 *
 * ── TWO MODES, TWO COLUMN SETS (New User Flow v3, Unit 2) ──
 * This module now serves BOTH live front doors, and they share NOTHING but the
 * row and the sha256 helper:
 *   - LINK mode (firstprofit.school HTTP signup) — 256-bit token in
 *     `verification_token_hash` / `verification_expires_at`, 60-minute TTL,
 *     GLOBAL-BY-HASH redeem CAS. Everything above this line. UNTOUCHED by v3.
 *   - CODE mode (the120.school /start v3) — typed 6-digit code in
 *     `verification_code_hash` / `code_expires_at` / `code_guess_count`,
 *     10-minute TTL, ATTEMPT-SCOPED redeem CAS. Everything below the CODE MODE
 *     banner near the bottom of this file.
 * The column split is the whole point: a family who starts at one front door
 * and then the other with the SAME EMAIL cannot have the second start clobber
 * the first's pending secret. See the migration header of
 * 20260914120000_fp_v3_verify_code_and_photo_consent.sql, which is the
 * authority on why these columns are dedicated and why the code's CAS must be
 * attempt-scoped.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** sha256 hex — a DB read of the stored hash is never a usable token (R11). */
export const sha256Hex = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

/** 60-minute inbox-verification window, matching the funnel resume-token TTL. */
export const VERIFICATION_TTL_MS = 60 * 60_000;

export type StoredAttempt = {
  id: string;
  parentEmail: string;
  parentId: string | null;
  isTest: boolean;
  verifiedAt: string | null;
  expiresAt: string | null;
};

/**
 * Stamp the (already-created) attempt row with the verification token hash and
 * expiry. Update, not insert: the attempt row already exists (signup-core
 * created it first). Returns false on any DB error so the caller can compensate.
 */
export async function storeVerification(
  db: SupabaseClient,
  input: { attemptId: string; tokenHash: string; expiresAtIso: string }
): Promise<boolean> {
  const res = await db
    .from("fp_signup_attempts")
    .update({
      verification_token_hash: input.tokenHash,
      verification_expires_at: input.expiresAtIso,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.attemptId);
  if (res.error) {
    console.error(`[fp/signup] verification store failed: ${res.error.message}`);
    return false;
  }
  return true;
}

export type RedeemStatus = "verified" | "already" | "expired" | "invalid" | "error";

/**
 * Single-use redeem CAS: stamp `verified_at = now` and `state = 'verified'`
 * WHERE the token hash matches, `verified_at IS NULL`, and the expiry is still
 * in the future. Cardinality decides the winner — a double-submit's loser
 * affects zero rows. On zero rows we re-read to classify (already-verified vs
 * expired vs unknown) for the CALLER'S control flow; the WIRE stays constant
 * regardless (the route maps everything but success onto one refusal).
 *
 * This is the server-side confirm reused BOTH for a real click (signup-core
 * verify-completion) AND for the is_test auto-confirm (signup-core start,
 * restricted to is_test rows) — one CAS, never a general bypass.
 */
export async function redeemVerification(
  db: SupabaseClient,
  input: { tokenHash: string; nowIso: string }
): Promise<{ status: RedeemStatus; attempt: StoredAttempt | null }> {
  const casted = await db
    .from("fp_signup_attempts")
    .update({ verified_at: input.nowIso, state: "verified", updated_at: input.nowIso })
    .eq("verification_token_hash", input.tokenHash)
    .is("verified_at", null)
    .gt("verification_expires_at", input.nowIso)
    .select("id, parent_email, parent_id, is_test, verified_at, verification_expires_at");
  if (casted.error) {
    console.error(`[fp/signup] verification redeem CAS failed: ${casted.error.message}`);
    return { status: "error", attempt: null };
  }
  const rows = (casted.data as unknown[] | null) ?? [];
  if (rows.length > 0) {
    return { status: "verified", attempt: toAttempt(rows[0]) };
  }
  // Zero rows: classify by re-reading the row for the caller's benefit only.
  const found = await loadAttemptByTokenHash(db, input.tokenHash);
  if (!found.ok) return { status: "error", attempt: null };
  if (!found.attempt) return { status: "invalid", attempt: null };
  if (found.attempt.verifiedAt) return { status: "already", attempt: found.attempt };
  // token matched, not yet verified, but the CAS still touched nothing → expired.
  return { status: "expired", attempt: found.attempt };
}

/** Read an attempt by its token hash (classification + email-match checks). */
export async function loadAttemptByTokenHash(
  db: SupabaseClient,
  tokenHash: string
): Promise<{ ok: true; attempt: StoredAttempt | null } | { ok: false }> {
  const res = await db
    .from("fp_signup_attempts")
    .select("id, parent_email, parent_id, is_test, verified_at, verification_expires_at")
    .eq("verification_token_hash", tokenHash)
    .maybeSingle();
  if (res.error) {
    console.error(`[fp/signup] attempt load by token failed: ${res.error.message}`);
    return { ok: false };
  }
  return { ok: true, attempt: res.data ? toAttempt(res.data) : null };
}

/**
 * Read the most-recent VERIFIED is_test attempt for an email — the tokenless
 * verify-completion path. `@test.the120.invalid` addresses can't receive the
 * verification mail, so an is_test attempt is auto-confirmed server-side at
 * start; the test SPA (which never sees the raw token) completes with
 * email+password only, and this read is what authorizes that — strictly gated
 * on `is_test = true` AND `verified_at` already set.
 */
export async function loadVerifiedTestAttemptByEmail(
  db: SupabaseClient,
  email: string
): Promise<{ ok: true; attempt: StoredAttempt | null } | { ok: false }> {
  const res = await db
    .from("fp_signup_attempts")
    .select("id, parent_email, parent_id, is_test, verified_at, verification_expires_at")
    .eq("parent_email", email.trim().toLowerCase())
    .eq("is_test", true)
    .not("verified_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) {
    console.error(`[fp/signup] verified test-attempt load failed: ${res.error.message}`);
    return { ok: false };
  }
  return { ok: true, attempt: res.data ? toAttempt(res.data) : null };
}

/**
 * Read the most-recent PENDING REAL attempt for an email — the lost-response
 * resume path. When provisionOrRecognizeAccount reports `existing_account` but a
 * prior in-flight attempt for this email is still live (state 'started', a token
 * minted, unexpired, unverified), the retry is almost certainly the SAME family
 * whose first START succeeded but whose response was lost — not a returning
 * parent. `excludeId` skips the just-inserted duplicate row of the current call.
 */
export async function loadPendingRealAttemptByEmail(
  db: SupabaseClient,
  email: string,
  nowIso: string,
  excludeId: string
): Promise<{ ok: true; attempt: StoredAttempt | null } | { ok: false }> {
  const res = await db
    .from("fp_signup_attempts")
    .select("id, parent_email, parent_id, is_test, verified_at, verification_expires_at")
    .eq("parent_email", email.trim().toLowerCase())
    .eq("state", "started")
    .is("verified_at", null)
    .not("verification_token_hash", "is", null)
    .gt("verification_expires_at", nowIso)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) {
    console.error(`[fp/signup] pending-attempt load failed: ${res.error.message}`);
    return { ok: false };
  }
  return { ok: true, attempt: res.data ? toAttempt(res.data) : null };
}

function toAttempt(row: unknown): StoredAttempt {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    parentEmail: String(r.parent_email ?? ""),
    parentId: r.parent_id ? String(r.parent_id) : null,
    isTest: r.is_test === true,
    verifiedAt: r.verified_at ? String(r.verified_at) : null,
    expiresAt: r.verification_expires_at ? String(r.verification_expires_at) : null,
  };
}

/* ==========================================================================
 * CODE MODE — the typed 6-digit inline verification (v3 /start, Unit 2)
 * ==========================================================================
 * Everything below writes ONLY `verification_code_hash`, `code_expires_at` and
 * `code_guess_count`. No function below reads or writes a link-token column,
 * and no function above reads or writes a code column. That separation is the
 * cross-mode safety property, and the cross-path test in
 * __tests__/verify-store-code.test.ts is what holds it.
 */

/** 10-minute typed-code window. Deliberately much shorter than the link's 60:
 *  the code is typed from an open inbox in the same sitting, and the TTL is one
 *  of only two real controls at 10^6 entropy (the other is MAX_CODE_GUESSES). */
export const VERIFICATION_CODE_TTL_MS = 10 * 60_000;

/**
 * THE LOAD-BEARING GUESS CAP. Wrong guesses are counted DURABLY on the attempt
 * row, and the (MAX_CODE_GUESSES)th wrong guess locks the attempt: once
 * `code_guess_count >= MAX_CODE_GUESSES` the redeem CAS can never match again.
 *
 * Six, not six-hundred: a 6-digit code is 10^6 of entropy, so the expected
 * number of guesses to hit one is ~500,000 and a cap of 6 leaves an attacker a
 * 6-in-a-million chance per attempt row — while a family who mistypes has five
 * corrections. The cap lives on the ROW rather than in the in-memory rate
 * limiter (app/lib/fp/rate-limit-store.ts) because that store is per-instance
 * and empty on cold start: it is a volumetric backstop and CANNOT be the
 * security control here.
 *
 * A RESEND rotates the code (voiding the prior one) but deliberately does NOT
 * reset this counter — otherwise "resend" is an unlimited-guesses button. The
 * consequence is deliberate and sharp: an attempt that reaches the cap is
 * TERMINAL for that email until the attempt row is abandoned, and the start
 * path reports `locked` rather than mailing a code that can never be redeemed.
 */
export const MAX_CODE_GUESSES = 6;

/** Minimum spacing between resends on one attempt. Enforced by the rotate CAS
 *  itself (not a read-then-write), so two concurrent resends yield one code. */
export const CODE_RESEND_COOLDOWN_MS = 60_000;

/** Bounded retries for the read-modify-write guess counter (see bumpCodeGuessCount). */
export const CODE_GUESS_CAS_RETRIES = 5;

/** The code-mode projection. Kept SEPARATE from the link-mode select lists so
 *  adding a column here can never perturb the link path's shapes. */
const CODE_ATTEMPT_COLUMNS =
  "id, parent_email, parent_id, is_test, state, verified_at, verification_code_hash, code_expires_at, code_guess_count";

export type StoredCodeAttempt = {
  id: string;
  parentEmail: string;
  parentId: string | null;
  isTest: boolean;
  state: string | null;
  verifiedAt: string | null;
  codeHash: string | null;
  codeExpiresAt: string | null;
  codeGuessCount: number;
};

function toCodeAttempt(row: unknown): StoredCodeAttempt {
  const r = row as Record<string, unknown>;
  const rawCount = r.code_guess_count;
  return {
    id: String(r.id),
    parentEmail: String(r.parent_email ?? ""),
    parentId: r.parent_id ? String(r.parent_id) : null,
    isTest: r.is_test === true,
    state: r.state ? String(r.state) : null,
    verifiedAt: r.verified_at ? String(r.verified_at) : null,
    codeHash: r.verification_code_hash ? String(r.verification_code_hash) : null,
    codeExpiresAt: r.code_expires_at ? String(r.code_expires_at) : null,
    // A missing/garbled counter must read as "already at the cap", never as 0:
    // an unreadable counter that defaults to zero is an unlimited-guesses bug.
    codeGuessCount: typeof rawCount === "number" ? rawCount : Number.isFinite(Number(rawCount)) ? Number(rawCount) : MAX_CODE_GUESSES,
  };
}

/**
 * Stamp a freshly minted code hash + expiry on an attempt row. Used at START
 * (first code) and by the re-issue path in signup-core's tryResumePending.
 *
 * NOTE what it does NOT write: `code_guess_count`. A new code voids the prior
 * code; it does not forgive prior wrong guesses (MAX_CODE_GUESSES' docblock).
 */
export async function storeVerificationCode(
  db: SupabaseClient,
  input: { attemptId: string; codeHash: string; expiresAtIso: string; nowIso: string }
): Promise<boolean> {
  const res = await db
    .from("fp_signup_attempts")
    .update({
      verification_code_hash: input.codeHash,
      code_expires_at: input.expiresAtIso,
      updated_at: input.nowIso,
    })
    .eq("id", input.attemptId);
  if (res.error) {
    console.error(`[fp/signup] code store failed: ${res.error.message}`);
    return false;
  }
  return true;
}

export type RotateCodeStatus = "rotated" | "cooldown" | "locked" | "unavailable" | "error";

/**
 * RESEND, as one conditional UPDATE. The cooldown is part of the CAS predicate
 * rather than a read-then-write, so two resend clicks that race produce exactly
 * one new code (the loser affects zero rows and is told `cooldown`).
 *
 * `cooldownBeforeIso` is `now + TTL - COOLDOWN`: because we store the EXPIRY
 * (mintedAt + TTL), "the current code was minted at least COOLDOWN ago" is
 * exactly `code_expires_at < now + TTL - COOLDOWN`. The caller computes it so
 * this module never reads a clock.
 *
 * The `code_guess_count < MAX_CODE_GUESSES` arm is what makes "resend does not
 * unlock" a WRITE guarantee rather than a caller convention.
 */
export async function rotateVerificationCode(
  db: SupabaseClient,
  input: {
    attemptId: string;
    codeHash: string;
    expiresAtIso: string;
    cooldownBeforeIso: string;
    nowIso: string;
  }
): Promise<RotateCodeStatus> {
  const casted = await db
    .from("fp_signup_attempts")
    .update({
      verification_code_hash: input.codeHash,
      code_expires_at: input.expiresAtIso,
      updated_at: input.nowIso,
    })
    .eq("id", input.attemptId)
    .eq("state", "started")
    .is("verified_at", null)
    .lt("code_expires_at", input.cooldownBeforeIso)
    .lt("code_guess_count", MAX_CODE_GUESSES)
    .select("id");
  if (casted.error) {
    console.error(`[fp/signup] code rotate CAS failed: ${casted.error.message}`);
    return "error";
  }
  if ((((casted.data as unknown[] | null) ?? []).length) > 0) return "rotated";

  // Zero rows: classify for the CALLER's copy only — the wire stays uniform.
  const found = await loadCodeAttemptById(db, input.attemptId);
  if (!found.ok) return "error";
  const attempt = found.attempt;
  if (!attempt || attempt.state !== "started" || attempt.verifiedAt) return "unavailable";
  if (attempt.codeGuessCount >= MAX_CODE_GUESSES) return "locked";
  return "cooldown";
}

export type CodeRedeemStatus = "verified" | "already" | "expired" | "locked" | "invalid" | "error";

/**
 * THE ATTEMPT-SCOPED REDEEM CAS — the single most important statement in this
 * unit:
 *
 *   update fp_signup_attempts
 *      set verified_at = :now, state = 'verified'
 *    where id = :attemptId
 *      and verification_code_hash = :codeHash
 *      and verified_at is null
 *      and code_expires_at > :now
 *      and code_guess_count < MAX_CODE_GUESSES
 *   returning <CODE_ATTEMPT_COLUMNS>
 *
 * `id = :attemptId` is NOT optional and NOT a nicety. The link token's redeem
 * is a GLOBAL lookup by hash, which is safe only because a 256-bit token's hash
 * is globally unique in practice. A 6-digit code has 10^6 of entropy and the
 * hash is deterministic and unsalted, so two live attempts holding the SAME
 * code — and therefore the same hash — is an ordinary event at a few hundred
 * concurrent signups. A global-hash CAS would then verify ANOTHER FAMILY's
 * attempt with a code this caller legitimately received. Scoping to the
 * caller's own attempt id makes such a collision completely harmless: each
 * caller can only ever stamp their own row.
 *
 * The guess-count arm makes the lockout a WRITE guarantee too: once the counter
 * reaches the cap, no code — not even the right one — can satisfy this CAS.
 *
 * Zero-row classification is deliberately CONSERVATIVE about `already`. Unlike
 * link mode, the classification read here is keyed on an attempt id, which is
 * an opaque handle the caller already holds, NOT a secret. So a prior-verified
 * attempt is only reported `already` (which authorizes the caller to set the
 * password) when the caller ALSO presents the matching code hash — or when the
 * attempt is `is_test`, the guarded `@test.the120.invalid` cohort whose
 * undeliverable inbox is auto-confirmed at start and which therefore never has
 * a code to type. Anything else is `invalid`, i.e. a wrong guess.
 */
export async function redeemVerificationCode(
  db: SupabaseClient,
  input: { attemptId: string; codeHash: string; nowIso: string }
): Promise<{ status: CodeRedeemStatus; attempt: StoredCodeAttempt | null }> {
  const casted = await db
    .from("fp_signup_attempts")
    .update({ verified_at: input.nowIso, state: "verified", updated_at: input.nowIso })
    .eq("id", input.attemptId)
    .eq("verification_code_hash", input.codeHash)
    .is("verified_at", null)
    .gt("code_expires_at", input.nowIso)
    .lt("code_guess_count", MAX_CODE_GUESSES)
    .select(CODE_ATTEMPT_COLUMNS);
  if (casted.error) {
    console.error(`[fp/signup] code redeem CAS failed: ${casted.error.message}`);
    return { status: "error", attempt: null };
  }
  const rows = (casted.data as unknown[] | null) ?? [];
  if (rows.length > 0) return { status: "verified", attempt: toCodeAttempt(rows[0]) };

  const found = await loadCodeAttemptById(db, input.attemptId);
  if (!found.ok) return { status: "error", attempt: null };
  const attempt = found.attempt;
  if (!attempt) return { status: "invalid", attempt: null };
  if (attempt.codeGuessCount >= MAX_CODE_GUESSES) return { status: "locked", attempt };
  if (attempt.verifiedAt) {
    // See the docblock: `already` authorizes, so it must cost the caller the
    // code (or be the auto-confirmed test cohort), never just an attempt id.
    if (attempt.isTest || (attempt.codeHash !== null && attempt.codeHash === input.codeHash)) {
      return { status: "already", attempt };
    }
    return { status: "invalid", attempt };
  }
  if (attempt.codeHash === input.codeHash) {
    // Right code, unverified, CAS still empty → the window closed.
    return { status: "expired", attempt };
  }
  return { status: "invalid", attempt };
}

export type BumpGuessResult =
  | { ok: true; count: number }
  /**
   * `exhausted` — the retry budget ran out under CONCURRENCY. `error` — a DB
   * fault. The distinction is load-bearing at the action layer (review FIX 3):
   * only `error` is an infra failure whose rate-limit strike may be released.
   */
  | { ok: false; reason: "exhausted" | "error"; count: number };

/**
 * Durably count one wrong guess. PostgREST cannot express
 * `set code_guess_count = code_guess_count + 1`, so the increment is itself a
 * CAS on the OBSERVED value (`where id = :id and code_guess_count = :seen`) and
 * a losing writer simply re-reads and tries again. That keeps the counter
 * monotonic under concurrency, which a blind `update ... set count = seen + 1`
 * would not: two simultaneous wrong guesses would both write `seen + 1` and one
 * guess would be free.
 *
 * ── EXHAUSTION FAILS CLOSED (review FIX 3) ──
 * The ONLY thing that exhausts a 5-deep CAS retry on one row is sustained
 * concurrent writing to that row — i.e. exactly the attacker this counter
 * exists to stop. Returning "we could not count it" and letting the caller
 * answer with a generic failure made those guesses free of BOTH controls (the
 * durable counter never moved, and the action released the volumetric strike).
 * So exhaustion now LOCKS the attempt with an unconditional write: it is the
 * one write that cannot itself lose a CAS race, it is monotonic (the column
 * only ever moves up to the cap), and a family who somehow reaches it is
 * recoverable through a fresh signup for the same address — while an attacker
 * gets the terminal state instead of an unbounded budget.
 */
export async function bumpCodeGuessCount(
  db: SupabaseClient,
  input: { attemptId: string; nowIso: string }
): Promise<BumpGuessResult> {
  for (let i = 0; i < CODE_GUESS_CAS_RETRIES; i++) {
    const found = await loadCodeAttemptById(db, input.attemptId);
    if (!found.ok) return { ok: false, reason: "error", count: MAX_CODE_GUESSES };
    if (!found.attempt) return { ok: false, reason: "error", count: MAX_CODE_GUESSES };
    const seen = found.attempt.codeGuessCount;
    if (seen >= MAX_CODE_GUESSES) return { ok: true, count: seen };
    const next = seen + 1;
    const casted = await db
      .from("fp_signup_attempts")
      .update({ code_guess_count: next, updated_at: input.nowIso })
      .eq("id", input.attemptId)
      .eq("code_guess_count", seen)
      .select("id");
    if (casted.error) {
      console.error(`[fp/signup] guess-count CAS failed: ${casted.error.message}`);
      return { ok: false, reason: "error", count: MAX_CODE_GUESSES };
    }
    if ((((casted.data as unknown[] | null) ?? []).length) > 0) return { ok: true, count: next };
  }
  console.error(
    `[fp/signup] guess-count CAS exhausted for attempt ${input.attemptId} — LOCKING the attempt (concurrent guessing)`
  );
  const locked = await db
    .from("fp_signup_attempts")
    .update({ code_guess_count: MAX_CODE_GUESSES, updated_at: input.nowIso })
    .eq("id", input.attemptId);
  if (locked.error) {
    console.error(`[fp/signup] lock-on-exhaustion write failed: ${locked.error.message}`);
  }
  return { ok: false, reason: "exhausted", count: MAX_CODE_GUESSES };
}

/** Read one attempt through the code-mode projection (classification + the
 *  re-issue path's freshness checks). */
export async function loadCodeAttemptById(
  db: SupabaseClient,
  attemptId: string
): Promise<{ ok: true; attempt: StoredCodeAttempt | null } | { ok: false }> {
  const res = await db
    .from("fp_signup_attempts")
    .select(CODE_ATTEMPT_COLUMNS)
    .eq("id", attemptId)
    .maybeSingle();
  if (res.error) {
    console.error(`[fp/signup] code attempt load failed: ${res.error.message}`);
    return { ok: false };
  }
  return { ok: true, attempt: res.data ? toCodeAttempt(res.data) : null };
}

/**
 * The CODE-MODE resume read (signup-core's tryResumePending). Two jobs in one
 * query, and the filters are the mode dispatch:
 *
 *  - `verification_code_hash IS NOT NULL` selects CODE attempts only, so a live
 *    firstprofit.school LINK attempt for the same email is invisible here and
 *    its pending secret is never rotated. (The link-mode sibling filters on
 *    `verification_token_hash IS NOT NULL` symmetrically, so neither mode can
 *    see the other's rows.)
 *  - There is deliberately NO expiry filter, unlike the link-mode sibling. A
 *    parent who comes back the next day with the same email must get a FRESH
 *    code on this same attempt rather than dead-ending in `existing_account`
 *    (the account already exists — we made it — so there is nothing to sign in
 *    to yet). The caller re-issues; the durable guess counter rides along
 *    untouched.
 */
export async function loadPendingCodeAttemptByEmail(
  db: SupabaseClient,
  email: string,
  /** The just-inserted duplicate row of a start call, or `null` when the caller
   *  (resend) inserted nothing and wants the live attempt as-is. */
  excludeId: string | null
): Promise<{ ok: true; attempt: StoredCodeAttempt | null } | { ok: false }> {
  let q = db
    .from("fp_signup_attempts")
    .select(CODE_ATTEMPT_COLUMNS)
    .eq("parent_email", email.trim().toLowerCase())
    .eq("state", "started")
    .is("verified_at", null)
    .not("verification_code_hash", "is", null);
  if (excludeId !== null) q = q.neq("id", excludeId);
  const res = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (res.error) {
    console.error(`[fp/signup] pending code-attempt load failed: ${res.error.message}`);
    return { ok: false };
  }
  return { ok: true, attempt: res.data ? toCodeAttempt(res.data) : null };
}

/**
 * THE VERIFY-SIDE RESOLVER, KEYED ON THE EMAIL — not on a client-held id
 * (review FIX 1, design A).
 *
 * v3's verify/resend used to take an `attemptId` the START action handed back.
 * That id was a BEARER CREDENTIAL in everything but name: the resume path
 * returned ANOTHER family's attempt id to anyone who submitted that family's
 * address, and the edit-email guard authorized a destructive `deleteUser` on
 * possession of it alone. The fix is structural — no attempt id ever reaches
 * the client, so there is nothing to steal or replay. The server re-derives the
 * attempt from the address the caller typed, and the CODE remains the only
 * secret in the exchange.
 *
 * Wider than the resume read on purpose: this must also find the attempt a
 * PRIOR verify already stamped `verified`, because re-submitting the same code
 * after a post-redeem failure is the documented recovery path (review FIX 5),
 * and the auto-confirmed `is_test` cohort is `verified` from the moment start
 * returns. `redeemVerificationCode` — not this read — decides what that means:
 * `already` is granted only to a caller who also presents the matching code
 * hash (or to the guarded test cohort). Abandoned rows are excluded so a
 * mistyped-address leftover can never shadow a live attempt.
 */
export async function loadCodeAttemptForVerifyByEmail(
  db: SupabaseClient,
  email: string
): Promise<{ ok: true; attempt: StoredCodeAttempt | null } | { ok: false }> {
  const res = await db
    .from("fp_signup_attempts")
    .select(CODE_ATTEMPT_COLUMNS)
    .eq("parent_email", email.trim().toLowerCase())
    .not("verification_code_hash", "is", null)
    .neq("state", "abandoned")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) {
    console.error(`[fp/signup] verify code-attempt load failed: ${res.error.message}`);
    return { ok: false };
  }
  return { ok: true, attempt: res.data ? toCodeAttempt(res.data) : null };
}
