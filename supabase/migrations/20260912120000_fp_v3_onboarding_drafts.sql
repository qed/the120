-- New User Flow v3 (Unit 1): public.fp_onboarding_drafts — the pre-account
-- working state of the kid-first onboarding flow. Plan:
-- docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md ("Draft record is a
-- table, not client state").
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
--   20260911120000_fp_save_doc_guard_tombstones, and the repo listing is
--   explicitly NOT the truth (docs/LANES.md: three version collisions are on
--   record, all from applied-but-unmerged migrations). RUN THE QUERY ABOVE
--   IMMEDIATELY BEFORE APPLYING and RENAME this file (and its two siblings,
--   20260913120000 and 20260914120000, keeping their relative order) to the
--   real next-free 12:00:00 slots if any of these versions are taken. Apply via
--   the Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand beyond recording the version.
--
-- AMENDMENT LOG (in-place amendments allowed ONLY while this file is
--   branch-only / never applied; once applied, changes stack as a new
--   migration):
--   * (none yet — initial authoring.)
--
-- ⚠ DEPLOY ORDERING: this migration lands BEFORE any Unit 2/3/4 code that
--   reads or writes a draft (migration-before-code, repo law). No live code
--   references this table today, so applying it is inert.
--
-- RLS POSTURE — SERVICE-ROLE ONLY: RLS enabled, ZERO policies, all grants
--   revoked from anon/authenticated. Identical to fp_signup_attempts
--   (20260829120000) and for the same reason: a draft carries a child's first
--   and last name, age, free-text answers, and a blob key pointing at the
--   child's PHOTO. None of that may be reachable through PostgREST with the
--   anon key that ships in every SPA bundle. The v3 Server Actions and the
--   cover route touch this table ONLY through the service-role client and
--   return verdicts to the browser as JSON.
--
-- FK POSTURE — parent_id ON DELETE CASCADE, deliberately NOT the consent
--   table's SET NULL and NOT the FP game tables' RESTRICT:
--     * A draft is PRE-ACCOUNT WORKING STATE, not evidence. Unlike
--       fp_parental_consent (SET NULL: a consent record is compliance evidence
--       that must SURVIVE the deletion of the parent/child it references, so an
--       R28 erasure deletes it explicitly and in order), a parentless draft has
--       no evidentiary value at all — it is a half-typed form holding a minor's
--       name and photo key. Keeping it after the parent is gone is a pure
--       liability, so it goes with them.
--     * Unlike the FP game tables' RESTRICT (which exists to force the
--       documented FP-aware deletion ORDER — ledger -> saves -> profile ->
--       child — so nobody silently destroys progress by deleting a child),
--       a draft must never BLOCK a parent deletion. CASCADE both removes the
--       liability and keeps the erasure path unobstructed.
--     * Note for R28: CASCADE removes the ROW, not the BLOB. The erasure
--       entrypoint must enumerate and delete the draft's photo/cover blobs
--       BEFORE deleting the parent, exactly as the reaper does (blob deleted
--       only after no row references its key — the two-store rule in
--       app/fp/lib/cover-store-rules.ts).
--   child_id / signup_attempt_id are ON DELETE SET NULL: those are pointers
--   used for reconciliation, and losing the pointer must not take the draft's
--   own reaping state (or the parent's dashboard view of it) with it.
--
-- Idempotent throughout (create ... if not exists; constraint adds guarded by a
-- pg_constraint existence check — the repo idiom). Additive-only: this file
-- creates a NEW table and touches nothing that exists.

create table if not exists public.fp_onboarding_drafts (
  id uuid primary key default gen_random_uuid(),

  -- The owning parent. CASCADE — see the FK POSTURE block above.
  parent_id uuid not null references auth.users (id) on delete cascade,

  -- Stamped at provisioning, AFTER createChild returns ok. This is the REAPER'S
  -- OWN-COLUMN SIGNAL and the reason it exists: the reaper must never touch a
  -- draft whose child is real, and it must not learn that fact by JOINING to
  -- fp_signup_attempts. That join is UNRELIABLE — child-core's step-10 attempt
  -- advance to 'child_created' is deliberately NON-FATAL (the child is already
  -- playable; failing the request there would be worse), so a perfectly good
  -- child can sit behind an attempt still in state 'verified'. Reaping on the
  -- attempt join would then delete a live child's cover blob. The draft's own
  -- child_id + status columns are the only trustworthy signal.
  child_id uuid references public.children (id) on delete set null,

  -- The attempt this draft was collected under (one attempt per kid, per the
  -- add-another-kid loop). Reconciliation/diagnostics only — never a reaper key.
  signup_attempt_id uuid references public.fp_signup_attempts (id) on delete set null,

  kid_first_name text,
  kid_last_name text,
  -- Sane bound, NOT a demographic claim: it exists so a caller bug or a typo
  -- cannot bank a nonsense age on a record that later carries to the child.
  -- A PLAIN check is correct here (NOT the NOT VALID + separate VALIDATE split
  -- required for a POPULATED table): this table is brand new and empty at apply
  -- time, so the constraint is established instantly with nothing to scan.
  kid_age int,

  -- The optional story-question answers. jsonb + default '{}' so a draft saved
  -- before the story step is indistinguishable in shape from one saved after.
  answers jsonb not null default '{}'::jsonb,

  -- Vercel Blob keys, namespaced by this draft's id (see cover-store-rules.ts).
  -- photo_blob_key is nulled after a successful `final` generation (the source
  -- photo of a minor is the main retention liability once the vendor is ZDR);
  -- cover_blob_key survives to be COPIED to a child-namespaced key at carry.
  photo_blob_key text,
  cover_blob_key text,

  -- TEXT + CHECK, never a native enum. Repo precedent (fp_signup_attempts.state,
  -- fp_parental_consent.child_age_band): adding a value to a CHECK is a drop +
  -- re-add of one constraint in an additive-only migration, whereas ALTER TYPE
  -- ... ADD VALUE on a native enum cannot run inside the single implicit
  -- transaction our Management-API applies use, and enum values can never be
  -- removed. Cover statuses are expected to GROW (the plan already anticipates
  -- fallback variants), so cheap additive evolution is the whole point.
  --   none                   — no cover attempted yet
  --   generating             — a generation is in flight (the reaper's
  --                            stale-generating timeout applies to this)
  --   final                  — a real generated cover, blob confirmed written
  --   fallback_pending_regen — template cover shown, background regen queued
  --   fallback_permanent     — template cover is terminal (repeated failure)
  --   cap_exhausted          — the per-kid generation cap is spent
  --   reaped                 — the reaper deleted the blobs for this draft
  cover_status text not null default 'none',

  -- Durable per-kid generation counter. Load-bearing (the in-memory rate limiter
  -- is per-instance and empty on cold start, so it is only a volumetric
  -- backstop). Carried to the child at provisioning so the cap survives the
  -- draft.
  generation_count int not null default 0,

  --   active   — in progress or abandoned-but-not-yet-reaped
  --   consumed — a child was minted from this draft. Stamped ONLY AFTER
  --              createChild returns ok: stamping before would leave a consumed
  --              draft with no child when the core's reverse-order compensation
  --              fires, and the dashboard would then show neither the draft nor
  --              a kid.
  --   reaped   — terminal; blobs deleted. A STATUS FLIP, NOT A ROW DELETE, so
  --              the dashboard can show the reaped state honestly and the sweep
  --              is idempotent/re-runnable.
  status text not null default 'active',

  created_at timestamptz not null default now(),
  -- ⚠ updated_at IS THE REAPING CLOCK, not created_at. Every write to the draft
  -- (a resumed flow, a re-run cover, an edited answer) must bump it. A family
  -- that started 29 days ago and came back today has a 29-day-old created_at
  -- and a fresh updated_at, and MUST NOT be reaped out from under the tab they
  -- are looking at. Bumped by the writing core, not by a trigger: every writer
  -- here is our own service-role code, and an invisible trigger would be one
  -- more thing to reason about during the two-store blob dance.
  updated_at timestamptz not null default now()
);

-- Constraint adds are not idempotent on their own; guard each (repo idiom).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fp_onboarding_drafts_kid_age_sane') then
    alter table public.fp_onboarding_drafts
      add constraint fp_onboarding_drafts_kid_age_sane
      check (kid_age is null or (kid_age >= 4 and kid_age <= 25));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fp_onboarding_drafts_cover_status') then
    alter table public.fp_onboarding_drafts
      add constraint fp_onboarding_drafts_cover_status
      check (cover_status in (
        'none',
        'generating',
        'final',
        'fallback_pending_regen',
        'fallback_permanent',
        'cap_exhausted',
        'reaped'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fp_onboarding_drafts_status') then
    alter table public.fp_onboarding_drafts
      add constraint fp_onboarding_drafts_status
      check (status in ('active', 'consumed', 'reaped'));
  end if;
end $$;

-- The REAPER PREDICATE index: the sweep asks for `status = 'active'` drafts
-- ordered/filtered by updated_at (the reaping clock). Partial on the status so
-- consumed/reaped rows — which accumulate forever and are never reap candidates
-- — stay out of the index entirely.
create index if not exists fp_onboarding_drafts_reaper_idx
  on public.fp_onboarding_drafts (updated_at)
  where status = 'active';

-- Parent lookup: the dashboard lists a parent's live drafts alongside their
-- kids, and the duplicate-kid guard reads it on every add-another-kid entry.
create index if not exists fp_onboarding_drafts_parent_idx
  on public.fp_onboarding_drafts (parent_id);

-- The provisioning back-reference (draft <-> child reconciliation, and the
-- background-regen writer following a consumed draft's child_id stamp).
create index if not exists fp_onboarding_drafts_child_idx
  on public.fp_onboarding_drafts (child_id);

-- ------------------------------------------------------------- RLS: lock down
-- Service-role only. RLS enabled, ZERO policies, all grants revoked from the
-- client roles — matching fp_signup_attempts exactly.
alter table public.fp_onboarding_drafts enable row level security;
revoke all on public.fp_onboarding_drafts from anon, authenticated;
