import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  APPLICANT_STATES,
  EDIT_LOCKED_ERRCODE,
  EDIT_LOCKED_SIGNAL,
  PROJECT_CREATION_ROUTES,
  PROJECT_STATUSES,
} from "@/app/lib/funnel/applicant-rules";

/**
 * Pins U1's three DB CHECK constraints to the TS const arrays they mirror.
 *
 * The drift class this closes has already cost this repo once: an audit-action
 * allowlist lived in the TS array while absent from the CHECK, and the gap
 * passed typecheck and every test before failing at runtime
 * (docs/solutions/best-practices/crm-audit-action-allowlist-db-check-
 * constraint-drifts-from-ts-enum-2026-07-15.md).
 *
 * ANCHORED ON THE CONSTRAINT NAME, never on the column name. The sibling test
 * `app/crm/__tests__/audit-actions-parity.test.ts` carries the scar from
 * getting this wrong: `action` is an ordinary column name, an unscoped
 * `check (action in (…))` match adopted an unrelated table's constraint as the
 * audit allowlist, and an unrelated migration reddened CRM. `status` — which
 * `projects` uses — is a far more common column name than `action` is.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase", "migrations");

const allMigrationSource = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");

/**
 * The `in (...)` list of the LAST definition of a named constraint across all
 * migrations — last wins, because a later re-add is what the live DB enforces.
 * Returns null when the constraint is never defined, which is itself asserted:
 * a silently-absent constraint would otherwise make every comparison below
 * vacuous.
 */
