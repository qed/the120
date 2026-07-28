---
module: funnel
date: "2026-07-28"
problem_type: security_issue
component: database
severity: critical
symptoms:
  - "Every production compose would burn the model call, then fail the insert with 42501"
  - "All RLS-scoped project reads return zero rows; re-entry guards pass vacuously"
  - "CI stays green — every core test injects fake deps, so the RLS surface is never exercised"
root_cause: missing_permission
resolution_type: migration
tags:
  - rls
  - policies
  - postgrest
  - anon-key
  - supabase
  - server-code
  - production-only-failure
related_components:
  - service_object
---

# "RLS enabled, zero policies" is only safe if server code really bypasses PostgREST — ours IS PostgREST

## Problem

The U1 migration created `projects` with RLS enabled and zero policies, on the
recorded theory: "Parents reach projects through server code, never PostgREST."
Nine units later, U10 wrote that server code — and it authorizes through
`supabaseServer()`, which is `createServerClient` with the **anon key plus the
parent's session cookies**. That IS PostgREST, as role `authenticated`. Only
`supabaseAdmin` bypasses RLS, and the funnel cores are forbidden from importing
it by standing rule.

Under RLS-with-no-policy: every `SELECT` returns zero rows (so the re-entry
guard passes vacuously) and every `INSERT` raises 42501 — mapped by the code to
"failed", whose UI copy invites a retry. Net production behaviour: pay for the
model call, fail to persist, invite the user to pay again. Found by the U10
adversarial reviewer chasing the migration to ground truth; invisible to the
whole suite because core tests inject fake deps.

## Symptoms

- Table works in tests, dead in production, with a paid external call in front
  of the failing write.
- `children` worked all along — it has `"children: own children" FOR ALL
  USING (auth.uid() = parent_id)` from the initial schema; `projects` simply
  never got its sibling.

## What Didn't Work

Trusting the migration's own comment. The comment described an access path
("server code, never PostgREST") that no code in the repo actually has. A
recorded decision is not a property of the system; the client library in use
is.

## Solution

`20260808120000_funnel_projects_policies.sql` (applied to production via the
Management API playbook):

```sql
create policy "projects: own children's projects" on public.projects
  for all
  using (child_id in (select id from public.children where parent_id = auth.uid()))
  with check (child_id in (select id from public.children where parent_id = auth.uid()));
```

Plus a tripwire in `funnel-compose-core.test.ts` that fails if no
`create policy "projects:` exists anywhere in `supabase/migrations/` — so the
policy cannot be dropped silently.

The same review also closed the inverse gap on `children`: the FOR ALL policy
lets a parent session PATCH `applicant_state` to any CHECK-valid rung via
crafted REST, and U10 made that ladder load-bearing. Fixed with a coercing
trigger (`children_applicant_state_guard`) that allows only the parent-driven
transitions (today: added → project_created) for non-service-role writers —
the same pattern as `children_status_guard`.

## Why This Works

RLS is the authorization layer only when a policy exists to say yes. "RLS
enabled, zero policies" is a valid *lockout* posture for service-role-only
tables — but the moment any user-session code path touches the table, it is a
production-only outage that no deps-injected test can see.

## Prevention

- When a table's access story says "server code only", name the CLIENT that
  server code uses. `supabaseServer()` (anon key + cookies) is PostgREST and
  needs policies; only the service-role client bypasses them.
- When a unit adds the first user-session code path to a table, check
  `pg_policies` for that table in the same unit — and pin it with a
  migration-scan tripwire test.
- Fake-deps behavioural suites cannot catch permission gaps by construction.
  The RLS surface needs either an integration probe or a policy-existence
  scan; ship at least the scan.
- A guard on one status column (`children_status_guard`) is a template: any
  NEW state column that becomes load-bearing needs the same coercing
  one-way trigger, in the unit that makes it load-bearing.
