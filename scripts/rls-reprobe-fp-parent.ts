/**
 * Unit 11 RLS RE-PROBE — the FP parent principal, post-build (Slice B).
 *
 *   FP_PARENT_SESSION=<throwaway parent access token> npm run rls:reprobe
 *
 * Unit 0 GATED the introduction of the First Profit parent principal with a
 * reach audit (result: CLEAN — cross-family isolation holds; no CRM/staff data,
 * not even its own trigger-created `families` row, which is staff-gated; no
 * path_ or fw_ rows; fp_parental_consent is service-role-only). Unit 11 CONFIRMS
 * that audit still holds against the built schema. This script is that
 * confirmation, authored for a HUMAN to run against a real project during the
 * go-live window — it is NOT run in CI and touches no service-role key.
 *
 * SAFETY:
 *   - READ-ONLY. Every probe is a SELECT; the script never writes, and it uses
 *     the ANON key scoped by a PARENT access token (never the service-role key),
 *     so it can reach only what RLS lets a real parent reach.
 *   - Requires a HUMAN-SUPPLIED THROWAWAY parent session (FP_PARENT_SESSION): the
 *     access token of a disposable test-family parent, obtained out-of-band
 *     (e.g. the JSON tokens /api/fp/signup/verify returns). Do not use a real
 *     family's token.
 *   - To prove CROSS-FAMILY isolation (0 rows on ANOTHER family's rows), supply
 *     ids from a DIFFERENT family via the RLS_OTHER_* env below. These are
 *     REQUIRED for a green run: a SKIPPED cross-family check exits NON-ZERO
 *     (P3c), because cross-family isolation is the core property and a run that
 *     never probed it must not look like a pass.
 *
 * ENV:
 *   FP_PARENT_SESSION   (required)  the throwaway parent access token
 *   RLS_OTHER_CHILD_ID  (required for a green run)  a children.id of a DIFFERENT family
 *   RLS_OTHER_DEPOSIT_ID(required for a green run)  a deposits.id of a DIFFERENT family
 *   RLS_OTHER_PROJECT_ID(required for a green run)  a projects.id of a DIFFERENT family
 *
 * Prints PASS / FAIL / SKIP per check and exits non-zero if ANY check FAILs OR if
 * any cross-family check is SKIPPED (cross-family isolation left unexercised).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadSupabaseEnv } from "./load-env";

type Verdict = "PASS" | "FAIL" | "SKIP";
const results: Array<{ name: string; verdict: Verdict; detail: string }> = [];
function record(name: string, verdict: Verdict, detail: string): void {
  results.push({ name, verdict, detail });
  const mark = verdict === "PASS" ? "PASS" : verdict === "FAIL" ? "FAIL" : "SKIP";
  console.log(`[${mark}] ${name} — ${detail}`);
}

/** The cross-family isolation checks are the only skippable probes; a SKIP of one
 *  means cross-family isolation was NEVER exercised, so the run must NOT look
 *  green (P3c). Tracked here and turned into a non-zero exit in the summary. */
let crossFamilySkipped = 0;

/** A cross-family isolation probe: selecting a row that belongs to ANOTHER
 *  family MUST return 0 rows under RLS (never the row, never an error we would
 *  misread as access). */
async function probeCrossFamilyZero(
  db: SupabaseClient,
  table: string,
  otherId: string | undefined,
  name: string
): Promise<void> {
  if (!otherId) {
    crossFamilySkipped += 1;
    record(
      name,
      "SKIP",
      `no other-family id supplied — cross-family isolation NOT verified (set the RLS_OTHER_* env to run this)`
    );
    return;
  }
  const { data, error } = await db.from(table).select("id").eq("id", otherId);
  if (error) {
    // A permission-denied (42501) is also acceptable isolation; any other error
    // is inconclusive and must be investigated, so FAIL loudly.
    if (error.code === "42501") {
      record(name, "PASS", `denied (42501) — cannot even see another family's ${table} row`);
      return;
    }
    record(name, "FAIL", `unexpected error probing ${table}: ${error.code ?? ""} ${error.message}`);
    return;
  }
  const rows = data ?? [];
  if (rows.length === 0) record(name, "PASS", `0 rows on another family's ${table} row (isolated)`);
  else record(name, "FAIL", `saw ${rows.length} row(s) of another family's ${table} — LEAK`);
}

/** A service-role-only probe: a parent must see 0 rows (RLS zero-policy) or be
 *  denied (grants revoked). Either is correct; a returned row is a FAIL. */
async function probeServiceRoleOnly(db: SupabaseClient, table: string, name: string): Promise<void> {
  const { data, error } = await db.from(table).select("id").limit(1);
  if (error) {
    if (error.code === "42501") {
      record(name, "PASS", `denied (42501) — ${table} is service-role-only`);
      return;
    }
    record(name, "FAIL", `unexpected error on ${table}: ${error.code ?? ""} ${error.message}`);
    return;
  }
  const rows = data ?? [];
  if (rows.length === 0) record(name, "PASS", `0 rows visible on ${table} (RLS zero-policy)`);
  else record(name, "FAIL", `saw ${rows.length} row(s) on ${table} — should be service-role-only`);
}

