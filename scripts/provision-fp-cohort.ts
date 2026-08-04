/**
 * Provision the First Profit BETA COHORT — 10 families, 17 children — so every
 * child can log in at firstprofit.school and play TODAY.
 *
 *   npx tsx scripts/provision-fp-cohort.ts            # DRY RUN (default, writes nothing)
 *   npx tsx scripts/provision-fp-cohort.ts --apply    # writes
 *
 * Composes the SAME primitives as scripts/provision-fp-family.ts (the proven
 * single-family path), in the same order, over a committed roster:
 *   parent auth user -> parents row (trips on_parent_created -> CRM family)
 *   -> path family -> children row -> fp_username claim (service-role)
 *   -> child auth user on the derived .invalid address -> path_student_profiles
 *   -> fp_player_profiles + seeded save.
 *
 * ── What this script does DIFFERENTLY from provision-fp-family.ts, and why ──
 *  1. NEVER resets an existing parent's password. provision-fp-family.ts does
 *     (it was written for the owner's own account); doing that to a real warm
 *     contact would lock them out of their own funnel account.
 *  2. NEVER stamps families.is_test. Owner decision (2026-08-04): these are real
 *     leads, they stay in CRM pipeline counts and in the nurture sequences.
 *  3. Distinct RANDOM password per parent. A shared known password on
 *     email_confirm'd accounts is a provider-level session bypass — GoTrue's
 *     /token endpoint is public and the anon key ships in every client bundle,
 *     so one leaked parent credential would open all ten. (docs/solutions/
 *     security-issues/confirmed-account-with-known-password-before-inbox-proof-
 *     is-a-provider-level-session-bypass-2026-08-01.md)
 *  4. Children adopt by (parent_id, normalized first_name) FIRST, fp_username
 *     second. `children` has NO unique constraint on (parent_id, first_name),
 *     and funnel-created children carry legacy usernames — so a username-keyed
 *     insert would silently DUPLICATE a real applicant (one cohort child is exactly
 *     this case: fp_username="abe", status=offered).
 *  5. Writes birth_year AND grade. birth_year = 2025 - age, chosen so the
 *     CURRENT school year (start year 2025) derives grade = age - 5 via
 *     resolveChildGrade, matching the owner-approved roster table. It rolls +1
 *     on 2026-09-01, which is correct school-year behaviour. Writing a real
 *     birth_year is deliberate: the funnel's own prefill path
 *     (app/lib/funnel/miniapp-core.ts) writes birth_year for draft children, so
 *     "leave it empty" was never a stable assumption.
 *
 * Child passwords are a shared literal from FP_COHORT_CHILD_PASSWORD (owner-accepted beta
 * risk: guessable usernames + one shared secret across 17 accounts). Parent
 * passwords are generated here and written ONLY to the gitignored credentials
 * file — never logged, never committed.
 *
 * Idempotent: re-runs adopt existing rows, never reset a password, and never
 * reset a child's game progress (fp_player_saves seeds ON CONFLICT DO NOTHING).
 * Machine-bound like the sibling seed scripts (.env.local carries the
 * service-role key).
 */

import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { deriveStudentEmail, validateStudentPassword } from "@/app/fp/lib/provision-rules";
import { ensurePathFamilyForParent } from "@/app/fp/lib/provision-core";
import { ensurePlayerProfile } from "@/app/api/fp/login/profile-core";
import { APPLICANT_ENTRY_STATE } from "@/app/lib/funnel/applicant-rules";
import { loadSupabaseEnv } from "./load-env";
import {
  birthYearFor as birthYearForAge,
  gradeFor,
  loadRoster,
  usernameFor,
  type RosterChild,
  type RosterFamily,
} from "./fp-cohort-roster";

/* ------------------------------------------------------------------ roster */

/**
 * The roster is real family data and lives OUTSIDE this public repo — see
 * scripts/fp-cohort-roster.ts. The child password is likewise a live
 * credential for 17 accounts, so it comes from the environment (.env.local),
 * never a literal here.
 */
const ROSTER = loadRoster();

const CHILD_PASSWORD = (() => {
  const pw = process.env.FP_COHORT_CHILD_PASSWORD;
  if (!pw) {
    console.error(
      "Missing FP_COHORT_CHILD_PASSWORD (environment or .env.local).\n" +
        "It is the shared child login password and is deliberately not committed."
    );
    process.exit(1);
  }
  return pw;
})();

/** The school-year start year the birth_year values are calibrated against. */
const SCHOOL_YEAR_START = 2025;

const birthYearFor = (c: RosterChild) => birthYearForAge(c, SCHOOL_YEAR_START);

