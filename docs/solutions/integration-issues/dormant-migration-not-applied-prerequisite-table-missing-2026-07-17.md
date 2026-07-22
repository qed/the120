---
title: "A committed migration file ≠ an applied migration — a new migration that references a dormant-but-unapplied table fails in prod"
date: 2026-07-17
category: integration-issues
module: infrastructure
problem_type: integration_issue
component: database
symptoms:
  - 'Management API rejects a new migration: {"message":"Failed to run sql query: ERROR: 42P01: relation \"public.gauntlet_tournament_entries\" does not exist"}'
  - "A later migration FK/join/index references a table whose migration file is committed in supabase/migrations/ but was never applied to production"
  - "schema_migrations gains a version row for a migration whose DDL actually failed (apply and record were separate API calls), creating drift"
root_cause: config_error
resolution_type: workflow_improvement
severity: medium
last_updated: 2026-07-17
related_components:
  - database
  - development_workflow
tags:
  - supabase
  - management-api
  - migrations
  - dormant-schema
  - schema-migrations-drift
  - prerequisite-table
---

# A committed migration file ≠ an applied migration — dormant tournament tables aren't in prod

## Problem

Applying a new migration (`20260717120000_gauntlet_tournament_scoring.sql`) to production via the Management API failed because it FKs/joins/indexes `public.gauntlet_tournament_entries` — a table whose migration file (`20260716120000_gauntlet_tournament_entries.sql`) had been **committed and shipped in PR #9 but never actually applied to production**. This project intentionally ships some schema **dormant**: the migration file lands in `supabase/migrations/`, the app degrades gracefully when the table is absent (RLS-on-no-policies, `res.error ? [] : res.data` reads), and the migration is only applied at turn-on time (it's a step in the Gauntlet Turn-On Checklist). So a committed migration file is **not** proof the object exists in prod.

## Symptoms

- `{"message":"Failed to run sql query: ERROR:  42P01: relation \"public.gauntlet_tournament_entries\" does not exist\n"}` when POSTing the new migration to `/v1/projects/{ref}/database/query`.
- The follow-up RPC smoke test failed too: `42883: function public.gauntlet_tournament_leaderboard(...) does not exist` (the function never got created because the whole DDL transaction errored out on the missing table).
- `schema_migrations` ended up with a `20260717120000` row **even though its DDL failed** — because the "record the version" INSERT was a *separate* Management-API call that ran after the failed apply, briefly showing the migration as applied when it wasn't.

## What Didn't Work

1. **Assuming a committed migration file means the table exists in prod.** It doesn't when the project ships dormant schema — `supabase/migrations/20260716120000_gauntlet_tournament_entries.sql` was in git and referenced everywhere, but `to_regclass('public.gauntlet_tournament_entries')` returned `null` in production.
2. **Recording the version after apply without gating on apply success.** The `insert into supabase_migrations.schema_migrations` call succeeded independently of the failed DDL, so `schema_migrations` drifted ahead of reality.

## Solution

Apply the prerequisite dormant migration **first**, then the dependent one, then record both — all verified against `to_regclass`/`to_regprocedure`:

```powershell
# (inside the single Management-API PowerShell invocation — see the stale-password playbook)

# 0. Check what actually exists BEFORE applying (cheap, catches the dormant gap):
Invoke-SbQuery "select to_regclass('public.gauntlet_tournament_entries') as entries;"  # -> null means NOT applied

# 1. Apply the prerequisite (dormant) migration first:
Invoke-SbQuery ([string](Get-Content -Raw -Encoding UTF8 'supabase\migrations\20260716120000_gauntlet_tournament_entries.sql'))
Invoke-SbQuery "insert into supabase_migrations.schema_migrations (version, name) values ('20260716120000','gauntlet_tournament_entries') on conflict (version) do nothing;"

# 2. Now the dependent migration applies cleanly:
Invoke-SbQuery ([string](Get-Content -Raw -Encoding UTF8 'supabase\migrations\20260717120000_gauntlet_tournament_scoring.sql'))

# 3. Verify the objects exist, THEN trust schema_migrations:
Invoke-SbQuery "select to_regclass('public.gauntlet_tournament_events') as events,
                       to_regprocedure('public.gauntlet_tournament_leaderboard(text,timestamptz,timestamptz)') as rpc;"
```

The dependent migration used `create table if not exists` / `create or replace function` / `create index if not exists`, so re-running it after the prerequisite landed was safe and idempotent.

## Why This Works

The 42P01 error is a hard dependency failure: Postgres runs the migration as one unit, and the first statement referencing the missing table aborts the whole thing (so even the unrelated function/index in the same file never get created). Applying the prerequisite first satisfies the FK/join/index target. Verifying with `to_regclass`/`to_regprocedure` (not `schema_migrations`) confirms the *objects* exist, because `schema_migrations` only records what someone *claimed* to apply — it can drift when apply and record are separate calls.

## Prevention

- **Before applying any migration that references another object, check the object exists in prod** — `select to_regclass('public.<table>')` (or `to_regprocedure` for functions). A `null` means the referencing migration will 42P01, regardless of whether the referenced migration file is committed. This matters specifically in this repo because tournament/lead-capture schema ships **dormant** and is applied later.
- **Gate the `schema_migrations` record on the DDL actually succeeding.** When apply and record are separate Management-API calls, only run the record INSERT after the apply call returns without error, or the version row lies. If a record slips in ahead of a failed apply, reconcile by re-applying the (idempotent) migration so reality matches the record.
- **Keep dependent migrations idempotent** (`if not exists` / `create or replace`) so re-running after fixing a prerequisite is safe.
- **When you author a migration that depends on dormant schema, apply the prerequisite in the same session** and note the dependency in the migration header, so a future turn-on doesn't hit the same 42P01.

## Related Issues

- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — the Management-API apply playbook this builds on (credential handling, UTF-8 body, "record in `schema_migrations`"). This doc adds the **prerequisite-exists** and **gate-the-record-on-success** rules to that workflow.
- `docs/solutions/workflow-issues/split-phase-migrations-pre-deploy-schema-post-deploy-purge-separate-files-rerun-2026-07-14.md` — sibling: migrations applied manually per phase; state dependencies imperatively in the header.
- `docs/solutions/integration-issues/postgrest-head-count-probe-false-positive-existence-check-2026-07-21.md` — the corollary for when you check existence from a **PostgREST/`supabase-js` client with no raw-SQL access** (so `to_regclass` isn't directly reachable): the naive `{ head: true }` count probe is a trap that reports every missing table as "ready." Use `.select('*').limit(0)` and classify `PGRST205`.
- `artifacts/roadmap.md` — the Gauntlet Turn-On Checklist lists "apply the entries migration" as a dormant step; this incident is why a dependent migration surfaced it early.
