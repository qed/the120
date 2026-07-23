import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration ↔ intent parity for the guide-invite table (FW Unit 2).
 *
 * Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
 * parse-migration-file-2026-07-22.md: this repo has no test database, so the
 * FIRST execution of this DDL is against production. Everything below parses the
 * migration as text and asserts the properties a live apply would otherwise be
 * the only witness to.
 *
 * Scoped deliberately: this file asserts the SHAPE the code depends on (the
 * columns fw-guide-core.ts reads and writes, the uniqueness that makes "a
 * re-issue kills the old hash" structural, RESTRICT, RLS). It does not re-assert
 * prose.
 */

const MIGRATION = "supabase/migrations/20260729120000_fw_guide_invites.sql";

const raw = readFileSync(path.resolve(process.cwd(), MIGRATION), "utf8");
// Strip `--` line comments so structural assertions test the DDL, never the
// explanatory prose (which discusses "unique", "restrict", "claim" in English).
const sql = raw.replace(/--[^\n]*/g, "");

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

const body = createTableBody("path_fw_guide_invites");

describe("path_fw_guide_invites — the columns the core actually uses", () => {
  it("is created idempotently, so a re-apply is a no-op", () => {
    expect(sql).toMatch(/create table if not exists public\.path_fw_guide_invites/);
  });

  it("carries every column fw-guide-core.ts reads or writes", () => {
    // A missing column here is a runtime PostgREST error on event morning, and
    // the node suite cannot otherwise see it.
    for (const column of [
      "user_id",
      "email",
      "token_hash",
      "expires_at",
      "claimed_at",
      "issued_at",
      "created_by",
    ]) {
      expect(body, column).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("stores the token ONLY as a hash — no raw-token column exists", () => {
    // A database read must never reconstruct a live credential (the invite.ts
    // threat posture, inherited).
    expect(body).toMatch(/token_hash\s+text\s+not null\s+unique/);
    expect(body).not.toMatch(/\btoken\s+text/);
  });

  it("is ONE row per guide account — what makes a re-issue kill the old hash", () => {
    // issueFwGuideInvite upserts on user_id. Without this unique constraint the
    // upsert would append, leaving two live tokens for one account and making
    // "the old link genuinely dies" false.
    expect(body).toMatch(/user_id\s+uuid\s+not null\s+unique/);
  });

  it("claimed_at is NULLABLE — a re-issue re-opens the claim (Decision 12)", () => {
    // The recovery path for a guide who forgot the password they set. A NOT NULL
    // claimed_at would make the only recovery a row delete.
    expect(body).not.toMatch(/claimed_at[^,]*not null/);
  });
});

describe("path_fw_guide_invites — delete and access posture", () => {
  it("every FK is ON DELETE RESTRICT, holding the Path graph's posture", () => {
    const references = [...body.matchAll(/references\s+[\w.]+\s*\([^)]*\)\s*([^,]*)/g)].map(
      (m) => m[1]
    );
    expect(references.length).toBeGreaterThanOrEqual(2); // user_id, created_by
    for (const clause of references) {
      expect(clause.toLowerCase()).toContain("on delete restrict");
      expect(clause.toLowerCase()).not.toContain("cascade");
    }
  });

  it("RLS is enabled and no policy is created — service-role only (Decision 1)", () => {
    expect(sql).toMatch(
      /alter table public\.path_fw_guide_invites enable row level security/
    );
    expect(sql).not.toMatch(/create policy/i);
  });

  it("has the open-invites index the pre-event 'all guides claimed' check reads", () => {
    // ONE statement, asserted as one. Matching the index name and the WHERE
    // predicate as independent substrings anywhere in the file would still pass
    // if a refactor split them across unrelated statements, leaving the partial
    // index un-predicated and the ops query scanning every invite ever issued
    // (data-migrations review).
    const statement = sql
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.includes("path_fw_guide_invites_open_idx"));
    expect(statement, "no statement creates path_fw_guide_invites_open_idx").toBeDefined();
    expect(statement).toMatch(/create index if not exists/);
    expect(statement).toMatch(/on public\.path_fw_guide_invites\s*\(\s*issued_at\s*\)/);
    expect(statement).toMatch(/where claimed_at is null/);
  });

  it("seeds and backfills nothing — schema-only phase", () => {
    // docs/solutions/workflow-issues/split-phase-migrations-…: schema and data
    // mutations never share a file.
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/\bupdate\s+public\./i);
  });
});
