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
