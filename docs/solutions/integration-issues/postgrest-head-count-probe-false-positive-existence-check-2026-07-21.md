---
title: "A PostgREST head:true count probe returns 204/no-error for a MISSING table — use .limit(0) and classify PGRST205 for existence checks"
date: 2026-07-21
category: integration-issues
module: infrastructure
problem_type: integration_issue
component: database
symptoms:
  - "supabase-js `from(t).select('*', { count: 'exact', head: true })` returns `{ error: null, status: 204 }` for a table that does NOT exist, so an existence check built on it always reports 'ready'"
  - "A seed/migration script's to_regclass-substitute precheck never actually fires; against an unapplied migration the script dies on a raw PGRST205 from the first upsert instead of a named 'apply the migration first' error"
  - "A stale/invalid service-role key (or wrong URL) is misreported as 'table missing / migration not applied' because the probe collapses every failure into one boolean"
root_cause: wrong_api
resolution_type: code_fix
severity: high
last_updated: 2026-07-21
related_components:
  - development_workflow
  - tooling
tags:
  - supabase
  - postgrest
  - supabase-js
  - existence-check
  - pgrst205
  - schema-cache
  - migrations
---

# A PostgREST `head:true` count probe returns 204/no-error for a MISSING table — use `.limit(0)` and classify `PGRST205` for existence checks

## Problem

A tsx seed script (`scripts/seed-path-content.ts`) prechecks that its target tables exist before inserting — the PostgREST equivalent of the `select to_regclass('public.<t>')` guard from the dormant-migration playbook, because a service-role `supabase-js` client has no raw-SQL access. The precheck was built on a head-count probe, and it **silently never worked**: PostgREST returns `204 No Content` with `error: null` for a `head:true` count request against a table that does not exist, so the probe always reported "ready." Caught by `ce:review` (empirically, against production) **before** the migration was applied.

## Symptoms

- `admin.from('does_not_exist').select('*', { count: 'exact', head: true })` resolves to `{ error: null, count: null, status: 204 }` — no error, looks like success.
- The script's `waitForTables()` passed on the first attempt regardless of whether the tables existed, so its retry-for-schema-cache-lag loop had nothing to retry against and its named "apply the DDL migration first" error could never fire.
- Against a genuinely unapplied migration, the first `upsert` then failed with a raw `PGRST205: Could not find the table 'public.<t>' in the schema cache` — the exact confusing-raw-error failure mode the precheck existed to prevent.
- Because the probe reduced every outcome to `!error`, an auth/network failure (e.g. a stale `SUPABASE_SERVICE_ROLE_KEY`, a documented recurring condition in this repo) was indistinguishable from "table missing," and would have sent an operator to re-apply a migration that was already fine.

Empirically verified against production (`deolvqnyvhhnavsifgxz`), missing table = `path_program_versions` before apply, existing table = `public.children`:

| Probe | Missing table | Existing table |
|---|---|---|
| `select('*', { count: 'exact', head: true })` | `{ error: null, status: 204 }` ❌ false "ready" | `{ error: null, status: 200 }` |
| `select('*', { head: true })` | `{ error: null, status: 204 }` ❌ | `{ error: null, status: 200 }` |
| `select('*', { count: 'planned', head: true })` | `{ error: null, status: 204 }` ❌ | `{ error: null, status: 200 }` |
| **`select('*').limit(0)`** (no head) | `{ error: PGRST205, status: 404 }` ✅ | `{ error: null, status: 200 }` ✅ |

## What Didn't Work

- **`from(t).select('*', { count: 'exact', head: true })` as an existence probe.** A `head:true` request issues an `HTTP HEAD`, which PostgREST answers with `204` and no body **without validating that the relation exists** — the row-count/`Content-Range` machinery short-circuits before name resolution. Dropping `count` (`{ head: true }`) or switching to `count: 'planned'` does not help; the `head` is what suppresses validation.
- **Treating any error as "table not there yet."** `return !error` throws away `error.code`, so schema-cache lag, an unapplied migration, bad credentials, a wrong URL, and a network blip all collapse into the same boolean and the same (often wrong) remediation message.

## Solution

Probe with `.select('*').limit(0)` — **no `head`** — which forces PostgREST to resolve the relation, then branch on the error **code**, not its presence:

