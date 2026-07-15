---
title: "Debrand migration silently updates 0 of 4 rows — exact-match WHERE clause missed live titles whose em-dashes had drifted to plain hyphens at seed time"
date: 2026-07-14
category: database-issues
module: crm-library-copy
problem_type: database_issue
component: database
symptoms:
  - "20260714213000_debrand_library_copy.sql reports success via the Management API, but a verification SELECT shows 2 of 4 targeted public.library_items rows still carry retired brand copy"
  - "The two unmatched rows are exactly the two whose seed-file titles contain an em-dash (U+2014); their exact-match `where title = '...'` clauses matched 0 rows and the UPDATE reported success anyway"
  - "PowerShell 5.1's Invoke-RestMethod mis-decodes response text, rendering freshly-written em-dashes as mojibake while unmatched titles display a plain hyphen — masking whether the DB, the request encoding, or the display was at fault"
  - "encode(convert_to(title,'UTF8'),'hex') proves live titles hold a plain ASCII hyphen (0x2d) where the seed migration file has an em-dash (e2 80 94) — the original 2026-07-13 seed application flattened them, so seed-file text ≠ live DB text"
  - "Trusting 'no API error' as proof of success would have left off-brand outbound CRM email copy live in production undetected"
root_cause: logic_error
resolution_type: migration
severity: high
last_updated: 2026-07-14
related_components:
  - development_workflow
  - tooling
tags:
  - data-drift
  - em-dash-hyphen
  - silent-no-op-update
  - where-clause-exact-match
  - encoding
  - supabase-management-api
  - powershell-mojibake
  - seed-data-verification
---

# Debrand migration silently updates 0 of 4 rows — exact-match WHERE clause missed live titles whose em-dashes had drifted to plain hyphens at seed time

## Problem

A data-fix migration (`supabase/migrations/20260714213000_debrand_library_copy.sql`) updated `public.library_items` rows keyed on `title = '<exact string copied from the seed migration file>'`. Two of four `UPDATE`s silently matched zero rows because the live titles' em-dashes had been flattened to plain hyphens when the seed migration was originally applied — the migration *file* text and the live *data* had diverged without anyone changing either on purpose.

## Symptoms

- The Management API POST for each `UPDATE` returned success for all statements — no error surfaced for the two that matched nothing (`UPDATE 0` is not a Postgres error).
- A verification `SELECT` afterward showed the retired brand names still present in two of the four target rows — exactly the two whose titles contain a dash.
- While debugging, PS 5.1's `Invoke-RestMethod` response decoding mangled em-dashes in the JSON response into mojibake ("â€œ"-style byte soup), so *correct* freshly-written titles also displayed corrupted in the terminal — visually indistinguishable from "the DB still has garbage data."

## What Didn't Work

**1. Exact-title equality copied from the seed migration file:**

```sql
-- FAILED silently — matched 0 rows on 2 of 4 statements
update public.library_items set
  title = 'PLATFORM RESULTS — TORONTO FAMILIES',
  body  = '...'
where title = 'TIMEBACK RESULTS — TORONTO FAMILIES';   -- em-dash, copied verbatim from the seed file

update public.library_items set
  body = '...'
where title = '/PARENTS — TORONTO PARENT STORIES';      -- em-dash, copied verbatim from the seed file
```

The seed migration (`supabase/migrations/20260713170000_crm_library.sql`, lines 110 and 134) contains `—` (em-dash, U+2014) in those two titles, but when that seed was originally applied to production the em-dashes were flattened to plain ASCII hyphens in the stored rows. Comparing a live hyphenated string against a file-sourced em-dash string never matches; `UPDATE` matching zero rows is silent success, so nothing flagged the mismatch until an explicit verification query ran.

**2. Trusting the PowerShell response display for diagnosis:**

Looking at `Invoke-RestMethod`'s printed output to decide "did this write correctly?" was actively misleading: PS 5.1 mis-decodes response text, so correct em-dashes in a fresh write and unmatched hyphenated titles both rendered as confusing characters in the console. Display output cannot distinguish the three candidate failure surfaces — DB data, request encoding, response decoding — from each other.

## Solution

**Diagnosis — query the stored bytes directly, bypassing every display/decoding layer:**

```sql
select title, encode(convert_to(title, 'UTF8'), 'hex') as hex
from public.library_items
where title ilike 'TIMEBACK%';
```

This returned `2d` (ASCII hyphen) at the position where the seed *file* has `e2 80 94` (UTF-8 em-dash) — proving the live row genuinely contains a hyphen, not a display artifact, and that live data ≠ migration-file text.

**Fix — dash-agnostic `LIKE` prefix matching, replacement text using the live-row hyphen convention:**

```sql
-- Matches regardless of which dash character the live row has:
update public.library_items set
  title = 'PLATFORM RESULTS - TORONTO FAMILIES',   -- hyphen, matching live-row convention
  body  = '...'
where title like 'TIMEBACK RESULTS%';

where title like '/PARENTS%PARENT STORIES';
```

Before running a fuzzy `UPDATE`, confirm its cardinality: `select count(*) ... where title like 'TIMEBACK RESULTS%'` must equal the number of rows you intend to touch (here: 1).

The two rows that matched on plain `=` contain no dash character — nothing for the seed application to have mangled. The migration file documents the reasoning inline so the next reader doesn't "simplify" it back to equality:

