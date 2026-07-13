/**
 * Backfill/repair the CRM `families` spine from existing `parents` rows
 * (plan Unit 2, Decision 3 — this script doubles as the sync-repair tool).
 *
 *   npm run backfill:families
 *
 * For every parents row with no families row (parent_id match):
 *   - link a live lead family with the same email if one exists (mirrors the
 *     on_parent_created trigger: identity snapshot + consent OR-merge, never
 *     touching consent_revoked_at), else insert a new family
 *   - identity snapshot, source mapped from heard_about, referral copied
 *   - consent mapping: consent_given = casl_consent,
 *     consent_at = casl_consent_at, consent_source = 'signup'
 *   - signup_at = parents.created_at
 *   - dossier_submitted_at = earliest children.submitted_at
 *     (only when some child status != 'draft')
 *   - welcome_email_at from auth user_metadata.welcome_sent_at
 *
 * Rerunnable: linked families are only repaired (null snapshot timestamps
 * filled in), never duplicated. Prints summary counts plus the verification
 * queries (families vs parents count, consent counts match).
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL from the
 * environment, falling back to .env.local.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ParentRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  casl_consent: boolean;
  casl_consent_at: string | null;
  heard_about: string;
  referral_code: string;
  created_at: string;
};

type ChildRow = {
  parent_id: string;
  status: string;
  submitted_at: string | null;
};

type FamilyRow = {
  id: string;
  parent_id: string | null;
  email: string | null;
  merged_into_id: string | null;
  referral_code: string;
  consent_given: boolean;
  consent_at: string | null;
  consent_source: string | null;
  signup_at: string | null;
  dossier_submitted_at: string | null;
  welcome_email_at: string | null;
};

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

/**
 * heard_about → SOURCES slug (app/crm/lib/constants.ts), fallback 'website'.
 * MUST stay identical to the mapping in on_parent_created()
 * (supabase/migrations/20260713110000_crm_core.sql).
 */
function mapSource(heardAbout: string, referralCode: string): string {
  if (referralCode.trim() !== "") return "ambassador";
  switch (heardAbout) {
    case "A friend or ambassador":
      return "warm-network";
    case "Parent group or forum":
      return "facebook-group";
    case "My child's school":
      return "warm-network";
    case "Coach or program director":
      return "sports-arts";
    case "Search":
      return "website";
    case "Event":
      return "info-session";
    case "Other":
      return "other";
    default:
      return "website";
  }
}

/** Earliest non-null consent timestamp (matches the trigger's least()). */
function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return new Date(a) <= new Date(b) ? a : b;
}

async function fetchAll<T>(
  admin: SupabaseClient,
  table: string,
  columns: string
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch ${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < pageSize) return rows;
  }
}

