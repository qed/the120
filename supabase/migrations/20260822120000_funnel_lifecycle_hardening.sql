-- Funnel wrap Unit 8, review follow-up: two holes the U8 review found,
-- closed before merge.
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-07-29): top was 20260821120000 funnel_refund_release. Both
--   redefinitions below are safe: neither function has a deployed caller
--   yet (this branch is the first), and the tables are empty.
--
-- 1. The child-deleted trigger now writes the never-reissue ledger row
--    itself (correctness review). Sequence that leaked: child deleted →
--    FK nulls child_id → trigger flips the claim to released/
--    child_deleted — and a LATER refund's ledger insert misses, because
--    deposit_refund_release looks the claim up BY child_id, which is now
--    null. The claim table's total unique still arbitrates the address,
--    but the ledger exists precisely to survive a future pass that
--    clears old claim rows — so an issued address must enter it at the
--    moment its child row disappears, not depend on a lookup that can no
--    longer find it.
--
-- 2. deposit_refund_release's ledger email fallback becomes truthful
--    (adversarial review): coalesce(v_email, v_local) could write a bare
--    local part into an email column if a future writer ever decouples
--    the pair. The fallback now reconstructs the real address — which is
--    what the pair invariant says it must be.

create or replace function public.funnel_provisioning_child_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.child_id is null and OLD.child_id is not null then
    if NEW.state not in ('released') then
      NEW.state := 'released';
      NEW.released_reason := coalesce(NEW.released_reason, 'child_deleted');
    end if;
    NEW.lease_owner := null;
    NEW.lease_expires_at := null;
    NEW.updated_at := now();
    -- The ledger row, written AT the deletion (see header note 1). The
    -- child_id recorded is the OLD one — the whole point is remembering
    -- whose address this was after the row stops saying so.
    if NEW.local_part is not null then
      insert into public.funnel_released_aliases (local_part, email, child_id, reason)
      values (
        NEW.local_part,
        coalesce(NEW.email, NEW.local_part || '@the120.school'),
        OLD.child_id,
        'child_deleted'
      )
      on conflict (local_part) do nothing;
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function public.deposit_refund_release(
  p_payment_intent text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child uuid;
  v_already boolean;
  v_local text;
  v_email text;
  v_claim_state text;
begin
  select child_id, (status = 'refunded') into v_child, v_already
  from public.deposits
  where stripe_payment_intent = p_payment_intent
  order by created_at desc
  limit 1
  for update;
  if not found then
    return 'no_deposit';
  end if;

  update public.deposits
  set status = 'refunded',
      refunded_at = coalesce(refunded_at, now())
  where stripe_payment_intent = p_payment_intent;

  select local_part, email, state into v_local, v_email, v_claim_state
  from public.funnel_student_provisioning
  where child_id = v_child
  for update;
  if found then
    if v_claim_state <> 'released' then
      update public.funnel_student_provisioning
      set state = 'suspend_pending',
          pending_reason = null,
          lease_owner = null,
          lease_expires_at = null,
          updated_at = now()
      where child_id = v_child;
    end if;
    -- The never-reissue ledger: the local part is read INSIDE this
    -- transaction (the FOR UPDATE above blocks a concurrent reassign), so
    -- the row records the address the child actually held at refund time.
    -- The email fallback reconstructs the REAL address (header note 2).
    if v_local is not null then
      insert into public.funnel_released_aliases (local_part, email, child_id, reason)
      values (v_local, coalesce(v_email, v_local || '@the120.school'), v_child, 'refund')
      on conflict (local_part) do nothing;
    end if;
  end if;

  return case when v_already then 'noop_replay' else 'released' end;
end;
$$;

revoke all on function public.deposit_refund_release(text) from public, anon, authenticated;
grant execute on function public.deposit_refund_release(text) to service_role;
