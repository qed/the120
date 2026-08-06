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
 * to solve. This file parses the migrations AS TEXT and pins them against
 * `fw-rules.ts`.
 *
 * Three disciplines, each learned from a specific failure:
 *
 *   1. STRUCTURE, not just values. Plan Decision 2's load-bearing property is
 *      that the per-action legal-from set IS the UPDATE's WHERE predicate — a
 *      values-only parity test would pass even if someone converted the
 *      compare-and-swap into a check-then-act. So the WHERE clause is extracted
 *      specifically, and the SET clause is asserted NOT to contain the guard.
 *
 *   2. SCOPED to the function, and to the clause. Per docs/solutions/test-
 *      failures/migration-scanning-parity-test-must-scope-to-its-table-…-2026-07-23.md,
 *      a scanner keyed on a bare column name is a landmine for the next migration
 *      author. Both the function scoping and the clause scoping are pinned with
 *      SYNTHETIC fixtures rather than by the continued existence of a real file.
 *
 *   3. COMMENTS ARE NOT CODE. Every assertion runs against comment-stripped SQL.
 *      An earlier revision checked the grant/revoke lines against raw source, so
 *      commenting out `revoke … from anon, authenticated` on a SECURITY DEFINER
 *      function still passed — found by mutation during review.
 *
 * BOTH migrations that define the function are pinned, following the precedent in
 * progress-core.test.ts (which pins the Unit 12 re-creation of `move_path_task`
 * alongside the original). The LAST one is what the live database runs.
 */

const MIGRATIONS = [
  {
    label: "20260730120000 (original definition)",
    file: "supabase/migrations/20260730120000_fw_move_task.sql",
    scopedClientId: false,
    swapsClientIdIndex: false,
    casParam: false,
  },
  {
    label: "20260731120000 (client_id re-scoped)",
    file: "supabase/migrations/20260731120000_fw_client_id_scoped.sql",
    scopedClientId: true,
    swapsClientIdIndex: true,
    casParam: false,
  },
  {
    label: "20260804120000 (offline-only undo CAS — the live definition)",
    file: "supabase/migrations/20260804120000_fw_offline_undo_cas.sql",
    scopedClientId: true,
    swapsClientIdIndex: false,
    casParam: true,
  },
] as const;

/* ─────────────────────────────────────────────────────────── the parsing ──── */

/**
 * Drop `--` line comments before ANY parsing. Two reasons, both found the hard
 * way: a prose semicolon inside a comment ("…above the statement; that converts…")
 * truncates statement extraction, and — the one that matters — an assertion a
 * COMMENT can satisfy is not an assertion. Every check below must be answered by
 * live SQL.
 *
 * Deliberately narrow: this migration has no `--` inside a string literal.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** The body of ONE named function, from its header to the `$$;` that closes it. */
export function functionBody(sql: string, name: string): string | null {
  const stripped = stripSqlComments(sql);
  const start = stripped.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return null;
  const open = stripped.indexOf("as $$", start);
  if (open === -1) return null;
  const end = stripped.indexOf("$$;", open);
  if (end === -1) return null;
  return stripped.slice(open, end);
}

/** The single `update public.path_task_progress … ;` statement inside a body. */
function updateStatement(body: string): string | null {
  const start = body.indexOf("update public.path_task_progress");
  if (start === -1) return null;
  const end = body.indexOf(";", start);
  if (end === -1) return null;
  return body.slice(start, end);
}

/**
 * Split that UPDATE at its WHERE keyword. The SET clause contains `case … end`
 * expressions but no `where`, so the first `where` token is the predicate's.
 * Splitting is the whole point: "the guard is somewhere in this statement" is a
 * far weaker claim than "the guard IS the predicate".
 */
