---
title: "Migration-parity assertions that cannot fail: `toContain` satisfied by the column list, and grant checks satisfied by a commented-out line"
date: 2026-07-23
category: docs/solutions/test-failures
module: path / First Profit (FW) — fw_move_task SQL parity test
problem_type: test_failure
component: testing_framework
symptoms:
  - "Nulling the cohort stamp in an INSERT's VALUES row left all 122 tests green — the assertion was satisfied by the column list"
  - "Commenting out `revoke all ... from anon, authenticated` on a SECURITY DEFINER function left the parity suite green"
  - "Hoisting the state guard from the UPDATE's WHERE clause into its SET clause would have passed the test whose docstring called it 'THE assertion this file exists for'"
  - "A test suite that had already been mutation-tested still contained four assertions that could not fail"
root_cause: logic_error
resolution_type: test_fix
severity: high
tags:
  - migration-parity
  - sql-text-parsing
  - mutation-testing
  - vitest
  - assertion-strength
  - security-definer
  - false-confidence
---

# Migration-parity assertions that cannot fail

## Problem

This repo has no test database, so migrations are pinned by parsing them **as
text** and comparing against the TypeScript that mirrors them (the convention
established in `security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md`).

A new parity test for `fw_move_task` looked thorough — 30 assertions covering the
CASE arms, the author-stamp arms, the WHERE-clause guard, the event columns, and
the grants. Two of its assertions were **incapable of failing**, and a third was
weaker than its own docstring claimed. All three were found by mutation, not by
reading.

## Symptoms

**1. Column-list satisfaction.** The event-write assertion:

```ts
const inserts = body.match(/insert into public\.path_task_events[\s\S]*?on conflict[^;]*;/g);
for (const ins of inserts) {
  for (const col of ["cohort_id", "captured_at", "action_id", "client_id"]) {
    expect(ins, col).toContain(col);      // ← `ins` is the WHOLE statement
  }
}
```

`ins` spans the column list *and* the VALUES row. `toContain("cohort_id")` is
satisfied by the column list forever, regardless of what VALUES binds. Mutating
the applied arm's `p_cohort_id` → `null` left the entire 122-test suite green —
and an unstamped event is invisible to every cohort-scoped board query, so that
mutation would have silently emptied the projected board in a live room.

**2. Comments counted as code.** The grants block asserted against raw source:

```ts
expect(source).toContain(`revoke all on function ${SIG} from anon, authenticated;`);
```

Every *other* assertion in the file ran against a comment-stripped body; this one
did not. Prefixing that line with `-- ` kept the suite green. Postgres grants
EXECUTE to PUBLIC by default on function creation, so this is the assertion
standing between a SECURITY DEFINER, cascade-free write executor and every
authenticated client.

**3. Position-blind guard checking.** The file's headline assertion — that the
per-action legal-from set *is* the UPDATE's WHERE predicate, the property the
whole design's race safety rests on — extracted the entire UPDATE statement (SET
and WHERE undifferentiated) and regex-scanned the blob:

```ts
function updateStatement(body) { /* `update …` up to the first `;` */ }
const arms = legalFromArms(update);          // searches SET *and* WHERE
expect(Object.keys(arms).sort()).toEqual([...FW_ACTIONS].sort());
```

That asserts *"this text exists somewhere in the statement"*, never *"this text
is the thing gating the write."* Relocating the identical CASE into the SET
clause (computed and discarded) with an unguarded WHERE would pass. So would
flipping the connective from `and` to `or`, which short-circuits the
student/task keys and matches nearly every row.

## What Didn't Work

**Mutation-testing only the mutation you thought of.** The suite *had* been
mutation-tested before review: deleting the guard reddened 3 tests, and narrowing
the author stamp reddened 2. Both mutations were **deletions**. Every assertion
above survives deletion-style mutation and fails only under *relocation*,
*substitution*, or *commenting out*. Testing one mutation class produced
confidence that generalized to classes never tested.

**Trusting a docstring as evidence.** The position-blind assertion carried a
comment naming itself "THE assertion this file exists for" and explaining exactly
which bug it prevented. The prose was correct about what *should* be enforced and
was quietly wrong about what the code enforced — which is precisely why it read
as verified.

## Solution

Three changes, each removing a way for the assertion to be trivially satisfied.

**Strip comments before any parsing**, so no assertion can be answered by prose:

```ts
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}
// applied to BOTH the function body and the file-level `source` used by the
// grants block — the inconsistency between the two was the whole bug.
```

**Split the UPDATE at its WHERE**, and assert the guard is in one half and absent
from the other:

