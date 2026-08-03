/**
 * READ-ONLY owner view of fp_task_feedback — the cohort "Stuck? Tell us"
 * reports (supabase/migrations/20260905120000_fp_task_feedback.sql). Children
 * can only INSERT; there is no SELECT policy, so the OWNER reads via the
 * service-role key. This script is that read path (the migration's footer
 * points here), joining each row to fp_player_profiles.handle and to
 * public.children (first_name, grade) via fp_player_profiles.child_id,
 * newest first.
 *
 * Machine-bound like the sibling scripts (loadSupabaseEnv reads .env.local for
 * the service-role key; refuses without it). READ-ONLY: no writes of any kind.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *   npm run fp:feedback:read                    # newest MAX_ROWS rows, all time
 *   npm run fp:feedback:read -- --days 7        # only rows from the last 7 days
 *
 * ── EXIT CODES ───────────────────────────────────────────────────────────────
 *   0  rows printed (or an honest "no rows")
 *   1  refusal (bad args / missing service-role env) or a query failure
 */

import { createClient } from "@supabase/supabase-js";
import { loadSupabaseEnv } from "./load-env";

/** Upper bound on rows fetched per run (owner triage view, not an export). */
const MAX_ROWS = 500;

type FeedbackRow = {
  id: string;
  profile_id: string;
  task_id: string;
  band: string;
  body: string;
  created_at: string;
};

function parseDays(argv: string[]): number | null {
  const at = argv.indexOf("--days");
  if (at === -1) return null;
  const raw = argv[at + 1];
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n <= 0) {
    console.error(`[read-fp-task-feedback] REFUSED — --days requires a positive integer, got "${raw ?? ""}".`);
    process.exit(1);
  }
  return n;
}

/** One-line body preview: newlines flattened, long bodies elided. */
const preview = (body: string): string => {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "(no words — tap-only stuck signal)";
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
};

async function main(): Promise<void> {
  const days = parseDays(process.argv.slice(2));

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let q = db
    .from("fp_task_feedback")
    .select("id, profile_id, task_id, band, body, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (days !== null) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    q = q.gte("created_at", cutoff);
  }
  const feedback = await q;
  if (feedback.error) {
    console.error(`[read-fp-task-feedback] FAIL — feedback query: ${feedback.error.message}`);
    process.exit(1);
  }
  const rows = (feedback.data ?? []) as FeedbackRow[];
  const scope = days !== null ? `last ${days} day(s)` : "all time";
  if (rows.length === 0) {
    console.log(`[read-fp-task-feedback] PASS — no feedback rows (${scope}).`);
    process.exit(0);
  }

  // Resolve handle + child identity for the profiles that appear.
  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const profiles = await db
    .from("fp_player_profiles")
    .select("id, handle, child_id")
    .in("id", profileIds);
  if (profiles.error) {
    console.error(`[read-fp-task-feedback] FAIL — profiles query: ${profiles.error.message}`);
    process.exit(1);
  }
  const profileById = new Map(
    ((profiles.data ?? []) as { id: string; handle: string; child_id: string }[]).map((p) => [p.id, p])
  );

  const childIds = [...new Set([...profileById.values()].map((p) => p.child_id))];
  const children = childIds.length
    ? await db.from("children").select("id, first_name, grade").in("id", childIds)
    : { data: [], error: null };
  if (children.error) {
    console.error(`[read-fp-task-feedback] FAIL — children query: ${children.error.message}`);
    process.exit(1);
  }
  const childById = new Map(
    ((children.data ?? []) as { id: string; first_name: string; grade: string | null }[]).map((c) => [c.id, c])
  );

  console.log(`[read-fp-task-feedback] ${rows.length} row(s), ${scope}, newest first (max ${MAX_ROWS}):\n`);
  for (const r of rows) {
    const p = profileById.get(r.profile_id);
    const c = p ? childById.get(p.child_id) : undefined;
    const who = p
      ? `${p.handle} (${c ? `${c.first_name}, grade ${c.grade ?? "?"}` : "child row missing"})`
      : `profile ${r.profile_id} (missing)`;
    console.log(`${r.created_at}  task ${r.task_id}  band ${r.band}  ${who}`);
    console.log(`  ${preview(r.body)}`);
  }
  console.log(`\n[read-fp-task-feedback] PASS — read-only, nothing modified.`);
}

main().catch((err) => {
  console.error("[read-fp-task-feedback] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
