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
 *                      child: ATOMICALLY CLAIM the active consent for THIS
 *                      attempt on THIS child, and refuse otherwise.
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
 * cross-account attest cannot record consent against someone else's attempt. The
 * parent_identity snapshot is derived from THAT server-side row (the attempt's
 * parent_email), never from client-supplied JSON, so the legal-evidence record
 * cannot be spoofed by the request body.
 *
 * ── the (parent_id, signup_attempt_id) binding + the DB invariant ──
 * The row is written bound to (parent_id, signup_attempt_id). At most ONE active
 * consent per attempt is a DB INVARIANT enforced by the partial unique index in
 * migration 20260830120000 (on signup_attempt_id WHERE revoked_at IS NULL) —
 * NOT an app assumption. recordConsent's 23505 handling and consentGate's
 * single-row expectation BOTH rely on that index being applied (it is applied at
 * the migration gate, before Unit 4 wires the gate). Until then the code still
 * degrades sanely: a duplicate insert that somehow lands is classified, and a
 * multi-row read is refused as `ambiguous` rather than a generic outage.
 *
 * ── one consent authorizes exactly one child (atomic claim) ──
 * consentGate is NOT a read-only check. A read-only gate returns ok for ANY
 * childId while child_id is still NULL, so one parental consent could authorize
 * minting TWO different children. Instead the gate performs an atomic
 * compare-and-set: it binds child_id iff the row is unbound OR already this
 * child. "One consent -> one child" is thus enforced by the WRITE, not assumed.
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

/** Server-derived identity snapshot (never client JSON). Email always present
 *  (from the attempt row); name optional (not carried on the attempt today). */
