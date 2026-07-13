---
status: pending
priority: p2
issue_id: "007"
tags: [crm, scripts, data-integrity]
dependencies: []
---

# Harden backfill-families.ts as a repair tool: race guard + tombstone chain-walk

## Problem Statement

Two gaps in `scripts/backfill-families.ts` matter once it's re-run against a live production DB (its documented role as "the sync-repair tool"):

1. **Race with the live trigger** (adversarial, P1, 0.65): the script snapshots all tables once, then writes link decisions from that stale snapshot. If `on_parent_created` links the same lead between snapshot and write, the script's `.update(...).eq("id", lead.id)` (line ~237) blindly overwrites `parent_id`, identity fields, and `consent_given` — orphaning the account the trigger just linked. No `.is('parent_id', null)` guard, no re-read.
2. **No merged_into_id chain-walk** (data-migrations, P2, 0.60): the trigger resolves email matches through up to 20 hops of `merged_into_id` to find the live survivor and creates cross-referencing conflict notes; the script's lead/conflict lookups filter `!f.merged_into_id` only, so a parent whose email matches a merge-loser falls through to "insert new family" — diverging from the documented "mirrors the trigger" invariant.

## Findings

- Run against production 2026-07-13 with 0 parents (table empty pre-launch) — both gaps are currently latent.
- Fix (1) is one line: add `.is("parent_id", null)` to the link UPDATE and treat 0 rows affected as a race → re-resolve.
- Fix (2): extract or replicate the trigger's chain-walk in the script's lookup (or a shared SQL helper).

## Proposed Solutions

### Option 1: Guard + chain-walk in the script

**Approach:** Add the optimistic-concurrency guard to the link UPDATE; add merged_into_id chain resolution to the lead/conflict lookups mirroring the trigger's tombstone branch (including conflict notes).

**Pros:** Script becomes safe to run against live traffic.
**Cons:** Chain-walk duplicates trigger logic in TS (document the pairing).
**Effort:** 2-3 hours. **Risk:** Low-medium.

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Link UPDATE cannot overwrite a concurrently-linked family (0-rows → re-resolve)
- [ ] Email matching a tombstoned family resolves to its live survivor, matching trigger behavior
- [ ] Test fixture with merged/tombstoned rows exercises the repair path

## Work Log

### 2026-07-13 - Initial Discovery

**By:** Claude Code (ce:review autofix — adversarial + data-migrations reviewers)
