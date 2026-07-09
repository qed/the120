-- The 120 — initial schema (S1/S2/S3)
-- parents → children → deposits, mirroring app/dashboard/data.ts

create table public.parents (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  email text not null,
  phone text not null default '',
  postal_code text not null default '',
  casl_consent boolean not null default false,
  casl_consent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  grade int,
  birth_year text not null default '',
  current_school text not null default '',
  photo text, -- data URL for V2; move to a storage bucket later
  subjects jsonb not null default '[]',
  test_scores text not null default '',
  workshop_ids jsonb not null default '[]',
  interests text not null default '',
  project_pitch text not null default '',
  portfolio_links text not null default '',
  status text not null default 'draft',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index children_parent_id_idx on public.children (parent_id);

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  amount integer not null,
  currency text not null default 'cad',
  status text not null default 'paid', -- paid | refunded
  created_at timestamptz not null default now()
);

create index deposits_child_id_idx on public.deposits (child_id);

-- Row level security: parents see only their own family.
alter table public.parents enable row level security;
alter table public.children enable row level security;
alter table public.deposits enable row level security;

create policy "parents: own row" on public.parents
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "children: own children" on public.children
  for all using (auth.uid() = parent_id) with check (auth.uid() = parent_id);

-- Deposits are written only by the service role (Stripe webhook); parents read their own.
create policy "deposits: read own" on public.deposits
  for select using (auth.uid() = parent_id);

-- Public seat count (S4): expose ONLY the count of paid deposits, nothing else.
create or replace function public.seats_claimed()
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer from public.deposits where status = 'paid';
$$;

grant execute on function public.seats_claimed() to anon, authenticated;
