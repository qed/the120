-- PROVISIONAL / NOT APPLIED — First Profit Round One billing foundation.
--
-- The repository checkout used to author this file has no live Supabase
-- credential, and this work must not deploy. Before merge or application,
-- query `supabase_migrations.schema_migrations`, rename this file to the true
-- next free version if necessary, and only then apply it. All DDL below is
-- additive and idempotent.
--
-- This is deliberately NOT an extension of `deposits`. A $250 Round One
-- purchase buys one child's access to First Profit's Sell phase. It is a
-- non-refundable CAD $250 Round One course fee rather than The 120's
-- refundable seat reservation; it consumes no seat, provisions no school
-- account, and carries none of the deposit lifecycle's admissions semantics.

-- ───────────────────────────────────────────────────────── product catalog

create table if not exists public.fp_billing_products (
  product_key text not null,
  version integer not null check (version > 0),
  display_name text not null,
  subject_type text not null check (subject_type in ('child')),
  access_code text not null,
  phase_key text not null,
  first_locked_task_id text not null,
  last_included_task_id text not null,
  amount integer not null check (amount > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  active boolean not null default true,
  -- Independent, server-owned rollout switch for the save trigger below. It
  -- starts false so applying this migration before the new client cannot strand
  -- an existing learner behind a gate the old UI cannot explain.
  completion_enforcement_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (product_key, version)
);

alter table public.fp_billing_products
  add column if not exists completion_enforcement_enabled boolean not null default false;

-- The price is deliberately versioned. A future price is a new catalog row,
-- never a mutation of the financial truth attached to historic orders.
insert into public.fp_billing_products (
  product_key,
  version,
  display_name,
  subject_type,
  access_code,
  phase_key,
  first_locked_task_id,
  last_included_task_id,
  amount,
  currency,
  active,
  completion_enforcement_enabled
)
values (
  'round_one_sell',
  1,
  'First Profit Round 1 — Sell',
  'child',
  'phase:sell',
  'sell',
  '1.1.2',
  '1.5.5',
  25000,
  'cad',
  true,
  false
)
on conflict (product_key, version) do nothing;

-- A composite key lets orders/entitlements make "this parent owns this child"
-- a database invariant rather than a route convention.
create unique index if not exists children_id_parent_id_uq
  on public.children (id, parent_id);

-- ─────────────────────────────────────────────────────────────────── orders

create table if not exists public.fp_billing_orders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  child_id uuid not null,
  product_key text not null,
  product_version integer not null,
  amount integer not null check (amount > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  status text not null check (
    status in ('pending', 'paid', 'cancelled', 'failed', 'refunded', 'comped', 'grandfathered')
  ),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_session_expires_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  grant_note text,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fp_billing_orders_owned_child_fk
    foreign key (child_id, parent_id)
    references public.children (id, parent_id)
    on delete cascade,
  constraint fp_billing_orders_product_fk
    foreign key (product_key, product_version)
    references public.fp_billing_products (product_key, version)
    on delete restrict,
  constraint fp_billing_orders_paid_shape check (
    (status = 'paid' and paid_at is not null)
    or status <> 'paid'
  ),
  constraint fp_billing_orders_refunded_shape check (
    (status = 'refunded' and refunded_at is not null)
    or status <> 'refunded'
  ),
  constraint fp_billing_orders_nonpayment_shape check (
    (status in ('comped', 'grandfathered') and stripe_checkout_session_id is null)
    or status not in ('comped', 'grandfathered')
  )
);

create index if not exists fp_billing_orders_parent_idx
  on public.fp_billing_orders (parent_id, created_at desc);
create index if not exists fp_billing_orders_child_idx
  on public.fp_billing_orders (child_id, product_key, product_version, created_at desc);

-- At most one payable session may be open for one child's one product version.
-- Multiple historical paid/refunded/cancelled rows remain valid audit truth.
create unique index if not exists fp_billing_orders_one_pending_uq
  on public.fp_billing_orders (child_id, product_key, product_version)
  where status = 'pending';

-- ───────────────────────────────────────────────────────────── entitlements

create table if not exists public.fp_billing_entitlements (
  parent_id uuid not null references public.parents (id) on delete cascade,
  child_id uuid not null,
  product_key text not null,
  product_version integer not null,
  access_code text not null,
  status text not null check (status in ('active', 'revoked')),
  grant_kind text not null check (grant_kind in ('paid', 'comped', 'grandfathered')),
  source_order_id uuid references public.fp_billing_orders (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (child_id, product_key, product_version),
  constraint fp_billing_entitlements_owned_child_fk
    foreign key (child_id, parent_id)
    references public.children (id, parent_id)
    on delete cascade,
  constraint fp_billing_entitlements_product_fk
    foreign key (product_key, product_version)
    references public.fp_billing_products (product_key, version)
    on delete restrict,
  constraint fp_billing_entitlements_revoked_shape check (
    (status = 'revoked' and revoked_at is not null)
    or (status = 'active' and revoked_at is null)
  )
);

create index if not exists fp_billing_entitlements_parent_idx
  on public.fp_billing_entitlements (parent_id, status);

-- Only non-sensitive processing facts are retained. The full Stripe payload
-- remains in Stripe and is not copied into the child/family database. Family
-- erasure cascades the order itself; SET NULL deliberately leaves this
-- de-identified processor-event ledger (event id/type/outcome, no family id)
-- for webhook replay protection and operational reconciliation.
create table if not exists public.fp_billing_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  order_id uuid references public.fp_billing_orders (id) on delete set null,
  outcome text not null,
  processed_at timestamptz not null default now()
);

-- Durable parent communications for the two Round One setup moments. The
-- financial/curriculum transition and its notification row commit together;
-- provider delivery is a separate claim/retry concern. Names and the verified
-- parent address are snapshotted so a retry renders the same message, while
-- the owned-child FK makes family erasure remove the PII automatically.
create table if not exists public.fp_parent_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  kind text not null check (kind in ('round_one_stripe_setup', 'offer_price_ready')),
  parent_id uuid not null references public.parents (id) on delete cascade,
  child_id uuid not null,
  product_key text not null,
  product_version integer not null,
  source_order_id uuid references public.fp_billing_orders (id) on delete cascade,
  recipient_email text not null check (
    nullif(btrim(recipient_email), '') is not null
    and position(chr(10) in recipient_email) = 0
    and position(chr(13) in recipient_email) = 0
  ),
  parent_first_name text,
  child_first_name text,
  params jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  claimed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fp_parent_notification_outbox_owned_child_fk
    foreign key (child_id, parent_id)
    references public.children (id, parent_id)
    on delete cascade,
  constraint fp_parent_notification_outbox_product_fk
    foreign key (product_key, product_version)
    references public.fp_billing_products (product_key, version)
    on delete restrict,
  constraint fp_parent_notification_outbox_source_shape check (
    (kind = 'round_one_stripe_setup' and source_order_id is not null)
    or (kind = 'offer_price_ready' and source_order_id is null)
  )
);

