-- The 120 CRM core (plan Unit 2) — staff, families spine, child_reviews,
-- family_notes, family_stage_history, crm_audit_log, deposits.refunded_at,
-- the parents→families sync trigger, children guard triggers, and the
-- move_candidate() RPC.
-- Apply via the Supabase Management API (stored DB password stale — roadmap
-- E5 note; never assume `db push` works) and record this version in
-- schema_migrations.
-- Enum truth lives in app/crm/lib/constants.ts; the only enum CHECKs kept in
-- the DB are the two tiny stable sets (staff.role, child_reviews.review_status)
-- plus the crm_audit_log action allowlist (alphahub 001/005 pattern).

-- ──────────────────────────────────────────────────────────────── tables ──

create table public.staff (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role text not null default 'admin' check (role in ('admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  -- link to a live account; NULL = manual lead. ON DELETE SET NULL so account
  -- deletion degrades the row to a lead with CRM history intact (Decision 4).
  parent_id uuid references public.parents (id) on delete set null,
  -- identity snapshot — leads own these; while parent_id is set the app
  -- renders identity from the parents row and the snapshot lies dormant
  parent_name text not null default '',
  email text,
  spouse_name text not null default '',
  phone text not null default '',
  -- manual-lead kid rows ({name, grade}); dormant once parent_id links real children
  kids jsonb not null default '[]',
  -- attribution (brief §5.1); source slugs live in constants.ts SOURCES
  source text not null default 'website',
  referral_code text not null default '',
  area text,
  -- CASL consent lifecycle, first-class from day one (Decision 9)
  consent_given boolean not null default false,
  consent_at timestamptz,
  consent_source text,
  consent_revoked_at timestamptz,
  -- co-pilot inputs (brief §5.1/§7)
  heat_score smallint not null default 3 check (heat_score between 1 and 5),
  concerns text[] not null default '{}',
  engagement_signals text[] not null default '{}',
  last_touch_at timestamptz,
  -- manual funnel stamps + manual exits (derived stages come from truth)
  call_booked_at timestamptz,
  call_held_at timestamptz,
  stage_override text,
  deposit_asked_referral boolean not null default false,
  -- funnel-timestamp snapshots (Decision 2c — survive account deletion)
  signup_at timestamptz,
  dossier_submitted_at timestamptz,
  welcome_email_at timestamptz,
  -- merge tombstone: set = this row lost a merge and points at the survivor
  merged_into_id uuid references public.families (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index families_parent_id_idx on public.families (parent_id);

-- One LIVE family per email; tombstones excluded so a merge survivor keeps
-- the address while the loser's row remains for history (Decision 3 —
-- lower(email), no citext).
create unique index families_email_live_unique_idx
  on public.families (lower(email))
  where email is not null and merged_into_id is null;

-- Staff-only review state — deliberately NOT columns on children, whose
-- row-level FOR ALL policy would make them parent-writable (Decision 1).
create table public.child_reviews (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null unique references public.children (id) on delete cascade,
  review_status text not null default 'submitted'
    check (review_status in ('draft', 'submitted', 'in_review', 'invited', 'offered', 'member')),
  review_notes text not null default '',
  -- `group` is a reserved word in Postgres; single-select of the five groups
  group_assignment text,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.family_notes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- nullable: the sync trigger writes system notes with no staff actor
  author uuid,
  body text not null,
  created_at timestamptz not null default now()
);

create index family_notes_family_id_idx on public.family_notes (family_id);

-- Staff-driven stage events only (overrides, reopen, review moves, merges,
-- call stamps); system transitions derive from truth timestamps (Decision 2).
create table public.family_stage_history (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  from_stage text,
  to_stage text not null,
  actor uuid,
  note text,
  created_at timestamptz not null default now()
);

create index family_stage_history_family_id_idx
  on public.family_stage_history (family_id);

create table public.crm_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null,
  action text not null check (action in (
    'family-add', 'stamp-call', 'clear-stamp', 'set-override', 'reopen',
    'note-add', 'contact-update', 'consent-revoke', 'merge', 'review-move',
    'group-assign', 'signal-toggle', 'concern-update', 'heat-override',
    'library-send', 'gtm-edit', 'drill-down'
  )),
  family_id uuid,
  child_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index crm_audit_log_family_id_idx on public.crm_audit_log (family_id);
create index crm_audit_log_created_idx on public.crm_audit_log (created_at desc);

-- Refund truth for weekly funnel math (Decision 2a): the charge.refunded
-- webhook branch stamps this alongside the status flip.
alter table public.deposits add column refunded_at timestamptz;

-- ────────────────────────────────────────────────── updated_at bookkeeping ──

create or replace function public.crm_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

create trigger staff_touch_updated_at
  before update on public.staff
  for each row execute function public.crm_touch_updated_at();

create trigger families_touch_updated_at
  before update on public.families
  for each row execute function public.crm_touch_updated_at();

create trigger child_reviews_touch_updated_at
  before update on public.child_reviews
  for each row execute function public.crm_touch_updated_at();

-- ─────────────────────────────────────────────── audit-log immutability ──
-- No UPDATE/DELETE policies exist either; belt-and-suspenders (alphahub 005).

create or replace function public.prevent_crm_audit_log_modification()
returns trigger
language plpgsql
as $$
begin
  raise exception 'crm_audit_log entries are immutable';
end;
$$;

create trigger crm_audit_log_no_update
  before update on public.crm_audit_log
  for each row execute function public.prevent_crm_audit_log_modification();

create trigger crm_audit_log_no_delete
  before delete on public.crm_audit_log
  for each row execute function public.prevent_crm_audit_log_modification();

-- ─────────────────────────────────────────────────────── is_active_staff ──
-- SECURITY DEFINER so RLS policies on other CRM tables can consult the staff
-- table without a self-referencing (recursive) policy (Decision 8).

create or replace function public.is_active_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.staff
    where id = auth.uid() and is_active
  );
$$;

grant execute on function public.is_active_staff() to authenticated;

-- ───────────────────────────────────────────── parents → families sync ──
-- AFTER INSERT ON parents (AccountModal upserts client-side, so only a
-- trigger fires reliably — Decision 3). SECURITY DEFINER: the INSERT runs
-- parent-authenticated and CRM RLS would silently block the sync otherwise.
-- Defensive: EVERYTHING is wrapped so a sync bug can never block a signup;
-- the backfill script is the repair.

create or replace function public.on_parent_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.families%rowtype;
  v_survivor public.families%rowtype;
  v_matched boolean := false;
  v_hops int := 0;
  v_source text;
  v_full_name text;
  v_new_family_id uuid;
begin
  begin
    v_full_name := trim(NEW.first_name || ' ' || NEW.last_name);

    -- heard_about → SOURCES slug (constants.ts), fallback 'website'.
    -- A referral code is the strongest attribution signal → 'ambassador'.
    if coalesce(NEW.referral_code, '') <> '' then
      v_source := 'ambassador';
    else
      v_source := case NEW.heard_about
        when 'A friend or ambassador' then 'warm-network'
        when 'Parent group or forum' then 'facebook-group'
        when 'My child''s school' then 'warm-network'
        when 'Coach or program director' then 'sports-arts'
        when 'Search' then 'website'
        when 'Event' then 'info-session'
        when 'Other' then 'other'
        else 'website'
      end;
    end if;

    -- Find a family by email (case-insensitive), preferring a live row over
    -- tombstones, then follow merged_into_id to the survivor.
    select * into v_match
    from public.families
    where email is not null
      and lower(email) = lower(NEW.email)
    order by (merged_into_id is null) desc, created_at asc
    limit 1;

    if found then
      v_matched := true;
      v_survivor := v_match;
      while v_survivor.merged_into_id is not null and v_hops < 20 loop
        select * into v_survivor
        from public.families
        where id = v_survivor.merged_into_id;
        if not found then
          v_matched := false; -- broken chain: treat as no match
          exit;
        end if;
        v_hops := v_hops + 1;
      end loop;
    end if;

    if v_matched and v_survivor.parent_id is not null then
      -- Tombstone/conflict branch: the survivor already belongs to another
      -- account. Never overwrite an existing link — create a NEW family for
      -- this parent and cross-reference both for manual staff resolution.
      insert into public.families
        (parent_id, parent_name, email, phone, source, referral_code,
         consent_given, consent_at, consent_source, signup_at)
      values
        (NEW.id,
         v_full_name,
         -- avoid tripping the live-email unique index if the survivor is
         -- live and still holds this exact address
         case when exists (
           select 1 from public.families f
           where f.email is not null
             and lower(f.email) = lower(NEW.email)
             and f.merged_into_id is null
         ) then null else NEW.email end,
         NEW.phone,
         v_source,
         coalesce(NEW.referral_code, ''),
         NEW.casl_consent,
         NEW.casl_consent_at,
         'signup',
         NEW.created_at)
      returning id into v_new_family_id;

      insert into public.family_notes (family_id, body) values
        (v_new_family_id,
         'System: signup email matched family ' || v_survivor.id ||
         ', which is already linked to another account — review for possible duplicate.'),
        (v_survivor.id,
         'System: a new signup with a matching email created family ' || v_new_family_id ||
         ' — review for possible duplicate.');

    elsif v_matched then
      -- Link the lead: snapshot identity from NEW, OR-merge consent, never
      -- touch consent_revoked_at (a revocation is never resurrected).
      update public.families set
        parent_id = NEW.id,
        parent_name = v_full_name,
        email = NEW.email,
        phone = NEW.phone,
        referral_code = case
          when coalesce(referral_code, '') = '' then coalesce(NEW.referral_code, '')
          else referral_code
        end,
        consent_given = consent_given or NEW.casl_consent,
        consent_at = least(
          coalesce(consent_at, NEW.casl_consent_at),
          coalesce(NEW.casl_consent_at, consent_at)
        ),
        consent_source = coalesce(consent_source, 'signup'),
        signup_at = NEW.created_at,
        updated_at = now()
      where id = v_survivor.id;

    else
      -- No match: brand-new family for this signup.
      insert into public.families
        (parent_id, parent_name, email, phone, source, referral_code,
         consent_given, consent_at, consent_source, signup_at)
      values
        (NEW.id, v_full_name, NEW.email, NEW.phone, v_source,
         coalesce(NEW.referral_code, ''),
         NEW.casl_consent, NEW.casl_consent_at, 'signup', NEW.created_at);
    end if;

  exception when others then
    -- Never block account creation (plan: trigger failures must not stop
    -- signups; the sync-health stat + backfill script are the repair).
    raise warning 'on_parent_created failed for parent %: %', NEW.id, sqlerrm;
    return NEW;
  end;

  return NEW;
end;
$$;

create trigger parents_families_sync
  after insert on public.parents
  for each row execute function public.on_parent_created();

-- ───────────────────────────────────────────────────────── move_candidate ──
-- The single action that updates staff-only review state AND parent-visible
-- children.status, atomically in one function so they cannot diverge on
-- partial failure (Decision 6). Service-role only.

create or replace function public.move_candidate(
  p_child_id uuid,
  p_review_status text,
  p_group text,
  p_note text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_status text;
  v_family_id uuid;
begin
  if p_review_status not in ('draft', 'submitted', 'in_review', 'invited', 'offered', 'member') then
    raise exception 'invalid review_status: %', p_review_status;
  end if;

  select review_status into v_prev_status
  from public.child_reviews
  where child_id = p_child_id;

  insert into public.child_reviews (child_id, review_status, group_assignment, reviewed_by)
  values (p_child_id, p_review_status, p_group, p_actor)
  on conflict (child_id) do update set
    review_status = excluded.review_status,
    group_assignment = coalesce(excluded.group_assignment, child_reviews.group_assignment),
    reviewed_by = excluded.reviewed_by,
    updated_at = now();

  -- Parent-dashboard stepper sync (the BEFORE UPDATE OF status guard lets
  -- service_role through; this RPC is callable by service_role only).
  update public.children
  set status = p_review_status,
      updated_at = now()
  where id = p_child_id;
  if not found then
    raise exception 'child % not found', p_child_id;
  end if;

  -- Family via child → parent → live family.
  select f.id into v_family_id
  from public.children c
  join public.families f
    on f.parent_id = c.parent_id
   and f.merged_into_id is null
  where c.id = p_child_id
  limit 1;

  if p_review_status = 'member' and v_family_id is not null then
    insert into public.family_stage_history (family_id, from_stage, to_stage, actor, note)
    values (v_family_id, null, 'member', p_actor, p_note);
  end if;

  insert into public.crm_audit_log (actor, action, family_id, child_id, metadata)
  values (p_actor, 'review-move', v_family_id, p_child_id,
    jsonb_build_object(
      'review_status', p_review_status,
      'previous_review_status', v_prev_status,
      'group_assignment', p_group
    ));
end;
$$;

revoke all on function public.move_candidate(uuid, text, text, text, uuid) from public;
revoke all on function public.move_candidate(uuid, text, text, text, uuid) from anon, authenticated;
grant execute on function public.move_candidate(uuid, text, text, text, uuid) to service_role;

-- ───────────────────────────────────────────────── children guard triggers ──
-- BEFORE DELETE: a parent may not delete a child whose review has advanced
-- beyond draft/submitted or who has a paid deposit (verified gap: submit →
-- pay → delete would cascade the deposit away and move seats_claimed()).
-- SECURITY DEFINER: must read staff-only child_reviews under a parent session.

create or replace function public.children_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return OLD;
  end if;
  if exists (
    select 1 from public.child_reviews cr
    where cr.child_id = OLD.id
      and cr.review_status not in ('draft', 'submitted')
  ) or exists (
    select 1 from public.deposits d
    where d.child_id = OLD.id
      and d.status = 'paid'
  ) then
    raise exception 'This dossier is in review or has a paid deposit — contact admissions to remove it.';
  end if;
  return OLD;
end;
$$;

create trigger children_delete_guard
  before delete on public.children
  for each row execute function public.children_delete_guard();

-- BEFORE UPDATE OF status: parents may only move status between draft and
-- submitted (closes the self-promotion hole — Decision 1/6). Echoing the
-- existing value back unchanged is allowed: the parent dashboard autosave
-- upserts full rows, so a staff-set 'in_review' must not break saves.

create or replace function public.children_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if NEW.status is distinct from OLD.status
     and NEW.status not in ('draft', 'submitted') then
    raise exception 'Dossier status % can only be set by admissions.', NEW.status;
  end if;
  return NEW;
end;
$$;

create trigger children_status_guard
  before update of status on public.children
  for each row execute function public.children_status_guard();

-- ─────────────────────────────────── families.dossier_submitted_at stamp ──
-- First submission wins; the snapshot survives account deletion so past
-- weeks' funnel numbers never rewrite (Decision 2c). Backfill stamps
-- pre-existing submissions. Defensive: never block the parent's submit.

create or replace function public.stamp_dossier_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if NEW.status = 'submitted' then
      update public.families
      set dossier_submitted_at = now(),
          updated_at = now()
      where parent_id = NEW.parent_id
        and merged_into_id is null
        and dossier_submitted_at is null;
    end if;
  exception when others then
    raise warning 'stamp_dossier_submitted failed for child %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;

create trigger children_stamp_dossier_submitted
  after update of status on public.children
  for each row execute function public.stamp_dossier_submitted();

-- ──────────────────────────────────────────────────────────────────── RLS ──
-- staff: JWT role check ONLY — a self-referencing EXISTS would trip
-- Postgres's "infinite recursion detected in policy" (Decision 8).
-- All other CRM tables: role check AND is_active_staff(), so revoking
-- is_active bites at the PostgREST layer even with a stale JWT.
-- NO new policies on parents/children/deposits (CRM reads them via the
-- service role inside staff-guarded server code).

alter table public.staff enable row level security;
alter table public.families enable row level security;
alter table public.child_reviews enable row level security;
alter table public.family_notes enable row level security;
alter table public.family_stage_history enable row level security;
alter table public.crm_audit_log enable row level security;

create policy "staff: admin role" on public.staff
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "families: active staff" on public.families
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff())
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

create policy "child_reviews: active staff" on public.child_reviews
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff())
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

create policy "family_notes: active staff" on public.family_notes
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff())
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

create policy "family_stage_history: active staff" on public.family_stage_history
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff())
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

-- Audit log: SELECT + INSERT only — no UPDATE/DELETE policies exist, and the
-- immutability trigger above backstops even table owners.
create policy "crm_audit_log: staff read" on public.crm_audit_log
  for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

create policy "crm_audit_log: staff insert" on public.crm_audit_log
  for insert
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());
