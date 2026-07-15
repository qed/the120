---
title: "Stale re-report of an already-fixed bug: prove which code version produced the error before touching code — DB state first, deploy vs report timeline, edge-log write-shape fingerprinting"
date: 2026-07-15
category: workflow-issues
module: production-incident-triage
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "A user re-reports an error whose exact message matches a bug already fixed and deployed"
  - "The failure could predate the fix and be relayed late (stale tab/bundle, screenshot forwarded hours later, second-hand report)"
  - "Authoritative DB state is directly queryable (Supabase Management API playbook) to check whether the operation actually failed"
  - "API edge logs can fingerprint which client bundle issued a request (old vs new write shapes, user-agent, timestamps)"
  - "You are about to write a code fix based solely on reported error text, with no fresh reproduction"
symptoms:
  - "Exact error string of a bug fixed and deployed the previous day is reported as happening 'now'"
  - "Live DB row shows the operation already succeeded (status='submitted', submitted_at minutes before the report arrived)"
  - "Edge logs show failing requests used the OLD write shape and predate the fix deploy; a later retry used the NEW shape and returned 200"
  - "Server-side side-effect requests (/api/notify-submission, node UA) fired ~250ms after the retry — proof the client itself saw success"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
last_updated: 2026-07-15
related_components:
  - app/dashboard/store.tsx (submit write shapes - old single upsert with status vs new insert + status PATCH - the fingerprint)
  - app/api/notify-submission (client fires only on confirmed success - side-effect as proof)
tags:
  - incident-triage
  - stale-bug-report
  - verify-before-fixing
  - deploy-timeline
  - edge-logs
  - write-shape-fingerprinting
  - supabase-management-api
  - side-effect-as-proof
---

# Stale re-report of an already-fixed bug: prove which code version produced the error before touching code

## Context

On 2026-07-15 the founder relayed a parent-reported error from the dossier wizard —
"The submission didn't go through — your dossier is safe; press Submit to retry"
(child: Abe Goldlist) — with instructions to "fix, commit, push and deploy." That
error string is the exact UI signature of the Clay Kliman bug, which had already
been fixed in PR #6 and deployed to production on 2026-07-14 19:59 UTC
(`docs/solutions/database-issues/upsert-insert-arm-poisons-excluded-status-guard-coercion-submit-fails-2026-07-14.md`).

The tempting move was to reopen the code and "fix" something. Instead, a four-step
evidence chain proved the report was **stale**: the failures the parent saw happened
on the pre-fix bundle the evening before, and their submission had already
**succeeded** on the fixed bundle roughly 8 minutes before the report reached the
agent. Zero code changes were made; the "fix and deploy" request was answered with
evidence that nothing was broken.

## Guidance

When a bug report matches an already-fixed issue — or any time the symptom is "my
write didn't go through" — triage in this order before touching code:

**1. Check the authoritative datastore first.** The write may have landed. Query the
row directly (via the Management API playbook —
`docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`):

```sql
select id, parent_id, status, submitted_at, updated_at
from children where first_name ilike '%abe%';
```

If the row is already `status='submitted'`, the incident changes shape entirely: you
are no longer debugging a failure, you are **dating a report**. While you're there,
rule out live server-side causes (`pg_policy` RLS expressions and `pg_trigger`
definitions on the table, plus downstream side-effects like `child_reviews` seeding
and `submission_notified_at`).

**2. Anchor three timestamps: report time, page-load/session time, deploy time.**
Confirm the fix is actually live:

```
git merge-base --is-ancestor <fix-sha> main   # exit 0 = fix is in main
```

plus Vercel `list_deployments` to confirm production runs main. Then place the
reporter inside or outside the pre-fix window (here: parent account created
18:47 UTC, fix deployed 19:59 UTC — squarely pre-fix).

**3. Fingerprint the bundle version from request shapes in edge logs.** Different
bundle versions make differently-shaped API calls; those shapes identify which code
a session was actually running, with no client-side version header needed. Query
Supabase edge logs via `GET /v1/projects/<ref>/analytics/endpoints/logs.all` with a
`sql=` param — **pitfall: `iso_timestamp_start`/`iso_timestamp_end` query params are
required; omitting them silently returns an empty result set** (this cost two dead
queries before the window was made explicit). In this incident:

- Old buggy bundle submit: `POST /rest/v1/children?select=status` (status inside a single upsert)
- Fixed bundle submit: `POST /rest/v1/children` (content upsert) followed by
  `PATCH /rest/v1/children?id=eq.<id>&select=status` (targeted status flip)

The parent's iPhone (distinct user-agent) showed the OLD shape failing twice at
2026-07-14 18:52–18:53 UTC and the NEW shape succeeding at 2026-07-15 13:06 UTC
after a fresh page load.