export type ParentIdentitySnapshot = { name?: string; email: string };

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
  ip: string;
  ua: string;
  /** fpv03 U3: the parent UNCHECKED the S04 photo checkbox. Recorded in the
   *  evidence blob so provisioning can stamp the child's photo-consent
   *  tombstone at creation time (the decline outlives the request that
   *  carried it). Absent/false = no claim, no tombstone. */
  photoDeclined?: boolean;
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
  //    THIS attempt. Re-read the attempt rather than trusting the request. The
  //    parent_email read here is ALSO the source of the identity snapshot below.
  const attempt = await db
    .from("fp_signup_attempts")
    .select("id, parent_id, parent_email, state")
    .eq("id", input.attemptId)
    .maybeSingle();
  if (attempt.error) {
    console.error(`[fp/consent] attempt freshness read failed: ${attempt.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const row = attempt.data as
    | { parent_id: string | null; parent_email: string | null; state: string | null }
    | null;
  if (!row || row.state !== "verified") return { ok: false, reason: "not_verified" };
  if (!row.parent_id || row.parent_id !== input.parentId) return { ok: false, reason: "parent_mismatch" };

  // The identity evidence is derived SERVER-SIDE from the verified attempt row,
  // never from the request body — a client cannot spoof whose consent this is.
  const parentIdentity: ParentIdentitySnapshot = { email: String(row.parent_email ?? "") };

  // 3. Write the consent row bound to (parent_id, signup_attempt_id), snapshotting
  //    the SERVER's current version/hash/text (never the echoed strings).
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
      parent_identity: parentIdentity,
      ip: input.ip,
      ua: input.ua,
      // Extensible legal-evidence blob: the echo proof rides along so a later
      // audit can see exactly what the client claimed to render.
      evidence: {
        echoed_version: input.echoedVersion,
        echoed_hash: input.echoedHash,
        verdict,
        // fpv03 U3: present ONLY when the parent explicitly declined photo use
        // at S04. Provisioning reads this back (by attempt id) and stamps
        // children.photo_consent_revoked_at at child creation, so the
        // tombstone is always AT OR AFTER this row's accepted_at and the
        // strictly-after gate rule makes the decline win over the acceptance
        // minted in the same signup.
        ...(input.photoDeclined === true ? { photo_declined: true } : {}),
      },
    })
    .select("id")
    .single();

  if (inserted.error) {
    // 23505 = the partial unique index (migration 20260830120000) tripped: an
    // active consent already exists for this attempt (a duplicate submit). Not an
    // outage — the invariant held. This classification RELIES on that index being
    // applied; until then two concurrent inserts could both land (see the gate's
    // `ambiguous` handling, which is the read-side degrade for that same window).
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
  /** The child about to be minted. The gate atomically CLAIMS the consent for
   *  this child; a consent already claimed by a DIFFERENT child is refused. */
  childId: string;
};

export type ConsentGateResult =
  | { ok: true; consentId: string }
  | { ok: false; reason: "missing" | "stale" | "child_mismatch" | "ambiguous" | "outage" };

/**
 * The mint-time gate Units 4/5 call before creating the child. It ATOMICALLY
 * CLAIMS the active consent for this child rather than merely reading it:
 *
 *   UPDATE fp_parental_consent SET child_id = :childId
 *    WHERE signup_attempt_id = :attemptId AND revoked_at IS NULL
 *      AND (child_id IS NULL OR child_id = :childId)
 *   RETURNING id, policy_version
 *
 * so "one consent -> one child" is a WRITE guarantee. Outcomes:
 *   - claim returns >1 rows → `ambiguous` (the single-active invariant is
 *     violated — only possible if the 20260830120000 unique index is not yet
 *     applied and two concurrent recordConsent inserts both landed).
 *   - claim returns 1 row  → check the policy version; below the min anchor is
 *     `stale`, otherwise ok (returns the consent id to bind).
 *   - claim returns 0 rows → classify: no active consent at all is `missing`;
 *     an active consent that the CAS could not claim is bound to ANOTHER child
 *     (`child_mismatch`). Idempotent: re-gating the SAME child re-claims (the
 *     `child_id = :childId` arm matches) and returns ok again.
 */
export async function consentGate(
  db: SupabaseClient,
  input: ConsentGateInput
): Promise<ConsentGateResult> {
  const claimed = await db
    .from("fp_parental_consent")
    .update({ child_id: input.childId })
    .eq("signup_attempt_id", input.attemptId)
    .is("revoked_at", null)
    // (child_id IS NULL OR child_id = :childId) — unbound, or already ours.
    .or(`child_id.is.null,child_id.eq.${input.childId}`)
    .select("id, policy_version");
  if (claimed.error) {
    console.error(`[fp/consent] gate claim failed: ${claimed.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const rows = (claimed.data as Array<{ id: unknown; policy_version: string | null }> | null) ?? [];
  if (rows.length > 1) {
    // More than one active consent for one attempt: refuse rather than mint
    // against an ambiguous pair (the index is the fix; this is the safe degrade).
    console.error(`[fp/consent] gate saw ${rows.length} active consents for attempt ${input.attemptId} — ambiguous`);
    return { ok: false, reason: "ambiguous" };
  }
  if (rows.length === 1) {
    const claim = rows[0];
    if (!policyVersionAtLeast(claim.policy_version, FP_CONSENT_MIN_VERSION)) {
      return { ok: false, reason: "stale" };
    }
    return { ok: true, consentId: String(claim.id) };
  }

  // 0 rows claimed: either there is NO active consent (missing), or the active
  // consent is bound to a DIFFERENT child (the CAS's child_id arm excluded it).
  const existing = await db
    .from("fp_parental_consent")
    .select("id")
    .eq("signup_attempt_id", input.attemptId)
    .is("revoked_at", null);
  if (existing.error) {
    console.error(`[fp/consent] gate classify read failed: ${existing.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const exRows = (existing.data as unknown[] | null) ?? [];
  if (exRows.length > 1) return { ok: false, reason: "ambiguous" };
  if (exRows.length === 0) return { ok: false, reason: "missing" };
  return { ok: false, reason: "child_mismatch" };
}
