---
module: crm
date: 2026-08-04
problem_type: logic_error
component: database
severity: high
symptoms:
  - "A provisioning rule promises 'we make no writes to this parent' yet that parent becomes eligible for automated nurture mail"
  - "A warm lead that was mailed months ago re-enters the day-2/day-5/day-9 sequence after an unrelated batch run"
  - "Reading consent_given BEFORE a batch run reports 'not eligible'; the same read after the run reports 'eligible'"
root_cause: logic_error
resolution_type: workflow_improvement
related_components:
  - nurture-engine
  - authentication
  - tooling
tags: [crm, nurture, consent, triggers, provisioning, blast-radius, on_parent_created, batch-import]
applies_when:
  - "Batch-provisioning accounts or roster rows for real contacts who may already exist in the CRM"
  - "Reasoning about which families an automated email cron will select"
  - "Writing a rule of the form 'adopt existing records, write nothing'"
---

# "We wrote nothing to that record" does not mean "that record will not be mailed"

## Problem

Provisioning a beta cohort of 10 real warm-network parents, the plan carried a
requirement (R4) that existing parents be left completely untouched: no password
write, no `parents` upsert, no `families` mutation, no mail. That rule was
honoured exactly. Three of those parents were still going to receive automated
nurture email as a direct consequence of the run.

## Symptoms

- A plan states "no writes to this parent" and concludes "therefore no mail."
- A pre-run query of `families.consent_given` says a family is not mailable; the
  same query after the run says it is.
- A lead that already completed a nurture sequence starts it again.

## What Didn't Work

**Reasoning about the columns we wrote.** The first analysis checked what the
runner put in the `parents` insert payload, saw `casl_consent: false`, and
concluded no consent was created. That is true and irrelevant — two other
mechanisms produce eligibility without the runner writing a consent value.

**Reading `consent_given` before the run and gating on it.** The owner-approval
gate was defined as "review each family's `consent_given` and approve." But the
act of applying is what changes the value. A pre-apply read is not a projection
of post-apply state.

## Root Cause

Three independent paths, none of which is a write the operator authored:

**1. The trigger OR-merges consent and resets the anchor.**
`on_parent_created` (`supabase/migrations/20260713110000_crm_core.sql`) matches an
existing lead by `lower(email)` and, in its link branch, does:

```sql
consent_given = consent_given or NEW.casl_consent,
signup_at     = NEW.created_at,
```

So a warm-network lead that already carried `consent_given = true` keeps it
regardless of the payload — and its `signup_at` is reset to *now*, which reopens
the account sequence's day-2 / day-5 / day-9 window. The runner never wrote
`consent_given`; the trigger preserved it and re-anchored the clock.

**2. Children inserted under an untouched parent make that parent eligible.**
`isStalledDraft` (`app/lib/nurture/rules.ts`) returns true for
`applicant_state === 'added'` regardless of dossier completeness, anchored on
`children.updated_at`. Provisioning inserts children with
`status: 'draft'`, `applicant_state: APPLICANT_ENTRY_STATE` — so a parent we
deliberately did not write to acquires a stalled draft child and becomes a
`stall-child` send candidate within 3–6 days.

**3. The consumer is unattended.** The nurture cron runs on a schedule. "I am not
sending any emails right now" is a statement about manual sends and has no
bearing on it.

## Why This Matters

The mental model that fails here is *write-scoped blast radius*: the belief that
the set of rows you can affect equals the set of rows you issue statements
against. With a trigger on one table and a scheduled consumer reading a join
across two others, your blast radius is the transitive closure of
`(rows you write) → (rows triggers touch) → (rows unattended consumers select)`.

`families.is_test` exists precisely as the one column that gates all seven
production reads (`app/crm/lib/test-family-filter.ts`), which is why it is the
cheapest correct mitigation — but you have to know you need it.

## Prevention

**Project post-apply eligibility, never pre-apply state.** The gate a human
approves must be computed against the state the run will *produce*:

```ts
// WRONG — the act of applying is what changes this
const eligible = family.consent_given && !family.consent_revoked_at;

// RIGHT — compose the real rules over the planned end state
const eligible = projectNurtureEligibility(
  { ...family, consent_given: family.consent_given || plannedCaslConsent,
                signup_at: plannedParentsInsert ? now : family.signup_at },
  plannedChildren,   // children we are about to insert -> isStalledDraft
  now
);
```

**Enumerate triggers on every table you insert into, and read their non-obvious
branches.** `on_parent_created` also overwrites `families.phone` with
`NEW.phone` unconditionally — and `parents.phone` is `not null default ''`, so a
payload omitting `phone` silently blanks a real lead's phone number.

**Enumerate unattended consumers of the tables you touch, not just the tables
you write.** Here: the nurture cron reads `families` *and* `children`.

**A rule of the form "adopt existing records and write nothing" needs a
companion claim about adjacent inserts.** It protects the record; it does not
protect the record's derived state.

**Fail-closed on unknown.** An absent or unexpected `consent_given` must render
"unknown — do not proceed", never `false`
(see [fail-closed-type-guard](../best-practices/fail-closed-type-guard-untyped-service-role-rows-into-closed-unions-2026-07-21.md)).

## Related

- [bulk-import-crm-leads-families-derived-stage-parent-id-consent](../best-practices/bulk-import-crm-leads-families-derived-stage-parent-id-consent-2026-07-15.md)
  — the canonical `on_parent_created` / consent doc. **Amendment:** its consent
  guidance reasons entirely about *your own explicit write*; this doc is the case
  where you write nothing and the row still becomes mailable.
- [supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit](../security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md)
  — the original consent-merge incident. Read it first; this is its sequel.
- [a-load-bearing-sticky-fact-needs-a-column-one-writer-and-a-guard](../best-practices/a-load-bearing-sticky-fact-needs-a-column-one-writer-and-a-guard-2026-07-29.md)
  — the prescription the `signup_at` reset violates.
- [a-user-writable-route-into-a-shared-column-flips-its-provenance-make-it-fill-only](../security-issues/a-user-writable-route-into-a-shared-column-flips-its-provenance-make-it-fill-only-2026-08-03.md)
  — the fill-only prescription for the `consent_given` OR-merge.
- [changing-a-gate-without-changing-its-key-leaves-the-old-scope-in-force](changing-a-gate-without-changing-its-key-leaves-the-old-scope-in-force-2026-07-29.md)
  — the other `nurture-engine` doc. Note it establishes a one-sided model in
  which the engine's danger is *under*-sending; this doc is the over-sending half.
