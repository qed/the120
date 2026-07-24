import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FW_ACTIONS,
  FW_ACTION_LEGAL_FROM,
  FW_ACTION_TARGETS,
  type FwAction,
} from "../fw-rules";
import { TASK_STATES } from "../transition-table";

/**
 * SQL parity for `fw_move_task` (FW Unit 3).
 *
 * The repo has no test database, so the migration is an untested third copy of
 * every rule it encodes — the problem docs/solutions/test-failures/security-
 * definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md exists
 * to solve. This file parses the migration AS TEXT and pins it against
 * `fw-rules.ts`.
 *
 * Two things make this test different from its `progress-core.test.ts` sibling:
 *
 *   1. It asserts STRUCTURE, not just values. Plan Decision 2's load-bearing
 *      property is that the per-action legal-from set IS the UPDATE's WHERE
 *      predicate — that is what makes the write race-safe, and a node-only test
 *      setup cannot run true concurrency to prove it behaviourally. So the shape
 *      is asserted: the guard must live inside the UPDATE statement.
 *
 *   2. Everything is SCOPED TO fw_move_task's own function body, per
 *      docs/solutions/test-failures/migration-scanning-parity-test-must-scope-to-
 *      its-table-unrelated-column-hijacks-the-allowlist-2026-07-23.md — a scanner
 *      keyed on a bare column name (`state`, `action`) is a landmine for the next
 *      migration author, and this file's own Unit 1 sibling already detonated one.
 *      The scoping is pinned with a synthetic fixture, not a real file.
 */

const MIGRATION = "supabase/migrations/20260730120000_fw_move_task.sql";

const source = readFileSync(path.resolve(process.cwd(), MIGRATION), "utf8");

/* ─────────────────────────────────────────────────────────── the scoping ──── */

/**
 * The body of ONE named function, from its `create or replace function` header
 * to the `$$;` that closes it. Every assertion below runs against this, never
 * against the whole file — so a later FW migration that also defines a `state`
 * CASE cannot hijack them.
 */
export function functionBody(sql: string, name: string): string | null {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return null;
  const open = sql.indexOf("as $$", start);
  if (open === -1) return null;
  const end = sql.indexOf("$$;", open);
  if (end === -1) return null;
  return stripSqlComments(sql.slice(open, end));
}

/**
 * Drop `--` line comments before any structural parsing. Two reasons, both found
 * the hard way while writing this file: a prose semicolon inside a comment
 * ("do not hoist it into an `if` above the statement; that converts…") truncates
 * statement extraction, and — more importantly — an assertion that a comment can
 * satisfy is not an assertion. Every check below must be answered by CODE.
 *
 * Safe here because this migration has no `--` inside a string literal; it is a
 * deliberately narrow helper, not a SQL parser.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** The single `update public.path_task_progress … ;` statement inside a body. */
function updateStatement(body: string): string | null {
  const start = body.indexOf("update public.path_task_progress");
  if (start === -1) return null;
  const end = body.indexOf(";", start);
  if (end === -1) return null;
  return body.slice(start, end);
}

/** `when '<action>' then '<state>'` arms — the hardcoded target map. */
function targetArms(scope: string): Record<string, string> {
  return Object.fromEntries(
    [...scope.matchAll(/when\s+'(\w+)'\s+then\s+'([a-z_]+)'\s*$/gm)].map((m) => [m[1], m[2]])
  );
}

