-- First Profit — Weekend Cohort Sprints, Unit 5: staff ops attribution.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md.
--
-- APPLY IMMEDIATELY. The Chicago rehearsal was cancelled (2026-07-23) and the
-- repo-wide migration hold is retired: every migration applies to production as
-- soon as it is authored. A schema revision after apply is a NEW migration, not
-- an edit to this file.
--
-- Rollout phase: SCHEMA ONLY. Creates one empty table and adds two nullable
-- columns; seeds and backfills nothing. Idempotent — re-applying is a no-op.
--
-- PRE-APPLY:
--   1. select to_regclass('public.path_fw_ops_audit');           -- null (not yet)
--   2. select to_regclass('public.path_fw_board_tokens');        -- non-null (Unit 1)
--   3. select column_name from information_schema.columns
--        where table_schema='public' and table_name='path_fw_board_tokens'
--          and column_name='revoked_by';                         -- 0 rows
-- POST-APPLY (verify BEFORE recording the version):
--   4. select to_regclass('public.path_fw_ops_audit');           -- non-null
--   5. select relname, relrowsecurity from pg_class
--        where relname = 'path_fw_ops_audit';                    -- true
--   6. select count(*) from pg_policies
--        where tablename = 'path_fw_ops_audit';                  -- 0
--   7. select tgname from pg_trigger
--        where tgrelid = 'public.path_fw_ops_audit'::regclass
--          and not tgisinternal;                                 -- 2 rows
--   8. select column_name from information_schema.columns
--        where table_schema='public'
--          and (table_name, column_name) in
--              (('path_fw_board_tokens','revoked_by'),
--               ('path_cohorts','created_by'));                  -- 2 rows
--   9. Only then: insert the version into
--      supabase_migrations.schema_migrations.
--
-- ROLLBACK: drops cleanly. The table is empty until the first guide grant
-- changes, and both added columns are nullable with no reader that requires
-- them. Note the immutability triggers must be dropped with the table (they
-- reference it), which `drop table ... cascade` handles.
--
-- ── Why an audit table exists at all, and why it is this small ───────────────
--
-- The plan's Scope Boundaries scope audit rows deliberately: only the two
-- LIABILITY actions write them — deletion/anonymize (Unit 5b) and guide-grant
-- changes (this unit). Everything else is "actor-attributed by its own rows".
--
-- That sentence was true of nothing when it was written, which is the other
-- half of this file. `path_cohorts` had no creator column and
-- `path_fw_board_tokens` recorded who MINTED a token but not who REVOKED one —
-- so a staff member killing a live board mid-event left no trace at all, and a
-- cohort with a wrong event window (the one value that silently expires a board)
-- named nobody to ask. Two nullable columns make the claim true instead of
-- aspirational, and they are cheaper than routing those mutations through the
-- audit table, which would then need a much wider action vocabulary.
--
-- The ACTION ALLOWLIST is narrow ON PURPOSE: exactly the two values Unit 5
-- writes. Unit 5b's anonymize path extends it (and adds its own subject column)
-- in its own migration, exactly as 20260715090000_offer_email_stamp.sql extended
-- crm_audit_log's allowlist for a later unit. Shipping an action nobody writes
-- would be a constraint that permits a value no code produces — the shape of
-- allowlist that quietly stops meaning anything.

