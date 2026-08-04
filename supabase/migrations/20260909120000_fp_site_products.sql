-- First Profit public sites — PRODUCTS projection (public-page redesign,
-- backend half): the public page at firstprofit.school/<handle> must show ALL
-- of a child's ideas as product cards, not just the active idea's one-liner.
-- This migration extends the projection pipeline with a sanitized `products`
-- jsonb array on fp_public_sites, an extraction v2 that derives it from
-- doc->'ideas', a trigger update to keep it fresh, a read-function update to
-- serve it (published state only), and a backfill for already-claimed rows.
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. Ledger-top confirmation: both prior
--   fp_public_sites migrations — 20260907120000_fp_public_sites and
--   20260908120000_fp_public_sites_ops — ARE APPLIED TO PRODUCTION, so this
--   change MUST be a new additive migration (never an in-place amendment of
--   either applied file). The slot below assumes the top of
--   supabase_migrations.schema_migrations is 20260908120000. The TRUE
--   next-free slot MUST be reconfirmed against the LIVE ledger immediately
--   before applying; if the live top is not 20260908120000, RENAME this file
--   to the real next-free 12:00:00 slot before applying. Apply via the
--   Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- AMENDMENT LOG (in-place amendments are allowed ONLY while this file is
--   branch-only / never applied — the 20260907 convention; once applied,
--   changes stack as a new migration):
--   * (none yet — initial authoring.)
--
-- ⚠ PRODUCTS ELEMENT SHAPE (cross-repo renderer contract — the first-profit
--   serving function / public renderer consumes this verbatim):
--
--     { "n": <1-based idea position>, "name": <string>, "oneLiner": <string> }
--
--   * `n`      — the idea's ORIGINAL 1-based position in doc->'ideas' (drives
--                the "Product #N" numbering). Fully-empty ideas are EXCLUDED
--                from the array but `n` preserves their slot, so numbering
--                never shifts when an unnamed idea sits between named ones.
--   * `name`   — fields.productName, blocklist-enforced (blocked → ''), then
--                truncated to 60 chars.
--   * `oneLiner` — fields.oneLiner, blocklist-enforced (blocked → ''), then
--                truncated to 140 chars (the same cap as the single-value
--                one_liner column).
--   * An idea whose extracted name AND oneLiner are BOTH '' is excluded (a
--     blank card renders nothing useful; a fully-blocked idea must not get a
--     card at all).
--   * At most 5 elements — the first-profit MAX_IDEAS cap (src/state/
--     gameCore.ts MAX_IDEAS = 5; CREATE_IDEA refuses a sixth, so only a
--     hand-crafted doc can exceed it — extraction iterates the first 5 ideas
--     ONLY and never reads beyond them).
--   * `products` = NULL sentinel from extraction when doc->'ideas' is absent
--     or not an array ("nothing extractable — do not touch the column");
--     `'[]'::jsonb` is a legitimate value that OVERWRITES (a doc whose ideas
--     all emptied must clear the live cards).
--
-- ⚠ SAVE-DOC JSON CONTRACT (unchanged gate, new paths). The docVersion-1 gate
--   and every existing path from 20260907 are UNTOUCHED; extraction v2 ADDS:
--
--     doc->'ideas'->i->'fields'->>'productName' → products[j].name    (≤60)
--     doc->'ideas'->i->'fields'->>'oneLiner'    → products[j].oneLiner (≤140)
--
--   verified 2026-08-03 against first-profit src/state/gameCore.ts toSaveDoc
--   (ideas[i].fields is Record<string,string>) and src/state/floorSelectors.ts
--   (field keys `productName`, `oneLiner`). The single-value headline/
--   one_liner extraction is byte-identical to 20260907 — the room self-read
--   contract and the projection trigger's existing consumers depend on it.
--
-- ⚠ THE NEVER-FAIL LAW IS PRESERVED (see the 20260907 header — a trigger
--   RAISE or CHECK violation on the save path classifies TERMINAL in the FP
--   sync engine and drops the learner's snapshot):
--   * The extraction stays defensive: jsonb_typeof at every step, per-idea —
--     a non-object idea element or a non-object/absent `fields` yields ''
--     leaves (→ the idea is excluded), never an error.
--   * The trigger clamps BY CONSTRUCTION (extraction emits ≤ 5 elements); the
--     table CHECK below is a BACKSTOP bounding service-role writers, written
--     as a CASE so a non-array value fails the CHECK cleanly instead of
--     erroring inside jsonb_array_length, and it can never fire on the
--     trigger's own writes.
--   * The trigger body remains wrapped in EXCEPTION WHEN OTHERS THEN RETURN
--     NEW (raise warning first — visible, never fatal).
--
-- ⚠ DEPLOY ORDERING: apply this migration + NOTIFY pgrst, 'reload schema'
--   BEFORE shipping the the120 site-core/site-gateway change that reads
--   `products` off the extraction RPC and writes it in claim/publish, and
--   BEFORE the first-profit renderer that consumes `products` from
--   fp_public_site(). Old code against the new DB is safe (extra column
--   ignored); new code against the old DB would find no `products` column.
--
-- ⚠ RETURN-TYPE CHANGES REQUIRE DROP (not CREATE OR REPLACE):
--   fp_public_site_content(jsonb) and fp_public_site(text) both gain a
--   column, so each is DROPped and recreated below, and EVERY grant/revoke
--   from 20260907/20260908 is RE-APPLIED here (a DROP discards them). The
--   drop+create runs inside the migration's transaction; nothing calls the
--   functions mid-apply.
--
-- ⚠ POST-APPLY VERIFICATION (the apply is NOT complete until this passes; run
--   via the Management API SQL endpoint, then an anon-key PostgREST call):
--   1. Column + CHECK present:
--        select jsonb_typeof(products) from public.fp_public_sites limit 1
--      → 'array' (existing rows backfilled or defaulted, never null);
--        select conname from pg_constraint
--         where conrelid = 'public.fp_public_sites'::regclass
--           and conname = 'fp_public_sites_products_bounded' → one row.
--   2. Extraction v2 probe (service key RPC):
--        select * from public.fp_public_site_content(
--          '{"docVersion":1,"siteHeadline":"h","activeIdea":0,
--            "ideas":[{"fields":{"productName":"Dog Walking",
--                                "oneLiner":"I walk dogs"}}]}'::jsonb)
--      → products = [{"n":1,"name":"Dog Walking","oneLiner":"I walk dogs"}].
--   3. PRODUCTS PROBE on the anon RPC: for a published handle,
--        select products from public.fp_public_site('<handle>')
--      → the sanitized array; for an ever-published-but-offline handle →
--        ('offline', null, null, null, null) — products NULL, content-null
--        posture unchanged; unknown/never-published handle → ZERO rows,
--        byte-identical to before (enumeration resistance unchanged).
--   4. Grants unchanged in spirit: has_function_privilege('anon',
--        'public.fp_public_site(text)', 'execute') → true (and
--      'authenticated'); for 'public.fp_public_site_content(jsonb)' → false
--      for both, true for service_role. search_path pin: proconfig for
--      fp_public_site → {search_path=public}.
--   5. Trigger round-trip: UPDATE a scratch save's doc (docVersion 1, new
--        productName) under a REAL child JWT → fp_public_sites.products
--      reflects the clamped element; docVersion 2 → row unchanged, save OK.
--   6. Backfill: Cedric's already-published row carries products ≠ '[]'
--      (his doc has at least one named idea).
--   7. Teardown of any probe rows (sites first — the amended ordering).
--
-- TS mirror: app/fp/lib/fp-public-site-rules.ts (SITE_PRODUCT_NAME_MAX_CHARS,
--   SITE_MAX_PRODUCTS, SiteProduct, extractSiteContent v2). Parity test:
--   app/fp/lib/__tests__/fp-site-products-migration-parity.test.ts (parses
--   this file as text — the security-definer-sql third-untested-copy
--   learning; no test DB in this suite).
--
-- Idempotent throughout (add column if not exists; drop-and-recreate for the
-- CHECK, functions; backfill is change-guarded) — re-applying is a no-op.
-- Additive-only: no existing column, constraint, trigger timing, RLS posture,
-- or grant is removed or narrowed.

