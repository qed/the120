-- Funnel wrap Unit 6 part 2 (W10, W11, W13a, W15 ledger, W16): the student
-- provisioning claim table, its lease RPC, and the never-reissue ledger.
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-07-29): top of supabase_migrations.schema_migrations was
--   20260816120000 funnel_waitlist_draft_arm, so 20260817120000 is free.
--
-- The shape, and why:
--
-- 1. `funnel_student_provisioning` — ONE row per child (the claim), plus
--    placeholder rows (child_id NULL) that park abandoned local parts.
--    TWO uniqueness guarantees, both load-bearing:
--      - UNIQUE (child_id): replays converge on one row; the webhook's
--        claim insert is idempotent by this key.
--      - a TOTAL UNIQUE (local_part): one owner per address, forever.
--        NEVER a partial index — a partial (e.g. `where state <> 'released'`)
--        would silently re-open released addresses to the next same-name
--        child, reconnecting a channel a departed family may still hold.
--    Claim rows are never deleted; state flips. A local part leaves this
--    table only inside the transaction that writes its ledger row
--    (deposit_refund_release, Unit 8) — with one deliberate exception:
--    `provision_reassign_local_part` moves an abandoned NEVER-ISSUED part
--    onto a placeholder row IN THE SAME TABLE (same transaction), so the
--    total unique keeps arbitrating it without it ever entering the
--    never-reissue ledger (it was never anyone's address).
--
-- 2. `funnel_released_aliases` — the append-only never-reissue ledger,
--    keyed on local_part. Deliberately NO foreign key to children: the
--    ledger must survive child deletion/anonymization, because the promise
--    it records ("this address was somebody's") outlives the row that made
--    it. RLS enabled with ZERO policies — service-role RPC access only,
--    stated as deliberate and pinned by test.
--
-- 3. `provision_lease` — work is taken under an atomic lease: advance to
--    in_progress iff the state is retryable, or take over an EXPIRED
--    in_progress lease (a crashed run must not hold its own claim
--    forever). Everything else returns the prior state unchanged.
--
-- 4. RLS on the claim table: parent-scoped SELECT (the arrival page's
--    family-session read), through a NARROW COLUMN SET via column-level
--    grants — address + state dimensions only. Lease bookkeeping and
--    exception detail stay server-side.
--
-- All statements idempotent; additive-only. Apply via the Management API
-- playbook and record the ledger row (read it back — if the name that
-- comes out is not this one, another writer took the slot).

create table if not exists public.funnel_student_provisioning (
  id uuid primary key default gen_random_uuid(),
  -- NULL child_id = a placeholder row parking an abandoned, never-issued
  -- local part (Workspace 409 despite a won DB claim).
  child_id uuid references public.children (id) on delete cascade,
  state text not null default 'pending',
  forwarding_state text not null default 'none',
  local_part text,
  email text,
  consent_policy_version text,
  supabase_user_id uuid,
  mailbox_ready_at timestamptz,
  -- Staff-visible reasons, one per parking lot. pending_reason for the
  -- consent gate ("stale acceptance, needs re-consent"); exception_reason
  -- for the human queue (underivable name, exhausted candidates);
  -- released_reason for the lifecycle ('unissued' here, refund in Unit 8).
  pending_reason text,
  exception_reason text,
  released_reason text,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  ops_alerted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One provisioning per child. (Placeholder rows have NULL child_id, which
-- the unique index treats as distinct — that is the intended carve-out.)
create unique index if not exists funnel_student_provisioning_child_id_key
  on public.funnel_student_provisioning (child_id);

-- TOTAL unique on local_part: the race arbiter for every population state.
create unique index if not exists funnel_student_provisioning_local_part_key
  on public.funnel_student_provisioning (local_part);

create index if not exists funnel_student_provisioning_state_idx
  on public.funnel_student_provisioning (state);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'funnel_student_provisioning_state_check') then
    alter table public.funnel_student_provisioning
      add constraint funnel_student_provisioning_state_check
      check (state in (
        'pending', 'in_progress', 'identity_only', 'complete',
        'exception', 'suspend_pending', 'released'
      ));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'funnel_student_provisioning_forwarding_check') then
    alter table public.funnel_student_provisioning
      add constraint funnel_student_provisioning_forwarding_check
      check (forwarding_state in (
        'none', 'pending_verification', 'active', 'refused'
      ));
  end if;
end $$;

alter table public.funnel_student_provisioning enable row level security;

-- Parent-scoped SELECT: a family session may read ITS OWN children's rows.
drop policy if exists "provisioning: own children" on public.funnel_student_provisioning;
create policy "provisioning: own children" on public.funnel_student_provisioning
  for select
  using (
    child_id in (select id from public.children where parent_id = auth.uid())
  );

-- The NARROW COLUMN SET: revoke the default table-wide grants, then grant
-- SELECT on exactly the columns the arrival page needs. Lease bookkeeping,
-- error text, and exception detail never cross PostgREST to a family
-- session. (service_role keeps full access.)
revoke all on table public.funnel_student_provisioning from anon, authenticated;
grant select (child_id, state, forwarding_state, email)
  on public.funnel_student_provisioning to authenticated;

-- ------------------------------------------- the never-reissue ledger
create table if not exists public.funnel_released_aliases (
  local_part text primary key,
  email text not null,
  -- uuid, NOT a foreign key: the ledger survives anonymization.
  child_id uuid,
  reason text not null,
  released_at timestamptz not null default now()
);

alter table public.funnel_released_aliases enable row level security;
-- ZERO policies, deliberately: every access path is a service-role RPC.
-- Pinned by test with a pg_policies count; do not add policies here.
revoke all on table public.funnel_released_aliases from anon, authenticated;

-- ------------------------------------------------------- the lease RPC
create or replace function public.provision_lease(
  p_child_id uuid,
  p_owner text,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  -- Atomic: advance iff retryable, or take over an expired lease. A live
  -- lease held by another run is refused — no second external call.
  update public.funnel_student_provisioning
  set state = 'in_progress',
      lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      updated_at = now()
  where child_id = p_child_id
    and (
      state in ('pending', 'identity_only')
      or (state = 'in_progress' and lease_expires_at < now())
    );
  if found then
    return jsonb_build_object('granted', true);
  end if;
  select state into v_state
  from public.funnel_student_provisioning
  where child_id = p_child_id;
  if v_state is null then
    return jsonb_build_object('granted', false, 'state', 'missing');
  end if;
  return jsonb_build_object('granted', false, 'state', v_state);
end;
$$;

revoke all on function public.provision_lease(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.provision_lease(uuid, text, integer) to service_role;

-- ------------------------------------- abandoned-local-part reassignment
-- The Workspace-409-despite-a-won-claim path: the DB claim was won but the
-- address exists at Google (hand-created outside the tables). The child
-- advances to the next candidate; the abandoned part moves onto a
-- placeholder row IN THE SAME TRANSACTION so the total unique index keeps
-- arbitrating it forever. It does NOT enter funnel_released_aliases — it
-- was never issued to anyone.
create or replace function public.provision_reassign_local_part(
  p_child_id uuid,
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
  select local_part, email into v_old_local, v_old_email
  from public.funnel_student_provisioning
  where child_id = p_child_id
  for update;
  if not found then
    return 'missing';
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

revoke all on function public.provision_reassign_local_part(uuid, text, text) from public, anon, authenticated;
grant execute on function public.provision_reassign_local_part(uuid, text, text) to service_role;