-- ════════════════════════════════════════════════════════ 1. path_fw_ops_audit ──
-- The liability record. One row per guide-grant change: who did it, to whom, in
-- which cohort, when.
--
-- Why grants specifically. A `guide`/`cohort` grant is authority to write
-- verified states into a child's record with no gating, no verify cascade, and
-- no review (fw_move_task). Handing it out and taking it away are the two ops
-- actions whose consequence is measured in someone else's permanent record, and
-- "who gave that person check-in power for Boston?" must be answerable months
-- later from the database rather than from a Slack thread.
create table if not exists public.path_fw_ops_audit (
  id uuid primary key default gen_random_uuid(),
  -- The staff member who performed it. NOT NULL: an audit row nobody can be
  -- asked about is not an audit row. RESTRICT so deleting a staff account fails
  -- while their audit trail exists.
  actor uuid not null references auth.users (id) on delete restrict,
  action text not null check (action in ('guide_grant_added', 'guide_grant_revoked')),
  -- The guide the grant was added to / revoked from. RESTRICT for the same
  -- reason: the record outlives the working relationship.
  subject_user_id uuid not null references auth.users (id) on delete restrict,
  -- The cohort the grant scopes. NOT NULL — every guide grant is per-cohort
  -- (fw-access-rules.ts: "per-cohort, never global"), so a null here would
  -- describe a grant this system cannot issue.
  cohort_id uuid not null references public.path_cohorts (id) on delete restrict,
  -- Free-form context the ops surface renders (e.g. the guide's email at the
  -- time, whether the account was newly minted or adopted). Deliberately NOT
  -- load-bearing: everything an answer depends on is a column above.
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- The ops surface's read: this cohort's grant history, newest first.
create index if not exists path_fw_ops_audit_cohort_idx
  on public.path_fw_ops_audit (cohort_id, created_at desc);

-- "What is this person's access history?" — asked when a guide is offboarded or
-- when a grant is found that nobody remembers issuing.
create index if not exists path_fw_ops_audit_subject_idx
  on public.path_fw_ops_audit (subject_user_id, created_at desc);

-- ───────────────────────────────────────────────────── audit-log immutability ──
-- The crm_audit_log precedent (20260713110000_crm_core.sql), for the same
-- reason: RLS with zero policies already means no anon/authenticated path, but
-- every writer here holds the SERVICE ROLE, which RLS does not constrain. A
-- trigger does. An audit row a later bug can quietly rewrite is not evidence.
create or replace function public.prevent_path_fw_ops_audit_modification()
returns trigger
language plpgsql
as $$
begin
  raise exception 'path_fw_ops_audit entries are immutable';
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.path_fw_ops_audit'::regclass
       and tgname = 'path_fw_ops_audit_no_update'
  ) then
    create trigger path_fw_ops_audit_no_update
      before update on public.path_fw_ops_audit
      for each row execute function public.prevent_path_fw_ops_audit_modification();
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.path_fw_ops_audit'::regclass
       and tgname = 'path_fw_ops_audit_no_delete'
  ) then
    create trigger path_fw_ops_audit_no_delete
      before delete on public.path_fw_ops_audit
      for each row execute function public.prevent_path_fw_ops_audit_modification();
  end if;
end
$$;

-- ══════════════════════════════════════════ 2. path_fw_board_tokens.revoked_by ──
-- Unit 1 gave the token row a `created_by` and a `revoked_at`, which attributes
-- the mint and timestamps the kill — but names nobody for the kill itself.
--
-- A re-mint is self-attributing (the replacement row's created_by is the person
-- who did it), so this column matters for the OTHER path: an explicit revoke
-- with no replacement, which is the one that takes a projected board down and
-- leaves it down. That is the action a room notices, and "who?" should not
-- require correlating timestamps against a deploy log.
--
-- Nullable: a live token has no revoker, and every row that exists today
-- predates this column.
alter table public.path_fw_board_tokens
  add column if not exists revoked_by uuid references auth.users (id) on delete restrict;

-- ═══════════════════════════════════════════════════ 3. path_cohorts.created_by ──
-- Who created this cohort — the missing half of "cohort metadata mutations are
-- actor-attributed by their own rows".
--
-- Load-bearing for exactly one failure mode, and it is the one Decision 4 warns
-- about: `ends_at` is the value every board token's expiry derives from, so a
-- cohort entered in the wrong timezone expires a board mid-event. When that is
-- discovered on a Saturday afternoon, the useful question is who to ask what
-- they meant to type.
--
-- Nullable: every existing Path cohort was created by seed scripts and SQL, and
-- backfilling a fabricated creator would be worse than an honest null.
alter table public.path_cohorts
  add column if not exists created_by uuid references auth.users (id) on delete restrict;

-- ══════════════════════════════════════════════════════════════════════ RLS ──
-- Decision 1, inherited: enabled, ZERO policies. Every read and write above goes
-- through a service-role client behind a pure authorization verdict
-- (`isFwStaffActor`); there is no anon/authenticated path to this table.
alter table public.path_fw_ops_audit enable row level security;