/** `when '<action>' then p.state in ('a', 'b', …)` arms — the legal-from sets. */
function legalFromArms(scope: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = /when\s+'(\w+)'\s+then\s+p\.state in \(([^)]*)\)/g;
  for (let m = re.exec(scope); m !== null; m = re.exec(scope)) {
    out[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  return out;
}

const body = functionBody(source, "fw_move_task");

describe("the migration is shaped the way this test assumes", () => {
  it("defines fw_move_task and yields a parseable body", () => {
    expect(body, `no fw_move_task body found in ${MIGRATION}`).not.toBeNull();
    expect(body!.length).toBeGreaterThan(500);
  });

  it("scopes to the NAMED function — a sibling function's CASE cannot hijack it", () => {
    // Synthetic fixture, not a real file: an assertion whose only evidence is
    // whichever migration happens to sort last silently stops testing anything
    // the day that file is renamed.
    const fixture = `
create or replace function public.some_other_fn(p_action text)
returns void language plpgsql as $$
begin
  v_to := case p_action
    when 'checkmark' then 'wrong_state'
    else null
  end;
end;
$$;

create or replace function public.fw_move_task(p_student_id uuid)
returns void language plpgsql as $$
begin
  v_to := case p_action
    when 'checkmark' then 'verified'
    else null
  end;
end;
$$;`;
    expect(targetArms(functionBody(fixture, "fw_move_task")!)).toEqual({ checkmark: "verified" });
    expect(targetArms(functionBody(fixture, "some_other_fn")!)).toEqual({
      checkmark: "wrong_state",
    });
    expect(functionBody(fixture, "no_such_fn")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════ the hardcoded target map ══ */

describe("action → target: the SQL CASE mirrors FW_ACTION_TARGETS", () => {
  it("every TS action has an SQL arm with the identical target", () => {
    const arms = targetArms(body!);
    for (const a of FW_ACTIONS) {
      expect(arms[a], `SQL CASE arm for "${a}"`).toBe(FW_ACTION_TARGETS[a]);
    }
  });

  it("the SQL has no extra arms the TS map does not know about", () => {
    expect(Object.keys(targetArms(body!)).sort()).toEqual([...FW_ACTIONS].sort());
  });

  it("an unknown action RAISES rather than defaulting to a target", () => {
    // `else null` + an explicit raise. A CASE that fell through to a state would
    // let a typo'd action write a real transition.
    expect(body).toMatch(/else null\s*\n\s*end;/);
    expect(body).toMatch(/raise exception 'unknown fw action: %', p_action;/);
  });
});

/* ══════════════════════════ the state guard lives INSIDE the UPDATE's WHERE ══ */

describe("race safety is structural — the legal-from set IS the UPDATE's WHERE predicate", () => {
  const update = updateStatement(body!);

  it("finds exactly one UPDATE of path_task_progress in the function", () => {
    expect(update).not.toBeNull();
    expect(body!.match(/update public\.path_task_progress/g)).toHaveLength(1);
  });

  it("the per-action state guard is inside that UPDATE, not hoisted above it", () => {
    // THE assertion this file exists for. Hoisting the guard into an `if` above
    // the statement converts a compare-and-swap into a check-then-act and
    // reintroduces the lost update the whole design prevents.
    const arms = legalFromArms(update!);
    expect(Object.keys(arms).sort()).toEqual([...FW_ACTIONS].sort());
  });

  it("each arm's state list equals FW_ACTION_LEGAL_FROM exactly", () => {
    const arms = legalFromArms(update!);
    for (const a of FW_ACTIONS) {
      expect(arms[a].slice().sort(), `legal-from for "${a}"`).toEqual(
        [...FW_ACTION_LEGAL_FROM[a]].sort()
      );
    }
  });

  it("no arm lists a state outside the task-state union (a typo'd state matches nothing, forever)", () => {
    const arms = legalFromArms(update!);
    for (const [action, states] of Object.entries(arms)) {
      for (const s of states) {
        expect(TASK_STATES as readonly string[], `${action} from ${s}`).toContain(s);
      }
    }
  });

  it("the UPDATE is keyed on the student AND the task — never a task-wide write", () => {
    expect(update).toMatch(/p\.student_id = p_student_id/);
    expect(update).toMatch(/p\.task_id = p_task_id/);
  });

  it("no legal-from arm contains its own target (a self-transition would be a phantom write)", () => {
    const arms = legalFromArms(update!);
    for (const a of FW_ACTIONS) {
      expect(arms[a], a).not.toContain(FW_ACTION_TARGETS[a]);
    }
  });
});

/* ══════════════════════════════════════════════════════ the author stamping ══ */

describe("author stamping — BOTH decisions stamp, undo clears (Decision 2 / Decision 9's source)", () => {
  const update = updateStatement(body!)!;

  it("verified_by is set for checkmark AND not_yet, and NULLed otherwise", () => {
    // Unit 8's same-actor undo guard reads this column to decide whether a
    // replayed offline undo may apply. Stamping only `verified` rows — the Path's
    // behaviour — would make that guard unevaluable for half the decisions it
    // must judge, which is exactly the authorless-undo bug the plan review caught.
    expect(update).toMatch(
      /verified_by = case when p_action in \('checkmark', 'not_yet'\) then p_actor else null end/
    );
  });

  it("verified_role is stamped the same way, with the events CHECK's 'adult' literal", () => {
    expect(update).toMatch(
      /verified_role = case when p_action in \('checkmark', 'not_yet'\) then 'adult' else null end/
    );
  });

  it("undo is the only action in neither stamp list — so it is the only one that clears", () => {
    const stamped = /case when p_action in \((.*?)\) then p_actor/.exec(update)![1];
    const listed = [...stamped.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual(["checkmark", "not_yet"]);
    expect(FW_ACTIONS.filter((a: FwAction) => !listed.includes(a))).toEqual(["undo"]);
  });

  it("decided_at is cleared on undo — an undone task must not read as decided", () => {
    expect(update).toMatch(/decided_at = case when p_action = 'undo' then null else now\(\) end/);
  });

  it("snapshot_band is frozen once, on checkmark only, from the profile's own band", () => {
    expect(update).toMatch(
      /snapshot_band = case\s*\n\s*when p_action = 'checkmark' then coalesce\(p\.snapshot_band, v_band\)/
    );
    expect(body).toMatch(/select sp\.band into v_band\s*\n\s*from public\.path_student_profiles sp/);
  });
});

/* ════════════════════════════════════════════ events, idempotency, clamping ══ */

describe("the event write", () => {
  it("stamps every FW column Unit 1 added, on both event-writing arms", () => {
    const inserts = body!.match(/insert into public\.path_task_events[\s\S]*?on conflict[^;]*;/g);
    // Two: the applied arm and the re-attempt arm. already_done writes NONE.
    expect(inserts).toHaveLength(2);
    for (const ins of inserts!) {
      for (const col of ["cohort_id", "captured_at", "action_id", "client_id"]) {
        expect(ins, col).toContain(col);
      }
      expect(ins).toContain("'adult'");
    }
  });

  it("the re-attempt event carries from_state = to_state (the board's re-attempt signal)", () => {
    // Its values row passes v_from and v_to, and the arm is only reachable when
    // v_from = 'not_yet' = v_to. Pin the arm's guard so a refactor cannot widen it.
    expect(body).toMatch(/elsif p_action = 'not_yet' and v_from = 'not_yet' then/);
  });

  it("dedupes on the partial unique index Unit 1 created — not on a bare column", () => {
    // `on conflict (client_id) do nothing` WITHOUT the index predicate does not
    // infer a partial index and errors at runtime; the whole exactly-once story
    // rests on this clause matching path_task_events_client_id_key.
    expect(body!.match(/on conflict \(client_id\) where client_id is not null do nothing/g)).toHaveLength(2);
  });

  it("short-circuits a replayed client_id BEFORE the update, under the row lock", () => {
    const lockAt = body!.indexOf("for update");
    const replayAt = body!.indexOf("'replayed'::text");
    const updateAt = body!.indexOf("update public.path_task_progress");
    expect(lockAt).toBeGreaterThan(-1);
    expect(replayAt).toBeGreaterThan(lockAt);
    expect(replayAt).toBeLessThan(updateAt);
  });

  it("clamps captured_at against the server clock", () => {
    expect(body).toMatch(/v_captured := least\(coalesce\(p_captured_at, now\(\)\), now\(\)\);/);
  });

  it("classifies a missing progress row rather than inserting one (the no-upsert contract)", () => {
    expect(body).toMatch(/'missing'::text/);
    expect(body).not.toMatch(/insert into public\.path_task_progress/);
  });

  it("re-asserts the cohort stamp against authoritative rows (Decision 3, defense-in-depth)", () => {
    expect(body).toMatch(/from public\.path_cohort_members m/);
    expect(body).toMatch(/join public\.path_cohorts c on c\.id = m\.cohort_id/);
    expect(body).toMatch(/c\.kind = 'fw'/);
    expect(body).toMatch(/'cohort_invalid'::text/);
  });
});

/* ═══════════════════════════════════════════ the cascade that must NOT exist ══ */

describe("no cascade — FW activity can never touch a Path journey", () => {
  it("never opens a review", () => {
    expect(body).not.toMatch(/path_maybe_open_review/);
    expect(body).not.toMatch(/path_reviews/);
  });

  it("never unlocks a next task", () => {
    // NB: `'available'` legitimately appears in the checkmark/not_yet legal-from
    // lists (FW has no gating, so a Path-shaped row is a legal source). What must
    // not exist is an ASSIGNMENT to it, or the Path's next-task machinery.
    expect(body).not.toMatch(/state\s*=\s*'available'/);
    expect(body).not.toMatch(/'unlock'/);
    // The next-task lookup the Path executor runs has no counterpart here.
    expect(body).not.toMatch(/path_unit_tasks/);
  });

  it("never enqueues a notification", () => {
    expect(body).not.toMatch(/path_notification/);
  });

  it("leaves move_path_task entirely alone — this file must not redefine it", () => {
    expect(source).not.toMatch(/create or replace function public\.move_path_task/);
    expect(source).not.toMatch(/drop function[^;]*move_path_task/);
    // …and creates no table: this is a function-only migration.
    expect(source).not.toMatch(/create table/i);
    expect(source).not.toMatch(/alter table/i);
  });
});

/* ═══════════════════════════════════════════════════════════════ the grants ══ */

describe("service-role only", () => {
  const SIG = "public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text)";

  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(source).toMatch(/security definer/);
    expect(source).toMatch(/set search_path = public/);
  });

  it("revokes from public, anon and authenticated, and grants only service_role", () => {
    expect(source).toContain(`revoke all on function ${SIG} from public;`);
    expect(source).toContain(`revoke all on function ${SIG} from anon, authenticated;`);
    expect(source).toContain(`grant execute on function ${SIG} to service_role;`);
    expect(source).not.toMatch(/grant execute on function [^;]*to (anon|authenticated|public)/);
  });

  it("the revoked signature matches the declared parameter list", () => {
    const declared = /create or replace function public\.fw_move_task\(([\s\S]*?)\)\s*\nreturns/.exec(
      source
    )![1];
    const types = [...declared.matchAll(/^\s*p_\w+\s+([a-z ]+?)(?:\s+default.*)?,?$/gm)].map((m) =>
      m[1].trim()
    );
    expect(types).toEqual(["uuid", "text", "text", "uuid", "uuid", "timestamptz", "uuid", "text"]);
    // A revoke against a signature the function does not have silently succeeds
    // in Postgres only if some overload matches — and leaves the real one public.
    expect(SIG).toContain(types.join(", "));
  });
});
