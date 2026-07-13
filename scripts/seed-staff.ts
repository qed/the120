/**
 * Seed the two CRM staff accounts (plan Unit 2; brief §3).
 *
 *   npm run seed:staff
 *
 * For peter@the120.school and ethan@the120.school:
 *   1. create-or-fetch the auth user (createUser with a generated strong
 *      password + email_confirm: true — confirmations are OFF and Ethan's
 *      mailbox doesn't exist yet, so never an invite flow),
 *   2. set app_metadata.role = 'admin' (server-set → lands in the JWT),
 *   3. upsert the staff row.
 *
 * Idempotent: a second run is a no-op — existing users are fetched, never
 * recreated, and passwords are never reset. Generated passwords are written
 * to scripts/.staff-passwords.local.txt (gitignored) — NEVER stdout.
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL from the
 * environment, falling back to .env.local.
 */

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const STAFF_EMAILS = ["peter@the120.school", "ethan@the120.school"] as const;

const PASSWORD_FILE = path.resolve(process.cwd(), "scripts/.staff-passwords.local.txt");

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

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < perPage) return null;
  }
}

async function main() {
  const { url, serviceRoleKey } = loadEnv();
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const email of STAFF_EMAILS) {
    let user = await findUserByEmail(admin, email);
    let created = false;

    if (!user) {
      const password = randomBytes(24).toString("base64url");
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: "admin" },
      });
      if (error || !data.user) {
        throw error ?? new Error(`createUser returned no user for ${email}`);
      }
      user = data.user;
      created = true;
      // Never stdout — rotate on first login, hand over out-of-band.
      appendFileSync(PASSWORD_FILE, `${new Date().toISOString()} ${email} ${password}\n`, {
        mode: 0o600,
      });
    }

    if (user.app_metadata?.role !== "admin") {
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        app_metadata: { ...user.app_metadata, role: "admin" },
      });
      if (error) throw error;
    }

    const { error: staffError } = await admin
      .from("staff")
      .upsert({ id: user.id, email, role: "admin", is_active: true }, { onConflict: "id" });
    if (staffError) throw staffError;

    console.log(
      `${email}: ${
        created
          ? "auth user created — password written to scripts/.staff-passwords.local.txt"
          : "auth user already exists — password unchanged"
      }; admin claim ensured; staff row upserted.`
    );
  }

  console.log("Done. Seed is idempotent — a second run changes nothing.");
}

main().catch((err) => {
  console.error("[seed-staff] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
