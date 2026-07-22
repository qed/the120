/**
 * Seed the Path content skeleton (plan T1 Unit 4, seed half; brief §10).
 *
 *   npm run seed:path-content
 *
 * Inserts the structural rows — versions, phases, criteria, unit tasks — that
 * the progress engine (Unit 7) and evidence pipeline (Units 8, 10) reference by
 * FK. NO curriculum prose is written: titles, bodies, Done-when lines, and band
 * variants stay in the generated TS module (Decision 7). The rows come from the
 * pure `buildProgramRows` builder, which is unit-tested; this script is the thin
 * I/O shell around it.
 *
 * Idempotent: every upsert is ON CONFLICT DO NOTHING (`ignoreDuplicates`), and
 * content rows are immutable per version (D27). A second run inserts nothing. A
 * curriculum revision ships a new generated module under a new version id, whose
 * rows are namespaced by `program_version_id` and therefore purely additive —
 * every first-version row stays byte-identical.
 *
 * TWO OPERATIONAL SHARP EDGES this idempotency implies (both by design, both
 * verified against reality here rather than hidden):
 *
 *   1. Re-seeding a CHANGED same-version module writes NOTHING. ON CONFLICT DO
 *      NOTHING keys only on the PK, never comparing seq/phase_key/etc., so a
 *      corrected module under an unchanged version id is a silent no-op — the DB
 *      keeps the old values and prints "Done." To change a version's content,
 *      ship it under a NEW version id (D27). If a version must genuinely be
 *      re-seeded before any student is pinned to it, delete its rows first; do
 *      not expect an in-place update.
 *
 *   2. Moving the is_current pin to a new version is a DELIBERATE TWO-STEP, not
 *      an automatic effect of registering a new module and bumping
 *      CURRENT_VERSION. The partial unique index `path_program_versions_one_current`
 *      forbids two is_current=true rows, and the versions upsert's ON CONFLICT is
 *      keyed on `id` only (it does not cover that index), so inserting a new
 *      current version while the old one is still current fails hard. Flip the
 *      old row's is_current to false first (a manual UPDATE), THEN seed. verify()
 *      below asserts exactly one is_current row and that it is CURRENT_VERSION,
 *      so a mispinned or unpinned state fails loudly instead of stranding Unit 6.
 *
 * Prerequisite: the DDL migration
 * (supabase/migrations/20260721120000_path_program_content.sql) must be APPLIED
 * — a committed migration is not an applied migration. This script prechecks its
 * own tables and aborts with a named error if they are missing, rather than
 * inserting into tables that only exist once the DDL has actually run.
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL from the
 * environment, falling back to .env.local. Machine-bound: the service-role key
 * lives in .env.local on the build machine only.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Side effect: registers PROGRAM_2026_27 with the manifest registry. The seed
// enumerates every registered version, so a future version's generated module
// added to this import list is seeded with no other change.
import "../app/path/content/generated/program-2026-27";
import { getProgram, registeredVersions } from "../app/path/content/manifest";
import {
  buildProgramRows,
  buildUpsertSteps,
  checkSeed,
  expectationFromRows,
  type ProgramRows,
} from "../app/path/content/seed-rows";

/** The version new students pin to. Its row carries is_current = true. */
const CURRENT_VERSION = "2026-27";

const TABLES = [
  "path_program_versions",
  "path_phases",
  "path_criteria",
  "path_unit_tasks",
] as const;

/** Minimal .env.local parser (values may be quoted); env vars win. Mirrors seed-staff.ts. */
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
 * Probe one table's existence via PostgREST. `.select("*").limit(0)` — NOT a
 * `{ head: true }` count probe — is the shape that actually validates the
 * relation: verified against the real project, `select("*", { head: true })`
 * returns 204/no-error even for a table that does NOT exist, so the old probe
 * could never detect a missing table (it always reported "ready"), silently
 * defeating the precheck this script's docstring promises. `.limit(0)` instead
 * returns PGRST205 ("Could not find the table … in the schema cache") when the
 * relation is absent, and no error when it exists.
 *
 * The distinction the caller needs: PGRST205 means "not there YET" — the
 * migration is unapplied, or PostgREST's schema cache is still catching up right
 * after a fresh DDL apply — and is retryable. ANY OTHER error (a stale/invalid
 * service-role key, a wrong URL, a network failure) is NOT a missing table and
 * must surface as itself, or the operator is told to re-apply a migration that
 * is already fine — a documented failure mode in this repo's Supabase history.
 */
type TableProbe = { present: boolean; retryableAbsent: boolean; error: string | null };

async function probeTable(admin: SupabaseClient, table: string): Promise<TableProbe> {
  const { error } = await admin.from(table).select("*").limit(0);
  if (!error) return { present: true, retryableAbsent: false, error: null };
  if (error.code === "PGRST205") {
    return { present: false, retryableAbsent: true, error: error.message };
  }
  return {
    present: false,
    retryableAbsent: false,
    error: `${error.code ?? "?"}: ${error.message}`,
  };
}

/**
 * Wait for all four content tables to be present. Tolerates the brief PostgREST
 * schema-cache lag right after a Management-API DDL apply (retries the PGRST205
 * case); fails FAST and loud on any non-missing-table error (auth/network) so a
 * credentials problem is never misreported as "apply the migration"; and aborts
 * with a named error citing the migration if the tables genuinely never appear.
 */
