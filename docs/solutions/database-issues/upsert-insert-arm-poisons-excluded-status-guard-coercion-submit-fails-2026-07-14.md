---
title: "PostgREST upsert's INSERT arm poisons EXCLUDED through a coercing BEFORE INSERT guard — submit lands as 'draft' even on existing rows"
date: 2026-07-14
category: database-issues
module: dashboard-children-persistence
problem_type: database_issue
component: database
symptoms:
  - "Parent presses Submit for review on a 100%-complete dossier and always gets 'The submission didn't go through — your dossier is safe; press Submit to retry'; every retry fails identically (Clay Kliman bug)"
  - "children row stays status='draft', submitted_at=null after submit; updated_at advances (the rest of the row saved fine)"
  - "No error in the network response — the upsert succeeds, the status echo just comes back 'draft'"
root_cause: logic_error
resolution_type: code_fix
severity: high
last_updated: 2026-07-15
related_components:
  - app/dashboard/store.tsx (enqueueWrite submit branch, childToRow/submitStatusPatch)
  - supabase/migrations/20260714160000_children_guard_hardening.sql (children_status_guard INSERT branch)
tags:
  - supabase
  - postgrest
  - upsert
  - on-conflict-do-update
  - excluded
  - before-insert-trigger
  - trigger-guard
  - coerce-dont-raise
  - status-echo
---

# PostgREST upsert's INSERT arm poisons EXCLUDED through a coercing BEFORE INSERT guard — submit lands as 'draft' even on existing rows

## Problem

The dossier wizard's "Submit for review" never succeeded for any parent after
migration `20260714160000_children_guard_hardening.sql` deployed. First live
report: Kevin Kliman submitting Clay Kliman's 100%-complete dossier
(`artifacts/Clay Kliman bug.png`). The submit's status echo verification
returned `'draft'` on every attempt, so the UI showed the retryable error
"The submission didn't go through" — and the retry failed the same way,
forever.

## Root Cause

The submit path wrote status via the same PostgREST **upsert** as ordinary
saves (`INSERT ... ON CONFLICT (id) DO UPDATE SET col = EXCLUDED.col`). Three
Postgres facts compose into the bug:

1. **BEFORE INSERT row triggers fire on the proposed row of an upsert even
   when the row already exists** (the conflict is only detected afterwards).
   A trigger's `UPDATE OF status` column list does not restrict its INSERT
   half — INSERTs always fire it.
2. The hardened `children_status_guard` INSERT branch coerces any
   non-`'draft'` status to `'draft'` (anti-tamper: a REST-crafted insert at
   `'submitted'` must not skip the wizard).
