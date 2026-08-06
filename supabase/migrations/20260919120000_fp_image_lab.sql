-- Image Lab v1 (Unit 1) — the staff prompt→image test bench's persistence:
-- three tables + one private bucket. Greenfield: nothing named fp_image_lab_*
-- existed before this migration, and no existing table, policy, grant, or
-- bucket is touched.
--
-- Plan: first-profit docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md
-- Origin: first-profit docs/brainstorms/2026-08-05-image-lab-requirements.md
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. This slot (20260917120000) assumes the
--   live top of supabase_migrations.schema_migrations is 20260916120000
--   (fp_reserved_handle_auth, authored on feat/new-user-flow-v3). THREE lanes
--   are live right now — feat/new-user-flow-v3, feat/watchtower, and this
--   branch — so the file listing is NOT the truth: an applied-but-unmerged
--   migration from either other lane is invisible here and only the ledger
--   query catches it (supabase/MIGRATION-LOCK.md, third collision; that file is
--   updated in this same PR to record the three live lanes).
--   IMMEDIATELY BEFORE APPLYING, run:
--     select version, name from supabase_migrations.schema_migrations
--      order by version desc limit 5;
--   and if the top is not 20260916120000, RENAME this file to the real
--   next-free 12:00:00 slot before applying. (The parity test resolves this
--   file by GLOB, not by hardcoded name, so the rename does not break it.)
--   Apply via the Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- AMENDMENT LOG (in-place amendments are allowed ONLY while this file is
--   branch-only / never applied — the 20260907 convention; once applied,
--   changes stack as a new migration):
--   * (none yet — initial authoring.)
--
-- ⚠ AUTHORIZATION POSTURE — RLS ON, ZERO POLICIES, SERVICE ROLE ONLY, and that
--   is the whole of it. This is a STAFF-ONLY surface reached over same-origin
--   server actions and route handlers that each call requireStaff()
--   (app/crm/lib/auth.ts) and then read/write through supabaseAdmin(). The gate
--   in the request IS the authorization; these tables deliberately carry no
--   policy for any other role.
--
--   Stated explicitly because the failure mode is production-only: RLS enabled
--   with zero policies plus server code holding the ANON key fails every write
--   with 42501 in prod while CI stays green on injected fakes
--   (docs/solutions/security-issues/rls-enabled-zero-policies-but-the-server-
--   code-is-postgrest-anon-key-2026-07-28.md). Every Image Lab caller MUST use
--   supabaseAdmin(). ⚠ THIS HALF IS PROSE, AND PROSE IS NOT A MECHANISM: the
--   parity test pins the trap (zero policies, revoke) but nothing here can
--   detect a caller reaching for the anon client. Unit 4 owns the enforceable
--   guard — a single `imageLabDb()` accessor plus a static test that no module
--   under app/staff/image-lab/ imports the anon client. Until that lands, the
--   amplifier is real: on the reference path the browser has ALREADY uploaded
--   bytes direct to Storage before the registration INSERT runs, so a 42501
--   there leaves an orphan object per attempt.
--
--   There is no anon/authenticated path to these tables by design, so there is
--   nothing here for a child session to reach — the R20 accepted-exposure
--   record (first-profit docs/solutions/security-issues/r20-fp-child-session-
--   reach-across-the-shared-supabase-project-accepted-exposure-2026-08-01.md)
--   needs a confirmation note, not an expansion.
--
--   Note the DELIBERATE divergence from 20260722140000_path_storage.sql: that
--   bucket carries a real storage.objects policy because FAMILY members hold
--   authenticated JWTs and must read their own evidence. Nobody but the service
--   role ever touches this bucket, so no storage policy is created here — a
--   policy with nothing to authorize is dead weight that reads as coverage.
--
-- ⚠ CHILD CONTENT — MINIMIZED BY FIELD SELECTION, *NOT* ABSENT BY CONSTRUCTION.
--   An earlier draft of this header claimed "no child PII by construction".
--   That was false and the correction matters, because the retention and purge
--   posture below is built on it.
--
--   What is true: no child NAME FIELD, username, grade, birth year, photo, or
--   likeness is stored as such, and the `sale` slot excludes the buyer's name
--   (origin R12a). source_child_id records WHICH child, by internal id only.
--
--   What is ALSO true: `template`, `slot_values`, and `resolved_prompt` carry
--   child-AUTHORED free text (the four slots in app/staff/image-lab/lib/
--   image-lab-rules.ts: product, oneLiner, pitch, sale). A first-person pitch
--   conventionally OPENS with the child's own name — "Hi, I'm Maya, and I make
--   …" — so a child's name can and will arrive inside `pitch`. `runs.note`,
--   `images.verdict_note`, and `references.label` are unconstrained staff free
--   text on the same rows.
--
--   TREAT THESE ROWS AS CHILD-PII-BEARING for retention, logging, and purge.
--   Two consequences are enforced elsewhere and named here so they are not
--   lost: (1) Unit 5's content picker scrubs the child's known first name and
--   username out of slot values before compose — the names are available, this
--   is the shared project; (2) `failure_detail` stores a NORMALIZED reason
--   only, never the vendor's echoed prompt (provider safety-block responses
--   routinely quote the offending text back, which would land child content in
--   a second column no reader expects and that is the likeliest of the set to
--   be console-logged).
--
-- ⚠ CONSENT-REVOCATION PURGE (the deletion path a family revoking consent
--   needs; there is no UI for it in v1, deliberately).
--
--   ORDERING AGAINST ACCOUNT DELETION — READ FIRST. The repo's FP deletion
--   runbook is ledger → saves → profile → child (see 20260905120000_
--   fp_task_feedback.sql). fp_image_lab_runs.source_child_id is ON DELETE SET
--   NULL (a run is evidence; it must not block a routine delete — the
--   consent-and-audit-tables solution doc), which means once the child row is
--   gone the provenance is gone and these rows become UNFINDABLE. So:
--   PURGE THE IMAGE LAB *BEFORE* DELETING THE PROFILE/CHILD, and add this step
--   to that runbook.
--
--   Step 0 — DRAIN THE IN-FLIGHT WINDOW. A cell that is `requested` with a
--   non-null attempted_at has a vendor call running and no storage_key yet, so
--   it is invisible to step 1 while its bytes are still on the way. Either wait
--   out IMAGE_LAB_STALE_AFTER_MS (10 min) or finalize those cells failed, THEN
--   collect. (The generate route must also tolerate a zero-row finalize UPDATE
--   by deleting the object it just wrote — its run was purged underneath it.)
--
--   Step 1 — collect keys, INCLUDING COPY-FORWARD DESCENDANTS. Iterating on a
--   run copies its template/slot values forward, so a descendant can carry the
--   same child's text; and because iterated_from_run_id is ON DELETE SET NULL,
--   deleting the parent first would erase the only breadcrumb. Walk the lineage
--   in one statement:
--     with recursive tainted as (
--       select id from public.fp_image_lab_runs where source_child_id = $1
--       union
--       select r.id from public.fp_image_lab_runs r
--         join tainted t on r.iterated_from_run_id = t.id
--     )
--     select i.storage_key from public.fp_image_lab_images i
--       join tainted t on i.run_id = t.id where i.storage_key is not null;
--
--   Step 2 — delete those objects via the STORAGE API, NEVER SQL. Deleting a
--   storage.objects row orphans the underlying file permanently (the
--   path_storage header states this and it applies verbatim here).
--
--   Step 3 — VERIFY before deleting rows. Re-query the bucket and assert none
--   of those keys remain. This step exists because the row is the ONLY record
--   of its key: delete rows after a partial object delete and the survivors are
--   permanently unattributable. Resumability rests on it.
--
--   Step 4 — delete the rows (images cascade with their run):
--     with recursive tainted as ( … same CTE … )
--     delete from public.fp_image_lab_runs where id in (select id from tainted);
--
--   REFERENCES ARE OUT OF SCOPE and cannot be purged in v1 (append-only, no
--   delete path). That is safe ONLY while references are staff-authored
--   character sheets and style samples. ⚠ A reference derived from a child's
--   drawing, product photo, or likeness is an UNRECOVERABLE mistake in v1 —
--   Unit 4's upload UI states this at the point of upload.
--
-- ⚠ STORAGE KEYS ARE DETERMINISTIC, so an orphan always names itself. Generated
--   images live at `runs/{run_id}/{image_id}` (no extension — the content type
--   lives in the row and on the object). The key is therefore derivable from
--   ids that exist BEFORE the vendor call, so a crash between the storage PUT
--   and the finalize UPDATE leaves a row that still points at its own orphan
--   and a sweeper can reconstruct candidates for any non-done row. References
--   use per-upload uuid keys under `references/` (the app/fp/lib/actions/
--   upload-slot.ts precedent) and are registered after upload.
--
-- ⚠ DEPLOY ORDERING: apply this migration + NOTIFY pgrst, 'reload schema'
--   BEFORE shipping any Image Lab unit that writes these tables (Units 4–6).
--   Old code against the new DB is safe (nothing reads these tables yet); new
--   code against the old DB finds no tables at all.
--
-- ⚠ POST-APPLY VERIFICATION (the apply is NOT complete until this passes; run
--   via the Management API SQL endpoint). The Management API applies a
--   migration in ONE transaction, so a mid-file error rolls the whole thing
--   back — but `create table if not exists` cannot REPAIR a table that already
--   exists in a different shape, which is why check 2 enumerates constraints
--   rather than trusting table existence.
--   1. Tables + RLS:
--        select relname, relrowsecurity from pg_class
--         where relname like 'fp_image_lab%';        -- 3 rows, all rowsecurity=t
--   2. The constraint set actually landed (existence ≠ shape):
--        select conrelid::regclass::text, conname from pg_constraint
--         where conrelid::regclass::text like 'fp_image_lab%' order by 1, 2;
--      → expect every named constraint below, in particular
--        fp_image_lab_images_done_iff_object, _failed_iff_reason,
--        _verdict_needs_done, _verdict_at_pairs, _cost_needs_billed,
--        and fp_image_lab_runs_drill_tags_closed.
--   3. Zero policies (the posture, asserted):
--        select count(*) from pg_policies
--         where schemaname='public' and tablename like 'fp_image_lab%';   -- = 0
--   4. No anon/authenticated grant leaked in:
--        select grantee, privilege_type from information_schema.role_table_grants
--         where table_name like 'fp_image_lab%'
--           and grantee in ('anon','authenticated');                      -- 0 rows
--   5. Bucket private, at the stated ceiling, with the mime allowlist:
--        select id, public, file_size_limit, allowed_mime_types
--          from storage.buckets where id = 'fp-image-lab';
--      → one row, public=false, 26214400, {image/png,image/jpeg,image/webp}
--   6. ⚠ ENUMERATE EVERY storage.objects POLICY AND READ THEM:
--        select policyname, cmd, roles, qual::text from pg_policies
--         where schemaname='storage' and tablename='objects';
--      Acceptance: EVERY listed policy is ANDed to a bucket_id that is not
--      'fp-image-lab'. A policy that merely fails to NAME this bucket is the
--      dangerous case — an un-scoped `to authenticated` policy added by another
--      lane applies to EVERY bucket including this one. Counting policies that
--      mention 'fp-image-lab' would return 0 and prove nothing.
--
-- TS mirror: app/staff/image-lab/lib/image-lab-rules.ts (IMAGE_LAB_BUCKET,
--   IMAGE_LAB_MAX_OBJECT_BYTES, IMAGE_LAB_ACCEPTED_MIME_TYPES,
--   IMAGE_LAB_IMAGE_STATES, IMAGE_LAB_FAILURE_REASONS, IMAGE_LAB_VERDICTS,
--   IMAGE_LAB_DRILL_TAGS). Parity test: app/staff/image-lab/lib/__tests__/
--   image-lab-migration-parity.test.ts (resolves this file by glob and parses
--   it as text). IMAGE_LAB_SLOTS and IMAGE_LAB_STALE_AFTER_MS are deliberately
--   TS-ONLY — they constrain no column — and are tested on the TS side.
--
-- Idempotent throughout: create table if not exists / create index if not
-- exists / insert…on conflict do nothing / create or replace function, plus
-- ONE `drop trigger if exists` immediately before its `create trigger` (there
-- is no `create trigger if not exists` in Postgres, so that pair IS the
-- idempotent idiom — the fp_task_feedback precedent). Re-applying is a no-op.
-- The parity test allows exactly that drop and forbids every other DROP, so a
-- drop-and-recreate of a table, column, constraint, index, or policy cannot
-- land here unnoticed. Additive-only: nothing existing is removed or narrowed.

