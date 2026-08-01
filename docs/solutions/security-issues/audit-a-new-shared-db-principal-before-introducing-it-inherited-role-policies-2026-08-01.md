---
title: "Audit a new principal type BEFORE you introduce it to a shared RLS database — a new principal that holds the same identity rows inherits every role-scoped policy"
date: 2026-08-01
category: security-issues
module: fp-auth
problem_type: security_issue
component: rls-policy
symptoms:
  - "A new feature adds a new kind of authenticated user to a database many other features share"
  - "Unclear whether the new principal can reach other tenants' or other subsystems' data under existing RLS"
root_cause: design_gap
resolution_type: workflow_improvement
severity: medium
tags:
  - rls
  - shared-database
  - threat-model
  - principal
  - authorization
  - supabase
related_components:
  - security
  - authorization
---

# Audit a new shared-DB principal before you introduce it

## Context

The120's Supabase project is shared across many features (funnel, CRM, Path/FW,
gauntlet, First Profit). First Profit Slice A introduced one new principal — a
CHILD session — and its reach was audited (the R20 record: a child has no
`parents` row, so every parent-scoped policy returns nothing for it, which is what
makes it safe). Slice B introduces a SECOND new principal — a First Profit PARENT
session — which, unlike the child, legitimately HAS a `parents` row and (via the
`on_parent_created` trigger) a `families` row. That changes which policies apply to
it.

## Guidance

**Before shipping a feature that adds a new kind of authenticated user to a shared
RLS database, audit exactly what that principal can read and write across the whole
project — and do it BEFORE the principal is introduced, not after.** A new principal
is not covered by an existing principal's audit if it holds different identity rows.

Two facts make this load-bearing:
1. **RLS keys on the identity rows the principal holds, not on which feature created
   it.** A First Profit parent and a funnel parent are RLS-*indistinguishable* — same
   `parents`/`children`/`families` rows, so the same parent-scoped policies
   (`auth.uid()=parent_id`, `child_id in own children`) apply. Whether that is safe
   or a leak depends entirely on whether those policies isolate correctly — which you
   must verify, not assume from "the existing parents are fine."
2. **A new principal inherits every `to authenticated` grant in the project**, not
   just the new feature's tables — public leaderboards, public RPCs, storage
   policies, and every other feature's parent/child-scoped tables. Enumerate them.

## Why This Matters

If the audit runs LAST (after the principal is built and exercised in production),
any over-reach it finds has already been live against real shared data. A security
audit of a novel principal should GATE the principal's introduction. In Slice B the
audit was made Unit 0 (before the first migration and before any parent session
existed); it confirmed cross-family isolation holds and produced a hard requirement
for the new tables (service-role-only) that the very next unit had to satisfy.

## When to Apply

Any change that lets a new category of user authenticate against a database other
features share: a new signup flow, a new role, a partner/second-party principal, a
service that mints sessions. Especially when the new principal legitimately holds
the same identity rows an existing principal holds (so it silently inherits that
principal's whole policy surface).

## Examples

- **Do:** enumerate every `to authenticated` policy/grant the principal can reach;
  confirm cross-tenant isolation on each writable table; decide the RLS posture for
  the feature's new tables as an OUTPUT of the audit; run it before the migration.
- **Don't:** assume "it's just another parent, and parents are fine" — verify the
  isolation predicates actually hold for the new principal, and check the role-wide
  grants (leaderboards, public RPCs) whose population the new principal now widens.
- Sibling record: the R20 accepted-exposure doc (child principal) in the first-profit
  repo; this is its parent-principal analog and the reusable process behind both.