create index if not exists fp_parent_notification_outbox_pending_idx
  on public.fp_parent_notification_outbox (created_at)
  where sent_at is null;

-- Append-only audit truth for staff-issued complimentary access. The request
-- id is supplied by the admin client and makes a retried click idempotent.
create table if not exists public.fp_billing_access_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  parent_id uuid not null references public.parents (id) on delete cascade,
  child_id uuid not null,
  product_key text not null,
  product_version integer not null,
  action text not null check (action in ('comped', 'grandfathered', 'revoke')),
  outcome text not null,
  source_order_id uuid references public.fp_billing_orders (id) on delete set null,
  actor_id uuid not null references public.staff (id) on delete restrict,
  note text not null check (char_length(trim(note)) between 3 and 1000),
  created_at timestamptz not null default now(),
  constraint fp_billing_access_events_owned_child_fk
    foreign key (child_id, parent_id)
    references public.children (id, parent_id)
    on delete cascade,
  constraint fp_billing_access_events_product_fk
    foreign key (product_key, product_version)
    references public.fp_billing_products (product_key, version)
    on delete restrict
);

create index if not exists fp_billing_access_events_child_idx
  on public.fp_billing_access_events (child_id, created_at desc);

-- ───────────────────────────────────────────────────────────────────── RLS

alter table public.fp_billing_products enable row level security;
alter table public.fp_billing_orders enable row level security;
alter table public.fp_billing_entitlements enable row level security;
alter table public.fp_billing_webhook_events enable row level security;
alter table public.fp_parent_notification_outbox enable row level security;
alter table public.fp_billing_access_events enable row level security;

-- Browser clients never read or write order, entitlement, webhook, or access-
-- event truth directly. The authenticated API is the only billing read seam;
-- this keeps processor identifiers and internal staff notes out of PostgREST.
-- The non-sensitive active catalog remains readable to authenticated clients.
drop policy if exists "fp billing products: authenticated read" on public.fp_billing_products;
create policy "fp billing products: authenticated read"
  on public.fp_billing_products for select to authenticated
  using (active = true);

