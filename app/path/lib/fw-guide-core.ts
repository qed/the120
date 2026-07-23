/**
 * FW guide identity core (FW Unit 2) — the db-taking half of the guide door:
 * the authorization inputs a caller needs to resolve an FW actor, and the three
 * credentialing sequences (provision, issue/re-issue, claim).
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the `db` argument cannot serialize) and no
 * `import "server-only"` (so a future ops script can reuse it under tsx). Callers
 * own their gate: `fw-auth.ts` gates the pages, the FW actions gate with the
 * staff bridge. See docs/solutions/best-practices/shared-db-taking-core-must-not-
 * live-in-a-use-server-file-… and …/use-server-type-reexport-registers-server-
 * reference-…
 *
 * Sibling of `provision-core.ts`'s FW half in posture: every decision that could
 * be wrong lives in `fw-access-rules.ts`; this file adds I/O, sequencing, and
 * compensation, and is tested with the same fake-Supabase-client harness (Unit
 * 1's review found the untested orchestration was its biggest gap).
 *
 * COMPENSABLE, per docs/solutions/best-practices/no-transaction-multi-step-write-
 * compensation-post-write-verify-cas-scoped-claim-2026-07-22.md — nothing here
 * spans the Auth API and PostgREST in a transaction, so each sequence names what
 * it undoes on failure.
 */

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  buildFwGuideCreateUserPayload,
  canAdoptAsGuideAccount,
  fwGuideInviteExpiry,
  fwGuideInviteVerdict,
  FW_COHORT_KIND,
  type FwCohortLike,
} from "./fw-access-rules";
import { isFwStudentAddress } from "./fw-provision-rules";
import { normalizeEmail } from "./onboarding-rules";
import { validateStudentPassword } from "./provision-rules";
import { findAuthUserByEmail } from "./provision-core";

/** SHA-256 hex — the ONLY form a guide invite token is ever stored in. */
export function hashGuideInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/* ────────────────────────────────────────────── authorization inputs (reads) ── */

/**
 * Load the cohort `resolveFwActor` will judge — AUTHORITATIVELY, which is the
 * whole reason this is a database read and not a parameter. `kind` decides
 * whether the bridge applies and whether a board token may ever be minted, so a
 * client-supplied kind would make the bridge self-service.
 *
 * A read error returns null (fail closed) after logging: "the cohort could not
 * be loaded" and "there is no such cohort" both mean nobody is authorized, and
 * conflating them here is safe because neither is an authorization grant.
 */
export async function loadFwCohort(
  db: SupabaseClient,
  cohortId: string
): Promise<FwCohortLike> {
  const res = await db
    .from("path_cohorts")
    .select("id, kind, slug")
    .eq("id", cohortId)
    .maybeSingle();
  if (res.error) {
    console.error(`[fw/guide] cohort load failed for ${cohortId}: ${res.error.message}`);
    return null;
  }
  // Fail-closed narrowing at the service-role boundary (the parseCandidateRow
  // discipline): `db` is untyped, so an `as string` here would be a promise to
  // the compiler with nothing behind it — and this value gates a write path.
  const row = res.data;
  if (!row || typeof row.id !== "string" || typeof row.kind !== "string") return null;
  return { id: row.id, kind: row.kind };
}

/**
 * The bridge's second input: is there a LIVE, ACTIVE staff row for this user?
 * Read fresh on every resolution — never from the JWT — because revocation is
 * exactly what the stale-JWT rule exists to catch (`resolveStaffAccess`'s
 * `is_active` branch, inherited wholesale).
 *
 * A read error returns false: an outage must not promote anyone to staff.
 */
export async function loadStaffRowActive(
  db: SupabaseClient,
  userId: string
): Promise<boolean> {
  const res = await db
    .from("staff")
    .select("id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (res.error) {
    console.error(`[fw/guide] staff row load failed for ${userId}: ${res.error.message}`);
    return false;
  }
  return res.data?.is_active === true;
}

export type FwCohortSummary = { id: string; slug: string };

/**
 * Every `kind='fw'` cohort this actor may act in — the roster behind the cohort
 * switcher (Decision 3) and the stub surface's proof that the bridge works.
 *
 * Staff (bridge) see every fw cohort; a pure guide sees only the ones their
 * grants name. Filtering happens in SQL for staff and by id-set for guides, but
 * BOTH paths re-read `kind` from the cohort rows rather than trusting the grant:
 * a `guide`/`cohort` grant can name a Path cohort (that is the Path's own D25
 * reviewer grant) and must not surface here.
 */
