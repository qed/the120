import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BANDS } from "@/app/fp/content/types";

// ── Migration ↔ intent parity (the SQL is a copy the node suite can't run) ──
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
// parse-migration-file: this repo has no test database, so the FIRST execution of
// this DDL is against production. Everything below parses the migration as text
// and asserts the properties a live apply would otherwise be the only witness to.
//
// The XOR/superset CHECK gets stronger treatment than a spelling assertion: its
// predicate is extracted from the SQL and EVALUATED against the four row shapes,
// so a rewrite that still parses but admits an empty-identity row goes red.

const MIGRATION = "supabase/migrations/20260728120000_fw_cohort_sprints.sql";

const raw = readFileSync(path.resolve(process.cwd(), MIGRATION), "utf8");
// Strip `--` line comments so structural assertions test the DDL, never the
// explanatory prose (which discusses "cascade", "delete", "unique" in English).
const sql = raw.replace(/--[^\n]*/g, "");

/** The balanced-paren body of `add constraint <name> … check ( … )`. */
function checkBodyFor(constraintName: string): string {
  const at = sql.indexOf(`add constraint ${constraintName}`);
  expect(at, `add constraint ${constraintName}`).toBeGreaterThan(-1);
  const open = sql.indexOf("(", sql.indexOf("check", at));
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced parentheses in ${constraintName}`);
}

/**
 * Evaluate an `X is not null [and|or] …` predicate lifted from the migration
 * against a candidate row. Deliberately tiny: anything the translator does not
 * recognise throws rather than silently evaluating to something convenient.
 */
function evalNullPredicate(expr: string, row: Record<string, unknown>): boolean {
  const js = expr
    .replace(/\s+/g, " ")
    .replace(/(\w+)\s+is\s+not\s+null/gi, "(row.$1 !== null)")
    .replace(/(\w+)\s+is\s+null/gi, "(row.$1 === null)")
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||")
    .trim();
  if (!/^[\s()!&|.=\w]+$/.test(js)) {
    throw new Error(`unsupported predicate translated to: ${js}`);
  }
  return Function("row", `"use strict"; return (${js});`)(row) as boolean;
}

const PATH_ROW = { child_id: "child-1", first_name: null, last_name: null, band: null };
const FW_ROW = { child_id: null, first_name: "Maya", last_name: "Chen", band: "g6_8" };
const CONVERTED_ROW = { child_id: "child-1", first_name: "Maya", last_name: "Chen", band: "g6_8" };
const EMPTY_ROW = { child_id: null, first_name: null, last_name: null, band: null };
const HALF_FW_ROW = { child_id: null, first_name: "Maya", last_name: "Chen", band: null };

describe("FW migration parity: the superset identity CHECK (Decision 7)", () => {
  const expr = checkBodyFor("path_student_profiles_identity_present");

  it("admits a PATH row — child only", () => {
    expect(evalNullPredicate(expr, PATH_ROW)).toBe(true);
  });

  it("admits an FW row — name + band, no child", () => {
    expect(evalNullPredicate(expr, FW_ROW)).toBe(true);
  });

  it("admits a CONVERTED row — both — so FW→Path conversion stays a data operation", () => {
    // The whole reason this is a superset and not a strict XOR (Decision 7): a
    // strict XOR would make the conversion require another production migration.
    expect(evalNullPredicate(expr, CONVERTED_ROW)).toBe(true);
  });

  it("REFUSES the empty-identity row", () => {
    expect(evalNullPredicate(expr, EMPTY_ROW)).toBe(false);
  });

  it("REFUSES a half-typed FW row (name but no band)", () => {
    // A band-less FW profile would materialize fine and then fail every check-in
    // at fw_move_task's snapshot_band stamp — refuse it at the door instead.
    expect(evalNullPredicate(expr, HALF_FW_ROW)).toBe(false);
  });
});

describe("FW migration parity: closed sets pinned against their TS twins", () => {
  it("the profile `band` CHECK lists exactly the content module's BANDS", () => {
    const body = checkBodyFor("path_student_profiles_band_check");
    const listed = (body.match(/in\s*\(([^)]*)\)/i)?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(listed).toEqual([...BANDS]);
  });

  it("the `band` CHECK mirrors path_task_progress.snapshot_band's set", () => {
    // A profile that can hold a band the progress row cannot would make Unit 3's
    // checkmark stamp fail on exactly the students it was typed for.
    const progress = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260722120000_path_progress.sql"),
      "utf8"
    ).replace(/--[^\n]*/g, "");
    const snapshot = (progress.match(/snapshot_band\s+text\s+check\s*\(\s*snapshot_band\s+in\s*\(([^)]*)\)/i)?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(snapshot).toEqual([...BANDS]);
  });

  it("the cohort `kind` CHECK lists exactly path and fw", () => {
    const body = checkBodyFor("path_cohorts_kind_check");
    const listed = (body.match(/in\s*\(([^)]*)\)/i)?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(listed).toEqual(["path", "fw"]);
  });

  it("the replay-reject `action` CHECK lists exactly the three FW actions", () => {
    const m = sql.match(/action\s+text\s+not\s+null\s+check\s*\(\s*action\s+in\s*\(([^)]*)\)/i);
    expect(m, "action check on path_fw_replay_rejects").not.toBeNull();
    const listed = m![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(listed).toEqual(["checkmark", "not_yet", "undo"]);
  });
});

describe("FW migration parity: all seven DDL groups landed", () => {
  it("1. path_student_profiles takes the FW shape", () => {
    expect(/alter\s+table\s+public\.path_student_profiles\s+alter\s+column\s+child_id\s+drop\s+not\s+null/i.test(sql)).toBe(true);
    for (const col of [
      "first_name",
      "last_name",
      "band",
      "notice_attested_at",
      "notice_attested_by",
      "normalized_name",
    ]) {
      expect(
        new RegExp(`alter\\s+table\\s+public\\.path_student_profiles\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+${col}\\b`, "i").test(sql),
        `path_student_profiles.${col}`
      ).toBe(true);
    }
    expect(/create\s+index\s+if\s+not\s+exists\s+path_student_profiles_normalized_name_idx/i.test(sql)).toBe(true);
  });

  it("2. path_task_events gains the four FW columns and the exactly-once index", () => {
    for (const col of ["cohort_id", "captured_at", "action_id", "client_id"]) {
      expect(
        new RegExp(`alter\\s+table\\s+public\\.path_task_events\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+${col}\\b`, "i").test(sql),
        `path_task_events.${col}`
      ).toBe(true);
    }
    // PARTIAL and UNIQUE: the exactly-once key. A non-unique index would let a
    // replayed drain write a second event and ring the bell twice.
    expect(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+path_task_events_client_id_key[\s\S]*?where\s+client_id\s+is\s+not\s+null/i.test(sql)
    ).toBe(true);
  });

  it("2b. every index the migration's own comments call load-bearing exists", () => {
    // Each of these is named in-file as supporting a specific hot read (the
    // board's 3-5s cohort scan, celebration grouping, the roster read on every
    // guide session start, the ops surface's open-reject list). Without an
    // assertion, dropping one leaves the suite green while those reads quietly
    // degrade to sequential scans under live-event load.
    for (const index of [
      "path_task_events_cohort_at_idx",
      "path_task_events_action_id_idx",
      "path_cohort_members_cohort_idx",
      "path_fw_replay_rejects_open_idx",
      "path_student_profiles_normalized_name_idx",
    ]) {
      expect(
        new RegExp(`create\\s+index\\s+if\\s+not\\s+exists\\s+${index}\\b`, "i").test(sql),
        index
      ).toBe(true);
    }
  });

  it("3. path_cohort_members exists and admits a student to a cohort exactly once", () => {
    expect(/create\s+table\s+if\s+not\s+exists\s+public\.path_cohort_members/i.test(sql)).toBe(true);
    expect(/unique\s*\(\s*student_id\s*,\s*cohort_id\s*\)/i.test(sql)).toBe(true);
  });

  it("4. path_cohorts gains kind (defaulted) and the event window", () => {
    expect(/alter\s+table\s+public\.path_cohorts\s+add\s+column\s+if\s+not\s+exists\s+kind\s+text\s+not\s+null\s+default\s+'path'/i.test(sql)).toBe(true);
    for (const col of ["starts_at", "ends_at"]) {
      expect(
        new RegExp(`alter\\s+table\\s+public\\.path_cohorts\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+${col}\\b`, "i").test(sql),
        `path_cohorts.${col}`
      ).toBe(true);
    }
  });

  it("4b. the event window cannot be entered backwards", () => {
    const body = checkBodyFor("path_cohorts_window_ordered");
    expect(/ends_at\s*>\s*starts_at/i.test(body)).toBe(true);
    // Nullable both ways — Path cohorts have no window, and a half-entered one
    // must not be rejected before the ops form finishes.
    expect(/starts_at\s+is\s+null/i.test(body)).toBe(true);
    expect(/ends_at\s+is\s+null/i.test(body)).toBe(true);
  });

  it("5. path_fw_board_tokens stores a HASH and allows one active token per cohort", () => {
    expect(/create\s+table\s+if\s+not\s+exists\s+public\.path_fw_board_tokens/i.test(sql)).toBe(true);
    expect(/token_hash\s+text\s+not\s+null\s+unique/i.test(sql)).toBe(true);
    // A raw token column would make a database read reconstruct a live board URL.
    expect(/\btoken\s+text\b/i.test(sql)).toBe(false);
    expect(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+path_fw_board_tokens_one_active_per_cohort[\s\S]*?on\s+public\.path_fw_board_tokens\s*\(\s*cohort_id\s*\)[\s\S]*?where\s+revoked_at\s+is\s+null/i.test(sql)
    ).toBe(true);
  });

  it("6. path_fw_replay_rejects exists and can be CLOSED (Decision 9)", () => {
    expect(/create\s+table\s+if\s+not\s+exists\s+public\.path_fw_replay_rejects/i.test(sql)).toBe(true);
    // A reject list with no resolution state is a list nobody reads twice.
    expect(/resolved_at\s+timestamptz/i.test(sql)).toBe(true);
    expect(/resolved_by\s+uuid/i.test(sql)).toBe(true);
  });

  it("7. path_fw_released_aliases keys on the local part, once and forever", () => {
    expect(/create\s+table\s+if\s+not\s+exists\s+public\.path_fw_released_aliases/i.test(sql)).toBe(true);
    expect(/local_part\s+text\s+primary\s+key/i.test(sql)).toBe(true);
  });
});

describe("FW migration parity: the house postures", () => {
  it("every new FK is ON DELETE RESTRICT — no cascade, no set null, anywhere", () => {
    expect(/on\s+delete\s+cascade/i.test(sql)).toBe(false);
    expect(/on\s+delete\s+set\s+null/i.test(sql)).toBe(false);
    // Every `references` carries a restrict: counts must agree, or one FK slipped
    // through with the Postgres default (NO ACTION) and a delete could orphan.
    const refs = sql.match(/\breferences\b/gi) ?? [];
    const restricts = sql.match(/on\s+delete\s+restrict/gi) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    expect(restricts.length).toBe(refs.length);
  });

  it("RLS is enabled on every new table (Decision 1: on, zero policies)", () => {
    const created = [...sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual([
      "path_cohort_members",
      "path_fw_board_tokens",
      "path_fw_released_aliases",
      "path_fw_replay_rejects",
    ]);
    for (const table of created) {
      expect(
        new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql),
        `RLS on ${table}`
      ).toBe(true);
    }
  });

  it("declares ZERO policies — authorization is the pure resolver's job", () => {
    expect(/create\s+policy/i.test(sql)).toBe(false);
  });

  it("is idempotent throughout — a re-apply is a no-op", () => {
    // The apply playbook re-runs on failure (docs/solutions/integration-issues/
    // supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md), so
    // a single non-guarded statement turns a retry into a hard error mid-file.
    const creates = sql.match(/create\s+table\s+(?!if\s+not\s+exists)/gi) ?? [];
    expect(creates).toEqual([]);
    const indexes = sql.match(/create\s+(unique\s+)?index\s+(?!if\s+not\s+exists)/gi) ?? [];
    expect(indexes).toEqual([]);
    const columns = sql.match(/add\s+column\s+(?!if\s+not\s+exists)/gi) ?? [];
    expect(columns).toEqual([]);
    // Constraint adds have no IF NOT EXISTS in Postgres, so each one must sit
    // behind a pg_constraint existence guard.
    const constraintAdds = (sql.match(/add\s+constraint\s+(\w+)/gi) ?? []).length;
    const guards = (sql.match(/from\s+pg_constraint\s+where\s+conname\s*=/gi) ?? []).length;
    expect(constraintAdds).toBeGreaterThan(0);
    expect(guards).toBe(constraintAdds);
  });

  it("is SCHEMA ONLY — no data mutation rides along", () => {
    // docs/solutions/workflow-issues/split-phase-migrations-pre-deploy-schema-
    // post-deploy-purge-separate-files-rerun-2026-07-14.md: schema and data
    // mutations live in separate files so either can be re-run alone.
    expect(/\binsert\s+into\b/i.test(sql)).toBe(false);
    expect(/\bupdate\s+public\./i.test(sql)).toBe(false);
    expect(/\bdelete\s+from\b/i.test(sql)).toBe(false);
  });

  it("does not touch the Path's own executor or its tables' existing columns", () => {
    // FW gets a sibling RPC in Unit 3 (Decision 1); this migration must not so
    // much as mention move_path_task, and must not drop or retype anything.
    expect(/move_path_task/i.test(sql)).toBe(false);
    expect(/drop\s+column/i.test(sql)).toBe(false);
    expect(/drop\s+table/i.test(sql)).toBe(false);
    expect(/alter\s+column\s+\w+\s+type\b/i.test(sql)).toBe(false);
    // The ONE loosening this migration makes, named explicitly so a second one
    // cannot arrive unnoticed.
    const loosenings = sql.match(/drop\s+not\s+null/gi) ?? [];
    expect(loosenings.length).toBe(1);
    expect(/child_id\s+drop\s+not\s+null/i.test(sql)).toBe(true);
  });
});
