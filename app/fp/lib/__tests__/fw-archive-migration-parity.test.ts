import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ── Migration ↔ intent parity for Unit 6's two files ─────────────────────────
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
// parse-migration-file: this repo has no test database, so the FIRST execution of
// this DDL is against production. Everything below parses the migrations as text
// and asserts the properties a live apply would otherwise be the only witness to.
//
// Two files, one test module, because they shipped in one lock window and a
// reviewer of either needs the other in view: 20260806120000 is the plan's Unit 6
// (SCHEMA ONLY — two archive columns), 20260806130000 is the residue-reports table
// Peter approved for the same window. Scoping rules per
// docs/solutions/test-failures/migration-scanning-parity-test-must-scope-to-its-
// table-*: every assertion here anchors on ITS OWN file's text, so a future
// sibling migration cannot hijack these and these cannot hijack a sibling's.

const DIR = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const read = (name: string) =>
  readFileSync(new URL(name, `file://${DIR}`), "utf8").replace(/\r\n/g, "\n");

// Strip `--` line comments UNIFORMLY (the sibling-parity rule: the headers discuss
// "cascade", "not null" and "insert" in English, and an assertion that reads prose
// is satisfied or violated by a comment edit).
const strip = (raw: string) => raw.replace(/--[^\n]*/g, "");

const archiveRaw = read("20260806120000_fw_cohort_archive.sql");
const archiveSql = strip(archiveRaw).toLowerCase();
const reportsRaw = read("20260806130000_fw_residue_reports.sql");
const reportsSql = strip(reportsRaw).toLowerCase();

describe("20260806120000_fw_cohort_archive — two nullable columns, schema only", () => {
  it("adds exactly the two columns, idempotently, on path_cohorts", () => {
    const adds = archiveSql.match(/alter\s+table\s+public\.path_cohorts\s+add\s+column\s+if\s+not\s+exists/g) ?? [];
    expect(adds).toHaveLength(2);
    expect(archiveSql).toMatch(/add\s+column\s+if\s+not\s+exists\s+archived_at\s+timestamptz/);
    expect(archiveSql).toMatch(/add\s+column\s+if\s+not\s+exists\s+archived_by\s+uuid/);
    // No OTHER table is touched — the hijack rule in reverse.
    const alters = archiveSql.match(/alter\s+table\s+\S+/g) ?? [];
    for (const a of alters) expect(a).toContain("public.path_cohorts");
  });

  it("archived_by references auth.users with ON DELETE RESTRICT — asserted by clause, not substring", () => {
    // The clause is extracted from the archived_by statement specifically, so a
    // decoy `restrict` elsewhere (or in prose — already stripped) cannot satisfy it,
    // and a `cascade` smuggled into THIS clause cannot hide behind a restrict
    // somewhere else.
    const stmt = archiveSql.slice(
      archiveSql.indexOf("archived_by"),
      archiveSql.indexOf(";", archiveSql.indexOf("archived_by"))
    );
    expect(stmt).toMatch(/references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/);
    expect(stmt).not.toContain("cascade");
  });

  it("NEITHER column is NOT NULL — isolate each statement and assert the absence", () => {
    for (const col of ["archived_at", "archived_by"]) {
      const stmt = archiveSql.slice(
        archiveSql.indexOf(col),
        archiveSql.indexOf(";", archiveSql.indexOf(col))
      );
      expect(stmt, col).not.toMatch(/not\s+null/);
      expect(stmt, col).not.toMatch(/\bdefault\b/); // an active row has no value, full stop
    }
  });

  it("SCHEMA ONLY: no insert, no update, no delete, no function, no trigger", () => {
    expect(archiveSql).not.toMatch(/\binsert\s+into\b/);
    expect(archiveSql).not.toMatch(/\bupdate\s+public\./);
    expect(archiveSql).not.toMatch(/\bdelete\s+from\b/);
    expect(archiveSql).not.toMatch(/create\s+(or\s+replace\s+)?function/);
    expect(archiveSql).not.toMatch(/create\s+trigger/);
  });
});

