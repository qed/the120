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
--   SECURITY (U12 review fix — fp_username is LOCKED to service-role writes here):
--   the existing `children` policy `for all ... with check (auth.uid()=parent_id)`
--   pins row VALUES, not which COLUMNS a client may set (see docs/solutions/
--   security-issues/rls-with-check-pins-values-not-columns-*.md). Under the
--   table-wide grant a parent could therefore `update children set
--   fp_username=<anything> where id=<own child>` via the anon key + their JWT —
--   a cross-tenant "is this taken" enumeration oracle (23505), handle-squatting,
--   and a login-resolution break once U13 resolves login by fp_username. We do
--   NOT touch the grant (children is shared across funnel / FW / Path and
--   re-granting columns risks those products); instead a BEFORE trigger blocks any
--   NON-service-role write of fp_username (belt-and-suspenders over the parent RLS
--   write), a format CHECK pins the stored shape, and the unique index is made
--   CASE-INSENSITIVE so the DB login namespace matches the lowercase the server
--   generator emits. Generation is server-side only (child-core writes it via the
--   service-role admin client; the backfill is service-role).

alter table public.children
  add column if not exists fp_username text;

-- Globally unique across the WHOLE children table (any product — funnel / FW /
-- Path / FP), because any The120 child can log into First Profit. CASE-INSENSITIVE
-- (`lower(fp_username)`): the generator emits lowercase and the taken-set
-- lowercases, so the DB namespace MUST fold case too — otherwise `Alex` and `alex`
-- are distinct rows and U13 login-by-username is ambiguous. Partial on `is not
-- null` so pre-backfill NULLs never collide; the index is the real arbiter that
-- child-core and the backfill retry against on 23505.
create unique index if not exists children_fp_username_uidx
  on public.children (lower(fp_username))
  where fp_username is not null;

-- Format CHECK: only ever store a server-shaped handle (`^[a-z0-9]+$`) — lowercase
-- alphanumerics, matching the generator. A second line of defense so no crafted
-- value (mixed case, punctuation, whitespace) can ever be persisted even if a
-- future write path forgot to normalize. Guarded by a pg_constraint existence
-- check (the repo idiom — cf. fp_consent_hardening) so a re-run is a no-op.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'children_fp_username_format') then
    alter table public.children
      add constraint children_fp_username_format
      check (fp_username is null or fp_username ~ '^[a-z0-9]+$');
  end if;
end $$;

-- Trigger: fp_username is SERVER-MANAGED. A non-service-role client (a parent on
-- the anon key + their JWT) must never set it on INSERT nor change it on UPDATE —
-- that is the whole point of the fix, since the RLS `with check` cannot express
-- "which columns may this client write". The service-role connection (child-core's
-- admin client, the backfill) is allowed through untouched. The service-role check
-- is `auth.role() = 'service_role'`, the same idiom children_status_guard uses
-- (20260714160000_children_guard_hardening.sql).
create or replace function public.children_fp_username_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The service role (child-core's admin client, the backfill) is the only
  -- principal permitted to write fp_username; let it through unconditionally.
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    if NEW.fp_username is not null then
      raise exception 'fp_username is server-managed and may not be set by this client'
        using errcode = '42501';
    end if;
    return NEW;
  end if;
  -- UPDATE: a non-service-role client may not change fp_username at all (setting,
  -- clearing, or re-pointing it are all blocked). Untouched updates pass through.
  if NEW.fp_username is distinct from OLD.fp_username then
    raise exception 'fp_username is server-managed and may not be changed by this client'
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

-- `update of fp_username` fires only when the column is named in the SET list (an
-- update that cannot change it never pays the trigger cost); INSERT fires for all
-- rows so a supplied non-null handle is caught. Idempotent re-create.
drop trigger if exists children_fp_username_guard on public.children;
create trigger children_fp_username_guard
  before insert or update of fp_username on public.children
  for each row execute function public.children_fp_username_guard();
