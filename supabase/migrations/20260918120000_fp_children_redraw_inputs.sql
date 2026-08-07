-- New User Flow v3 (Unit 8, OWNER REQUEST): CARRY THE KID'S AGE AND ANSWERS
-- ONTO THE CHILD, so the cover can be REDRAWN later.
-- Plan: docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md
-- Owner decision, verbatim: "carry age and answers onto the child so they match".
--
-- ⚠ THIS IS NOT ABOUT PARITY. Unit 7 already made the signup cover and the
--   served cover the SAME STRING: it is rendered once, stored on the draft,
--   copied verbatim to children.fp_cover_data_url, and served byte-for-byte by
--   both sign-in doors (pinned by a same-string test across the signup
--   response, the draft column, the child column and the served body). Nothing
--   re-derives it, so there is nothing left to make "match".
--
--   The real problem is REDRAW. The deferred AI adapter needs the kid's NAME,
--   AGE and STORY ANSWERS to draw a personalized cover. Today age and answers
--   live ONLY on fp_onboarding_drafts, and the reaper deletes those rows after
--   30 days — so every child provisioned today becomes PERMANENTLY
--   UN-REDRAWABLE the moment their draft is reaped. The window is quiet, it
--   closes on its own, and it cannot be reopened afterwards: the data is gone,
--   not merely inconvenient to reach. That is why this lands now rather than
--   with the adapter that will use it.
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
--   20260917120000_fp_v3_cover_artifact, and the repo listing is explicitly NOT
--   the truth (docs/LANES.md: three version collisions are on record, all from
--   applied-but-unmerged migrations). RUN THE QUERY ABOVE IMMEDIATELY BEFORE
--   APPLYING and RENAME this file (and its v3 siblings, 20260912120000 /
--   20260913120000 / 20260914120000 / 20260915120000 / 20260916120000 /
--   20260917120000, keeping their relative order — this one only needs to land
--   AFTER 20260912120000, which creates fp_onboarding_drafts and defines the
--   kid_age sanity range this file mirrors) to the real next-free 12:00:00
--   slots if any of these versions are taken. Apply via the Management API
--   playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand beyond recording the version.
--
-- AMENDMENT LOG (in-place amendments allowed ONLY while this file is
--   branch-only / never applied; once applied, changes stack as a new
--   migration):
--   * (none yet — initial authoring.)
--
-- ⚠ DEPLOY ORDERING: purely additive nullable columns with no default and no
--   constraint, so applying this against the live schema changes NO existing
--   behavior. It should land BEFORE the Unit 8 application code deploys,
--   because v3ProvisionKid writes both columns in the SAME children UPDATE that
--   carries the cover — but that write is already inside the "decoration never
--   fails provisioning" path (a failed cover write is logged and stepped past),
--   so a deploy in the wrong order costs a redraw input, never a child's
--   account.
--
-- RLS POSTURE UNCHANGED. public.children keeps its existing policies — this
--   migration adds NO policy and grants NOTHING; the new columns inherit
--   whatever the table's existing posture already permits.
--
-- POPULATED-TABLE RULE (public.children). children HAS rows in production.
--   ADD COLUMN ... (nullable, no default) is a catalog-only change in PG 11+:
--   instant, no table rewrite, no scan. NO CHECK is added, deliberately — a
--   CHECK on a populated table needs the NOT VALID + separate VALIDATE split
--   (20260830120000's rule), and the sanity range is already enforced twice on
--   the way in: by fp_onboarding_drafts_kid_age_sane on the draft, and by
--   `planRedrawCarry` in application code, which drops an out-of-range or
--   non-integer age to NULL rather than banking nonsense on a child.
--
-- ── CONSENT: ALREADY COVERED, VERIFIED AGAINST THE TEXT ──
-- FP_CONSENT_POLICY 2026-08-05.1 (the R1 bump, migration 20260914120000's
-- companion) says, verbatim: "I consent to First Profit storing my child's
-- answers to the signup questions and the generated cover picture on my child's
-- profile, including on the draft record that is created before the account
-- exists." — the child's PROFILE is named explicitly, and named FIRST. The same
-- paragraph already discloses storing "my child's first name, last name, age,
-- age band, birth year". So both columns are inside the consent every v3 family
-- gives, and this migration needs NO policy version bump. (A bump would be
-- actively harmful here: FP_CONSENT_MIN_VERSION's own warning explains why.)
--
-- ── R28 / ERASURE ──
-- Nothing new to erase and nothing new to remember. Both are COLUMNS on rows
-- erasure already destroys (the draft row, the child row). No object store, no
-- key, no orphan class, no sweep.

-- ==========================================================================
-- (a) children.fp_kid_age — the age the parent entered at signup
-- ==========================================================================
-- The cover renderer uses age for the palette and the age badge; a redraw
-- without it produces a DIFFERENT picture, which is the failure Unit 7 already
-- diagnosed once ("one kid, two pictures").
--
-- Deliberately NOT derived from children.grade: grade is the v2 roster's field
-- and maps to age only by convention (grade + 5). This column holds what the
-- parent actually typed.
alter table public.children
  add column if not exists fp_kid_age int;

comment on column public.children.fp_kid_age is
  'The kid''s age as entered during First Profit v3 signup, carried verbatim '
  'from fp_onboarding_drafts.kid_age at provisioning. Exists so the cover can '
  'be REDRAWN after the draft is reaped. NULL for every child provisioned '
  'before v3 Unit 8 and for any child whose draft carried no age.';

-- ==========================================================================
-- (b) children.fp_story_answers — the signup story answers
-- ==========================================================================
-- jsonb, mirroring fp_onboarding_drafts.answers. NULLABLE with NO default
-- (unlike the draft's `not null default '{}'`), and the difference is
-- deliberate: on the draft, '{}' means "the step ran and the parent skipped
-- it"; here, NULL means "this child predates the carry, and we do not know".
-- A default would erase that distinction on every existing row.
alter table public.children
  add column if not exists fp_story_answers jsonb;

comment on column public.children.fp_story_answers is
  'The kid''s answers to the First Profit v3 signup story questions, carried '
  'verbatim from fp_onboarding_drafts.answers at provisioning. Exists so the '
  'cover can be REDRAWN after the draft is reaped. NULL for every child '
  'provisioned before v3 Unit 8; {} means the answers step was skipped.';
