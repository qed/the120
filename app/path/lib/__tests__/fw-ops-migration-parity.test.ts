import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FW_OPS_AUDIT_ACTIONS } from "../fw-ops-rules";

/**
 * Migration ↔ intent parity for FW Unit 5's two migrations — the ops audit table
 * (plus the two attribution columns) and the cohort's event timezone.
 *
 * Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
 * parse-migration-file-2026-07-22.md: this repo has no test database, so the
 * FIRST execution of this DDL is against production. Everything below parses the
 * migration as TEXT and asserts the properties a live apply would otherwise be
 * the only witness to.
 *
 * Every assertion here was mutation-checked across classes — delete a column,
 * substitute an action value, relocate a trigger, comment out the RLS line — and
 * each reddens at least one test. An assertion satisfied by prose or by a
 * different statement elsewhere in the file is worse than no assertion at all
 * (docs/solutions/test-failures/migration-parity-assertions-that-cannot-fail-…).
 */

const AUDIT_MIGRATION = "supabase/migrations/20260801120000_fw_ops_audit.sql";
const TZ_MIGRATION = "supabase/migrations/20260801130000_fw_cohort_time_zone.sql";

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
/** Strip `--` line comments so structural assertions test the DDL, never the
 *  prose — which discusses "restrict", "unique", "revoked" in English at
 *  length. This is the half of the Unit 3 P1 that shipped green twice. */
const strip = (raw: string) => raw.replace(/--[^\n]*/g, "");

const auditSql = strip(read(AUDIT_MIGRATION));
const tzSql = strip(read(TZ_MIGRATION));

