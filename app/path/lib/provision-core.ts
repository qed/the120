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
 * What provisioning does, in order (all decisions live in provision-rules.ts
 * and onboarding-rules.ts):
 *   1. load the roster child (public.children stays authoritative, R31);
 *   2. the family must exist;
 *   3. THE OWNERSHIP HARD GATE (Unit 15; Unit 6 security review P1): the
 *      child's CRM parent (children.parent_id, which IS an auth user id) must
 *      hold a parent/family grant for the supplied familyId. Without this a
 *      signed-in parent could pair their own familyId with ANY roster child
 *      and permanently squat it. Enforced HERE in the shared core — not only
 *      in the action — so every caller (parent action, staff, scripts) passes
 *      through it;
 *   4. refuse if a profile already links this child (unique child_id);
 *   5. refuse a band-less grade (null or out of range) with a SPECIFIC reason —
 *      the decided Unit 15 UX is refuse-and-tell, never a silently-recorded
 *      default band (ensureStudentProgress's no_band refusal stays as
 *      defense-in-depth but is now unreachable via provisioning);
 *   6. resolve the CURRENT program version (Unit 4's is_current) — the D27 pin,
 *      set here and never touched by content deploys; NO fallback if none;
 *   7. enforce the R29 password floor;
 *   8. admin.createUser with buildStudentCreateUserPayload — which carries the
 *      mandatory email_confirm: true (the lockout flag; see provision-rules);
 *   9. insert the profile row (pinned version, family, optional cohort);
 *  10. upsert the two-grant pair (self + family membership);
 *  11. materialize the initial progress rows (ensureStudentProgress).
 *
 * Partial-failure posture: every step is idempotent-or-repairable, so a re-run
 * COMPLETES a stranded provisioning instead of wedging against it — an
 * email-exists on createUser means a prior attempt got that far (the address is
 * derived from the child id), so the password is re-set to the parent's current
 * intent and the run continues; a duplicate-key on the profile insert adopts
 * the existing row; the grants upsert ignores duplicates. Never inserts into
 * public.parents, so the on_parent_created trigger cannot fire.
 *
 * The Founders Weekend siblings (`provisionFwStudent`, `ensureFwStudentProgress`)
 * live at the bottom of this file. They share the row-shape helpers and NONE of
 * the policy — read the banner there before assuming either half generalizes.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Band } from "@/app/path/content/types";
