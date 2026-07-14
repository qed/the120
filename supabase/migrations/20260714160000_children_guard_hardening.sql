-- Dossier wizard (plan 2026-07-14-001, review follow-up): guard hardening
-- from the 12-persona ce:review of feat/dossier-wizard.
--
-- 1. children_status_guard COERCES instead of raising, and now covers
--    INSERT. The dashboard persists full-row upserts; a tab left open after
--    submission echoes its last-known status, and once staff advance the
--    child via move_candidate that echo goes stale. The tightened one-way
--    guard then rejected the ENTIRE row — including the group/workshop edit
--    the parent was explicitly still allowed to make (4 reviewers converged
--    on this). Coercing NEW.status back to OLD.status preserves the same
--    invariant (parents never move status except draft → submitted) without
--    collateral rejection of legitimate columns.
-- 2. children_seed_group_assignment only writes the staff-visible trace
--    note when the review has actually been touched by staff
--    (reviewed_by is not null). The note exists so a STAFF-set assignment
--    never silently vanishes; a parent revising their own pre-review pick
--    was flooding family_notes with noise. Child names in the note body are
--    now bracketed and truncated (parent-controlled text, ≤80 chars).
--
-- Apply via the Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).

-- ------------------------------------------------- status guard: coerce
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
  if TG_OP = 'INSERT' then
    -- Parents create drafts; a REST-crafted insert at 'submitted' would
    -- skip the wizard and immediately seed the review queue.
    if NEW.status is distinct from 'draft' then
      NEW.status := 'draft';
      NEW.submitted_at := null;
    end if;
    return NEW;
  end if;
  if NEW.status is distinct from OLD.status then
    if not (OLD.status = 'draft' and NEW.status = 'submitted') then
      -- Stale echo or tampering: keep the DB's status, accept the rest of
      -- the row. submitted_at travels with status, so it reverts too.
      NEW.status := OLD.status;
      NEW.submitted_at := OLD.submitted_at;
    end if;
  end if;
  return NEW;
end;
$$;

-- Rebind to cover INSERT (was: before update of status only — crm_core.sql).
drop trigger if exists children_status_guard on public.children;
create trigger children_status_guard
  before insert or update of status on public.children
  for each row execute function public.children_status_guard();

-- --------------------------------------------- seeding: quieter, safer note
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
    return NEW;
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
