/**
 * fpv03 U3c — migrate every legacy (no-'@') `children.fp_username` onto the
 * email-shaped convention, keeping the old handle as a login alias:
 *
 *     fp_username_legacy := old fp_username
 *     fp_username        := deduped firstname.lastname@firstprofit.school
 *
 * Service-role, machine-bound (.env.local carries the key), modeled on
 * scripts/switch-fp-username.ts / backfill-fp-username.ts.
 *
 *   DRY-RUN (default — writes NOTHING, prints the full plan):
 *     npx tsx scripts/migrate-fp-usernames.ts
 *
 *   APPLY (actually writes):
 *     npx tsx scripts/migrate-fp-usernames.ts --confirm
 *
 * Per-child PASS/FAIL summary; a failed write never aborts the run (each child
 * is independent), but any failure makes the exit code 1.
 *
 * ⚠ PRECONDITIONS (deploy-first discipline):
 *   - migration 20260921120000 (fp_username_legacy column + guard + index)
 *     APPLIED, with a PostgREST schema reload;
 *   - the login deploy that resolves fp_username_legacy live BEFORE this runs,
 *     or a migrated child cannot sign in with the handle they memorized
 *     during the window.
 *
 * IDEMPOTENT: a migrated child has '@' in fp_username (skipped), and a child
 * with an existing legacy value is skipped too (never overwritten). The write
 * is guarded (`eq fp_username = old`) so a concurrent change loses cleanly.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadSupabaseEnv } from "./load-env";
import {
  applyPlannedMove,
  planUsernameMigration,
  type MigratableChild,
} from "./migrate-fp-usernames-core";

const PAGE_SIZE = 500; // ≤ the PostgREST 1000-row cap; keyset-paged by id.

async function loadChildren(db: SupabaseClient): Promise<MigratableChild[]> {
  const out: MigratableChild[] = [];
  let afterId: string | null = null;
  for (;;) {
    let q = db
      .from("children")
      .select("id, first_name, last_name, fp_username, fp_username_legacy")
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (afterId !== null) q = q.gt("id", afterId);
    const res = await q;
    if (res.error) throw new Error(`children page failed: ${res.error.message}`);
    const rows = (res.data as Array<Record<string, unknown>> | null) ?? [];
    for (const r of rows) {
      if (typeof r.id !== "string") continue;
      out.push({
        id: r.id,
        firstName: typeof r.first_name === "string" ? r.first_name : "",
        lastName: typeof r.last_name === "string" ? r.last_name : null,
        fpUsername: typeof r.fp_username === "string" ? r.fp_username : null,
        fpUsernameLegacy: typeof r.fp_username_legacy === "string" ? r.fp_username_legacy : null,
      });
    }
    if (rows.length < PAGE_SIZE) break;
    afterId = out[out.length - 1].id;
  }
  return out;
}

async function main() {
  const confirm = process.argv.includes("--confirm");

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const children = await loadChildren(db);

  // Seed the taken-ledger with EVERY existing handle in BOTH columns.
  const taken = new Set<string>();
  for (const c of children) {
    if (c.fpUsername) taken.add(c.fpUsername.toLowerCase());
    if (c.fpUsernameLegacy) taken.add(c.fpUsernameLegacy.toLowerCase());
  }

  const plan = planUsernameMigration(children, taken);

  console.log(
    `[migrate-fp-usernames] ${children.length} children scanned; ${plan.moves.length} to migrate, ${plan.skips.length} skipped.`
  );
  for (const skip of plan.skips) {
    if (skip.reason !== "already_email_shaped" && skip.reason !== "no_username") {
      console.log(`  SKIP  ${skip.childId}  (${skip.reason})`);
    }
  }
  for (const move of plan.moves) {
    console.log(`  PLAN  ${move.childId}  ${move.oldUsername} -> ${move.newUsername}`);
  }

  if (!confirm) {
    console.log(`[migrate-fp-usernames] DRY-RUN — nothing written. Re-run with --confirm to apply.`);
    return;
  }

  let pass = 0;
  let fail = 0;
  for (const move of plan.moves) {
    // Guarded write via the shared core (its concurrent-change FAIL branch is
    // unit-tested): a change since the scan is a clean zero-row FAIL, never a
    // clobber.
    const res = await applyPlannedMove(db, move);
    if (res.status === "error") {
      fail += 1;
      console.error(`  FAIL  ${move.childId}  ${move.oldUsername}: ${res.message}`);
      continue;
    }
    if (res.status === "changed") {
      fail += 1;
      console.error(`  FAIL  ${move.childId}  ${move.oldUsername}: row changed since scan (0 rows)`);
      continue;
    }
    pass += 1;
    console.log(`  PASS  ${move.childId}  ${move.oldUsername} -> ${move.newUsername}`);
  }

  console.log(`[migrate-fp-usernames] done: ${pass} PASS, ${fail} FAIL.`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[migrate-fp-usernames]", e instanceof Error ? e.message : e);
  process.exit(1);
});