**4. Use client-triggered server side-effects as proof of what the client believed.**
~250 ms after the 13:06 PATCH returned 200, node-user-agent requests appeared from
`/api/notify-submission`. In `app/dashboard/DossierEditor.tsx` (`doSubmit`), that
route fires only after the client receives `{ok: true}` — so the client UI
demonstrably showed success. The error banner existed only in the stale session the
report described.

## Why This Matters

- **An error report is data about SOME point in time, not necessarily about current
  code.** SPA tabs can outlive deploys by days; a report relayed second-hand can
  describe a bundle that no longer exists in production. "Fixing" a stale report
  risks unnecessary churn on already-correct code (here, the deliberately-subtle
  two-write submit path in `app/dashboard/store.tsx`, `enqueueWrite`).
- **Checking the datastore first inverts the cost curve.** One SQL query can end an
  investigation that code-reading would stretch into hours — especially when the
  symptom is a write that supposedly failed.
- **Request-shape fingerprints are version identifiers you get for free.** When a
  fix changes the shape of an API call, the logs can tell you exactly which bundle
  every session ran.
- **Side-effect routes are durable receipts of client-perceived outcomes.** A
  fire-and-forget notify call is proof the success branch executed on the client,
  even when you can't see the client.
- **Verbatim UI strings in solution docs are index keys.** The prior doc contained
  the exact error banner text, which made recognizing this as the Clay Kliman
  signature instantaneous. Always record exact user-facing strings in solution docs.

## When to Apply

- A bug report's symptom matches an issue already documented in `docs/solutions/`
  as fixed and deployed — especially reports relayed second-hand
  (founder ← parent ← UI banner) with unknown lag.
- The symptom is "the write/submission/save didn't go through" — check whether it
  actually landed before reading any code.
- The reporting user may be running a long-lived SPA session that predates the fix
  deploy (see the stale-bundle mechanism in
  `docs/solutions/workflow-issues/split-phase-migrations-pre-deploy-schema-post-deploy-purge-separate-files-rerun-2026-07-14.md`).
- Any incident where you must establish which code version a specific user session
  executed (request-shape fingerprinting in edge/API logs).
- Any request to "fix and deploy" where the first question should be: is anything
  currently broken?

## Examples

The complete evidence chain from the 2026-07-15 incident:

| # | Evidence | Source | Finding |
|---|----------|--------|---------|
| 1 | `children` row for Abe: `status='submitted'`, `submitted_at=2026-07-15 13:06:00 UTC` | Management API SQL query | Submission succeeded ~8 min before the report reached the agent; RLS, triggers, `child_reviews` seed, and `submission_notified_at` (13:06:02) all consistent with success |
| 2 | `git merge-base --is-ancestor 3dc806c main` → true; production = main (`12ee848`); fix deployed 2026-07-14 19:59 UTC; parent account created 18:47 UTC | git + Vercel `list_deployments` | Reporter's first session began inside the 72-minute pre-fix window |
| 3 | iPhone UA: old shape (`POST ...?select=status`) failing twice 2026-07-14 18:52–18:53 UTC; new shape (`POST` then `PATCH ...&select=status`) succeeding 2026-07-15 13:06 UTC | Supabase edge logs (`logs.all`, with required `iso_timestamp_start/end`) | The reported errors were pre-fix bundle failures; a fresh page load the next day ran the fixed bundle and succeeded |
| 4 | `/api/notify-submission` server-side requests ~250 ms after the PATCH 200 | Edge logs + `doSubmit()` in `app/dashboard/DossierEditor.tsx` | Route fires only on client-received `{ok: true}` — the client UI showed success |

Outcome: zero code changes. The "fix, commit, push and deploy" request was closed
with a timeline proving the report described the already-fixed 2026-07-14 bug.

## Related

- `docs/solutions/database-issues/upsert-insert-arm-poisons-excluded-status-guard-coercion-submit-fails-2026-07-14.md`
  — the underlying bug (PR #6) this report echoed; its verbatim error string was the
  index key that made triage fast.
- `docs/solutions/database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md`
  — lineage for the write-shape distinction (full-row upsert vs targeted UPDATE)
  used here as a version fingerprint.
- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`
  — the Management API playbook (auth + `database/query`); this doc adds the
  `analytics/endpoints/logs.all` endpoint and its silent-empty-without-timestamps gotcha.
- `docs/solutions/workflow-issues/split-phase-migrations-pre-deploy-schema-post-deploy-purge-separate-files-rerun-2026-07-14.md`
  — the stale-client-bundle mechanism that makes late re-reports possible.
- `docs/solutions/best-practices/atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md`
  — the notify-submission stamp pattern whose side-effect served as forensic
  evidence here.
- GitHub issues: none (repo has zero issues; checked 2026-07-15).
