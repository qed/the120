---
status: pending
priority: p2
issue_id: "006"
tags: [crm, frontend, race-condition]
dependencies: []
---

# Kanban optimistic-move cleanup races a rapid re-drag of the same card

## Problem Statement

`handleDrop` in `app/crm/components/pipeline/KanbanBoard.tsx:184` keys the optimistic-stage map by family id, but its success/failure cleanup unconditionally deletes that id's entry without checking whether a NEWER drop for the same card set it after this request started. Dragging a card to CALL BOOKED then immediately correcting to CALL HELD fires two concurrent `stampCall` requests; whichever resolves first wipes the optimistic pin, snapping the card back to the stale server-rendered stage until `router.refresh()` re-syncs. (Adversarial reviewer, P2, 0.62.)

## Findings

- Both the failure path (snap back) and success path delete `optimistic.get(id)` blind to generation.
- Visual-only inconsistency — server state is correct; the board can briefly render a stage matching neither pre- nor post-drag state.

## Proposed Solutions

### Option 1: Per-family generation token

**Approach:** Store `{ stage, token }` in the optimistic map; capture the token at drop time; in resolve handlers, only delete/revert if the stored token still matches.

**Pros:** Standard last-write-wins guard; ~15 lines.
**Cons:** None meaningful.
**Effort:** 1 hour. **Risk:** Low. Note: no jsdom test harness exists in the repo, so verification is manual (or extract the token logic into kanban-rules.ts and unit-test it).

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Rapid re-drag of the same card never snaps back to the pre-drag column
- [ ] Older request's resolution cannot clear a newer request's optimistic pin

## Work Log

### 2026-07-13 - Initial Discovery

**By:** Claude Code (ce:review autofix — adversarial reviewer)
