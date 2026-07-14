---
title: "Split-phase migrations: pre-deploy schema changes and post-deploy data purges need separate files — and the purge must be re-run after stale tabs have cycled"
date: 2026-07-14
category: workflow-issues
module: database-migrations
problem_type: workflow_issue
component: database
severity: high
applies_when:
  - "A release needs both a pre-deploy schema/trigger change AND a post-deploy data mutation (backfill or purge) in one rollout"
  - "The post-deploy step depends on the pre-deploy step already being live (a new route, guard, or trigger reads/writes the new column)"
  - "Users may have browser tabs open from before the deploy that keep running old client code indefinitely"
  - "An irreversible follow-up (e.g. dropping a column) is being considered after a purge or backfill 'looks clean'"
  - "Migrations are applied manually via an out-of-band channel (Management API) rather than tooling that enforces ordering"
tags:
  - supabase
  - migrations
  - rollout-sequencing
  - data-purge
  - stale-client-bundle
  - split-migration
  - post-deploy
  - management-api
---

# Split-phase migrations: pre-deploy schema changes and post-deploy data purges need separate files — and the purge must be re-run after stale tabs have cycled

## Context

PR #5 (plan `2026-07-14-002`) needed two production DB changes in one release: (a) `children.submission_notified_at` + guard trigger — required **before** deploy, because the new `/api/notify-submission` route depends on it the moment it goes live; and (b) `UPDATE children SET test_scores = ''` — safe only **after** deploy, because the old client bundle's `childToRow` round-trips `test_scores` on every debounced autosave, so purging first lets a live session immediately re-upload the value.

The implementation plan originally put both statements in one migration file with a hedging ops note ("may ship in the same file but… if so, split into two files"). Three independent plan reviewers (coherence, feasibility, adversarial) converged on this as self-contradictory: the natural reading of a single file is "apply it at rollout step 1," which runs the purge pre-deploy — and records the migration as applied, leaving nothing to run at the correct step. There is no "apply half a file now" in any tooling.

## Guidance

**1. One migration file per rollout phase — never a hedged single file.** A pre-deploy statement and a post-deploy statement are two files with two timestamps, unconditionally. A migration's only phase-enforcement mechanism is someone reading its header before running it; a mixed file can't express "run only my top half now."

**2. State the phase in the header, imperatively, with the why.** The two real files from this release are the template:

```sql
-- 20260714200000_add_submission_notified_at.sql
-- Applied PRE-DEPLOY (rollout step 1) — the notify route depends on it.
```

```sql
-- 20260714210000_purge_test_scores.sql
-- APPLY POST-DEPLOY ONLY (rollout step 3): a pre-deploy live session still
-- runs the old bundle whose childToRow round-trips test_scores on autosave
-- and would resurrect the purged values. Deploys do NOT reload open tabs —
-- re-run this UPDATE and the verification 24–48h after deploy:
--   select count(*) from public.children where test_scores <> '';  -- expect 0
```

Note the asymmetry: the pre-deploy header states *when* and *why*; the post-deploy header additionally states *why the naive ordering fails* and *the exact re-verification command* — because the post-deploy step is the one that silently reverts if mishandled.

**3. "Deploy code, then run the data step" is not sufficient — schedule a re-run.** A tab opened before the deploy keeps running the old bundle indefinitely; deploys do not reach into open tabs. If that old bundle's autosave round-trips the purged column, it can resurrect data hours or days after a purge that "verified clean." Re-run the purge + verification 24–48h after deploy, once realistic tab lifetimes have cycled.

**4. Irreversible follow-ups gate on the SECOND clean count, not the first.** A column drop or NOT NULL tightening that assumes the purge is final must wait for the re-run's verification — the first count proves "clean at that instant," not "clean and staying clean."

**5. Write purges to be fresh-environment safe.** `WHERE col <> <default>` makes the statement a no-op on empty data, so recording the post-deploy migration in `schema_migrations` carries no risk when a new environment applies the whole history at once.

## Why This Matters

The prevented failure, concretely: ship the single-file version and apply it at rollout step 1 (the natural reading). The `ALTER TABLE` lands correctly — but the purge also runs, **before** the new client is live. Any parent with the dashboard open has the old bundle whose next autosave re-writes the value the purge just cleared. The migration is recorded as applied, so nothing ever runs it again at the right time: the data resurrects permanently and invisibly while the team believes the field is retired.

Even with the split done right, "deploy → purge → verify 0" isn't closed: a tab opened pre-deploy and left open through both steps can autosave a resurrecting write *after* the verification query returned 0. That's why the re-run is part of the guidance, not an optional nicety. (In practice: purge #1 ran clean the same day; the re-run is tracked in `artifacts/roadmap.md` §S11 with the column-drop gate.)

**Enforcement caveat:** the phase ordering lives only in file comments. This repo currently applies migrations manually via the Management API (the DB password is rotated away), which forces a human/agent to read each header. If `supabase db push` ever works again, it would apply all pending migrations in timestamp order in one shot, defeating the post-deploy-only constraint — any future fix to the password situation should re-check this interaction.

## When to Apply

- One release's migration set contains both a schema/DDL change new code depends on AND a data mutation that's only safe once that code is live.
- The change touches a column a currently-deployed client actively **writes** on a recurring basis (autosave, polling, background sync) — not just reads.
- A follow-up under consideration would make an earlier data operation irreversible.

## Examples

The two migration files from this release are the canonical example (headers quoted in Guidance §2):

- `supabase/migrations/20260714200000_add_submission_notified_at.sql` — pre-deploy: column + coerce-guard trigger.
- `supabase/migrations/20260714210000_purge_test_scores.sql` — post-deploy: purge, re-run instruction, exact verification SELECT.

Operational runbook: `artifacts/roadmap.md` §S11 — purge #1 done 2026-07-14; re-run due on/after 2026-07-16; column drop gated on the second clean count.

## Related

- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — the HOW (Management API playbook) both files were applied through; also the source of the enforcement caveat above.
- `docs/solutions/database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md` — sibling in the "old client bundle keeps writing stale data" family (trigger semantics angle).
- `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md` — the pattern-family originator ("deploy code, then flip config"); this doc extends it: deploy-then-flip is necessary but not sufficient when already-open tabs keep writing.
- `docs/plans/2026-07-14-002-feat-dossier-intake-approval-gate-plan.md` — Unit 9a and the Operational Notes rollout steps.
