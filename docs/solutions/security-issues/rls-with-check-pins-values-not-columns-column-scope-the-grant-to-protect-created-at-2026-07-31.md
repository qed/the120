---
title: "An RLS INSERT policy's WITH CHECK pins column VALUES, not which columns a client may set — column-scope the GRANT to protect server-managed columns like created_at on a client-written append-only table"
date: 2026-07-31
category: security-issues
module: fp-game
problem_type: security_issue
component: rls-policy
symptoms:
  - "A child session can POST a fp_ledger row with an arbitrary created_at even though the insert policy's WITH CHECK pins source='mock' and an amount range"
  - "An append-only table read in (profile_id, created_at) order can be silently poisoned with back/post-dated rows by any authenticated client"
  - "The WITH CHECK looked complete because it constrained the columns anyone thought to constrain — the unmentioned columns are the gap"
root_cause: config_error
resolution_type: code_fix
severity: medium
tags:
  - rls
  - postgrest
  - supabase
  - grant
  - column-privileges
  - with-check
  - append-only
  - ledger
related_components:
  - database
  - security
---

# RLS WITH CHECK pins values, not columns — column-scope the GRANT

## Problem

`fp_ledger` (a client-written, append-only sales/backings ledger) shipped with a
table-wide grant and a per-command RLS insert policy:

```sql
grant select, insert on public.fp_ledger to authenticated;

create policy "fp ledger: insert own mock" on public.fp_ledger
  for insert to authenticated
  with check (
    source = 'mock'
    and amount_cents between 1 and 100000
    and profile_id in (select id from public.fp_player_profiles
                       where user_id = (select auth.uid()))
  );
```

That WITH CHECK constrains the **values** of `source`, `amount_cents`, and
`profile_id`. It says nothing about `created_at` — and the table-wide `grant
insert` lets an authenticated client **set** `created_at` (and any other column)
to whatever it likes. A child's browser session can therefore insert a valid
`source='mock'` row with a `created_at` years in the past or future. Because the
ledger is append-only and every read orders on `(profile_id, created_at)`, a
client-chosen timestamp silently corrupts the chronological integrity that
streaks, "first sale" timing, and later Stripe reconciliation depend on.

## Symptoms

- A crafted PostgREST insert
  `supabase.from('fp_ledger').insert({ id, profile_id: <own>, kind:'sale', source:'mock', amount_cents:500, created_at:'2020-01-01T00:00:00Z' })`
  is accepted (RLS passes: source/amount/owner all valid) and lands with the
  attacker's timestamp.
- The policy review "looked" complete because it pinned exactly the columns the
  author was thinking about; nothing draws attention to the columns left
  unmentioned.

## What Didn't Work

- **Assuming WITH CHECK is the whole story.** RLS WITH CHECK is a row-value
  predicate: "is this proposed row allowed to exist?" It has no concept of
  "which columns did the client supply vs. which came from a default." A column
  with `default now()` still accepts a client-supplied value if the client is
  granted insert on that column.
- **Relying on `default now()` alone.** A default only fires when the column is
  *omitted* from the insert. If the grant lets the client name the column, the
  client's value wins over the default.

## Solution

Column-scope the INSERT grant so `created_at` (and any other server-managed
column) is simply not grantable to the client — it can then only take its
default:

```sql
-- follow-up migration (additive; the shipped grant is corrected, not the file)
revoke insert on public.fp_ledger from authenticated;
grant insert (id, profile_id, kind, source, payer, amount_cents)
  on public.fp_ledger to authenticated;
```

Verify the effective privilege:

```sql
select grantee, privilege_type,
       string_agg(column_name, ',' order by column_name) as cols
from information_schema.column_privileges
where table_name = 'fp_ledger' and grantee = 'authenticated'
  and privilege_type = 'INSERT'
group by grantee, privilege_type;
-- cols => amount_cents,id,kind,payer,profile_id,source   (no created_at)
```

Now a PostgREST insert that references `created_at` fails with a hard permission
error (42501); one that omits it gets `default now()`. `id` stays grantable on
purpose — it is a client-generated UUID used as the idempotency key for outbox
retries.

The same repo already used this discipline for `fp_player_saves`
(`grant update (doc, revision, updated_at)` keeps `profile_id` un-updatable) —
the ledger insert grant simply hadn't applied it.

## Why This Works

Postgres privileges are the layer that governs *which columns a role may write*;
RLS policies govern *which row values are allowed*. They are orthogonal and you
need both:

- **Column-level GRANT** → what the client is allowed to name in the write.
- **RLS WITH CHECK** → what values the resulting row may hold.

A server-managed column (timestamps, monotonic counters, ownership keys) must be
excluded from the GRANT; a WITH CHECK cannot substitute, because it never sees
"the client tried to set this column" — only the final row.

## Prevention

- **For any table an authenticated client writes directly via PostgREST, list
  the columns the client may set and `grant insert (…)` / `grant update (…)`
  exactly those — never a bare table-wide `grant insert`/`grant update`.**
  Server-managed columns (`created_at`, `updated_at`, monotonic `revision`,
  identity FKs) stay out of the grant and are enforced by default / trigger.
- **When reviewing an RLS policy, list the columns it does NOT mention and ask
  what stops a client from setting each one.** The gap is always the unmentioned
  columns, and WITH CHECK will not cover them.
- **Back structural invariants (append-only, forward-only counters) with
  triggers, not just policy absence.** Here a `before update or delete`
  raise-trigger makes the ledger append-only for non-service-role writers, and a
  `before update` trigger enforces `revision = old + 1` on `fp_player_saves` —
  the column-scoped grant handles the insert side, the trigger handles the rest.
