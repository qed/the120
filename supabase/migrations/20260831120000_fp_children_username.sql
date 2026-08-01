-- First Profit Slice B (Unit 12): every The120 child logs into First Profit
-- with a GLOBALLY-UNIQUE username (no email). This migration adds the column
-- and its uniqueness guarantee ONLY — generation, backfill, and the login
-- re-scope live in code/scripts (this unit) and later units (U13 wires login).
-- Plan: Slice B username re-scope, Unit 12.
--
-- ⚠ VERSION — PLACEHOLDER SLOT, NOT YET APPLIED. This file is AUTHORED ONLY; the
--   human applies it at the migration gate. The live ledger could not be queried
--   at authoring time (the Management-API token was unauthorized), so this uses a
--   provisional slot. BEFORE APPLYING, query the LIVE ledger for the next free
--   version and RENAME this file to match:
--
--     select version, name from supabase_migrations.schema_migrations
--     order by version desc limit 5;
--
--   At authoring time the repo's TOP migration FILE was 20260830120000
--   fp_consent_hardening — but that file is itself an authored-not-yet-applied
--   placeholder, so the real applied ledger may sit BEHIND it, and another lane's
--   migration may be applied-but-unmerged. The live ledger is the only truth
--   (supabase/MIGRATION-LOCK.md). 20260831120000 is the provisional slot: it sits
--   after every migration FILE so it cannot lose a file-ordering diff, but the
--   human MUST confirm/renumber against schema_migrations before applying.
--   Apply via the Management API playbook, per supabase/MIGRATION-LOCK.md.
--   Do NOT write to schema_migrations by hand except as that playbook directs.
--
-- ADDITIVE, IDEMPOTENT, GUARDED, and safe to run against the POPULATED children
--   table: `add column if not exists` adds a NULLable column (no default, no
--   rewrite, no scan); `create unique index if not exists` on a PARTIAL predicate
--   (`where fp_username is not null`) so the many pre-backfill NULLs do NOT
--   collide with each other. RLS is untouched — the existing "children: own
--   children" policy governs the new column exactly as it does every other. This
--   migration adds NO policy and grants nothing.
--
--   NOTE for the applier (RLS surface, no change required this unit): the column
--   is writable by a parent under the existing `for all with check
--   (auth.uid() = parent_id)` policy, so a parent could in principle set/squat
--   their OWN child's fp_username. The partial-unique index prevents duplicates
--   globally, and generation is server-side (child-core + backfill). Locking the
--   column to service-role writes is a later-unit call (it pairs with the login
--   re-scope), deliberately NOT made here.

alter table public.children
  add column if not exists fp_username text;

-- Globally unique across the WHOLE children table (any product — funnel / FW /
-- Path / FP), because any The120 child can log into First Profit. Partial on
-- `is not null` so pre-backfill NULLs never collide; the index is the real
-- arbiter that child-core and the backfill retry against on 23505.
create unique index if not exists children_fp_username_uidx
  on public.children (fp_username)
  where fp_username is not null;
