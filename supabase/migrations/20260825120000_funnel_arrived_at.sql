-- Funnel dashboard reconnect Unit 11 (plan 2026-07-29-001; R12 flip tier):
-- the sticky arrival fact — `children.arrived_at`.
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-07-29): top of supabase_migrations.schema_migrations was
--   20260824120000 funnel_door_invalidate_rpc, so 20260825120000 is free.
--
-- Why a column and not the telemetry row (plan, Key Technical Decisions):
-- the wrap-U7 `student_account_created` event is best-effort (emit failures
-- are swallowed) and lives in admin-only `funnel_events` with no
-- parent-scoped read path — unfit to be load-bearing. The dashboard's
-- register flip (application → Path skeleton) keys on THIS column, read by
-- the Unit-2 server gate through the family's own RLS `children` read.
--
-- Shape:
--  * `arrived_at timestamptz` NULL — stamped once in the same landing path
--    that marks the provisioning claim `complete` (provision-driver), via
--    `coalesce(arrived_at, now())`, and NEVER cleared. A later refund or
--    mailbox suspension flips the CLAIM's state, never this column — the
--    flip is sticky and monotonic by construction (R12).
--  * NO constraint and NO index: the only reader is the dashboard gate,
--    which reads the family's own children rows by parent via RLS — the
--    existing read path serves it; nothing filters on arrived_at.
--  * The ADD COLUMN clause stands ALONE — nothing rides it (the
--    clause-gating lesson: IF NOT EXISTS gates the WHOLE clause, so any
--    constraint attached here would be silently skipped for a pre-existing
--    bare column; see docs/solutions/database-issues/
--    add-column-if-not-exists-skips-the-whole-clause-…-2026-07-27.md).
--  * DB-guarded, single service writer: exactly one code writer exists
--    (the provisioning landing, service role) and it writes
--    `coalesce(arrived_at, now())`. Parents can reach the column through
--    the column-unrestricted 'children: own children' UPDATE policy and
--    the app-layer omission (childToRow) is not a guard, so — matching the
--    repo's children-guard precedent (20260714160000, the applicant-state
--    sync stack) — `children_arrived_at_guard` below RAISES (errcode
--    P0122, message 'funnel_arrived_at_guard') on any non-service_role
--    change to the column. A hand-crafted parent write is now rejected at
--    the DB, not merely unserialized by the client.
--
-- Idempotent from either state THIS FILE produces; the backfill re-applies
-- as a no-op (guarded on `arrived_at is null`). Additive-only. Order
-- matters within the file: the backfill UPDATE precedes the guard, so a
-- first run backfills unimpeded; on re-runs the guard already exists, but
-- the backfill only touches rows that are still NULL with a pre-existing
-- relic — none after the driver stamp path is live — and a 0-row UPDATE
-- never fires a FOR EACH ROW trigger.

alter table public.children
  add column if not exists arrived_at timestamptz;

-- Backfill: a child has EVER completed arrival iff its provisioning claim
-- ever landed `complete`. No claim-state history table exists, but two
-- durable relics of that landing survive every later transition:
--
--  1. `funnel_student_provisioning.mailbox_ready_at` — PRIMARY source.
--     Written exactly once, inside the landing that sets state='complete'
--     (`mailboxReady: true` in provision-core's final land), and never
--     cleared afterwards: `deposit_refund_release` and the lifecycle
--     sweep touch state/lease/reason columns only. A suspended or
--     released claim that once completed still carries the stamp.
--  2. `funnel_events` `student_account_created` rows — emitted awaited in
--     the same landing but BEST-EFFORT (failures swallowed), so unioned
--     in as belt-and-braces, never trusted alone.
--
-- `state = 'complete'` is also included defensively (with `updated_at` as
-- the stamp) for the should-be-impossible row that is complete without
-- `mailbox_ready_at`. Earliest relic wins per child.
update public.children c
set arrived_at = f.first_at
from (
  select s.child_id, min(s.arrived) as first_at
  from (
    select p.child_id, coalesce(p.mailbox_ready_at, p.updated_at) as arrived
    from public.funnel_student_provisioning p
    where p.child_id is not null
      and (p.mailbox_ready_at is not null or p.state = 'complete')
    union all
    select e.child_id, e.created_at as arrived
    from public.funnel_events e
    where e.name = 'student_account_created'
      and e.child_id is not null
  ) s
  group by s.child_id
) f
where c.id = f.child_id
  and c.arrived_at is null;

-- ------------------------------------------- arrived_at guard: raise
-- Precedent: 20260714160000_children_guard_hardening.sql (children guards)
-- and the funnel raise contract (P0120 edit horizon, P0121 door conflict).
-- Unlike children_status_guard this RAISES rather than coerces: no
-- legitimate client write carries this column (childToRow omits it), so
-- there is no innocent stale-echo case to preserve — any non-service
-- change is tampering. The single writer (provision-driver's
-- stampArrivedAt via supabaseAdmin = service_role) is exempt.
create or replace function public.children_arrived_at_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if NEW.arrived_at is distinct from OLD.arrived_at then
    raise exception 'funnel_arrived_at_guard'
      using errcode = 'P0122',
            detail = 'arrived_at is stamped once by the provisioning landing (service role) and is never client-writable',
            hint = 'the arrival fact is server-owned; it cannot be set, moved, or cleared from a session';
  end if;
  return NEW;
end;
$$;

drop trigger if exists children_arrived_at_guard on public.children;
create trigger children_arrived_at_guard
  before update of arrived_at on public.children
  for each row execute function public.children_arrived_at_guard();
