---
status: pending
priority: p2
issue_id: "011"
tags: [dashboard, reliability, testing]
dependencies: []
---

# saveChildNow has no timeout; its branches are untested

## Problem Statement

`saveChildNow` in app/dashboard/store.tsx awaits a Supabase upsert with no timeout. On a hung connection the wizard's Next/Submit buttons stay in "Saving…" forever with no recovery path (Reliability reviewer, P2). Its branch logic (tombstoned child, error mapping via `friendlySaveError`, includeStatus payload shaping, write-chain ordering) is exercised only indirectly; the store functions aren't unit-testable in the node-only vitest setup without extraction.

## Proposed Solutions

### Option 1: AbortController timeout + pure-function extraction

**Approach:** Wrap the upsert with `AbortSignal.timeout(10_000)` (supabase-js accepts abortSignal) and map the abort to a retryable "Still saving — check your connection" error. Extract payload shaping + error mapping into `app/dashboard/save-rules.ts` and unit-test the branches (the repo's established pure-function extraction strategy).

**Effort:** 2 hours. **Risk:** Low.

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] A hung save surfaces a retryable error within ~10s instead of hanging
- [ ] Payload shaping (includeStatus on/off) and error mapping have direct unit tests

## Work Log

### 2026-07-14 - Initial Discovery

**By:** Claude Code (ce:review autofix — reliability reviewer)