import { fwRead, fwWrite, isUniqueViolation } from "./fw-call";
import {
  bandForGrade,
  buildInitialProgressRows,
  gradeFromChildJoin,
  type InitialProgressRow,
  type SeedCriterionRow,
  type SeedTaskRow,
} from "./progress-core";
import { bandVerdictForGrade, childFamilyVerdict } from "./onboarding-rules";
import {
  buildFwLocalBase,
  buildFwStudentCreateUserPayload,
  buildFwProgressRows,
  buildNormalizedFwName,
  isFwStudentAddress,
  pickFwLocalPart,
  MAX_FW_LOCAL_ATTEMPTS,
  type FwLocalPartPick,
} from "./fw-provision-rules";
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
        | "child_not_in_family"
        | "child_grade_missing"
        | "child_grade_out_of_range"
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

  // 1. The authoritative roster row — name, grade, and the CRM parent linkage
  // live here, never copied.
  const childRes = await db
    .from("children")
    .select("id, first_name, grade, parent_id")
    .eq("id", childId)
    .maybeSingle();
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

  // 2. The family must exist before we mint an account into it.
  const family = await db.from("path_families").select("id").eq("id", familyId).maybeSingle();
  if (family.error) {
    console.error(`[path/provision] family load failed for ${familyId}: ${family.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if (!family.data) return { ok: false, reason: "family_not_found" };

  // 3. THE OWNERSHIP HARD GATE (Unit 15; closes Unit 6's security P1). The
  // child's CRM parent — children.parent_id, which IS an auth user id
  // (public.parents.id references auth.users) — must hold a parent/family
  // grant for THIS family. Keyed on the CHILD's parent, not the caller, so an
  // invited co-parent can provision while an outsider pairing their own
  // familyId with a foreign childId is refused BEFORE any probe reveals
  // whether that child is provisioned. Runs before every write.
  const familyParents = await db
    .from("path_role_grants")
    .select("user_id")
    .eq("role", "parent")
    .eq("scope_type", "family")
    .eq("scope_id", familyId);
  if (familyParents.error) {
    console.error(
      `[path/provision] family parent grants load failed for ${familyId}: ${familyParents.error.message}`
    );
    return { ok: false, reason: "unavailable" };
  }
  const childParentUserId =
    typeof childRes.data.parent_id === "string" ? childRes.data.parent_id : null;
  const familyParentUserIds = (familyParents.data ?? [])
    .map((r) => r.user_id)
    .filter((id): id is string => typeof id === "string");
  if (childFamilyVerdict({ childParentUserId, familyParentUserIds }) !== "ok") {
    return { ok: false, reason: "child_not_in_family" };
  }

  // 4. One profile per child, ever (unique child_id backs this check under race).
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

  // 5. The band gate (Unit 15's decided UX): a grade The Path has no band for
  // refuses NOW, with a specific reason, before any account exists — never a
  // silently-recorded default. Runs after the dup probe so a provisioned child
  // whose grade was later nulled still reads already_provisioned.
  const grade = typeof childRes.data.grade === "number" ? childRes.data.grade : null;
  const bandVerdict = bandVerdictForGrade(grade);
  if (!bandVerdict.ok) {
    return {
      ok: false,
      reason: bandVerdict.reason === "no_grade" ? "child_grade_missing" : "child_grade_out_of_range",
    };
  }

  // 6. The D27 pin: the currently-designated version, resolved NOW, immutable
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

  // 7. R29 floor — the child's own name is the most guessable string around.
  const verdict = validateStudentPassword(password, { studentName: firstName });
  if (!verdict.ok) return { ok: false, reason: "weak_password", message: verdict.error };

  // 8. The auth account, on the derived non-deliverable address. The payload
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

  // 9. The profile row — the D27 pin happens here.
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

  // 10. The two-grant pair. Upsert-on-unique so a repair run is a no-op.
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

  // 11. Materialize the student's progress rows (Unit 14): every task locked,
  // the first task of each first-phase criterion available with the band
  // snapshotted. Without these the transition RPC has nothing to update and no
  // task can ever open. Idempotent, so a repair run completes a stranded one.
  // A failure here is logged but does NOT fail provisioning: the account and
  // grants are real, and a later ensureStudentProgress re-run (or the seed
  // script) completes the materialization.
  const progress = await ensureStudentProgress(db, { profileId });
  if (!progress.ok) {
    console.error(
      `[path/provision] progress materialization for ${profileId} deferred: ${progress.reason} — re-run ensureStudentProgress to complete`
    );
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

/* ------------------------------------------------- family linkage (R31) */

/**
 * Ensure a path family exists for a CRM parent's auth user, and that the user
 * holds its parent/family grant — the R31 linkage step. Adopt-by-grant first
 * (the grant IS the membership truth the ownership gate reads), so a re-run is
 * a no-op and never mints a second family for the same parent. Used by the
 * seed script and the staff-run backfill (scripts/backfill-path-families.ts);
 * a future staff surface can call it too. Plain-module rule as above: callers
 * own their gate.
 */
export async function ensurePathFamilyForParent(
  db: SupabaseClient,
  input: { userId: string }
): Promise<
  | { ok: true; familyId: string; created: boolean }
  | { ok: false; reason: "unavailable" }
> {
  const grant = await db
    .from("path_role_grants")
    .select("scope_id")
    .eq("user_id", input.userId)
    .eq("role", "parent")
    .eq("scope_type", "family")
    .maybeSingle();
  if (grant.error) {
    console.error(
      `[path/family-link] grant probe failed for ${input.userId}: ${grant.error.message}`
    );
    return { ok: false, reason: "unavailable" };
  }
  if (typeof grant.data?.scope_id === "string") {
    return { ok: true, familyId: grant.data.scope_id, created: false };
  }

  const fam = await db.from("path_families").insert({}).select("id").single();
  if (fam.error || typeof fam.data?.id !== "string") {
    console.error(
      `[path/family-link] family insert failed for ${input.userId}: ${fam.error?.message ?? "no id"}`
    );
    return { ok: false, reason: "unavailable" };
  }
  const familyId = fam.data.id;

  const grantIns = await db.from("path_role_grants").upsert(
    [{ user_id: input.userId, role: "parent", scope_type: "family", scope_id: familyId }],
    { onConflict: "user_id,role,scope_type,scope_id", ignoreDuplicates: true }
  );
  if (grantIns.error) {
    console.error(
      `[path/family-link] grant upsert failed for ${input.userId}: ${grantIns.error.message}`
    );
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, familyId, created: true };
}

/* -------------------------------------- initial progress materialization */

/**
 * Materialize the student's `path_task_progress` rows (Unit 14). The transition
 * RPC only UPDATEs — a missing row echoes empty ("a provisioning gap") — so
 * until these rows exist no transition can ever apply. One row per task in the
 * pinned version; the first task of each first-phase criterion `available`
 * with the band snapshotted; `unlock` events recorded for exactly the rows this
 * run created (actor_role 'system', mirroring the RPC's own cascade shape).
 *
 * Idempotent: `upsert … ignoreDuplicates` on `unique (student_id, task_id)`
 * inserts only the missing rows and returns only those, so a re-run (or a
 * concurrent double-call) never duplicates rows or events, and a student
 * mid-journey is never reset. Plain module rule as above: callers own the gate.
 */
export async function ensureStudentProgress(
  db: SupabaseClient,
  input: { profileId: string }
): Promise<
  | { ok: true; created: number }
  | { ok: false; reason: "profile_not_found" | "no_band" | "no_content" | "unavailable" }
> {
  const profile = await db
    .from("path_student_profiles")
    .select("id, program_version_id, children(grade)")
    .eq("id", input.profileId)
    .maybeSingle();
  if (profile.error) {
    console.error(`[path/progress-seed] profile load failed for ${input.profileId}: ${profile.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if (!profile.data) return { ok: false, reason: "profile_not_found" };
  const versionId = profile.data.program_version_id as string;

  const band = bandForGrade(gradeFromChildJoin(profile.data.children));
  if (!band) return { ok: false, reason: "no_band" };

  const [phases, criteria, tasks] = await Promise.all([
    db.from("path_phases").select("num, seq").eq("program_version_id", versionId),
    db.from("path_criteria").select("criterion_id, phase_num, seq").eq("program_version_id", versionId),
    db.from("path_unit_tasks").select("task_id, criterion_id, seq").eq("program_version_id", versionId),
  ]);
  const queryError = phases.error ?? criteria.error ?? tasks.error;
  if (queryError) {
    console.error(`[path/progress-seed] content load failed for ${versionId}: ${queryError.message}`);
    return { ok: false, reason: "unavailable" };
  }

  const firstPhase = (phases.data ?? []).find((p) => p.seq === 1);
  if (!firstPhase || (tasks.data ?? []).length === 0) return { ok: false, reason: "no_content" };

  let rows: InitialProgressRow[];
  try {
    rows = buildInitialProgressRows({
      studentId: input.profileId,
      programVersionId: versionId,
      band,
      firstPhaseNum: firstPhase.num as string,
      criteria: (criteria.data ?? []) as SeedCriterionRow[],
      tasks: (tasks.data ?? []) as SeedTaskRow[],
    });
  } catch (e) {
    console.error(`[path/progress-seed] row build failed for ${input.profileId}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  // Insert only the missing rows; the projection returns exactly what this run
  // created, which scopes the unlock events below.
  const inserted = await db
    .from("path_task_progress")
    .upsert(rows, { onConflict: "student_id,task_id", ignoreDuplicates: true })
    .select("task_id, state");
  if (inserted.error) {
    console.error(`[path/progress-seed] progress upsert failed for ${input.profileId}: ${inserted.error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  const unlocked = (inserted.data ?? []).filter((r) => r.state === "available");
  if (unlocked.length > 0) {
    const events = await db.from("path_task_events").insert(
      unlocked.map((r) => ({
        student_id: input.profileId,
        task_id: r.task_id as string,
        transition: "unlock",
        from_state: "locked",
        to_state: "available",
        actor: null,
        actor_role: "system",
        note: null,
      }))
    );
    if (events.error) {
      // The rows exist and are correct; a missing unlock event is an audit gap,
      // not a broken student — log loudly, do not roll back the materialization.
      console.error(`[path/progress-seed] unlock events insert failed for ${input.profileId}: ${events.error.message}`);
    }
  }

  return { ok: true, created: (inserted.data ?? []).length };
}

/* ══════════════════════════════════════════════ Founders Weekend (FW Unit 1) ══
 *
 * The FW student is a SIBLING account model, not a mode of the Path's, and the
 * two functions below are siblings of `provisionStudent` / `ensureStudentProgress`
 * for the same reason: every step above reads `public.children` (the authoritative
 * roster row) and gates on a parent's ownership of it. An FW student has no roster
 * row and no parent in the system — a guide typed their name at a check-in table
 * ninety seconds ago — so reusing the Path functions would mean loosening every
 * one of those gates for the Path too. Instead the row-shape helpers are shared
 * and the policy is not.
 *
 * Plain-module rule as above: no `"use server"`, callers own their gate (the FW
 * actions gate with `resolveFwActor`, the importer with the staff bridge).
 */

/**
 * Materialize an FW student's `path_task_progress` rows — the FW sibling of
 * `ensureStudentProgress`, and NOT a call into it.
 *
 * Three concrete reasons the Path function cannot be reused here, each of which
 * would be a silent live-event bug:
 *   1. it derives the band from the `children(grade)` join, which is null for
 *      every FW row — it would fail closed with `no_band` on every student;
 *   2. it promotes the first task of each first-phase criterion to `available`,
 *      a gating distinction FW does not make (FW-D5: a guide reaches any task in
 *      the catalog and taps it);
 *   3. it writes `unlock` events for those promotions, which would put ~25
 *      phantom system events per student into the log the projected board reads.
 *
 * FW's band lives on the profile itself (there is no grade to derive it from) and
 * is read here as a FAIL-CLOSED shape check: a profile with no band is not an
 * FW-shaped profile, and materializing all-locked rows for a Path student would
 * strand them below their real position.
 *
 * Idempotent — `upsert … ignoreDuplicates` on `unique (student_id, task_id)` — so
 * a retry-in-place after a failed leg (Decision 13) completes rather than
 * duplicates.
 */
export async function ensureFwStudentProgress(
  db: SupabaseClient,
  input: { profileId: string }
): Promise<
  | { ok: true; created: number }
  | { ok: false; reason: "profile_not_found" | "no_band" | "no_content" | "unavailable" }
> {
  // Routed through fwRead/fwWrite (Unit 9): this is the materialization leg of the FW
  // mint chain, so a stalled call here hangs a ~90-account import exactly like the legs
  // above it — the timeout guard converts that into a typed `unavailable` the caller
  // already handles, rather than leaving a hung request with no compensation reached.
  const profile = await fwRead(
    () =>
      db
        .from("path_student_profiles")
        .select("id, program_version_id, band")
        .eq("id", input.profileId)
        .maybeSingle(),
    `fw progress-seed profile load (${input.profileId})`
  );
  if (profile.error) {
    console.error(`[fw/progress-seed] profile load failed for ${input.profileId}: ${profile.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if (!profile.data) return { ok: false, reason: "profile_not_found" };
  const versionId = profile.data.program_version_id as string;
  if (typeof profile.data.band !== "string") return { ok: false, reason: "no_band" };

  // Only the task rows: an FW row's criterion_id comes off the task itself, and
  // with no first-phase promotion there is nothing to look phases or criteria up
  // for. (The three-column FK on path_task_progress still pins each row's
  // criterion to the task's true criterion.)
  const tasks = await fwRead(
    () => db.from("path_unit_tasks").select("task_id, criterion_id, seq").eq("program_version_id", versionId),
    `fw progress-seed content load (${versionId})`
  );
  if (tasks.error) {
    console.error(`[fw/progress-seed] content load failed for ${versionId}: ${tasks.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if ((tasks.data ?? []).length === 0) return { ok: false, reason: "no_content" };

  let rows: InitialProgressRow[];
  try {
    rows = buildFwProgressRows({
      studentId: input.profileId,
      programVersionId: versionId,
      tasks: (tasks.data ?? []) as SeedTaskRow[],
    });
  } catch (e) {
    console.error(`[fw/progress-seed] row build failed for ${input.profileId}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  const inserted = await fwWrite(
    () =>
      db
        .from("path_task_progress")
        .upsert(rows, { onConflict: "student_id,task_id", ignoreDuplicates: true })
        .select("task_id"),
    `fw progress-seed upsert (${input.profileId})`
  );
  if (inserted.error) {
    console.error(`[fw/progress-seed] progress upsert failed for ${input.profileId}: ${inserted.error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  // Deliberately NO events. The Path's materializer records `unlock` events for
  // the rows it promoted; FW promotes nothing, so the event log stays empty until
  // a guide's first tap — which is what makes the board's "opens at zero on
  // Friday" honest (Decision 16).
  return { ok: true, created: (inserted.data ?? []).length };
}

export type ProvisionFwStudentInput = {
  firstName: string;
  lastName: string;
  band: Band;
  /** Must be a `kind='fw'` cohort — verified here, not assumed. */
  cohortId: string;
  /**
   * Decision 13: the adult who attested the family has seen the program notice.
   * Persisted on the profile, not merely a form gate. Null for paths that have
   * not attested yet (the PROPOSED-3 importer stamps it when its notice sequence
   * completes).
   */
  noticeAttestedBy?: string | null;
  /**
   * Repair / resume: complete an EXISTING profile's remaining legs instead of
   * minting a new account. The caller decides identity — same-name dedupe is the
   * importer's resume keying (Unit 7) and cross-cohort matching is PROPOSED-1's
   * `fw-match-rules` (Unit 4); this core carries no matching policy, so it can
   * never silently merge two different children who share a name.
   */
  existingProfileId?: string | null;
};

export type ProvisionFwStudentFailure =
  /** The name folds to nothing address-safe, or carries homoglyphs/control
   *  characters — refuse rather than mint a near-miss address. */
  | "invalid_name"
  | "cohort_not_found"
  | "cohort_not_fw"
  | "no_current_program_version"
  | "profile_not_found"
  /** Resume target is not an FW-shaped profile (has a child, or has no band) —
   *  almost certainly a caller-side identity-resolution bug. */
  | "not_fw_profile"
  /** Resume target exists and is FW-shaped, but is a DIFFERENT student than the
   *  name submitted. The guard against silently completing the wrong child. */
  | "identity_mismatch"
  /** Resume target's auth account no longer exists. */
  | "account_missing"
  | "address_exhausted"
  /** Account + profile landed; the cohort membership did not. Retry in place. */
  | "membership_failed"
  /** Account + profile + membership landed; the 125 rows did not. Retry in place. */
  | "materialization_failed"
  | "unavailable";

export type ProvisionFwStudentResult =
  | {
      ok: true;
      profileId: string;
      userId: string;
      email: string;
      /**
       * True when this call COMPLETED an already-existing account rather than minting a
       * fresh one — set by the explicit resume path (`existingProfileId`), by adopting a
       * stranded account, AND by the post-write-verify adopting our own timed-out-but-
       * landed profile. It is an "existing, not freshly minted" signal, not a specific
       * provenance — nothing branches on WHICH of those it was, so no consumer may infer
       * "explicit resume" from it. If a future surface needs that distinction, add a
       * separate discriminant rather than overloading this flag.
       */
      adopted: boolean;
    }
  | {
      ok: false;
      reason: ProvisionFwStudentFailure;
      /** Present once a profile exists — the handle a retry-in-place passes back
       *  as `existingProfileId` so the guide never lands in a tap-dead tree. */
      profileId?: string;
    };

/**
 * Mint (or complete) one dormant FW student account: auth user → private family →
 * profile → cohort membership → 125 locked progress rows.
 *
 * COMPENSABLE, per docs/solutions/best-practices/no-transaction-multi-step-write-
 * compensation-post-write-verify-cas-scoped-claim-2026-07-22.md — there is no
 * transaction spanning the Auth API and PostgREST, so a failure between them is
 * cleaned up explicitly:
 *   - profile insert REPORTS failure → POST-WRITE VERIFY first (Unit 9): a timed-out
 *     write may still have landed, so probe for a profile on this user_id before
 *     compensating; adopt it if it landed, and only best-effort delete the just-
 *     created auth user and family row when it truly did not — leaving nothing
 *     half-minted for the next run to trip over (and no orphan account holding a
 *     name-derived address hostage), and never destroying a profile that committed;
 *   - membership or materialization fails → the profile is KEPT and its id is
 *     returned with the failure, because those legs are idempotent and a
 *     retry-in-place completes them (Decision 13). Deleting here would throw away
 *     a good account in front of a kid standing at the table.
 *
 * Every PostgREST read and write in the chain is routed through `fwRead`/`fwWrite`
 * (Unit 9): the mint chain predated that timeout guard, so on venue wifi a stalled
 * call left a ~90-account import hanging with none of the compensation branches
 * reached. A bounded timeout converts the stall into a typed failure the caller
 * already handles (the Auth admin calls keep their own error handling).
 *
 * Address collisions resolve in two layers: the released-alias ledger is probed
 * up front (Decision 10 — a freed address is never re-minted), and `email_exists`
 * from `createUser` drives the retry loop. The second layer is what actually
 * probes LIVE accounts: it is authoritative, race-proof, and costs one extra API
 * call per genuine collision, where a listUsers page-walk would cost a full scan
 * per imported row.
 */
export async function provisionFwStudent(
  db: SupabaseClient,
  input: ProvisionFwStudentInput
): Promise<ProvisionFwStudentResult> {
  const { firstName, lastName, band, cohortId } = input;
  const attestedBy = input.noticeAttestedBy ?? null;

  // The cohort must exist AND be an FW cohort. Minting an FW-shaped student into
  // a Path cohort would put a child-less profile in front of Path reads that
  // assume a roster row.
  const cohort = await fwRead(
    () => db.from("path_cohorts").select("id, kind").eq("id", cohortId).maybeSingle(),
    `fw cohort load (${cohortId})`
  );
  if (cohort.error) {
    console.error(`[fw/provision] cohort load failed for ${cohortId}: ${cohort.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if (!cohort.data) return { ok: false, reason: "cohort_not_found" };
  if (cohort.data.kind !== "fw") return { ok: false, reason: "cohort_not_fw" };

  let profileId: string;
  let userId: string;
  let email: string;
  let adopted = false;
  let createdFamilyId: string | null = null;

  if (input.existingProfileId) {
    // ── Resume path: the account exists; finish its remaining legs. ──
    //
    // The caller decides identity (importer resume keying, PROPOSED-1 matching),
    // but "the caller decides" is not "the caller is trusted". Everything below
    // re-derives from the authoritative row, because the very next statement
    // writes a cohort membership — and a membership written for the wrong
    // profile enrolls a real child in a weekend they are not at, with nothing
    // downstream that would notice.
    const existing = await fwRead(
      () =>
        db
          .from("path_student_profiles")
          .select("id, user_id, child_id, first_name, last_name, band")
          .eq("id", input.existingProfileId)
          .maybeSingle(),
      `fw resume profile load (${input.existingProfileId})`
    );
    if (existing.error) {
      console.error(
        `[fw/provision] resume profile load failed for ${input.existingProfileId}: ${existing.error.message}`
      );
      return { ok: false, reason: "unavailable" };
    }
    if (!existing.data) return { ok: false, reason: "profile_not_found" };

    // Fail-closed narrowing at the service-role boundary (the parseCandidateRow
    // discipline): `db` is untyped here, so an `as string` would be a promise to
    // the compiler with nothing behind it.
    const row = existing.data;
    if (typeof row.id !== "string" || typeof row.user_id !== "string") {
      console.error(`[fw/provision] resume profile ${input.existingProfileId} has a malformed id/user_id`);
      return { ok: false, reason: "unavailable" };
    }

    // Shape gate: this must be an FW-shaped profile. Without it, handing in a
    // PATH student's id silently enrolls that child in an FW cohort — and the
    // only thing that would eventually complain is ensureFwStudentProgress's
    // no_band refusal, which fires AFTER the membership row is already written
    // and is never compensated.
    if (row.child_id !== null || typeof row.band !== "string") {
      console.error(
        `[fw/provision] refusing to resume ${row.id}: not an FW-shaped profile (child_id set or band missing)`
      );
      return { ok: false, reason: "not_fw_profile", profileId: row.id };
    }

    // Identity gate: the name the caller submitted must be the name on the row.
    // A resume against a DIFFERENT FW student passes every check above (they are
    // FW-shaped and banded) and would otherwise return ok:true naming the wrong
    // child — the failure the shape gate cannot see.
    let submittedKey: string;
    try {
      submittedKey = buildNormalizedFwName(firstName, lastName);
    } catch {
      return { ok: false, reason: "invalid_name" };
    }
    const storedKey = buildNormalizedFwName(
      typeof row.first_name === "string" ? row.first_name : "",
      typeof row.last_name === "string" ? row.last_name : ""
    );
    if (storedKey !== submittedKey) {
      console.error(
        `[fw/provision] refusing to resume ${row.id}: submitted name does not match the stored profile`
      );
      return { ok: false, reason: "identity_mismatch", profileId: row.id };
    }

    // The account must still exist. The resume path never mints, so if the auth
    // user is gone (a compensation that half-ran, a manual deletion) every leg
    // below would "succeed" against a profile nobody can ever be.
    const account = await db.auth.admin.getUserById(row.user_id);
    if (account.error || !account.data?.user) {
      console.error(
        `[fw/provision] resume account ${row.user_id} missing for profile ${row.id}: ${account.error?.message ?? "no user"}`
      );
      return { ok: false, reason: "account_missing", profileId: row.id };
    }

    profileId = row.id;
    userId = row.user_id;
    // The REAL address, not a placeholder. An empty string here would be a lie in
    // the result type and would read as "cleared to send" to any caller that
    // passes it toward a mail-capable call.
    email = account.data.user.email ?? "";
    adopted = true;
  } else {
    // ── Mint path. ──
    let localBase: string;
    let normalizedName: string;
    try {
      localBase = buildFwLocalBase(firstName, lastName);
      normalizedName = buildNormalizedFwName(firstName, lastName);
    } catch {
      return { ok: false, reason: "invalid_name" };
    }

    // The D27 pin, resolved now and immutable after — no fallback, exactly as the
    // Path path: a silent fallback would pin a weekend's students to nothing.
    const version = await fwRead(
      () => db.from("path_program_versions").select("id").eq("is_current", true).maybeSingle(),
      "fw current program version"
    );
    if (version.error) {
      console.error(`[fw/provision] version load failed: ${version.error.message}`);
      return { ok: false, reason: "unavailable" };
    }
    const programVersionId = version.data?.id;
    if (typeof programVersionId !== "string") {
      return { ok: false, reason: "no_current_program_version" };
    }

    // Decision 10: every local part this name could produce that has ALREADY been
    // released by an anonymization is off the table permanently. `like base%`
    // over-matches (it also catches unrelated longer names), which is harmless —
    // the only candidates ever generated are base, base2, base3…
    const released = await fwRead(
      () => db.from("path_fw_released_aliases").select("local_part").like("local_part", `${localBase}%`),
      `fw released-alias probe (${localBase})`
    );
    if (released.error) {
      console.error(`[fw/provision] released-alias probe failed for ${localBase}: ${released.error.message}`);
      return { ok: false, reason: "unavailable" };
    }
    // Fail CLOSED on a malformed ledger row. Dropping it would be fail-OPEN with
    // respect to the one invariant this table exists to hold: a dropped row is a
    // released address that stops counting as taken and can be re-minted.
    const releasedParts = (released.data ?? []).map((r) => r.local_part);
    if (releasedParts.some((p) => typeof p !== "string")) {
      console.error(`[fw/provision] released-alias ledger returned a malformed local_part for ${localBase}`);
      return { ok: false, reason: "unavailable" };
    }
    const taken = new Set<string>(releasedParts as string[]);

    let user: User | null = null;
    let pick: FwLocalPartPick;
    try {
      pick = pickFwLocalPart({ firstName, lastName, taken });
    } catch {
      // Reachable when the ledger alone already holds every candidate for this
      // name. Wrapped for the same reason the re-picks below are: every way this
      // function can fail must arrive as a typed reason, never as a throw.
      return { ok: false, reason: "address_exhausted" };
    }

    for (let attempt = 0; attempt < MAX_FW_LOCAL_ATTEMPTS; attempt += 1) {
      const created = await db.auth.admin.createUser(
        buildFwStudentCreateUserPayload({ email: pick.email })
      );
      if (!created.error && created.data?.user) {
        user = created.data.user;
        break;
      }

      // ANY failure here — a real collision, a venue-wifi timeout, or a response
      // we cannot read — is ambiguous about what landed server-side, so we ask
      // the server instead of guessing. This is the Path sibling's repair
      // discipline (see provisionStudent step 8), and skipping it is how the
      // clean address gets burned: a createUser that timed out AFTER Supabase
      // committed leaves an orphan at `maya.chen.fw@`, and a naive retry reads
      // it as "taken by someone else" and permanently shifts the real Maya to
      // `maya.chen2` with no record of why.
      const claim = await classifyFwAddress(db, pick.email);
      if (claim.kind === "stranded") {
        // Ours (or an earlier failed run's) — an FW student account with no
        // profile behind it. Adopt rather than step past.
        console.warn(`[fw/provision] adopting stranded FW account for ${pick.email}`);
        user = claim.user;
        break;
      }
      if (claim.kind === "claimed") {
        // A real, fully-provisioned student holds it. Step to the next integer.
        taken.add(pick.localPart);
        try {
          pick = pickFwLocalPart({ firstName, lastName, taken });
        } catch {
          return { ok: false, reason: "address_exhausted" };
        }
        continue;
      }
      // `absent` (nothing exists at that address) or `unknown` (we could not
      // find out). Either way this was a genuine failure, not a collision —
      // report it rather than minting a suffixed address the guide never asked
      // for. Nothing was created, so there is nothing to compensate.
      console.error(
        `[fw/provision] createUser failed for ${pick.email} (cohort ${cohortId}): ${created.error?.message ?? "no user returned"}`
      );
      return { ok: false, reason: "unavailable" };
    }
    if (!user) return { ok: false, reason: "address_exhausted" };
    userId = user.id;
    email = user.email ?? pick.email;

    // The private single-student family. path_student_profiles.family_id stays
    // NOT NULL (see the migration's group-1 note): an FW student has no family
    // YET, and a synthetic invisible one beats loosening a column ~12 Path reads
    // assume. No parent grant ever points here, so nothing can read across it.
    const family = await fwWrite(
      () => db.from("path_families").insert({}).select("id").single(),
      `fw family insert (${email})`
    );
    if (family.error || typeof family.data?.id !== "string") {
      // Identify the row: during a 90-student import this line firing on row 47
      // is otherwise byte-identical to it firing on row 1.
      console.error(
        `[fw/provision] family insert failed for ${email} (cohort ${cohortId}): ${family.error?.message ?? "no id"}`
      );
      // ACCEPTED, DOCUMENTED LEAK (reliability review): a family insert that TIMED OUT but
      // actually committed cannot be cleaned up here — `family.data` is null, so we have no
      // id to delete, and an empty `path_families` row carries no lookup key of its own. We
      // pass `familyId: null` (compensation deletes only the auth user). The orphan is one
      // empty, unreferenced family row: nothing FKs to it, nothing renders it, so it is inert
      // — a resource-hygiene leak, not corruption. Adding a post-write verify here would need
      // a marker column on the payload (a schema change out of Unit 9's scope); the leak is
      // accepted instead.
      await compensateFwMint(db, { userId, familyId: null });
      return { ok: false, reason: "unavailable" };
    }
    createdFamilyId = family.data.id;

    const inserted = await fwWrite(
      () =>
        db
          .from("path_student_profiles")
          .insert({
            user_id: userId,
            child_id: null,
            program_version_id: programVersionId,
            family_id: createdFamilyId,
            cohort_id: null, // FW membership lives in path_cohort_members, not here
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            band,
            normalized_name: normalizedName,
            notice_attested_at: attestedBy ? new Date().toISOString() : null,
            notice_attested_by: attestedBy,
          })
          .select("id")
          .single(),
      `fw profile insert (${email})`
    );
    if (inserted.error || typeof inserted.data?.id !== "string") {
      // A UNIQUE VIOLATION (23505) is NOT our own timed-out write — it means a DIFFERENT
      // profile already holds this user_id: a concurrent same-name mint that adopted this
      // account as "stranded" (adversarial review AR-1), or a stranded account's original
      // owner committing its profile between our adopt and our insert. Adopting a stranger's
      // profile there would silently MERGE two identities and report a false success, so a
      // 23505 must NEVER take the post-write-verify adopt path — it compensates our own
      // just-created family (the shared account's delete is correctly RESTRICT-blocked) and
      // returns unavailable, letting the caller's PROPOSED-1 match / retry flow resolve the
      // identity. Only our own AMBIGUOUS write (a timeout/throw, which carries no 23505 code)
      // may have landed and is worth verifying.
      if (isUniqueViolation(inserted.error)) {
        console.error(
          `[fw/provision] profile insert hit a unique violation for ${email} — a concurrent mint holds this user_id; NOT adopting a possibly-different child's profile`
        );
        await compensateFwMint(db, { userId, familyId: createdFamilyId });
        return { ok: false, reason: "unavailable" };
      }

      // POST-WRITE VERIFY before compensating (Unit 9 hardening). A timed-out write MAY have
      // landed — `fwWrite`'s stated contract — and compensating (deleting the auth user +
      // family) UNDER a profile row that actually committed would either orphan it or
      // cascade-destroy a real student. THREE-WAY on the verify read, because a read that
      // itself timed out is "we don't know", NOT "confirmed absent": adopt a definitely-
      // present row, compensate a definitely-absent one, and on an AMBIGUOUS verify leave the
      // account intact for a retry/match to resolve rather than deleting a possibly-live
      // profile. Same posture as docs/solutions/best-practices/no-transaction-multi-step-
      // write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md.
      const landed = await fwRead(
        () => db.from("path_student_profiles").select("id").eq("user_id", userId).maybeSingle(),
        `fw profile post-write verify (${email})`
      );
      if (!landed.error && typeof landed.data?.id === "string") {
        // Definitely landed → adopt our own committed write.
        console.warn(
          `[fw/provision] profile insert for ${email} reported failure but a row landed — adopting it rather than compensating`
        );
        profileId = landed.data.id;
        adopted = true;
      } else if (landed.error) {
        // AMBIGUOUS — the verify read itself failed/timed out. Do NOT compensate: the profile
        // may have landed, and deleting a possibly-live account is the wrong disposition (the
        // RESTRICT FKs would block it, but the false report would still stand). Leave the
        // account + family; a retry adopts the stranded account (if truly absent) or the
        // match/link path finds the landed profile by normalized_name (if present).
        console.error(
          `[fw/provision] profile insert AND its post-write verify both failed for ${email}: ${inserted.error?.message ?? "no id"} / ${landed.error.message} — leaving the account for a retry to resolve`
        );
        return { ok: false, reason: "unavailable" };
      } else {
        // Definitely absent — the verify read succeeded and found no row: the insert truly
        // failed. Compensate.
        console.error(
          `[fw/provision] profile insert failed for ${email}: ${inserted.error?.message ?? "no id"}`
        );
        await compensateFwMint(db, { userId, familyId: createdFamilyId });
        return { ok: false, reason: "unavailable" };
      }
    } else {
      profileId = inserted.data.id;
    }
  }

  // Membership — the row Decision 3's cohort-stamp verification reads as
  // authoritative. Upsert so a resume run is a no-op rather than a duplicate.
  const membership = await fwWrite(
    () =>
      db.from("path_cohort_members").upsert({ student_id: profileId, cohort_id: cohortId }, {
        onConflict: "student_id,cohort_id",
        ignoreDuplicates: true,
      }),
    `fw membership upsert (${profileId}/${cohortId})`
  );
  if (membership.error) {
    console.error(
      `[fw/provision] membership upsert failed for ${profileId}/${cohortId}: ${membership.error.message}`
    );
    return { ok: false, reason: "membership_failed", profileId };
  }

  const progress = await ensureFwStudentProgress(db, { profileId });
  if (!progress.ok) {
    console.error(`[fw/provision] materialization failed for ${profileId}: ${progress.reason}`);
    return { ok: false, reason: "materialization_failed", profileId };
  }

  return { ok: true, profileId, userId, email, adopted };
}

/**
 * What is actually sitting at an FW address, asked of the server rather than
 * inferred from a `createUser` error string.
 *
 *   stranded — an FW student account with NO profile row behind it. Either this
 *              call's own timed-out mint, or an earlier run whose compensation
 *              did not complete. Safe (and necessary) to adopt: leaving it would
 *              burn the clean, name-derived address for the child it was typed
 *              for, and FW-D2 makes that address a lasting contact channel.
 *   claimed  — a fully-provisioned student holds it, OR the account is not an
 *              FW student account at all (never adopt one of those — the Path
 *              repair path's same defense-in-depth rule). Step to the next
 *              integer.
 *   absent   — nothing is there, so the failure was real, not a collision.
 *   unknown  — we could not find out; treated as `absent` by the caller, which
 *              fails the row rather than minting a suffix nobody asked for.
 */
type FwAddressClaim =
  | { kind: "stranded"; user: User }
  | { kind: "claimed" }
  | { kind: "absent" }
  | { kind: "unknown" };

async function classifyFwAddress(db: SupabaseClient, email: string): Promise<FwAddressClaim> {
  const found = await findAuthUserByEmail(db, email);
  if (!found) return { kind: "absent" };

  // Never adopt an account this system did not mint as an FW student.
  if (found.app_metadata?.role !== "student" || !isFwStudentAddress(found.email ?? "")) {
    return { kind: "claimed" };
  }

  const profile = await fwRead(
    () => db.from("path_student_profiles").select("id").eq("user_id", found.id).maybeSingle(),
    `fw claim probe (${email})`
  );
  if (profile.error) {
    console.error(`[fw/provision] claim probe failed for ${email}: ${profile.error.message}`);
    return { kind: "unknown" };
  }
  return profile.data ? { kind: "claimed" } : { kind: "stranded", user: found };
}

/**
 * Best-effort rollback of a half-minted FW account. Failures are logged and
 * swallowed: the caller is already returning an error, and a compensation that
 * throws would replace an actionable failure with an opaque one. What is left
 * behind if this fails is an orphan auth user — which is recoverable rather
 * than permanent, because `classifyFwAddress` adopts exactly that shape on the
 * next attempt for the same name instead of stepping past it.
 */
async function compensateFwMint(
  db: SupabaseClient,
  input: { userId: string; familyId: string | null }
): Promise<void> {
  const deleted = await db.auth.admin.deleteUser(input.userId);
  if (deleted.error) {
    console.error(`[fw/provision] compensation deleteUser failed for ${input.userId}: ${deleted.error.message}`);
  }
  // Bind to a local so the closure passed to fwWrite narrows to `string` without a
  // non-null assertion (the repo's typeof-not-`as` posture — TS drops property-access
  // narrowing across the function boundary).
  const familyId = input.familyId;
  if (familyId) {
    const fam = await fwWrite(
      () => db.from("path_families").delete().eq("id", familyId),
      `fw compensation family delete (${familyId})`
    );
    if (fam.error) {
      console.error(
        `[fw/provision] compensation family delete failed for ${familyId}: ${fam.error.message}`
      );
    }
  }
}