```sql
-- Titles are matched by LIKE prefix, not equality:
-- the live rows carry plain ASCII hyphens where the seed file has em-dashes
-- (the original seed application flattened them), so exact-match on the
-- seed file's text misses. The replacement title uses a hyphen to match
-- the live rows' convention.
```

**Verification — negative-space count queries, not "no error returned":**

```sql
-- Should be 0: no library_items row still contains a retired brand token
-- (apply the SAME token list to every text column — asymmetric predicate
-- lists leave blind spots)
select count(*) from public.library_items
where title ilike '%timeback%' or title ilike '%alpha%'
   or title ilike '%gt anywhere%' or title ilike '%2 hour learning%'
   or body ilike '%timeback%' or body ilike '%alpha%'
   or body ilike '%gt anywhere%' or body ilike '%2 hour learning%';

-- Should be 0: no gtm_weeks action jsonb blob still contains a retired brand token
select count(*) from public.gtm_weeks, jsonb_array_elements(actions) as elem
where elem->>'text' ilike '%timeback%' or elem->>'text' ilike '%alpha%'
   or elem->>'text' ilike '%gt anywhere%';
```

A negative-space count catches *any* row still matching the bad state, regardless of which predicate was supposed to find it — it doesn't depend on already knowing which rows were affected. The corrected migration is idempotent (plain `UPDATE`s), so re-running the whole file after the fix was safe.

## Why This Works

- **Root cause chain:** the 2026-07-13 seed application (via the Management API path in `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`) flattened em-dashes in the stored titles to ASCII hyphens. The migration file on disk still has the original em-dashes, so file text and live data silently diverged at write time — long before the follow-up migration ran.
- **`LIKE` prefix matching is dash-agnostic:** matching on a prefix/suffix that excludes the fragile character sidesteps the question of which dash variant is actually stored.
- **`encode(convert_to(col,'UTF8'),'hex')` bypasses every display layer:** hex output is pure ASCII digits — no client charset guessing, terminal encoding, or PowerShell response mangling can alter `2d` into anything else. It answers "what byte is actually in the database" with no layer in between capable of lying.
- **`\uXXXX` JSON escaping protects the write path (not the read/display path):** PS 5.1 `ConvertTo-Json` escapes non-ASCII to `\uXXXX` before the body is sent, so outbound SQL carrying em-dashes arrives server-side intact. The corruption in this incident lived in the historical data and in the terminal display — not in this migration's own writes.

## Prevention

- **Never key a data-fix `UPDATE`/`DELETE` on an exact string literal copied out of a seed or migration file.** File text is not a live-data guarantee — any prior application (encoding mismatch, manual edit, trigger, earlier bugged migration) can have silently altered what's stored. Prefer stable identifiers; when text matching is unavoidable, use prefix/suffix `LIKE` patterns excluding encoding-fragile characters (dashes, smart quotes, non-breaking spaces; escape `%`/`_` if titles ever contain them), or normalize both sides (e.g. `regexp_replace(title, '[-—–]', '-', 'g')` — illustrative, not an exhaustive dash class).
- **Check cardinality before running any fuzzy predicate.** Run the identical `WHERE` as a `SELECT count(*)` first and confirm it equals the intended row count. A `LIKE` pattern that matches exactly one row today isn't guaranteed to stay unique — over-matching corrupts rows you never meant to touch, which is *harder* to catch than the zero-row no-op this doc addresses.
- **Verify data migrations with negative-space count queries, not absence of error.** `UPDATE` matching 0 rows is silent success in Postgres — count how many rows *still* match the bad condition after the migration, expecting zero, with the same token list applied to every text column.
- **Check the migrations directory for version collisions before naming a new file, and never record versions with `on conflict do nothing`.** This migration originally shipped as `20260714210000` — colliding with `20260714210000_purge_test_scores.sql` from a parallel work stream — and the `on conflict do nothing` version insert silently "succeeded" against the *other* migration's row, leaving this one unrecorded (the same silent-no-op failure shape as the UPDATE, in bookkeeping form). Renamed to `20260714213000`; use a plain `insert` (or verify with a `select` after) so a conflict surfaces instead of vanishing.
- **Diagnose encoding questions at the source with `encode(convert_to(col, 'UTF8'), 'hex')`, never through a client display.** Terminal/response decoding (PowerShell, psql client encoding, browser rendering) is not a trustworthy oracle for stored bytes. (auto memory [claude]: this repo's standing rule — assume PowerShell mangles byte encodings at every process/marshaling boundary — now extends to display boundaries and to text columns whose write history you don't control.)
- **This is the third member of the repo's PowerShell-encoding trap family:** (1) BOM prefixed on piped strings into native CLIs (corrupted a Vercel env var); (2) ISO-8859-1 REST string bodies mangling em-dashes in transit (stale-db-password doc); (3) seeded data drifting from source text at rest, masked by response-display mojibake.

## Related Issues

- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — the Management API playbook this migration used, and trap #2 of the encoding family; its Prevention section now points here.
- `docs/solutions/workflow-issues/split-phase-migrations-pre-deploy-schema-post-deploy-purge-separate-files-rerun-2026-07-14.md` — sibling "verify the migration actually did what you assumed" lesson (phase ordering / re-runs).
- `supabase/migrations/20260714213000_debrand_library_copy.sql` — the corrected migration with inline rationale.
- GitHub issues: none related (searched encoding/migration/em-dash/supabase; zero results).
