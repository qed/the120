-- ============================================================================
-- Image Lab — PER-CELL PROMPT RECORDING, AND THE STAFF ATTESTATION
--   fp_image_lab_images.resolved_prompt   — the exact text THIS attempt sent
--   fp_image_lab_images.prompt_derived    — was it category-derived, or the
--                                           child-authored template resolution?
--   fp_image_lab_runs.no_child_content_attested
--                                         — did the composing staff member
--                                           explicitly assert that this compose
--                                           — template AND slot values, the
--                                           whole thing — holds no child-authored
--                                           content?
--
-- Additive and idempotent.
--
-- ── ⚠ DEPLOY ORDERING — APPLY *BEFORE* THE CODE SHIPS ───────────────────────
-- This migration and the code that reads its columns are in the SAME commit,
-- and both loaders name the columns in EXPLICIT select lists
-- (run-loader.ts, history-loader.ts) rather than `*`. So the two directions are
-- NOT symmetric:
--
--   SQL first, then deploy  → safe. The columns sit unread until the code lands.
--   Deploy first, then SQL  → EVERY run view and history view fails outright
--                             (42703 / PGRST204). Not a degraded field — a dead
--                             surface for all staff.
--
-- Merging to main IS the production deploy on this project. So: apply the SQL,
-- run `notify pgrst, 'reload schema'`, run the post-apply checks, and only THEN
-- merge. (The predecessor `*_fp_image_lab.sql` carries the same block; this one
-- originally stated only the safe direction, which is the one that cannot hurt
-- you.)
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
-- ── AND WHY THE ATTESTATION IS A COLUMN ─────────────────────────────────────
-- The dispatch gate binds OpenAI when a run carries VERIFIED CHILD PROVENANCE —
-- `source_child_id`, stamped from the picker's signed token. But provenance is a
-- property of the FETCH PATH, not of the CONTENT: a staff member who types a
-- child's pitch straight into `template`, with no token and no slot values,
-- produces a run where `source_child_id` is null and every provenance-keyed
-- defence in the feature sees nothing to act on. That prose then went verbatim
-- to gpt-image-2.
--
-- The answer is not "always derive" — per-model prompt experimentation on OpenAI
-- is what the bench IS. It is an explicit assertion by a named staff member, and
-- it is a COLUMN because an assertion nobody can attribute later is not an
-- assertion. `staff_id` on the same row says who, `created_at` says when.
--
-- ⚠ IT COVERS THE WHOLE COMPOSE — `template` AND `slot_values` — AND THAT SCOPE
-- IS DELIBERATE. It reads as a claim about the template because the template is
-- the door it was added to close, but slot values are the same kind of text
-- typed by the same person into the same form. Two consequences, and they are
-- one rule:
--
--   * `slot_values` with no verified provenance token are REFUSED unless this is
--     true (run-core.ts, `unverified_slot_source`). A hand-typed slot value and a
--     replayed child's are the same POST; the attestation is what tells them
--     apart, and it is the only thing that can.
--   * with it true, those values resolve into the prompt and dispatch as
--     authored, on any model including OpenAI.
--
-- Scoping the claim to the template alone would mean one assertion authorized
-- one field and not the other — incoherent to whoever hit it — and it would make
-- slots picker-only forever, removing the ability to compose a synthetic test
-- case by hand. That is a capability taken from the thing the bench is FOR.
--
-- What it can NEVER do is override provenance that actually verified: once
-- `source_child_id` is set the server KNOWS the run carries a child's saved
-- work, and a staff member's opinion about it is not admissible.
--
-- ⚠ `not null default false` IS THE WHOLE SAFETY PROPERTY. Absent, null and
-- false must be the same answer, and that answer must be the restrictive one:
-- every run written by a client that has never heard of this field composes and
-- dispatches OpenAI cells on the closed category vocabulary. The safe path is the
-- default; the lazy path is safe.
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
--   1. all three columns exist, with the right nullability and default:
--        select table_name, column_name, is_nullable, column_default, data_type
--          from information_schema.columns
--         where table_schema = 'public'
--           and (   (table_name = 'fp_image_lab_images'
--                    and column_name in ('resolved_prompt', 'prompt_derived'))
--                or (table_name = 'fp_image_lab_runs'
--                    and column_name = 'no_child_content_attested'));
--      expect: images / resolved_prompt           / YES / null  / text
--              images / prompt_derived            / NO  / false / boolean
--              runs   / no_child_content_attested / NO  / false / boolean
--      ⚠ THE RUNS ROW'S `NO` + `false` IS THE SAFETY PROPERTY, NOT COSMETICS. A
--        nullable attestation would let a null reach the gate, and a null that
--        reads as "not false" is the whole hole this closes. Check it, do not
--        assume the DDL below ran as written.
--   2. both constraints are present AND HAVE THE RIGHT SHAPE. Read the
--      definition — a name proves nothing. `drop constraint if exists`
--      immediately precedes the add, so a re-apply from a different revision of
--      this file silently REPLACES the bound, and a name-only query reports
--      success either way:
--        select conname, pg_get_constraintdef(oid) from pg_constraint
--         where conrelid = 'public.fp_image_lab_images'::regclass
--           and conname in ('fp_image_lab_images_resolved_prompt_bounded',
--                           'fp_image_lab_images_done_needs_prompt');
--      expect: … char_length(resolved_prompt) <= 12000
--              … state <> 'done'::text OR resolved_prompt IS NOT NULL
--   3. RLS is still on with zero policies (this migration adds neither):
--        select relrowsecurity from pg_class
--         where oid = 'public.fp_image_lab_images'::regclass;   -- expect t
--        select count(*) from pg_policies
--         where schemaname = 'public' and tablename = 'fp_image_lab_images';  -- expect 0
--   4. no anon/authenticated grant leaked in. A new column inherits the table's
--      ACL and Supabase's default-privilege grants fire at table creation, not
--      column addition — so this SHOULD be clean by construction. Re-run it
--      anyway rather than reasoning about it: these rows are child-PII-bearing,
--      and `resolved_prompt` is the column most likely to carry a child's name
--      out of a first-person pitch.
--        select grantee, privilege_type from information_schema.role_table_grants
--         where table_name like 'fp_image_lab%'
--           and grantee in ('anon', 'authenticated');   -- expect 0 rows
--
--   Then: notify pgrst, 'reload schema';
--   PostgREST caches the column list, so a select naming `resolved_prompt`
--   before the reload fails with PGRST204 on a warm instance.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- REVERT THE CODE AND LEAVE THE COLUMNS. The pre-change code names neither
-- column in its select lists, so it is completely unaffected by their presence,
-- and `drop column` is forbidden by supabase/MIGRATION-LOCK.md's additive-only
-- rule. Dropping is lossless ONLY in the window before the first run; after
-- that it destroys the per-cell prompt evidence permanently — which is the one
-- thing this table exists to hold. Do not reach for `drop column` under
-- pressure.
--
-- ── IF YOU COPY THIS PATTERN ONTO A TABLE WITH ROWS ─────────────────────────
-- The column adds stay cheap (PG11+ stores a non-volatile constant default as
-- metadata, so `not null default false` does not rewrite the heap). THE CHECK
-- CONSTRAINTS ARE THE HAZARD: `add constraint … check` takes ACCESS EXCLUSIVE
-- and fully scans the table to validate, holding the lock for the whole scan.
-- On a large table use `add constraint … not valid` followed by a separate
-- `validate constraint`, which takes only SHARE UPDATE EXCLUSIVE. Here the
-- table is empty and staff-only, so the simple form is correct.
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

