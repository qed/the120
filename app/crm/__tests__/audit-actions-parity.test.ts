import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "../lib/constants";

/**
 * Pins the TS audit-action allowlist to the DB CHECK constraint — the two have
 * drifted before ('offer-email' lived in the TS array while absent from the
 * CHECK; see docs/solutions/best-practices/crm-audit-action-allowlist-db-check-
 * constraint-drifts-from-ts-enum-2026-07-15.md). A value added on one side only
 * passes typecheck and every test, then fails (or silently gaps the audit
 * trail) at runtime. This test parses the migration FILES as text — the same
 * close-the-drift-in-CI move as the security-definer SQL CASE learning — so
 * the drift class is dead: whichever side you forget, the suite goes red.
 *
 * The authoritative list is the LAST (highest-timestamped) migration that
 * (re)defines the constraint, because each re-add re-lists every value and the
 * final one is what the live DB enforces.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase", "migrations");

/**
 * Every `crm_audit_log` action allowlist in a file; the last one wins per file.
 *
 * SCOPED TO crm_audit_log deliberately. `action` is an ordinary column name —
 * public.path_fw_replay_rejects has one — and an unscoped `check (action in (…))`
 * match adopts whichever table happened to be defined last as THE audit
 * allowlist, turning an unrelated migration into a false red (and, worse, hiding
 * a genuine drift behind it). Two shapes qualify: the original definition inside
 * the create-table, and every later named re-add.
 */
function lastActionListIn(source: string): string[] | null {
  const lists: string[] = [];

  const created = /create table public\.crm_audit_log\s*\(([\s\S]*?)\n\);/.exec(source);
  if (created) {
    const inline = /check \(action in \(([\s\S]*?)\)\)/.exec(created[1]);
    if (inline) lists.push(inline[1]);
  }

  const re = /add constraint crm_audit_log_action_check check \(action in \(([\s\S]*?)\)\)/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    lists.push(m[1]);
  }

  if (lists.length === 0) return null;
  return [...lists[lists.length - 1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("crm_audit_log action allowlist — TS enum vs DB CHECK parity", () => {
  const defs = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const actions = lastActionListIn(
        readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")
      );
      return actions ? { file, actions } : null;
    })
    .filter((d): d is { file: string; actions: string[] } => d !== null);

  it("at least one migration defines the constraint", () => {
    expect(defs.length).toBeGreaterThan(0);
  });

  it("only crm_audit_log's own migrations are considered", () => {
    // The scoping guard, pinned: a migration that merely defines some OTHER
    // table with an `action` CHECK must never be read as the audit allowlist.
    for (const def of defs) {
      expect(
        readFileSync(path.join(MIGRATIONS_DIR, def.file), "utf8").includes("crm_audit_log"),
        `${def.file} was picked up without defining crm_audit_log`
      ).toBe(true);
    }
  });

  it("the LATEST constraint definition matches AUDIT_ACTIONS exactly (set equality)", () => {
    const latest = defs[defs.length - 1];
    expect([...latest.actions].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it("neither list carries duplicates", () => {
    const latest = defs[defs.length - 1];
    expect(new Set(latest.actions).size).toBe(latest.actions.length);
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("every re-add only APPENDS — no earlier value ever silently disappears", () => {
    // The audit table is immutable history: a re-added CHECK that drops a value
    // would invalidate rows that already exist. Each definition must be a
    // superset of the one before it.
    for (let i = 1; i < defs.length; i++) {
      const prev = new Set(defs[i - 1].actions);
      const curr = new Set(defs[i].actions);
      for (const value of prev) {
        expect(
          curr.has(value),
          `${defs[i].file} dropped '${value}' present in ${defs[i - 1].file}`
        ).toBe(true);
      }
    }
  });
});