export async function listFwCohortsForActor(
  db: SupabaseClient,
  input: { grantedCohortIds: readonly string[]; isStaff: boolean }
): Promise<FwCohortSummary[]> {
  if (!input.isStaff && input.grantedCohortIds.length === 0) return [];

  let query = db.from("path_cohorts").select("id, slug, kind").eq("kind", FW_COHORT_KIND);
  if (!input.isStaff) {
    query = query.in("id", [...input.grantedCohortIds]);
  }
  const res = await query;
  if (res.error) {
    console.error(`[fw/guide] cohort list failed: ${res.error.message}`);
    return [];
  }
  return (res.data ?? [])
    .filter(
      (r): r is { id: string; slug: string; kind: string } =>
        typeof r.id === "string" && typeof r.slug === "string" && r.kind === FW_COHORT_KIND
    )
    .map((r) => ({ id: r.id, slug: r.slug }));
}

/* ───────────────────────────────────────────────────── guide provisioning ──── */

export type ProvisionFwGuideInput = {
  email: string;
  /** Must be a `kind='fw'` cohort — verified here, not assumed. */
  cohortId: string;
  /** The staff user performing this. Recorded on the invite row. */
  createdBy: string;
};

export type ProvisionFwGuideFailure =
  | "invalid_email"
  | "cohort_not_found"
  | "cohort_not_fw"
  /** The address already belongs to an account this system did not mint as a
   *  guide (staff, parent, student). Never adopted — see canAdoptAsGuideAccount. */
  | "address_in_use"
  | "unavailable";

export type ProvisionFwGuideResult =
  | { ok: true; userId: string; email: string; created: boolean }
  | { ok: false; reason: ProvisionFwGuideFailure };

/**
 * Mint (or adopt) one guide account and grant it into an fw cohort.
 *
 * Sequence: verify cohort → mint dormant account → `guide`/`cohort` grant.
 * The account carries NO admin claim and NO password (FW-R5, Decision 12); the
 * invite claim is what sets a credential.
 *
 * Idempotent by design, because staff will re-run it: an `email_exists` on
 * createUser adopts the existing account IF AND ONLY IF it is already a guide
 * account, and the grant upsert ignores duplicates. Adding a second cohort's
 * grant to an existing guide is therefore just calling this again — which is
 * what "a guide works Boston and Hamptons" means.
 *
 * Compensation: an account THIS call minted is best-effort deleted when the
 * grant write fails, so a retry does not meet an orphan account with no grant
 * (the invite.ts reliability precedent). An ADOPTED account is never deleted —
 * it predates this call and may hold other cohorts' grants.
 */
export async function provisionFwGuide(
  db: SupabaseClient,
  input: ProvisionFwGuideInput
): Promise<ProvisionFwGuideResult> {
  const email = normalizeEmail(input.email);
  if (email.length === 0 || !email.includes("@")) {
    return { ok: false, reason: "invalid_email" };
  }

  const cohort = await loadFwCohort(db, input.cohortId);
  if (!cohort) return { ok: false, reason: "cohort_not_found" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };

  let payload;
  try {
    payload = buildFwGuideCreateUserPayload({ email, isFwStudentAddress });
  } catch {
    // The one throwing case is the FW student namespace — a typo that would put
    // a password-carrying account inside the dormant minors' namespace.
    return { ok: false, reason: "invalid_email" };
  }

  let user: User;
  let created = false;
  const attempt = await db.auth.admin.createUser(payload);
  if (attempt.error || !attempt.data?.user) {
    const emailExists =
      attempt.error?.code === "email_exists" ||
      /already.*(registered|exists)/i.test(attempt.error?.message ?? "");
    if (!emailExists) {
      console.error(
        `[fw/guide] createUser failed for ${email} (cohort ${input.cohortId}): ${attempt.error?.message ?? "no user returned"}`
      );
      return { ok: false, reason: "unavailable" };
    }
    const found = await findAuthUserByEmail(db, email);
    if (!found) {
      console.error(`[fw/guide] createUser said email_exists but no user found for ${email}`);
      return { ok: false, reason: "unavailable" };
    }
    // The escalation guard: an invite issued against this account can SET ITS
    // PASSWORD. Adopting a staff/parent/student account would turn "add a guide"
    // into "mail a credential for that person's account to whoever staff typed".
    if (!canAdoptAsGuideAccount(found)) {
      console.error(
        `[fw/guide] refusing to adopt non-guide account for ${email} (role=${String(found.app_metadata?.role)})`
      );
      return { ok: false, reason: "address_in_use" };
    }
    user = found;
  } else {
    user = attempt.data.user;
    created = true;
  }

  const grant = await db.from("path_role_grants").upsert(
    [{ user_id: user.id, role: "guide", scope_type: "cohort", scope_id: cohort.id }],
    { onConflict: "user_id,role,scope_type,scope_id", ignoreDuplicates: true }
  );
  if (grant.error) {
    console.error(
      `[fw/guide] grant upsert failed for ${user.id}/${cohort.id}: ${grant.error.message}`
    );
    if (created) {
      const del = await db.auth.admin.deleteUser(user.id);
      if (del.error) {
        console.error(
          `[fw/guide] compensation deleteUser failed for ${user.id}: ${del.error.message} — account is grant-less; staff can remove it`
        );
      }
    }
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, userId: user.id, email: user.email ?? email, created };
}

