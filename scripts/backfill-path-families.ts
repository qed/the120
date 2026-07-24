/**
 * R31 linkage backfill — link ONE enrolled CRM family into The Path (T1 Unit 15).
 *
 *   npx tsx scripts/backfill-path-families.ts <parent-email>
 *
 * Creates (idempotently) the path_families row and the parent/family role grant
 * for the CRM parent whose email is given — after which that parent signs in at
 * /fp with their EXISTING account (email + password from their 2026-27
 * application) and links founders from the roster without re-entering any data.
 * The children themselves are provisioned by the parent in the onboarding
 * surface, never here.
 *
 * DELIBERATELY per-family, never a blanket migration (decision 2026-07-22,
 * Unit 15): granting every deposit_paid/member family at once would open /fp
 * to real families before the TP-1 children's-data compliance review clears
 * (roadmap: test users only until ~2026-10-21). Staff run this for each
 * consenting family, explicitly. A blanket mode can be added after TP-1.
 *
 * Machine-bound like scripts/seed-staff.ts (.env.local carries the service-role
 * key). Idempotent: re-running adopts the existing family via the parent's
 * grant (ensurePathFamilyForParent), never mints a duplicate.
 */

import { createClient } from "@supabase/supabase-js";

import { ensurePathFamilyForParent } from "@/app/fp/lib/provision-core";
import { loadSupabaseEnv } from "./load-env";

async function main() {
  const email = (process.argv[2] ?? "").trim();
  if (!email || email.startsWith("--")) {
    console.error("Usage: npx tsx scripts/backfill-path-families.ts <parent-email>");
    process.exit(1);
  }

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The CRM parent row: its id IS the auth user id (parents.id → auth.users).
  // ilike with no wildcard = case-insensitive equality.
  const parents = await db
    .from("parents")
    .select("id, first_name, last_name, email")
    .ilike("email", email);
  if (parents.error) throw parents.error;
  const rows = parents.data ?? [];
  if (rows.length === 0) {
    console.error(`No public.parents row found for ${email} — is this family enrolled?`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(
      `${rows.length} parents rows share ${email} — resolve in the CRM first:\n` +
        rows.map((r) => `  ${r.id}  ${r.first_name} ${r.last_name}`).join("\n")
    );
    process.exit(1);
  }
  const parent = rows[0];

  const result = await ensurePathFamilyForParent(db, { userId: parent.id as string });
  if (!result.ok) throw new Error(`linkage failed: ${result.reason}`);

  const children = await db
    .from("children")
    .select("first_name, grade")
    .eq("parent_id", parent.id);
  if (children.error) throw children.error;
  const roster = (children.data ?? [])
    .map((c) => `  ${c.first_name || "(unnamed)"}${c.grade === null ? " — NO GRADE (link path will refuse until set)" : ` — grade ${c.grade}`}`)
    .join("\n");

  console.log(
    `${result.created ? "Linked" : "Already linked"}: ${parent.first_name} ${parent.last_name} <${parent.email}> → path family ${result.familyId}.\n` +
      `Roster children visible to onboarding:\n${roster || "  (none — the create path will render)"}\n` +
      `Next: the parent signs in at /fp/sign-in (parent tab) with their existing account.`
  );
}

main().catch((err) => {
  console.error("[backfill-path-families] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
