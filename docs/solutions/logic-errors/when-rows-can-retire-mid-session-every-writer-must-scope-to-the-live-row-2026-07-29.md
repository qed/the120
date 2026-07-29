---
title: When rows can retire mid-session, every writer must scope to the live row
date: 2026-07-29
category: logic-errors
module: funnel-compose
problem_type: logic_error
symptoms:
  - A stale tab's regenerate succeeds against a project another tab just retired, burning a scarce regen attempt and a model call on a row nobody will see
  - Draft/edit saves report success into an abandoned row while the child's real active project is a different row
root_cause: scope_issue
resolution_type: code_fix
severity: high
related_components:
  - database
tags: [stale-tab, row-retirement, status-scoping, cas, conflict, compose, abandoned]
---

# When rows can retire mid-session, every writer must scope to the live row

## Problem

Unit 8's door-change RPC made project retirement (`status: 'active' → 'abandoned'`) a routine family action rather than a rare cron event. The existing writers — `reserveRegeneration`, `saveDraft`, `saveEdit` in `app/lib/funnel/compose-core.ts` — filtered only by row id, so a tab holding a retired project kept writing into it successfully.

## Symptoms

- Tab B changes the door (retires project X atomically). Tab A, still rendering X, taps "Try another version": the regen CAS matches (`ai_regeneration_count` unmoved — only `status` changed), the attempt is reserved, the model is called, and the output is saved into the abandoned row. Tab A reports success; the product discarded everything.
- The same shape for plain draft/edit saves: success into a row that is no longer the child's project.

## What Didn't Work

- Assuming the CAS token covers all invalidation. The CAS guards against *concurrent counter movement*; retirement moves a **different column**. A CAS on one column is blind to identity changes expressed in another.

## Solution

Scope every UPDATE to the liveness predicate, not just the identity:

```ts
.update(...).eq("id", projectId).eq("status", "active").select("id")
```

Zero rows now means "this row retired under you" and maps to a `conflict` result rendered as refresh guidance — never silent success, never the generic retry notice. The client's conflict branch also calls `router.refresh()` with a CAS-keyed re-seed so the tab converges on the real active row without destroying unsaved drafts on ordinary navigations.

## Why This Works

Row identity (`id`) and row liveness (`status`) are independent facts. A writer that checks only identity keeps a dead row writable forever. Adding the liveness predicate makes each single-statement write atomic over *both* facts — the same property the door-change RPC gets from its transaction.

## Prevention

- The moment a design adds a way for a row to be superseded/retired mid-session (soft delete, archival, supersession), sweep **every existing writer** of that table and add the liveness predicate. The feature that adds retirement is responsible for the sweep — the old writers were correct until it shipped.
- Zero-rows-affected on a row the client believes exists is a *conflict*, not a failure: distinct result kind, refresh guidance, no success path.
- Test each writer against a retired row explicitly (refused, no side effects, no scarce resources consumed).

## Related Issues

- `docs/solutions/database-issues/a-cross-table-trigger-guard-must-lock-the-row-it-reads-for-share-2026-07-29.md` — the same unit's locking half (trigger-defined lock order, FOR SHARE).
- `docs/solutions/security-issues/an-acceptance-record-must-bind-to-what-the-client-rendered-echo-the-version-and-refuse-stale-2026-07-28.md` — the snapshot-echo rule the door-change dialog follows; this doc covers the writers that *don't* go through a dialog.
