/**
 * Student provisioning + reset core (T1 Unit 6; R1, R2, R32, D27).
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the db arg cannot serialize) and no
 * `import "server-only"` (the machine-bound seed script must reuse it under
 * tsx). Callers own their gate: the /path actions gate with requirePathUser +
 * isParentOfFamily, the D26 staff action with requireStaff, the script with
 * possession of the service-role key on this machine. See docs/solutions/
 * best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-…
 * and …/server-only-import-breaks-tsx-scripts-plain-core-re-export-….
 *
 * What provisioning does, in order (all decisions live in provision-rules.ts):
 *   1. load the roster child (public.children stays authoritative, R31);
 *   2. refuse if a profile already links this child (unique child_id);
 *   3. resolve the CURRENT program version (Unit 4's is_current) — the D27 pin,
 *      set here and never touched by content deploys; NO fallback if none;
 *   4. enforce the R29 password floor;
 *   5. admin.createUser with buildStudentCreateUserPayload — which carries the
 *      mandatory email_confirm: true (the lockout flag; see provision-rules);
 *   6. insert the profile row (pinned version, family, optional cohort);
 *   7. upsert the two-grant pair (self + family membership).
 *
 * Partial-failure posture: every step is idempotent-or-repairable, so a re-run
 * COMPLETES a stranded provisioning instead of wedging against it — an
 * email-exists on createUser means a prior attempt got that far (the address is
 * derived from the child id), so the password is re-set to the parent's current
 * intent and the run continues; a duplicate-key on the profile insert adopts
 * the existing row; the grants upsert ignores duplicates. Never inserts into
 * public.parents, so the on_parent_created trigger cannot fire.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  buildStudentCreateUserPayload,
  buildStudentGrants,
  deriveStudentEmail,
  parseCandidateRow,
  validateStudentPassword,
  type SignInCandidate,
} from "./provision-rules";

export type ProvisionStudentInput = {
  childId: string;
  familyId: string;
  cohortId?: string | null;
  /** Parent-set. Validated against the R29 floor before any write. */
  password: string;
};

export type ProvisionStudentResult =
  | { ok: true; profileId: string; userId: string; repaired: boolean }
  | {
      ok: false;
      reason:
        | "child_not_found"
        | "child_name_missing"
        | "family_not_found"
        | "already_provisioned"
        | "no_current_program_version"
        | "unavailable";
    }
  | { ok: false; reason: "weak_password"; message: string };