drop policy if exists "fp billing orders: read own" on public.fp_billing_orders;
drop policy if exists "fp billing entitlements: read own" on public.fp_billing_entitlements;

revoke all on public.fp_billing_products from anon, authenticated;
revoke all on public.fp_billing_orders from anon, authenticated;
revoke all on public.fp_billing_entitlements from anon, authenticated;
revoke all on public.fp_billing_webhook_events from anon, authenticated;
revoke all on public.fp_parent_notification_outbox from anon, authenticated;
revoke all on public.fp_billing_access_events from anon, authenticated;
grant select on public.fp_billing_products to authenticated;

-- ─────────────────────────────────────────── server-owned completion guard

-- Return the distinct Round One task ids completed anywhere in the save. The
-- access purchase is child-wide, not idea-wide, so task ids are deliberately
-- compared as a set across ideas. That also avoids treating a legacy idea id
-- normalization or reorder as a new paid completion.
create or replace function public.fp_round_one_completed_task_ids(p_doc jsonb)
returns table (task_id text)
language sql
immutable
set search_path = public, pg_temp
as $$
  with ideas as (
    select value as idea
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_doc -> 'ideas') = 'array' then p_doc -> 'ideas'
        else '[]'::jsonb
      end
    )
  ), stable as (
    select entry.key as task_id
    from ideas
    cross join lateral jsonb_each(
      case
        when jsonb_typeof(idea -> 'doneByTask') = 'object' then idea -> 'doneByTask'
        else '{}'::jsonb
      end
    ) as entry(key, value)
    where entry.value = 'true'::jsonb
      and entry.key ~ '^1[.][1-5][.][1-5]$'
  ), legacy as (
    select split_part(entry.key, '#', 1) || '.'
      || ((split_part(entry.key, '#', 2)::integer) + 1)::text as task_id
    from ideas
    cross join lateral jsonb_each(
      case
        when jsonb_typeof(idea -> 'done') = 'object' then idea -> 'done'
        else '{}'::jsonb
      end
    ) as entry(key, value)
    where entry.value = 'true'::jsonb
      and entry.key ~ '^1[.][1-5]#[0-4]$'
  )
  select task_id from stable
  union
  select task_id from legacy;
$$;