async function waitForTables(admin: SupabaseClient): Promise<void> {
  const attempts = 6;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const probes = await Promise.all(TABLES.map((t) => probeTable(admin, t)));

    // Fail fast on a real (non-missing-table) error — do not retry or misreport it.
    const fatal = probes.find((p) => p.error !== null && !p.retryableAbsent);
    if (fatal) {
      throw new Error(
        `Could not reach the Path content tables, and this is NOT a missing-table ` +
          `condition: ${fatal.error}. Check SUPABASE_SERVICE_ROLE_KEY, ` +
          `NEXT_PUBLIC_SUPABASE_URL, and connectivity — do NOT re-apply the migration.`
      );
    }

    if (probes.every((p) => p.present)) return;

    const missing = TABLES.filter((_, i) => !probes[i].present);
    if (attempt === attempts) {
      throw new Error(
        `Path content tables not found: ${missing.join(", ")}. Apply the DDL ` +
          `migration first — supabase/migrations/20260721120000_path_program_content.sql ` +
          `via the Management API (docs/solutions/integration-issues/supabase-cli-` +
          `stale-db-password-management-api-workaround-2026-07-13.md) — then re-run. ` +
          `A committed migration is not an applied migration.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function seedVersion(admin: SupabaseClient, versionId: string): Promise<ProgramRows> {
  const rows = buildProgramRows(getProgram(versionId), {
    isCurrent: versionId === CURRENT_VERSION,
  });

  // FK order (parents before children), with onConflict targets typed and
  // colocated with the row shapes in buildUpsertSteps so they cannot silently
  // drift from the migration's primary keys. ON CONFLICT DO NOTHING makes a
  // re-run a true no-op (the builder is deterministic) and a new version additive.
  for (const step of buildUpsertSteps(rows)) {
    // The service-role client is untyped (no Database generic), so column typing
    // cannot flow to the wire here anyway; widen to the shapes it accepts. The
    // typed table↔rows↔onConflict correlation lives — and is unit-tested against
    // the migration PKs — in buildUpsertSteps, not at this boundary.
    const table: string = step.table;
    const data: object[] = step.rows;
    const { error } = await admin
      .from(table)
      .upsert(data, { onConflict: step.onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`upsert into ${step.table} failed: ${error.message}`);
  }

  return rows;
}

/**
 * Verify against the DB by reconciling observed state with what was actually
 * BUILT this run (checkSeed) — never a hard-coded total, which becomes a false
 * failure the moment a second version is registered. Counts each table and,
 * critically, checks the is_current pin: exactly one row, and it is
 * CURRENT_VERSION. Unit 6 reads that pin to lock a student to a curriculum
 * version, and ON CONFLICT DO NOTHING cannot repair it once written wrong, so a
 * mispin must fail here rather than print "Done."
 *
 * (The old `criterion_id IS NULL` orphan probe is gone: the column is NOT NULL
 * with an FK, so that count is always 0 by construction — it proved nothing.
 * Referential completeness is instead confirmed by the per-table counts matching
 * the built rows, since an orphan could never have been inserted in the first
 * place.)
 */
async function verify(admin: SupabaseClient, built: ProgramRows[]): Promise<void> {
  async function count(table: string): Promise<number> {
    const { count: n, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(`count(${table}) failed: ${error.message}`);
    return n ?? 0;
  }

  const { data: currentRows, error: currentErr } = await admin
    .from("path_program_versions")
    .select("id")
    .eq("is_current", true);
  if (currentErr) throw new Error(`is_current check failed: ${currentErr.message}`);

  const observed = {
    versions: await count("path_program_versions"),
    phases: await count("path_phases"),
    criteria: await count("path_criteria"),
    tasks: await count("path_unit_tasks"),
    currentVersionIds: (currentRows ?? []).map((r) => String(r.id)),
  };

  for (const [key, value] of Object.entries(observed)) {
    console.log(`  ${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`);
  }

  const errors = checkSeed(expectationFromRows(built, CURRENT_VERSION), observed);
  if (errors.length > 0) {
    throw new Error(`Seed verification failed:\n  - ${errors.join("\n  - ")}`);
  }
}

async function main() {
  const { url, serviceRoleKey } = loadEnv();

  // Guard the pin target before touching the DB: if CURRENT_VERSION is not among
  // the registered modules, no version is seeded is_current=true and Unit 6 has
  // nothing to pin students to. Fail loudly rather than seed an unpinned set.
  const versions = registeredVersions();
  if (!versions.includes(CURRENT_VERSION)) {
    throw new Error(
      `CURRENT_VERSION "${CURRENT_VERSION}" is not registered (registered: ` +
        `${versions.join(", ") || "(none)"}). Import its generated module or fix ` +
        `CURRENT_VERSION — otherwise no version is seeded as the is_current pin.`
    );
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await waitForTables(admin);

  const built: ProgramRows[] = [];
  for (const versionId of versions) {
    const rows = await seedVersion(admin, versionId);
    built.push(rows);
    console.log(
      `seeded ${versionId}: ${rows.phases.length} phases, ${rows.criteria.length} criteria, ` +
        `${rows.tasks.length} tasks (is_current=${rows.version.is_current})`
    );
  }

  console.log("verification:");
  await verify(admin, built);
  console.log("Done. Seed is idempotent — a second run inserts nothing new.");
}

main().catch((err) => {
  console.error("[seed-path-content] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
