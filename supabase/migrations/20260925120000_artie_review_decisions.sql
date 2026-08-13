-- Artie press-review decisions, one row per chapter.
--
-- Replaces the single-blob design in first-profit's supabase/artie-review-state.sql,
-- which was authored but NEVER APPLIED (verified 2026-08-13: a PostgREST probe
-- returns PGRST205 "Could not find the table ... in the schema cache", which is
-- table-absent, not the 42501 an RLS-locked table would give). There is therefore
-- no data to migrate and nothing reads or writes the old shape.
--
-- Why per-chapter rows rather than one JSON document: the old shape stored all
-- 125 chapters in one `decisions` jsonb column and upserted it unconditionally,
-- so two reviewers working at the same time silently destroyed each other's whole
-- decision set (last write wins over the entire book). Rows make the common case —
-- two people on different chapters — collision-free by construction, and give
-- attribution for free. See first-profit's
-- docs/solutions/logic-errors/cas-full-doc-replace-is-last-writer-wins-union-monotonic-sub-state-at-rebase-2026-08-03.md
--
-- `version` is the optimistic-concurrency token. A writer sends the version it
-- read; the server updates only when it still matches and treats an empty result
-- as a conflict, so a same-chapter collision is DETECTED rather than silently
-- resolved. Losing that race must never discard the reviewer's typed note — that
-- is a client obligation, recorded here because the column is what makes it
-- possible.
--
-- Version slot: the live ledger was queried per supabase/MIGRATION-LOCK.md before
-- authoring (top applied was 20260924120000, so 20260925120000 is the true next
-- free 12:00:00 slot). NOTE: the lock file was STALE at the time of writing — it
-- listed 20260920120000 and 20260921120000 as authored-but-unapplied when the
-- ledger showed both applied. Trusting it would have produced a collision.

create table if not exists public.artie_review_decisions (
  book_id            text        not null,
  chapter_number     smallint    not null,
  status             text        not null,
  note               text        not null default '',
  affected_panel_ids text[]      not null default '{}',
  pdf_sha256         text        not null,
  panel_sha256       jsonb       not null default '{}'::jsonb,
  reviewer_id        uuid        not null,
  reviewer_name      text        not null default '',
  decided_at         timestamptz not null default now(),
  version            integer     not null default 1,

  primary key (book_id, chapter_number),

  -- Bounds mirror the predecessor's, and are mirrored again in the TS rules
  -- module on the first-profit side with a .sql-parsing parity test. Keep the
  -- three in step: the SQL body is a third, untested copy of any map also held
  -- in TS (120/docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md).
  constraint artie_review_decisions_book_id
    check (book_id = 'artie-finch-v2'),
  constraint artie_review_decisions_chapter_range
    check (chapter_number between 1 and 125),
  constraint artie_review_decisions_status
    check (status in ('approved', 'changes-requested')),
  constraint artie_review_decisions_note_len
    check (char_length(note) <= 2000),
  constraint artie_review_decisions_panels_len
    check (cardinality(affected_panel_ids) <= 12),
  constraint artie_review_decisions_pdf_sha
    check (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  constraint artie_review_decisions_panel_sha_object
    check (jsonb_typeof(panel_sha256) = 'object'),
  constraint artie_review_decisions_version_positive
    check (version >= 1)
);

-- Reviewers page the book in chapter order; the primary key already serves that,
-- but an explicit index on the book keeps a full-book read cheap as rows fill in.
create index if not exists artie_review_decisions_book_chapter_idx
  on public.artie_review_decisions (book_id, chapter_number);

-- Service-role only, matching the fp_image_lab precedent: no storage/table policy
-- is created because nothing but the server touches this table. RLS is enabled
-- with zero policies so a direct anon/authenticated PostgREST call gets nothing
-- even if a grant is ever added by accident.
--
-- The application-layer gate (first-profit's verifyArtieStaff) is NOT what
-- protects this table — Postgres knows nothing about it. A page-level or
-- route-level check does not gate a separately addressable endpoint
-- (120/docs/solutions/security-issues/a-flag-that-gates-the-page-does-not-gate-its-server-actions-...-2026-08-05.md).
alter table public.artie_review_decisions enable row level security;
revoke all on table public.artie_review_decisions from anon, authenticated;
grant all on table public.artie_review_decisions to service_role;
