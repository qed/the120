---
status: pending
priority: p1
issue_id: "001"
tags: [crm, reliability, data-integrity]
dependencies: []
---

# Harden mergeFamilies: check reassignment errors, then wrap in an atomic RPC

## Problem Statement

`mergeFamilies` in `app/crm/lib/actions/families.ts` performs 5+ sequential cross-table writes with two independent defects: (1) the three reassignment updates (`family_notes`, `family_stage_history`, `library_sends` → survivor) never check `{ error }`, so a failed move silently orphans data under the tombstoned loser — invisible to every live query and to staff; (2) the whole sequence has no transaction, so a crash between the loser tombstone and the survivor update leaves a half-merged pair requiring manual repair. Three reviewers (reliability P1 0.85, correctness P2 0.70, adversarial P2 0.70) independently flagged (1); reliability, data-migrations, and agent-native flagged (2).

## Findings

- `app/crm/lib/actions/families.ts:790` — three `.update(...).eq("family_id", loser.id)` calls awaited with no `{ error }` destructure; the subsequent loser/survivor updates ARE checked (`loserError`/`survivorError`), so the fix pattern already exists two blocks down.
- A failed reassignment orphans rows under `family_id = loser.id`, which every live query filters out via `.is("merged_into_id", null)` — notes/history/CASL send paper trail vanish with `{ success: true }` returned.
- The code's own error message ("the duplicate was tombstoned; review both records") acknowledges the non-atomic failure mode.
- `move_candidate()` in `supabase/migrations/20260713110000_crm_core.sql` is the in-repo template for an atomic SECURITY DEFINER RPC (service_role-only, self-auditing).
- Mitigating context: mergeFamilies has no UI caller on this branch yet, and merges are rare/staff-triggered.

## Proposed Solutions

### Option 1: Error checks only (quick)

**Approach:** Destructure `{ error }` on each of the three reassignment updates; on any failure return `{ success: false, error }` BEFORE tombstoning the loser.

**Pros:** ~10 lines, no migration, closes the silent-orphan hole.
**Cons:** Still non-atomic (crash mid-sequence still possible).
**Effort:** 30 minutes. **Risk:** Low.

### Option 2: merge_families() RPC (complete)

**Approach:** New migration adding a SECURITY DEFINER `merge_families(p_survivor, p_loser, ...)` function mirroring `move_candidate()` — reassign, tombstone, update survivor, insert history + audit in one transaction; revoke from anon/authenticated, grant to service_role; call via `db.rpc()`.

**Pros:** All-or-nothing; becomes a safe agent-callable primitive.
**Cons:** Requires a production migration; port of resolveMerge field-pick logic into SQL or pass the resolved patch as jsonb.
**Effort:** 2-3 hours. **Risk:** Medium (new SQL surface).

## Recommended Action

**To be filled during triage.** (Suggested: do Option 1 immediately; schedule Option 2 before merge gets a UI caller.)

## Acceptance Criteria

- [ ] All three reassignment updates abort the merge on error, before the loser is tombstoned
- [ ] Test simulating a failed reassignment asserts `{ success: false }` and no tombstone written
- [ ] (Option 2) merge is a single transaction; partial-failure state unreachable

## Work Log

### 2026-07-13 - Initial Discovery

**By:** Claude Code (ce:review autofix — reliability + correctness + adversarial reviewers, cross-reviewer boosted to 0.95)

**Actions:** Findings merged from three independent reviewers; routed manual (behavior change — abort semantics) so not auto-applied.