/** The balanced-paren body of `create table … public.<name> ( … )`. */
function createTableBody(sql: string, name: string): string {
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

const body = createTableBody(auditSql, "path_fw_ops_audit");

describe("path_fw_ops_audit — the columns the core writes", () => {
  it("is created idempotently, so a re-apply is a no-op", () => {
    expect(auditSql).toMatch(/create table if not exists public\.path_fw_ops_audit/);
  });

  it("carries every column recordFwOpsAudit writes", () => {
    // A missing column here is a runtime PostgREST error the moment staff revoke
    // a grant, i.e. a SILENT audit gap — which is the exact failure the CRM
    // allowlist learning documents.
    for (const column of ["actor", "action", "subject_user_id", "cohort_id", "metadata"]) {
      expect(body, column).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("requires an actor, a subject, and a cohort — an audit row with a hole is not evidence", () => {
    expect(body).toMatch(/actor\s+uuid\s+not null/);
    expect(body).toMatch(/subject_user_id\s+uuid\s+not null/);
    expect(body).toMatch(/cohort_id\s+uuid\s+not null/);
  });

  it("allows EXACTLY the action vocabulary FW_OPS_AUDIT_ACTIONS declares", () => {
    // The two-enforcement-point drift from docs/solutions/best-practices/
    // crm-audit-action-allowlist-db-check-constraint-drifts-from-ts-enum-…:
    // `offer-email` lived in the TS array and not in the CHECK, so the insert
    // failed at runtime as a lost audit record. Parsing the CONSTRAINT and
    // comparing SETS (not "contains") means adding to either side alone is red.
    const check = /check\s*\(\s*action\s+in\s*\(([^)]*)\)\s*\)/i.exec(body);
    expect(check, "no `check (action in (…))` on path_fw_ops_audit").not.toBeNull();
    const allowed = [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(allowed).toEqual([...FW_OPS_AUDIT_ACTIONS].sort());
  });

  it("every FK is ON DELETE RESTRICT — the record outlives the relationship", () => {
    const references = [...body.matchAll(/references\s+[\w.]+\s*\([^)]*\)\s*([^,]*)/g)].map(
      (m) => m[1]
    );
    expect(references.length).toBeGreaterThanOrEqual(3); // actor, subject, cohort
    for (const clause of references) {
      expect(clause.toLowerCase()).toContain("on delete restrict");
      expect(clause.toLowerCase()).not.toContain("cascade");
    }
  });
});

describe("path_fw_ops_audit — immutability", () => {
  it("defines the trigger function that refuses every modification", () => {
    expect(auditSql).toMatch(
      /create or replace function public\.prevent_path_fw_ops_audit_modification/
    );
    expect(auditSql).toMatch(/raise exception 'path_fw_ops_audit entries are immutable'/);
  });

  it("wires that function to BOTH update and delete, on THIS table", () => {
    // Asserted as whole statements — each match runs from `create trigger` to
    // its `execute function …()`, so the name, the event, the RELATION, and the
    // function all have to belong to the same statement. Matching them as
    // independent substrings anywhere in the file would still pass if a refactor
    // pointed one of them at a different relation, which is the Unit 3 P1's
    // shape exactly.
    //
    // Parsed by regex rather than by splitting on `;`, because these live inside
    // the migration's `do $$ … $$` idempotence guard and a semicolon split cuts
    // them in half.
    const statements = [
      ...auditSql.matchAll(/create trigger\s+[\s\S]*?execute function\s+[\w.]+\(\)/gi),
    ].map((m) => m[0]);
    expect(statements).toHaveLength(2);

    const update = statements.find((s) => s.includes("path_fw_ops_audit_no_update"));
    const del = statements.find((s) => s.includes("path_fw_ops_audit_no_delete"));
    for (const [statement, event] of [
      [update, "update"],
      [del, "delete"],
    ] as const) {
      expect(statement, `no create trigger for ${event}`).toBeDefined();
      expect(statement).toMatch(new RegExp(`before ${event} on public\\.path_fw_ops_audit`));
      expect(statement).toMatch(
        /execute function public\.prevent_path_fw_ops_audit_modification\(\)/
      );
    }
  });

  it("RLS is enabled and no policy is created — service-role only (Decision 1)", () => {
    // Belt and braces with the triggers, and they cover different holes: RLS
    // stops anon/authenticated, the triggers stop the SERVICE ROLE that every
    // writer here actually holds and that RLS does not constrain.
    expect(auditSql).toMatch(/alter table public\.path_fw_ops_audit enable row level security/);
    expect(auditSql).not.toMatch(/create policy/i);
  });

  it("seeds and backfills nothing — schema-only phase", () => {
    expect(auditSql).not.toMatch(/\binsert\s+into\b/i);
    expect(auditSql).not.toMatch(/\bupdate\s+public\./i);
  });
});

describe("the attribution columns the plan's Scope Boundaries assume", () => {
  it("adds path_fw_board_tokens.revoked_by, idempotently and nullably", () => {
    // Unit 1 recorded who MINTED a token and when one was killed, but never who
    // killed it — so an explicit revoke (the one that leaves a board dark)
    // named nobody.
    const statement = auditSql
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.includes("path_fw_board_tokens") && s.includes("revoked_by"));
    expect(statement, "no statement adds revoked_by").toBeDefined();
    expect(statement).toMatch(/add column if not exists revoked_by uuid/);
    expect(statement).toMatch(/references auth\.users \(id\) on delete restrict/);
    expect(statement).not.toMatch(/not null/i);
  });

  it("adds path_cohorts.created_by, idempotently and nullably", () => {
    // Nullable is load-bearing: every existing Path cohort was created by seed
    // scripts and SQL, and a fabricated creator would be worse than a null.
    const statement = auditSql
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.includes("path_cohorts") && s.includes("created_by"));
    expect(statement, "no statement adds created_by").toBeDefined();
    expect(statement).toMatch(/add column if not exists created_by uuid/);
    expect(statement).toMatch(/references auth\.users \(id\) on delete restrict/);
    expect(statement).not.toMatch(/not null/i);
  });
});

describe("path_cohorts.time_zone", () => {
  it("is added idempotently, as nullable text", () => {
    expect(tzSql).toMatch(/alter table public\.path_cohorts/);
    expect(tzSql).toMatch(/add column if not exists time_zone text/);
    expect(tzSql).not.toMatch(/time_zone text not null/i);
  });

  it("carries NO check constraint — one enforcement point, in fw-ops-rules.ts", () => {
    // Deliberate, and the opposite call from the audit action above. That value
    // gates a write path and is worth two agreeing enforcement points pinned by
    // a test; this one is display provenance, gates nothing, and a DB allowlist
    // would be a second list to drift (the CRM learning, applied in reverse).
    expect(tzSql).not.toMatch(/check\s*\(/i);
  });

  it("seeds and backfills nothing", () => {
    expect(tzSql).not.toMatch(/\binsert\s+into\b/i);
    expect(tzSql).not.toMatch(/\bupdate\s+public\./i);
  });
});