/** Same folding the app uses to compare names (NFKC, trim, collapse, lowercase). */
const normalizeName = (raw: string) =>
  raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Readable, unambiguous alphabet — no 0/O/1/l/I. Parents type this once. */
const PW_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function generateParentPassword(): string {
  const group = () =>
    Array.from({ length: 4 }, () => PW_ALPHABET[randomInt(PW_ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

/* ------------------------------------------------------- roster validation */

const USERNAME_RE = /^[a-z0-9]([a-z0-9._+@-]*[a-z0-9])?$/;
function validateRoster(): void {
  const seenUser = new Set<string>();
  for (const fam of ROSTER) {
    const seenName = new Set<string>();
    for (const c of fam.children) {
      const u = usernameFor(c);
      if (!USERNAME_RE.test(u) || u.length > 80) {
        throw new Error(`roster: username "${u}" fails children_fp_username_format`);
      }
      if (seenUser.has(u)) throw new Error(`roster: duplicate username "${u}"`);
      seenUser.add(u);
      const n = normalizeName(c.firstName);
      if (seenName.has(n)) throw new Error(`roster: duplicate child name "${c.firstName}" in one family`);
      seenName.add(n);
      const g = gradeFor(c);
      if (g < 3 || g > 12) throw new Error(`roster: ${c.firstName} derives grade ${g}, outside 3-12`);
      const pw = validateStudentPassword(CHILD_PASSWORD, { studentName: c.firstName });
      if (!pw.ok) throw new Error(`roster: CHILD_PASSWORD rejected for ${c.firstName}: ${pw.error}`);
    }
  }
}

/* ----------------------------------------------------------------- results */

type ChildResult = {
  name: string;
  username: string;
  action: "created" | "adopted" | "failed";
  detail?: string;
};
type FamilyResult = {
  family: string;
  email: string;
  parentAction: "created" | "adopted" | "failed";
  parentPassword: string | null;
  children: ChildResult[];
  error?: string;
};

/* -------------------------------------------------------------------- main */

/** Page-walk every auth user once. Returns null on ANY error, which the caller
 *  treats as UNKNOWN and refuses to act on — deliberately not
 *  findAuthUserByEmail, whose error path is indistinguishable from absence. */
async function loadAuthUsersByEmail(db: SupabaseClient): Promise<Map<string, User> | null> {
  const map = new Map<string, User>();
  for (let page = 1; page <= 100; page += 1) {
    const res = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (res.error) {
      console.error(`  !! listUsers page ${page} failed: ${res.error.message}`);
      return null;
    }
    const users = res.data.users ?? [];
    for (const u of users) if (u.email) map.set(u.email.toLowerCase(), u);
    if (users.length < 1000) break;
  }
  return map;
}

async function provisionFamily(
  db: SupabaseClient,
  fam: RosterFamily,
  authByEmail: Map<string, User>,
  apply: boolean
): Promise<FamilyResult> {
  const email = fam.email.toLowerCase();
  const result: FamilyResult = {
    family: `${fam.firstName} ${fam.lastName}`,
    email: fam.email,
    parentAction: "adopted",
    parentPassword: null,
    children: [],
  };

  // 1. Parent auth user — adopt if present, else create with a random password.
  let parentId: string;
  const existing = authByEmail.get(email);
  if (existing) {
    parentId = existing.id;
    result.parentAction = "adopted";
    console.log(`  parent: ADOPT (password untouched)`);
  } else {
    const password = generateParentPassword();
    result.parentPassword = password;
    result.parentAction = "created";
    if (!apply) {
      console.log(`  parent: would CREATE (random password)`);
      parentId = "(dry-run)";
    } else {
      const created = await db.auth.admin.createUser({
        email: fam.email,
        password,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw created.error ?? new Error("createUser returned no parent user");
      }
      parentId = created.data.user.id;
      console.log(`  parent: CREATED + confirmed`);
    }
  }

  // 2. parents row. Insert ONLY when missing — an auth user without a parents
  //    row makes every child insert fail 23503 on children.parent_id.
  //    NOTE: this write is what trips on_parent_created (CRM family link).
  if (apply) {
    const has = await db.from("parents").select("id").eq("id", parentId).maybeSingle();
    if (has.error) throw has.error;
    if (!has.data) {
      const ins = await db.from("parents").insert({
        id: parentId,
        email: fam.email,
        first_name: fam.firstName,
        last_name: fam.lastName,
        casl_consent: false,
      });
      if (ins.error) throw ins.error;
      console.log(`  parents row: INSERTED (on_parent_created fired)`);
    } else {
      console.log(`  parents row: already present`);
    }
  } else {
    const probe = existing
      ? await db.from("parents").select("id").eq("id", existing.id).maybeSingle()
      : null;
    console.log(
      `  parents row: ${existing ? (probe?.data ? "already present" : "would INSERT (missing!)") : "would INSERT"}`
    );
  }

  if (!apply) {
    // Dry run: report per-child intent using live state, then stop.
    for (const c of fam.children) {
      const u = usernameFor(c);
      let action: ChildResult["action"] = "created";
      let detail = "";
      if (existing) {
        const kids = await db
          .from("children")
          .select("id, first_name, fp_username")
          .eq("parent_id", existing.id);
        const match = ((kids.data ?? []) as Array<{ id: string; first_name: string; fp_username: string | null }>)
          .find((k) => normalizeName(k.first_name) === normalizeName(c.firstName));
        if (match) {
          action = "adopted";
          detail = match.fp_username === u
            ? "username already correct"
            : `username "${match.fp_username ?? "(none)"}" -> "${u}"`;
        }
      }
      console.log(`  child ${c.firstName}: would ${action.toUpperCase()} -> ${u} (grade ${gradeFor(c)}, birth_year ${birthYearFor(c)}) ${detail}`);
      result.children.push({ name: c.firstName, username: u, action, detail });
    }
    return result;
  }

  // 3. Path family linkage (family_id is NOT NULL on path_student_profiles).
  const famLink = await ensurePathFamilyForParent(db, { userId: parentId });
  if (!famLink.ok) throw new Error(`path family linkage failed: ${famLink.reason}`);
  const familyId = famLink.familyId;

  // 4-8. Per child.
  const existingKids = await db
    .from("children")
    .select("id, first_name, fp_username")
    .eq("parent_id", parentId);
  if (existingKids.error) throw existingKids.error;
  const kidRows = (existingKids.data ?? []) as Array<{
    id: string; first_name: string; fp_username: string | null;
  }>;

  const ver = await db.from("path_program_versions").select("id").eq("is_current", true).maybeSingle();
  const programVersionId = (ver.data as { id?: string } | null)?.id;
  if (!programVersionId) throw new Error("no current path_program_versions row");

  for (const c of fam.children) {
    const username = usernameFor(c);
    try {
      // 4. children row — adopt by NAME first (username is not a safe key: a
      //    funnel child carries a legacy username, and there is no unique
      //    constraint on (parent_id, first_name) to stop a duplicate insert).
      const match = kidRows.find((k) => normalizeName(k.first_name) === normalizeName(c.firstName));
      let childId: string;
      let action: ChildResult["action"];
      let detail = "";

      if (match) {
        childId = match.id;
        action = "adopted";
        // Correct grade/birth_year to the roster's intent for this cohort.
        const upd = await db
          .from("children")
          .update({ grade: gradeFor(c), birth_year: birthYearFor(c) })
          .eq("id", childId);
        if (upd.error) throw upd.error;
        // 5. Repoint the username if it disagrees (service-role only).
        if (match.fp_username !== username) {
          const claim = await db
            .from("children")
            .update({ fp_username: username })
            .eq("id", childId)
            .select("id");
          if (claim.error) throw claim.error;
          detail = `username "${match.fp_username ?? "(none)"}" -> "${username}"`;
        } else {
          detail = "username already correct";
        }
      } else {
        // Insert WITHOUT the username, then claim it with a conditional UPDATE
        // so an aborted run leaves an adoptable row rather than a duplicate.
        const ins = await db
          .from("children")
          .insert({
            parent_id: parentId,
            first_name: c.firstName,
            last_name: c.lastName,
            grade: gradeFor(c),
            birth_year: birthYearFor(c),
            status: "draft",
            applicant_state: APPLICANT_ENTRY_STATE,
          })
          .select("id")
          .single();
        if (ins.error || !ins.data) throw ins.error ?? new Error("child insert returned no row");
        childId = String((ins.data as { id: string }).id);
        action = "created";

        const claim = await db
          .from("children")
          .update({ fp_username: username })
          .eq("id", childId)
          .is("fp_username", null)
          .select("id");
        if (claim.error) {
          if ((claim.error as { code?: string }).code === "23505") {
            throw new Error(`username "${username}" already claimed by another child`);
          }
          throw claim.error;
        }
      }

      // 6. Child auth account on the derived .invalid address.
      const studentEmail = deriveStudentEmail(childId);
      const found = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      let childUserId: string | null = null;
      if (!found.error) {
        const hit = (found.data.users ?? []).find(
          (u) => (u.email ?? "").toLowerCase() === studentEmail.toLowerCase()
        );
        if (hit) childUserId = hit.id;
      }
      if (!childUserId) {
        const createdChild = await db.auth.admin.createUser({
          email: studentEmail,
          password: CHILD_PASSWORD,
          email_confirm: true,
          app_metadata: { role: "student" },
        });
        if (createdChild.error || !createdChild.data.user) {
          throw createdChild.error ?? new Error("createUser returned no child user");
        }
        childUserId = createdChild.data.user.id;
      }

      // 7. path_student_profiles (child -> user identity).
      const psp = await db
        .from("path_student_profiles")
        .select("id")
        .eq("child_id", childId)
        .maybeSingle();
      if (psp.error) throw psp.error;
      if (!psp.data) {
        const insPsp = await db.from("path_student_profiles").insert({
          user_id: childUserId,
          child_id: childId,
          program_version_id: programVersionId,
          family_id: familyId,
          cohort_id: null,
        });
        if (insPsp.error) throw insPsp.error;
      }

      // 8. FP player profile + seeded save.
      const player = await ensurePlayerProfile(db, {
        userId: childUserId,
        childId,
        firstName: c.firstName,
      });
      if (!player.ok) throw new Error(`ensurePlayerProfile refused: ${player.reason}`);

      console.log(`  child ${c.firstName}: ${action.toUpperCase()} -> ${username} ${detail}`);
      result.children.push({ name: c.firstName, username, action, detail });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  child ${c.firstName}: FAILED — ${msg}`);
      result.children.push({ name: c.firstName, username, action: "failed", detail: msg });
    }
  }

  return result;
}

function renderCredentials(results: FamilyResult[]): string {
  const lines: string[] = [
    `# First Profit beta cohort — credentials`,
    ``,
    `Generated ${new Date().toISOString()}. NOT COMMITTED (gitignored).`,
    `Children sign in at https://firstprofit.school`,
    ``,
  ];
  for (const r of results) {
    lines.push(`## ${r.family}  <${r.email}>`);
    lines.push(``);
    if (r.error) {
      lines.push(`> NOT PROVISIONED — ${r.error}`);
      lines.push(``);
      continue;
    }
    lines.push(
      r.parentPassword
        ? `Parent login (the120.school): ${r.email} / ${r.parentPassword}`
        : `Parent login: ${r.email} — existing account, password unchanged`
    );
    lines.push(``);
    for (const c of r.children) {
      lines.push(
        c.action === "failed"
          ? `- ${c.name}: NOT PROVISIONED (${c.detail})`
          : `- ${c.name}: \`${c.username}\` / \`${CHILD_PASSWORD}\``
      );
    }
    lines.push(``);
  }
  return lines.join("\n");
}

async function main() {
  const apply = process.argv.includes("--apply");
  validateRoster();

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const projectRef = new URL(url).host.split(".")[0] ?? "?";
  console.log(`\n=== FP BETA COHORT PROVISIONING ===`);
  console.log(`mode: ${apply ? "APPLY (writes)" : "DRY RUN (writes nothing)"}`);
  console.log(`project ref: ${projectRef}`);
  console.log(`roster: ${ROSTER.length} families, ${ROSTER.reduce((n, f) => n + f.children.length, 0)} children\n`);

  const authByEmail = await loadAuthUsersByEmail(db);
  if (authByEmail === null) {
    throw new Error("auth user probe failed — refusing to run (an unknown parent must never be created)");
  }

  const results: FamilyResult[] = [];
  for (const fam of ROSTER) {
    console.log(`\n${fam.firstName} ${fam.lastName}  <${fam.email}>`);
    try {
      results.push(await provisionFamily(db, fam, authByEmail, apply));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAMILY ABORTED — ${msg}`);
      results.push({
        family: `${fam.firstName} ${fam.lastName}`,
        email: fam.email,
        parentAction: "failed",
        parentPassword: null,
        children: [],
        error: msg,
      });
    }
  }

  const kids = results.flatMap((r) => r.children);
  console.log(`\n--- SUMMARY ---`);
  console.log(`  families ok:      ${results.filter((r) => !r.error).length}/${results.length}`);
  console.log(`  children created: ${kids.filter((c) => c.action === "created").length}`);
  console.log(`  children adopted: ${kids.filter((c) => c.action === "adopted").length}`);
  console.log(`  children failed:  ${kids.filter((c) => c.action === "failed").length}`);

  if (apply) {
    const path = "scripts/.fp-cohort-credentials.local.md";
    writeFileSync(path, renderCredentials(results), "utf8");
    console.log(`\n  credentials written to ${path} (gitignored)`);
  } else {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply to provision.`);
  }
  console.log("");
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[provision-fp-cohort] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
