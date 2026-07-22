---
title: "A transition→target map lived in TS, a TS table, AND a SECURITY DEFINER SQL CASE — tests pinned TS-against-TS and never saw the SQL; parse the migration file as text to cover the third copy"
date: 2026-07-22
category: test-failures
module: path-transition-engine
problem_type: test_failure
component: testing_framework
severity: high
symptoms:
  - "A TS constant is pinned against another TS source and both pass, but a third copy of the same map — inside a Postgres function's SQL — is never compared by any test"
  - "A typo or stale value in a migration's `when '<name>' then '<to>'` CASE arm passes the whole suite untouched"
  - "The vitest suite runs in node env with no database, so nothing in CI ever executes or inspects the RPC's SQL body"
  - "A drifted CASE arm surfaces only as a wrong value in production, with no failing test first"
root_cause: missing_tooling
resolution_type: test_fix
related_components:
  - database
tags:
  - vitest
  - postgres
  - security-definer
  - migration
  - single-source-of-truth
  - enum-drift
  - false-green
  - sql-parsing
  - rpc-testing
---

# A SECURITY DEFINER SQL CASE is a third, untested copy of a TS map — parse the migration file to cover it

## Problem

The Path's transition engine encodes one map — *transition name → target task state* — in **three** physical places:

1. `TASK_TRANSITION_TARGETS`, a TS `Record` in `app/path/lib/progress-core.ts`.
2. The `to` field of every row in the Unit 7 transition table, `app/path/lib/transition-table.ts`.
3. The **SQL `CASE`** inside the `SECURITY DEFINER` function `move_path_task` (`supabase/migrations/20260722120000_path_progress.sql`), which "hardcodes" the target so a client can never smuggle a forged one in.

The tests pinned (1) against (2) — **both TypeScript** — and passed. Nothing ever compared the SQL `CASE` (3), because this repo's vitest suite runs `environment: "node"` with **no database**. So a hand-edit to a `CASE` arm — a typo, or a stale `then '…'` left behind after a task-state rename — would ship green and only surface as a wrong task state in production, where no test stands between the drift and a child's permanent record.

## Symptoms

- `TASK_TRANSITION_TARGETS` vs. `TRANSITIONS[i].to` is asserted and green; the SQL `CASE` is not referenced by any test.
- Editing `when 'withdraw' then 'in_progress'` to `then 'not_yet'` in the migration passes the entire suite.
- The RPC drift is silent: the function still returns `wrote = true` with a state the TS layer never expects, so the echo interpreter misclassifies a correct write.

## What Didn't Work

- **Pinning the TS map against the TS table.** It felt like coverage of "the transition target map", and the module's own doc comment claimed the three encodings "can never silently drift". But TS-against-TS is one closed loop; the SQL is a *third* island outside it. Two-of-three agreeing proves nothing about the third.
- **"The DO-block verified it in production."** A one-time manual `DO`-block run against production exercises the RPC's *behaviour*, but it is not committed, not re-run on every change, and does not diff the `CASE` literal against the TS map — so it cannot catch a future drift on either side.

## Solution

**A pure vitest test that reads the migration file as text and regex-parses the `CASE` arms**, asserting parity with the TS map — no database required:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

it("each target equals the matching `when '<t>' then '<to>'` arm of the RPC's SQL CASE", () => {
  const sql = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260722120000_path_progress.sql"),
    "utf8"
  );
  const arms = [...sql.matchAll(/when\s+'(\w+)'\s+then\s+'([a-z_]+)'/g)];
  const sqlMap = Object.fromEntries(arms.map((m) => [m[1], m[2]]));
  for (const t of TASK_TRANSITIONS) {
    expect(sqlMap[t], `SQL CASE arm for "${t}"`).toBe(TASK_TRANSITION_TARGETS[t]);
  }
  // …and the SQL has no extra arms the TS map doesn't know about.
  expect(Object.keys(sqlMap).sort()).toEqual([...TASK_TRANSITIONS].sort());
});
```

Now a drift on **either** side — a wrong SQL literal, a missing/extra arm, a renamed transition — fails a fast, DB-free unit test. Both the "every TS transition has an identical SQL arm" and the "no extra/missing arms" assertions matter: the first catches a wrong value, the second catches a forgotten or duplicated arm.

**Secondary technique — verifying the untestable `SECURITY DEFINER` RPC itself.** With no test DB, the RPC's behaviour (CAS, cascade, audit) is proven with a throwaway-fixture rollback block run over the [Management API](../integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md):

```sql
do $$
declare v_student uuid := gen_random_uuid(); v_log text := ''; …
begin
  -- build a throwaway fixture (auth.users, parent, child, profile, progress rows)
  -- run assertions, appending to v_log …
  raise exception 'RESULT_OK :: %', v_log;  -- RAISE aborts the txn → rolls EVERYTHING back
