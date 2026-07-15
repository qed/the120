-- GTM-4 ambassador reporting: a lightweight registry of issued referral codes
-- (who owns AMB-X). Signups + deposits per code already derive from
-- families.referral_code (see computeAmbassadorReport / computeSourceTally);
-- this table only adds ownership and the "issued but not yet converting" rows,
-- so a code handed out in W2 shows on /crm/ambassadors before its first signup.
--
-- Staff-only. The CRM reads/writes through the service-role client
-- (supabaseAdmin), which bypasses RLS; RLS is enabled with NO policies so
-- anon/authenticated roles get nothing. The report degrades gracefully until
-- this runs (a missing table → empty registry → codes still show from signups),
-- same posture as the gtm_* / library reads.
--
-- Apply with the Supabase Management API (the stored DB password is stale —
-- see roadmap E5; playbook in docs/solutions/integration-issues/).

create table if not exists public.ambassador_codes (
  code       text primary key,
  owner_name text not null default '',
  note       text not null default '',
  created_at timestamptz not null default now()
);

-- Codes are stored uppercased by the app (referralCode.trim().toUpperCase());
-- guard it at the DB too so a lowercase row can never split a tally.
alter table public.ambassador_codes
  drop constraint if exists ambassador_codes_upper;
alter table public.ambassador_codes
  add constraint ambassador_codes_upper check (code = upper(code));

alter table public.ambassador_codes enable row level security;
-- (deliberately no policies: only the service-role client may touch this table)
