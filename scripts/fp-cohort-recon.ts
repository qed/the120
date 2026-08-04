/**
 * READ-ONLY reconnaissance for the First Profit beta cohort (10 parents / 17
 * children). Writes NOTHING. Answers, against live production, the questions
 * that gate provisioning:
 *
 *   1. Which of the 10 parent emails already have an auth user? (R4 — an
 *      existing parent must never be password-written.) Reported TRI-STATE:
 *      a listUsers failure is `unknown`, never `absent`.
 *   2. Which already have `parents` / `families` rows, and what is the CRM
 *      state that decides whether the nurture cron will mail them
 *      (`consent_given`, `consent_revoked_at`, `consent_expires_at`,
 *      `is_test`, `merged_into_id`, `signup_at`)?
 *   3. What `families` columns would the on_parent_created link branch
 *      OVERWRITE (phone, parent_name, source) — current values, so nothing is
 *      silently destroyed.
 *   4. Which children ALREADY EXIST under those parents? This is the duplicate
 *      hazard: `children` has no unique constraint on (parent_id, first_name),
 *      so a funnel-created "Abe" with no fp_username would be duplicated by a
 *      username-keyed insert.
 *   5. Are any of the 17 roster usernames already taken, and by whom?
 *   6. Is the email-shaped fp_username CHECK live? Proven WITHOUT the
 *      Management API: any existing fp_username containing '@' is proof the
 *      broadened constraint was applied (the old CHECK was `^[a-z0-9]+$`).
 *   7. Is there exactly one current path_program_versions row?
 *
 *   npx tsx scripts/fp-cohort-recon.ts
 *
 * Machine-bound like the sibling seed scripts (.env.local carries the
 * service-role key). Prints no passwords.
 */

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { loadSupabaseEnv } from "./load-env";
import {
  birthYearFor as birthYearForAge,
  gradeFor,
  loadRoster,
  usernameFor,
  type RosterChild,
  type RosterFamily,
} from "./fp-cohort-roster";

/**
 * The roster is real family data and lives OUTSIDE this public repo — see
 * scripts/fp-cohort-roster.ts.
 */
const ROSTER = loadRoster();

/** birth_year chosen so the CURRENT school year (start 2025) derives grade = age - 5. */
const birthYearFor = (c: RosterChild) => birthYearForAge(c, 2025);

/** Normalized-email key: strips dots and +tags in the local part (Gmail variants). */
function normalizeEmail(email: string): string {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  return `${local.split("+")[0]!.replace(/\./g, "")}@${domain}`;
}

/** Page-walk every auth user once. Returns null on ANY error — the caller
 *  treats that as `unknown`, never as `absent` (deliberately not
 *  findAuthUserByEmail, whose error path is indistinguishable from absence). */
async function loadAllAuthUsers(db: SupabaseClient): Promise<User[] | null> {
  const all: User[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const res = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (res.error) {
      console.error(`  !! listUsers page ${page} failed: ${res.error.message}`);
      return null;
    }
    const users = res.data.users ?? [];
    all.push(...users);
    if (users.length < 1000) break;
  }
  return all;
}