async function main(): Promise<void> {
  // loadSupabaseEnv populates process.env from .env.local (and validates the
  // URL); we deliberately do NOT use the service-role key it returns — the probe
  // is parent-scoped via the anon key + the supplied session token.
  loadSupabaseEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (environment or .env.local).");
    process.exit(1);
  }
  const token = process.env.FP_PARENT_SESSION;
  if (!token) {
    console.error(
      "Missing FP_PARENT_SESSION — supply a THROWAWAY parent access token (never a real family's)."
    );
    process.exit(1);
  }

  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // 0. The token must resolve to a real user, or every probe below is vacuous.
  const who = await db.auth.getUser();
  if (who.error || !who.data?.user?.id) {
    console.error(`FP_PARENT_SESSION did not resolve to a user: ${who.error?.message ?? "no user"}`);
    process.exit(1);
  }
  console.log(`Probing as parent principal ${who.data.user.id}\n`);

  // 1-3. Cross-family isolation — 0 rows on ANOTHER family's children / deposits
  //      / projects (the Unit 0 core isolation, re-confirmed).
  await probeCrossFamilyZero(db, "children", process.env.RLS_OTHER_CHILD_ID, "cross-family children isolation");
  await probeCrossFamilyZero(db, "deposits", process.env.RLS_OTHER_DEPOSIT_ID, "cross-family deposits isolation");
  await probeCrossFamilyZero(db, "projects", process.env.RLS_OTHER_PROJECT_ID, "cross-family projects isolation");

  // 4. Own families row. Unit 0 found `families` STAFF-GATED — a parent sees 0
  //    rows, including its own trigger-created row. This probe therefore PASSES
  //    on 0 rows (isolation held). A non-zero count is NOT necessarily a leak (a
  //    later migration could have added a narrow parent-scoped SELECT), but it
  //    CONTRADICTS the Unit 0 finding, so it is surfaced as a FAIL to force a
  //    human reconciliation before go-live.
  {
    const { data, error } = await db.from("families").select("id, is_test");
    if (error) {
      if (error.code === "42501") {
        record("own families visibility", "PASS", "denied (42501) — families is staff-gated (Unit 0)");
      } else {
        record("own families visibility", "FAIL", `unexpected error: ${error.code ?? ""} ${error.message}`);
      }
    } else {
      const n = (data ?? []).length;
      if (n === 0) {
        record("own families visibility", "PASS", "0 rows — families staff-gated as Unit 0 found");
      } else {
        record(
          "own families visibility",
          "FAIL",
          `saw ${n} families row(s) — CONTRADICTS the Unit 0 staff-gated finding; reconcile before go-live`
        );
      }
    }
  }

  // 5. No path_* rows (service-role zero-policy).
  await probeServiceRoleOnly(db, "path_student_profiles", "no path_student_profiles rows");
  await probeServiceRoleOnly(db, "path_families", "no path_families rows");

  // 6. fp_parental_consent DENIED (service-role-only; the SPA never needs it —
  //    verdicts return in JSON). Denied (42501) or 0 rows are both correct.
  await probeServiceRoleOnly(db, "fp_parental_consent", "fp_parental_consent denied / invisible");

  // ── summary ──
  const fails = results.filter((r) => r.verdict === "FAIL");
  const skips = results.filter((r) => r.verdict === "SKIP");
  console.log(
    `\n${results.length - fails.length - skips.length} PASS, ${fails.length} FAIL, ${skips.length} SKIP`
  );
  if (fails.length > 0) {
    console.error("\nRLS RE-PROBE FAILED — do NOT proceed to go-live until reconciled:");
    for (const f of fails) console.error(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  // P3c — a SKIPPED cross-family check means cross-family isolation was NEVER
  // actually probed. Exit NON-ZERO (a loud FAIL-TO-VERIFY), so an ad-hoc run
  // without the RLS_OTHER_* envs can never look green while the core isolation
  // property went unexercised. The go-live checklist §D passes those envs, so a
  // real run never trips this.
  if (crossFamilySkipped > 0) {
    console.error(
      `\nRLS RE-PROBE FAIL-TO-VERIFY — ${crossFamilySkipped} cross-family isolation check(s) were ` +
        "SKIPPED, so cross-family isolation was NEVER exercised. This is NOT a pass. Re-run with " +
        "RLS_OTHER_CHILD_ID / RLS_OTHER_DEPOSIT_ID / RLS_OTHER_PROJECT_ID set to a DIFFERENT family's " +
        "ids (the go-live checklist §D supplies them)."
    );
    process.exit(1);
  }
  console.log("\nRLS re-probe complete — the Unit 0 parent-principal audit holds post-build.");
}

main().catch((err) => {
  console.error("[rls-reprobe] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
