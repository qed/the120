-- New User Flow v3 (Unit 1): public.fp_handoff_codes — the one-time,
-- fragment-delivered sign-in code that carries a just-provisioned kid from
-- the120.school into firstprofit.school. Plan:
-- docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md ("Handoff = fragment
-- delivered one-time code").
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED, AND THE LIVE LEDGER WAS NOT READABLE
--   AT AUTHORING TIME. The canonical pre-authoring query
--
--     select version, name from supabase_migrations.schema_migrations
--     order by version desc limit 5;
--
--   COULD NOT BE RUN when this file was written (the SUPABASE_ACCESS_TOKEN in
--   .env.local returns 401 — a dead token), so this slot is PROVISIONAL and
--   derived only from the repo file listing (top: 20260911120000
--   fp_save_doc_guard_tombstones), which docs/LANES.md says is explicitly NOT
--   the truth. RUN THE QUERY IMMEDIATELY BEFORE APPLYING and RENAME this file
--   — keeping it ordered AFTER 20260912120000_fp_v3_onboarding_drafts and
--   BEFORE 20260914120000_fp_v3_verify_code_and_photo_consent — if the version
--   is taken. Apply via the Management API playbook
--   (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--
-- AMENDMENT LOG (in-place amendments allowed ONLY while this file is
--   branch-only / never applied):
--   * (none yet — initial authoring.)
--
-- ⚠ DEPLOY ORDERING: lands BEFORE Unit 5's mint action and exchange route.
--   Inert until then.
--
-- RLS POSTURE — SERVICE-ROLE ONLY: RLS enabled, ZERO policies, all grants
--   revoked from anon/authenticated (matching fp_signup_attempts). A row here is
--   a bearer credential for a child's session; the anon key must not be able to
--   read one, and the CAS consume must be unforgeable from the client.
--
-- FK POSTURE — child_id NOT NULL, ON DELETE CASCADE. Deliberate, and different
--   from BOTH of the repo's other postures:
--     * NOT RESTRICT (the FP game tables' posture). RESTRICT exists there to
--       force the documented FP-aware deletion ORDER (ledger -> saves -> profile
--       -> child) so nobody destroys progress by surprise. A 120-SECOND piece of
--       operational ephemera has no business joining that ledger: an unconsumed
--       handoff code minted two minutes before an erasure run would BLOCK the
--       delete and break a documented, tested order for no benefit.
--     * NOT SET NULL (the consent table's posture). SET NULL is right for
--       compliance EVIDENCE that must outlive its subject. A handoff row whose
--       child_id is null is meaningless — it authorizes a session for nobody and
--       can never be consumed. It would be dangling noise in the replay-signal
--       substrate, not evidence.
--   CASCADE is the honest posture: when the child is gone, so is every code
--   that could ever have signed in as them.
--
-- Idempotent throughout (create ... if not exists). Additive-only: a NEW table.

create table if not exists public.fp_handoff_codes (
  id uuid primary key default gen_random_uuid(),

  -- sha256 hex of the >=128-bit CSPRNG code; only the hash is stored. UNIQUE is
  -- doing TWO jobs and both are load-bearing:
  --   (1) it is the LOOKUP INDEX (the exchange route has nothing but the code),
  --   (2) it is the CAS TARGET for the single-use consume.
  -- The consume is ONE conditional statement and never a SELECT-then-use:
  --
  --     update public.fp_handoff_codes
  --        set used_at = now(), consumed_ip = $2, consumed_ua = $3
  --      where code_hash = $1
  --        and used_at is null
  --        and expires_at > now()
  --     returning child_id;
  --
  -- Zero rows returned means "not claimable" (unknown, already used, or
  -- expired) and the caller then classifies with a separate read for the replay
  -- LOG only — never to decide the grant. A read-then-write here would let two
  -- concurrent exchanges both observe used_at IS NULL and both mint a session
  -- (docs/solutions: a-read-only-gate-over-a-nullable-binding-column).
  -- Unlike the 6-digit email code (10^6 entropy, attempt-scoped CAS), this code
  -- is >=128 bits, so a GLOBAL hash lookup is safe: cross-row collisions are not
  -- a real event at that width.
  code_hash text not null unique,

  child_id uuid not null references public.children (id) on delete cascade,

  created_at timestamptz not null default now(),
  -- 120s TTL, stamped by the minting core (not a DB default): the TTL is a
  -- product decision that belongs next to the mint, and a default here would
  -- silently paper over a caller that forgot to set it.
  expires_at timestamptz not null,

  -- Null until consumed. The CAS above flips it; it is never set twice.
  used_at timestamptz,

  -- REPLAY SIGNAL CONTEXT, not access control. When a consumed code is
  -- presented again, the row we already have plus these two fields tell us
  -- whether the replay came from the same client that legitimately consumed it
  -- (a double-submit / retried tab) or from somewhere else (a leaked fragment).
  -- Default '' rather than null so "we did not record it" and "it was empty" do
  -- not need distinguishing, matching fp_signup_attempts.ip/ua.
  consumed_ip text not null default '',
  consumed_ua text not null default ''
);

-- The cleanup sweep's key. Consumed/expired rows are kept briefly (7-30 days)
-- because they ARE the replay-detection substrate — a deleted row cannot tell
-- you that a code was replayed — and are swept by expires_at afterwards.
create index if not exists fp_handoff_codes_expires_at_idx
  on public.fp_handoff_codes (expires_at);

-- Per-child lookup for the second-handoff copy and for R28 enumeration.
create index if not exists fp_handoff_codes_child_idx
  on public.fp_handoff_codes (child_id);

-- ------------------------------------------------------------- RLS: lock down
alter table public.fp_handoff_codes enable row level security;
revoke all on public.fp_handoff_codes from anon, authenticated;
