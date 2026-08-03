import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_BANDS,
  FEEDBACK_BODY_MAX_CHARS,
  FEEDBACK_DAILY_CAP,
  FEEDBACK_TASK_ID_MAX_CHARS,
  FEEDBACK_TASK_ID_PATTERN,
} from "../fp-task-feedback-rules";

// ── Migration ↔ TS parity (the SQL is a copy the node suite can't run) ──
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
// parse-migration-file: any closed set / bound living in BOTH a TS artifact and
// the .sql migration needs a parity test that parses the migration as text, or
// the two drift silently (no test DB here). Here that is the band set, the
// task_id regex + length bound, the body cap, and the daily cap.
//
// The structural assertions below additionally pin the SECURITY POSTURE the
// plan requires (default-deny, INSERT-only child access, column-scoped grant,
// append-only + daily-cap triggers, CASCADE divergence) so a future edit that
// quietly relaxes one of them fails a named test, not a review.
describe("migration parity: fp_task_feedback.sql", () => {
  const raw = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260905120000_fp_task_feedback.sql"),
    "utf8"
  );
  // Strip `--` line comments so the structural assertions test the DDL, never
  // the explanatory prose (which discusses policies, cascade, etc. in English).
  const sql = raw.replace(/--[^\n]*/g, "");

  // ------------------------------------------------------------ value parity

  it("the `band` CHECK lists exactly FEEDBACK_BANDS, in order", () => {
    const m = sql.match(/band\s+text\s+not\s+null\s+check\s*\(\s*band\s+in\s*\(([^)]*)\)/i);
    expect(m, "band text not null check (band in (...))").not.toBeNull();
    const bands = m![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(bands).toEqual([...FEEDBACK_BANDS]);
  });

  it("the task_id CHECK regex is byte-for-byte the TS mirror (acceptor === acceptor)", () => {
    const m = sql.match(/task_id\s+~\s+'([^']+)'/i);
    expect(m, "task_id ~ '<pattern>'").not.toBeNull();
    // Both sides are the runtime string `^[0-9]+(\.[0-9]+){2}$` — the SQL
    // literal and the TS mirror must be byte-for-byte identical.
    expect(m![1]).toBe(FEEDBACK_TASK_ID_PATTERN);
  });

  it("the task_id length bound matches FEEDBACK_TASK_ID_MAX_CHARS", () => {
    const m = sql.match(/char_length\s*\(\s*task_id\s*\)\s*<=\s*(\d+)/i);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(FEEDBACK_TASK_ID_MAX_CHARS);
  });

  it("the body cap matches FEEDBACK_BODY_MAX_CHARS — and body has an empty-string default (tap-is-signal)", () => {
    const m = sql.match(/char_length\s*\(\s*body\s*\)\s*<=\s*(\d+)/i);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(FEEDBACK_BODY_MAX_CHARS);
    // Empty allowed: no lower bound anywhere on body…
    expect(/char_length\s*\(\s*body\s*\)\s*>/i.test(sql)).toBe(false);
    // …and the column defaults to ''.
    expect(/body\s+text\s+not\s+null\s+default\s+''/i.test(sql)).toBe(true);
  });

  it("the daily-cap trigger refuses at FEEDBACK_DAILY_CAP", () => {
    const m = sql.match(/v_count\s*>=\s*(\d+)/i);
    expect(m, "daily-cap comparison v_count >= N").not.toBeNull();
    expect(Number(m![1])).toBe(FEEDBACK_DAILY_CAP);
  });

  // ------------------------------------------------------- security posture

  it("RLS is enabled and the table is default-deny (revoke all from anon, authenticated)", () => {
    expect(/alter\s+table\s+public\.fp_task_feedback\s+enable\s+row\s+level\s+security/i.test(sql)).toBe(true);
    expect(/revoke\s+all\s+on\s+public\.fp_task_feedback\s+from\s+anon\s*,\s*authenticated/i.test(sql)).toBe(true);
  });

  it("the ONLY grant to authenticated is a column-scoped INSERT that excludes created_at", () => {
    const grants = [...sql.matchAll(/grant\s+([^;]+?)\s+on\s+public\.fp_task_feedback\s+to\s+([^;]+);/gi)];
    expect(grants).toHaveLength(1);
    const [, what, whom] = grants[0]!;
    expect(whom.trim()).toBe("authenticated");
    const cols = what.match(/^insert\s*\(([^)]*)\)$/i);
    expect(cols, "grant insert (<column list>) — never a table-wide grant").not.toBeNull();
    const list = cols![1].split(",").map((s) => s.trim()).sort();
    expect(list).toEqual(["band", "body", "id", "profile_id", "task_id"]);
    // created_at stays server-managed: only its default can set it.
    expect(list).not.toContain("created_at");
  });

  it("exactly ONE policy exists: a per-command INSERT policy (never FOR ALL, no child read/update/delete)", () => {
    const policies = [...sql.matchAll(/create\s+policy\s+"[^"]+"\s+on\s+public\.fp_task_feedback\s+for\s+(\w+)/gi)]
      .map((m) => m[1]!.toLowerCase());
    expect(policies).toEqual(["insert"]);
    expect(/for\s+all/i.test(sql)).toBe(false);
  });

  it("the insert policy's WITH CHECK carries the ownership predicate explicitly", () => {
    expect(/with\s+check\s*\(\s*profile_id\s+in\s*\(\s*select\s+id\s+from\s+public\.fp_player_profiles\s+where\s+user_id\s*=\s*\(\s*select\s+auth\.uid\(\)\s*\)/i.test(sql)).toBe(true);
  });

  it("append-only is structural: a before update-or-delete trigger, service_role exempt", () => {
    expect(/create\s+trigger\s+fp_task_feedback_append_only_guard\s+before\s+update\s+or\s+delete\s+on\s+public\.fp_task_feedback/i.test(sql)).toBe(true);
    expect(/raise\s+exception\s+'fp_task_feedback is append-only'/i.test(sql)).toBe(true);
  });

  it("the daily-cap trigger locks the profile row FOR UPDATE before counting (count race)", () => {
    // FOR SHARE would be mutually compatible between two concurrent inserts and
    // the 49+49 race would survive — the lock must be exclusive.
    expect(/create\s+trigger\s+fp_task_feedback_daily_cap_guard\s+before\s+insert\s+on\s+public\.fp_task_feedback/i.test(sql)).toBe(true);
    expect(/from\s+public\.fp_player_profiles\s+where\s+id\s*=\s*NEW\.profile_id\s+for\s+update/i.test(sql)).toBe(true);
  });

  it("profile_id is ON DELETE CASCADE — the documented R14 divergence from the RESTRICT tables", () => {
    expect(/profile_id\s+uuid\s+not\s+null\s+references\s+public\.fp_player_profiles\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i.test(sql)).toBe(true);
    // The divergence must stay documented in the header prose (raw, with comments).
    expect(/DELIBERATE DIVERGENCE/.test(raw)).toBe(true);
    expect(/restrict/i.test(raw)).toBe(true);
  });

  it("the FK index for the RLS subquery / cap count / owner reads exists", () => {
    expect(/create\s+index\s+if\s+not\s+exists\s+fp_task_feedback_profile_id_created_at_idx\s+on\s+public\.fp_task_feedback\s*\(\s*profile_id\s*,\s*created_at\s*\)/i.test(sql)).toBe(true);
  });

  it("the header carries the version ritual and the deploy-ordering warning", () => {
    expect(raw).toMatch(/schema_migrations/);
    expect(raw).toMatch(/RENAME this file/i);
    expect(raw).toMatch(/DEPLOY ORDERING/);
    expect(raw).toMatch(/BEFORE the first-profit client/i);
    // Retention ritual: a commented purge statement the owner can run.
    expect(raw).toMatch(/interval '12 months'/);
  });
});