-- The exact persisted milestone that makes a real parent checkout actionable.
-- It mirrors First Profit's active-Idea Price Picker contract and intentionally
-- rejects malformed JSON/numbers instead of guessing. This is used by both the
-- notification trigger and the server-side activation boundary.
create or replace function public.fp_round_one_price_picker_ready(p_doc jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with active as (
    select (p_doc ->> 'activeIdea')::integer as idea_index
    where p_doc ->> 'docVersion' = '1'
      and jsonb_typeof(p_doc -> 'ideas') = 'array'
      and coalesce(p_doc ->> 'activeIdea', '') ~ '^\d{1,3}$'
  ), idea as (
    select p_doc -> 'ideas' -> active.idea_index as value
    from active
    where active.idea_index >= 0
      and active.idea_index < jsonb_array_length(p_doc -> 'ideas')
  ), fields as (
    select value -> 'fields' as value,
           value -> 'doneByTask' as stable_done,
           value -> 'done' as legacy_done
    from idea
    where jsonb_typeof(value) = 'object'
      and jsonb_typeof(value -> 'fields') = 'object'
  ), raw_price as (
    select btrim(value ->> 'pricePickerPrice') as amount,
           value,
           stable_done,
           legacy_done
    from fields
  ), price as (
    select case when amount ~ '^\d{1,7}([.]\d{1,2})?$' then amount::numeric end as amount,
           value,
           stable_done,
           legacy_done
    from raw_price
  )
  select coalesce(bool_or(
    (
      coalesce(stable_done -> '1.1.1', 'false'::jsonb) = 'true'::jsonb
      or coalesce(legacy_done -> '1.1#0', 'false'::jsonb) = 'true'::jsonb
    )
    and (
      coalesce(stable_done -> '1.2.1', 'false'::jsonb) = 'true'::jsonb
      or coalesce(legacy_done -> '1.2#0', 'false'::jsonb) = 'true'::jsonb
    )
    and value ->> 'pricePickerConfirmed' = 'true'
    and amount > 0
    and amount <= 1000000
  ), false)
  from price;
$$;

-- Every save that is already ready tries the same INSERT. The unique semantic
-- key turns repeat autosaves into no-ops, while including the current parent in
-- the key lets a later legitimate family transfer notify the new grown-up on
-- the next save without disclosing the former parent's queued message.
create or replace function public.fp_round_one_offer_ready_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.fp_round_one_price_picker_ready(NEW.doc) then
    insert into public.fp_parent_notification_outbox (
      dedupe_key, kind, parent_id, child_id, product_key, product_version,
      recipient_email, parent_first_name, child_first_name, params
    )
    select
      concat('fp-offer-price-ready:', c.id::text, ':v', e.product_version::text,
             ':parent:', c.parent_id::text),
      'offer_price_ready',
      c.parent_id,
      c.id,
      e.product_key,
      e.product_version,
      btrim(parent.email),
      parent.first_name,
      c.first_name,
      jsonb_build_object('taskId', '1.2.1')
    from public.fp_player_profiles profile
    join public.children c on c.id = profile.child_id
    join public.parents parent on parent.id = c.parent_id
    join public.fp_billing_entitlements e
      on e.child_id = c.id
     and e.parent_id = c.parent_id
     and e.product_key = 'round_one_sell'
     and e.access_code = 'phase:sell'
     and e.status = 'active'
    where profile.id = NEW.profile_id
      and nullif(btrim(coalesce(parent.email, '')), '') is not null
      and position(chr(10) in parent.email) = 0
      and position(chr(13) in parent.email) = 0
    on conflict (dedupe_key) do nothing;
  end if;
  return NEW;
end;
$$;

drop trigger if exists fp_round_one_offer_ready_notification on public.fp_player_saves;
create trigger fp_round_one_offer_ready_notification
  after insert or update of doc on public.fp_player_saves
  for each row execute function public.fp_round_one_offer_ready_notification();

-- The SPA gate is an experience, not an authority. A child session can update
-- fp_player_saves directly, so reject only NEW paid-task completions unless a
-- durable active Sell entitlement exists. Existing pre-rollout completions and
-- every non-completion edit continue to save normally; task 1.1.1 stays free.
create or replace function public.fp_round_one_completion_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.fp_billing_products product
    where product.product_key = 'round_one_sell'
      and product.access_code = 'phase:sell'
      and product.completion_enforcement_enabled = true
  ) and exists (
    (select n.task_id
     from public.fp_round_one_completed_task_ids(NEW.doc) n
     where n.task_id <> '1.1.1')
    except
    (select o.task_id
     from public.fp_round_one_completed_task_ids(OLD.doc) o
     where o.task_id <> '1.1.1')
  ) then
    -- This is a cross-table authorization read. Lock the entitlement row so a
    -- concurrent refund/revoke cannot race the save through on stale access.
    perform 1
    from public.fp_player_profiles p
    join public.fp_billing_entitlements e on e.child_id = p.child_id
    where p.id = NEW.profile_id
      and e.product_key = 'round_one_sell'
      and e.access_code = 'phase:sell'
      and e.status = 'active'
    for share of e;
    if not found then
      raise exception 'Round One access is required to complete this task'
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$$;

-- Trigger names execute alphabetically for the same event/timing. This sorts
-- after fp_player_saves_doc_guard, so it evaluates the union-repaired document,
-- and before the write reaches storage regardless of the caller's JWT role.
drop trigger if exists fp_round_one_completion_guard on public.fp_player_saves;
create trigger fp_round_one_completion_guard
  before update on public.fp_player_saves
  for each row execute function public.fp_round_one_completion_guard();

-- ─────────────────────────────────────────────────── atomic checkout begin

