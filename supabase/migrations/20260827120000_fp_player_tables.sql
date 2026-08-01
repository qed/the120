-- First Profit game (Slice A, plan: first-profit repo
-- docs/plans/2026-07-31-001-feat-fpv2-slice-a-game-login-plan.md): the three
-- FP-owned tables — player profiles (identity link), saves (game-state
-- document), ledger (append-only sales/backings).
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-07-31): top of supabase_migrations.schema_migrations was
--   20260826120000 children_stale_writer_poison, so 20260827120000 is free.
--   Apply via the Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--
-- RLS POSTURE — a deliberate, documented deviation from the path-tables
-- zero-policy rule (path_identity.sql "Decision 1"): these tables are read
-- and written by the First Profit SPA directly through PostgREST with the
-- anon key + a child's session, so they carry explicit child-scoped,
-- PER-COMMAND policies. Per-command (not FOR ALL) is deliberate: the funnel
-- FOR-ALL precedent is exactly the shape that let a parent session PATCH
-- applicant_state (closed by children_applicant_state_guard) — and every
-- insert/update policy here carries an explicit WITH CHECK with the same
-- ownership predicate as USING, because the gauntlet_saves update policy's
-- missing WITH CHECK is a known re-point-a-row-at-another-tenant hazard.
--
-- Delete posture: RESTRICT throughout, matching the path graph — deleting a
-- child/account out from under game state must FAIL LOUDLY. The FP-aware
-- deletion order is ledger → saves → profile → child, service-role only.
--
-- Writers, by table:
--   fp_player_profiles — service-role only (the /api/fp/login route creates
--     rows; clients may only SELECT their own).
--   fp_player_saves — seeded (revision 0) by the login route; thereafter the
--     child's session updates doc/revision under CAS + trigger guard. No
--     client insert path at all.
--   fp_ledger — child session inserts source='mock' rows only (policy-pinned:
--     a client-forged 'live' row would permanently poison Phase 2/3 Stripe
--     reconciliation in an append-only table); service role writes the rest.
--
-- Idempotent throughout (create ... if not exists / drop-and-create for
-- policies, triggers, functions) — re-applying is a no-op. Additive-only.