async function main() {
  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const projectRef = new URL(url).host.split(".")[0] ?? "(unparseable)";
  console.log(`\n=== FP BETA COHORT RECON (READ-ONLY) ===`);
  console.log(`Supabase project ref: ${projectRef}`);
  console.log(`Roster: ${ROSTER.length} families, ${ROSTER.reduce((n, f) => n + f.children.length, 0)} children\n`);

  // --- Preflight ------------------------------------------------------------
  console.log(`--- PREFLIGHT ---`);

  // Email-shaped username CHECK, proven without the Management API: the OLD
  // constraint was ^[a-z0-9]+$, so any stored username containing '@' can only
  // exist if the broadened CHECK is live.
  const atProbe = await db.from("children").select("fp_username").like("fp_username", "%@%").limit(3);
  if (atProbe.error) {
    console.log(`  email-shaped CHECK: UNKNOWN (probe errored: ${atProbe.error.message})`);
  } else if ((atProbe.data ?? []).length > 0) {
    console.log(`  email-shaped CHECK: LIVE (found ${(atProbe.data ?? []).length} existing '@' username(s))`);
  } else {
    console.log(`  email-shaped CHECK: UNPROVEN — no '@' username exists yet.`);
    console.log(`     Migration 20260904120000 is merged (0377c76) but this probe cannot`);
    console.log(`     confirm it is APPLIED. If it is not, all 17 claims fail the CHECK.`);
  }

  const ver = await db.from("path_program_versions").select("id").eq("is_current", true);
  if (ver.error) console.log(`  path_program_versions: ERROR ${ver.error.message}`);
  else console.log(`  path_program_versions is_current: ${(ver.data ?? []).length} row(s) ${(ver.data ?? []).length === 1 ? "OK" : "!! expected exactly 1"}`);

  // --- Auth users -----------------------------------------------------------
  const authUsers = await loadAllAuthUsers(db);
  if (authUsers === null) {
    console.log(`\n!! AUTH USER PROBE FAILED — every parent below reports UNKNOWN.`);
    console.log(`   Do NOT provision on an unknown: creating a parent that already`);
    console.log(`   exists would password-write a real account.\n`);
  } else {
    console.log(`  auth users scanned: ${authUsers.length}`);
  }
  const byEmail = new Map<string, User>();
  const byNormalized = new Map<string, User[]>();
  for (const u of authUsers ?? []) {
    const e = (u.email ?? "").toLowerCase();
    if (!e) continue;
    byEmail.set(e, u);
    const n = normalizeEmail(e);
    byNormalized.set(n, [...(byNormalized.get(n) ?? []), u]);
  }

  // --- Username taken-set ---------------------------------------------------
  const wanted = ROSTER.flatMap((f) => f.children.map(usernameFor));
  const taken = await db
    .from("children")
    .select("id, parent_id, first_name, fp_username")
    .in("fp_username", wanted);
  if (taken.error) console.log(`  !! roster username probe failed: ${taken.error.message}`);
  const takenBy = new Map<string, { id: string; parent_id: string; first_name: string }>();
  for (const r of (taken.data ?? []) as Array<{ id: string; parent_id: string; first_name: string; fp_username: string }>) {
    takenBy.set(r.fp_username.toLowerCase(), { id: r.id, parent_id: r.parent_id, first_name: r.first_name });
  }

  // --- Per family -----------------------------------------------------------
  console.log(`\n--- FAMILIES ---`);
  let createParents = 0;
  let adoptParents = 0;
  let unknownParents = 0;
  let existingChildren = 0;
  let nurtureRisk = 0;

  for (const fam of ROSTER) {
    const email = fam.email.toLowerCase();
    console.log(`\n${fam.firstName} ${fam.lastName}  <${fam.email}>`);

    let parentId: string | null = null;
    if (authUsers === null) {
      console.log(`  parent: UNKNOWN (auth probe failed) — DO NOT PROVISION`);
      unknownParents += 1;
    } else {
      const exact = byEmail.get(email);
      if (exact) {
        parentId = exact.id;
        adoptParents += 1;
        console.log(`  parent: EXISTS -> ADOPT (no password write, no upsert)`);
      } else {
        const near = (byNormalized.get(normalizeEmail(email)) ?? []).filter((u) => (u.email ?? "").toLowerCase() !== email);
        if (near.length > 0) {
          console.log(`  parent: no exact match, but NEAR-MISS on ${near.map((u) => u.email).join(", ")}`);
          console.log(`     >> creating would make a SECOND account for the same person. Confirm before proceeding.`);
        } else {
          console.log(`  parent: absent -> CREATE (email_confirm, random password)`);
        }
        createParents += 1;
      }
    }

    // families row (by email, live rows preferred)
    const famRow = await db
      .from("families")
      .select("id, parent_id, parent_name, email, phone, source, consent_given, consent_revoked_at, consent_expires_at, is_test, merged_into_id, signup_at")
      .ilike("email", email)
      .order("created_at", { ascending: true });
    if (famRow.error) {
      console.log(`  families: ERROR ${famRow.error.message}`);
    } else {
      const rows = (famRow.data ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0) {
        console.log(`  families: none (trigger will CREATE a new one)`);
      }
      for (const r of rows) {
        const consent = r.consent_given === true;
        const revoked = r.consent_revoked_at != null;
        const isTest = r.is_test === true;
        const linked = r.parent_id != null;
        const mailable = consent && !revoked && !isTest && r.merged_into_id == null;
        if (mailable) nurtureRisk += 1;
        console.log(
          `  families: ${linked ? "LINKED to an account" : "LEAD (parent_id null)"}` +
            ` | consent_given=${r.consent_given} revoked=${revoked} expires=${r.consent_expires_at ?? "-"}` +
            ` | is_test=${r.is_test} | merged=${r.merged_into_id ?? "-"}`
        );
        console.log(`     signup_at=${r.signup_at ?? "-"} (the trigger RESETS this on link -> reopens a nurture window)`);
        console.log(`     trigger would OVERWRITE: phone="${r.phone ?? ""}" parent_name="${r.parent_name ?? ""}" (source stays "${r.source ?? ""}")`);
        if (mailable) console.log(`     >> NURTURE-ELIGIBLE TODAY. Stamping is_test=true neutralises this.`);
      }
    }

    // existing children under this parent — the duplicate hazard
    if (parentId) {
      const kids = await db
        .from("children")
        .select("id, first_name, last_name, fp_username, grade, birth_year, status, applicant_state")
        .eq("parent_id", parentId);
      if (kids.error) {
        console.log(`  children: ERROR ${kids.error.message}`);
      } else {
        const rows = (kids.data ?? []) as Array<Record<string, unknown>>;
        existingChildren += rows.length;
        if (rows.length === 0) console.log(`  children: none on record`);
        for (const k of rows) {
          console.log(
            `  children: EXISTING "${k.first_name} ${k.last_name}" fp_username=${k.fp_username ?? "(none)"}` +
              ` grade=${k.grade ?? "-"} birth_year="${k.birth_year ?? ""}" status=${k.status} applicant_state=${k.applicant_state ?? "-"}`
          );
        }
        const names = new Set(rows.map((k) => String(k.first_name ?? "").trim().toLowerCase()));
        for (const c of fam.children) {
          if (names.has(c.firstName.toLowerCase())) {
            console.log(`     >> "${c.firstName}" ALREADY EXISTS — inserting would DUPLICATE. Adopt/claim instead.`);
          }
        }
      }
    }

    // roster usernames for this family
    for (const c of fam.children) {
      const u = usernameFor(c);
      const hit = takenBy.get(u);
      const mine = hit && parentId && hit.parent_id === parentId;
      console.log(
        `  child ${c.firstName} (age ${c.age}) -> ${u} | grade ${gradeFor(c)} | birth_year ${birthYearFor(c)}` +
          ` | ${hit ? (mine ? "username held by THIS parent's child (adopt)" : "!! username held by ANOTHER parent's child") : "username free"}`
      );
    }
  }

  console.log(`\n--- SUMMARY ---`);
  console.log(`  parents to CREATE: ${createParents}`);
  console.log(`  parents to ADOPT:  ${adoptParents}`);
  console.log(`  parents UNKNOWN:   ${unknownParents}${unknownParents ? "  <-- BLOCKING" : ""}`);
  console.log(`  existing children under adopted parents: ${existingChildren}`);
  console.log(`  families nurture-eligible TODAY: ${nurtureRisk}${nurtureRisk ? "  <-- stamp is_test=true" : ""}`);
  console.log(`\nNothing was written.\n`);
}

main().catch((err) => {
  console.error("[fp-cohort-recon] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
