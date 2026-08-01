-- First Profit Slice B (Unit 3): parental-consent HARDENING — carries the
-- Unit 1 migration-review follow-ups now that consent rows first exist (the
-- recordConsent core in this unit is the first writer). Plan: first-profit repo
-- docs/plans/2026-08-01-001-feat-slice-b-signup-provisioning-plan.md.
--
-- ⚠ VERSION — PLACEHOLDER SLOT, NOT YET APPLIED. This file is AUTHORED ONLY;
--   the human applies it at the migration gate. Before applying, query the LIVE
--   ledger for the next free version and RENAME this file to match:
--
--     select version, name from supabase_migrations.schema_migrations
--     order by version desc limit 5;
--
--   At authoring time the repo's top migration was 20260829120000
--   fp_signup_consent, so 20260830120000 is the provisional slot — but the live
--   ledger is the only truth (another lane's migration may be applied-but-
--   unmerged). Apply via the Management API playbook, per supabase/MIGRATION-LOCK.md.
--
-- SAFETY RESTS ON THE TABLE BEING EMPTY AT APPLY TIME. fp_parental_consent has
--   NO rows yet (Unit 3's core is its first writer, and Unit 4 — which mints the
--   first real child/consent — lands AFTER this migration is applied at the
--   gate). So `add constraint ... check (...)` and `alter column ... set not
--   null` both run instantly with no data to scan. We deliberately do NOT use the
--   NOT VALID + VALIDATE split: the whole file is POSTed as ONE Management-API
--   query = one implicit transaction, so a later VALIDATE would run under the
--   ACCESS EXCLUSIVE lock the ADD CONSTRAINT already took — the split buys no
--   concurrency here and only adds moving parts. On an empty table the direct
--   form is correct and instant. (If this ever had to run against a POPULATED
--   table, the constraints would instead be added NOT VALID in one migration and
--   VALIDATE'd in a SEPARATE later one so they are not in the same transaction.)
--
-- Idempotent throughout: ALTER TABLE ADD CONSTRAINT is NOT idempotent, so each is
--   guarded by a pg_constraint existence check (the repo idiom); SET NOT NULL is a
--   no-op when already set. Additive-only. Tables stay service-role-only (RLS on,
--   zero policies) — this migration adds no policies and grants nothing to the
--   client roles.

-- --------------------------------------------------------------------------
-- (a) The anti-mis-attachment DB INVARIANT: at most ONE ACTIVE consent per
--     signup attempt. Unit 1 bound consent to (parent_id, signup_attempt_id) in
--     the app; a plain FK expresses "references", not "at most one". A duplicate
--     submit or a retry could otherwise leave mint-time code with two candidate
--     consents and no rule — the exact mis-attachment the binding exists to
--     prevent. `where revoked_at is null` still permits a revoke-then-re-consent
--     history. Both recordConsent (23505 -> `duplicate`) and consentGate (which
--     expects a single active row) rely on THIS index.
create unique index if not exists fp_parental_consent_attempt_active_uidx
  on public.fp_parental_consent (signup_attempt_id)
  where revoked_at is null and signup_attempt_id is not null;

-- --------------------------------------------------------------------------
-- (b1) child_age_band MUST be present. Now that the consent write guarantees the
--      field, a caller bug must not be able to silently persist a NULL age band
--      into an unretrofittable regulated column (COPPA under-13 vs 13-16 hinges
--      on it, and it cannot be re-collected without re-contacting parents).
--      Instant on the empty table; guarded so a re-run is a no-op.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fp_parental_consent_age_band_present') then
    alter table public.fp_parental_consent
      add constraint fp_parental_consent_age_band_present
      check (child_age_band is not null);
  end if;
end $$;

-- Belt and suspenders: NOT NULL in the catalog, not merely CHECK-guarded.
-- Instant on the empty table; a no-op if already set.
alter table public.fp_parental_consent alter column child_age_band set not null;

-- --------------------------------------------------------------------------
-- (b2) jurisdiction MUST be non-empty. The column defaults to '' (Unit 1); this
--      check forbids that sentinel from being PERSISTED, so a caller that omits
--      jurisdiction fails loudly at write time rather than banking an empty,
--      unretrofittable legal field. recordConsent already validates non-empty in
--      the rules layer; this makes it a DB guarantee too.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fp_parental_consent_jurisdiction_nonempty') then
    alter table public.fp_parental_consent
      add constraint fp_parental_consent_jurisdiction_nonempty
      check (jurisdiction <> '');
  end if;
end $$;
