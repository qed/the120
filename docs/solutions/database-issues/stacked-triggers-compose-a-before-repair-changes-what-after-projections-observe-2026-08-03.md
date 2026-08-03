---
title: "Stacked triggers compose: a BEFORE trigger that repairs data changes what AFTER triggers observe — and the standard shape for a never-fail hot-table projection trigger"
date: 2026-08-03
category: database-issues
module: fp-public-sites-projection
problem_type: database_issue
component: database
applies_when:
  - "Adding a trigger to a table that already carries triggers, especially a BEFORE trigger that mutates or grafts NEW"
  - "Projecting a client-writable jsonb doc into another table on every write of a hot path"
  - "Any trigger on a table whose writes a client classifies as TERMINAL on error (a RAISE drops the client's payload)"
severity: medium
last_updated: 2026-08-03
related_components:
  - supabase/migrations/20260907120000_fp_public_sites.sql (projection trigger, shared extraction fn)
  - supabase/migrations/20260906120000_fp_save_doc_guard.sql (BEFORE UPDATE doc guard whose repairs the projection observes)
  - app/fp/lib/fp-public-site-rules.ts (extractSiteContent — executable TS spec of the SQL extraction)
tags:
  - trigger
  - trigger-ordering
  - before-vs-after
  - projection
  - jsonb
  - never-raise
  - subtransaction
  - fp
---

# Stacked triggers compose: a BEFORE repair changes what AFTER projections observe

## Context

Unit 1 of the real-public-site plan added an AFTER INSERT/UPDATE projection trigger on
`fp_player_saves` (extracting `siteHeadline` / active idea's `fields.oneLiner` into the
anon-readable `fp_public_sites`). The table already carried a BEFORE UPDATE doc-guard
trigger (`fp_save_doc_guard`) that *repairs* NEW.doc — grafting monotonic state and
appending unmatched OLD ideas at the array tail. Review surfaced that the two triggers
compose in a non-obvious way, and that the projection trigger as first written paid
avoidable costs on every save.

## Guidance

**1. Analyze trigger composition, not each trigger in isolation.** An AFTER trigger sees
NEW *as persisted* — i.e. after every BEFORE trigger's mutation. A repair that "never
touches the projected paths" can still change projection output indirectly: here, the
guard's tail-append can grow `ideas` so that a writer's *out-of-bounds* `activeIdea`
becomes in-bounds post-repair, projecting a grafted OLD idea the writer never sent.
Decide explicitly whether that is correct (here: yes — the contract is "project the
stored doc") and document + test-pin the accepted case. Check both directions:
in-bounds saves AND indexes that become valid only after repair.

**2. The standard shape for a never-fail hot-table projection trigger** (in body order):

```sql
begin
  -- (a) index-backed short-circuit FIRST: the common case (no projection row)
  --     must not pay jsonb parsing on every debounced save
  if not exists (select 1 from public.fp_public_sites s
                 where s.profile_id = NEW.profile_id) then
    return NEW;
  end if;
  -- (b) version-gate the parse: only doc shapes this trigger knows
  -- (c) defensive extraction via ONE shared function (also used by any backfill)
  -- (d) UPDATE guarded by IS DISTINCT FROM — no tuple churn when content unchanged
  update public.fp_public_sites s set ...
   where s.profile_id = NEW.profile_id
     and (s.headline is distinct from coalesce(v_headline, s.headline)
       or s.one_liner is distinct from coalesce(v_one_liner, s.one_liner));
  return NEW;
exception when others then
  -- (e) warn-and-return, never fail the save; the warning is the ONLY
  --     observability for silent projection staleness — do not omit it
  raise warning 'fp_public_sites_project_save failed: % %', SQLSTATE, SQLERRM;
  return NEW;
end;
```

Rationale per element: (a) the EXCEPTION block itself costs a subtransaction per
invocation — the short-circuit bounds who pays it; (d) without the distinct-from guard
a claimed learner's row gets a new MVCC tuple version every ~3s of active play with
unchanged content; (e) a bare `RETURN NEW` handler degrades every future failure
(schema drift, permission change, extraction bug) into *permanently silent* staleness.

**3. Pair the SQL with an executable TS spec.** Regex parity tests over migration text
pin structure but not behavior. Port nontrivial extraction/merge logic into a pure TS
function (`extractSiteContent`, following `guardSaveDocUpdate`'s "THE SPEC LIVES HERE"
precedent) and run the adversarial fixtures against it in CI.

**4. Know what jsonb normalization does to your acceptors.** `->>'field'` renders the
*stored numeric*, not the client's literal: `1e3` arrives as `'1000'` and passes a
`^[0-9]{1,9}$` gate. Write acceptor tests against what Postgres renders, not against
hand-typed guesses of the wire form — and rely on bounds checks, not literal-form
rejection, for safety.

## Why This Matters

The composition case is invisible to per-trigger review and to text-parity tests (no
live DB in the suite). The cost items compound at scale: every learner's every save
pays the trigger, forever. And silent-swallow handlers on projection paths convert
every future bug into unnoticed stale public content — on this feature, a child's
public page silently stops updating.

## When to Apply

- Any new trigger on `fp_player_saves` or another multi-trigger hot table: write the
  composition analysis (firing order, which trigger mutates NEW, what downstream
  triggers observe) into the migration header, and test-pin the accepted edges.
- Any doc→projection trigger: use the five-element shape above verbatim.
- Any client-writable numeric field gated by a regex in SQL: test the normalized form.

## Examples

See `supabase/migrations/20260907120000_fp_public_sites.sql` (TRIGGER ORDER and
POST-APPLY VERIFICATION header sections) and the paired
`app/fp/lib/__tests__/fp-public-sites-migration-parity.test.ts`, which pins each
element: short-circuit-before-extraction ordering, the distinct-from guard, the
warn-then-return handler (exactly one `raise warning`, zero `raise exception`), and
the documented tail-append acceptance.
