---
title: "add column if not exists skips the WHOLE clause — the FK/constraint rides the same gate, so a pre-existing bare column stays unconstrained forever"
date: 2026-07-27
module: supabase migrations (idempotency claims)
category: database-issues
problem_type: database_issue
symptoms:
  - "A re-applied migration reports success but the column's FK/CHECK is absent"
  - "confdeltype verification passes on first apply, and nothing re-verifies later"
root_cause: "Postgres's IF NOT EXISTS on ADD COLUMN gates the entire clause — column, type, references, on delete — as one unit; if the column pre-exists in any form, everything else is silently skipped"
resolution_type: process_change
tags: [postgres, migrations, idempotency, if-not-exists, foreign-key, supabase]
---

# `add column if not exists … references …` skips the constraint with the column

## Problem

`alter table t add column if not exists c uuid references auth.users (id) on delete
restrict;` reads as "ensure this column exists with this FK". It is not. IF NOT
EXISTS gates the **whole clause**: if `c` exists — from a manual hotfix, a
partially-run older file, a refactor that added the bare column — the statement is a
clean no-op and the FK is never added. No error, no notice. The "idempotent —
re-applying is a no-op" claim in the file header is true only for the two clean
states (both present, both absent); the partial state re-applies to nothing and
looks identical to success.

## Solution / Prevention

- **The claim to write in the header is narrower:** "idempotent from either state
  THIS FILE produces", not "idempotent". Name the partial state explicitly.
- **Verification belongs to every apply, not the first.** This repo's POST-APPLY
  checklist catches the gap on apply #1 (`select confdeltype from pg_constraint
  where conname = '…_fkey'` → `'r'`); the trap is a RE-apply after someone created
  the bare column. If a column could pre-exist, split the statement: add the column
  IF NOT EXISTS, then add the constraint as its own guarded step
  (`do $$ … if not exists (select 1 from pg_constraint where conname = …) then
  alter table … add constraint …; end if; … $$`).
- A text-parity test cannot see this — it asserts what the file SAYS, and the file
  says the right thing. Only the `pg_constraint` query against the live database
  answers it, which is why it sits in the POST-APPLY block rather than the test.

Found by the Unit 6 data-migrations review of
`supabase/migrations/20260806120000_fw_cohort_archive.sql` — not live there (the
column had never pre-existed; first apply verified `confdeltype = 'r'`), recorded
because the idiom is copied file-to-file in this repo and the next copier may not
have a clean first apply.
