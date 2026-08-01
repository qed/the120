/**
 * First Profit verifiable-parental-consent core (Slice B Unit 3; R15). House
 * core-module pattern: NO "use server", NO `server-only` — the route hands in a
 * service-role `db`; tests hand in a from()-only fake, exactly like
 * ./verify-store.ts and ../login/profile-core.ts. The SPA never reads
 * fp_parental_consent through PostgREST (it is service-role-only, RLS zero
 * policies); every verdict returns to the SPA in JSON.
 *
 * Two entry points:
 *   - recordConsent  — the attest step: refuse-stale (bind to rendered) +
 *                      re-check session freshness (the caller must still be the
 *                      just-verified parent) + write the bound consent row.
 *   - consentGate    — the mint-time verdict Units 4/5 call before creating the
 *                      child: is there an ACTIVE consent bound to THIS attempt,
 *                      not stale, not already bound to a different child?
 *
 * ── bind-to-rendered (echo + refuse stale) ──
 * recordConsent recomputes the verdict from the version+hash the client echoed
 * and REFUSES anything but `ok`. A stale bundle (old version), a tampered text
 * (hash mismatch), or a bare boolean (nothing echoed) never becomes a consent
 * record. The row then snapshots the SERVER's current version/hash/text — never
 * the echoed strings — so the stored evidence is exactly what we render.
 *
 * ── session freshness (still the just-verified parent) ──
 * A consent is only meaningful if the caller is the parent who just proved inbox
 * control. recordConsent re-reads the attempt and refuses unless its state is
 * 'verified' AND its parent_id matches the caller's parentId — a replayed or
 * cross-account attest cannot record consent against someone else's attempt.
 *
 * ── the (parent_id, signup_attempt_id) binding + the DB invariant ──
 * The row is written bound to (parent_id, signup_attempt_id). At most ONE active
 * consent per attempt is a DB invariant (a partial unique index on
 * signup_attempt_id where revoked_at is null — the hardening migration), not an
 * app assumption: a duplicate active-consent insert fails with 23505, which we
 * classify as `duplicate` rather than papering over. consentGate then reads the
 * single active row with confidence there can never be an ambiguous pair.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { policyVersionAtLeast } from "@/app/lib/funnel/deposit-rules";
import {
  consentVerdict,
  currentPolicyHash,
  FP_CONSENT_MIN_VERSION,
  FP_CONSENT_POLICY,
  type ConsentMethod,
} from "./consent-rules";
import type { ChildAgeBand } from "./signup-rules";

/* ------------------------------------------------------------------- record */

export type RecordConsentInput = {
  attemptId: string;
  /** The caller's just-verified parent user id (freshness is re-checked). */
  parentId: string;
  /** What the client's bundle rendered — the bind-to-rendered proof. */
  echoedVersion: string;
  echoedHash: string;
  method: ConsentMethod;
  childAgeBand: ChildAgeBand;
  /** ISO YYYY-MM-DD, optional. */
  childDob?: string | null;
  jurisdiction: string;
  /** Name/email snapshot of the verified parent at consent time (jsonb). */
  parentIdentity: Record<string, unknown>;
  ip: string;
  ua: string;
};

export type RecordConsentResult =
  | { ok: true; consentId: string }
  // The bind-to-rendered refusals reuse the verdict names verbatim; the rest are
  // freshness / write outcomes. The WIRE maps every non-ok onto one refusal.
  | {
      ok: false;
      reason: "missing" | "stale" | "version_mismatch" | "not_verified" | "parent_mismatch" | "duplicate" | "outage";
    };