-- A `done` row is a STORED IMAGE that will be judged keep/reject and harvested
-- into the Kit. It must be able to say what produced it, or the Lab cannot
-- answer its own question ("which phrasing beat which"). This table's whole
-- discipline is biconditional — done_iff_object, failed_iff_reason,
-- verdict_needs_done, verdict_at_pairs, cost_needs_billed all exist so a row
-- cannot carry evidence it cannot account for — and a done row with a null
-- prompt is exactly that row.
--
-- THIS CONSTRAINT IS FREE RIGHT NOW AND IMPOSSIBLE LATER. The table is empty in
-- production (the feature has never run), so there is no legacy population to
-- grandfather. An earlier draft of this header justified the nullability as
-- "this attempt predates per-cell recording" — but no such attempt exists or
-- ever will, so that null was being reserved for a population that cannot
-- occur, and every future null would be an UNEXPLAINED null misreported to
-- readers as a historical one. Add it while it costs nothing.
alter table public.fp_image_lab_images
  drop constraint if exists fp_image_lab_images_done_needs_prompt;

alter table public.fp_image_lab_images
  add constraint fp_image_lab_images_done_needs_prompt
  check (state <> 'done' or resolved_prompt is not null);

comment on column public.fp_image_lab_images.resolved_prompt is
  'The exact text dispatched for THIS attempt. Required once state = done '
  '(fp_image_lab_images_done_needs_prompt); null is legal only for a requested '
  'or failed row that never got as far as dispatch. Never recomputed at read '
  'time — the template is editable and the derivation rules are code that '
  'changes, so a reconstruction is not evidence about what actually ran.';

-- ── THE STAFF ATTESTATION ───────────────────────────────────────────────────
-- See the header. `not null default false` is load-bearing: the restrictive
-- answer must be the one a caller reaches by doing nothing.
alter table public.fp_image_lab_runs
  add column if not exists no_child_content_attested boolean not null default false;

comment on column public.fp_image_lab_runs.no_child_content_attested is
  'The composing staff member explicitly asserted that THIS WHOLE COMPOSE - '
  'template AND slot_values, not one or the other - contains no child-authored '
  'content. FALSE (the default, and the value of any run whose client never sent '
  'the field) does two things: it forces every OpenAI cell on the run onto the '
  'closed category vocabulary, exactly as a verified source_child_id does, and it '
  'makes slot_values with no provenance token a refusal rather than a compose - a '
  'hand-typed slot value and a replayed one are the same request, and this is the '
  'only thing that distinguishes them. See app/staff/image-lab/lib/run-rules.ts, '
  'decideChildTextGate, and run-core.ts, unverified_slot_source. Attribute it '
  'with staff_id and created_at on this row. It can never override a verified '
  'source_child_id. Never null: a null attestation that read as anything but '
  '"no" would reopen the bypass this closes.';

comment on column public.fp_image_lab_images.prompt_derived is
  'True when resolved_prompt came from the closed category vocabulary '
  '(app/staff/image-lab/lib/category-prompt-rules.ts) rather than from the '
  'child-authored template resolution.';
