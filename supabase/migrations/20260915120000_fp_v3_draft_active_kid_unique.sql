-- New User Flow v3 (Unit 3, review FIX 2): make the DATABASE the arbiter of the
-- duplicate-kid guard on public.fp_onboarding_drafts. Plan:
-- docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md ("Duplicate-kid
-- guard" under Key Technical Decisions).
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED, AND THE LIVE LEDGER WAS NOT READABLE
--   AT AUTHORING TIME. The canonical pre-authoring query
--
--     select version, name from supabase_migrations.schema_migrations
--     order by version desc limit 5;
--
--   COULD NOT BE RUN when this file was written (the SUPABASE_ACCESS_TOKEN in
--   .env.local returns 401 — a dead token), so the slot below is PROVISIONAL:
--   it is derived only from the repo file listing, whose top was
--   20260914120000_fp_v3_verify_code_and_photo_consent, and the repo listing is
--   explicitly NOT the truth (docs/LANES.md: three version collisions are on
--   record, all from applied-but-unmerged migrations). RUN THE QUERY ABOVE
--   IMMEDIATELY BEFORE APPLYING and RENAME this file (and its three siblings,
--   20260912120000 / 20260913120000 / 20260914120000, keeping their relative
--   order — this one MUST stay after 20260912120000, which creates the table) to
--   the real next-free 12:00:00 slots if any of these versions are taken. Apply
--   via the Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand beyond recording the version.
--
-- AMENDMENT LOG (in-place amendments allowed ONLY while this file is
--   branch-only / never applied; once applied, changes stack as a new
--   migration):
--   * (none yet — initial authoring.)
--
-- ⚠ DEPLOY ORDERING: lands BEFORE the v3AddKid code that treats its 23505 as the
--   duplicate outcome (migration-before-code, repo law). Applying it early is
--   safe: without the code, the index simply refuses a duplicate insert that the
--   app-level pre-check almost always caught first anyway.
--
-- ── WHAT THIS FIXES ──
-- `v3AddKid` read the parent's existing kids, ran `findDuplicateKid`, and then
-- inserted attempt + consent + draft with NO constraint and NO locking. Two
-- concurrent calls both saw an empty state, both passed, and each minted its own
-- attempt (state 'verified') + consent + draft. Because `consentGate` binds one
-- consent per ATTEMPT, and `createChild`'s idempotency key IS the attempt id,
-- both drafts could then reach provisioning INDEPENDENTLY and mint DISTINCT
-- children, auth accounts and path_student_profiles rows — two live logins and
-- two consent records for one child. Reachable by an ordinary double-click or a
-- retried POST, not only by malice. A unique index is the only thing that makes
-- the loser lose.
--
-- ── WHY THE KEY IS (parent, first, last) AND NOT JUST (parent) ──
-- The review's default suggestion was `(parent_id) WHERE status = 'active'` —
-- one live draft per parent. That is simpler, but it is NOT this flow's design,
-- and the code says so in two places:
--   * `loadV3OnboardingState` deliberately builds `existingKids` from "live
--     drafts OTHER than the one being resumed"
--     (`rows.filter(d => d.status === 'active' && d.id !== draft?.id)`). That
--     branch is only meaningful if a parent CAN hold more than one active draft;
--     under a parent-only key it would be dead code by construction.
--   * Nothing in Unit 3 can retire an active draft on demand. `status` flips to
--     `consumed` only at successful provisioning, and to `reaped` only after 30
--     days of inactivity. So a parent who abandons kid A mid-cover and comes
--     back to add kid B would hit a 23505 that the UI cannot resolve: the only
--     affordance offered is "This is a different child", which re-submits with
--     `differentChild: true` and hits the SAME index again. A permanent wedge,
--     for a family doing something entirely legitimate.
-- Keying on the NAME fixes exactly the reported defect (two tabs, one kid → one
-- draft) and leaves the legitimate two-kids-in-flight flow working. The number
-- of distinct names in flight is bounded separately, in application code, by
-- V3_MAX_ACTIVE_DRAFTS_PER_PARENT (review FIX 7).
--
-- ── NORMALIZATION: lower(), AND WHY THAT IS ENOUGH ──
-- The app compares names with `kidNameKey` (NFKC + trim + inner-whitespace
-- collapse + lowercase). An index expression must be IMMUTABLE, and `lower()` on
-- text is; a full NFKC pipeline in SQL is not worth building here. The two are
-- deliberately NOT equal, and the split is safe because they play different
-- roles: the app-level guard is the one that produces the good message and
-- catches near-misses ("Maya " vs "Maya"), while the index is the arbiter for
-- the case the app-level guard structurally cannot win — the SAME bytes arriving
-- twice concurrently, where `lower()` and `kidNameKey` always agree. The names
-- are also written by ONE writer (`validateKidInput`, which already trims and
-- collapses whitespace before the insert), so the residual gap is narrower still.
--
-- PARTIAL, on status = 'active': `consumed` drafts are finished work and
-- accumulate one per child forever (a family with two kids called Alex, minted a
-- year apart, must not be blocked), and `reaped` rows are tombstones. Only LIVE
-- drafts are the thing there may be exactly one of.
--
-- NULL NAMES: rows with a NULL kid_first_name/kid_last_name are never equal
-- under a unique index, so a draft minted before the kid was named (not a shape
-- v3AddKid produces — it always writes both, last name as '') is simply not
-- constrained. Fail-open on a shape the writer cannot emit.
--
-- Idempotent (create unique index if not exists). Additive-only: no existing row
-- is read or rewritten. NOTE: `create unique index` (not CONCURRENTLY) is
-- correct here and matches the repo's other index migrations — the Management
-- API applies each migration in one implicit transaction, which CONCURRENTLY
-- cannot run inside, and this table is new and effectively empty.

create unique index if not exists fp_onboarding_drafts_active_kid_uq
  on public.fp_onboarding_drafts (
    parent_id,
    lower(kid_first_name),
    lower(kid_last_name)
  )
  where status = 'active';

comment on index public.fp_onboarding_drafts_active_kid_uq is
  'One LIVE onboarding draft per parent per kid name. The arbiter for v3AddKid''s duplicate-kid guard: its 23505 is the authoritative duplicate/resume outcome, because the app-level pre-check is check-then-act and cannot survive two concurrent calls.';