export async function provisionStudent(
  db: SupabaseClient,
  input: ProvisionStudentInput
): Promise<ProvisionStudentResult> {
  const { childId, familyId, password } = input;
  const cohortId = input.cohortId ?? null;

  // 1. The authoritative roster row — name and grade live here, never copied.
  const childRes = await db.from("children").select("id, first_name").eq("id", childId).maybeSingle();
  if (childRes.error) {
    console.error(`[path/provision] child load failed for ${childId}: ${childRes.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if (!childRes.data) return { ok: false, reason: "child_not_found" };
  const firstName =
    typeof childRes.data.first_name === "string" ? childRes.data.first_name : "";

  // Refuse a nameless roster row (public.children.first_name defaults to '' for
  // CRM drafts). Without a name, studentNameMatches fails closed forever, so the
  // account we would mint here could NEVER sign in — a silent, permanent lockout
  // reported as success. Fail loudly at provisioning instead (Unit 6 review).
  if (firstName.trim().length === 0) return { ok: false, reason: "child_name_missing" };

  // 2. One profile per child, ever (unique child_id backs this check under race).
  const existing = await db
    .from("path_student_profiles")
    .select("id")
    .eq("child_id", childId)
    .maybeSingle();
  if (existing.error) {
    console.error(`[path/provision] profile probe failed for ${childId}: ${existing.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if (existing.data) return { ok: false, reason: "already_provisioned" };

  // 3. The family must exist before we mint an account into it.
  const family = await db.from("path_families").select("id").eq("id", familyId).maybeSingle();
  if (family.error) {
    console.error(`[path/provision] family load failed for ${familyId}: ${family.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if (!family.data) return { ok: false, reason: "family_not_found" };

  // 4. The D27 pin: the currently-designated version, resolved NOW, immutable
  // after. No row → refuse loudly; a silent fallback would let a half-seeded
  // deploy pin students to nothing (the getProgram never-falls-back posture).
  const version = await db
    .from("path_program_versions")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  if (version.error) {
    console.error(`[path/provision] version load failed: ${version.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  const programVersionId = version.data?.id;
  if (typeof programVersionId !== "string") {
    return { ok: false, reason: "no_current_program_version" };
  }

  // 5. R29 floor — the child's own name is the most guessable string around.
  const verdict = validateStudentPassword(password, { studentName: firstName });
  if (!verdict.ok) return { ok: false, reason: "weak_password", message: verdict.error };

  // 6. The auth account, on the derived non-deliverable address. The payload
  // builder pins email_confirm: true at the type level (the lockout flag).
  let user: User;
  let repaired = false;
  const created = await db.auth.admin.createUser(buildStudentCreateUserPayload({ childId, password }));
  if (created.error) {
    const emailExists =
      created.error.code === "email_exists" || /already.*(registered|exists)/i.test(created.error.message);
    if (!emailExists) {
      console.error(`[path/provision] createUser failed for child ${childId}: ${created.error.message}`);
      return { ok: false, reason: "unavailable" };
    }
    // Repair: a prior run created the account (the address is derived from the
    // child id) but died before the profile landed. Re-adopt it — but ONLY if
    // this is genuinely a stranded run, not a live concurrent co-parent
    // provisioning the same child (R32 allows either parent). Re-probe for a
    // profile first: if one now exists, a concurrent caller already won, so we
    // must NOT clobber their password — report already_provisioned and stop
    // (Unit 6 review, adversarial). Only when there is still no profile do we
    // reset the password to complete the stranded provisioning.
    const reprobe = await db
      .from("path_student_profiles")
      .select("id")
      .eq("child_id", childId)
      .maybeSingle();
    if (reprobe.error) {
      console.error(`[path/provision] repair re-probe failed for ${childId}: ${reprobe.error.message}`);
      return { ok: false, reason: "unavailable" };
    }
    if (reprobe.data) return { ok: false, reason: "already_provisioned" };

    const found = await findAuthUserByEmail(db, deriveStudentEmail(childId));
    if (!found) {
      console.error(`[path/provision] email exists but user not found for child ${childId}`);
      return { ok: false, reason: "unavailable" };
    }
    // Defense in depth: only adopt an account this system minted as a student.
    // The address is derived from an internal child UUID (so external collision
    // is implausible), but never reset a non-student account's password.
    if (found.app_metadata?.role !== "student") {
      console.error(`[path/provision] refusing to adopt non-student account for child ${childId}`);
      return { ok: false, reason: "unavailable" };
    }
    const updated = await db.auth.admin.updateUserById(found.id, { password });
    if (updated.error) {
      console.error(`[path/provision] repair password reset failed: ${updated.error.message}`);
      return { ok: false, reason: "unavailable" };
    }
    user = found;
    repaired = true;
  } else {
    user = created.data.user;
  }

  // 7. The profile row — the D27 pin happens here.
  let profileId: string;
  const inserted = await db
    .from("path_student_profiles")
    .insert({
      user_id: user.id,
      child_id: childId,
      program_version_id: programVersionId,
      family_id: familyId,
      cohort_id: cohortId,
    })
    .select("id")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      // A concurrent (or previously stranded) run won — adopt its row.
      const adopt = await db
        .from("path_student_profiles")
        .select("id")
        .eq("child_id", childId)
        .maybeSingle();
      if (adopt.error || typeof adopt.data?.id !== "string") {
        console.error(`[path/provision] adopt-after-conflict failed for ${childId}`);
        return { ok: false, reason: "unavailable" };
      }
      profileId = adopt.data.id;
      repaired = true;
    } else {
      console.error(`[path/provision] profile insert failed for ${childId}: ${inserted.error.message}`);
      return { ok: false, reason: "unavailable" };
    }
  } else if (typeof inserted.data?.id === "string") {
    profileId = inserted.data.id;
  } else {
    // The insert reported success but the projected id is not a string — fail
    // loudly rather than let a bad profileId flow into the grants upsert (the
    // adopt branch above already guards its read the same way).
    console.error(`[path/provision] profile insert returned no id for ${childId}`);
    return { ok: false, reason: "unavailable" };
  }

  // 8. The two-grant pair. Upsert-on-unique so a repair run is a no-op.
  const grants = await db
    .from("path_role_grants")
    .upsert(buildStudentGrants({ userId: user.id, profileId, familyId }), {
      onConflict: "user_id,role,scope_type,scope_id",
      ignoreDuplicates: true,
    });
  if (grants.error) {
    console.error(`[path/provision] grants upsert failed for ${user.id}: ${grants.error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, profileId, userId: user.id, repaired };
}

/* ------------------------------------------------------------------ reset */

/**
 * Load the authoritative identity a reset/recovery decision needs. The caller
 * gates on the RETURNED familyId (isParentOfFamily / requireStaff) — never on
 * a client-supplied one; this is the "target ids come from the authoritative
 * resource row" invariant access-rules.ts documents. Reuses the sign-in
 * candidate parser (identical profiles⋈children shape, same fail-closed drop).
 */
export async function loadStudentProfileForAuth(
  db: SupabaseClient,
  profileId: string
): Promise<SignInCandidate | null> {
  const res = await db
    .from("path_student_profiles")
    .select("id, user_id, child_id, family_id, children!inner(first_name)")
    .eq("id", profileId)
    .maybeSingle();
  if (res.error) {
    console.error(`[path/provision] profile load failed for ${profileId}: ${res.error.message}`);
    return null;
  }
  if (!res.data) return null;
  return parseCandidateRow(res.data);
}

export type ResetStudentPasswordResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" }
  | { ok: false; reason: "weak_password"; message: string };

/**
 * Map a failed reset result to user-facing copy — shared so the parent action
 * (provision.ts) and the D26 staff action (path-recovery.ts) can't drift on the
 * two strings. weak_password surfaces the specific floor message; everything
 * else is a generic retry.
 */
export function resetFailureMessage(
  result: Exclude<ResetStudentPasswordResult, { ok: true }>
): string {
  return result.reason === "weak_password" ? result.message : "The reset failed — please try again.";
}

/**
 * Set a student's password to the adult's new choice — no email round-trip
 * exists or is possible (the address is non-deliverable by design). AUTH IS
 * THE CALLER'S JOB: the parent action checks isParentOfFamily against the
 * loaded profile's familyId first; the D26 staff action checks requireStaff
 * and writes the audit row. The core re-validates the floor as defense in
 * depth so no caller can skip it.
 *
 * Session posture, verified empirically (Unit 6 drill, 2026-07-22): an
 * admin.updateUserById password change DID revoke the student's pre-reset
 * session (getUser on the old session failed immediately after). Treat that as
 * observed behavior, not a documented contract — if recovery-from-compromise
 * ever becomes a hard requirement, add an explicit sign-out sweep rather than
 * relying on it.
 */
export async function resetStudentPassword(
  db: SupabaseClient,
  input: { userId: string; newPassword: string; studentName?: string }
): Promise<ResetStudentPasswordResult> {
  const verdict = validateStudentPassword(input.newPassword, { studentName: input.studentName });
  if (!verdict.ok) return { ok: false, reason: "weak_password", message: verdict.error };

  const updated = await db.auth.admin.updateUserById(input.userId, { password: input.newPassword });
  if (updated.error) {
    console.error(`[path/provision] password reset failed for ${input.userId}: ${updated.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}

/* ---------------------------------------------------------------- helpers */

/**
 * Page-walk lookup by email (the seed-staff.ts precedent — no direct
 * get-by-email exists in the admin API). Exported so the machine-bound seed
 * script reuses this one copy instead of a third hand-rolled duplicate; returns
 * null on a query error (logged) so callers fail closed. Only the provisioning
 * repair path and the seed script call it.
 */
export async function findAuthUserByEmail(
  db: SupabaseClient,
  email: string
): Promise<User | null> {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error(`[path/provision] listUsers failed: ${error.message}`);
      return null;
    }
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < perPage) return null;
  }
}