-- ------------------------------------------------------ 1. products column
alter table public.fp_public_sites
  add column if not exists products jsonb not null default '[]'::jsonb;

-- Backstop CHECK (bounds service-role writers; the trigger clamps first so
-- this can never fire on a save projection). CASE, not bare AND: evaluation
-- order inside AND is not guaranteed, and jsonb_array_length on a non-array
-- ERRORS — the CASE makes "not an array" a clean CHECK failure instead. The
-- bound is 5 = first-profit MAX_IDEAS (gameCore.ts).
alter table public.fp_public_sites
  drop constraint if exists fp_public_sites_products_bounded;
alter table public.fp_public_sites
  add constraint fp_public_sites_products_bounded check (
    case
      when jsonb_typeof(products) = 'array' then jsonb_array_length(products) <= 5
      else false
    end
  );

-- --------------------------------------------- 2. shared extraction, v2
-- Return type gains `products` — DROP required (see header); grants re-applied
-- below. The headline/one_liner logic is byte-identical to 20260907 (the
-- single-value contract the room/self-read depends on); the products loop is
-- NEW and independent of activeIdea.
drop function if exists public.fp_public_site_content(jsonb);
create function public.fp_public_site_content(p_doc jsonb)
returns table (headline text, one_liner text, products jsonb)
language plpgsql
stable
as $$
declare
  v_headline  text  := null;
  v_one_liner text  := null;
  v_products  jsonb := null;
  v_ideas     jsonb;
  v_idea      jsonb;
  v_active    integer;
  v_count     integer;
  v_name      text;
  v_pliner    text;
  i           integer;