export async function recordConsent(
  db: SupabaseClient,
  input: RecordConsentInput
): Promise<RecordConsentResult> {
  // 1. Bind to what the client rendered: refuse a stale/tampered/bare echo.
  const verdict = consentVerdict({ echoedVersion: input.echoedVersion, echoedHash: input.echoedHash });
  if (verdict !== "ok") return { ok: false, reason: verdict };

  // 2. Session freshness: the caller must still be the just-verified parent of
  //    THIS attempt. Re-read the attempt rather than trusting the request.
  const attempt = await db
    .from("fp_signup_attempts")
    .select("id, parent_id, state")
    .eq("id", input.attemptId)
    .maybeSingle();
  if (attempt.error) {
    console.error(`[fp/consent] attempt freshness read failed: ${attempt.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const row = attempt.data as { parent_id: string | null; state: string | null } | null;
  if (!row || row.state !== "verified") return { ok: false, reason: "not_verified" };
  if (!row.parent_id || row.parent_id !== input.parentId) return { ok: false, reason: "parent_mismatch" };

  // 3. Write the consent row bound to (parent_id, signup_attempt_id), snapshotting
  //    the SERVER's current version/hash/text (never the echoed strings). The
  //    partial unique index makes "one active consent per attempt" a DB invariant.
  const inserted = await db
    .from("fp_parental_consent")
    .insert({
      signup_attempt_id: input.attemptId,
      parent_id: input.parentId,
      policy_namespace: "fp_parental_consent",
      policy_version: FP_CONSENT_POLICY.version,
      policy_hash: currentPolicyHash(),
      rendered_text: FP_CONSENT_POLICY.text,
      method: input.method,
      child_age_band: input.childAgeBand,
      child_dob: input.childDob ?? null,
      jurisdiction: input.jurisdiction,
      parent_identity: input.parentIdentity,
      ip: input.ip,
      ua: input.ua,
      // Extensible legal-evidence blob: the echo proof rides along so a later
      // audit can see exactly what the client claimed to render.
      evidence: {
        echoed_version: input.echoedVersion,
        echoed_hash: input.echoedHash,
        verdict,
      },
    })
    .select("id")
    .single();

  if (inserted.error) {
    // 23505 = the partial unique index tripped: an active consent already exists
    // for this attempt (a duplicate submit). Not an outage — the invariant held.
    if ((inserted.error as { code?: string }).code === "23505") {
      return { ok: false, reason: "duplicate" };
    }
    console.error(`[fp/consent] consent insert failed: ${inserted.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const consentId = String((inserted.data as { id: unknown }).id);
  return { ok: true, consentId };
}

/* --------------------------------------------------------------------- gate */

export type ConsentGateInput = {
  attemptId: string;
  /** The child about to be minted. If an active consent is already bound to a
   *  DIFFERENT child, refuse (anti-mis-attachment). */
  childId: string;
};

export type ConsentGateResult =
  | { ok: true; consentId: string }
  | { ok: false; reason: "missing" | "stale" | "child_mismatch" | "outage" };

/**
 * The mint-time gate Units 4/5 call before creating the child. Find the single
 * ACTIVE (revoked_at null) consent bound to this attempt — the partial unique
 * index guarantees at most one — and confirm it is usable:
 *   - none found                     → `missing` (no consent, no child)
 *   - already bound to another child → `child_mismatch`
 *   - version below the min anchor   → `stale`
 *   - otherwise                       → ok (returns the consent id to bind).
 */
export async function consentGate(
  db: SupabaseClient,
  input: ConsentGateInput
): Promise<ConsentGateResult> {
  const found = await db
    .from("fp_parental_consent")
    .select("id, signup_attempt_id, child_id, policy_version, revoked_at")
    .eq("signup_attempt_id", input.attemptId)
    .is("revoked_at", null)
    .maybeSingle();
  if (found.error) {
    console.error(`[fp/consent] gate read failed: ${found.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const row = found.data as
    | { id: unknown; child_id: string | null; policy_version: string | null }
    | null;
  if (!row) return { ok: false, reason: "missing" };
  if (row.child_id && row.child_id !== input.childId) {
    return { ok: false, reason: "child_mismatch" };
  }
  if (!policyVersionAtLeast(row.policy_version, FP_CONSENT_MIN_VERSION)) {
    return { ok: false, reason: "stale" };
  }
  return { ok: true, consentId: String(row.id) };
}
