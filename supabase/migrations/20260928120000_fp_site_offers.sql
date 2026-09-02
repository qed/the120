-- PROVISIONAL / UNAPPLIED: First Profit controlled storefront templates and
-- one parent-approved Stripe Payment Link offer per learner page.
--
-- The filename assumes 20260927 is the latest repo-visible slot. Re-check the
-- LIVE Supabase migration ledger and rename to the next free slot immediately
-- before applying. Never write schema_migrations by hand.
--
-- Security posture:
-- * the public page RPC never returns checkout_url;
-- * the separate handoff RPC returns it only while the page is published,
--   operator-unlocked, parent-enabled and parent-approved;
-- * fp_public_sites remains RLS-on with no direct anon/authenticated access;
-- * only one parent-reviewed offer exists per site, so backup ideas never inherit a
--   checkout link intended for Idea #1.

alter table public.fp_public_sites
  add column if not exists template_id text not null default 'product',
  add column if not exists theme_id text not null default 'sunrise',
  add column if not exists storefront_headline text,
  add column if not exists image_choice text not null default 'none',
  add column if not exists offer_name text,
  add column if not exists offer_description text,
  add column if not exists price_cents integer,
  add column if not exists currency text not null default 'CAD',
  add column if not exists cta_label text not null default 'Buy',
  add column if not exists checkout_url text,
  add column if not exists checkout_enabled boolean not null default false,
  add column if not exists offer_edited_at timestamptz,
  add column if not exists offer_edited_by uuid,
  add column if not exists checkout_approved_at timestamptz,
  add column if not exists checkout_approved_by uuid;

alter table public.fp_public_sites
  drop constraint if exists fp_public_sites_template_id_valid,
  add constraint fp_public_sites_template_id_valid
    check (template_id in ('product', 'service', 'event')),
  drop constraint if exists fp_public_sites_theme_id_valid,
  add constraint fp_public_sites_theme_id_valid
    check (theme_id in ('sunrise', 'ocean', 'garden')),
  drop constraint if exists fp_public_sites_storefront_headline_bounded,
  add constraint fp_public_sites_storefront_headline_bounded
    check (storefront_headline is null or char_length(storefront_headline) <= 120),
  drop constraint if exists fp_public_sites_image_choice_valid,
  add constraint fp_public_sites_image_choice_valid
    check (image_choice in ('none', 'cover')),
  drop constraint if exists fp_public_sites_offer_name_bounded,
  add constraint fp_public_sites_offer_name_bounded
    check (offer_name is null or char_length(offer_name) <= 80),
  drop constraint if exists fp_public_sites_offer_description_bounded,
  add constraint fp_public_sites_offer_description_bounded
    check (offer_description is null or char_length(offer_description) <= 180),
  drop constraint if exists fp_public_sites_price_valid,
  add constraint fp_public_sites_price_valid
    check (price_cents is null or price_cents between 0 and 100000000),
  drop constraint if exists fp_public_sites_currency_valid,
  add constraint fp_public_sites_currency_valid
    check (currency in ('CAD', 'USD')),
  drop constraint if exists fp_public_sites_cta_label_valid,
  add constraint fp_public_sites_cta_label_valid
    check (cta_label in ('Buy', 'Order', 'Book')),
  drop constraint if exists fp_public_sites_checkout_url_valid,
  add constraint fp_public_sites_checkout_url_valid
    check (
      checkout_url is null
      or checkout_url ~ '^https://buy[.]stripe[.]com/[A-Za-z0-9_-]+([?][^#[:cntrl:]]*)?$'
    ),
  drop constraint if exists fp_public_sites_checkout_approved_by_parent_fk,
  add constraint fp_public_sites_checkout_approved_by_parent_fk
    foreign key (checkout_approved_by) references public.parents (id) on delete restrict,
  drop constraint if exists fp_public_sites_offer_edited_by_parent_fk,
  add constraint fp_public_sites_offer_edited_by_parent_fk
    foreign key (offer_edited_by) references public.parents (id) on delete restrict,
  drop constraint if exists fp_public_sites_offer_edit_consistent,
  add constraint fp_public_sites_offer_edit_consistent check (
    (offer_edited_at is null and offer_edited_by is null)
    or (offer_edited_at is not null and offer_edited_by is not null)
  ),
  drop constraint if exists fp_public_sites_checkout_approval_consistent,
  add constraint fp_public_sites_checkout_approval_consistent check (
    (checkout_approved_at is null and checkout_approved_by is null)
    or (checkout_approved_at is not null and checkout_approved_by is not null)
  ),
  drop constraint if exists fp_public_sites_offer_owner_matches_approval,
  add constraint fp_public_sites_offer_owner_matches_approval check (
    checkout_approved_by is null or checkout_approved_by = offer_edited_by
  ),
  drop constraint if exists fp_public_sites_enabled_offer_complete,
  add constraint fp_public_sites_enabled_offer_complete check (
    not checkout_enabled
    or (
      nullif(btrim(coalesce(storefront_headline, '')), '') is not null
      and
      nullif(btrim(coalesce(offer_name, '')), '') is not null
      and price_cents is not null
      and price_cents > 0
      and checkout_url is not null
      and checkout_approved_at is not null
      and checkout_approved_by is not null
    )
  );

