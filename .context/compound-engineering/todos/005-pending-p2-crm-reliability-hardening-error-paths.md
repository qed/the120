---
status: pending
priority: p2
issue_id: "005"
tags: [crm, reliability]
dependencies: []
---

# Reliability hardening pass on CRM error paths

## Problem Statement

Three related error-handling gaps from the reliability review, bundled because they share one theme: failures are swallowed where they should be discriminated or surfaced.

1. **Library reads tolerate ALL errors as "pre-migration"** (`app/crm/lib/queries.ts:445` and siblings): the `res.error ? [] : ...` fallback treats RLS misconfig, network failure, or schema breakage the same as "table not migrated" — pipeline/co-pilot can show a concern as unaddressed when a send actually happened, with zero logging. Now that all three migrations are applied to production, the tolerance is obsolete anyway.
2. **logSend's post-insert bookkeeping unchecked** (`app/crm/lib/actions/library.ts:151`): after the critical `library_sends` insert succeeds, the send_count bump, last_touch_at, and audit insert can fail silently while the action returns `{ success: true }`.
3. **proxy.ts getSession() has no try/catch** (`proxy.ts:51`): a Supabase auth outage becomes an unhandled 500 for every /crm/* request instead of failing closed to /crm/login.

## Findings

- (1) Reviewer suggests narrowing to Postgres `42P01` / PostgREST schema-cache-miss codes — but since migrations are live in production, simply removing the tolerance and using the same strict handling as the families/parents reads is cleaner.
- (2) The "sent, but X failed — add a note manually" warning pattern already exists for the library_sends insert itself; extend it.
- (3) Fail closed: wrap in try/catch → redirect to /crm/login on error.

## Proposed Solutions

### Option 1: All three, small PRs

**Approach:** (1) remove/narrow the library-read tolerance; (2) check errors in logSend and surface the existing warning; (3) try/catch in proxy failing closed to login.

**Pros:** Each is <30 lines; independent.
**Cons:** (1) needs a decision on whether local dev without migrations should still render (it shouldn't — migrations are in the repo).
**Effort:** 2 hours total. **Risk:** Low.

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] A library-table query error is logged/thrown, not rendered as "no sends"
- [ ] logSend surfaces a warning when bookkeeping writes fail
- [ ] proxy redirects to /crm/login when getSession throws

## Work Log

### 2026-07-13 - Initial Discovery

**By:** Claude Code (ce:review autofix — reliability reviewer, P2 findings 0.62-0.68)
