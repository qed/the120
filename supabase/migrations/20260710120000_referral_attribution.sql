-- Attribution for the GTM ambassador system (roadmap: GTM plan W1 dev ticket).
-- The app already sends these values and degrades gracefully until this runs:
-- attribution is captured in auth.users.raw_user_meta_data either way.
-- Apply with: supabase db push

alter table public.parents
  add column if not exists heard_about text not null default '',
  add column if not exists referral_code text not null default '';

-- Ambassador reporting: count signups per code quickly.
create index if not exists parents_referral_code_idx
  on public.parents (upper(referral_code))
  where referral_code <> '';
