-- First Profit funnel — Unit 14 review follow-up (R52/R52a): the fulfil
-- write becomes CONDITIONAL IN SQL. The core's fulfilVerdict is a
-- read-then-write, and a refund committing between the SELECT and the
-- UPSERT let a retried `completed` overwrite `refunded` with `paid`
-- while refunded_at survived — resurrecting exactly the disagreeing
-- hasPaidDeposit/isLivePaid state this unit closed (the adversarial
-- review's TOCTOU). PostgREST cannot express a conditional upsert, so the
-- condition lives in one atomic statement here.
--
-- Lane B holds the migration lock (re-read immediately before authoring).
-- Apply via the Management API playbook.

create or replace function public.deposit_fulfil(
  p_session_id text,
  p_payment_intent text,
  p_parent_id uuid,
  p_child_id uuid,
  p_amount integer,
  p_currency text,
  p_status text
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.deposits
    (stripe_session_id, stripe_payment_intent, parent_id, child_id, amount, currency, status)
  values
    (p_session_id, p_payment_intent, p_parent_id, p_child_id, p_amount, p_currency, p_status)
  on conflict (stripe_session_id) do update set
    stripe_payment_intent = excluded.stripe_payment_intent,
    amount = excluded.amount,
    currency = excluded.currency,
    status = excluded.status
  -- The refund is newer truth than any replayed fulfilment — atomically.
  where deposits.refunded_at is null
    and deposits.status <> 'refunded';
  if not found then
    return 'refused_refunded';
  end if;
  return 'written';
exception when unique_violation then
  -- deposits_one_live_paid_per_child: a SECOND session's paid row for a
  -- child already holding a live deposit.
  return 'conflict';
end;
$$;