begin
  if p_doc is not null and jsonb_typeof(p_doc) = 'object' then
    if jsonb_typeof(p_doc->'siteHeadline') = 'string' then
      v_headline := public.fp_clamp_public_text(p_doc->>'siteHeadline', 120);
    end if;
    v_ideas := p_doc->'ideas';
    if jsonb_typeof(v_ideas) = 'array'
       and jsonb_typeof(p_doc->'activeIdea') = 'number'
       and (p_doc->>'activeIdea') ~ '^[0-9]{1,9}$' then
      v_active := (p_doc->>'activeIdea')::integer;
      if v_active < jsonb_array_length(v_ideas) then
        v_idea := v_ideas->v_active;
        if jsonb_typeof(v_idea) = 'object'
           and jsonb_typeof(v_idea->'fields') = 'object'
           and jsonb_typeof(v_idea->'fields'->'oneLiner') = 'string' then
          v_one_liner := public.fp_clamp_public_text(v_idea->'fields'->>'oneLiner', 140);
        end if;
      end if;
    end if;
    -- products v2: EVERY idea (first 5 = MAX_IDEAS only), independent of
    -- activeIdea. NULL sentinel when ideas is absent/not an array; '[]' is a
    -- legitimate overwrite (all ideas emptied → cards clear). Fully-empty
    -- ideas are EXCLUDED; `n` (1-based position) preserves the numbering.
    if jsonb_typeof(v_ideas) = 'array' then
      v_products := '[]'::jsonb;
      v_count := least(jsonb_array_length(v_ideas), 5);
      for i in 0 .. v_count - 1 loop
        v_idea := v_ideas->i;
        v_name := '';
        v_pliner := '';
        if jsonb_typeof(v_idea) = 'object'
           and jsonb_typeof(v_idea->'fields') = 'object' then
          if jsonb_typeof(v_idea->'fields'->'productName') = 'string' then
            v_name := public.fp_clamp_public_text(v_idea->'fields'->>'productName', 60);
          end if;
          if jsonb_typeof(v_idea->'fields'->'oneLiner') = 'string' then
            v_pliner := public.fp_clamp_public_text(v_idea->'fields'->>'oneLiner', 140);
          end if;
        end if;
        if v_name <> '' or v_pliner <> '' then
          v_products := v_products
            || jsonb_build_object('n', i + 1, 'name', v_name, 'oneLiner', v_pliner);
        end if;
      end loop;
    end if;
  end if;
  return query select v_headline, v_one_liner, v_products;
end;
$$;

-- Re-apply the 20260907 posture + the 20260908 service_role grant (the DROP
-- above discarded both): not a public surface; the Unit 2 endpoints call it
-- via RPC as service_role; the trigger runs as the definer owner.
revoke execute on function public.fp_public_site_content(jsonb) from public, anon, authenticated;
grant execute on function public.fp_public_site_content(jsonb) to service_role;

