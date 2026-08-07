/**
 * Provision ONE First Profit (fpv2) family end to end so the child can LOG IN and
 * PLAY at firstprofit.school — a confirmed parent + a confirmed child with an
 * fp_username + password.
 *
 *   PARENT_PASSWORD='...' CHILD_PASSWORD='...' npx tsx scripts/provision-fp-family.ts
 *
 * WHO gets provisioned is env-overridable (PARENT_EMAIL, PARENT_FIRST_NAME,
 * PARENT_LAST_NAME, CHILD_FIRST_NAME, FP_USERNAME), defaulting to the original
 * Cedric family below — so a second demo family does not require editing and
 * re-committing this file. FP_USERNAME may be EMAIL-SHAPED
 * (e.g. `ethan@firstprofit.school`): it is an OPAQUE login handle, never a
 * mailbox. It is validated with the login door's own `classifyIdentifier`, so
 * this script cannot claim a username that /api/fp/login would then refuse.
 *
 * Unlike scripts/provision-path-family.ts (which provisions the OLD /fp Path
 * student that signs in by first name), this composes the SAME primitives the FP
 * signup child flow (app/api/fp/signup/child-core.ts) uses, so the child is
 * loginable at the cross-origin FP login (/api/fp/login) by USERNAME:
 *   parent auth user (email_confirm) -> parents row (trips on_parent_created ->
 *   CRM family, stamped is_test) -> path family -> children row -> fp_username
 *   (service-role write) -> child auth user on the derived .invalid address
 *   carrying the parent-set password -> path_student_profiles (child->user) ->
 *   fp_player_profiles + seeded save.
 *
 * Idempotent: re-runs adopt existing rows and never reset a password. Machine-
 * bound like the sibling seed scripts (.env.local carries the service-role key).
 * Passwords are read from env and NEVER printed.
 */

import { createClient, type User } from "@supabase/supabase-js";

import { deriveStudentEmail, validateStudentPassword } from "@/app/lib/fp/provision-rules";
import { ensurePathFamilyForParent, findAuthUserByEmail } from "@/app/lib/fp/provision-core";
import { ensurePlayerProfile } from "@/app/api/fp/login/profile-core";
import { classifyIdentifier } from "@/app/api/fp/login/login-rules";
import { APPLICANT_ENTRY_STATE } from "@/app/lib/funnel/applicant-rules";
import { loadSupabaseEnv } from "./load-env";

// --- What we provision (env-overridable; defaults = the original family) -----
const PARENT_EMAIL = process.env.PARENT_EMAIL ?? "pkuperman@gmail.com";
const PARENT_NAME = {
  first_name: process.env.PARENT_FIRST_NAME ?? "Caradoc",
  last_name: process.env.PARENT_LAST_NAME ?? "Kuperman",
};
const CHILD_FIRST_NAME = process.env.CHILD_FIRST_NAME ?? "Cedric";
// Opaque lowercase login handle. May be email-shaped — validated below against
// children_fp_username_format's twin, the login door's USERNAME_FORMAT.
const FP_USERNAME = (process.env.FP_USERNAME ?? "cedrick").toLowerCase();
// -----------------------------------------------------------------------------

const PARENT_PASSWORD = process.env.PARENT_PASSWORD;
const CHILD_PASSWORD = process.env.CHILD_PASSWORD;

function requireEnv(name: string, v: string | undefined): string {
  if (!v || v.length === 0) {
    throw new Error(`${name} env var is required (never hardcode a password in the script).`);
  }
  return v;
}