3. **`EXCLUDED` reflects the effects of BEFORE INSERT triggers** (documented
   Postgres behavior — "the effects of all per-row BEFORE INSERT triggers are
   reflected in excluded values").

So the submit upsert carrying `status='submitted'` was coerced to `'draft'`
in its insert arm, `EXCLUDED.status` became `'draft'`, and the DO UPDATE
wrote `'draft'` back onto the existing row. The BEFORE UPDATE branch then saw
`NEW.status = OLD.status = 'draft'` — nothing to object to. The client's echo
check (`store.tsx`) correctly caught the mismatch, but its comment's
assumption that "the retry is an UPDATE, which the guard permits" was wrong:
the retry was another upsert, poisoned identically.

Confirmed against production (2026-07-14) by replaying both write shapes as
`role=authenticated` inside a `DO` block ending in `RAISE` (auto-rollback,
zero prod mutation), via the Management API playbook:

- App's real upsert shape, row exists, `status='submitted'` → echoed
  **`draft`** (bug reproduced).
- Targeted `UPDATE ... SET status='submitted' WHERE id=...` → echoed
  **`submitted`** (guard's draft→submitted allowance works as designed).

## Solution

Client-side, `app/dashboard/store.tsx`: the submit is now **two writes,
deliberately not one upsert**:

1. Persist content with the ordinary **status-free upsert**
   (`childToRow` can no longer serialize status at all — the
   `includeStatus` serialization option was removed so this cannot be
   reintroduced).
2. Flip status with a **targeted UPDATE** (`submitStatusPatch`:
   `status`, `submitted_at`, `updated_at` only) — fires only the guard's
   UPDATE branch, which permits draft → submitted. The status echo
   verification is unchanged (staff-advance adoption, retryable mismatch);
   `maybeSingle()` lets a zero-row result fall through to the retryable
   error instead of throwing.

The DB guard is untouched: its INSERT-branch coercion is a correct
anti-tamper control for genuine inserts. The bug was the client pushing a
server-guarded column through a write shape whose insert arm launders the
coercion into `EXCLUDED`.

Shipped as PR #6 (fix `3dc806c`, this doc `947a27b`), with two regression
tests pinning the contract (`childToRow` NEVER emits status/submitted_at;
`submitStatusPatch` shape — `app/dashboard/__tests__/dossier-checklist.test.ts`)
and an adversarial-review hardening pass (`3ddc8a9`):

- `submitStatusPatch` now **hardcodes `status: 'submitted'`** — the flip's
  only legitimate value — so a stale or misused caller can't smuggle
  whatever local state a tab holds into the transition.
- The targeted UPDATE **recovers a lost response**: a two-request submit
  can commit while its response is lost, and reporting failure then would
  unlock the wizard against a row staff already see as submitted. On an
  errored response the client re-reads the row's status once and only
  reports failure on a draft/absent echo.

## Why This Works

The guard's contract is per-operation: INSERTs are always draft; UPDATEs may
go draft → submitted. An upsert is *both operations fused*, and the fused
write inherits the stricter (INSERT) treatment via `EXCLUDED`. Splitting the
submit into "content upsert (no status) + status UPDATE" makes each write
match exactly one guard branch, so the intended transition is expressible
again — with no loss of protection, since a crafted upsert at
`status='submitted'` still lands as draft.

## Prevention

1. **Never send a guarded/server-owned column through an upsert when a
   BEFORE INSERT trigger coerces it** — `EXCLUDED` inherits the coercion and
   silently rewrites existing rows. State transitions belong in targeted
   UPDATEs (or RPCs); upserts are for content.
2. **"Verify triggers with the application's real write shape" means the
   real *statement* shape, not just the real column set.** The prior
   incident's verification replayed a full-row **UPDATE** — the app writes
   full-row **upserts** (`INSERT ... ON CONFLICT DO UPDATE`), which take a
   different trigger path. The one-statement replay above would have caught
   this before deploy.
3. **A coercing guard plus an echo check turns silent failure into a
   retryable error — but only a correct write shape makes the retry
   meaningful.** The echo check did its job (parents saw an error instead of
   believing they'd applied); the retry advice was useless because the retry
   repeated the poisoned shape.
4. **Safe prod repro pattern:** wrap the replay in `DO $$ ... RAISE
   EXCEPTION 'RESULT %', v; $$` with `set_config('request.jwt.claims',
   json_build_object('role','authenticated','sub',<uuid>)::text, true)` — the
   raise both returns the observation in the error message and rolls back
   everything.

## Related Issues

- **Recurrence note (2026-07-15):** a report of this exact error message (Abe
  Goldlist) surfaced the day after this fix deployed. Evidence-chain triage proved
  the failures predated the fix deploy (old write shape in edge logs,
  2026-07-14 18:52 UTC — 67 minutes before the fix went live) and the retry on the
  fixed bundle had already succeeded; it was closed with ZERO code changes. Before
  re-fixing this bug, read
  `docs/solutions/workflow-issues/stale-rereport-of-fixed-bug-prove-code-version-db-state-deploy-timeline-edge-log-fingerprint-2026-07-15.md`.
- `docs/solutions/database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md`
  — the direct predecessor: its guard hardening (coerce-not-raise + INSERT
  coverage) introduced this bug, and its own Prevention lesson #4 (replay the
  real write shape) was under-applied (UPDATE replayed, upsert not).
- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`
  — the Management API channel used for the rolled-back production repro.
- `docs/solutions/best-practices/atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md`
  — sibling pattern doc that cites this incident for the same underlying
  rule: state transitions belong in targeted UPDATEs (or RPCs); upserts are
  for content.
- GitHub issues: none (repo has zero issues; checked 2026-07-14).
