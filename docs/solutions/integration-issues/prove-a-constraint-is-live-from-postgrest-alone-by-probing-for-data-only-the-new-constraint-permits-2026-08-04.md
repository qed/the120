---
module: tooling
date: 2026-08-04
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "A preflight needs to know whether a merged migration is actually applied, and PostgREST cannot read pg_constraint"
  - "The Management API token is unavailable or unauthorized, leaving a preflight with no way to verify schema state"
  - "A schema_migrations row exists for a version but there is no proof the constraint it describes is live"
root_cause: wrong_api
resolution_type: tooling_addition
related_components:
  - database
  - development_workflow
tags: [postgrest, supabase, migrations, preflight, constraints, management-api, verification]
applies_when:
  - "A script must verify a CHECK constraint or other schema change is live before writing data that depends on it"
  - "The Management API channel is unavailable, unauthorized, or too heavy for a preflight"
  - "Deciding whether merged means applied"
---

# Prove a constraint is live from PostgREST alone — probe for data only the new constraint permits

## Context

A batch runner had to confirm, before writing 17 rows, that migration
`20260904120000_fp_username_email_shaped.sql` was **applied** to production. It
was merged (`0377c76`), but merged is not applied — and if the constraint were
still the old one, every write would fail its CHECK.

The obvious route is `pg_constraint`, which PostgREST cannot reach: `supabase-js`
speaks to PostgREST, and the system catalogs are not exposed. That leaves the
Management API — a channel whose token has been outright unauthorized in this
repo before, and whose unavailability would hard-abort the entire run.

## Guidance

**Probe for data that only the new constraint permits.** The old CHECK was
`^[a-z0-9]+$`; the new one allows email-safe punctuation in the interior. So any
stored `fp_username` containing `@` is proof the broadened constraint is live —
the old constraint could not have admitted it.

```ts
// Not the Management API, not pg_constraint — just data.
const probe = await db.from("children").select("fp_username").like("fp_username", "%@%").limit(3);
if (probe.error)            report("UNKNOWN — probe errored");
else if (probe.data.length) report("LIVE");           // proof
else                        report("UNPROVEN");       // absence of evidence only
```

**The load-bearing premise is that the value cannot have arrived any other way.**
Here it holds because the auto-generator (`mintUsername` in
`app/fp/lib/fp-username-rules.ts`) emits `^[a-z0-9]+$` and strips `@` — so no
producer in the system can mint an `@` username. The generator ⊆ CHECK ≡ client
regex nesting invariant (see
[broadening-a-shared-charset](../best-practices/broadening-a-shared-charset-becomes-a-nesting-invariant-generator-subset-of-check-equals-client-regex-2026-08-04.md))
is what makes the probe sound. State that premise wherever you use this
technique — without it, the probe proves nothing.

**Be honest about the asymmetry.** A positive result is proof; a negative result
is not disproof. If no qualifying row exists yet, the probe reports UNPROVEN, and
you fall back to the Management API. In practice one such row usually exists
(here: the Cedric test family), and a deliberate probe row can be seeded once.

**Never verify against a `schema_migrations` row.** That table records what
someone claimed to apply and drifts from reality — see
[migration-version-collision-with-applied-but-unmerged-other-lane](migration-version-collision-with-applied-but-unmerged-other-lane-query-schema-migrations-before-authoring-2026-07-28.md).
Verify the *object*, or data that implies the object.

## Corollary — do not use `head: true` for existence checks

Already documented in full, with an empirical table showing all three variants
return `204`/no-error for a table that does not exist, plus the
`.select('*').limit(0)` replacement and `error.code` classification:
[postgrest-head-count-probe-false-positive-existence-check](postgrest-head-count-probe-false-positive-existence-check-2026-07-21.md).

Stated here only because a preflight is exactly where the temptation arises. A
plan for this runner originally specified `head:true` probes, which would have
silently passed every check. Read that doc; this one does not restate it.

## When to Apply

Reach for this when a script needs schema-state certainty and you would rather
not couple a preflight to a second credential channel. It is cheap (one indexed
`LIKE`), needs no elevated rights beyond what the script already holds, and
fails loud.

It generalizes past CHECK constraints: a widened `varchar` is proven by a value
longer than the old bound; a new enum member by a row carrying it; a dropped NOT
NULL by a null. In every case the question is the same — *what value could only
exist under the new schema, and can it have arrived by any other route?*

## Related

- [postgrest-head-count-probe-false-positive-existence-check](postgrest-head-count-probe-false-positive-existence-check-2026-07-21.md)
  — the corollary, with the empirical evidence.
- [dormant-migration-not-applied-prerequisite-table-missing](dormant-migration-not-applied-prerequisite-table-missing-2026-07-17.md)
  — merged ≠ applied; `to_regclass` answers *existence*. This doc fills the gap
  its Related section flags: nothing answered *constraint liveness*.
- [supabase-cli-stale-db-password-management-api-workaround](supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md)
  — **amendment:** its channel table presents the Management API as the only
  schema channel and PostgREST as data-only. Data can answer a schema question.
  It also names token corruption but not flat unauthorization, for which this is
  the fallback.
- [add-column-if-not-exists-skips-the-whole-clause-constraint-included](../database-issues/add-column-if-not-exists-skips-the-whole-clause-constraint-included-2026-07-27.md)
  — **amendment:** soften "only the `pg_constraint` query answers it" to "only
  the live database answers it — via `pg_constraint`, or via data only the new
  constraint permits."
- [broadening-a-shared-charset-becomes-a-nesting-invariant](../best-practices/broadening-a-shared-charset-becomes-a-nesting-invariant-generator-subset-of-check-equals-client-regex-2026-08-04.md)
  — the charset delta and the generator-subset premise this technique rests on.
