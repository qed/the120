---
status: pending
priority: p2
issue_id: "004"
tags: [crm, maintainability]
dependencies: []
---

# Dashboard should reuse fetchPipeline() instead of re-deriving stage/next-move

## Problem Statement

`app/crm/(app)/page.tsx` (~lines 318-386) re-implements the pipeline assembly that `composeFamily()` in `app/crm/lib/queries.ts` already canonicalizes — its own row types, grouping loops, FamilyTruth construction, and deriveStage/deriveNextMove calls — to build `BriefingFamily`, whose fields are a strict subset of `PipelineFamily` from `fetchPipeline()`. A future change to stage derivation, next-move rules, or the Decision-4 name-authority rule must now be made in two places or Today's Briefing silently disagrees with the pipeline table. Flagged independently by maintainability (0.72) and kieran-typescript (0.66) reviewers; cross-boosted. The ~230-line assembly block also has zero test coverage.

## Findings

- `app/crm/(app)/dossiers/page.tsx` shows the correct pattern — it reuses `fetchDossierQueue()` from queries.ts.
- GTM-specific raw reads (gtm_weeks, gtm_weekly_targets, staff, audit rows) have no queries.ts equivalent and should stay page-local.
- `BriefingFamily` fields (id, name, stage, heat, lastTouchAt, createdAt, nextMove) all exist on `PipelineFamily`.

## Proposed Solutions

### Option 1: Map PipelineFamily → BriefingFamily

**Approach:** Call `fetchPipeline(now)` in the dashboard page and map to `BriefingFamily`; delete the local Dash*Row types, grouping maps, and derivation block; keep GTM raw reads as-is.

**Pros:** Single source of truth for derivation; ~200 lines deleted; briefing inherits queries.ts test coverage as it grows.
**Cons:** fetchPipeline fetches more columns than the briefing needs (fine at 2-user scale).
**Effort:** 1-2 hours. **Risk:** Low (pure refactor; verify briefing renders identically).

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Dashboard briefing built from fetchPipeline() output
- [ ] Dash*Row types and local derivation block removed
- [ ] npm test + build green; briefing visually unchanged

## Work Log

### 2026-07-13 - Initial Discovery

**By:** Claude Code (ce:review autofix — maintainability + kieran-typescript reviewers, boosted 0.82)