async function main() {
  const { url, serviceRoleKey } = loadEnv();
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const parents = await fetchAll<ParentRow>(
    admin,
    "parents",
    "id, first_name, last_name, email, phone, casl_consent, casl_consent_at, heard_about, referral_code, created_at"
  );
  const children = await fetchAll<ChildRow>(admin, "children", "parent_id, status, submitted_at");
  const families = await fetchAll<FamilyRow>(
    admin,
    "families",
    "id, parent_id, email, merged_into_id, referral_code, consent_given, consent_at, consent_source, signup_at, dossier_submitted_at, welcome_email_at"
  );

  const byParentId = new Map<string, FamilyRow>();
  for (const f of families) {
    if (f.parent_id) byParentId.set(f.parent_id, f);
  }

  let createdCount = 0;
  let linkedCount = 0;
  let repairedCount = 0;
  let skippedCount = 0;

  for (const parent of parents) {
    // earliest children.submitted_at, only if any child has left draft
    const kids = children.filter((c) => c.parent_id === parent.id);
    const submittedTimes = kids
      .filter((c) => c.status !== "draft" && c.submitted_at)
      .map((c) => c.submitted_at as string)
      .sort();
    const dossierSubmittedAt = submittedTimes[0] ?? null;

    // welcome email snapshot from auth metadata
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(parent.id);
    if (userError) {
      console.warn(`  ! ${parent.email}: could not read auth user (${userError.message})`);
    }
    const welcomeEmailAt =
      (userData?.user?.user_metadata?.welcome_sent_at as string | undefined) ?? null;

    const existing = byParentId.get(parent.id);
    if (existing) {
      // Repair pass: fill in snapshot timestamps the trigger/route couldn't set.
      const patch: Record<string, string> = {};
      if (!existing.signup_at) patch.signup_at = parent.created_at;
      if (!existing.dossier_submitted_at && dossierSubmittedAt) {
        patch.dossier_submitted_at = dossierSubmittedAt;
      }
      if (!existing.welcome_email_at && welcomeEmailAt) {
        patch.welcome_email_at = welcomeEmailAt;
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await admin.from("families").update(patch).eq("id", existing.id);
        if (error) throw new Error(`repair family ${existing.id}: ${error.message}`);
        repairedCount += 1;
      }
      continue;
    }

    const parentName = `${parent.first_name} ${parent.last_name}`.trim();

    // Mirror the trigger: link a live, unlinked lead with the same email.
    const lead = families.find(
      (f) =>
        !f.merged_into_id &&
        !f.parent_id &&
        f.email !== null &&
        f.email.toLowerCase() === parent.email.toLowerCase()
    );
    const conflict = families.find(
      (f) =>
        !f.merged_into_id &&
        f.parent_id !== null &&
        f.parent_id !== parent.id &&
        f.email !== null &&
        f.email.toLowerCase() === parent.email.toLowerCase()
    );

    if (conflict) {
      console.warn(
        `  ! ${parent.email}: a live family (${conflict.id}) with this email is linked to another account — skipped; resolve manually.`
      );
      skippedCount += 1;
      continue;
    }

    if (lead) {
      const { error } = await admin
        .from("families")
        .update({
          parent_id: parent.id,
          parent_name: parentName,
          email: parent.email,
          phone: parent.phone,
          referral_code: lead.referral_code === "" ? parent.referral_code : lead.referral_code,
          consent_given: lead.consent_given || parent.casl_consent,
          consent_at: earliest(lead.consent_at, parent.casl_consent_at),
          consent_source: lead.consent_source ?? "signup",
          // NEVER touch consent_revoked_at (a revocation is never resurrected)
          signup_at: parent.created_at,
          dossier_submitted_at: lead.dossier_submitted_at ?? dossierSubmittedAt,
          welcome_email_at: lead.welcome_email_at ?? welcomeEmailAt,
        })
        .eq("id", lead.id);
      if (error) throw new Error(`link family ${lead.id}: ${error.message}`);
      lead.parent_id = parent.id; // keep the in-memory picture consistent
      byParentId.set(parent.id, lead);
      linkedCount += 1;
      continue;
    }

    const { error } = await admin.from("families").insert({
      parent_id: parent.id,
      parent_name: parentName,
      email: parent.email,
      phone: parent.phone,
      source: mapSource(parent.heard_about, parent.referral_code),
      referral_code: parent.referral_code,
      consent_given: parent.casl_consent,
      consent_at: parent.casl_consent_at,
      consent_source: "signup",
      signup_at: parent.created_at,
      dossier_submitted_at: dossierSubmittedAt,
      welcome_email_at: welcomeEmailAt,
    });
    if (error) throw new Error(`insert family for ${parent.email}: ${error.message}`);
    createdCount += 1;
  }

  console.log("\nBackfill summary");
  console.log(`  parents scanned:   ${parents.length}`);
  console.log(`  families created:  ${createdCount}`);
  console.log(`  leads linked:      ${linkedCount}`);
  console.log(`  families repaired: ${repairedCount}`);
  console.log(`  skipped (manual):  ${skippedCount}`);

  // Verification queries (plan Unit 2 verification).
  const { count: parentCount, error: e1 } = await admin
    .from("parents")
    .select("*", { count: "exact", head: true });
  if (e1) throw new Error(`verify parents count: ${e1.message}`);

  const { count: linkedFamilyCount, error: e2 } = await admin
    .from("families")
    .select("*", { count: "exact", head: true })
    .not("parent_id", "is", null)
    .is("merged_into_id", null);
  if (e2) throw new Error(`verify families count: ${e2.message}`);

  const { count: consentParents, error: e3 } = await admin
    .from("parents")
    .select("*", { count: "exact", head: true })
    .eq("casl_consent", true);
  if (e3) throw new Error(`verify parents consent count: ${e3.message}`);

  const { count: consentFamilies, error: e4 } = await admin
    .from("families")
    .select("*", { count: "exact", head: true })
    .eq("consent_given", true)
    .not("parent_id", "is", null)
    .is("merged_into_id", null);
  if (e4) throw new Error(`verify families consent count: ${e4.message}`);

  console.log("\nVerification");
  console.log(
    `  parents: ${parentCount} vs linked live families: ${linkedFamilyCount} ${
      parentCount === linkedFamilyCount ? "— MATCH" : "— MISMATCH (investigate)"
    }`
  );
  console.log(
    `  CASL-consented parents: ${consentParents} vs consented linked families: ${consentFamilies} ${
      (consentParents ?? 0) <= (consentFamilies ?? 0)
        ? "— OK (families may add lead consent)"
        : "— MISMATCH (investigate)"
    }`
  );
}

main().catch((err) => {
  console.error("[backfill-families] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
