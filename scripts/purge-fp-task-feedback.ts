/**
 * fp_task_feedback ~12-MONTH RETENTION PURGE — the runnable form of the ritual
 * documented in supabase/migrations/20260905120000_fp_task_feedback.sql
 * (feedback expires ~12 months after creation, INDEPENDENT of account
 * deletion; no pg_cron — the owner runs this periodically, e.g. quarterly,
 * alongside the R25 ledger purge review). Equivalent SQL:
 *
 *   delete from public.fp_task_feedback
 *    where created_at < now() - interval '12 months';
 *
 * ── AUTH: SERVICE-ROLE ONLY ──────────────────────────────────────────────────
 * The append-only trigger blocks PostgREST-client deletes; it exempts
 * service_role, which is exactly the principal this script uses
 * (loadSupabaseEnv reads .env.local; refuses without the key).
 *
 * ── FAIL-CLOSED CONFIRMATION ─────────────────────────────────────────────────
 * DRY-RUN by default: counts the rows older than the retention window, prints
 * the count, deletes NOTHING, exits 0. Only `--confirm` performs the delete.
 *
 * ── BATCHED DELETE (WAL discipline) ──────────────────────────────────────────
 * A real run deletes in id-selected batches (select ids LIMIT n → delete
 * in (ids) → repeat) rather than one unbounded DELETE, so a year's accumulation
 * never becomes a single giant WAL burst / long row-lock hold.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *   npm run fp:feedback:purge                 # dry-run: print the count, exit 0
 *   npm run fp:feedback:purge -- --confirm    # actually delete, in batches
 *
 * ── EXIT CODES ───────────────────────────────────────────────────────────────
 *   0  clean dry-run, or a confirmed purge that completed
 *   1  refusal (bad args / missing service-role env) or a query/delete failure
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadSupabaseEnv } from "./load-env";

/** Retention window: rows strictly older than this many months are purged. */
const RETENTION_MONTHS = 12;

/** Rows deleted per batch (id-selected; keeps each DELETE's WAL bounded). */
const BATCH_SIZE = 1000;

/** now() - interval '12 months', computed the same way Postgres does (calendar
 *  months, UTC). The boundary is fuzzy by design ("~12-month ritual"). */
function retentionCutoffIso(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - RETENTION_MONTHS);
  return d.toISOString();
}

async function countExpired(db: SupabaseClient, cutoffIso: string): Promise<number> {
  const res = await db
    .from("fp_task_feedback")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoffIso);
  if (res.error) {
    console.error(`[purge-fp-task-feedback] FAIL — count query: ${res.error.message}`);
    process.exit(1);
  }
  return res.count ?? 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const confirm = argv.includes("--confirm");
  const unknown = argv.filter((a) => a !== "--confirm");
  if (unknown.length > 0) {
    console.error(`[purge-fp-task-feedback] REFUSED — unknown argument(s): ${unknown.join(" ")} (only --confirm is accepted).`);
    process.exit(1);
  }

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoffIso = retentionCutoffIso();
  console.log(
    `[purge-fp-task-feedback] retention window ${RETENTION_MONTHS} months — targeting rows with created_at < ${cutoffIso}`
  );

  const total = await countExpired(db, cutoffIso);

  if (!confirm) {
    console.log(`[purge-fp-task-feedback] DRY-RUN (default) — ${total} row(s) WOULD be deleted. Nothing was deleted.`);
    if (total > 0) {
      console.log("To perform the purge, re-run with: --confirm");
    }
    console.log("[purge-fp-task-feedback] PASS — dry-run complete, no changes made.");
    process.exit(0);
  }

  if (total === 0) {
    console.log("[purge-fp-task-feedback] PASS — nothing to purge (0 expired rows).");
    process.exit(0);
  }

  console.log(`[purge-fp-task-feedback] CONFIRMED — deleting ${total} row(s) in batches of ${BATCH_SIZE}.\n`);
  let deleted = 0;
  for (;;) {
    // id-selected batch: bound each DELETE (WAL / lock-hold discipline).
    const batch = await db
      .from("fp_task_feedback")
      .select("id")
      .lt("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (batch.error) {
      console.error(`[purge-fp-task-feedback] FAIL — batch select after ${deleted} deleted: ${batch.error.message}`);
      process.exit(1);
    }
    const ids = ((batch.data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) break;

    const del = await db.from("fp_task_feedback").delete().in("id", ids);
    if (del.error) {
      console.error(`[purge-fp-task-feedback] FAIL — batch delete after ${deleted} deleted: ${del.error.message}`);
      process.exit(1);
    }
    deleted += ids.length;
    console.log(`  batch deleted: ${ids.length} (running total ${deleted})`);
  }

  const remaining = await countExpired(db, cutoffIso);
  if (remaining > 0) {
    console.error(`[purge-fp-task-feedback] FAIL — ${remaining} expired row(s) still remain after the loop; re-run.`);
    process.exit(1);
  }
  console.log(`\n[purge-fp-task-feedback] PASS — purge complete: ${deleted} row(s) deleted, 0 expired remain.`);
}

main().catch((err) => {
  console.error("[purge-fp-task-feedback] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
