-- Funnel wrap Unit 8 (W15): the refund-side lifecycle, in ONE transaction.
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-07-29): top was 20260820120000 funnel_forwarding_first_stamp.
--   Verified before authoring: zero refunded deposits, zero claim rows —
--   this is forward-looking wiring, not a data repair.
--
-- Why one RPC. The current refund update IS the effective dedupe stamp:
-- once it lands, a replayed charge.refunded no-ops and Stripe stops
-- retrying. Separate PostgREST calls after it (claim flip, ledger insert)
-- would be LOST FOREVER on a crash between them — the never-reissue
-- ledger's row would simply never exist. So the refund mark, the claim's
-- flip to suspend_pending, and the ledger insert commit or roll back
-- together.
--
-- Semantics, pinned by test:
--   - 'no_deposit'  → the deposit row does not exist yet (Stripe delivers
--     out of order). The caller answers non-200 so Stripe retries until
--     the row lands — the zero-row-refund lesson, preserved exactly.
--   - 'released'    → first effective refund: deposit marked, claim (if
--     any) flipped to suspend_pending with its lease TORN UP (a running
--     drive's fenced writes then refuse — the zombie protection working
--     for us), ledger row written with the local_part read IN THIS
--     transaction (a concurrent reassign cannot slip between).
--   - 'noop_replay' → the deposit was already refunded. The claim flip
--     and ledger insert still run idempotently (ON CONFLICT DO NOTHING /
--     state guard), which is what heals the partial-failure replay: if
--     the first attempt crashed after the refund mark but before commit,
--     nothing else stamped, so Stripe's retry re-enters here and the
--     transaction completes the rest. Exactly one ledger row either way.
--
-- The Workspace suspend stays OUT-OF-BAND (never an external call in a
-- webhook transaction): the retention cron sweeps suspend_pending claims
-- (and released/child_deleted rows with a live mailbox — the U6 carry),
-- suspends idempotently, and stamps workspace_suspended_at.
--
-- Partial refunds never reach this RPC — the route's boolean gate
-- (charge.refunded !== true) is unchanged and pinned.

alter table public.funnel_student_provisioning
  add column if not exists workspace_suspended_at timestamptz;

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
    if v_local is not null then
      insert into public.funnel_released_aliases (local_part, email, child_id, reason)
      values (v_local, coalesce(v_email, v_local), v_child, 'refund')
      on conflict (local_part) do nothing;
    end if;
  end if;

  return case when v_already then 'noop_replay' else 'released' end;
end;
$$;

revoke all on function public.deposit_refund_release(text) from public, anon, authenticated;
grant execute on function public.deposit_refund_release(text) to service_role;
