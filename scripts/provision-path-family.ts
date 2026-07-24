/**
 * Provision a Path TEST family end to end (T1 Unit 6).
 *
 *   npm run seed:path-family
 *
 * Machine-bound like scripts/seed-staff.ts (.env.local carries the service-role
 * key; env-less machines and worktree agents cannot run it). This is how the
 * consenting test families the T1 exit check names actually get into /fp
 * until Unit 15 builds the parent-facing onboarding — and it is the manual
 * verification harness for this unit (two students → the R3 two-browser test).
 *
 * What one run ensures (idempotent — re-runs adopt existing rows, never
 * duplicate; passwords are never reset once set, except by the repair path
 * inside the shared core):
 *   1. a parent auth user on a non-deliverable .invalid address
 *      (email_confirm: true — hosted confirmations are ON; config.toml lies),
 *   2. its public.parents row — this TRIPS on_parent_created (a CRM families
 *      row is auto-created), which is expected: the script then stamps that
 *      derived family is_test = true so it stays out of GTM metrics,
 *   3. two public.children roster rows (Maya grade 4, Dev grade 7),
 *   4. a path_families row + the parent's parent/family role grant,
 *   5. a student account per child via the SHARED provisioning core — the
 *      exact code path the parent action uses (email derivation, D27 version
 *      pin, R29 floor, two-grant pair, email_confirm handling).
 *
 * Generated passwords land in scripts/.path-passwords.local.txt (gitignored,
 * 0600) — NEVER stdout. casl_consent stays false so no CRM email path ever
 * targets the fake address.
 */

import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  ensurePathFamilyForParent,
  ensureStudentProgress,
  findAuthUserByEmail,
  provisionStudent,
} from "@/app/fp/lib/provision-core";
import { loadSupabaseEnv } from "./load-env";

const PARENT_EMAIL = "path-test-parent@test.the120.invalid";
const PARENT_NAME = { first_name: "Path", last_name: "Testparent" };
const TEST_CHILDREN = [
  { first_name: "Maya", last_name: "Pathtest", grade: 4, rosterOnly: false },
  { first_name: "Dev", last_name: "Pathtest", grade: 7, rosterOnly: false },
  // Roster-only rows for Unit 15's onboarding verification: Kai is the linkable
  // founder the browser pass provisions end-to-end (g9_12 band card); Nia is the
  // null-grade CRM draft the link path must refuse with a specific message.
  { first_name: "Kai", last_name: "Pathtest", grade: 9, rosterOnly: true },
  { first_name: "Nia", last_name: "Pathtest", grade: null, rosterOnly: true },
] as const;

const PASSWORD_FILE = path.resolve(process.cwd(), "scripts/.path-passwords.local.txt");

function generatedPassword(): string {
  return randomBytes(12).toString("base64url"); // 16 chars, clears the R29 floor
}

function recordPassword(label: string, password: string): void {
  appendFileSync(PASSWORD_FILE, `${new Date().toISOString()} ${label} ${password}\n`, {
    mode: 0o600,
  });
}

async function main() {
  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Parent auth user.
  let parent = await findAuthUserByEmail(db, PARENT_EMAIL);
  if (!parent) {
    const password = generatedPassword();
    const { data, error } = await db.auth.admin.createUser({
      email: PARENT_EMAIL,
      password,
      email_confirm: true, // hosted confirmations are ON; the address is non-deliverable
    });
    if (error || !data.user) throw error ?? new Error("createUser returned no parent user");
    parent = data.user;
    recordPassword(`parent ${PARENT_EMAIL}`, password);
    console.log("parent auth user created — password written to scripts/.path-passwords.local.txt");
  } else {
    console.log("parent auth user already exists — password unchanged");
  }

  // 2. parents row (trips on_parent_created → derived CRM families row).
  const parentRow = await db
    .from("parents")
    .upsert(
      { id: parent.id, email: PARENT_EMAIL, ...PARENT_NAME, casl_consent: false },
      { onConflict: "id" }
    );
  if (parentRow.error) throw parentRow.error;

  // Keep the derived CRM family out of GTM metrics.
  const stamped = await db
    .from("families")
    .update({ is_test: true })
    .eq("parent_id", parent.id)
    .select("id");
  if (stamped.error) throw stamped.error;
  if ((stamped.data ?? []).length === 0) {
    console.warn("WARNING: no derived CRM families row found to stamp is_test — check on_parent_created.");
  }

  // 3. Roster children.
  const childIds: { first_name: string; id: string; rosterOnly: boolean }[] = [];
  for (const child of TEST_CHILDREN) {
    const { rosterOnly, ...row } = child;
    const existing = await db
      .from("children")
      .select("id")
      .eq("parent_id", parent.id)
      .eq("first_name", row.first_name)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      childIds.push({ first_name: row.first_name, id: existing.data.id as string, rosterOnly });
      continue;
    }
    const inserted = await db
      .from("children")
      .insert({ parent_id: parent.id, ...row })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    childIds.push({ first_name: row.first_name, id: inserted.data.id as string, rosterOnly });
  }

  // 4. Path family — the shared R31 linkage helper (adopt-by-grant, else create;
  // the same code path the staff backfill script runs).
  const familyRes = await ensurePathFamilyForParent(db, { userId: parent.id });
  if (!familyRes.ok) throw new Error(`path family linkage failed: ${familyRes.reason}`);
  const familyId = familyRes.familyId;

  // 5. Students, through the SHARED core. Roster-only children stay unprovisioned
  // on purpose — they are Unit 15's onboarding fixtures (linkable / needs-grade).
  for (const child of childIds) {
    if (child.rosterOnly) {
      console.log(`${child.first_name}: roster-only fixture — left unprovisioned.`);
      continue;
    }
    const password = generatedPassword();
    const result = await provisionStudent(db, { childId: child.id, familyId, password });
    if (result.ok) {
      recordPassword(`student ${child.first_name}`, password);
      console.log(
        `${child.first_name}: provisioned (${result.repaired ? "repaired" : "fresh"}) — profile ${result.profileId}; password written to file.`
      );
    } else if (result.reason === "already_provisioned") {
      console.log(`${child.first_name}: already provisioned — untouched.`);
    } else {
      throw new Error(
        `${child.first_name}: provisioning failed — ${result.reason}${
          "message" in result ? `: ${result.message}` : ""
        }`
      );
    }
  }

  // 6. Backfill progress rows for EVERY student in the family (Unit 14) — the
  // provisioning core now materializes them for fresh students, but students
  // provisioned before Unit 14 (this very test family) have none, and without
  // them no transition can ever apply. Idempotent: inserts only missing rows.
  const profiles = await db.from("path_student_profiles").select("id").eq("family_id", familyId);
  if (profiles.error) throw profiles.error;
  for (const profile of profiles.data ?? []) {
    const ensured = await ensureStudentProgress(db, { profileId: profile.id as string });
    if (!ensured.ok) {
      throw new Error(`progress materialization failed for profile ${profile.id}: ${ensured.reason}`);
    }
    console.log(
      `profile ${profile.id}: progress rows ensured (${ensured.created} created${
        ensured.created === 0 ? " — already materialized" : ""
      }).`
    );
  }

  console.log(
    `Done. Path family ${familyId} ready — sign in at /fp/sign-in with a student first name + the password from scripts/.path-passwords.local.txt.`
  );
}

main().catch((err) => {
  console.error("[provision-path-family] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
