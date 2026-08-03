-- Direct reserve (2026-08-02, nav-deposit-shortcut U2 adversarial review):
-- two trigger fixes for the pay-before-submit sequencing the feature makes
-- normal. Before direct reserve, a live paid deposit implied status
-- 'offered'+, so both branches below were unreachable; the checkout gate
-- relaxation makes them the EXPECTED path for every early payer.
--
-- 1. children_group_lock_guard: block only CHANGES of an already-set group
--    once a live paid deposit exists. The FIRST pick ('' → value) must land
--    even while paid — an early payer who reserved before reaching the
--    group step was otherwise locked out of their own application forever
--    ("The group is locked…"), with no self-serve remediation.
--
-- 2. children_seed_group_assignment: the live-paid early-return no longer
--    swallows (a) the first-submission seed (draft → submitted) or (b) the
--    first group pick ('' → value). It previously skipped ALL events while
--    paid, so a pay-then-submit family would never get a child_reviews row —
--    invisible to group-capacity accounting (SeatsByGroup reads
--    child_reviews.group_assignment) and to the staff trace channel,
--    permanently, because the group-CHANGE reseed path is locked by guard 1.
--    Group CHANGES while paid stay skipped: a paid child's assignment must
--    not move (belt-and-braces with guard 1, which raises for parents; the
--    skip also covers service-role writes).
--
-- Apply via the Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).

-- ------------------------------------------------ group lock: changes only
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
  if NEW.group_slug is distinct from OLD.group_slug
     and coalesce(OLD.group_slug, '') <> '' then
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

-- -------------------------------- seeding: paid skips only group CHANGES
create or replace function public.children_seed_group_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
  v_reviewed_by uuid;
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
    -- Direct reserve (2026-09-02 fix): while paid, ONLY a group CHANGE is
    -- skipped (the assignment must not move). The first submission and the
    -- first group pick still seed — an early payer must not lose their
    -- child_reviews row.
    if not (
      TG_OP = 'UPDATE' and (
        (OLD.status = 'draft' and NEW.status = 'submitted')
        or coalesce(OLD.group_slug, '') = ''
      )
    ) then
      return NEW;
    end if;
  end if;

  select group_assignment, reviewed_by into v_prev, v_reviewed_by
    from public.child_reviews where child_id = NEW.id;

  insert into public.child_reviews (child_id, group_assignment)
  values (NEW.id, NEW.group_slug)
  on conflict (child_id) do update set
    group_assignment = excluded.group_assignment,
    updated_at = now();

  -- Staff-visible trace ONLY when a staff-touched assignment changes —
  -- newest-write-wins stands (origin decision), but a staff-set group must
  -- never vanish without a trace. Parent revisions of their own untouched
  -- pick stay silent (they were flooding family_notes). The child name is
  -- parent-controlled text: bracketed and truncated so a crafted name can't
  -- impersonate note structure or bloat the feed.
  if v_prev is not null
     and v_prev is distinct from NEW.group_slug
     and v_reviewed_by is not null then
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
        'Parent updated [' || left(coalesce(nullif(trim(NEW.first_name), ''), 'a child'), 80)
          || ']''s group preference: ' || v_prev || ' → ' || NEW.group_slug || '.'
      );
    end if;
  end if;

  return NEW;
exception when others then
  raise warning 'children_seed_group_assignment failed for child %: %', NEW.id, sqlerrm;
  return NEW;
end;
$$;
