-- New User Flow v3 (Unit 7, OWNER REWORK): PERSIST THE RENDERED COVER.
-- Plan: docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md (Unit 4 renders,
-- Unit 7 shows). Owner decision, verbatim:
--
--   "The cover being created at signup needs to be the exact same cover a kid
--    sees in First Profit. When that cover is created, it goes into the DB
--    attached to the kid as the one and only cover for that kid. There is only
--    one cover creation process. It happens during the parent signup process.
--    We should only have to create the image once."
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED, AND THE LIVE LEDGER WAS NOT READABLE
--   AT AUTHORING TIME. The canonical pre-authoring query
--
--     select version, name from supabase_migrations.schema_migrations
--     order by version desc limit 5;
--
--   COULD NOT BE RUN when this file was written (the SUPABASE_ACCESS_TOKEN in
--   .env.local still returns 401 — a dead token), so the slot below is
--   PROVISIONAL: it is derived only from the repo file listing, whose top was
--   20260916120000_fp_reserved_handle_auth, and the repo listing is explicitly
--   NOT the truth (docs/LANES.md: three version collisions are on record, all
--   from applied-but-unmerged migrations). RUN THE QUERY ABOVE IMMEDIATELY
--   BEFORE APPLYING and RENAME this file (and its v3 siblings, 20260912120000 /
--   20260913120000 / 20260914120000 / 20260915120000 / 20260916120000, keeping
--   their relative order — this one only needs to land AFTER 20260912120000,
--   which creates fp_onboarding_drafts, and AFTER 20260914120000, which adds
--   children's fp_cover_* columns) to the real next-free 12:00:00 slots if any
--   of these versions are taken. Apply via the Management API playbook
--   (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand beyond recording the version.
--
-- AMENDMENT LOG (in-place amendments allowed ONLY while this file is
--   branch-only / never applied; once applied, changes stack as a new
--   migration):
--   * (none yet — initial authoring.)
--
-- ⚠ DEPLOY ORDERING: purely additive nullable TEXT columns with no default and
--   no constraint, so applying this against the live schema changes NO existing
--   behavior. It must land BEFORE the Unit 7 application code deploys, because
--   POST /api/fp/cover writes the new draft column in the same statement that
--   settles cover_status — a missing column would turn that UPDATE into an
--   error and (via the settle's compensation path) leave the family with no
--   cover at all.
--
-- RLS POSTURE UNCHANGED. fp_onboarding_drafts stays RLS-on / zero-policies /
--   service-role-only (20260912120000). public.children keeps its existing
--   policies — this migration adds NO policy and grants NOTHING; the new
--   columns inherit whatever the table's existing posture already permits, and
--   every writer AND reader of them is service-role code.
--
-- POPULATED-TABLE RULE (public.children). children HAS rows in production.
--   ADD COLUMN ... text (nullable, no default) is a catalog-only change in
--   PG 11+: instant, no table rewrite, no scan. NO CHECK is added, deliberately
--   — a CHECK on a populated table would require the NOT VALID + separate
--   VALIDATE split (20260830120000's rule), and there is nothing worth
--   constraining here that the application does not already enforce.
--
-- ── WHAT THIS FIXES, AND WHY A COLUMN RATHER THAN A BLOB ──
-- Unit 4 rendered a personalized comic cover during signup (from the kid's
-- name, AGE and STORY ANSWERS) and stored NOTHING, on the theory that a
-- deterministic template is re-derivable. Unit 7 then discovered the flaw in
-- that theory: age and answers live on the DRAFT, which is consumed and reaped
-- at provisioning, so anything re-deriving from the CHILD row later has only
-- the name — a different palette, no age badge, and generic captions. A
-- re-derived cover is therefore NOT the cover the family was shown. One kid,
-- two pictures.
--
-- The fix is to stop re-deriving and start REMEMBERING. The rendered artifact is
-- a base64 `data:image/svg+xml` URL of roughly 2 KB — three orders of magnitude
-- below the 1 GB TOAST ceiling and small enough that a TEXT column is simply
-- the right store. Explicitly NOT @vercel/blob: adding an object store (and its
-- SDK, its token, its two-store consistency rules and its R28 erasure sweep)
-- to hold 2 KB of text would be a dependency bought for nothing. The
-- cover_blob_key columns stay exactly as they are, unused and reserved for a
-- future AI-drawn cover whose bytes are genuinely too large for a row.
--
-- ── R28 / ERASURE ──
-- Nothing new to erase and nothing new to remember. The artifact is a COLUMN on
-- rows that erasure already destroys: the draft row (reaped / deleted with the
-- signup attempt) and the child row (deleted with the child). No object store,
-- no key, no orphan class, no sweep. The inert blob-erasure task stays inert —
-- there are still no blobs.

-- ==========================================================================
-- (a) fp_onboarding_drafts: the artifact POST /api/fp/cover just rendered
-- ==========================================================================
-- Written in the SAME UPDATE that settles cover_status to 'final' (see
-- app/api/fp/cover/cover-core.ts `settleDraftCover`), so the status and the
-- bytes it claims can never be written apart. Nulled by the reservation write
-- and by the settle's compensation, so a row never carries a stale picture
-- beside a status that does not mean 'final'.
--
-- NULLABLE with no default: a draft created before the cover step (or by a
-- family who skipped it) has no artifact, and NULL says that more honestly than
-- an empty string. Every reader treats NULL as "no cover".
alter table public.fp_onboarding_drafts
  add column if not exists cover_data_url text;

comment on column public.fp_onboarding_drafts.cover_data_url is
  'The rendered comic cover as a self-contained data:image/svg+xml;base64 URL '
  '(~2KB). Written atomically with cover_status=final; NULL otherwise. Carried '
  'verbatim to children.fp_cover_data_url at provisioning. There is exactly one '
  'render, and it happens in POST /api/fp/cover.';

-- ==========================================================================
-- (b) children: the SAME artifact, carried at provisioning
-- ==========================================================================
-- Mirrors (a), alongside the fp_cover_status / fp_cover_blob_key pair added by
-- 20260914120000. `planCoverCarry` copies the draft's bytes here VERBATIM —
-- never re-renders — which is the whole point of the owner decision: the kid
-- sees in First Profit exactly the picture their parent was shown at signup.
--
-- Both sign-in doors (POST /api/fp/login and the handoff exchange) SERVE this
-- column and never call a renderer. Children provisioned before this migration
-- simply have NULL here and are emitted with no cover fields at all — the same
-- no-cover path every pre-v3 child already takes. There is deliberately NO
-- BACKFILL: re-rendering from the name alone is precisely the bug this fixes.
alter table public.children
  add column if not exists fp_cover_data_url text;

comment on column public.children.fp_cover_data_url is
  'The child''s one and only comic cover, as a self-contained '
  'data:image/svg+xml;base64 URL. Carried verbatim from '
  'fp_onboarding_drafts.cover_data_url at provisioning and served verbatim by '
  'both FP sign-in doors. NULL for every child provisioned before v3 Unit 7. '
  'Never re-rendered.';