create or replace function public.fp_billing_begin_order(
  p_parent_id uuid,
  p_child_id uuid,
  p_product_key text,
  p_product_version integer
)
returns table (
  outcome text,
  order_id uuid,
  stripe_session_id text,
  stripe_session_expires_at timestamptz,
  grant_kind text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.fp_billing_products%rowtype;
  v_order public.fp_billing_orders%rowtype;
  v_entitlement public.fp_billing_entitlements%rowtype;
begin
  select * into v_product
  from public.fp_billing_products p
  where p.product_key = p_product_key
    and p.version = p_product_version
    and p.active = true;
  if not found then
    return query select 'product_unavailable', null::uuid, null::text, null::timestamptz, null::text;
    return;
  end if;

  if not exists (
    select 1 from public.children c
    where c.id = p_child_id and c.parent_id = p_parent_id
  ) then
    return query select 'not_owned', null::uuid, null::text, null::timestamptz, null::text;
    return;
  end if;

  select * into v_entitlement
  from public.fp_billing_entitlements e
  where e.child_id = p_child_id
    and e.product_key = p_product_key
    and e.product_version = p_product_version
    and e.status = 'active'
  for update;
  if found then
    return query
      select 'already_entitled', v_entitlement.source_order_id, null::text, null::timestamptz, v_entitlement.grant_kind;
    return;
  end if;

  -- Heal a missed `checkout.session.expired` delivery before looking for the
  -- one permitted pending row. A session-less row gets one hour for the route
  -- to finish attaching Stripe's session before it is considered abandoned.
  update public.fp_billing_orders o
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where o.child_id = p_child_id
    and o.product_key = p_product_key
    and o.product_version = p_product_version
    and o.status = 'pending'
    and (
      (o.stripe_session_expires_at is not null and o.stripe_session_expires_at <= now())
      or (o.stripe_checkout_session_id is null and o.created_at <= now() - interval '1 hour')
    );

  select * into v_order
  from public.fp_billing_orders o
  where o.child_id = p_child_id
    and o.product_key = p_product_key
    and o.product_version = p_product_version
    and o.status = 'pending'
  order by o.created_at desc
  limit 1
  for update;

  if not found then
    begin
      insert into public.fp_billing_orders (
        parent_id, child_id, product_key, product_version, amount, currency, status
      ) values (
        p_parent_id, p_child_id, p_product_key, p_product_version,
        v_product.amount, v_product.currency, 'pending'
      )
      returning * into v_order;
    exception when unique_violation then
      -- Two tabs can reach the insert together. The partial unique index is
      -- the arbiter; the loser converges on the winner's pending order.
      select * into v_order
      from public.fp_billing_orders o
      where o.child_id = p_child_id
        and o.product_key = p_product_key
        and o.product_version = p_product_version
        and o.status = 'pending'
      order by o.created_at desc
      limit 1;
    end;
  end if;

  return query
    select 'checkout', v_order.id, v_order.stripe_checkout_session_id,
      v_order.stripe_session_expires_at, null::text;
end;
$$;

create or replace function public.fp_billing_attach_checkout(
  p_order_id uuid,
  p_stripe_session_id text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.fp_billing_orders o
  set stripe_checkout_session_id = p_stripe_session_id,
      stripe_session_expires_at = p_expires_at,
      updated_at = now()
  where o.id = p_order_id
    and o.status = 'pending'
    and (o.stripe_checkout_session_id is null or o.stripe_checkout_session_id = p_stripe_session_id);
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- Fill-only support contact capture from a signature-verified Stripe Checkout
-- Session. This function never replaces a number already supplied by the
-- parent and accepts only a bounded international E.164-style value.
create or replace function public.fp_billing_fill_parent_phone(
  p_parent_id uuid,
  p_phone text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := trim(coalesce(p_phone, ''));
  v_final text;
begin
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return false;
  end if;

  update public.parents p
  set phone = v_phone
  where p.id = p_parent_id
    and trim(coalesce(p.phone, '')) = '';

  select trim(coalesce(p.phone, '')) into v_final
  from public.parents p
  where p.id = p_parent_id;

  return found and v_final <> '';
end;
$$;

-- ───────────────────────────────────────────── signature-gated event effect

create or replace function public.fp_billing_apply_stripe_event(
  p_event_id text,
  p_event_type text,
  p_effect text,
  p_order_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_parent_id uuid,
  p_child_id uuid,
  p_product_key text,
  p_product_version integer,
  p_amount integer,
  p_currency text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.fp_billing_orders%rowtype;
  v_product public.fp_billing_products%rowtype;
  v_entitlement public.fp_billing_entitlements%rowtype;
  v_outcome text;
  v_replacement_order_id uuid;
begin
  -- Serialize duplicate deliveries before checking the durable event ledger.
  perform pg_advisory_xact_lock(hashtextextended(p_event_id, 0));
  if exists (
    select 1 from public.fp_billing_webhook_events w
    where w.stripe_event_id = p_event_id
  ) then
    return 'replay';
  end if;

  -- Different Stripe event ids for the same child/product can arrive together
  -- (notably two full refunds after a duplicate payment). Serialize that state
  -- machine too, so each event sees the prior event's committed order truth.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(':', p_child_id::text, p_product_key, p_product_version::text),
      1
    )
  );

  select * into v_order
  from public.fp_billing_orders o
  where (p_order_id is not null and o.id = p_order_id)
     or (p_order_id is null and p_payment_intent_id is not null
         and o.stripe_payment_intent_id = p_payment_intent_id)
  order by case when o.id = p_order_id then 0 else 1 end
  limit 1
  for update;
  if not found then return 'order_missing'; end if;

  -- Metadata names identity but does not create it: every value must agree
  -- with the pre-payment order that the authenticated parent created.
  if v_order.parent_id <> p_parent_id
     or v_order.child_id <> p_child_id
     or v_order.product_key <> p_product_key
     or v_order.product_version <> p_product_version then
    return 'metadata_mismatch';
  end if;

  -- Once Stripe object ids are attached to the order they are immutable
  -- identity, not advisory metadata. A later signed event carrying copied order
  -- metadata must not be allowed to substitute a different Session or Intent.
  if (p_session_id is not null
      and v_order.stripe_checkout_session_id is not null
      and v_order.stripe_checkout_session_id <> p_session_id)
     or (p_payment_intent_id is not null
      and v_order.stripe_payment_intent_id is not null
      and v_order.stripe_payment_intent_id <> p_payment_intent_id) then
    return 'processor_identity_mismatch';
  end if;

  select * into v_product
  from public.fp_billing_products p
  where p.product_key = v_order.product_key and p.version = v_order.product_version;
  if not found then return 'product_missing'; end if;

  if p_effect in ('pending', 'paid') then
    if p_amount is null or p_amount <> v_order.amount or p_amount <> v_product.amount
       or lower(coalesce(p_currency, '')) <> v_order.currency
       or lower(coalesce(p_currency, '')) <> v_product.currency then
      -- Do not record this event: a corrected deployment should be able to
      -- accept Stripe's retry. Most importantly, no mismatched payment grants
      -- access merely because the client reached a success URL.
      return 'amount_mismatch';
    end if;
  end if;

  if p_effect = 'pending' then
    if v_order.status = 'pending' then
      update public.fp_billing_orders
      set stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id),
          stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
          updated_at = now()
      where id = v_order.id;
    end if;
    v_outcome := 'pending';

  elsif p_effect = 'paid' then
    if v_order.status = 'refunded' or v_order.refunded_at is not null then
      v_outcome := 'refund_stands';
    else
      update public.fp_billing_orders
      set status = 'paid',
          stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id),
          stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
          paid_at = coalesce(paid_at, now()),
          cancelled_at = null,
          failed_at = null,
          updated_at = now()
      where id = v_order.id;

      select * into v_entitlement
      from public.fp_billing_entitlements e
      where e.child_id = v_order.child_id
        and e.product_key = v_order.product_key
        and e.product_version = v_order.product_version
      for update;

      if found and v_entitlement.status = 'active'
         and v_entitlement.grant_kind = 'paid'
         and v_entitlement.source_order_id is distinct from v_order.id then
        -- The charge is real, but access was already granted by another paid
        -- order. Keep the existing entitlement and make the double payment an
        -- explicit operational outcome. Complimentary/grandfathered access is
        -- deliberately upgraded to paid in the normal upsert below: otherwise
        -- a later staff revoke could erase access after a real payment.
        v_outcome := 'duplicate_paid';
      else
        insert into public.fp_billing_entitlements (
          parent_id, child_id, product_key, product_version, access_code,
          status, grant_kind, source_order_id, granted_at, revoked_at, updated_at
        ) values (
          v_order.parent_id, v_order.child_id, v_order.product_key,
          v_order.product_version, v_product.access_code,
          'active', 'paid', v_order.id, now(), null, now()
        )
        on conflict (child_id, product_key, product_version) do update
        set parent_id = excluded.parent_id,
            access_code = excluded.access_code,
            status = 'active',
            grant_kind = 'paid',
            source_order_id = excluded.source_order_id,
            granted_at = now(),
            revoked_at = null,
            updated_at = now();
        v_outcome := 'granted';
      end if;
    end if;

  elsif p_effect = 'cancelled' then
    if v_order.status = 'pending' then
      update public.fp_billing_orders
      set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = v_order.id;
      v_outcome := 'cancelled';
    else
      v_outcome := 'terminal_stands';
    end if;

  elsif p_effect = 'failed' then
    if v_order.status = 'pending' then
      update public.fp_billing_orders
      set status = 'failed', failed_at = now(), updated_at = now()
      where id = v_order.id;
      v_outcome := 'failed';
    else
      v_outcome := 'terminal_stands';
    end if;

  elsif p_effect = 'refunded' then
    -- Full refunds only reach this branch; the route keeps partial refunds out.
    if v_order.status <> 'refunded' then
      update public.fp_billing_orders
      set status = 'refunded', refunded_at = now(), updated_at = now()
      where id = v_order.id;
    end if;
    -- A rare duplicate payment may already exist. Refunds revoke access only
    -- when this was the last paid order; otherwise re-anchor the entitlement to
    -- a still-paid order so refund order does not decide access accidentally.
    select o.id into v_replacement_order_id
    from public.fp_billing_orders o
    where o.child_id = v_order.child_id
      and o.product_key = v_order.product_key
      and o.product_version = v_order.product_version
      and o.status = 'paid'
      and o.id <> v_order.id
    order by o.paid_at desc nulls last, o.created_at desc
    limit 1;

    if v_replacement_order_id is not null then
      update public.fp_billing_entitlements e
      set source_order_id = v_replacement_order_id, updated_at = now()
      where e.child_id = v_order.child_id
        and e.product_key = v_order.product_key
        and e.product_version = v_order.product_version
        and e.status = 'active'
        and e.grant_kind = 'paid'
        and e.source_order_id = v_order.id;
    else
      update public.fp_billing_entitlements e
      set status = 'revoked', revoked_at = now(), updated_at = now()
      where e.child_id = v_order.child_id
        and e.product_key = v_order.product_key
        and e.product_version = v_order.product_version
        and e.status = 'active'
        and e.grant_kind = 'paid'
        and e.source_order_id = v_order.id;
    end if;
    v_outcome := 'refunded';
  else
    return 'unsupported_effect';
  end if;

  -- The email provider is deliberately outside this financial transaction,
  -- but its durable intent is not. Once paid access is granted, commit exactly
  -- one parent setup row with the same transaction. The webhook may drain it
  -- immediately; the notification cron safely retries anything still pending.
  if v_outcome = 'granted' and v_order.status is distinct from 'refunded' then
    insert into public.fp_parent_notification_outbox (
      dedupe_key, kind, parent_id, child_id, product_key, product_version,
      source_order_id, recipient_email, parent_first_name, child_first_name,
      params
    )
    select
      concat('fp-round-one-stripe-setup:', v_order.id::text),
      'round_one_stripe_setup',
      v_order.parent_id,
      v_order.child_id,
      v_order.product_key,
      v_order.product_version,
      v_order.id,
      btrim(parent.email),
      parent.first_name,
      child.first_name,
      '{}'::jsonb
    from public.parents parent
    join public.children child
      on child.id = v_order.child_id and child.parent_id = v_order.parent_id
    where parent.id = v_order.parent_id
      and nullif(btrim(coalesce(parent.email, '')), '') is not null
      and position(chr(10) in parent.email) = 0
      and position(chr(13) in parent.email) = 0
    on conflict (dedupe_key) do nothing;
  end if;

  insert into public.fp_billing_webhook_events (
    stripe_event_id, event_type, order_id, outcome
  ) values (p_event_id, p_event_type, v_order.id, v_outcome);
  return v_outcome;
