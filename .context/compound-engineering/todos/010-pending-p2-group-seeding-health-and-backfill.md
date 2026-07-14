---
status: pending
priority: p2
issue_id: "010"
tags: [crm, database, triggers, observability]
dependencies: []
---

# Health stat + backfill for silently-failed group-assignment seeding

## Problem Statement

`children_seed_group_assignment` (supabase/migrations/20260714130000, hardened in 20260714160000) deliberately swallows exceptions (`raise warning`, never blocks the parent's write). If it ever fails, a submitted child with a chosen group has NO `child_reviews` row — the child is invisible in the CRM review queue and nobody is alerted. (Reliability + data-migrations reviewers, P2, converged.)

## Findings

- The same failure mode exists for `on_parent_created`, and there the repair is the SyncHealth stat + `scripts/backfill-families.ts`. This trigger has neither.
- Failure trace only exists in Postgres logs (`children_seed_group_assignment failed for child %`).

## Proposed Solutions

### Option 1: Mirror the SyncHealth pattern

**Approach:** Add a CRM dashboard stat counting non-draft children with `group_slug != ''` lacking a `child_reviews` row; add a backfill script (or extend backfill-families.ts) that inserts the missing rows via service role.

**Pros:** Established pattern; makes the swallow-don't-block design safe.
**Cons:** None meaningful.
**Effort:** 2 hours. **Risk:** Low.

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] CRM surfaces a count of submitted-with-group children missing review rows
- [ ] A backfill script repairs them idempotently

## Work Log

### 2026-07-14 - Initial Discovery

**By:** Claude Code (ce:review autofix — reliability + data-migrations reviewers)