```ts
function splitUpdate(update: string) {
  const at = update.search(/\bwhere\b/);            // the SET clause has no `where`
  return at === -1 ? null : { set: update.slice(0, at), where: update.slice(at) };
}

expect(Object.keys(legalFromArms(parts.where)).sort()).toEqual([...FW_ACTIONS].sort());
expect(legalFromArms(parts.set)).toEqual({});       // ← cannot be satisfied by an inert copy
expect(parts.where).toMatch(/\band\s+case p_action/);
expect(parts.where).not.toMatch(/\bor\s+case p_action/);
```

**Assert the VALUES row, not the statement**, by parsing the INSERT into its two
halves:

```ts
const columns = /insert into public\.path_task_events\s*\(([\s\S]*?)\)/.exec(ins)?.[1] ?? "";
const values  = /values\s*\(([\s\S]*?)\)\s*on conflict/.exec(ins)?.[1] ?? "";

for (const param of ["p_cohort_id", "v_captured", "p_action_id", "p_client_id", "p_actor"]) {
  expect(values, param).toContain(param);
}
expect(values).not.toContain("null");
expect(values.split(",").length).toBe(columns.split(",").length);  // arity, so a shifted INSERT is not silent
```

And pin the *parsers themselves* with synthetic fixtures, so the guard survives
any future rewrite of the real migration:

```ts
it("a guard hoisted into the SET clause is NOT counted as the WHERE predicate", () => {
  const hoisted = `
update public.path_task_progress p
set state = v_to,
    junk = case p_action when 'checkmark' then p.state in ('locked') end
where p.student_id = p_student_id`;
  const parts = splitUpdate(hoisted)!;
  expect(legalFromArms(parts.where)).toEqual({});
  expect(Object.keys(legalFromArms(parts.set))).toEqual(["checkmark"]);
});
```

The rebuilt suite was then verified against **six** mutations spanning three
classes — deletion, substitution, and commenting-out — each caught:

| mutation | class | tests reddened |
|---|---|---|
| remove the WHERE guard | deletion | 3 |
| narrow the author stamp to checkmark only | substitution | 2 |
| flip the guard's `and` → `or` | substitution | 2 |
| un-scope the `client_id` probe | substitution | 3 |
| null the cohort stamp in VALUES | substitution | 1 |
| comment out the anon/authenticated revoke | comment-out | 1 |

## Why This Works

Every fix converts an **existence** claim into a **position** claim. "The token
appears in this statement" is satisfiable by any occurrence, including an inert
one and including a comment. "The token appears in this *clause*, and is absent
from that *other* clause" can only be satisfied by the code actually being
arranged the way the property requires.

The negative assertions do the real work. `expect(legalFromArms(parts.set)).toEqual({})`
and `expect(values).not.toContain("null")` are what make the relocation and
substitution mutations fail; without them the positive assertions alone would
still pass on a hoisted copy.

## Prevention

- **Mutation-test across mutation CLASSES, not instances.** Deleting a line,
  *substituting* a value, *relocating* code to an inert position, and *commenting
  it out* are four different classes, and an assertion can be strong against one
  while blind to the rest. A suite verified only against deletion is verified
  against deletion.
- **When a text-parsing assertion spans two clauses, split it.** SQL statements,
  function signatures, and config blocks all have parts that mean different
  things. `toContain` over the whole blob asks the weakest possible question.
  Extract the clause the property is about, and additionally assert its **absence**
  from the clause it must not be in.
- **Apply comment-stripping uniformly, or not at all.** A file that strips
  comments for some assertions and not others has a silent hole exactly where the
  inconsistency is — and the un-stripped assertions are often the security-shaped
  ones (grants, revokes, RLS), because they tend to live outside the function
  body everything else was scoped to.
- **An assertion's docstring is a claim about intent, not evidence of behavior.**
  The more confidently a comment names the bug it prevents, the more it deserves
  a mutation run. Prose confidence and assertion strength are uncorrelated.
- **Assert arity whenever you assert membership.** A column list and a VALUES row
  that disagree in length is a shifted INSERT; if the types line up, Postgres
  accepts it and the corruption is silent.

## Related

- `docs/solutions/test-failures/migration-scanning-parity-test-must-scope-to-its-table-unrelated-column-hijacks-the-allowlist-2026-07-23.md`
  — the sibling scoping failure, one level out: that one matched the wrong
  *table*; this one matches the right function but the wrong *clause*. Same
  family (migration-text parity), different axis. Consider reading both before
  writing any new migration-scanning test.
- `docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md`
  — establishes the parse-the-migration-as-text convention these tests belong to.
  This doc extends it from **value** parity to **structural** parity: asserting
  not just that the SQL says the right thing, but that it says it in the clause
  where the property lives.
- `docs/solutions/logic-errors/idempotency-key-unique-scope-wider-than-the-operation-it-names-silently-swallows-distinct-writes-2026-07-23.md`
  — the production bug found in the same review; this test was supposed to pin
  that SQL.
- Test: `app/path/lib/__tests__/fw-move-task-parity.test.ts`.
  Plan: `docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md` (Unit 3).
