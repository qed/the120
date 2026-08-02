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
-- Additive + idempotent throughout (add column if not exists, revoke/grant is
-- last-writer-wins). Safe on existing rows: all four columns are NULLABLE, so
-- every legacy amount-only row keeps reading (the FP client defaults a null
-- gross/fee/net back to amount_cents / 0 / amount_cents at load, never NaN).

-- ------------------------------------------------------- fee snapshot columns
-- Per-sale fee snapshot. amount_cents stays = gross (back-compat); gross_cents
-- duplicates it for symmetry with fee/net. All nullable: legacy rows predate
-- the provider lesson and are defaulted at load, and a null here can never
-- brick an append-only read.
alter table public.fp_ledger add column if not exists gross_cents bigint;
alter table public.fp_ledger add column if not exists fee_cents   bigint;
alter table public.fp_ledger add column if not exists net_cents   bigint;
-- The chosen provider id at the moment of sale (e.g. 'first_profit_pay',
-- 'replit', 'shopify'). Free text like `payer`, NOT CHECK-constrained: the
-- provider set is game data that will grow, and a hard enum here would force a
-- fresh migration for every new provider. Null on legacy rows.
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
