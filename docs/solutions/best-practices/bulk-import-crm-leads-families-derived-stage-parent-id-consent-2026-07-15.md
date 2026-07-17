---
title: "Bulk-importing leads into The 120 CRM — the families model (derived stages, parent_id = account link) and CASL consent"
date: 2026-07-15
category: best-practices
module: crm
problem_type: best_practice
component: database
severity: medium
applies_when:
  - "Bulk-adding contacts/leads to the CRM without the one-at-a-time /crm add-family UI"
  - "Distinguishing account-holders from leads in the families table"
  - "Setting or flipping CASL consent on families rows outside the signup flow"
related_components:
  - tooling
  - authentication
  - development_workflow
tags: [crm, families, lead-import, consent, casl, derived-stage, management-api, supabase]
---

# Bulk-importing leads into The 120 CRM — the families model and CASL consent

## Context

We needed to load a hand-built list of ~30 warm-network contacts into the CRM as "interested," and show which of them had already created a 120 account versus which were leads only. There is **no bulk lead-import UI** (GTM-5 "lead capture without an account" is unbuilt), and the `addFamily` server action (`app/crm/lib/actions/families.ts`) is one-at-a-time and needs a staff browser session. So the practical path is a direct write to `public.families` via the Supabase Management API — which only works safely once you understand three things about the CRM model: how a lead differs from an account, that the pipeline **stage is derived not stored**, and how consent gates emailing.

## Guidance

### 1. `parent_id` is the lead-vs-account switch
`public.families` is the CRM spine. `parent_id uuid references parents(id)`:
- **NULL → manual lead** (no 120 account).
- **NOT NULL → linked to a live account.** The `on_parent_created` AFTER-INSERT trigger on `parents` auto-creates or links a family on every signup, so account-holders are already in the CRM — never insert a second family for them.

This one column is the entire "who has logged in vs not" answer. The pipeline renders it natively (linked families show identity from `parents`; leads show the row's own snapshot).

### 2. Pipeline stage is DERIVED, not a column
`deriveStage()` in `app/crm/lib/engine.ts` computes the stage first-match, in funnel order:
`member → deposit_paid → call_held → call_booked → dossier_submitted → dossier_started → account_created (parent_id set) → interested (nothing else)`.

So a bare lead with no `parent_id`, no children, no deposits, and no call stamps **derives to `interested` by construction**. There is no `stage` column to set — you express "interested" by inserting a plain lead, and "they have an account" is `account_created`, which you get for free from `parent_id`. Do not try to write a stage.

### 3. One live family per email (partial unique index)
`families_email_live_unique_idx` is `unique (lower(email)) where email is not null and merged_into_id is null`. A duplicate-email insert **fails the whole statement**. `addFamily` additionally hard-rejects an email that exists in `families` OR `parents`. Pre-check to turn that error into a clean classification.

### 4. Every NOT NULL column has a default
`kid_count` (1), `consent_given` (false), `source` (`'website'`), `spouse_name`/`phone`/`referral_code` (`''`), `kids` (`'[]'`), `heat_score` (3), `deposit_asked_referral` (false). A minimal lead insert only needs `parent_name`, `email`, and `source` (override the `'website'` default to a real channel like `'warm-network'`; sources live in `app/crm/lib/constants.ts`).

### 5. Consent gates emailing, not visibility
The email send-gate is `consent_given && !consent_revoked_at`. But the pipeline loads **all** live families regardless of consent (`queries.ts`, `db.from("families").select(...).is("merged_into_id", null)`). So:
- Import with **`consent_given = false`** unless the opt-in is genuinely on file — the leads still appear as `interested`, they're just not emailable yet.
- Flip to `true` only with a lawful basis, and **`coalesce` `consent_at`/`consent_source`** so you never clobber an account-holder's real signup-consent timestamp.

## Why This Matters

- **Stage is derived** — searching for or writing a `stage`/`status` column on `families` is a dead end; the account-vs-lead split you want *is* the `interested` vs `account_created` split, and it falls out of `parent_id`.
- **CASL is first-class here.** A forged-consent hole was a P0 (see the autoconfirm doc below). Importing with `consent_given = true` asserts a lawful basis to email; do it only when the people actually opted in. Default to `false`.
- **The unique index + dual-table reject make naive re-inserts fail.** Pre-checking against both `parents` and `families` avoids a partial/aborted write and cleanly separates "already an account," "already a lead," and "new."

## When to Apply

- Loading any list of contacts into the CRM outside the add-family UI.
- Answering "who has an account vs who's just a lead" (it's `parent_id`).
- Granting/revoking consent in bulk outside signup.
- Any direct `families` write — reach for `deriveStage()` and this model before assuming a column exists.

## Examples

**Pre-check — classify each email (read-only):**
```sql
with input(name, email) as (values ('Ada Lovelace','ada@example.com') /* ... */)
select i.name, i.email,
  (p.id is not null)               as has_account,   -- parents row = signed up
  (f.id is not null)               as has_family,    -- already in CRM
  (f.parent_id is not null)        as family_linked
from input i
left join public.parents  p on lower(p.email) = lower(i.email)
left join public.families f on f.merged_into_id is null and lower(f.email) = lower(i.email);
```

**Insert only the NEW leads + a provenance note, atomically:**
```sql
with ins as (
  insert into public.families (parent_name, email, phone, source, consent_given, last_touch_at)
  values ('Ada Lovelace','ada@example.com','','warm-network',false,now())
  returning id
)
insert into public.family_notes (family_id, author, body)   -- author NULL = system note
select id, null, 'System: imported from the warm-network list on 2026-07-15.' from ins;
```

**Flip consent later without clobbering signup consent:**
```sql
update public.families f
set consent_given = true,
    consent_at    = coalesce(f.consent_at, now()),
    consent_source= coalesce(nullif(f.consent_source,''), 'warm-network opt-in')
where f.merged_into_id is null and lower(f.email) = lower('ada@example.com');
```

**Verify — no API error ≠ rows changed:**
```sql
select count(*) filter (where consent_given and consent_revoked_at is null) as emailable
from public.families where /* ... your email set ... */;
```

**Input gotchas that bit us:** dedupe the source list (one contact was listed twice), reject malformed addresses (an email with an internal space), and sanity-check the domains (two `@utschools.ca` addresses were actually student contributors, not parent prospects). Keep provenance-note text ASCII — em-dashes sent through the PS 5.1 Management-API body have flattened to hyphens at rest before (see the em-dash doc), which then breaks later exact-match `WHERE` clauses.

## Related

- `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md` — the same `on_parent_created` / email-merge / `consent_given` mechanics from the attack angle (email-ownership forgery). Read together: this doc is the safe-write side, that one is the hijack risk.
- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — the Management-API execution channel these SQL snippets run through (token from Windows Credential Manager, UTF-8 body encoding).
- `docs/solutions/database-issues/silent-zero-row-update-em-dash-hyphen-title-drift-crm-library-2026-07-14.md` — why you verify with a `count(*)` after every Management-API write, and the em-dash→hyphen flattening trap.