-- The public renderer may display the approved offer and a boolean indicating
-- whether its First Profit handoff can be shown. The destination never crosses
-- this RPC boundary.
drop function if exists public.fp_public_site(text);
create function public.fp_public_site(p_handle text)
returns table (
  state text,
  first_name text,
  headline text,
  one_liner text,
  products jsonb,
  template_id text,
  theme_id text,
  image_url text,
  offer_name text,
  offer_description text,
  price_cents integer,
  currency text,
  cta_label text,
  checkout_ready boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when s.published and not s.operator_locked then 'published' else 'offline' end,
    case when s.published and not s.operator_locked then s.first_name end,
    case when s.published and not s.operator_locked then
      case when s.checkout_approved_at is not null
                     and s.checkout_approved_by = c.parent_id
             then coalesce(nullif(btrim(s.storefront_headline), ''), s.headline)
           else s.headline end
    end,
    case when s.published and not s.operator_locked then s.one_liner end,
    case when s.published and not s.operator_locked then s.products end,
    case when s.published and not s.operator_locked then
      case when s.checkout_approved_at is not null
                     and s.checkout_approved_by = c.parent_id then s.template_id
           else 'product' end
    end,
    case when s.published and not s.operator_locked then
      case when s.checkout_approved_at is not null
                     and s.checkout_approved_by = c.parent_id then s.theme_id
           else 'sunrise' end
    end,
    case when s.published and not s.operator_locked
                   and s.checkout_approved_at is not null
                   and s.checkout_approved_by = c.parent_id
                   and s.image_choice = 'cover'
                   and c.fp_cover_data_url is not null
                   and char_length(c.fp_cover_data_url) <= 262144
                   and c.fp_cover_data_url ~ '^data:image/(svg[+]xml|png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'
         then c.fp_cover_data_url end,
    -- Offer copy is a parent draft until the CURRENT parent approves it. A
    -- family transfer therefore fails closed: the former parent's approval
    -- cannot keep storefront copy or checkout live for the new family.
    case when s.published and not s.operator_locked
                   and s.checkout_approved_at is not null
                   and s.checkout_approved_by = c.parent_id then s.offer_name end,
    case when s.published and not s.operator_locked
                   and s.checkout_approved_at is not null
                   and s.checkout_approved_by = c.parent_id then s.offer_description end,
    case when s.published and not s.operator_locked
                   and s.checkout_approved_at is not null
                   and s.checkout_approved_by = c.parent_id then s.price_cents end,
    case when s.published and not s.operator_locked
                   and s.checkout_approved_at is not null
                   and s.checkout_approved_by = c.parent_id then s.currency end,
    case when s.published and not s.operator_locked
                   and s.checkout_approved_at is not null
                   and s.checkout_approved_by = c.parent_id then s.cta_label end,
    case when s.published and not s.operator_locked then
	      (s.checkout_enabled
	       and s.checkout_url is not null
	       and s.checkout_approved_at is not null
	       and s.checkout_approved_by = c.parent_id
	       and exists (
	         select 1
	         from public.fp_billing_entitlements e
	         join public.fp_billing_products b
	           on b.product_key = e.product_key
	          and b.version = e.product_version
	         where e.child_id = c.id
	           and e.product_key = 'round_one_sell'
	           and e.access_code = 'phase:sell'
	           and e.status = 'active'
	           and b.storefront_checkout_enabled = true
	       ))
    end
  from public.fp_public_sites s
  join public.fp_player_profiles p on p.id = s.profile_id
  join public.children c on c.id = p.child_id
  where lower(btrim(coalesce(p_handle, ''))) ~ '^[a-z0-9-]{3,20}$'
    and s.handle = lower(btrim(p_handle))
    and ((s.published and not s.operator_locked) or s.first_published_at is not null);
$$;

revoke execute on function public.fp_public_site(text) from public;
grant execute on function public.fp_public_site(text) to anon, authenticated;

-- A fresh, no-cache redirect handoff calls this immediately before checkout.
-- Disabled/offline/locked/unapproved pages return zero rows, revealing no URL.
create or replace function public.fp_public_site_checkout(p_handle text)
returns table (checkout_url text)
language sql
stable
security definer
set search_path = public
as $$
  select s.checkout_url
  from public.fp_public_sites s
  join public.fp_player_profiles p on p.id = s.profile_id
  join public.children c on c.id = p.child_id
  where lower(btrim(coalesce(p_handle, ''))) ~ '^[a-z0-9-]{3,20}$'
    and s.handle = lower(btrim(p_handle))
    and s.published
    and not s.operator_locked
    and s.checkout_enabled
    and s.checkout_url is not null
    and s.checkout_approved_at is not null
    and s.checkout_approved_by = c.parent_id
    -- Re-check durable access at the click, not only when the parent enabled
    -- the draft. A full refund/revocation must close the public handoff even if
    -- checkout_enabled still reflects the older approved snapshot.
    and exists (
      select 1
      from public.fp_billing_entitlements e
      join public.fp_billing_products b
        on b.product_key = e.product_key
       and b.version = e.product_version
      where e.child_id = c.id
        and e.product_key = 'round_one_sell'
        and e.access_code = 'phase:sell'
        and e.status = 'active'
        and b.storefront_checkout_enabled = true
    );
$$;

revoke execute on function public.fp_public_site_checkout(text) from public;
grant execute on function public.fp_public_site_checkout(text) to anon, authenticated;

notify pgrst, 'reload schema';