/* ──────────────────────────────────────────────────── invite issue / re-issue ── */

export type IssueFwGuideInviteResult =
  | { ok: true; token: string; email: string; expiresAt: string }
  | { ok: false; reason: "guide_not_found" | "not_a_guide_account" | "unavailable" };

/**
 * Issue — or RE-issue — the tokened link a guide sets their password with.
 *
 * One row per guide account (`user_id` is unique), rotated in place. That is
 * what makes "a re-issue kills the old hash" structurally true rather than a
 * discipline: there is nowhere for a second live token to exist. A re-issue also
 * RESETS `claimed_at` to null, which is the sanctioned Friday-morning recovery
 * for a guide who forgot the password they set (Decision 12) — the guide door
 * has no email-based reset, and it must not grow one (FW addresses are guessable
 * and the two existing reset forms call Supabase from the browser, where no
 * server-side guard can reach them).
 *
 * Re-verifies the target is a guide account before minting. Without that, an
 * account whose role changed after provisioning (or an id typed by hand into an
 * ops form) could be handed a password-setting link.
 */
export async function issueFwGuideInvite(
  db: SupabaseClient,
  input: { userId: string; createdBy: string; now: number }
): Promise<IssueFwGuideInviteResult> {
  const account = await db.auth.admin.getUserById(input.userId);
  if (account.error || !account.data?.user) {
    console.error(
      `[fw/guide] invite target ${input.userId} not found: ${account.error?.message ?? "no user"}`
    );
    return { ok: false, reason: "guide_not_found" };
  }
  const user = account.data.user;
  if (!canAdoptAsGuideAccount(user)) {
    console.error(
      `[fw/guide] refusing to issue an invite for a non-guide account ${input.userId} (role=${String(user.app_metadata?.role)})`
    );
    return { ok: false, reason: "not_a_guide_account" };
  }
  const email = normalizeEmail(user.email ?? "");
  if (email.length === 0) {
    console.error(`[fw/guide] guide account ${input.userId} has no email`);
    return { ok: false, reason: "unavailable" };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = fwGuideInviteExpiry(input.now);
  const issuedAt = new Date(input.now).toISOString();

  const upserted = await db.from("path_fw_guide_invites").upsert(
    [
      {
        user_id: input.userId,
        email,
        token_hash: hashGuideInviteToken(token),
        expires_at: expiresAt,
        // Re-open the claim. A re-issue exists precisely because the previous
        // credential is gone or unusable.
        claimed_at: null,
        issued_at: issuedAt,
        created_by: input.createdBy,
      },
    ],
    { onConflict: "user_id" }
  );
  if (upserted.error) {
    console.error(`[fw/guide] invite upsert failed for ${input.userId}: ${upserted.error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, token, email, expiresAt };
}

/* ────────────────────────────────────────────────────────────── invite claim ── */

export type ClaimFwGuideInviteResult =
  | { ok: true; userId: string; email: string }
  | {
      ok: false;
      reason:
        /** Every dead-link shape collapses here — the caller renders ONE message
         *  so an unauthenticated claimer learns nothing about which it was. */
        | "dead_link"
        | "weak_password"
        /** The CAS was won but the password write failed; the claim was rolled
         *  back so the link the guide is holding still works. */
        | "unavailable";
      message?: string;
    };

/**
 * Claim a guide invite: set the account's first password and burn the token.
 *
 * ORDER IS THE POINT. The CAS claim runs BEFORE the password write:
 *
 *   1. load by hash, judge with the pure verdict (existence → single-use →
 *      expiry, fail-closed on a malformed timestamp);
 *   2. re-verify the target is still a guide account (a role change or a
 *      hand-edited row must not become a password-setting link);
 *   3. validate the password against the shared floor BEFORE burning anything —
 *      a rejected password must not cost the guide their link;
 *   4. CAS: claim the row on (id, THIS token hash, unclaimed). Cardinality picks
 *      the winner of two simultaneous claims, and a staff re-issue mid-flight
 *      rotates the hash so the in-flight claim affects zero rows — the old link
 *      genuinely dies (the invite.ts token-hash CAS precedent);
 *   5. only then set the password.
 *
 * Doing 5 before 4 would let the loser of a race change the password of an
 * account the winner just credentialed. Doing 4 before 5 has one failure mode —
 * a won claim whose password write fails — and it is COMPENSATED: the claim is
 * released (CAS'd back to null on the same hash, so a concurrent re-issue is not
 * clobbered), because the guide is still holding a link that should still work.
 *
 * Signing in is the CALLER's job: the cookie-bound client lives in the action.
 */
export async function claimFwGuideInvite(
  db: SupabaseClient,
  input: { token: string; password: string; now: number }
): Promise<ClaimFwGuideInviteResult> {
  const tokenHash = hashGuideInviteToken(input.token);

  const res = await db
    .from("path_fw_guide_invites")
    .select("id, user_id, email, expires_at, claimed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (res.error) {
    console.error(`[fw/guide] claim load failed: ${res.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  const row = res.data;

  const verdict = fwGuideInviteVerdict({
    invite:
      row && typeof row.expires_at === "string"
        ? {
            expiresAt: row.expires_at,
            claimedAt: typeof row.claimed_at === "string" ? row.claimed_at : null,
          }
        : null,
    now: input.now,
  });
  if (!verdict.ok) return { ok: false, reason: "dead_link" };

  // Past a passing verdict the row is non-null; narrow fail-closed anyway — this
  // is the service-role boundary and the next steps write a credential.
  const inviteId = row?.id;
  const userId = row?.user_id;
  if (typeof inviteId !== "string" || typeof userId !== "string") {
    console.error("[fw/guide] claim row has a malformed id/user_id");
    return { ok: false, reason: "unavailable" };
  }

  const account = await db.auth.admin.getUserById(userId);
  if (account.error || !account.data?.user) {
    console.error(
      `[fw/guide] claim target ${userId} missing: ${account.error?.message ?? "no user"}`
    );
    return { ok: false, reason: "dead_link" };
  }
  if (!canAdoptAsGuideAccount(account.data.user)) {
    console.error(
      `[fw/guide] refusing to claim onto a non-guide account ${userId} (role=${String(account.data.user.app_metadata?.role)})`
    );
    return { ok: false, reason: "dead_link" };
  }

  // Before the burn: a rejected password must never cost the guide their link.
  const pw = validateStudentPassword(input.password, {});
  if (!pw.ok) return { ok: false, reason: "weak_password", message: pw.error };

  const claimedAt = new Date(input.now).toISOString();
  const claimed = await db
    .from("path_fw_guide_invites")
    .update({ claimed_at: claimedAt })
    .eq("id", inviteId)
    .eq("token_hash", tokenHash)
    .is("claimed_at", null)
    .select("id");
  if (claimed.error) {
    console.error(`[fw/guide] claim CAS failed: ${claimed.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if ((claimed.data ?? []).length === 0) {
    // Lost the race, or a re-issue rotated the hash while we were in flight.
    return { ok: false, reason: "dead_link" };
  }

  const updated = await db.auth.admin.updateUserById(userId, { password: input.password });
  if (updated.error) {
    console.error(`[fw/guide] password set failed for ${userId}: ${updated.error.message}`);
    // Release the claim so the link the guide is still holding keeps working.
    // CAS'd on the hash we claimed under: a re-issue that landed in between has
    // rotated it, and must not be un-claimed by us.
    const released = await db
      .from("path_fw_guide_invites")
      .update({ claimed_at: null })
      .eq("id", inviteId)
      .eq("token_hash", tokenHash);
    if (released.error) {
      console.error(
        `[fw/guide] claim release failed for ${inviteId}: ${released.error.message} — staff must re-issue`
      );
    }
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, userId, email: normalizeEmail(account.data.user.email ?? "") };
}
