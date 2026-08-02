/**
 * Backfill `children.fp_username` for EVERY existing child that lacks one
 * (Slice B Unit 12) — funnel / FW / Path / FP alike, because any The120 child
 * can log into First Profit. Service-role, machine-bound (.env.local carries the
 * key), like scripts/backfill-path-families.ts.
 *
 *   DRY-RUN (default — writes NOTHING, reports what it WOULD fill):
 *     npm run fp:backfill-usernames
 *
 *   APPLY (actually writes):
 *     npm run fp:backfill-usernames -- --apply
 *
 * This is a LARGE PRODUCTION WRITE. It is BATCHED (keyset-paged, ≤1000/page),
 * IDEMPOTENT (fills only still-NULL rows, never reassigns), DETERMINISTIC
 * (ascending id), and GLOBALLY UNIQUE (in-run taken-set seeded from all existing
 * usernames + the suffixer + a 23505 re-pick). Safe to run INCREMENTALLY and to
 * RE-RUN: a second run picks up only the rows the first left NULL. Fail-loud —
 * any unexpected db error aborts with a summary of what was done.
 *
 * ⚠ PRECONDITION: the U12 migration (20260831120000_fp_children_username.sql,
 *   AUTHORED-NOT-APPLIED) must be APPLIED first — the `fp_username` column and
 *   its partial-unique index must exist, or every assign errors. Run this only
 *   AFTER the human applies that migration at the gate.
 */

import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadSupabaseEnv } from "./load-env";
import {
  backfillUsernames,
  type AssignOutcome,
  type BackfillDb,
  type BackfillSummary,
} from "./backfill-fp-username-core";

const PAGE_SIZE = 500; // ≤ the PostgREST 1000-row cap; keyset-paged.

export function makeDb(db: SupabaseClient): BackfillDb {
  return {
    async pageUsernames(after, limit) {
      let q = db
        .from("children")
        .select("fp_username")
        .not("fp_username", "is", null)
        .order("fp_username", { ascending: true })
        .limit(limit);
      if (after !== null) q = q.gt("fp_username", after);
      const res = await q;
      if (res.error) throw new Error(`pageUsernames failed: ${res.error.message}`);
      return ((res.data as Array<{ fp_username?: unknown }> | null) ?? [])
        .map((r) => r.fp_username)
        .filter((u): u is string => typeof u === "string");
    },
    async pageMissing(afterId, limit) {
      let q = db
        .from("children")
        .select("id, first_name")
        .is("fp_username", null)
        .order("id", { ascending: true })
        .limit(limit);
      if (afterId !== null) q = q.gt("id", afterId);
      const res = await q;
      if (res.error) throw new Error(`pageMissing failed: ${res.error.message}`);
      return ((res.data as Array<{ id?: unknown; first_name?: unknown }> | null) ?? []).map((r) => ({
        id: String(r.id),
        firstName: typeof r.first_name === "string" ? r.first_name : "",
      }));
    },
    async assign(childId, username): Promise<AssignOutcome> {
      // Idempotency guard: write ONLY while still null. `.select` returns the
      // affected rows so a 0-row update (already filled) is distinguishable.
      const res = await db
        .from("children")
        .update({ fp_username: username })
        .eq("id", childId)
        .is("fp_username", null)
        .select("id");
      if (res.error) {
        if ((res.error as { code?: unknown }).code === "23505") return { outcome: "conflict" };
        return { outcome: "error", message: res.error.message };
      }
      const rows = (res.data as unknown[] | null) ?? [];
      return rows.length > 0 ? { outcome: "assigned" } : { outcome: "already_filled" };
    },
  };
}

/**
 * Run the backfill over an INJECTED Supabase client and print the summary. Split
 * out of `main` so the wiring (makeDb + the core + the report) is exercised by an
 * in-process smoke test against a fake client — the entrypoint's LOADABILITY and
 * its dep chain are otherwise unproven, because the suite imports only the pure
 * -core (see docs/solutions/build-issues/a-standalone-script-...-run-the-entrypoint).
 * A `log` sink is injectable so the smoke test can capture output silently.
 */
export async function runBackfill(
  db: SupabaseClient,
  opts: { apply: boolean; pageSize?: number; log?: (line: string) => void }
): Promise<BackfillSummary> {
  const log = opts.log ?? console.log;
  log(
    opts.apply
      ? "fp:backfill-usernames — APPLY mode: writing fp_username to every still-NULL child.\n"
      : "fp:backfill-usernames — DRY-RUN (default): no writes. Pass --apply to write.\n"
  );

  const summary = await backfillUsernames(makeDb(db), {
    apply: opts.apply,
    pageSize: opts.pageSize ?? PAGE_SIZE,
  });

  log(
    [
      "",
      `  mode:               ${summary.apply ? "APPLY" : "DRY-RUN"}`,
      `  children scanned:   ${summary.scanned}`,
      `  ${summary.apply ? "usernames filled:  " : "would fill:         "} ${summary.filled}`,
      `  already filled:     ${summary.skipped}`,
      `  suffix collisions:  ${summary.suffixed}`,
      `  23505 re-picks:     ${summary.conflictsResolved}`,
      `  name fallbacks:     ${summary.fallbacks} (unfoldable name → 'student' base)`,
      "",
      "  sample assignments:",
      ...summary.samples.map((s) => `    ${s.childId}  →  ${s.username}`),
      "",
    ].join("\n")
  );

  if (!summary.apply) {
    log("DRY-RUN complete — re-run with --apply to write these usernames.");
  } else {
    log(`APPLY complete — ${summary.filled} usernames written, ${summary.skipped} already present.`);
  }
  return summary;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await runBackfill(db, { apply });
}

// Run main ONLY when executed as the entrypoint (`tsx scripts/backfill-fp-username.ts`),
// not when a test imports this module for the loadability smoke — otherwise the
// import would fire main(), hit loadSupabaseEnv(), and process.exit on missing env.
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[backfill-fp-username] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