function constraintValues(source: string, constraintName: string): string[] | null {
  const re = new RegExp(
    `add constraint ${constraintName}\\s+check \\([\\s\\S]*?in \\(([\\s\\S]*?)\\)\\)`,
    "g"
  );
  const lists = [...source.matchAll(re)].map((m) => m[1]);
  if (lists.length === 0) return null;
  return [...lists[lists.length - 1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("U1 CHECK constraints vs their TS mirrors", () => {
  const source = allMigrationSource();

  const CASES: [string, readonly string[]][] = [
    ["children_applicant_state_check", APPLICANT_STATES],
    ["projects_status_check", PROJECT_STATUSES],
    ["projects_creation_route_check", PROJECT_CREATION_ROUTES],
  ];

  it.each(CASES)("%s matches its const array exactly", (name, expected) => {
    const values = constraintValues(source, name);
    expect(values, `${name} is not defined in any migration`).not.toBeNull();
    expect([...(values as string[])].sort()).toEqual([...expected].sort());
    // No duplicates on either side — a repeated value passes set equality.
    expect(new Set(values).size).toBe((values as string[]).length);
    expect(new Set(expected).size).toBe(expected.length);
  });

  it("finds nothing for a constraint name that does not exist", () => {
    // The regex returning null for an absent name is what makes the assertion
    // above meaningful; without this, a typo in a constraint name would make
    // all three cases skip silently rather than fail.
    expect(constraintValues(source, "children_no_such_check")).toBeNull();
  });

  it("does not adopt an unrelated table's `status` CHECK", () => {
    // The scoping guard, against a fixture rather than a real file so it stays
    // meaningful when migrations are added. `status` is a common column name:
    // an unscoped `check (status in (…))` scan would take whichever migration
    // sorts last, and a future unrelated table would silently become THE
    // definition of the project status vocabulary.
    const unrelated = `
      create table public.some_other_thing (
        status text not null check (status in ('nope', 'nah'))
      );
    `;
    expect(constraintValues(unrelated, "projects_status_check")).toBeNull();
  });
});

describe("U1's migration invariants", () => {
  const file = readdirSync(MIGRATIONS_DIR).find((f) =>
    f.endsWith("_funnel_applicant_state.sql")
  );
  const src = file ? readFileSync(path.join(MIGRATIONS_DIR, file), "utf8") : "";

  it("exists", () => {
    expect(file, "U1's migration file is missing").toBeTruthy();
  });

  it("enables RLS on projects (Decision 11)", () => {
    // RLS with no grants is what makes a new table invisible to the public
    // anon key, which ships in every client bundle. Every one of this repo's
    // migrations does this, including for tables only the service role touches.
    expect(src).toMatch(/alter table public\.projects enable row level security/);
  });

  it("grants projects ZERO policies", () => {
    // A policy on `projects` would mean parents reach it through PostgREST,
    // which is not the design — server code reaches it. If a later unit needs
    // one, it should land with the code that needs it, not silently here.
    expect(src).not.toMatch(/create policy[\s\S]*?on public\.projects/);
  });

  it("makes applicant_state nullable — no DEFAULT, no NOT NULL", () => {
    // The regression guarantee. A NOT NULL DEFAULT 'added' would retroactively
    // put every existing child on rung one of a ladder they are not on.
    const add = /alter table public\.children add column if not exists applicant_state ([^;]*);/.exec(src);
    expect(add).not.toBeNull();
    expect((add as RegExpExecArray)[1].trim()).toBe("text");
  });

  it("scopes the live-paid deposit index on refunded_at, not status alone", () => {
    // `status = 'paid'` alone would refuse a refunded child a second deposit
    // forever — the isLivePaid predicate is the pair, and the rest of the
    // schema already uses it that way.
    expect(src).toMatch(
      /create unique index if not exists deposits_one_live_paid_per_child[\s\S]*?where status = 'paid' and refunded_at is null/
    );
  });

  it("enforces one active project per child as a partial unique index (R2)", () => {
    expect(src).toMatch(
      /create unique index if not exists projects_one_active_per_child[\s\S]*?where status = 'active'/
    );
  });

  it("carries U6's columns — entry_source, consent text and version", () => {
    for (const col of ["entry_source", "consent_text", "consent_version"]) {
      expect(src, col).toContain(`add column if not exists ${col}`);
    }
  });

  it("is idempotent — every statement guarded", () => {
    // The first failure aborts the whole file, so a partial apply must be safe
    // to re-run. Each bare CREATE/ALTER shape gets its guard; the two CHECK
    // constraints are guarded by pg_constraint lookups in a DO block, since
    // `add constraint` has no IF NOT EXISTS.
    const statements = src
      .replace(/--.*$/gm, "")
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const s of statements) {
      if (/^create table/i.test(s)) expect(s, s.slice(0, 60)).toMatch(/if not exists/i);
      if (/^create( unique)? index/i.test(s)) expect(s, s.slice(0, 60)).toMatch(/if not exists/i);
      if (/^alter table[\s\S]*add column/i.test(s))
        expect(s, s.slice(0, 60)).toMatch(/if not exists/i);
    }

    // Every `add constraint` in this file sits inside a pg_constraint guard.
    const constraintAdds = [...src.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
    expect(constraintAdds.length).toBeGreaterThan(0);
    for (const name of constraintAdds) {
      expect(src, name).toContain(`where conname = '${name}'`);
    }
  });

  it("does not touch children.status or either children trigger", () => {
    // Named explicitly because an earlier draft of this unit rewrote
    // children_seed_group_assignment, and the plan records that doing so is
    // the change that would create the review-queue flood it was meant to
    // prevent. Comments are stripped first — the file documents at length WHY
    // it leaves both triggers alone, and that prose must not read as a touch.
    const sql = src.replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/children_seed_group_assignment/);
    expect(sql).not.toMatch(/children_status_guard/);
    expect(sql).not.toMatch(/alter column status/);
    expect(sql).not.toMatch(/create (or replace )?(trigger|function)/i);
  });
});

describe("the edit-horizon guard (reconnect U7, R13) vs its TS mirrors", () => {
  const file = readdirSync(MIGRATIONS_DIR).find((f) =>
    f.endsWith("_funnel_edit_horizon.sql")
  );
  const src = file ? readFileSync(path.join(MIGRATIONS_DIR, file), "utf8") : "";
  const sql = src.replace(/--.*$/gm, "");

  it("exists and installs a BEFORE UPDATE trigger on projects — UPDATE only, no INSERT arm", () => {
    // No INSERT arm is deliberate: a BEFORE INSERT branch would re-open the
    // EXCLUDED-poisoning trap (2026-07-14) the moment any writer upserts,
    // and the one-active-per-child index already arbitrates inserts.
    expect(file, "the Unit 7 migration file is missing").toBeTruthy();
    expect(sql).toMatch(
      /create trigger projects_edit_horizon_guard\s+before update on public\.projects/
    );
    expect(sql).not.toMatch(/before insert/i);
    expect(sql).not.toMatch(/or insert/i);
  });

  it("carries the applicant ladder EXACTLY as APPLICANT_STATES, in order", () => {
    // The trigger's array_position comparison is only correct while its
    // array IS the ladder — same values, same order. A rung added to the TS
    // ladder without editing the migration reddens this.
    const m = /v_order text\[\] := array\[([^\]]*)\]/.exec(sql);
    expect(m, "the guard's v_order ladder array is missing").not.toBeNull();
    const values = [...(m as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(values).toEqual([...APPLICANT_STATES]);
  });

  it("keys the lock by PREVIOUS-STATE CLASS — at-or-past 'submitted', not enumerated pairs", () => {
    // The 2026-07-29 waitlist learning: the invariant is the class boundary,
    // expressed as a position comparison, so future rungs past `submitted`
    // are covered with no list to maintain. An unknown state fails CLOSED.
    expect(sql).toMatch(/>=\s*array_position\(v_order, 'submitted'\)/);
    expect(sql).toMatch(/coalesce\(array_position\(v_order, v_state\), 999\)/);
  });

  it("locks the child-state read FOR SHARE — the trigger read must block behind an in-flight submit", () => {
    // Race hardening: under READ COMMITTED a plain SELECT could read the
    // child's pre-submission state while a children submit is committing,
    // letting a racing projects UPDATE land inside the commit window. FOR
    // SHARE conflicts with the concurrent children UPDATE's row lock, so
    // the read blocks until the submit commits, then sees 'submitted'.
    expect(sql).toMatch(
      /select applicant_state into v_state\s+from public\.children\s+where id = OLD\.child_id\s+for share;/
    );
  });

  it("raises the exact error contract the TS recognizer pins — signal and errcode", () => {
    expect(sql).toContain(`raise exception '${EDIT_LOCKED_SIGNAL}'`);
    expect(sql).toContain(`errcode = '${EDIT_LOCKED_ERRCODE}'`);
  });

  it("exempts the service role — the retention cron must keep purging submitted+ children's projects", () => {
    expect(sql).toMatch(/if auth\.role\(\) = 'service_role' then\s+return NEW;/);
  });

  it("the locked state is REACHABLE — the sync trigger derives 'submitted' from the dossier submit", () => {
    // Writer coverage (the fixture-states learning): a lock nothing can
    // trip is dead vocabulary. The submission path is children.status
    // draft → submitted (store.tsx targeted UPDATE), which the U13 sync
    // trigger maps onto applicant_state 'submitted'; deleting that mapping
    // makes the horizon unreachable and this red.
    const sync = readFileSync(
      path.join(MIGRATIONS_DIR, "20260810120000_funnel_applicant_state_sync.sql"),
      "utf8"
    );
    expect(sync).toMatch(/when 'submitted' then 'submitted'/);
    expect(sync).toMatch(/before update of status/);
  });
});