end $$;
```

The final `RAISE` rolls the whole transaction back, so **no test rows persist**; the assertion log rides out in the error message. A companion probe proves the grants actually block unprivileged callers:

```sql
do $$ begin set local role authenticated;
  perform public.move_path_task(…);
exception when insufficient_privilege then raise exception 'DENIED_OK'; end $$;
```

## Why This Works

The root cause is a **single source of truth split across a language boundary the test harness cannot cross**. A `node`-env vitest suite can execute TS but not SQL, so any invariant that lives partly in a `.sql` file is, by default, half-tested. Reading the migration **as a text file** sidesteps the missing DB entirely: the parity check becomes a pure string comparison the suite *can* run, turning a runtime-only guarantee into a compile-adjacent one. The `SECURITY DEFINER` `CASE` is the worst instance because its drift is **silent** — unlike a `CHECK` constraint (which raises on a bad INSERT), a wrong `CASE` arm just returns the wrong value with `error: null`.

## Prevention

- **Any closed set encoded in BOTH a TS artifact and a Postgres artifact needs a parity test — and when there's no test DB, that test parses the SQL file as text.** This is the third member of this repo's enum-drift family (see Related): the write-path (`CHECK` constraint) and read-path (fail-closed type guard) siblings are about *avoidance* and *runtime* narrowing; this one is a *build-time* parity check enforceable in CI.
- **Count coverage by physical encodings, not by "the concept".** "We test the target map" is false if the map exists in three files and the test touches two. List the copies; assert each pair.
- **A generated/committed artifact whose build step isn't in CI needs a drift test that re-derives ground truth by parsing the source** — the same principle as re-parsing a generated content module byte-for-byte ([aggregate-invariants doc](../logic-errors/aggregate-invariants-not-fixture-spot-checks-for-parsed-content-2026-07-21.md)); here the "source" is a hand-written `.sql` migration.
- **Verify an untestable `SECURITY DEFINER` RPC with a rollback `DO`-block + a role-simulation denial probe** rather than leaving it to a one-off manual run. Reuse the repo's established `set_config('request.jwt.claims', …)` / `set local role` role-simulation mechanics ([stale-status-echo doc](../database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md)) and the Management-API body-encoding rules, don't re-derive them.

## Related

- [DB CHECK-constraint allowlist drifts from a TS enum](../best-practices/crm-audit-action-allowlist-db-check-constraint-drifts-from-ts-enum-2026-07-15.md) — the **write-path** sibling of this enum-drift family (a `CHECK` list vs. a TS enum; drift → a loud runtime insert failure). This doc is the **compute-path** sibling (a `CASE` value map; drift → a *silent* wrong value).
- [Fail-closed type-guard for untyped service-role rows](../best-practices/fail-closed-type-guard-untyped-service-role-rows-into-closed-unions-2026-07-21.md) — the **read-path** sibling (narrow untyped DB rows into a closed TS union at read time).
- [Management-API SQL playbook](../integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md) — how to run the throwaway `DO`-block against production (token, UTF-8 body bytes, typed params).
- [Coerce-not-raise / three-way echo](../database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md) — the role-simulation precedent for the denial probe, and the echo-interpretation the drifted `CASE` would corrupt.
- [Aggregate invariants, not fixture spot-checks](../logic-errors/aggregate-invariants-not-fixture-spot-checks-for-parsed-content-2026-07-21.md) — the general "re-parse the source to guard against drift" precedent.
- Plan: `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md` — Unit 8.
