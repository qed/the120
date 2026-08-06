import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration ↔ intent parity for FW Unit 7's one migration — the bulk importer's
 * exception table.
 *
 * Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
 * parse-migration-file-2026-07-22.md: this repo has no test database, so the FIRST
 * execution of this DDL is against production. Everything below parses the
 * migration as TEXT and asserts the properties a live apply would otherwise be the
 * only witness to.
 *
 * Each assertion was mutation-checked across classes — delete a column, flip a
 * CHECK value, drop the WHERE off the unique index, comment out the RLS line — and
 * reddens. An assertion satisfied by prose or by a different statement is worse
 * than none (docs/solutions/test-failures/migration-parity-assertions-that-cannot-
 * fail-…), so the structural assertions scan comment-STRIPPED SQL.
 */

const MIGRATION = "supabase/migrations/20260803120000_fw_import_exceptions.sql";
const BAND_MIGRATION = "supabase/migrations/20260803130000_fw_import_exceptions_band.sql";
const raw = readFileSync(path.resolve(process.cwd(), MIGRATION), "utf8");
/** Strip `--` line comments so structural assertions test the DDL, never the
 *  prose — which discusses "restrict", "unique", "pending" in English at length. */
const sql = raw.replace(/--[^\n]*/g, "");
const bandSql = readFileSync(path.resolve(process.cwd(), BAND_MIGRATION), "utf8").replace(
  /--[^\n]*/g,
  ""
);

/** The balanced-paren body of `create table … public.<name> ( … )`. */
function createTableBody(name: string): string {
  const at = sql.indexOf(`public.${name}`);
  expect(at, `create table public.${name}`).toBeGreaterThan(-1);
  const open = sql.indexOf("(", at);
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced parentheses in ${name}`);
}

const body = createTableBody("path_fw_import_exceptions");

describe("path_fw_import_exceptions — the columns the importer writes", () => {
  it("is created idempotently, so a re-apply is a no-op", () => {
    expect(sql).toMatch(/create table if not exists public\.path_fw_import_exceptions/);
  });

  it("carries every column the core reads and writes", () => {
    // A missing column is a runtime PostgREST error the moment the importer parks
    // an exception or the ops surface lists one — a silent gap until then.
    for (const column of [
      "cohort_id",
      "first_name",
      "last_name",
      "band",
      "normalized_name",
      "reason",
      "state",
      "created_by",
      "resolved_at",
      "resolved_by",
    ]) {
      expect(body, column).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("requires the fields an unresolved row cannot be actioned without", () => {
    expect(body).toMatch(/cohort_id\s+uuid\s+not null/);
    expect(body).toMatch(/first_name\s+text\s+not null/);
    expect(body).toMatch(/last_name\s+text\s+not null/);
    expect(body).toMatch(/band\s+text\s+not null/);
    expect(body).toMatch(/normalized_name\s+text\s+not null/);
    expect(body).toMatch(/reason\s+text\s+not null/);
    expect(body).toMatch(/created_by\s+uuid\s+not null/);
  });

  it("constrains band to EXACTLY the three the profile table allows", () => {
    const check = /band\s+text\s+not null\s+check\s*\(\s*band\s+in\s*\(([^)]*)\)/i.exec(body);
    expect(check, "no band CHECK").not.toBeNull();
    const bands = [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(bands).toEqual(["g3_5", "g6_8", "g9_12"]);
  });

  it("defaults state to pending and constrains it to the three lifecycle values", () => {
    expect(body).toMatch(/state\s+text\s+not null\s+default\s+'pending'/i);
    const check = /state\s+text[^,]*check\s*\(\s*state\s+in\s*\(([^)]*)\)/i.exec(body);
    expect(check, "no state CHECK").not.toBeNull();
    const states = [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(states).toEqual(["dismissed", "pending", "resolved"]);
  });

  it("every FK is ON DELETE RESTRICT — the exception outlives the relationship", () => {
    const references = [...body.matchAll(/references\s+[\w.]+\s*\([^)]*\)\s*([^,]*)/g)].map(
      (m) => m[1]
    );
    expect(references.length).toBeGreaterThanOrEqual(2); // cohort, created_by (+resolved_by)
    for (const clause of references) {
      expect(clause.toLowerCase()).toContain("on delete restrict");
      expect(clause.toLowerCase()).not.toContain("cascade");
    }
  });
});

describe("path_fw_import_exceptions — indexes and RLS", () => {
  it("indexes the G7 pending-name lookup, partial on state", () => {
    expect(sql).toMatch(
      /create index if not exists path_fw_import_exceptions_pending_name_idx\s+on public\.path_fw_import_exceptions \(normalized_name\)\s+where state = 'pending'/i
    );
  });

  it("indexes the cohort's open list, partial on state", () => {
    expect(sql).toMatch(
      /create index if not exists path_fw_import_exceptions_cohort_open_idx\s+on public\.path_fw_import_exceptions \(cohort_id\)\s+where state = 'pending'/i
    );
  });

  it("shipped the one-pending-per-name index (the ORIGINAL 2-column form, a frozen fact)", () => {
    // This file's text never changes, so it is pinned to the 2-column index it
    // created. The LIVE index is widened to include band by 20260803130000 (the
    // review fix), asserted separately below — the parity split mirrors how the
    // ops audit action-CHECK widening is pinned across two migrations.
    expect(sql).toMatch(
      /create unique index if not exists path_fw_import_exceptions_one_pending_per_name_idx\s+on public\.path_fw_import_exceptions \(cohort_id, normalized_name\)\s+where state = 'pending'/i
    );
  });

  it("RLS is enabled and no policy is created — service-role only (Decision 1)", () => {
    expect(sql).toMatch(
      /alter table public\.path_fw_import_exceptions enable row level security/
    );
    expect(sql).not.toMatch(/create policy/i);
  });

  it("seeds and backfills nothing, and is not built CONCURRENTLY", () => {
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/\bupdate\s+public\./i);
    expect(sql).not.toMatch(/concurrently/i);
  });
});

describe("the band-widening migration (20260803130000, review fix)", () => {
  it("DROPS the old index then recreates it UNIQUE on (cohort_id, normalized_name, band)", () => {
    // Both halves matter: the drop is what lets the recreate take the same name
    // with a different column list; the 3-column UNIQUE is what lets two
    // same-name-different-band children each hold their own pending exception.
    expect(bandSql).toMatch(
      /drop index if exists public\.path_fw_import_exceptions_one_pending_per_name_idx/i
    );
    expect(bandSql).toMatch(
      /create unique index if not exists path_fw_import_exceptions_one_pending_per_name_idx\s+on public\.path_fw_import_exceptions \(cohort_id, normalized_name, band\)\s+where state = 'pending'/i
    );
  });

  it("orders the drop BEFORE the recreate (a recreate-first order would no-op via `if not exists`)", () => {
    const dropAt = bandSql.search(/drop index if exists/i);
    const createAt = bandSql.search(/create unique index/i);
    expect(dropAt).toBeGreaterThanOrEqual(0);
    expect(createAt).toBeGreaterThan(dropAt);
  });

  it("is schema-only and not built CONCURRENTLY", () => {
    expect(bandSql).not.toMatch(/\binsert\s+into\b/i);
    expect(bandSql).not.toMatch(/\bupdate\s+public\./i);
    expect(bandSql).not.toMatch(/create table/i);
    expect(bandSql).not.toMatch(/concurrently/i);
  });
});