-- ------------------------------------------------------- fp_player_profiles
create table if not exists public.fp_player_profiles (
  id uuid primary key default gen_random_uuid(),
  -- the child's sign-in account. RESTRICT: deleting the account must fail
  -- while game state exists.
  user_id uuid not null unique references auth.users (id) on delete restrict,
  -- the authoritative roster row. RESTRICT for the same reason.
  child_id uuid not null unique references public.children (id) on delete restrict,
  -- public-looking identity (firstprofit.school/<handle>); lowercase
  -- alphanumeric, bounded. Flagged for pre-launch product review (derives
  -- from a minor's first name).
  handle text not null unique
    check (handle ~ '^[a-z0-9]{1,30}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Identity agreement with path_student_profiles (the identity AUTHORITY where
-- both exist): a First Profit profile may never bind a (user_id, child_id)
-- pair that contradicts an existing Path student profile. The login route
-- checks this too, but Slice B adds a second writer — the trigger is the
-- mechanism, the route check is the friendly path.
create or replace function public.fp_player_profiles_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.path_student_profiles psp
    where (psp.user_id = NEW.user_id and psp.child_id is distinct from NEW.child_id)
       or (psp.child_id = NEW.child_id and psp.user_id is distinct from NEW.user_id)
  ) then
    raise exception 'fp_player_profiles: (user_id, child_id) contradicts path_student_profiles';
  end if;
  return NEW;
end;
$$;

drop trigger if exists fp_player_profiles_identity_guard on public.fp_player_profiles;
create trigger fp_player_profiles_identity_guard
  before insert or update of user_id, child_id on public.fp_player_profiles
  for each row execute function public.fp_player_profiles_identity_guard();

-- ---------------------------------------------------------- fp_player_saves
create table if not exists public.fp_player_saves (
  -- one save per player; the row is seeded by the login route so the client
  -- CAS update is unconditional (row always exists, no insert race).
  profile_id uuid primary key references public.fp_player_profiles (id) on delete restrict,
  -- opaque game-state document (ideas, activeIdea, site headline, onboarding,
  -- docVersion). Size-capped: an unbounded client-written jsonb is a
  -- storage-abuse vector. pg_column_size measures post-TOAST size; 256KiB is
  -- far above any legitimate save (5 ideas of short text answers).
  doc jsonb not null default '{}'::jsonb
    check (pg_column_size(doc) <= 262144),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Forward-only revision, enforced server-side: the client's CAS
-- (`where revision = :base`) is UX; this trigger is the mechanism. A hostile
-- or buggy client jumping the counter (revision = 2^62) would otherwise
-- silently brick every future legitimate save.
create or replace function public.fp_player_saves_revision_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    NEW.updated_at := now();
    return NEW;
  end if;
  if NEW.revision is distinct from OLD.revision + 1 then
    raise exception 'fp_player_saves: revision must advance by exactly 1 (got % after %)',
      NEW.revision, OLD.revision;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists fp_player_saves_revision_guard on public.fp_player_saves;
create trigger fp_player_saves_revision_guard
  before update on public.fp_player_saves
  for each row execute function public.fp_player_saves_revision_guard();

-- ---------------------------------------------------------------- fp_ledger
create table if not exists public.fp_ledger (
  -- client-generated uuid so outbox retries are idempotent (a duplicate id is
  -- classified as success client-side, never a retry storm).
  id uuid primary key,
  profile_id uuid not null references public.fp_player_profiles (id) on delete restrict,
  kind text not null check (kind in ('sale', 'backing')),
  -- the day-one discriminator Phase 2/3 reconciliation will trust.
  source text not null check (source in ('mock', 'stripe_test', 'live')),
  payer text not null default '' check (char_length(payer) <= 80),
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

-- Postgres does not auto-index FK columns; both the RLS ownership subquery
-- and every ledger read filter on profile_id.
create index if not exists fp_ledger_profile_id_created_at_idx
  on public.fp_ledger (profile_id, created_at);

-- Append-only is STRUCTURAL, not merely policy-absence. service_role may
-- still update/delete (the pre-launch purge of test-era rows, R25).
create or replace function public.fp_ledger_append_only_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
  end if;
  raise exception 'fp_ledger is append-only';
end;
$$;

drop trigger if exists fp_ledger_append_only_guard on public.fp_ledger;
create trigger fp_ledger_append_only_guard
  before update or delete on public.fp_ledger
  for each row execute function public.fp_ledger_append_only_guard();

-- ------------------------------------------------------------- RLS + grants
alter table public.fp_player_profiles enable row level security;
alter table public.fp_player_saves enable row level security;
alter table public.fp_ledger enable row level security;

-- Default-deny, then narrow grants. Column-scoped update on saves keeps
-- profile_id structurally un-updatable by clients.
revoke all on public.fp_player_profiles from anon, authenticated;
revoke all on public.fp_player_saves from anon, authenticated;
revoke all on public.fp_ledger from anon, authenticated;
grant select on public.fp_player_profiles to authenticated;
grant select on public.fp_player_saves to authenticated;
grant update (doc, revision, updated_at) on public.fp_player_saves to authenticated;
grant select, insert on public.fp_ledger to authenticated;

drop policy if exists "fp profiles: own row" on public.fp_player_profiles;
create policy "fp profiles: own row" on public.fp_player_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "fp saves: read own" on public.fp_player_saves;
create policy "fp saves: read own" on public.fp_player_saves
  for select to authenticated
  using (
    profile_id in (
      select id from public.fp_player_profiles
      where user_id = (select auth.uid())
    )
  );

drop policy if exists "fp saves: update own" on public.fp_player_saves;
create policy "fp saves: update own" on public.fp_player_saves
  for update to authenticated
  using (
    profile_id in (
      select id from public.fp_player_profiles
      where user_id = (select auth.uid())
    )
  )
  with check (
    profile_id in (
      select id from public.fp_player_profiles
      where user_id = (select auth.uid())
    )
  );

drop policy if exists "fp ledger: read own" on public.fp_ledger;
create policy "fp ledger: read own" on public.fp_ledger
  for select to authenticated
  using (
    profile_id in (
      select id from public.fp_player_profiles
      where user_id = (select auth.uid())
    )
  );

-- Clients may record only mock money, bounded, on their own profile. The
-- $1,000 cap matches the product's own goal ("first $1,000"); service role
-- (Stripe webhooks, Phases 2-3) is not bound by this policy.
drop policy if exists "fp ledger: insert own mock" on public.fp_ledger;
create policy "fp ledger: insert own mock" on public.fp_ledger
  for insert to authenticated
  with check (
    source = 'mock'
    and amount_cents between 1 and 100000
    and profile_id in (
      select id from public.fp_player_profiles
      where user_id = (select auth.uid())
    )
  );
