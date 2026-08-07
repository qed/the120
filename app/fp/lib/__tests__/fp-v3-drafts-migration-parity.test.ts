import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COVER_STATUSES } from "../cover-store-rules";

// ── Migration ↔ TS parity (the SQL is a copy the node suite can't run) ──
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
// parse-migration-file: any closed set living in BOTH a TS artifact and the .sql
// migration needs a parity test that parses the migration as text, or the two
// drift silently (no test DB here). `cover_status` is exactly that set: it is
// COVER_STATUSES in app/fp/lib/cover-store-rules.ts AND the cover_status CHECK
// list in 20260912120000_fp_v3_onboarding_drafts.sql. The drift is one-directional
// and nasty: adding a status to the TS union without adding it to the CHECK makes
// every write of that status a 23514 at runtime, on the cover pipeline, in prod.
//
// SCOPE NOTE: the drafts `status` CHECK ('active' | 'consumed' | 'reaped') is
// covered only STRUCTURALLY below, because there is NO corresponding TS union in
// this repo today (the reaper/provisioning code that will name those values lands
// in later units). A union invented here purely to have something to compare
// against would be a test asserting against itself; when a real one appears, add
// the same `toEqual` parity assertion the cover_status case uses.
describe("migration parity: 20260912120000_fp_v3_onboarding_drafts.sql", () => {
  const raw = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260912120000_fp_v3_onboarding_drafts.sql"),
    "utf8"
  );
  // Strip `--` line comments so the structural assertions test the DDL, never the
  // explanatory prose (which spells the whole status vocabulary out in English).
  const sql = raw.replace(/--[^\n]*/g, "");

  const checkList = (column: string): string[] => {
    const m = sql.match(new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, "i"));
    expect(m, `check (${column} in (...))`).not.toBeNull();
    return m![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
  };

  it("the `cover_status` CHECK lists exactly COVER_STATUSES, in order", () => {
    expect(checkList("cover_status")).toEqual([...COVER_STATUSES]);
  });

  it("the default cover_status is a member of COVER_STATUSES", () => {
    const m = sql.match(/cover_status\s+text\s+not\s+null\s+default\s+'([a-z_]+)'/i);
    expect(m, "cover_status text not null default '...'").not.toBeNull();
    expect([...COVER_STATUSES]).toContain(m![1]);
  });

  it("the draft `status` CHECK is the documented three-state lifecycle", () => {
    // Structural only (no TS union to compare against yet — see the SCOPE NOTE).
    expect(checkList("status")).toEqual(["active", "consumed", "reaped"]);
    const m = sql.match(/\bstatus\s+text\s+not\s+null\s+default\s+'([a-z_]+)'/i);
    expect(m, "status text not null default '...'").not.toBeNull();
    expect(m![1]).toBe("active");
  });

  it("is TEXT + CHECK, never a native enum (additive evolution must stay cheap)", () => {
    // ALTER TYPE ... ADD VALUE cannot run inside the single implicit transaction
    // our Management-API applies use, and enum values can never be removed.
    expect(/create\s+type/i.test(sql)).toBe(false);
  });

  it("RLS is enabled and the client roles hold no grants (service-role only)", () => {
    expect(
      /alter\s+table\s+public\.fp_onboarding_drafts\s+enable\s+row\s+level\s+security/i.test(sql)
    ).toBe(true);
    expect(/revoke\s+all\s+on\s+public\.fp_onboarding_drafts\s+from\s+anon,\s*authenticated/i.test(sql)).toBe(
      true
    );
    // Zero policies: a draft holds a minor's name, age, answers, and photo key.
    expect(/create\s+policy/i.test(sql)).toBe(false);
  });

  it("keeps the reaper's own-column signal: child_id SET NULL, parent_id CASCADE", () => {
    expect(/parent_id\s+uuid\s+not\s+null\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i.test(sql)).toBe(
      true
    );
    expect(/child_id\s+uuid\s+references\s+public\.children\s*\(\s*id\s*\)\s+on\s+delete\s+set\s+null/i.test(sql)).toBe(
      true
    );
  });
});