```ts
type TableProbe = { present: boolean; retryableAbsent: boolean; error: string | null };

async function probeTable(admin: SupabaseClient, table: string): Promise<TableProbe> {
  const { error } = await admin.from(table).select("*").limit(0);
  if (!error) return { present: true, retryableAbsent: false, error: null };
  // PGRST205 = "Could not find the table … in the schema cache" — covers BOTH a
  // not-yet-applied migration AND transient schema-cache lag after a fresh DDL
  // apply. Both are retryable. Anything else (auth, network) is NOT.
  if (error.code === "PGRST205") {
    return { present: false, retryableAbsent: true, error: error.message };
  }
  return { present: false, retryableAbsent: false, error: `${error.code ?? "?"}: ${error.message}` };
}
```

The caller retries only `retryableAbsent` and **fails fast** on any other error with the real message, so a credentials problem is never dressed up as "apply the migration":

```ts
const probes = await Promise.all(TABLES.map((t) => probeTable(admin, t)));
const fatal = probes.find((p) => p.error !== null && !p.retryableAbsent);
if (fatal) {
  throw new Error(
    `Could not reach the tables, and this is NOT a missing-table condition: ${fatal.error}. ` +
      `Check SUPABASE_SERVICE_ROLE_KEY / URL / connectivity — do NOT re-apply the migration.`
  );
}
if (probes.every((p) => p.present)) return;        // ready
// else: some are PGRST205 → retry a few times for schema-cache lag, then abort
// with a named "apply the migration first" error citing the migration file.
```

Before (broken) → After (works):

```ts
// BEFORE — always "ready", even for a table that does not exist:
const { error } = await admin.from(table).select("*", { count: "exact", head: true });
return !error;

// AFTER — actually validates the relation, and PGRST205 is distinguishable:
const { error } = await admin.from(table).select("*").limit(0);
// !error → present; error.code === "PGRST205" → absent/retryable; else → fatal
```

## Why This Works

A `head:true` request makes PostgREST return response headers only (`204`, a `Content-Range` count), and it produces that response **without resolving the table name** — so a nonexistent relation yields the same `204/no-error` a real empty table does. Removing `head` makes it a real (bounded, `limit 0`) SELECT, which must resolve the relation first; an unresolved name returns the `PGRST205` "not found in the schema cache" error. `PGRST205` is precisely the retryable class — it fires for both a table that was never created and one whose `CREATE` just landed but PostgREST's schema cache hasn't reloaded yet — while genuine auth/network failures carry different codes (or throw), so keying on the code separates "not there yet, keep polling" from "something is actually wrong, stop."

Note the column shape: `.select('*')` is safe as the probe because `*` needs no known column, whereas `.select('id')` would error on any table without an `id` column (e.g. a composite-PK table) even when it exists — so a `.select('id')`-based probe reintroduces false negatives on exactly the tables this project uses.

## Prevention

- **Never use `{ head: true }` for an existence check.** It is a metadata/count optimization that deliberately skips work, including relation validation. Use `.select('*').limit(0)` when the question is "does this relation exist and can I read it?"
- **Branch on `error.code`, never on `!error` alone**, whenever a single probe must distinguish "not applied yet / schema-cache lag" (`PGRST205`, retryable) from auth/network failures (fail fast). Collapsing them produces a confidently-wrong remediation message.
- **Verify the probe against reality, not intuition.** The cheapest possible check — one throwaway query against a table you know is absent and one you know exists — settles the behavior in seconds; every `head:true` variant above *looks* correct and is not. An unapplied migration is the perfect (free) test bed for a missing-table probe.
- **`.select('*')`, not `.select('id')`**, for the probe column, so it works on composite-PK tables with no `id` column.

## Related Issues

- `docs/solutions/integration-issues/dormant-migration-not-applied-prerequisite-table-missing-2026-07-17.md` — the source of the "committed migration ≠ applied migration; check `to_regclass` before dependents" rule this precheck implements. That doc's `to_regclass` guidance assumes raw-SQL/Management-API access; **this doc is its corollary for the PostgREST-only case** (a service-role `supabase-js` client with no SQL access), including the specific probe shape that looks right but isn't.
- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — how to apply the DDL (Management API) when the precheck reports the tables are genuinely missing; the seed script links to it in its abort message.