describe("20260806130000_fw_residue_reports — the beacon's durable store", () => {
  it("creates the table idempotently with RLS enabled and NO policies (service-role only)", () => {
    expect(reportsSql).toMatch(/create\s+table\s+if\s+not\s+exists\s+public\.path_fw_residue_reports/);
    expect(reportsSql).toMatch(/alter\s+table\s+public\.path_fw_residue_reports\s+enable\s+row\s+level\s+security/);
    // No policies is the FW-table posture: a policy here would be the first crack in
    // "reads and writes go through the service-role client only".
    expect(reportsSql).not.toMatch(/create\s+policy/);
  });

  it("session_user_id CASCADES (telemetry must not block account deletion) and the CLAIM has NO FK", () => {
    const sessionStmt = reportsSql.slice(
      reportsSql.indexOf("session_user_id"),
      reportsSql.indexOf(",", reportsSql.indexOf("session_user_id"))
    );
    expect(sessionStmt).toMatch(/references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/);
    // claimed_actor_user_id deliberately has NO references clause: its value is that
    // it may disagree with reality (a handover raced the POST; an old bundle claimed
    // a deleted account). An FK would refuse exactly the rows worth reading.
    const claimStmt = reportsSql.slice(
      reportsSql.indexOf("claimed_actor_user_id"),
      reportsSql.indexOf(",", reportsSql.indexOf("claimed_actor_user_id"))
    );
    expect(claimStmt).not.toContain("references");
    expect(claimStmt).toMatch(/not\s+null/);
  });

  it("queue_remaining is NULLABLE with a >= 0 check — null is 'the clear threw', not zero", () => {
    const stmt = reportsSql.slice(
      reportsSql.indexOf("queue_remaining"),
      reportsSql.indexOf(",", reportsSql.indexOf("queue_remaining"))
    );
    expect(stmt).not.toMatch(/not\s+null/);
    expect(stmt).toMatch(/check\s*\(\s*queue_remaining\s*>=\s*0\s*\)/);
  });

  it("outcome and application are CHECK-constrained to the beacon's exact vocabularies", () => {
    expect(reportsSql).toMatch(/outcome\s+text\s+not\s+null\s+check\s*\(\s*outcome\s+in\s*\(\s*'queue_preserved'\s*,\s*'clear_failed'\s*\)\s*\)/);
    expect(reportsSql).toMatch(/application\s+text\s+not\s+null\s+check\s*\(\s*application\s+in\s*\(\s*'fw'\s*,\s*'crm'\s*,\s*'staff'\s*\)\s*\)/);
  });

  it("the DB vocabularies match the zod schema's — parity with the write path, by value", () => {
    // The zod schema in app/lib/staff-bar/actions.ts is the only writer. A member
    // added on either side without the other turns this red — the TS-enum-vs-CHECK
    // drift docs/solutions/best-practices/crm-audit-action-allowlist-db-check-
    // constraint-drifts-from-ts-enum-2026-07-15.md documents.
    const actions = readFileSync(
      new URL("../../../lib/staff-bar/actions.ts", import.meta.url),
      "utf8"
    );
    const outcomeEnum = /z\.enum\(\[([^\]]*)\]\)/.exec(
      actions.slice(actions.indexOf("outcome:"))
    );
    expect(outcomeEnum?.[1].replace(/["\s]/g, "")).toBe("queue_preserved,clear_failed");
    const appEnum = /z\.enum\(\[([^\]]*)\]\)/.exec(
      actions.slice(actions.indexOf("application:"))
    );
    expect(appEnum?.[1].replace(/["\s]/g, "")).toBe("fw,crm,staff");
  });

  it("the device-recency index exists for the one query the table serves", () => {
    expect(reportsSql).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+path_fw_residue_reports_device_recency_idx\s+on\s+public\.path_fw_residue_reports\s*\(\s*device_id\s*,\s*created_at\s+desc\s*\)/
    );
  });
});

describe("neither file hijacks a sibling scanner", () => {
  it("the archive file never names the tables the sibling parity suites scope to", () => {
    // The hijack happened once (an unrelated column matched another suite's
    // allowlist). These files must not mention the tables the other parity tests
    // anchor on — comments included, because some sibling scanners read raw text.
    for (const forbidden of ["path_fw_board_tokens", "path_fw_replay_rejects", "fw_move_task", "path_students"]) {
      expect(archiveRaw.toLowerCase(), forbidden).not.toContain(forbidden);
      expect(reportsRaw.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});
