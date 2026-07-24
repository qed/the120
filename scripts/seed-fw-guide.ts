/**
 * Provision a REHEARSAL guide account for the FW surface (FW Unit 4
 * verification). Machine-bound like the other seed scripts.
 *
 *   npm run seed:fw-guide -- --cohort <uuid> [--email <addr>]
 *
 * The address defaults to the reserved `.invalid` TLD — the same posture
 * `provision-path-family.ts` uses for its test accounts, and the reason no mail
 * of any kind can leave the system on its behalf. The generated password lands
 * in scripts/.fw-rehearsal.local.txt (gitignored), NEVER stdout.
 *
 * This is the guide-door half of the loop's verification: `provisionFwGuide`
 * mints a dormant account with a `guide`/`cohort` grant, `issueFwGuideInvite`
 * mints the credential link, and `claimFwGuideInvite` burns it and sets the
 * password — the exact three sequences a real guide walks, driven from a script
 * so the surface can be exercised without a staff password.
 */

import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { loadSupabaseEnv } from "./load-env";
import {
  claimFwGuideInvite,
  issueFwGuideInvite,
  provisionFwGuide,
} from "../app/path/lib/fw-guide-core";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const cohortId = arg("cohort", "");
  if (!cohortId) throw new Error("--cohort <uuid> is required");
  const email = arg("email", "rehearsal.guide@the120.invalid");

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const staff = await db.from("staff").select("id").eq("is_active", true).limit(1).maybeSingle();
  const createdBy = typeof staff.data?.id === "string" ? staff.data.id : null;
  if (!createdBy) throw new Error("no active staff row to attribute the provisioning to");

  const provisioned = await provisionFwGuide(db, { email, cohortId, createdBy });
  if (!provisioned.ok) throw new Error(`provisionFwGuide: ${provisioned.reason}`);
  console.log(
    `[seed-fw-guide] ${provisioned.created ? "created" : "adopted"} ${provisioned.email} → grant on ${cohortId}`
  );

  // "reissue" on purpose: this script exists to hand a working credential back,
  // and "ensure" would deliberately decline to rotate a live one.
  const issued = await issueFwGuideInvite(db, {
    userId: provisioned.userId,
    createdBy,
    now: Date.now(),
    mode: "reissue",
  });
  if (!issued.ok || !issued.issued) throw new Error("issueFwGuideInvite did not mint a token");

  const password = `Rh-${randomBytes(12).toString("base64url")}`;
  const claimed = await claimFwGuideInvite(db, { token: issued.token, password, now: Date.now() });
  if (!claimed.ok) throw new Error(`claimFwGuideInvite: ${claimed.reason}`);

  const file = path.resolve(process.cwd(), "scripts/.fw-rehearsal.local.txt");
  if (!existsSync(file)) writeFileSync(file, "", { mode: 0o600 });
  chmodSync(file, 0o600);
  appendFileSync(file, `${new Date().toISOString()}\t${email}\t${password}\tcohort=${cohortId}\n`);

  console.log(`[seed-fw-guide] credential written to scripts/.fw-rehearsal.local.txt`);
}

main().catch((e) => {
  console.error("[seed-fw-guide] failed:", e);
  process.exit(1);
});
