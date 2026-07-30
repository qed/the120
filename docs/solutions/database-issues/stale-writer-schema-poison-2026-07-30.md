---
title: "Retiring a client-side write path does not retire old bundles — poison the stale writer with a post-deploy column rename"
module: funnel/dashboard
date: 2026-07-30
problem_type: database_issue
component: database
severity: high
symptoms:
  - "form-step saves appear to succeed but revert to an older snapshot moments later, with no error anywhere"
  - "updated_at advances on every revert, masking the row as fresh to CRM/cron readers"
  - "RLS cannot reject the stale writer — same family, same authenticated role as the legitimate client"
  - "exposure is tab-lifetime, not deploy-window: a pre-deploy tab left open is a live stale writer indefinitely"
root_cause: config_error
resolution_type: migration
related_components:
  - dashboard
  - cron
  - crm
tags:
  - deploy-skew
  - stale-bundle
  - postgrest
  - upsert
  - schema-poison
  - rls
  - supabase
---

# Retiring a client-side write path does not retire old bundles — poison the stale writer with a post-deploy column rename

## Problem

Unit 9 of the Phase B unified-application-flow plan retired the dashboard's
debounced full-row `children` upsert (`childToRow` in the pre-Phase-B
`app/dashboard/store.tsx`) in favor of per-column server-action saves. The
standard "flag + delete in one commit" deploy-atomicity reasoning only
governs **new** bundles fetched after the deploy. Any browser tab that
loaded its JS before the deploy keeps running the old
`enqueueWrite`/`childToRow` code for as long as it stays open — same
Supabase URL, same anon key, same authenticated session — so its writes are
indistinguishable from a legitimate client at every layer below the schema.

## Symptoms

No incident occurred — the adversarial reviewer (confidence 0.85) caught
this pre-merge. Had it shipped: a parent saves a field through the new
flow; a stale tab's debounced full-row upsert silently overwrites it with
the tab's in-memory snapshot; `updated_at` restamps so CRM's queue and the
nurture cron see a fresh-looking row with reverted content; nothing errors
anywhere. Exposure is **tab-lifetime**, not deploy-window.

## What Didn't Work

1. **Merge-flag / dark-ship reasoning** — protects only bundles fetched
   after the deploy; says nothing about bundles already in browser memory.
2. **RLS** — the stale writer is the same family on the same role; no
   request signal encodes bundle version.
3. **Trigger guards** — cover `status`/`applicant_state` only, not the
   content columns the full-row upsert clobbers.
4. **Trigger-level shape detection** — a `BEFORE UPDATE` trigger sees
   resulting *values*, never which columns the statement *named*; an
   unchanged-value column is invisible, so "you used the old write shape"
   is undetectable at the trigger layer.
5. **"Monitor for a day"** — assumes deploy-window exposure; here the
   window is however long a family leaves a tab open.

## Solution

Schema-level poison: rename a column so every historical writer's
serialization becomes a request for a column that no longer exists.

Requirements for a valid poison column (all satisfied by `workshop_ids`):
- serialized **unconditionally** by every historical writer version
  (`childToRow` always included it);
- named by **no current code** after the same deploy (named `select()`
  clauses dropped it; `select("*")` readers are absence-tolerant via
  `?? []`);
- data preserved under the new name.

`supabase/migrations/20260826120000_children_stale_writer_poison.sql`:

```sql
alter table public.children
  rename column workshop_ids to workshop_ids_legacy;
```

**Apply order is strictly post-deploy** (split-phase playbook): applying
before the deploy would kill the *then-current* bundle's writes instead of
only the stale one.

**Failure mode when poisoned:** PostgREST answers `PGRST204` (unknown
column) for the whole statement — the write dies atomically before
touching the row. No partial clobber.

Reader detach (same deploy), `app/api/cron/nurture/route.ts` (mirrored in
`app/crm/lib/queries.ts`):

