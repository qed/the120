-- PROVISIONAL — First Profit Watchtower analytics cohort scope.
--
-- This version has NOT been checked against the live migration ledger and this
-- file must NOT be applied under this name until the release owner runs:
--
--   select version, name from supabase_migrations.schema_migrations
--   order by version desc limit 5;
--
-- Rename to the true next-free 12:00:00 slot if 20260929120000 is occupied.
-- The application and parity tests find this migration by its descriptive
-- suffix, so renaming the version is safe.
--
-- One row records an explicit staff decision about one First Profit parent
-- family. Absence means included. A restored family keeps a `false` row so the
-- audit attribution and scope revision survive the reversal; this is why the
-- table is not a sparse list of exclusions.

create table if not exists public.fp_watchtower_family_scope (
  parent_id                 uuid        primary key
    references public.parents (id) on delete cascade,
  excluded_from_analytics   boolean     not null default false,
  -- Actor ids deliberately mirror crm_audit_log.actor: they are validated by
  -- the two-half staff gate before the service-role write, and remain useful
  -- attribution if the staff auth row is later deleted.
  created_by                uuid        not null,
  updated_by                uuid        not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- A random row token makes the aggregate scope revision collision-resistant.
  -- It changes only when the INCLUDED/EXCLUDED decision changes; a repeated
  -- idempotent POST therefore cannot invalidate every cached criterion view.
  revision                  uuid        not null default gen_random_uuid()
);

create index if not exists fp_watchtower_family_scope_excluded_idx
  on public.fp_watchtower_family_scope (parent_id)
  where excluded_from_analytics;

create or replace function public.fp_watchtower_family_scope_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.excluded_from_analytics is distinct from OLD.excluded_from_analytics then
    NEW.updated_at := now();
    NEW.revision := gen_random_uuid();
  else
    -- A repeated request is a no-op, including its attribution. Stable
    -- revisions are what let the client safely merge criterion responses.
    NEW.updated_by := OLD.updated_by;
    NEW.updated_at := OLD.updated_at;
    NEW.revision := OLD.revision;
  end if;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  return NEW;
end;
$$;

drop trigger if exists fp_watchtower_family_scope_touch
  on public.fp_watchtower_family_scope;
create trigger fp_watchtower_family_scope_touch
  before update on public.fp_watchtower_family_scope
  for each row execute function public.fp_watchtower_family_scope_touch();

-- The table is reachable only through server routes after both halves of the
-- staff gate. RLS with zero policies protects it from direct browser clients
-- even if a grant is accidentally widened later. The service role bypasses RLS
-- and is the sole reader/writer.
alter table public.fp_watchtower_family_scope enable row level security;
revoke all on table public.fp_watchtower_family_scope from public, anon, authenticated;
grant select, insert, update, delete on table public.fp_watchtower_family_scope
  to service_role;

revoke all on function public.fp_watchtower_family_scope_touch() from public;
grant execute on function public.fp_watchtower_family_scope_touch() to service_role;
