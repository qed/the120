---
title: A migration-scanning parity test must scope to its own table — an unrelated column name hijacks the allowlist
date: 2026-07-23
category: docs/solutions/test-failures
module: crm audit log; supabase migrations
problem_type: test_failure
component: testing_framework
symptoms:
  - A green test suite turns red on a commit that never touched the module it tests
  - "AssertionError: expected [ 'checkmark', 'not_yet', 'undo' ] to deeply equal [ 'clear-stamp', …(20) ]"
  - A brand-new, unrelated migration is silently treated as the authoritative definition of another table's CHECK constraint
root_cause: scope_issue
resolution_type: test_fix
severity: medium
tags:
  - migration-parity
  - sql-text-parsing
  - vitest
  - false-positive
  - enum-drift
---

# A migration-scanning parity test must scope to its own table

## Problem

This repo has a family of tests that parse `supabase/migrations/*.sql` **as text**
to pin a closed set that lives in both TypeScript and SQL (there is no test
database, so the migration is an untested third copy — see
`security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md`).

`app/crm/__tests__/audit-actions-parity.test.ts` pinned the `crm_audit_log`
action allowlist that way. It found the authoritative definition by scanning
**every** migration file in timestamp order and taking the last one that matched:

```ts
const re = /check \(action in \(([\s\S]*?)\)\)/g;   // ← no table anywhere in this pattern
```

The comment above it said "the LAST migration that (re)defines the constraint,
because each re-add re-lists every value and the final one is what the live DB
enforces." That reasoning is correct. The regex did not implement it — it
matched *any* table's `action` column.

## Symptoms

Adding an unrelated migration with an ordinary column name broke it:

```sql
-- supabase/migrations/20260728120000_fw_cohort_sprints.sql
create table if not exists public.path_fw_replay_rejects (
  ...
  action text not null check (action in ('checkmark', 'not_yet', 'undo')),
```

Two tests went red on a commit that touched nothing in `app/crm/`:

```
AssertionError: expected [ 'checkmark', 'not_yet', 'undo' ]
  to deeply equal [ 'clear-stamp', 'concern-update', … ]
AssertionError: 20260728120000_fw_cohort_sprints.sql dropped 'family-add'
  present in 20260722180000_crm_audit_path_recovery.sql
```

The new file sorted last, so the scanner adopted a completely different table's
three-value CHECK as the CRM audit allowlist.

## What Didn't Work

- **Renaming the new column.** `action` is the right name for an FW check-in
  action (`checkmark` / `not_yet` / `undo`). Bending a new table's schema around
  another module's test regex is the tail wagging the dog.
- **Treating it as a real drift.** The failure message ("dropped 'family-add'")
  reads like a genuine audit-trail regression, which is exactly why this class of
  false positive is expensive — the next person will spend real time on it before
  discovering the regex is the bug.

## Solution

Scope the scan to the table it is about, matching the two shapes that actually
define the constraint:

```ts
function lastActionListIn(source: string): string[] | null {
  const lists: string[] = [];

  // (a) the original definition, inside `create table public.crm_audit_log (…)`
  const created = /create table public\.crm_audit_log\s*\(([\s\S]*?)\n\);/.exec(source);
  if (created) {
    const inline = /check \(action in \(([\s\S]*?)\)\)/.exec(created[1]);
    if (inline) lists.push(inline[1]);
  }

  // (b) every later re-add, by constraint NAME
  const re = /add constraint crm_audit_log_action_check check \(action in \(([\s\S]*?)\)\)/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) lists.push(m[1]);

  if (lists.length === 0) return null;
  return [...lists[lists.length - 1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
```

And pin the scoping itself with a **synthetic fixture**, not a real file:

```ts
it("ignores an unrelated table's `action` CHECK (the scoping guard)", () => {
  const unrelated = `
    create table if not exists public.path_fw_replay_rejects (
      action text not null check (action in ('checkmark', 'not_yet', 'undo'))
    );`;
  expect(lastActionListIn(unrelated)).toBeNull();

  // …and a file that DOES define the audit log is still read correctly, even
  // when an unrelated `action` CHECK sits later in the same file.
});
```

## Why This Works

The scan now keys on the **table and constraint name**, which is what the test's
own comment always claimed it did. The synthetic fixture matters as much as the
regex: an assertion written against whichever real migration happens to sort last
silently stops testing anything the day that file is renamed or its column
removed. A fixture keeps the guard alive independent of the repo's file list.

## Prevention

- **Any test that globs `supabase/migrations/*.sql` must anchor on the table or
  constraint name**, never on a column name alone. Column names like `action`,
  `state`, `kind`, `status`, and `type` recur across schemas — a scanner that
  matches on one is a landmine for the next migration author, and the blast lands
  on a module they have never opened.
- **"Last file wins" scans are especially sharp**, because the newest, least
  related migration is the one most likely to hijack them. If a test picks a
  winner by sort order, it must filter the candidate set first.
- **Pin scoping guards with synthetic fixtures.** A regression test whose only
  evidence is a real file's continued existence is a test with an expiry date
  nobody wrote down.
- **When a migration breaks an unrelated suite, suspect the suite.** A new
  `create table` cannot retroactively change another table's constraint; if a
  parity test says it did, the test is reading the wrong file.

## Related

- `docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md`
  — establishes the parse-the-migration-as-text convention this test belongs to.
- `docs/solutions/best-practices/crm-audit-action-allowlist-db-check-constraint-drifts-from-ts-enum-2026-07-15.md`
  — the original drift this test was written to prevent (still valid; only the
  scan was wrong).
- Sibling scanners to check when adding a migration:
  `app/path/lib/__tests__/progress-core.test.ts`,
  `evidence-migration-parity.test.ts`, `fw-migration-parity.test.ts`.
