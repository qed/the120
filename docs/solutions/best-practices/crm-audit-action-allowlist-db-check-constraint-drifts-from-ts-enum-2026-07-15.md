---
title: "Adding a CRM staff action: crm_audit_log.action is a DB CHECK constraint that drifts from the TS AUDIT_ACTIONS array — reuse an allowed value or migrate the constraint"
date: 2026-07-15
category: docs/solutions/best-practices
module: crm
problem_type: best_practice
component: database
severity: medium
applies_when:
  - Adding a new CRM staff server action that writes a crm_audit_log row
  - Adding a new value to AUDIT_ACTIONS in app/crm/lib/constants.ts
  - Adding a new /crm staff page backed by a new table + server action
related_components:
  - service_object
  - development_workflow
tags: [crm, audit-log, check-constraint, enum-drift, rls, supabase, server-action]
---

# Adding a CRM staff action: the audit-action allowlist is a DB CHECK constraint that drifts from the TS enum

## Context

Building GTM-4 (ambassador reporting) needed two new staff server actions —
`registerAmbassadorCode` / `removeAmbassadorCode`. Every CRM action follows the
house canon: `requireStaff → Zod safeParse → mutate via supabaseAdmin → insert a
crm_audit_log row → { success, error? }`. The obvious move for the audit row is
to add a new action value (e.g. `"ambassador-register"`) to the `AUDIT_ACTIONS`
array in `app/crm/lib/constants.ts`.

That array is **not** the enforcement point. `crm_audit_log.action` is guarded by
a **DB CHECK constraint** with its own hard-coded list, and the two have already
drifted: `offer-email` is in the TS array but **absent** from the CHECK
constraint in `supabase/migrations/20260713110000_crm_core.sql`. A new action
value added only in TS passes typecheck and tests, then fails at runtime when the
insert hits Postgres — and because the `audit()` helper doesn't surface insert
errors, the failure can be a silent audit gap rather than a loud error.

## Guidance

The audit-action enum lives in **two places** that must agree:

1. `AUDIT_ACTIONS` in `app/crm/lib/constants.ts` (TypeScript type + app-side allowlist)
2. `check (action in (...))` on `crm_audit_log` in the crm_core migration (DB enforcement)

Before adding a new staff action, **grep the DB constraint first** and pick one of:

- **Reuse an already-allowed action value** + a `kind` discriminator in the
  `metadata` jsonb. Cheapest — no migration, no constraint change, and the
  Management-API migration-apply dance (stale DB password, see Related) is
  avoided entirely. This is what GTM-4 did: registry writes log as `gtm-edit`
  with `metadata.kind = "ambassador-register"` / `"ambassador-remove"`.
- **Alter the CHECK constraint** with a migration (`alter table … drop
  constraint … ; add constraint … check (action in (…))`) AND add the value to
  the TS array, in the same change. Do this only when the new action is a
  first-class category worth querying on directly.

Two companion conventions for adding a whole new CRM staff page/table (GTM-4
touched all three):

- **Tolerate a pre-migration read.** A staff page that reads a not-yet-applied
  table must degrade, not 500: `const rows = res.error ? [] : res.data`. Truth
  tables (families, deposits) still throw on error; only the new/optional table
  is tolerated. Matches the existing `gtm_*` / `library_*` read posture.
- **Staff-only table = RLS enabled, no policies.** The CRM reads/writes through
  the service-role client (`supabaseAdmin`), which bypasses RLS. `enable row
  level security` with zero policies denies anon/authenticated everything while
  the service role still works.

## Why This Matters

- A new audit value in TS only → the `crm_audit_log` insert violates the CHECK
  constraint at runtime. The mutation it accompanies may already have committed,
  so you get a half-logged action or a swallowed error — worse than a compile
  failure because CI is green.
- `gtm-edit + metadata.kind` keeps the audit trail complete with zero schema
  change, and zero dependence on applying a migration through the Management API.
- The tolerant-read + RLS-no-policies conventions are what let a CRM feature ship
  and deploy *before* its migration is applied (GTM-4 shipped to production with
  its `ambassador_codes` migration still pending) without breaking the page.

## When to Apply

- Any time a new `/crm` server action inserts a `crm_audit_log` row.
- Any time you're tempted to add a value to `AUDIT_ACTIONS` — check the DB
  constraint in the same breath.
- Adding a new staff-only Supabase table backing a CRM page.

## Examples

Reuse an allowed action rather than inventing one (what GTM-4 shipped):

```ts
// app/crm/lib/actions/ambassadors.ts — no new audit enum, no constraint change
await db.from("crm_audit_log").insert({
  actor: staff.staffId,
  action: "gtm-edit",                 // already in BOTH the TS array and the CHECK
  family_id: null,                    // registry write has no family
  metadata: { kind: "ambassador-register", code, owner_name: ownerName },
});
```

The drift that proves the point — TS array vs. DB constraint:

```
# app/crm/lib/constants.ts  → includes 'offer-email'
# supabase/migrations/20260713110000_crm_core.sql:
#   check (action in ('family-add', …, 'library-send', 'gtm-edit', 'drill-down'))
#   ← 'offer-email' is NOT here. Adding an action in TS alone is not enough.
```

Tolerant pre-migration read + service-role-only table:

```ts
// page.tsx — new table tolerated, truth tables not
const registry = registryRes.error ? [] : (registryRes.data ?? []);
for (const res of [familiesRes, depositsRes]) {
  if (res.error) throw new Error(`Ambassadors fetch failed: ${res.error.message}`);
}
```

```sql
-- migration: staff-only table, service-role bypasses RLS
alter table public.ambassador_codes enable row level security;
-- (deliberately no policies)
```

## Related

- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`
  — why "add a constraint-altering migration" is costly here (direct `db push`
  fails on the stale DB password; migrations apply via the Management API).
- `docs/solutions/best-practices/resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md`
  — same CRM server-action canon (requireStaff → Zod → supabaseAdmin → audit).
- `docs/solutions/security-issues/admissions-notification-email-html-injection-via-unescaped-child-parent-names-2026-07-14.md`
  — notes the same "a DB CHECK is a separate layer that could drift" principle
  in the escaping context.
