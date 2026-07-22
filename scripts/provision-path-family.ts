/**
 * Provision a Path TEST family end to end (T1 Unit 6).
 *
 *   npm run seed:path-family
 *
 * Machine-bound like scripts/seed-staff.ts (.env.local carries the service-role
 * key; env-less machines and worktree agents cannot run it). This is how the
 * consenting test families the T1 exit check names actually get into /path
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
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { findAuthUserByEmail, provisionStudent } from "@/app/path/lib/provision-core";

const PARENT_EMAIL = "path-test-parent@test.the120.invalid";
const PARENT_NAME = { first_name: "Path", last_name: "Testparent" };
const TEST_CHILDREN = [
  { first_name: "Maya", last_name: "Pathtest", grade: 4 },
  { first_name: "Dev", last_name: "Pathtest", grade: 7 },
] as const;

const PASSWORD_FILE = path.resolve(process.cwd(), "scripts/.path-passwords.local.txt");

/** Minimal .env.local parser (values may be quoted); env vars win. */
function loadEnv(): { url: string; serviceRoleKey: string } {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY (environment or .env.local)."
    );
    process.exit(1);
  }
  return { url, serviceRoleKey };
}

function generatedPassword(): string {
  return randomBytes(12).toString("base64url"); // 16 chars, clears the R29 floor
}

function recordPassword(label: string, password: string): void {
  appendFileSync(PASSWORD_FILE, `${new Date().toISOString()} ${label} ${password}\n`, {
    mode: 0o600,
  });
}

async function main() {
  const { url, serviceRoleKey } = loadEnv();
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
  const childIds: { first_name: string; id: string }[] = [];
  for (const child of TEST_CHILDREN) {
    const existing = await db
      .from("children")
      .select("id")
      .eq("parent_id", parent.id)
      .eq("first_name", child.first_name)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      childIds.push({ first_name: child.first_name, id: existing.data.id as string });
      continue;
    }
    const inserted = await db
      .from("children")
      .insert({ parent_id: parent.id, ...child })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    childIds.push({ first_name: child.first_name, id: inserted.data.id as string });
  }

  // 4. Path family — adopt the one the parent's grant already points at, else create.
  let familyId: string;
  const grant = await db
    .from("path_role_grants")
    .select("scope_id")
    .eq("user_id", parent.id)
    .eq("role", "parent")
    .eq("scope_type", "family")
    .maybeSingle();
  if (grant.error) throw grant.error;
  if (grant.data) {
    familyId = grant.data.scope_id as string;
  } else {
    const fam = await db.from("path_families").insert({}).select("id").single();
    if (fam.error) throw fam.error;
    familyId = fam.data.id as string;
    const grantIns = await db.from("path_role_grants").upsert(
      { user_id: parent.id, role: "parent", scope_type: "family", scope_id: familyId },
      { onConflict: "user_id,role,scope_type,scope_id", ignoreDuplicates: true }
    );
    if (grantIns.error) throw grantIns.error;
  }

  // 5. Students, through the SHARED core.
  for (const child of childIds) {
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

  console.log(
    `Done. Path family ${familyId} ready — sign in at /path/sign-in with a student first name + the password from scripts/.path-passwords.local.txt.`
  );
}

main().catch((err) => {
  console.error("[provision-path-family] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