function splitUpdate(update: string): { set: string; where: string } | null {
  const at = update.search(/\bwhere\b/);
  if (at === -1) return null;
  return { set: update.slice(0, at), where: update.slice(at) };
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

/* ═══════════════════════════════════════════ the parsers have teeth ══ */

describe("the parsers are scoped — pinned by synthetic fixture, not by a real file", () => {
  it("scopes to the NAMED function — a sibling function's CASE cannot hijack it", () => {
    const fixture = `
create or replace function public.some_other_fn(p_action text)
returns void language plpgsql as $$
begin
  v_to := case p_action
    when 'checkmark' then 'wrong_state'
  end;
end;
$$;

create or replace function public.fw_move_task(p_student_id uuid)
returns void language plpgsql as $$
begin
  v_to := case p_action
    when 'checkmark' then 'verified'
  end;
end;
$$;`;
    expect(targetArms(functionBody(fixture, "fw_move_task")!)).toEqual({ checkmark: "verified" });
    expect(targetArms(functionBody(fixture, "some_other_fn")!)).toEqual({
      checkmark: "wrong_state",
    });
    expect(functionBody(fixture, "no_such_fn")).toBeNull();
  });

  it("a guard hoisted into the SET clause is NOT counted as the WHERE predicate", () => {
    // The mutation this fixture exists for: move the identical CASE text into the
    // SET clause (where it is computed and discarded) and leave the WHERE with no
    // guard. A test that scanned the whole statement would still pass; splitting
    // at WHERE is what makes it fail.
    const hoisted = `
update public.path_task_progress p
set state = v_to,
    junk = case p_action
             when 'checkmark' then p.state in ('locked')
           end
where p.student_id = p_student_id`;
    const parts = splitUpdate(hoisted)!;
    expect(legalFromArms(parts.where)).toEqual({});
    expect(Object.keys(legalFromArms(parts.set))).toEqual(["checkmark"]);
  });

  it("comment-stripping means a commented-out statement cannot satisfy an assertion", () => {
    const commented = `-- revoke all on function public.fw_move_task(uuid) from anon;`;
    expect(stripSqlComments(commented).trim()).toBe("");
  });
});

/* ═══════════════════════════════════════ per-migration parity assertions ══ */

describe.each(MIGRATIONS)("$label", ({ file, scopedClientId, swapsClientIdIndex, casParam }) => {
  const raw = readFileSync(path.resolve(process.cwd(), file), "utf8");
  const source = stripSqlComments(raw);
  const body = functionBody(raw, "fw_move_task");

  it("defines fw_move_task and yields a parseable body", () => {
    expect(body, `no fw_move_task body found in ${file}`).not.toBeNull();
    expect(body!.length).toBeGreaterThan(500);
  });

  /* ── the hardcoded target map ── */

  it("every TS action has an SQL arm with the identical target, and no extras", () => {
    const arms = targetArms(body!);
    for (const a of FW_ACTIONS) {
      expect(arms[a], `SQL CASE arm for "${a}"`).toBe(FW_ACTION_TARGETS[a]);
    }
    expect(Object.keys(arms).sort()).toEqual([...FW_ACTIONS].sort());
  });

  it("an unknown action RAISES rather than defaulting to a target", () => {
    expect(body).toMatch(/else null\s*\n\s*end;/);
    expect(body).toMatch(/raise exception 'unknown fw action: %', p_action;/);
  });

  /* ── race safety: the guard IS the WHERE predicate ── */

  describe("race safety is structural", () => {
    const update = updateStatement(body!);
    const parts = update ? splitUpdate(update) : null;

    it("has exactly one UPDATE of path_task_progress, with a WHERE clause", () => {
      expect(body!.match(/update public\.path_task_progress/g)).toHaveLength(1);
      expect(parts).not.toBeNull();
    });

    it("the per-action state guard is in the WHERE clause — not the SET, not hoisted above", () => {
      // THE assertion this file exists for. Converting this compare-and-swap into
      // a check-then-act reintroduces the lost update the whole design prevents.
      expect(Object.keys(legalFromArms(parts!.where)).sort()).toEqual([...FW_ACTIONS].sort());
      // …and it is genuinely absent from the SET clause, so the test cannot be
      // satisfied by an inert copy.
      expect(legalFromArms(parts!.set)).toEqual({});
    });

    it("the guard is ANDed into the predicate, never ORed", () => {
      // `or` would short-circuit the student/task keys and match nearly every row.
      expect(parts!.where).toMatch(/\band\s+case p_action/);
      expect(parts!.where).not.toMatch(/\bor\s+case p_action/);
    });

    it("each arm's state list equals FW_ACTION_LEGAL_FROM exactly", () => {
      const arms = legalFromArms(parts!.where);
      for (const a of FW_ACTIONS) {
        expect(arms[a].slice().sort(), `legal-from for "${a}"`).toEqual(
          [...FW_ACTION_LEGAL_FROM[a]].sort()
        );
      }
    });

    it("no arm lists a state outside the task-state union, or its own target", () => {
      const arms = legalFromArms(parts!.where);
      for (const a of FW_ACTIONS) {
        for (const s of arms[a]) {
          expect(TASK_STATES as readonly string[], `${a} from ${s}`).toContain(s);
        }
        expect(arms[a], a).not.toContain(FW_ACTION_TARGETS[a]);
      }
    });

    it("the UPDATE is keyed on the student AND the task — never a task-wide write", () => {
      expect(parts!.where).toMatch(/p\.student_id = p_student_id/);
      expect(parts!.where).toMatch(/p\.task_id = p_task_id/);
    });
  });

  /* ── author stamping ── */

  describe("author stamping — BOTH decisions stamp, undo clears", () => {
    const set = splitUpdate(updateStatement(body!)!)!.set;

    it("verified_by is set for checkmark AND not_yet, and NULLed otherwise", () => {
      // Unit 8's same-actor undo guard reads this column to decide whether a
      // replayed offline undo may apply. Stamping only `verified` rows — the
      // Path's behaviour — would make that guard unevaluable for half the
      // decisions it must judge.
      expect(set).toMatch(
        /verified_by = case when p_action in \('checkmark', 'not_yet'\) then p_actor else null end/
      );
    });

    it("verified_role is stamped the same way, with the events CHECK's 'adult' literal", () => {
      expect(set).toMatch(
        /verified_role = case when p_action in \('checkmark', 'not_yet'\) then 'adult' else null end/
      );
    });

    it("undo is the only action in neither stamp list — so it is the only one that clears", () => {
      const stamped = /case when p_action in \((.*?)\) then p_actor/.exec(set)![1];
      const listed = [...stamped.matchAll(/'(\w+)'/g)].map((m) => m[1]);
      expect(listed.sort()).toEqual(["checkmark", "not_yet"]);
      expect(FW_ACTIONS.filter((a: FwAction) => !listed.includes(a))).toEqual(["undo"]);
    });

    it("decided_at is cleared on undo — an undone task must not read as decided", () => {
      expect(set).toMatch(/decided_at = case when p_action = 'undo' then null else now\(\) end/);
    });

    it("snapshot_band is frozen once, on checkmark only, from the profile's own band", () => {
      expect(set).toMatch(/snapshot_band = case[\s\S]*?p_action = 'checkmark'[\s\S]*?coalesce\(p\.snapshot_band, v_band\)/);
      expect(body).toMatch(/select sp\.band into v_band/);
    });
  });

  /* ── the event write ── */

  describe("the event write", () => {
    const eventInserts = () => {
      const rawIns =
        body!.match(/insert into public\.path_task_events[\s\S]*?on conflict[^;]*;/g) ?? [];
      return rawIns.map((ins) => ({
        ins,
        columns: /insert into public\.path_task_events\s*\(([\s\S]*?)\)/.exec(ins)?.[1] ?? "",
        values: /values\s*\(([\s\S]*?)\)\s*on conflict/.exec(ins)?.[1] ?? "",
      }));
    };

    it("names every FW column on both event-writing arms (applied + re-attempt; already_done writes none)", () => {
      const inserts = eventInserts();
      expect(inserts).toHaveLength(2);
      for (const { columns } of inserts) {
        for (const col of ["cohort_id", "captured_at", "action_id", "client_id"]) {
          expect(columns, col).toContain(col);
        }
      }
    });

    it("BINDS each of those columns to its parameter — not to null", () => {
      // Why this is separate from the test above: an earlier revision asserted
      // only that the INSERT contained "cohort_id", which the COLUMN LIST
      // satisfies no matter what VALUES passes. Mutating `p_cohort_id` -> `null`
      // left the whole suite green — and an unstamped event is invisible to every
      // cohort-scoped board query, so the mutation would have silently emptied
      // the room's board.
      const inserts = eventInserts();
      expect(inserts).toHaveLength(2);
      for (const { values } of inserts) {
        for (const param of ["p_cohort_id", "v_captured", "p_action_id", "p_client_id", "p_actor"]) {
          expect(values, param).toContain(param);
        }
        expect(values).toContain("'adult'");
        expect(values).toContain("v_from");
        expect(values).toContain("v_to");
        expect(values).not.toContain("null");
      }
    });

    it("keeps the column list and the VALUES row the same arity", () => {
      for (const { columns, values } of eventInserts()) {
        expect(values.split(",").length).toBe(columns.split(",").length);
      }
    });

    it("the re-attempt arm is reachable only for not-yet onto not_yet", () => {
      expect(body).toMatch(/elsif p_action = 'not_yet' and v_from = 'not_yet' then/);
    });

    it("clamps captured_at against the server clock", () => {
      expect(body).toMatch(/v_captured := least\(coalesce\(p_captured_at, now\(\)\), now\(\)\);/);
    });

    it("classifies a missing progress row rather than inserting one (the no-upsert contract)", () => {
      expect(body).toMatch(/'missing'::text/);
      expect(body).not.toMatch(/insert into public\.path_task_progress/);
    });

    it("re-asserts the cohort stamp against authoritative rows (Decision 3)", () => {
      expect(body).toMatch(/from public\.path_cohort_members m/);
      expect(body).toMatch(/join public\.path_cohorts c on c\.id = m\.cohort_id/);
      expect(body).toMatch(/c\.kind = 'fw'/);
      expect(body).toMatch(/'cohort_invalid'::text/);
    });

    it("checks the cohort BEFORE the replay probe — an invalid cohort must not learn whether a client_id was used", () => {
      expect(body!.indexOf("'cohort_invalid'::text")).toBeLessThan(
        body!.indexOf("'replayed'::text")
      );
    });

    it("short-circuits a replayed client_id AFTER the row lock and BEFORE the update", () => {
      const lockAt = body!.indexOf("for update");
      const replayAt = body!.indexOf("'replayed'::text");
      const updateAt = body!.indexOf("update public.path_task_progress");
      expect(lockAt).toBeGreaterThan(-1);
      expect(replayAt).toBeGreaterThan(lockAt);
      expect(replayAt).toBeLessThan(updateAt);
    });
  });

  /* ── the idempotency key's scope ── */

  describe("the exactly-once key", () => {
    if (scopedClientId) {
      it("probes and dedupes on (student_id, task_id, client_id) — the key's documented meaning", () => {
        // The adversarial review's P1: a GLOBAL client_id probe matches a
        // DIFFERENT student's event that happens to carry the same value, and
        // silently swallows this student's check-in as a replay.
        expect(body).toMatch(
          /from public\.path_task_events e\s*\n?\s*where e\.student_id = p_student_id\s*\n?\s*and e\.task_id = p_task_id\s*\n?\s*and e\.client_id = p_client_id/
        );
        expect(
          body!.match(
            /on conflict \(student_id, task_id, client_id\) where client_id is not null do nothing/g
          )
        ).toHaveLength(2);
        // …and the un-scoped forms are gone.
        expect(body).not.toMatch(/on conflict \(client_id\)/);
        expect(body).not.toMatch(/where e\.client_id = p_client_id\s*\n?\s*\)/);
      });

      if (swapsClientIdIndex) {
        it("the migration swaps the index the ON CONFLICT infers, in the safe order", () => {
          // Create the replacement before dropping the old one, so no window exists
          // without a uniqueness guard. Only the migration that PERFORMS the swap
          // carries it; a later `create or replace` that merely reuses the scoped key
          // (the CAS migration) does not re-swap the index.
          const createAt = source.indexOf("create unique index if not exists path_task_events_student_task_client_id_key");
          const dropAt = source.indexOf("drop index if exists public.path_task_events_client_id_key");
          expect(createAt).toBeGreaterThan(-1);
          expect(dropAt).toBeGreaterThan(createAt);
          expect(source).toMatch(
            /on public\.path_task_events \(student_id, task_id, client_id\)\s*\n?\s*where client_id is not null/
          );
        });
      }
    } else {
      it("used the un-scoped key (superseded by the next migration)", () => {
        expect(body!.match(/on conflict \(client_id\) where client_id is not null do nothing/g)).toHaveLength(2);
      });
    }
  });

  /* ── the cascade that must not exist ── */

  describe("no cascade — FW activity can never touch a Path journey", () => {
    it("never opens a review, unlocks a next task, or enqueues a notification", () => {
      expect(body).not.toMatch(/path_maybe_open_review/);
      expect(body).not.toMatch(/path_reviews/);
      // NB `'available'` legitimately appears in the legal-from lists (FW has no
      // gating); what must not exist is an ASSIGNMENT to it.
      expect(body).not.toMatch(/state\s*=\s*'available'/);
      expect(body).not.toMatch(/'unlock'/);
      expect(body).not.toMatch(/path_unit_tasks/);
      expect(body).not.toMatch(/path_notification/);
    });

    it("leaves move_path_task entirely alone", () => {
      expect(source).not.toMatch(/create or replace function public\.move_path_task/);
      expect(source).not.toMatch(/drop function[^;]*move_path_task/);
    });
  });

  /* ── the grants ── */

  describe("service-role only", () => {
    // The CAS migration adds a 9th param (p_expected_verified_by uuid), so the
    // revoked signature grows by one uuid. Every other migration is 8-arg.
    const EXPECTED_TYPES = casParam
      ? ["uuid", "text", "text", "uuid", "uuid", "timestamptz", "uuid", "text", "uuid"]
      : ["uuid", "text", "text", "uuid", "uuid", "timestamptz", "uuid", "text"];
    const SIG = `public.fw_move_task(${EXPECTED_TYPES.join(", ")})`;

    it("is SECURITY DEFINER with a pinned search_path", () => {
      // Asserted against COMMENT-STRIPPED source: an earlier revision read raw
      // source, so commenting out a revoke line still passed — on a function that
      // Postgres grants EXECUTE to PUBLIC by default.
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
      expect(types).toEqual(EXPECTED_TYPES);
      // A revoke against a signature the function does not have silently succeeds
      // only if some overload matches — leaving the real one public.
      expect(SIG).toContain(types.join(", "));
    });
  });

  /* ── the offline-only undo CAS (Unit 9) ── */

  if (casParam) {
    describe("the offline-only undo CAS", () => {
      const parts = splitUpdate(updateStatement(body!)!)!;

      it("drops the old 8-arg overload BEFORE creating the 9-arg one (no PGRST203 ambiguity)", () => {
        // The migration header spends a paragraph on why this drop exists: adding a param
        // creates a distinct overload, and two fw_move_task functions would make an 8-named-
        // arg PostgREST call ambiguous. Pin the drop (of the exact 8-arg signature) and that
        // it precedes the create — the analogue of the index-swap-order assertion above.
        const dropAt = source.search(
          /drop function if exists public\.fw_move_task\(\s*uuid, text, text, uuid, uuid, timestamptz, uuid, text\s*\)/
        );
        const createAt = source.indexOf("create or replace function public.fw_move_task");
        expect(dropAt).toBeGreaterThan(-1);
        expect(createAt).toBeGreaterThan(dropAt);
      });

      it("declares the optional p_expected_verified_by uuid param", () => {
        // The param must exist AND default to null, so every existing 8-arg caller
        // (the whole online write path) keeps working unchanged. Asserted against
        // `source` — the param list lives in the signature, before `as $$`, so it is
        // NOT inside `body` (which starts at the function body).
        expect(source).toMatch(/p_expected_verified_by uuid default null/);
      });

      it("puts the CAS in the WHERE predicate, ANDed alongside the state guard", () => {
        // The CAS is a term of the UPDATE's WHERE, not a preceding `if` — same
        // reason the state guard is: a check-then-act reintroduces the lost update.
        // Extract the CAS clause specifically and assert its exact shape.
        expect(parts.where).toMatch(/p\.verified_by = p_expected_verified_by/);
        // …and it is genuinely in the WHERE, not the SET (where it would be inert).
        expect(parts.set).not.toMatch(/p_expected_verified_by/);
      });

      it("is CONDITIONAL — both escape clauses present, so online cross-actor undo survives", () => {
        // THE mutation this test exists for. Dropping either escape clause makes the
        // CAS unconditional and breaks the INTENDED online cross-actor undo (any guide
        // may undo any decision live). Both `p_expected_verified_by is null` (the online
        // path) and `p_action <> 'undo'` (checkmark/not_yet) must gate it.
        expect(parts.where).toMatch(/p_expected_verified_by is null\s*\n?\s*or p_action <> 'undo'\s*\n?\s*or p\.verified_by = p_expected_verified_by/);
      });

      it("classifies a CAS-refused undo as `cross_actor_undo`, gated on a non-null expectation", () => {
        // The new distinguishable outcome the drain maps to the cross_actor_undo reject.
        // Gated on p_expected_verified_by IS NOT NULL and the two decision states, so it
        // can never fire on an online undo or on a plain refusal.
        expect(body).toMatch(
          /elsif p_action = 'undo' and p_expected_verified_by is not null\s*\n?\s*and v_from in \('verified', 'not_yet'\)\s*\n?\s*and v_author is distinct from p_expected_verified_by then/
        );
        expect(body).toMatch(/v_outcome := 'cross_actor_undo';/);
      });

      it("the CAS-refused arm writes NO event — it is between already_done and refused, both no-ops", () => {
        // A cross_actor_undo must not append an event; the concurrent decision stands.
        // Assert the arm sits AFTER the two event-writing arms (applied, re_attempt) so
        // it can only be reached on a zero-row UPDATE.
        const appliedAt = body!.indexOf("v_outcome := 'applied';");
        const crossAt = body!.indexOf("v_outcome := 'cross_actor_undo';");
        const refusedAt = body!.indexOf("v_outcome := 'refused';");
        expect(appliedAt).toBeGreaterThan(-1);
        expect(crossAt).toBeGreaterThan(appliedAt);
        expect(refusedAt).toBeGreaterThan(crossAt);
      });
    });
  } else {
    it("has no CAS param — the pre-CAS definitions take exactly 8 args", () => {
      expect(body).not.toMatch(/p_expected_verified_by/);
    });
  }
});