-- --------------------------------------------- 3. projection trigger, v2
-- Same name/signature → CREATE OR REPLACE; the AFTER trigger created in
-- 20260907 keeps pointing here (timing/order unchanged). Additions: products
-- rides the same NULL-sentinel/coalesce discipline, and the write-churn guard
-- (IS DISTINCT FROM) includes it. NEVER ERRORS — unchanged outermost
-- EXCEPTION WHEN OTHERS THEN RETURN NEW.
create or replace function public.fp_public_sites_project_save()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headline  text;
  v_one_liner text;
  v_products  jsonb;
begin
  -- Index-backed early exit FIRST (the common no-site-row case must not pay
  -- jsonb extraction on every ~3s save; a WHEN clause cannot hold a subquery).
  if not exists (
    select 1 from public.fp_public_sites s where s.profile_id = NEW.profile_id
  ) then
    return NEW;
  end if;
  if NEW.doc is null or jsonb_typeof(NEW.doc) is distinct from 'object' then
    return NEW;
  end if;
  if jsonb_typeof(NEW.doc->'docVersion') is distinct from 'number'
     or (NEW.doc->>'docVersion') is distinct from '1' then
    return NEW;
  end if;
  select c.headline, c.one_liner, c.products
    into v_headline, v_one_liner, v_products
    from public.fp_public_site_content(NEW.doc) c;
  if v_headline is null and v_one_liner is null and v_products is null then
    return NEW;
  end if;
  -- Change-guarded: no new tuple version every ~3s with unchanged content
  -- (NULL sentinel = keep, so coalesce mirrors SET; products included).
  update public.fp_public_sites s
     set headline   = coalesce(v_headline, s.headline),
         one_liner  = coalesce(v_one_liner, s.one_liner),
         products   = coalesce(v_products, s.products),
         updated_at = now()
   where s.profile_id = NEW.profile_id
     and (s.headline is distinct from coalesce(v_headline, s.headline)
          or s.one_liner is distinct from coalesce(v_one_liner, s.one_liner)
          or s.products is distinct from coalesce(v_products, s.products));
  return NEW;
exception
  when others then
    -- A raise EXCEPTION here would classify TERMINAL in the FP sync engine
    -- and drop the learner's snapshot. Projection staleness is the only
    -- acceptable failure mode — visible in the logs, never silent.
    raise warning 'fp_public_sites_project_save failed: % %', SQLSTATE, SQLERRM;
    return NEW;
end;
$$;

revoke execute on function public.fp_public_sites_project_save() from public, anon, authenticated;

-- --------------------------------------------- 4. public read function, v2
-- Gains `products` for the PUBLISHED state ONLY: the offline row stays
-- content-null (products included), and never-published/unknown handles stay
-- ZERO rows byte-identical — enumeration resistance unchanged. Return type
-- change → DROP + recreate; SECURITY DEFINER / STABLE / pinned search_path /
-- explicit grants re-applied verbatim.
drop function if exists public.fp_public_site(text);
create function public.fp_public_site(p_handle text)
returns table (state text, first_name text, headline text, one_liner text, products jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when s.published and not s.operator_locked then 'published' else 'offline' end,
    case when s.published and not s.operator_locked then s.first_name end,
    case when s.published and not s.operator_locked then s.headline end,
    case when s.published and not s.operator_locked then s.one_liner end,
    case when s.published and not s.operator_locked then s.products end
  from public.fp_public_sites s
  where lower(btrim(coalesce(p_handle, ''))) ~ '^[a-z0-9-]{3,20}$'
    and s.handle = lower(btrim(p_handle))
    and ((s.published and not s.operator_locked) or s.first_published_at is not null);
$$;

revoke execute on function public.fp_public_site(text) from public;
grant execute on function public.fp_public_site(text) to anon, authenticated;

-- --------------------------------------------------------- 5. backfill
-- Existing rows (Cedric's already-published page included) gain products on
-- apply: one UPDATE joining the saves through the NEW extraction, gated by
-- the SAME docVersion-1 rule as the trigger, change-guarded (re-apply is a
-- no-op), NULL-sentinel-respecting (an unextractable doc touches nothing —
-- the column keeps its '[]' default).
update public.fp_public_sites s
   set products   = c.products,
       updated_at = now()
  from public.fp_player_saves ps
 cross join lateral public.fp_public_site_content(ps.doc) c
 where ps.profile_id = s.profile_id
   and jsonb_typeof(ps.doc->'docVersion') = 'number'
   and ps.doc->>'docVersion' = '1'
   and c.products is not null
   and s.products is distinct from c.products;
