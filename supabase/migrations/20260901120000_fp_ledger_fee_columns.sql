-- First Profit game — Checkout Booth provider-choice lesson (Payment Phase 2,
-- Unit 2). The Checkout Booth replaces the First Profit-branded mock with a
-- provider-choice lesson: each logged sale is modeled net of the chosen
-- provider's per-sale fee (gross -> fee -> net). First Profit processes no real
-- money; the fee is a GAME-computed value the child's session inserts alongside
-- the existing mock sale row. This is a mock/learning game, so client-set fee
-- columns are acceptable (mirrors the existing source='mock' posture).
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. The placeholder slot below assumes the
--   top of supabase_migrations.schema_migrations is still 20260831120000
--   fp_children_username (the latest file in this tree at authoring time). The
--   TRUE next-free slot MUST be reconfirmed against the LIVE ledger immediately
--   before applying (a migration may have landed between authoring and the
--   gate). If the live top is not 20260831120000, RENAME this file to the real
--   next-free 12:00:00 slot before applying. Apply via the Management API
--   playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- ⚠ DEPLOY ORDERING (silent-sale-loss hazard — read before shipping FP):
--   This migration's columns AND a PostgREST schema-cache reload MUST be live in
--   prod BEFORE the First Profit build that writes gross_cents/fee_cents/
--   net_cents/provider_id deploys. If FP ships first — or a sale lands during the
--   brief schema-cache reload window right after apply — the insert fails with
--   PGRST204 ("could not find the 'gross_cents' column in the schema cache") or
--   Postgres 42703 (undefined_column). The FP client (src/lib/sync.ts,
--   classifyWriteError) now classifies those two codes as RETRYABLE, so the sale
--   PARKS in the outbox and replays once the columns are live. Pre-fix, an
--   unrecognized code was TERMINAL → the child's real sale was DROPPED forever.
--   Correct order: apply + schema-reload here → verify columns visible → deploy FP.
--
-- Additive + idempotent throughout (add column if not exists, revoke/grant is
-- last-writer-wins, each ADD CONSTRAINT guarded by a pg_constraint existence
-- check — the repo idiom). Safe on existing rows: all four columns are NULLABLE,
-- so every legacy amount-only row keeps reading (the FP client defaults a null
-- gross/fee/net back to amount_cents / 0 / amount_cents at load, never NaN), and
-- the coherence CHECK below is NULL-tolerant so legacy rows pass.

-- ------------------------------------------------------- fee snapshot columns
-- Per-sale fee snapshot. amount_cents stays = gross (back-compat); gross_cents
-- duplicates it for symmetry with fee/net. All nullable: legacy rows predate
-- the provider lesson and are defaulted at load, and a null here can never
-- brick an append-only read.
-- Type note (P3): these are bigint while amount_cents is integer. The mismatch is
-- harmless — bigint is a strict superset of integer, and the coherence CHECK below
-- ties gross_cents to amount_cents (so a value out of integer range can never
-- land). Kept bigint; the CHECK subsumes any positivity/range concern.
alter table public.fp_ledger add column if not exists gross_cents bigint;
alter table public.fp_ledger add column if not exists fee_cents   bigint;
alter table public.fp_ledger add column if not exists net_cents   bigint;
-- The chosen provider id at the moment of sale (e.g. 'first_profit_pay',
-- 'replit', 'shopify'). Free text like `payer`, NOT enum-CHECK-constrained: the
-- provider set is game data that will grow, and a hard enum here would force a
-- fresh migration for every new provider. It IS length-bounded below (like
-- payer's <= 80) so it does not break the table's bounding discipline. Null on
-- legacy rows.
-- DISPLAY SAFETY (Unit 4/5): render provider_id through React's default escaping
-- only (never dangerouslySetInnerHTML), with a safe fallback label for an
-- unknown / foreign id — a crafted value must never inject markup into the P&L.
alter table public.fp_ledger add column if not exists provider_id text;

-- --------------------------------------------------- extend child insert grant
-- The child session inserts the fee snapshot alongside the mock sale row. Mirror
-- the existing column-scoped insert grant (20260828120000) and ADD the four fee
-- columns to it. This stays column-scoped on purpose: created_at remains
-- excluded (client-forgeable-backdate hazard closed in 20260828120000), and the
-- grant is NOT broadened to a table-wide `grant insert`. The RLS insert policy
-- ("fp ledger: insert own mock") is unchanged — it still pins source='mock',
-- the amount bound, and profile ownership; the new columns ride that same
-- policy without loosening it.
revoke insert on public.fp_ledger from authenticated;
grant insert (id, profile_id, kind, source, payer, amount_cents,
              gross_cents, fee_cents, net_cents, provider_id)
  on public.fp_ledger to authenticated;

-- ------------------------------------------------ fee-column coherence CHECK
-- The RLS insert policy pins only amount_cents/source/profile — it does NOT
-- constrain the new fee columns, so a crafted insert could set net > gross, a
-- negative fee, gross != fee + net, or a net far beyond the $1,000 product cap
-- (bypassing the RLS bound via net_cents, which Unit 5 will DISPLAY as earnings).
-- This CHECK re-imposes coherence AND the cap:
--   * NULL-tolerant — gross_cents null (every legacy amount-only row) passes, so
--     it is safe on the existing table with no backfill.
--   * fee_cents/net_cents >= 0, and gross_cents = fee_cents + net_cents — the
--     ledger stays internally consistent (no negative fee, no net > gross).
--   * gross_cents = amount_cents ties the fee snapshot to the RLS-BOUNDED amount
--     (1..100000), so net_cents can never exceed the $1,000 cap either.
-- Every legitimate FP write satisfies it: the insertLedger/keepalive default path
-- writes gross=amount, fee=0, net=amount (=> gross = fee+net AND gross = amount);
-- Unit 5's computeFee snapshot writes gross=amount, fee=amount-net, net (=> the
-- same identities hold). ADD CONSTRAINT is not idempotent, so guard it with a
-- pg_constraint existence check (the repo idiom).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fp_ledger_fee_coherent') then
    alter table public.fp_ledger
      add constraint fp_ledger_fee_coherent
      check (
        gross_cents is null
        or (
          fee_cents >= 0
          and net_cents >= 0
          and gross_cents = fee_cents + net_cents
          and gross_cents = amount_cents
        )
      );
  end if;
end $$;

-- ------------------------------------------------ provider_id length bound
-- provider_id is otherwise unbounded free text, which breaks the table's bounding
-- discipline (payer is <= 80). Bound it (NULL-tolerant so legacy rows pass).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fp_ledger_provider_id_len') then
    alter table public.fp_ledger
      add constraint fp_ledger_provider_id_len
      check (provider_id is null or char_length(provider_id) <= 64);
  end if;
end $$;

-- NOTE on source/kind CHECKs (intentionally UNCHANGED here):
--   * source stays pinned to 'mock' for a real logged sale — First Profit still
--     processes no money in Phase 2, so the day-one 'mock' discriminator is
--     correct and the source CHECK ('mock','stripe_test','live') is untouched.
--     A distinct source value is a Phase 3 (real payouts) decision.
--   * kind: the FP client now inserts only 'sale' (the 'backing' concept is
--     retired at the load/insert validators), but the kind CHECK still ALLOWS
--     ('sale','backing') so any pre-existing 'backing' row stays valid at rest.
--     Narrowing the CHECK would be non-additive and is deferred to the R25
--     service-role purge; nothing here needs it.
