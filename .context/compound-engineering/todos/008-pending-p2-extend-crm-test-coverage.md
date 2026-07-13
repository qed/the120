---
status: pending
priority: p2
issue_id: "008"
tags: [crm, testing]
dependencies: []
---

# Extend CRM test coverage: queries.ts pure logic, resolveWeek, resolveMerge email backfill

## Problem Statement

The pure-function testing strategy (293 tests) left behind adjacent pure logic that is just as testable (testing reviewer, P2/P3):

1. **composeFamily / stageDetail / kidsSummary** (`app/crm/lib/queries.ts:261`): stageDetail is a 9-case switch rendered on every pipeline row; composeFamily implements the Decision-4 identity-authority rule. Sibling `buildTimeline` in the same file was extracted and tested; these were not. (0.78)
2. **resolveWeek** (`app/crm/(app)/page.tsx:115`): the ?week= clamp — an explicit plan test scenario ("Edge: selector clamped outside Jul 13–Sep 4") — is inline and untested; `weekBounds()` throws RangeError outside 1-8, so a clamp regression crashes the dashboard on a bookmarked URL. (0.72)
3. **resolveMerge plain email-backfill** (`app/crm/lib/families-rules.ts:333`): the no-parent-transfer + survivor-email-blank combination reaching `nullLoserEmail=true` via the other ternary branch is unexercised — relevant to the live-email unique index. (0.65)

## Findings

- All three are export-and-test refactors (no behavior change): export the queries.ts helpers into a testable surface; move resolveWeek into week.ts or gtm.ts.
- Related residuals recorded in the review artifact: no jsdom harness for KanbanBoard optimistic logic; no network-layer proxy test; no RLS/pgTAP harness for the DB triggers (plan Unit 2 called for scripted integration checks).

## Proposed Solutions

### Option 1: Three targeted additions

**Approach:** (1) export kidsSummary/stageDetail/composeFamily + `queries-rules.test.ts` covering each stageDetail branch and parent-vs-lead identity; (2) move resolveWeek to week.ts + tests (NaN, fractional, clamp 1/8); (3) one resolveMerge test asserting email backfill sets nullLoserEmail and nulls loser email.

**Effort:** 2-3 hours. **Risk:** None (additive).

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Every stageDetail branch asserted; composeFamily identity rule covered parent-linked vs lead
- [ ] resolveWeek exported and tested; dashboard uses the shared export
- [ ] resolveMerge email-backfill test added; suite green

## Work Log

### 2026-07-13 - Initial Discovery

**By:** Claude Code (ce:review autofix — testing reviewer)
