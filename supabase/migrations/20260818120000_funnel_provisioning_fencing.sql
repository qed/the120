-- Funnel wrap Unit 6 part 2, review follow-up: the three holes the four-agent
-- review found in 20260817120000, closed before any driver is wired.
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-07-29): top was 20260817120000 funnel_student_provisioning, so
--   20260818120000 is free. The claim table is EMPTY (no writers deployed),
--   so every change here is forward-looking, not a data repair.
--
-- 1. CASCADE → SET NULL + release trigger (data-migrations review, high).
--    `on delete cascade` let a parent's ordinary "Remove this child" delete
--    a claim row outright — removing its local_part from the total unique
--    index and silently re-opening an issued address to the next same-name
--    child, exactly the never-reissue failure the index exists to prevent.
--    Now: deleting the child NULLs child_id, and a trigger flips the
--    orphaned claim to state='released', released_reason='child_deleted'.
--    The row (and its local_part) stays in the claim table forever, so the
--    total unique keeps arbitrating. NOTE for Unit 8: released/child_deleted
--    rows with a supabase_user_id may have a live Workspace mailbox that
--    still needs suspension — the lifecycle sweep must include them.
--
-- 2. Workspace-attempt marker columns (correctness review, P1).
--    A crash between a successful Workspace users.insert and the state
--    write left the next drive unable to tell "I created this mailbox
--    myself" from "hand-created outside the system" — and the collision
--    path would abandon the family's real mailbox. The core now stamps
--    workspace_attempted_at/_email BEFORE the insert; on a later 'exists',
--    a marker for the same email plus student-OU classification means
--    ADOPT, not collide.
--
-- 3. provision_reassign_local_part gains lease-owner fencing (adversarial
--    review, critical class). Without it, a zombie run whose lease expired
--    could still reassign the new leaseholder's address. The RPC now
--    requires the caller to BE the current leaseholder ('lost_lease'
--    otherwise). Signature change is safe: the old signature has zero
--    deployed callers (this PR is the first), so the old function is
--    DROPPED, not overloaded — no PostgREST 300s possible.
--
-- All statements idempotent; apply via the Management API playbook.

alter table public.funnel_student_provisioning
  add column if not exists workspace_attempted_at timestamptz;

alter table public.funnel_student_provisioning
  add column if not exists workspace_attempted_email text;

-- ------------------------------------------------ 1. the FK, made honest
alter table public.funnel_student_provisioning
  drop constraint if exists funnel_student_provisioning_child_id_fkey;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'funnel_student_provisioning_child_id_fkey') then
    alter table public.funnel_student_provisioning
      add constraint funnel_student_provisioning_child_id_fkey
      foreign key (child_id) references public.children (id) on delete set null;
  end if;
end $$;

create or replace function public.funnel_provisioning_child_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The child row is gone; the claim row must survive as a released
  -- placeholder so its local_part is never re-issued. Terminal states keep
  -- their own reason; everything else becomes released/child_deleted.
  if NEW.child_id is null and OLD.child_id is not null then
    if NEW.state not in ('released') then
      NEW.state := 'released';
      NEW.released_reason := coalesce(NEW.released_reason, 'child_deleted');
    end if;
    NEW.lease_owner := null;
    NEW.lease_expires_at := null;
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists funnel_provisioning_child_deleted on public.funnel_student_provisioning;
create trigger funnel_provisioning_child_deleted
  before update of child_id on public.funnel_student_provisioning
  for each row execute function public.funnel_provisioning_child_deleted();

-- --------------------------------- 3. the fenced reassign (drop, not overload)
drop function if exists public.provision_reassign_local_part(uuid, text, text);

create or replace function public.provision_reassign_local_part(
  p_child_id uuid,
  p_owner text,
  p_new_local_part text,
  p_new_email text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_local text;
  v_old_email text;
begin
  -- Only the CURRENT leaseholder may move an address. A zombie run whose
  -- lease expired (and was taken over) gets 'lost_lease' and must stop.
  select local_part, email into v_old_local, v_old_email
  from public.funnel_student_provisioning
  where child_id = p_child_id
    and state = 'in_progress'
    and lease_owner = p_owner
  for update;
  if not found then
    return 'lost_lease';
  end if;

  update public.funnel_student_provisioning
  set local_part = p_new_local_part,
      email = p_new_email,
      updated_at = now()
  where child_id = p_child_id;

  if v_old_local is not null then
    insert into public.funnel_student_provisioning
      (child_id, state, local_part, email, released_reason)
    values
      (null, 'released', v_old_local, v_old_email, 'unissued');
  end if;

  return 'set';
exception when unique_violation then
  -- The NEW local part is already held (raced by a same-name mint). The
  -- whole transaction rolls back; the caller tries the next candidate.
  return 'conflict';
end;
$$;

revoke all on function public.provision_reassign_local_part(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.provision_reassign_local_part(uuid, text, text, text) to service_role;
