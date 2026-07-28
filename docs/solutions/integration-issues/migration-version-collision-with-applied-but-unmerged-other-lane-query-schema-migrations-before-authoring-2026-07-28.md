---
title: "Migration version collision with the other lane's applied-but-unmerged migration — query schema_migrations for the next free version immediately before authoring"
date: 2026-07-28
category: integration-issues
module: infrastructure
problem_type: integration_issue
component: database
severity: high
symptoms:
  - "Version-row insert with on conflict do nothing silently reports back a DIFFERENT migration name for your version number"
  - "supabase_migrations.schema_migrations holds another lane's name at the version your new file claims"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - development_workflow
tags:
  - supabase
  - migrations
  - version-collision
  - two-lane
  - schema-migrations
  - migration-lock
---

# Migration version collision with the other lane's applied-but-unmerged migration — query schema_migrations for the next free version immediately before authoring

## Problem

Lane A authored `20260811120000_fw_window_edit_attribution.sql`, picking the version by scanning the repo's `supabase/migrations/` listing (latest file: `20260810120000`). Production's `schema_migrations` already held `20260811120000 / funnel_deposit_attempts` — Lane B's migration, applied to production but **not yet merged to main**, so invisible in the file listing.

## Symptoms

The DDL applied fine (idempotent, disjoint tables). The tell was the bookkeeping step: the version-row insert used `on conflict (version) do nothing`, and the follow-up SELECT echoed `20260811120000 funnel_deposit_attempts` — the other lane's name at my version. Without that read-back, the collision would have been silent: two files sharing one version is the state that corrupts every future `db push` diff for both lanes (see MIGRATION-LOCK.md's second-breach record).

## What Didn't Work

Choosing the next version from the repo's migration file listing. **The file listing is not the truth** in a two-lane repo where migrations apply the moment they're authored: the other lane's applied-but-unmerged work exists only in production bookkeeping.

## Solution

Caught same-session, repaired per the established U12 mechanic (zero production DDL):

1. Rename the file to an unclaimed version (`20260811140000_fw_window_edit_attribution.sql`) — content already applied and idempotent, so the rename is pure bookkeeping.
2. Insert the corrected version row; verify with a range SELECT over `schema_migrations`.
3. Record the incident in `supabase/MIGRATION-LOCK.md` (the third of its class).

## Why This Works

`schema_migrations.version` is the primary key and the single shared source of truth both lanes' tooling reads. Aligning file name ↔ version row restores the invariant; the DDL itself never needed touching because house style makes every migration idempotent.

## Prevention

- **Query `schema_migrations` for the next free version IMMEDIATELY before authoring** — one SELECT, through the Management API playbook you're already using to apply:
  `select version, name from supabase_migrations.schema_migrations where version >= '<today>' order by version;`
- Never use `on conflict do nothing` blind on the version-row insert — always read back what the version now maps to; a foreign name at your version is the collision alarm.
- Re-read `MIGRATION-LOCK.md` immediately before authoring (its own standing rule), but know its limit: the lock file can't show applied-but-unmerged versions. Only the query can.
- The lock file's promised tripwire test catches same-repo prefix collisions; this failure class (applied-but-unmerged) is only catchable by the pre-author query.

## Related

- `supabase/MIGRATION-LOCK.md` — the primary incident log (three collisions recorded, this is the third) and the two-lane transfer discipline.
- `docs/solutions/integration-issues/dormant-migration-not-applied-prerequisite-table-missing-2026-07-17.md` — the inverse divergence (file exists, never applied); same meta-lesson: repo listing and production migration state are independent facts — always verify the one you're about to depend on.
- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — the apply/verify playbook the query rides on.
