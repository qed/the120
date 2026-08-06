-- ============================================================================
-- Image Lab — PER-CELL PROMPT RECORDING
--   fp_image_lab_images.resolved_prompt   — the exact text THIS attempt sent
--   fp_image_lab_images.prompt_derived    — was it category-derived, or the
--                                           child-authored template resolution?
--
-- Additive, idempotent, and safe to apply while the current code is live: both
-- columns are nullable-or-defaulted, every existing row keeps working, and the
-- reader treats a null `resolved_prompt` as "this attempt predates per-cell
-- recording" rather than as a fault.
--
-- ── WHY A COLUMN AND NOT A DERIVATION ───────────────────────────────────────
-- The Lab exists to answer "which prompt phrasing beat which, on which model".
-- Before this migration the prompt lived ONCE per run
-- (`fp_image_lab_runs.resolved_prompt`), which was the right shape only while
-- every cell of a run shared one string. It no longer does: the prompt is a
-- PER-MODEL, staff-controlled choice, because finding that `gpt-image-2` needs
-- different wording than `gemini-3-pro-image` is a RESULT the panel engine needs,
-- not a confound to be normalized away.
--
-- Recomputing the text at read time from `template` × `slot_values` is not an
-- option: the template is editable, the derivation rules are code that changes,
-- and evidence reconstructed from today's rules is not evidence about what ran.
--
-- ── AND WHY THE FLAG IS A COLUMN, NOT AN INFERENCE ──────────────────────────
-- "It is derived iff it is a member of the closed vocabulary" is true today and
-- is exactly the check the dispatch gate makes — but that vocabulary is a code
-- constant that will be edited, and a historical row must not silently change
-- what it claims about itself when someone adds a category. The flag is stamped
-- at write time by the code that made the choice.
--
-- ── MIGRATION LOCK ──────────────────────────────────────────────────────────
-- ⚠ RUN THE LEDGER QUERY IMMEDIATELY BEFORE APPLYING, AND RENAME THIS FILE TO
--   THE REAL NEXT-FREE `12:00:00` SLOT IF `20260920120000` IS TAKEN:
--
--     select version, name from supabase_migrations.schema_migrations
--      order by version desc limit 5;
--
--   This slot assumes the live top is `20260919120000` (`fp_image_lab`, applied).
--   Three lanes have been live on this project and an applied-but-unmerged
--   migration in another lane is invisible to this repo's file listing — only
--   that query catches it (supabase/MIGRATION-LOCK.md, third recorded
--   collision). The parity test resolves this file by GLOB, so a rename does not
--   break it. Do NOT edit the already-applied `*_fp_image_lab.sql`.
--
--   Apply via the Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do not write `schema_migrations` by hand.
--
-- ── POST-APPLY VERIFICATION ─────────────────────────────────────────────────
--   1. both columns exist, with the right nullability and default:
--        select column_name, is_nullable, column_default, data_type
--          from information_schema.columns
--         where table_schema = 'public' and table_name = 'fp_image_lab_images'
--           and column_name in ('resolved_prompt', 'prompt_derived');
--      expect: resolved_prompt / YES / null / text
--              prompt_derived  / NO  / false / boolean
--   2. the bound is present:
--        select conname from pg_constraint
--         where conrelid = 'public.fp_image_lab_images'::regclass
--           and conname = 'fp_image_lab_images_resolved_prompt_bounded';
--   3. RLS is still on with zero policies (this migration adds neither):
--        select relrowsecurity from pg_class
--         where oid = 'public.fp_image_lab_images'::regclass;   -- expect t
--        select count(*) from pg_policies
--         where schemaname = 'public' and tablename = 'fp_image_lab_images';  -- expect 0
--
--   Then: notify pgrst, 'reload schema';
--   PostgREST caches the column list, so a select naming `resolved_prompt`
--   before the reload fails with PGRST204 on a warm instance.
--
-- ── PURGE ───────────────────────────────────────────────────────────────────
-- `resolved_prompt` on an image row is the SAME class of data as the run's:
-- when the derived prompt was used it holds no child wording at all, and when
-- the authored one was used it holds the same text the run row already held.
-- The consent-revocation runbook in the `fp_image_lab` migration header is
-- unchanged — image rows are deleted by the run cascade either way.
-- ============================================================================

alter table public.fp_image_lab_images
  add column if not exists resolved_prompt text;

alter table public.fp_image_lab_images
  add column if not exists prompt_derived boolean not null default false;

-- Mirrors IMAGE_LAB_RESOLVED_MAX_CHARS in app/staff/image-lab/lib/run-rules.ts,
-- and the run table's own `fp_image_lab_runs_resolved_bounded`. Dropped first so
-- a re-apply is a no-op rather than a duplicate-object error.
alter table public.fp_image_lab_images
  drop constraint if exists fp_image_lab_images_resolved_prompt_bounded;

alter table public.fp_image_lab_images
  add constraint fp_image_lab_images_resolved_prompt_bounded
  check (resolved_prompt is null or char_length(resolved_prompt) <= 12000);

comment on column public.fp_image_lab_images.resolved_prompt is
  'The exact text dispatched for THIS attempt. Null only for rows written before '
  'per-cell prompt recording. Never recomputed at read time.';

comment on column public.fp_image_lab_images.prompt_derived is
  'True when resolved_prompt came from the closed category vocabulary '
  '(app/staff/image-lab/lib/category-prompt-rules.ts) rather than from the '
  'child-authored template resolution.';