end;
$$;

-- Staff/ops seam for the explicitly supported non-payment states. The API in
-- front of this service-role-only primitive requires BOTH the admin JWT claim
-- and a live active staff row. Paid access cannot be manually revoked here;
-- the signature-verified refund branch remains the sole authority for that.
create or replace function public.fp_billing_set_round_one_access(
  p_child_id uuid,
  p_action text,
  p_note text,
  p_actor uuid,
  p_request_id uuid
)
returns table (outcome text, order_id uuid, parent_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.fp_billing_products%rowtype;
  v_entitlement public.fp_billing_entitlements%rowtype;
  v_parent_id uuid;
  v_order_id uuid;
  v_outcome text;
  v_prior public.fp_billing_access_events%rowtype;
begin
  if p_action not in ('comped', 'grandfathered', 'revoke') then
    raise exception 'unsupported Round One access action';
  end if;
  if char_length(trim(coalesce(p_note, ''))) not between 3 and 1000 then
    raise exception 'an audit note between 3 and 1000 characters is required';
  end if;
  if not exists (
    select 1 from public.staff s
    where s.id = p_actor and s.is_active = true and s.role = 'admin'
  ) then
    raise exception 'active admin staff actor required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_prior
  from public.fp_billing_access_events e
  where e.request_id = p_request_id;
  if found then
    if v_prior.child_id <> p_child_id
       or v_prior.action <> p_action
       or v_prior.actor_id <> p_actor
       or v_prior.note <> trim(p_note) then
      raise exception 'Round One request id reused with different payload';
    end if;
    return query select v_prior.outcome, v_prior.source_order_id, v_prior.parent_id;
    return;
  end if;

  select c.parent_id into v_parent_id
  from public.children c
  where c.id = p_child_id;
  if not found then raise exception 'child not found'; end if;

  select * into strict v_product
  from public.fp_billing_products p
  where p.product_key = 'round_one_sell' and p.version = 1 and p.active = true;

  -- Use the exact same child/product state-machine lock as the signed Stripe
  -- webhook. Without it, a complimentary grant that observed no entitlement
  -- could race a real payment and let its ON CONFLICT update downgrade the
  -- newly paid entitlement back to comped/grandfathered. Under this lock either
  -- the grant lands first and the payment upgrades it, or the payment lands
  -- first and the staff action returns paid_stands.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(':', p_child_id::text, v_product.product_key, v_product.version::text),
      1
    )
  );

  select * into v_entitlement
  from public.fp_billing_entitlements e
  where e.child_id = p_child_id
    and e.product_key = v_product.product_key
    and e.product_version = v_product.version
  for update;

  if p_action in ('comped', 'grandfathered') then
    if found and v_entitlement.status = 'active' and v_entitlement.grant_kind = 'paid' then
      v_outcome := 'paid_stands';
      v_order_id := v_entitlement.source_order_id;
    elsif found and v_entitlement.status = 'active' and v_entitlement.grant_kind = p_action then
      v_outcome := 'already_active';
      v_order_id := v_entitlement.source_order_id;
    else
      insert into public.fp_billing_orders (
        parent_id, child_id, product_key, product_version, amount, currency,
        status, grant_note, granted_by
      ) values (
        v_parent_id, p_child_id, v_product.product_key, v_product.version,
        v_product.amount, v_product.currency, p_action, trim(p_note), p_actor
      ) returning id into v_order_id;

      insert into public.fp_billing_entitlements (
        parent_id, child_id, product_key, product_version, access_code,
        status, grant_kind, source_order_id, granted_at, revoked_at, updated_at
      ) values (
        v_parent_id, p_child_id, v_product.product_key, v_product.version,
        v_product.access_code, 'active', p_action, v_order_id, now(), null, now()
      )
      on conflict (child_id, product_key, product_version) do update
      set parent_id = excluded.parent_id,
          access_code = excluded.access_code,
          status = 'active',
          grant_kind = excluded.grant_kind,
          source_order_id = excluded.source_order_id,
          granted_at = now(),
          revoked_at = null,
          updated_at = now();
      v_outcome := 'granted';
    end if;
  else
    if not found or v_entitlement.status = 'revoked' then
      v_outcome := 'already_revoked';
      v_order_id := v_entitlement.source_order_id;
    elsif v_entitlement.grant_kind = 'paid' then
      v_outcome := 'paid_requires_refund';
      v_order_id := v_entitlement.source_order_id;
    else
      update public.fp_billing_entitlements e
      set status = 'revoked', revoked_at = now(), updated_at = now()
      where e.child_id = p_child_id
        and e.product_key = v_product.product_key
        and e.product_version = v_product.version;
      v_outcome := 'revoked';
      v_order_id := v_entitlement.source_order_id;
    end if;
  end if;

  insert into public.fp_billing_access_events (
    request_id, parent_id, child_id, product_key, product_version,
    action, outcome, source_order_id, actor_id, note
  ) values (
    p_request_id, v_parent_id, p_child_id, v_product.product_key,
    v_product.version, p_action, v_outcome, v_order_id, p_actor, trim(p_note)
  );

  return query select v_outcome, v_order_id, v_parent_id;
end;
$$;

revoke all on function public.fp_billing_begin_order(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.fp_billing_attach_checkout(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.fp_billing_fill_parent_phone(uuid, text)
  from public, anon, authenticated;
revoke all on function public.fp_billing_apply_stripe_event(
  text, text, text, uuid, text, text, uuid, uuid, text, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.fp_billing_set_round_one_access(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fp_round_one_completed_task_ids(jsonb)
  from public, anon, authenticated;
revoke all on function public.fp_round_one_completion_guard()
  from public, anon, authenticated;

grant execute on function public.fp_billing_begin_order(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.fp_billing_attach_checkout(uuid, text, timestamptz)
  to service_role;
grant execute on function public.fp_billing_fill_parent_phone(uuid, text)
  to service_role;
grant execute on function public.fp_billing_apply_stripe_event(
  text, text, text, uuid, text, text, uuid, uuid, text, integer, integer, text
) to service_role;
grant execute on function public.fp_billing_set_round_one_access(uuid, text, text, uuid, uuid)
  to service_role;