-- ────────────────────────────────────────────────────────────── the bucket ──
-- Private always: public=false means every read requires a signature. Bytes
-- reach it two ways, both bypassing our origin's request body (Vercel caps a
-- function body around 4.5 MB, far below a character sheet):
--   * reference uploads — direct from the browser to Storage on a server-minted
--     signed slot (the app/fp/lib/upload-client.ts pattern), and
--   * generated images — server-side puts from the generate-cell route.
--
-- ⚠ allowed_mime_types IS SET, and the reason is worth stating because an
-- earlier draft left it NULL on the theory that the application allowlist
-- (image-lab-rules.ts) would cover it. It cannot. On the reference leg the
-- BROWSER sets the object's content-type at PUT time — the server mints the
-- slot but cannot bind the type (see app/fp/lib/actions/upload-slot.ts, which
-- says so explicitly). So the application check governs the DB ROW; only this
-- bucket setting governs the OBJECT. Without it, a file declared
-- image/svg+xml lands in a bucket whose objects are served by signed URL to a
-- staff browser session — and an SVG is an executable document running on the
-- storage origin. The UX cost (an opaque storage error on a wrong type) is
-- worth the only structurally enforceable layer; the TS predicate still
-- provides the friendly refusal before the upload starts.
--
-- file_size_limit is the server's last line of defence against an oversize
-- direct upload; it mirrors IMAGE_LAB_MAX_OBJECT_BYTES (parity test).
--
-- ON CONFLICT DO NOTHING, deliberately NOT `do update`: a re-apply must never
-- silently narrow a limit an operator raised in the dashboard (e.g. after a Pro
-- upgrade) back to 25 MB, which would surface as an opaque upload failure weeks
-- later. Verification step 5 is what reports a mismatch.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fp-image-lab', 'fp-image-lab', false, 26214400,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ───────────────────────────────────────────────── fp_image_lab_references ──
-- Reference images: character sheets and style samples, uploaded once and
-- reused across runs (origin R6 — the consistency drill is "one hero sheet, N
-- prompts, per model", so the sheet must be a stable, addressable thing).
--
-- APPEND-ONLY, ENFORCED BY TRIGGER (not by scope discipline). fp_image_lab_runs
-- points at these by id inside a uuid[] — an array element cannot carry a
-- foreign key, and the justification for choosing an array over a join table is
-- precisely that a reference is never deleted, so a stored id can never dangle.
-- That argument is only as good as the guarantee, so the guarantee is a trigger
-- rather than a comment (the fp_task_feedback append-only precedent). It binds
-- service_role too, because service_role is the ONLY writer here.
--
-- Re-uploading the same file mints a NEW row with a NEW key — object keys are
-- per-upload UUIDs, so duplicates are tolerated rather than deduped, and the
-- storage_key unique index is an integrity guard against double-REGISTRATION of
-- one upload, not a content-identity claim.
create table if not exists public.fp_image_lab_references (
  id            uuid primary key default gen_random_uuid(),
  storage_key   text not null,
  label         text not null default '',
  content_type  text not null,
  byte_size     bigint not null check (byte_size > 0 and byte_size <= 26214400),
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  constraint fp_image_lab_references_label_bounded check (char_length(label) <= 120),
  -- Mirrors the bucket allowlist so a mislabeled ROW cannot be recorded even if
  -- the object somehow carries another type.
  constraint fp_image_lab_references_mime_closed
    check (content_type in ('image/png', 'image/jpeg', 'image/webp'))
);

create unique index if not exists fp_image_lab_references_storage_key_idx
  on public.fp_image_lab_references (storage_key);

create index if not exists fp_image_lab_references_created_at_idx
  on public.fp_image_lab_references (created_at desc);

alter table public.fp_image_lab_references enable row level security;
revoke all on public.fp_image_lab_references from anon, authenticated;

-- The append-only guarantee the array-over-join-table choice rests on. No role
-- exemption: a delete here silently dangles every referencing run's array and
-- the GIN filter would then return runs whose reference no longer means
-- anything. If v2 needs deletion it must also migrate the arrays, and dropping
-- this trigger is the deliberate act that says so.
create or replace function public.fp_image_lab_references_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'fp_image_lab_references is append-only (runs reference it by id in a uuid[] with no FK)';
end;
$$;

drop trigger if exists fp_image_lab_references_append_only_guard
  on public.fp_image_lab_references;
create trigger fp_image_lab_references_append_only_guard
  before update or delete on public.fp_image_lab_references
  for each row execute function public.fp_image_lab_references_append_only();

-- ─────────────────────────────────────────────────────── fp_image_lab_runs ──
-- One row per composed run. Written BEFORE any vendor call, together with its
-- image rows — stamping intent before the effect, so a crash mid-generation
-- leaves a row that says what was attempted rather than a paid call nothing
-- recorded (docs/solutions/logic-errors/an-external-already-exists-cannot-tell-
-- mine-from-foreign-stamp-intent-before-the-effect-2026-07-29.md).
--
-- THREE PROMPT COLUMNS, and the distinction is the feature (origin R10 vs R16):
--   * template        — the authored text WITH {{slot}} placeholders intact.
--                       This is what the Kit view copies and what the panel
--                       engine inherits; it must survive the picker untouched.
--   * slot_values     — {slot: value} actually filled, from the content picker
--                       or typed by hand.
--   * resolved_prompt — template × slot_values as SENT. Stored so the record
--                       shows precisely what the vendor saw; an unfilled slot
--                       stays literal here (warn-not-block).
--
-- ⚠ idempotency_key IS THE DOUBLE-SUBMIT DEFENCE, and it is a different defence
-- from the per-cell CAS below. The CAS protects a cell that already EXISTS. It
-- cannot protect against the case people actually hit: no response after 30s,
-- so the staff user reloads the POST or opens a second tab and composes again —
-- which mints a whole new run with fresh image ids that every CAS then passes
-- cleanly, paying twice for the same intent. The client mints this key once per
-- compose; a resubmit collides on the unique index below and the route returns
-- the existing run instead of a second one.
create table if not exists public.fp_image_lab_runs (
  id                   uuid primary key default gen_random_uuid(),
  staff_id             uuid not null,
  idempotency_key      text not null,
  template             text not null,
  slot_values          jsonb not null default '{}'::jsonb,
  resolved_prompt      text not null,
  reference_ids        uuid[] not null default '{}'::uuid[],
  drill_tags           text[] not null default '{}'::text[],
  note                 text not null default '',
  compare              boolean not null default false,
  -- Which model's wording this prompt was iterated on (origin R5). A prompt
  -- tuned to convergence on one model is biased evidence against the others —
  -- this field is what lets a later reader discount a cross-model verdict
  -- instead of trusting it. Nullable: a fresh prompt was iterated on nothing.
  iterated_on_model    text,
  -- ON DELETE SET NULL keeps a descendant alive when its parent is purged, so
  -- the purge MUST walk this lineage BEFORE deleting anything (see the runbook
  -- above) — otherwise the descendant survives carrying the same child's text
  -- with its breadcrumb erased.
  iterated_from_run_id uuid references public.fp_image_lab_runs (id) on delete set null,
  -- Source provenance (origin R17). Internal ids ONLY — never a name.
  -- The FK names the namespace: this is children.id, NOT fp_player_profiles.id
  -- and NOT auth.users.id. Without it, a purge run with the wrong flavour of
  -- uuid reports DELETE 0 and the operator concludes there was nothing to
  -- erase. SET NULL because a run is evidence and must not block a routine
  -- account delete — which is exactly why the Image Lab purge must run BEFORE
  -- that delete.
  source_child_id      uuid references public.children (id) on delete set null,
  source_idea_id       text,
  source_task_id       text,
  created_at           timestamptz not null default now(),
  constraint fp_image_lab_runs_template_bounded check (char_length(template) <= 8000),
  constraint fp_image_lab_runs_resolved_bounded check (char_length(resolved_prompt) <= 12000),
  constraint fp_image_lab_runs_note_bounded check (char_length(note) <= 2000),
  constraint fp_image_lab_runs_slot_values_object check (jsonb_typeof(slot_values) = 'object'),
  -- Bounded so one run cannot name an unbounded set of references.
  constraint fp_image_lab_runs_references_bounded check (array_length(reference_ids, 1) is null
    or array_length(reference_ids, 1) <= 16),
  -- The drill vocabulary, closed in SQL rather than only in TS. Without this a
  -- client writing 'kid_appeal' for 'kid-appeal' produces a run that silently
  -- drops out of every drill filter with no error anywhere.
  constraint fp_image_lab_runs_drill_tags_closed
    check (drill_tags <@ array['consistency', 'style', 'kid-appeal']::text[])
);

-- The double-submit guard (see idempotency_key above). Scoped per staff member
-- so two people composing concurrently can never collide with each other.
create unique index if not exists fp_image_lab_runs_staff_idempotency_idx
  on public.fp_image_lab_runs (staff_id, idempotency_key);

create index if not exists fp_image_lab_runs_created_at_idx
  on public.fp_image_lab_runs (created_at desc);

-- R11's filter-by-reference: the consistency drill retrieved as a SET.
create index if not exists fp_image_lab_runs_reference_ids_idx
  on public.fp_image_lab_runs using gin (reference_ids);

-- The consent-purge lookup (partial: most runs are synthetic).
create index if not exists fp_image_lab_runs_source_child_idx
  on public.fp_image_lab_runs (source_child_id)
  where source_child_id is not null;

-- The purge's lineage walk (partial: most runs are not iterations).
create index if not exists fp_image_lab_runs_iterated_from_idx
  on public.fp_image_lab_runs (iterated_from_run_id)
  where iterated_from_run_id is not null;

alter table public.fp_image_lab_runs enable row level security;
revoke all on public.fp_image_lab_runs from anon, authenticated;

-- ───────────────────────────────────────────────────── fp_image_lab_images ──
-- One row per requested CELL ATTEMPT. A compare run is simply a run whose cells
-- span several model_ids — there is no separate compare table, and per-model
-- stats fall out of grouping these rows.
--
-- ⚠ cell_ordinal IS THE CELL'S IDENTITY, and it carries two jobs the row id
-- cannot. (1) STABLE ORDER: created_at defaults to now(), which in Postgres is
-- the TRANSACTION timestamp — every cell minted in the run's single insert
-- shares it byte-for-byte, so ordering by created_at leaves the compare grid's
-- column order to the executor, and a plan change silently swaps the columns a
-- staff member is comparing left-to-right. (2) RETRY GROUPING: retry appends a
-- NEW row, so without an ordinal a run of 4 gpt-image-2 cells plus one retry is
-- five rows that cannot be reassembled into "which cell was retried" — the
-- stacked-attempt grid, the per-cell attempt badge, and the per-cell
-- retry-until-stale rule all need it. A retry carries the SAME
-- (run_id, model_id, cell_ordinal) as the attempt it replaces.
--
-- THE STATE MODEL, and why it is three states and not four:
--   * requested + attempted_at IS NULL  — minted, nothing has touched it.
--   * requested + attempted_at NOT NULL — IN FLIGHT. A vendor call may be
--                                          running (see `billed`).
--   * done   — bytes validated, stored, finalized.
--   * failed — finalized with a structured failure_reason.
--
-- The mark-attempt transition is an ATOMIC CAS —
--     update … set attempted_at = now()
--      where id = $1 and state = 'requested' and attempted_at is null
--      returning *
-- — and a caller that gets zero rows back must NOT call the vendor. This is the
-- defence against a second request on the SAME cell (an impatient retry, a
-- double-clicked button, two tabs holding the same run). It is NOT the defence
-- against a recomposed run — that is idempotency_key on fp_image_lab_runs.
-- "Stale" is NOT a state here: it is derived at read time from
-- IMAGE_LAB_STALE_AFTER_MS and only tells the UI when retry is safe to offer.
--
-- ⚠ `billed` SEPARATES MONEY FROM LATCHING, and both readings of attempted_at
-- were previously conflated. attempted_at means "this row is latched"; billed
-- means "a vendor call was actually dialled and will appear on the invoice".
-- Two things depend on the split:
--   * COST ON FAILURE. Vendors bill on generation, not delivery. A call that
--     completed vendor-side but blew our timeout is BILLED and lands failed.
--     Cost must be recordable on it, or per-model economics understate exactly
--     the slowest model — while Unit 6 is separately excluding those same rows
--     from the keep-rate denominator. Both errors push the same direction, and
--     the model decision this Lab exists to make would favour the worst vendor.
--   * `unconfigured` (no key / bench off) means nothing was dialled at all. It
--     still takes the CAS first, so attempted_at is set, but billed stays false
--     and no cost may be attached.
--
-- RETRY APPENDS A NEW ROW rather than mutating this one, so cost accounting
-- stays per attempt and a failed attempt remains visible as evidence.
create table if not exists public.fp_image_lab_images (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references public.fp_image_lab_runs (id) on delete cascade,
  model_id              text not null,
  cell_ordinal          smallint not null check (cell_ordinal >= 0),
  state                 text not null default 'requested'
                          check (state in ('requested', 'done', 'failed')),
  attempted_at          timestamptz,
  billed                boolean not null default false,
  failure_reason        text
                          check (failure_reason in ('safety_blocked', 'timeout', 'rate_limited',
                                                    'provider_error', 'unconfigured')),
  -- NORMALIZED detail only — never the vendor's echoed prompt (see the child
  -- content note in the header).
  failure_detail        text,
  storage_key           text,
  content_type          text,
  -- Cost in USD. `estimated` comes from the registry's price note; `reported`
  -- is the gateway's own figure where the image modality supplies one, and
  -- stays null otherwise. The two are displayed separately and never summed
  -- together.
  cost_estimated        numeric(12, 6),
  cost_reported         numeric(12, 6),
  gateway_generation_id text,
  verdict               text check (verdict in ('keep', 'reject')),
  verdict_note          text not null default '',
  verdict_at            timestamptz,
  created_at            timestamptz not null default now(),
  constraint fp_image_lab_images_verdict_note_bounded check (char_length(verdict_note) <= 2000),
  constraint fp_image_lab_images_failure_detail_bounded check (failure_detail is null
    or char_length(failure_detail) <= 1000),
  constraint fp_image_lab_images_mime_closed check (content_type is null
    or content_type in ('image/png', 'image/jpeg', 'image/webp')),
  -- ⚠ BICONDITIONAL, not one-directional, and the difference is the whole
  -- integrity of the evidence. A one-way implication (state <> 'done' or …)
  -- permits a `done` row that still carries failure_reason='timeout' — which
  -- happens for real when a killed function finalizes `failed` and the vendor
  -- call lands afterwards and finalizes `done` over it. Unit 6 excludes
  -- timeout/safety_blocked rows from the keep-rate DENOMINATOR while counting
  -- keeps in the NUMERATOR, so that single row pushes keep rate above 100% for
  -- precisely the flakiest model. Biconditional turns the late write into a
  -- constraint violation the route can log instead of silent corruption.
  constraint fp_image_lab_images_done_iff_object check (
    (state = 'done') = (storage_key is not null and content_type is not null)
  ),
  constraint fp_image_lab_images_failed_iff_reason check (
    (state = 'failed') = (failure_reason is not null)
  ),
  -- A finalized row was necessarily attempted. Guards the CAS's invariant from
  -- the other side: nothing may reach a terminal state without a stamp.
  constraint fp_image_lab_images_finalized_was_attempted check (
    state = 'requested' or attempted_at is not null
  ),
  -- Money only where a call was dialled. Blocks the phantom-cost case (a
  -- never-dialled or unconfigured row carrying a price) while still ALLOWING
  -- cost on a billed-but-failed timeout, which is the case the economics need.
  constraint fp_image_lab_images_cost_needs_billed check (
    billed or (cost_estimated is null and cost_reported is null)
  ),
  constraint fp_image_lab_images_billed_was_attempted check (
    not billed or attempted_at is not null
  ),
  -- A verdict is a judgement about an IMAGE, so there must be one. Without
  -- this, an optimistic click on an in-flight cell survives that cell's later
  -- failure: the Kit index below would carry a kept row with no storage_key and
  -- the keep-rate numerator would admit an entry no denominator counts.
  constraint fp_image_lab_images_verdict_needs_done check (
    verdict is null or state = 'done'
  ),
  constraint fp_image_lab_images_verdict_at_pairs check (
    (verdict is null) = (verdict_at is null)
  )
);

-- The run grid, in STABLE mint order (see cell_ordinal above — created_at is
-- identical across a run's cells, so it can never be the sort key).
create index if not exists fp_image_lab_images_run_cell_idx
  on public.fp_image_lab_images (run_id, cell_ordinal, created_at);

-- Per-model stats (keeps / keep rate / cost, grouped by model and state).
create index if not exists fp_image_lab_images_model_state_idx
  on public.fp_image_lab_images (model_id, state);

-- The Kit view: kept results, newest first.
create index if not exists fp_image_lab_images_verdict_idx
  on public.fp_image_lab_images (verdict, created_at desc)
  where verdict is not null;

alter table public.fp_image_lab_images enable row level security;
revoke all on public.fp_image_lab_images from anon, authenticated;
