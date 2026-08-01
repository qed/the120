-- First Profit game — Slice A review follow-ups (two hardening fixes surfaced
-- by ce:review on migration 20260827120000). Additive, idempotent.
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-07-31): top of supabase_migrations.schema_migrations was
--   20260827120000 fp_player_tables, so 20260828120000 is free. Apply via the
--   Management API playbook.
--
-- 1. fp_ledger.created_at was client-forgeable. The 20260827120000 grant was
--    `grant select, insert on public.fp_ledger` (table-wide), and the insert
--    policy's WITH CHECK pins only source/amount_cents/profile_id — so a child
--    session could POST a row with an arbitrary `created_at`, backdating or
--    postdating an append-only ledger whose reads order on (profile_id,
--    created_at). Column-scope the insert grant to exclude created_at (and
--    updated-only columns), the same discipline already used on
--    fp_player_saves' update grant. Omitting created_at forces its `default
--    now()`; a client that references it now gets a hard permission error.
--    `id` stays insertable on purpose — it is the client-generated idempotency
--    key for outbox retries.
--
-- 2. fp_player_profiles.updated_at was never refreshed when the identity guard
--    fired on a user_id/child_id correction (an anticipated service-role case).
--    Stamp it in the guard, matching fp_player_saves_revision_guard.

-- --------------------------------------------------- 1. ledger insert grant
revoke insert on public.fp_ledger from authenticated;
grant insert (id, profile_id, kind, source, payer, amount_cents)
  on public.fp_ledger to authenticated;

-- ------------------------------------------------ 2. profile touch-on-update
create or replace function public.fp_player_profiles_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.path_student_profiles psp
    where (psp.user_id = NEW.user_id and psp.child_id is distinct from NEW.child_id)
       or (psp.child_id = NEW.child_id and psp.user_id is distinct from NEW.user_id)
  ) then
    raise exception 'fp_player_profiles: (user_id, child_id) contradicts path_student_profiles';
  end if;
  if TG_OP = 'UPDATE' then
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$;
