-- Dossier wizard (plan 2026-07-14-001, Unit 1): the kid's GROUP and
-- structured ACADEMICS land on children, with the parent's group pick
-- seeding the staff review queue and locking at deposit.
--
-- Shapes are DB-enforced because the dashboard saves browser→Supabase with
-- no server-side validation layer: UI limits alone are bypassable via REST.
-- Apply via the Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).

alter table public.children
  add column group_slug text not null default '',
  add column academics jsonb not null default '[]';

-- '' = not yet chosen; otherwise one of the five groups (app/lib/site.ts).
-- Out-of-enum values would silently vanish from seats-by-group accounting.
alter table public.children
  add constraint children_group_slug_allowed
    check (group_slug in ('', 'athletes', 'founders', 'makers', 'scholars', 'givers'));

-- Max 2 entries, small structured text only — never blobs (plan scope rule).
alter table public.children
  add constraint children_academics_shape
    check (
      jsonb_typeof(academics) = 'array'
      and jsonb_array_length(academics) <= 2
      and pg_column_size(academics) < 8192
    );

-- ---------------------------------------------------------------- group lock
-- The group is parent-editable until a LIVE paid deposit exists for the kid
-- (status = 'paid' AND refunded_at IS NULL — the isLivePaid predicate; a
-- refund re-opens editing, consistent with the dashboard allowing
-- re-reserving after a refund). Echo-tolerant: unchanged values pass because
-- the dashboard autosave upserts full rows.
create or replace function public.children_group_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if NEW.group_slug is distinct from OLD.group_slug then
    if exists (
      select 1 from public.deposits d
      where d.child_id = NEW.id
        and d.status = 'paid'
        and d.refunded_at is null
    ) then
      raise exception 'The group is locked once a seat deposit is paid — contact admissions.';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger children_group_lock_guard
  before update of group_slug on public.children
  for each row execute function public.children_group_lock_guard();

-- ------------------------------------------------------- one-way submission
-- Tightened (was: parents may set any of draft/submitted): every submission
-- now seeds a review row that effectiveReviewStatus trusts, so a parent
-- un-submit would desync the wizard's lock from the staff queue. Parents may
-- only transition draft → submitted; echoes still pass; staff paths use
-- service_role and stay unrestricted.
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
  if NEW.status is distinct from OLD.status then
    if not (OLD.status = 'draft' and NEW.status = 'submitted') then
      raise exception 'Dossier status % can only be set by admissions.', NEW.status;
    end if;
  end if;
  return NEW;
end;
$$;

-- ------------------------------------------------------------ group seeding
-- The parent's pick reaches the staff-only review queue here (parents cannot
-- write child_reviews under RLS). Fires for any NON-DRAFT child — gating on
-- status = 'submitted' alone would go dead once move_candidate advances the
-- child to in_review/invited/offered, silently breaking "parent-editable
-- until deposit" (plan review finding, two independent confirmations).
-- Drafts never seed: a review row would leak them into the queue via
-- effectiveReviewStatus. Copies exactly ONE parent-controlled field
-- (group_slug) — nothing else crosses the trust boundary (the
-- on_parent_created P0 precedent). Never blocks the parent's write.
create or replace function public.children_seed_group_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
  v_family_id uuid;
begin
  if NEW.group_slug is null or NEW.group_slug = '' then
    return NEW;
  end if;
  if NEW.status = 'draft' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    -- Fire only on the first submission or on a group change; plain
    -- status moves by staff (in_review, invited, …) pass through inert.
    if not (
      (OLD.status = 'draft' and NEW.status = 'submitted')
      or NEW.group_slug is distinct from OLD.group_slug
    ) then
      return NEW;
    end if;
  end if;
  if exists (
    select 1 from public.deposits d
    where d.child_id = NEW.id
      and d.status = 'paid'
      and d.refunded_at is null
  ) then
    return NEW;
  end if;

  select group_assignment into v_prev
    from public.child_reviews where child_id = NEW.id;

  insert into public.child_reviews (child_id, group_assignment)
  values (NEW.id, NEW.group_slug)
  on conflict (child_id) do update set
    group_assignment = excluded.group_assignment,
    updated_at = now();

  -- Staff-visible trace when a re-seed CHANGES an existing assignment —
  -- newest-write-wins stands (origin decision), but a staff-set group must
  -- never vanish without a trace. System note: family_notes.author is
  -- nullable by design for exactly this.
  if v_prev is not null and v_prev is distinct from NEW.group_slug then
    select f.id into v_family_id
      from public.families f
      where f.parent_id = NEW.parent_id
        and f.merged_into_id is null
      limit 1;
    if v_family_id is not null then
      insert into public.family_notes (family_id, author, body)
      values (
        v_family_id,
        null,
        'Parent updated ' || coalesce(nullif(NEW.first_name, ''), 'a child')
          || '''s group preference: ' || v_prev || ' → ' || NEW.group_slug || '.'
      );
    end if;
  end if;

  return NEW;
exception when others then
  raise warning 'children_seed_group_assignment failed for child %: %', NEW.id, sqlerrm;
  return NEW;
end;
$$;

create trigger children_seed_group_assignment
  after insert or update on public.children
  for each row execute function public.children_seed_group_assignment();
