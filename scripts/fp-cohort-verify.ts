/** READ-ONLY verification of the First Profit beta cohort. Writes nothing.
 *
 *   npx tsx scripts/fp-cohort-verify.ts
 *
 * Per child, asserts the FULL login chain independently — `fp_player_profiles`
 * and `fp_player_saves` are checked SEPARATELY, because a profile without a
 * seeded save is the documented half-state that otherwise verifies green
 * (docs/solutions/logic-errors/compensate-by-stable-identity-...-2026-08-01.md).
 * Also enumerates ALL children under the 10 parents — not just the 17 roster
 * usernames — so a duplicate or orphan row is visible. */
import { createClient } from "@supabase/supabase-js";
import { loadSupabaseEnv } from "./load-env";
import { loadRoster } from "./fp-cohort-roster";
import { deriveStudentEmail } from "@/app/lib/fp/provision-rules";

/**
 * Parent address -> expected child usernames, derived from the LOCAL roster
 * (scripts/fp-cohort-roster.ts): real family data, not committed to this
 * public repo.
 */
const EXPECTED: Array<[string, string[]]> = loadRoster().map((f) => [
  f.email,
  f.children.map((c) => c.firstName.toLowerCase()),
]);

async function main() {
  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // One page-walk of auth users, reused for every derived .invalid address.
  const authIds = new Set<string>();
  for (let page = 1; page <= 100; page += 1) {
    const res = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (res.error) throw res.error;
    for (const u of res.data.users ?? []) if (u.email) authIds.add(u.email.toLowerCase());
    if ((res.data.users ?? []).length < 1000) break;
  }

  let pass = 0;
  let fail = 0;
  let extra = 0;

  for (const [email, names] of EXPECTED) {
    const p = await db.from("parents").select("id").ilike("email", email).maybeSingle();
    const parent = p.data as { id: string } | null;
    console.log(`\n${email}`);
    if (!parent) {
      console.log(`  !! no parents row`);
      fail += names.length;
      continue;
    }

    const kids = await db
      .from("children")
      .select("id, first_name, fp_username, grade, birth_year")
      .eq("parent_id", parent.id);
    const rows = (kids.data ?? []) as Array<{
      id: string; first_name: string; fp_username: string | null;
      grade: number | null; birth_year: string;
    }>;
    if (rows.length !== names.length) {
      console.log(`  !! ${rows.length} children under this parent, expected ${names.length} (duplicate or orphan?)`);
      extra += Math.abs(rows.length - names.length);
    }

    for (const row of rows) {
      const username = row.fp_username ?? "(none)";
      const problems: string[] = [];

      if (!row.fp_username) problems.push("no fp_username");
      if (row.grade === null) problems.push("no grade");
      if (!row.birth_year) problems.push("no birth_year");

      if (!authIds.has(deriveStudentEmail(row.id).toLowerCase())) problems.push("no auth user");

      const psp = await db.from("path_student_profiles").select("id").eq("child_id", row.id).maybeSingle();
      if (!psp.data) problems.push("no path_student_profiles");

      const fpp = await db.from("fp_player_profiles").select("id").eq("child_id", row.id).maybeSingle();
      const fppRow = fpp.data as { id: string } | null;
      if (!fppRow) {
        problems.push("no fp_player_profiles");
      } else {
        const sv = await db.from("fp_player_saves").select("profile_id").eq("profile_id", fppRow.id).maybeSingle();
        if (!sv.data) problems.push("no fp_player_saves (HALF-BUILT)");
      }

      if (problems.length === 0) {
        pass += 1;
        console.log(`  OK  ${row.first_name.padEnd(9)} ${username.padEnd(32)} grade ${row.grade} (birth_year ${row.birth_year})`);
      } else {
        fail += 1;
        console.log(`  !!  ${row.first_name.padEnd(9)} ${username.padEnd(32)} ${problems.join(", ")}`);
      }
    }
  }

  console.log(`\n--- VERIFY ---`);
  console.log(`  children fully provisioned: ${pass}`);
  console.log(`  children with problems:     ${fail}`);
  console.log(`  unexpected child count delta: ${extra}`);
  console.log("");
}

main().catch((err) => {
  console.error("[fp-cohort-verify] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
