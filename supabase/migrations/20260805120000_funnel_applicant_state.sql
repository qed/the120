-- First Profit funnel — Unit 1: applicant state, projects, and the
-- reserve-gate repair (plan 2026-07-27-002, R1–R5, R30a, R52a, F6, F7).
--
-- Lane B holds the migration lock (supabase/MIGRATION-LOCK.md). Apply via the
-- Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md);
-- the CLI's stored DB password is stale and no longer exists on disk.
--
-- THIS FILE CARRIES U6's COLUMNS TOO, deliberately. U6 (capture, Conversion 1)
-- needs `entry_source` and the consent text/version columns and has no
-- migration of its own. Under this repo's rule that authoring a migration IS
-- applying it to production, splitting them would mean a second production
-- migration for a unit that is otherwise pure application code.
--
-- Every statement is idempotent — the first failure aborts the whole file, so
-- a partial apply must be safe to re-run. Additive only: nothing drops or
-- renames while the current code is live.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   * It does not touch `children.status`, `children_status_guard`, or
--     `children_seed_group_assignment`. An earlier draft rewrote the seeding
--     trigger, reasoning that frictionless door switching (R35) would flood the
--     staff review queue. That is false: the trigger early-returns on
--     `status = 'draft'`, funnel children stay `draft` until C2, and funnel
--     state lives on the new column below. Rewriting it is the change that
--     would CREATE the flood.

-- ─────────────────────────────────── children.applicant_state (R4, F5, F7)
-- NULLABLE on purpose. Every child that exists today predates the funnel and
-- keeps a NULL here; `applicantStateAllowsReserve` returns true for NULL, so
-- this column is a no-op for them. A NOT NULL DEFAULT would have retroactively
-- enrolled nine existing children onto rung one of a ladder they are not on.
alter table public.children add column if not exists applicant_state text;

-- The CHECK is NAMED, and the name is what
-- app/lib/__tests__/funnel-migration-parity.test.ts anchors on. Anchoring on
-- the COLUMN name is the documented trap: an unrelated table's ordinary
-- `check (<common column> in (…))` once hijacked a parity test and reddened
-- CRM on a commit touching no CRM code.
--
-- The TS mirror is `APPLICANT_STATES` in app/lib/funnel/applicant-rules.ts,
-- from which the ApplicantState type is derived — so a rename is a compile
-- error at every consumer, and a drift between these eight values and that
-- array is a red test.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'children_applicant_state_check'
  ) then
    alter table public.children
      add constraint children_applicant_state_check
      check (applicant_state is null or applicant_state in (
        'added',
        'project_created',
        'submitted',
        'in_review',
        'offered',
        'waitlisted',
        'deposited',
        'enrolled'
      ));
  end if;
end $$;

-- Partial: only funnel children are indexed, so the nine (and every future
-- direct applicant) cost nothing.
create index if not exists children_applicant_state_idx
  on public.children (applicant_state)
  where applicant_state is not null;

-- ─────────────────────────────────────────────── projects (R1, R2)
-- Anchored on children(id), NOT families. Parents cannot read `families` at
-- all under RLS — it is a CRM table — so a project hung off the family would
-- be unreachable by the very session that created it.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  -- The door the project was born behind (R1). Free text against `groups` in
  -- app/lib/site.ts rather than a CHECK: the group vocabulary is marketing
  -- content that has changed before, and `children.group_slug` — the column
  -- this must agree with — carries no CHECK either.
  group_slug text not null default '',
  name text not null default '',
  description text not null default '',
  offer_sketch text not null default '',
  first_customer_hypothesis text,          -- R39b: weak-signal, nullable not required
  status text not null default 'active',
  creation_route text not null default 'template',
  template_id text,
  quiz_answers jsonb not null default '{}',
  -- AI generation metadata (R1, R40): which model produced it, when, how many
  -- regenerations were spent (counted SERVER-side per R40), and whether the
  -- family edited the output — the signal that says whether the model's draft
  -- was good enough to keep.
  ai_model text,
  ai_generated_at timestamptz,
  ai_regeneration_count integer not null default 0,
  family_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_status_check') then
    alter table public.projects
      add constraint projects_status_check
      check (status in ('active', 'paused', 'abandoned'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_creation_route_check') then
    alter table public.projects
      add constraint projects_creation_route_check
      check (creation_route in ('template', 'own_idea', 'revival'));
  end if;
end $$;

create index if not exists projects_child_id_idx on public.projects (child_id);

-- R2: at most one ACTIVE project per child. A partial unique index, not an
-- application probe — switching is instant (R2) and two tabs switching at once
-- is exactly the window a select-then-write check leaves open. The other half
-- of R2 (at most five projects) is an application cap in `applicant-rules.ts`:
-- its violation costs nothing and a DB counting trigger would amplify every
-- write to guard a limit no adversary gains by exceeding.
create unique index if not exists projects_one_active_per_child
  on public.projects (child_id)
  where status = 'active';

-- Decision 11: RLS enabled, ZERO policies. Every one of the 42 tables this
-- repo's migrations have ever created has RLS enabled, including tables only
-- the service role touches. RLS with no grants makes the table invisible to
-- anyone holding the public anon key — which ships in every client bundle —
-- while the service role is unaffected. Parents reach projects through server
-- code, never PostgREST.
alter table public.projects enable row level security;

-- ─────────────────────────────── deposits: one live paid row per child (R52a)
-- Today's schema is unique on `stripe_session_id` only, so two tabs or an
-- impatient second tap produce two paid rows and consume two of 120 seats.
-- This lands BEFORE checkout exists (U14), deliberately — the constraint is
-- cheap now and a data-repair job later.
--
-- `refunded_at is null` is part of the predicate, not just `status = 'paid'`:
-- that pair is the `isLivePaid` shape the seeding trigger and
-- `children_group_academics` already use, and it is what lets a refunded child
-- pay again without the index refusing them.
--
-- Verified before authoring: zero children currently hold more than one live
-- paid deposit, so this cannot fail on existing data.
create unique index if not exists deposits_one_live_paid_per_child
  on public.deposits (child_id)
  where status = 'paid' and refunded_at is null;

-- ───────────────────────────── families: U6's columns (R30a, R58, F6)
-- `entry_source` does not exist anywhere in this repo today — not as a column,
-- not in app code. U1 authors it; U4 stamps into it; U16 reads it back. It is
-- FAMILY-level and stamped once, immutably, at the first identified moment
-- (C1); a resume must never create a second attribution record.
alter table public.families add column if not exists entry_source text;

-- F6/R30a: `families` carries consent_given / consent_at / consent_source /
-- consent_revoked_at — booleans and timestamps only. CASL requires the accepted
-- TEXT and its version to be recoverable, because the defence is "here is what
-- they were shown", not "here is a flag we set".
alter table public.families add column if not exists consent_text text;
alter table public.families add column if not exists consent_version text;

-- Attribution is queried by source in U16; partial so unattributed CRM leads
-- cost nothing.
create index if not exists families_entry_source_idx
  on public.families (entry_source)
  where entry_source is not null;

comment on column public.families.entry_source is
  'First-touch funnel attribution (R58). Stamped once at C1 and never recomputed.';
comment on column public.children.applicant_state is
  'Funnel ladder (R4). NULL = not a funnel applicant. children.status is untouched and remains the single source for the reserve gate and move_candidate.';