async function main() {
  const parentPassword = requireEnv("PARENT_PASSWORD", PARENT_PASSWORD);
  const childPassword = requireEnv("CHILD_PASSWORD", CHILD_PASSWORD);

  // Validate with the LOGIN DOOR's own classifier rather than a restated regex:
  // the generator/CHECK/regex charset-agreement invariant means a handle this
  // script can claim must be one /api/fp/login can resolve. A local
  // `^[a-z0-9]+$` copy was the pre-email-shaped subset and would reject a
  // perfectly valid `name@firstprofit.school`.
  const handle = classifyIdentifier(FP_USERNAME);
  if (handle.kind !== "username" || handle.normalized !== FP_USERNAME) {
    throw new Error(
      `fp_username "${FP_USERNAME}" is not a valid login handle (must be lowercase, start and end alphanumeric, interior [a-z0-9._+@-] only, <= 80 chars).`
    );
  }
  // The child password must clear the same R29 floor the app enforces.
  const pw = validateStudentPassword(childPassword, { studentName: CHILD_FIRST_NAME });
  if (!pw.ok) throw new Error(`CHILD_PASSWORD rejected by validateStudentPassword: ${pw.error}`);

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Parent auth user (confirmed). email_confirm:true => already confirmed, no
  //    confirmation email is sent to the real address.
  let parent: User | null = await findAuthUserByEmail(db, PARENT_EMAIL);
  if (!parent) {
    const created = await db.auth.admin.createUser({
      email: PARENT_EMAIL,
      password: parentPassword,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error("createUser returned no parent user");
    }
    parent = created.data.user;
    console.log(`parent created + confirmed: ${PARENT_EMAIL}`);
  } else {
    // ⚠ REFUSE TO CLOBBER A PRIVILEGED ACCOUNT. The update below RESETS the
    // password of whatever already sits on PARENT_EMAIL. That is fine for the
    // owner's own parent account (the original use), and catastrophic for a
    // staff/admin login: `app_metadata.role === "admin"` is the whole /crm +
    // /staff gate (app/lib/supabase/proxy-rules.ts), so a demo-grade parent
    // password would silently become an admin password. A student role is
    // refused for the same reason in the other direction — a child's auth user
    // must never also be a parent. Hit for real on 2026-08-07: the demo email
    // `ethan@the120.school` was already a live CRM admin.
    const existingRole = (parent.app_metadata as { role?: unknown } | null)?.role;
    if (typeof existingRole === "string" && existingRole !== "parent") {
      throw new Error(
        `${PARENT_EMAIL} already exists with app_metadata.role="${existingRole}" — refusing to reset its password or attach a parents row. Pick a different PARENT_EMAIL.`
      );
    }
    // Parent pre-exists: the caller explicitly wants a known parent password set,
    // so update it to PARENT_PASSWORD (this is the owner's own account).
    const upd = await db.auth.admin.updateUserById(parent.id, {
      password: parentPassword,
      email_confirm: true,
    });
    if (upd.error) throw upd.error;
    console.log(`parent already exists: ${PARENT_EMAIL} (password set to PARENT_PASSWORD)`);
  }
  const parentId = parent.id;

  // 2. parents row (trips on_parent_created -> a CRM families row).
  const upsertParent = await db
    .from("parents")
    .upsert({ id: parentId, email: PARENT_EMAIL, ...PARENT_NAME, casl_consent: false }, { onConflict: "id" });
  if (upsertParent.error) throw upsertParent.error;

  // Keep the derived CRM family out of GTM/CRM metrics (this is a provisioned
  // test family, not an organic lead).
  const stamped = await db.from("families").update({ is_test: true }).eq("parent_id", parentId).select("id");
  if (stamped.error) throw stamped.error;
  if ((stamped.data ?? []).length === 0) {
    console.warn("WARNING: no derived families row to stamp is_test — check on_parent_created.");
  }

  // 3. Path family linkage (family_id is NOT NULL on path_student_profiles).
  const fam = await ensurePathFamilyForParent(db, { userId: parentId });
  if (!fam.ok) throw new Error(`path family linkage failed: ${fam.reason}`);
  const familyId = fam.familyId;

  // 4. children row. Adopt an existing child that already carries this username,
  //    else adopt this parent's Cedric, else insert a fresh draft roster row.
  let childId: string;
  const byUsername = await db.from("children").select("id, parent_id").ilike("fp_username", FP_USERNAME).maybeSingle();
  if (byUsername.error) throw byUsername.error;
  if (byUsername.data) {
    if ((byUsername.data as { parent_id: string }).parent_id !== parentId) {
      throw new Error(`fp_username "${FP_USERNAME}" is already taken by a child of a DIFFERENT parent — aborting.`);
    }
    childId = String((byUsername.data as { id: string }).id);
    console.log(`adopting existing child with fp_username=${FP_USERNAME}`);
  } else {
    const existingChild = await db
      .from("children")
      .select("id")
      .eq("parent_id", parentId)
      .eq("first_name", CHILD_FIRST_NAME)
      .maybeSingle();
    if (existingChild.error) throw existingChild.error;
    if (existingChild.data) {
      childId = String((existingChild.data as { id: string }).id);
      console.log(`adopting existing child ${CHILD_FIRST_NAME} under this parent`);
    } else {
      const ins = await db
        .from("children")
        .insert({
          parent_id: parentId,
          first_name: CHILD_FIRST_NAME,
          grade: null,
          status: "draft",
          applicant_state: APPLICANT_ENTRY_STATE,
        })
        .select("id")
        .single();
      if (ins.error || !ins.data) throw ins.error ?? new Error("child insert returned no row");
      childId = String((ins.data as { id: string }).id);
      console.log(`child row created: ${CHILD_FIRST_NAME} (${childId})`);
    }
  }

  // 5. Claim fp_username via the SERVICE-ROLE client (the only principal the
  //    children_fp_username_guard trigger admits). Idempotent: skip if already set.
  const cur = await db.from("children").select("fp_username").eq("id", childId).single();
  if (cur.error) throw cur.error;
  if (!(cur.data as { fp_username: string | null }).fp_username) {
    const claim = await db.from("children").update({ fp_username: FP_USERNAME }).eq("id", childId).select("id").single();
    if (claim.error) {
      if ((claim.error as { code?: string }).code === "23505") {
        throw new Error(`fp_username "${FP_USERNAME}" collided (already claimed) — aborting.`);
      }
      throw claim.error;
    }
    console.log(`fp_username claimed: ${FP_USERNAME}`);
  } else {
    console.log(`fp_username already set to ${(cur.data as { fp_username: string }).fp_username}`);
  }

  // 6. Child auth account on the derived .invalid address, carrying the password.
  const studentEmail = deriveStudentEmail(childId);
  let childUser: User | null = await findAuthUserByEmail(db, studentEmail);
  if (!childUser) {
    const created = await db.auth.admin.createUser({
      email: studentEmail,
      password: childPassword,
      email_confirm: true,
      app_metadata: { role: "student" },
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error("createUser returned no child user");
    }
    childUser = created.data.user;
    console.log(`child auth account created (login password set)`);
  } else {
    console.log(`child auth account already exists (password unchanged)`);
  }
  const childUserId = childUser.id;

  // 7. path_student_profiles (child->user identity; precondition of the player
  //    profile). program_version_id = the current pinned Path version.
  const ver = await db.from("path_program_versions").select("id").eq("is_current", true).maybeSingle();
  if (ver.error || typeof (ver.data as { id?: unknown } | null)?.id !== "string") {
    throw new Error(`no current path_program_versions row: ${ver.error?.message ?? "is_current not found"}`);
  }
  const programVersionId = String((ver.data as { id: string }).id);

  const existingProfile = await db
    .from("path_student_profiles")
    .select("id")
    .eq("child_id", childId)
    .maybeSingle();
  if (existingProfile.error) throw existingProfile.error;
  if (!existingProfile.data) {
    const insProfile = await db
      .from("path_student_profiles")
      .insert({
        user_id: childUserId,
        child_id: childId,
        program_version_id: programVersionId,
        family_id: familyId,
        cohort_id: null,
      })
      .select("id")
      .single();
    if (insProfile.error || !insProfile.data) throw insProfile.error ?? new Error("path_student_profiles insert failed");
    console.log(`path_student_profiles created`);
  } else {
    console.log(`path_student_profiles already exists`);
  }

  // 8. FP player profile + seeded save (so the child can PLAY on first login).
  const player = await ensurePlayerProfile(db, { userId: childUserId, childId, firstName: CHILD_FIRST_NAME });
  if (!player.ok) throw new Error(`ensurePlayerProfile refused: ${player.reason}`);
  console.log(`fp_player_profile + save ready (profile ${player.profileId})`);

  console.log("");
  console.log("DONE. Child can log in at https://firstprofit.school");
  console.log(`  username: ${FP_USERNAME}`);
  console.log("  password: (the CHILD_PASSWORD you passed)");
  console.log(`  parent:   ${PARENT_EMAIL} (confirmed; PARENT_PASSWORD you passed)`);
}

main().catch((err) => {
  console.error("[provision-fp-family] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
