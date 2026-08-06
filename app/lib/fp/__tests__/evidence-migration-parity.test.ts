import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVIDENCE_KINDS } from "../evidence-rules";

// ── Migration ↔ TS parity (the SQL is a copy the node suite can't run) ──
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
// parse-migration-file: any closed set living in BOTH a TS artifact and the .sql
// migration needs a parity test that parses the migration as text, or the two
// drift silently (no test DB here). The `kind` CHECK is that set.
describe("migration parity: path_evidence.sql", () => {
  const raw = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260722160000_path_evidence.sql"),
    "utf8"
  );
  // Strip `--` line comments so the structural assertions test the DDL, never the
  // explanatory prose (which discusses "unique", "cascade", etc. in English).
  const sql = raw.replace(/--[^\n]*/g, "");

  it("the `kind` CHECK lists exactly EVIDENCE_KINDS, in order", () => {
    const m = sql.match(/kind\s+text\s+not\s+null\s+check\s*\(\s*kind\s+in\s*\(([^)]*)\)/i);
    expect(m, "kind text not null check (kind in (...))").not.toBeNull();
    const kinds = m![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(kinds).toEqual([...EVIDENCE_KINDS]);
  });

  it("RLS is enabled on the evidence table (Decision 1: on, zero policies)", () => {
    expect(/alter\s+table\s+public\.path_evidence_items\s+enable\s+row\s+level\s+security/i.test(sql)).toBe(true);
  });

  it("every FK on the evidence table is ON DELETE RESTRICT — never a cascade into the keepsake", () => {
    // No `on delete cascade` / `set null` anywhere in this migration; RESTRICT only.
    expect(/on\s+delete\s+cascade/i.test(sql)).toBe(false);
    expect(/on\s+delete\s+set\s+null/i.test(sql)).toBe(false);
    expect(/on\s+delete\s+restrict/i.test(sql)).toBe(true);
  });

  it("the content hash is NOT enforced unique (advisory keep-both, no redaction-tombstone trap)", () => {
    // A unique index on sha256 would reintroduce the exact trap Decision #1 avoids.
    expect(/unique\s+index[^;]*\bsha256\b/i.test(sql)).toBe(false);
  });
});
