---
title: "FP public site — operations note (gate env, operator lock, takedown, reconciliation, migration deploy order)"
type: runbook
status: ready-to-run (human/gated)
date: 2026-08-03
plan: first-profit docs/plans/2026-08-03-002-feat-real-public-site-plan.md (Unit 7)
---

# FP public site — operations

The short operator reference for the First Profit public-site surface
(`firstprofit.school/<handle>`). The full ordered LAUNCH checklist lives in the
first-profit repo: `docs/plans/2026-08-03-003-launch-checklist.md` — this note
is the the120-side detail it points into.

## 1. Feature-gate env vars (claim / availability / publish)

Checked by `siteGateVerdict` (`app/api/fp/site/site-rules.ts`), mirroring the
signup launch gate. Applies to the three gated child endpoints; the child
self-read is deliberately ungated (it answers `none` while dark). A gate
refusal is the same generic 401 as every other refusal (no oracle).

- **`FP_SITE_TEST_ONLY`** — FAIL-CLOSED master switch. **Unset (or any value
  other than `off`/`false`/`0`) = allowlist-only**: a fresh deploy can never
  open the surface by omission. Set exactly `off` (or `false`/`0`) to open the
  surface for ALL FP children — the final go-live step, paired with
  first-profit's `VITE_ENABLE_PUBLIC_SITE=true`.
- **`FP_SITE_TEST_ALLOWLIST`** — comma-separated `children.fp_username` values
  (trimmed, lowercased, exact match). While `FP_SITE_TEST_ONLY` is on (the
  default), ONLY these accounts pass the gate — this is the production test
  window mechanism (e.g. the Cedric test family) with everything else still
  dark. Ignored once `FP_SITE_TEST_ONLY=off`.

So: endpoints deployed with BOTH unset are live-but-closed (safe default);
allowlist set + test-only on = scoped production test; test-only off = open.

## 2. Operator lock / unlock (abuse takedown)

`operator_locked` always wins over `published`; a parent republish can never
clear it. Two equivalent drivers over the same core
(`app/fp/lib/fp-site-ops-core.ts`), both writing the `fp-site-lock`
`crm_audit_log` row (action allowlisted by migration `20260908120000`):

```
ACTOR=<staff auth user id> npm run fp:site-lock -- lock <handle>
ACTOR=<staff auth user id> npm run fp:site-lock -- unlock <handle>
```

`ACTOR` is REQUIRED (audit trail must name a real staff principal; no
default). Exit 2 = the lock applied but the audit write failed — reconcile the
audit row manually before moving on. The CRM staff action
(`app/crm/lib/actions/fp-site.ts`) is the UI equivalent.

## 3. Parent takedown surface

Parents unpublish/republish from **`/fp/family`** (FamilySites section) —
one-action takedown, session-authenticated with the120's existing CSRF
discipline. Unpublish flips `published=false` (page shows the offline state on
the next fetch; the serving cache can lag up to ~60s per region — see the SWR
note in first-profit `api/site.ts`). Parent republish is a **flag flip only**
(`setSitePublishedForParent`, `app/fp/lib/fp-site-parent-core.ts`): it does
NOT resync content and sends NO email — the parent is the actor, so there is
nothing to notify them of. Content resync + the R21 re-notification belong to
the CHILD's publish endpoint (its hidden→visible transition re-syncs
headline/one-liner/first_name and re-sends the parent email). Neither surface
touches `operator_locked`.

## 4. Publish crash-window reconciliation (lost parent email)

Accepted crash window (documented in the 20260907 migration's OPS NOTE and
`site-core.ts publishSite`): a process kill between the publish CAS and the
parent notification loses the R21 email with NO operator-attention flag. When
suspected (deploy/crash during a publish window), run:

```sql
select s.handle, s.first_published_at
  from public.fp_public_sites s
 where s.first_published_at > now() - interval '<window>';
```

Cross-check those handles/times against the Resend send log; any row with no
matching "page is now live" send needs a manual parent note.

## 5. Migration deploy order (20260907 + 20260908)

Both are AUTHORED, NOT YET APPLIED (branch-only). Apply via the Management API
playbook (`docs/solutions/integration-issues/supabase-cli-stale-db-password-
management-api-workaround-2026-07-13.md`); never write `schema_migrations` by
hand.

1. **Confirm the live ledger top** immediately before applying. The files
   assume the top is `20260906120000_fp_save_doc_guard`; if it is not, RENAME
   each file to the true next-free 12:00:00 slot first (ritual in each
   header).
2. Apply **`20260907120000_fp_public_sites.sql`** (registry + trigger + anon
   RPC).
3. `NOTIFY pgrst, 'reload schema';`
4. Run the migration header's **POST-APPLY VERIFICATION** (7 steps: three-state
   probe rows, anon-key RPC per state incl. the zero-rows/unknown byte-identity
   check, `has_function_privilege` + `proconfig` catalog checks, trigger
   presence/timing, direct-table anon refusal, projection probe under a real
   child JWT, teardown sites-first). The apply is NOT complete until this
   passes.
5. Apply **`20260908120000_fp_public_sites_ops.sql`** (service-role EXECUTE
   grant + `fp-site-lock` audit action). Caution: it re-adds the
   `crm_audit_log_action_check` CHECK, which takes a validation lock/scan on
   `crm_audit_log` — on a large audit table run it at a quiet moment.
6. Only after both are verified: deploy the Unit 2 endpoints (gated OFF — see
   §1) and the first-profit serving function.

Rollback: the trigger and functions are droppable independently (saves
unaffected; pages 404 and the serving function renders "temporarily
unavailable"); the table is never dropped once a real claim exists — the
functional rollback is the feature gates (§1 + `VITE_ENABLE_PUBLIC_SITE`).
