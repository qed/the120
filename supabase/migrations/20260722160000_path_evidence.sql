-- The Path T1 Unit 10 — the evidence model: one table, `path_evidence_items`,
-- that every captured artifact (photo, video, audio, document, log table, link)
-- lands in after its bytes are stored. The CONFIRM step (Unit 9's uploader hands
-- a stored object up via onUploaded; the confirm action inserts the row here) and
-- the redaction/orphan-reaper machinery are the Unit 10 code that reads/writes it.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB password).
-- See docs/solutions/integration-issues/supabase-cli-stale-db-password-management-
-- api-workaround-2026-07-13.md. After applying, verify with:
--   select to_regclass('public.path_evidence_items');                    -- non-null
--   select count(*) from information_schema.table_constraints
--     where table_name='path_evidence_items' and constraint_type='FOREIGN KEY'; -- 3
--   select relrowsecurity from pg_class where relname='path_evidence_items';     -- t
--   select count(*) from pg_policies
--     where schemaname='public' and tablename='path_evidence_items';             -- 0
-- THEN record this version in supabase_migrations.schema_migrations. A committed
-- migration is not an applied migration.
--
-- Depends on Unit 8 (path_task_progress) and Unit 5 (path_student_profiles). Verify
-- to_regclass('public.path_task_progress') and to_regclass('public.path_student_
-- profiles') are non-null before applying — the FKs below reference them. The
-- path-evidence bucket (Unit 9) must also exist for the object paths to resolve.
--
-- Rollout phase: SCHEMA. Creates one table + indexes; seeds nothing. Idempotent
-- throughout (create table/index if not exists, drop-and-add constraints guarded)
-- — re-applying is a no-op.
--
-- Delete posture: every FK is ON DELETE RESTRICT (Unit 5's Path-graph posture) — a
-- CRM/identity delete that would strip evidence out from under a Founder File must
-- fail loudly, never cascade a decade of keepsake into oblivion. Redaction is a
-- TOMBSTONE (the row stays; the storage object is deleted via the Storage API),
-- NEVER a row delete — deleting a storage.objects row orphans the file permanently.
--
-- Decision 1: RLS enabled, ZERO policies — service-role only, like every other Path
-- table except the storage.objects exception. No authenticated JWT reads this table
-- directly; the app reads it inside a guarded server context.
--
-- ── Identity & idempotency ────────────────────────────────────────────────────
-- `id` IS the client-generated evidence UUID (supplied by the client, NOT a server
-- default) — the object path {student_id}/{evidence_id}/{sha256} already keys on it
-- (Unit 9). A global UUID PK is strictly stronger than the plan's
-- `unique(task_progress_id, client_id)`: an offline retry that reuses the same
-- evidenceId conflicts on the PK (one permanent row, never two — the keepsake-
-- duplicate guarantee), AND the same id can never be confirmed against two tasks
-- (a second insert is a PK violation). The (task_progress_id, student_id) composite
-- FK pins the denormalized student_id to the task's true owner.
--
-- ── Content hash is ADVISORY, deliberately NOT unique ─────────────────────────
-- sha256 has a NON-unique index only. Content-hash dedupe is advisory keep-both
-- (decideConfirm surfaces a "you already added this" hint) — a hard unique would
-- (a) silently drop a legitimate second capture and (b) leave a redacted tombstone
-- holding the hash forever, blocking a later legitimate resubmission with no
-- recourse. The sha256 is CLIENT-DECLARED and never integrity-verified (Unit 9), so
-- it is a hint, not a key.

create table if not exists public.path_evidence_items (
  -- the client-generated evidence UUID (see header) — no default; client supplies it.
  id uuid primary key,
  task_progress_id uuid not null,
  -- denormalized owner (the storage folder-1 segment, the quota/reaper scope). Set
  -- server-side from the resolved task_progress row, never client-supplied; the
  -- composite FK below guarantees it equals the task's true student.
  student_id uuid not null references public.path_student_profiles (id) on delete restrict,
  kind text not null check (kind in ('photo', 'video', 'audio', 'document', 'log', 'link')),

  -- ── stored-object columns (media kinds) ──
  bucket text,
  object_path text,
  poster_object_path text,           -- video poster frame, generated on-device at capture
  content_type text,
  -- client-DECLARED (never integrity-verified); the CHECK only constrains non-nulls.
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  -- the RECONCILED real size (from storage.objects), not the client-reported value.
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  size_mismatch boolean not null default false,   -- reconcile flagged client≠real
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),

  -- ── non-object kinds ──
  log_data jsonb,                    -- kind='log': the rows. '[]' = a zero-row log
                                     -- (present, empty); NO row of kind='log' = absent.
  link_url text,                     -- kind='link': the >50MB link-overflow URL

  -- ── student-authored + capture metadata ──
  caption text,                      -- free text; ESCAPE on render (never trust raw)
  captured_at timestamptz,           -- client, honest (Decision 10: capturedAt is a fact)
  -- private EXIF (GPS/timestamp — evidentiary value AND a child's home coords). Never
  -- exposed to a read surface; CLEARED on redaction.
  exif jsonb,

  -- ── the ONE cached signed-download URL (Unit 9: mint once, reuse until near
  --    expiry — never per render). NULLED on redaction (irrevocable URLs otherwise
  --    keep redacted media readable). ──
  signed_url text,
  signed_url_expires_at timestamptz,

  -- R6: evidence that lands (via offline sync, Unit 11) on an ALREADY-verified task
  -- is flagged, never invisible. Column exists now; Unit 11 sets it.
  added_after_verification boolean not null default false,

  -- ── redaction tombstone (columns from day one; policy deferred to the launch gate) ──
  redacted_at timestamptz,
  redacted_by uuid references auth.users (id) on delete restrict,
  redaction_reason text,

  created_at timestamptz not null default now(),   -- server confirm time
  updated_at timestamptz not null default now(),

  -- Shape integrity: a media kind has a stored object; a log has structured rows and
  -- no object; a link has a url and no object. Guards a malformed insert loudly.
  constraint path_evidence_items_kind_shape check (
    case kind
      when 'log' then object_path is null and link_url is null
      when 'link' then link_url is not null and object_path is null
      else object_path is not null
    end
  )
);

-- Composite-unique target so the evidence row's denormalized student_id is pinned
-- to the task's true owner by the FK below (path_task_progress.id is already the PK,
-- so this only adds student_id to make it a valid composite FK target).
create unique index if not exists path_task_progress_id_student
  on public.path_task_progress (id, student_id);

-- The three FKs (all RESTRICT): task_progress (composite, pinning student_id),
-- student, and — declared inline above — redacted_by. Added out-of-line and guarded
-- so re-applying is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'path_evidence_items_task_progress_fk'
  ) then
    alter table public.path_evidence_items
      add constraint path_evidence_items_task_progress_fk
      foreign key (task_progress_id, student_id)
      references public.path_task_progress (id, student_id) on delete restrict;
  end if;
end $$;

-- Read paths: by task (the review list), by student (quota/reaper). Advisory hash
-- lookup is a NON-unique partial index (keep-both). One evidence row per stored
-- object (belt-and-suspenders; the object path embeds the unique evidenceId).
create index if not exists path_evidence_items_task_idx
  on public.path_evidence_items (task_progress_id);
create index if not exists path_evidence_items_student_idx
  on public.path_evidence_items (student_id);
create index if not exists path_evidence_items_hash_idx
  on public.path_evidence_items (task_progress_id, sha256) where sha256 is not null;
create unique index if not exists path_evidence_items_object_path_idx
  on public.path_evidence_items (object_path) where object_path is not null;

-- Decision 1: RLS on, zero policies. service-role only.
alter table public.path_evidence_items enable row level security;