```diff
   db.from("children").select(
-    "id,...,applicant_state,workshop_ids,interests,project_pitch,status,updated_at"
+    // workshop_ids deliberately UN-NAMED (stale-writer poison, 2026-07-30)
+    "id,...,applicant_state,interests,project_pitch,status,updated_at"
   ),
```

## Why This Works

A PostgREST upsert names every column it serializes; one unknown column
rejects the entire statement before any write. The schema is the one layer
a frozen, already-loaded bundle cannot carry a patched copy of: the tab's
code is fixed in memory, but the schema it talks to keeps moving. The
rename doesn't ask the stale writer to behave — it makes its request
nonsensical, unconditionally, until the tab reloads.

## Prevention

- When retiring any client-resident write path, enumerate what **old
  bundles still hold**, not just what the new code does. The question is
  never "is the new code correct" — it is "what does every version still
  running in someone's browser do."
- Prefer **server actions** over direct PostgREST writes for anything
  long-lived in a client bundle — actions get `deploymentId` skew
  protection; a raw `supabase.from(...).upsert(...)` does not.
- Apply the poison **at retirement time**, not after review catches it:
  one migration plus a couple of select detaches.
- A legacy always-serialized column is a natural **canary**; don't clean
  such columns up opportunistically without checking whether they serve
  this role.

## Verification reads under emulated auth (the same plan's Unit 3 false alarm)

While probing trigger behavior against production (rolled-back writes via
the Management API), the spike emulated the app by switching the SQL
session's **pg role** to `authenticated`, then read `child_reviews` (a
staff-only-RLS table populated by a SECURITY DEFINER trigger) to confirm
the write. The read came back 0 — an apparent trigger failure. It wasn't:
the trigger had written the row; the probe's own verification read was
RLS-blocked by the role switch.

The guards key on `auth.role()` — the JWT **claim**, not the pg role. So:

```sql
-- WRONG: swaps the pg role; verification SELECTs inherit RLS blindness
set local role authenticated;

-- RIGHT: the guard reads the claim; the postgres pg-role keeps
-- verification reads authoritative past any table's RLS
select set_config('request.jwt.claims',
  json_build_object('sub', '<parent-uuid>', 'role', 'authenticated')::text,
  true);
```

Rule: a probe that must (a) exercise `auth.role()`-gated guards on the
write side and (b) independently verify the resulting rows on the read
side emulates via `request.jwt.claims` only — never `SET ROLE`.

## Related Issues

- `docs/solutions/best-practices/deleting-a-use-server-export-is-a-deploy-skew-hazard-the-old-bundle-still-holds-its-action-id-2026-07-27.md`
  — the Server Action flavor of the same hazard; `deploymentId` covers
  navigations, this doc's poison covers direct writes (the residual gap
  that doc names).
- `docs/solutions/workflow-issues/split-phase-migrations-pre-deploy-schema-post-deploy-purge-separate-files-rerun-2026-07-14.md`
  — the ordering discipline the poison's post-deploy apply follows; purge
  tolerates stale writes, poison refuses them.
- `docs/solutions/database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md`
  — coerce-and-tolerate vs this doc's hard-fail: coercion fits columns the
  server owns; poison fits retiring the whole writer.
- `docs/solutions/security-issues/rls-enabled-zero-policies-but-the-server-code-is-postgrest-anon-key-2026-07-28.md`
  — origin of the `request.jwt.claims` emulation technique; this doc adds
  its read-side failure mode.
- `docs/solutions/integration-issues/postgrest-head-count-probe-false-positive-existence-check-2026-07-21.md`
  — sibling class: verification probes lying about ground truth.
- `docs/solutions/workflow-issues/a-phased-plans-unit-boundary-is-a-schedule-not-a-proof-that-the-swap-is-atomic-2026-07-27.md`
  — the git-timeline layer of swap atomicity; this doc is the
  deployed-bundle layer of the same instinct.
- GitHub issues: none (searched "deploy skew stale bundle", zero results).
