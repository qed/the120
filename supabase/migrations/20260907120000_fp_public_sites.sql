-- First Profit game — fp_public_sites: the real-public-site registry +
-- projection (first-profit repo plan
-- docs/plans/2026-08-03-002-feat-real-public-site-plan.md, Unit 1). One row
-- per learner site at firstprofit.school/<handle>: the atomic-claim registry
-- (handle uniqueness IS the claim arbiter), the sanitized content projection
-- (first_name / headline / one_liner) the public page renders, and the two
-- independent visibility flags (`published`, parent/child-controlled;
-- `operator_locked`, operator-only, always wins). Writes are service-role only
-- (the120 /api/fp/* claim/publish endpoints, Unit 2) plus the clamping
-- projection trigger below; the ONLY public read is the narrow SECURITY
-- DEFINER function fp_public_site(handle).
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. The placeholder slot below assumes the
--   top of supabase_migrations.schema_migrations is still 20260906120000
--   fp_save_doc_guard (the latest file in this tree at authoring time). The
--   TRUE next-free slot MUST be reconfirmed against the LIVE ledger
--   immediately before applying. If the live top is not 20260906120000,
--   RENAME this file to the real next-free 12:00:00 slot before applying. Apply via
--   the Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- ⚠ DEPLOY ORDERING: this migration + a PostgREST schema-cache reload MUST be
--   live BEFORE the Unit 2 the120 endpoints and BEFORE the first-profit
--   serving function (Unit 3) that calls fp_public_site(). Ordering per the
--   additive-column learning: apply → NOTIFY pgrst, 'reload schema' → verify
--   callable → only then ship dependent code. The projection trigger itself is
--   safe to deploy ahead of everything: with zero fp_public_sites rows its
--   UPDATE matches nothing and every save proceeds untouched.
--
-- ⚠ SAVE-DOC JSON CONTRACT (cross-repo parser coupling). The projection
--   trigger below is a SECOND CONSUMER of the first-profit SaveDoc JSON shape
--   (first-profit repo: src/state/gameCore.ts `toSaveDoc` / `DOC_VERSION`;
--   one-liner path per src/state/floorSelectors.ts `ideaOneLiner`). The exact
--   paths parsed, verified against that code 2026-08-03:
--
--     doc->>'docVersion'                                = '1'   (gate; number 1)
--     doc->>'siteHeadline'                              → headline  (≤120)
--     doc->'ideas'->(activeIdea)->'fields'->>'oneLiner' → one_liner (≤140)
--     doc->>'activeIdea'   non-negative integer index into doc->'ideas'
--
--   The doc lands in public.fp_player_saves.doc (jsonb) via the SPA's CAS
--   update (first-profit src/lib/sync.ts `saveSnapshot`). A stale CAS write
--   matches zero rows, so this row trigger never fires on superseded content.
--   Any toSaveDoc shape change or docVersion bump in first-profit MUST update
--   this trigger (a reciprocal comment sits at gameCore.ts DOC_VERSION); the
--   docVersion gate means an unknown future shape is SKIPPED, never misparsed.
--
-- ⚠ THE TRIGGER NEVER ERRORS — this is a correctness requirement, not
--   defensive garnish. The FP sync engine classifies P0001 (any trigger RAISE)
--   and CHECK violations as TERMINAL (src/lib/sync.ts `classifyWriteError`):
--   the learner's snapshot would be parked WITHOUT REPLAY and their progress
--   dropped over a long headline. So: length caps are enforced by TRUNCATION
--   (left()), extraction is defensive (jsonb_typeof at every step, activeIdea
--   validated as a bounded non-negative integer — never a bare ::int cast on
--   client-writable JSON, and never a negative index: jsonb `-1` means "last
--   element", which the client rejects), and the whole body is wrapped in
--   EXCEPTION WHEN OTHERS THEN RETURN NEW. No CHECK constraint on save-doc
--   CONTENT exists anywhere (the table CHECKs below bound only what the
--   trigger/service role themselves write, post-clamp).
--
-- TRIGGER ORDER (fp_player_saves now carries THREE triggers):
--   BEFORE UPDATE, name order: fp_player_saves_doc_guard (20260906120000 —
--   may MUTATE NEW.doc, grafting monotonic keys an old-build writer omitted)
--   then fp_player_saves_revision_guard. The projection trigger below is the
--   only AFTER trigger, so it always runs LAST and sees NEW.doc AS PERSISTED —
--   including any doc-guard repair — never the writer's pre-repair payload.
--   That is load-bearing: projecting from a BEFORE trigger could read a doc
--   the guard was about to rewrite. The guard never touches the projected
--   paths (siteHeadline / activeIdea / fields.oneLiner), so its repairs cannot
--   change projection output for IN-BOUNDS saves. ACCEPTED-BY-DESIGN edge: the
--   guard's tail-append of unmatched OLD ideas can make a writer's
--   out-of-bounds activeIdea land IN-bounds post-repair, projecting a grafted
--   OLD idea's one-liner — CORRECT under the "project the persisted doc"
--   contract (the appended idea IS in the stored doc; the row simply reflects
--   what fp_public_site() would read anyway). docVersion gates differ BY
--   DESIGN: the doc guard gates on OLD/NEW *agreement* (any version, schema
--   consensus for a repair); this projection gates on the *absolute* version
--   '1' it knows how to parse.
--
-- ⚠ POST-APPLY VERIFICATION (the apply is NOT complete until this passes;
--   run via the Management API SQL endpoint, then an anon-key PostgREST call):
--   1. Seed probe rows against a scratch/test profile (three states):
--        a. published:      published=true,  first_published_at=now()
--        b. unpublished:    published=false, first_published_at=now()
--        c. never-published: published=false, first_published_at=null
--   2. Anon-key RPC `select * from fp_public_site('<handle>')` per state:
--        a → one row ('published', first_name, headline, one_liner)
--        b → one row ('offline', null, null, null)
--        c → ZERO rows, byte-identical to an unknown handle probe.
--   3. Grants:  select has_function_privilege('anon',
--        'public.fp_public_site(text)', 'execute')            → true
--      and the same for 'authenticated' → true; for
--        'public.fp_public_site_content(jsonb)'               → false (both).
--      search_path pin: select proconfig from pg_proc
--        where proname = 'fp_public_site'                     → {search_path=public}.
--   4. Trigger presence/timing: select tgname from pg_trigger
--        where tgrelid = 'public.fp_player_saves'::regclass and not tgisinternal
--      → includes fp_public_sites_project_save (AFTER, i.e. tgtype timing bit
--      clear) alongside the two BEFORE guards.
--   5. Direct-table anon read refusal: anon-key PostgREST
--        GET /fp_public_sites → permission denied / empty 401-class result,
--      never rows.
--   6. Projection probe: UPDATE the scratch save row's doc (docVersion 1, new
--      siteHeadline) under a REAL child JWT → fp_public_sites row reflects the
--      clamped value; then with docVersion 2 → row unchanged, save succeeds.
--   7. Teardown: delete probe rows (sites FIRST — the amended ordering).
--
-- ⚠ DELETE POSTURE — RESTRICT, matching the FP graph (fp_player_tables
--   header): deleting a profile out from under a live public page must FAIL
--   LOUDLY. This table AMENDS the documented FP-aware service-role deletion
--   ordering, joining it as the FIRST step:
--
--       sites → ledger → saves → profile → child
--
--   The explicit procedure (app/lib/funnel/erase-family-core.ts — which must
--   gain the fp_public_sites step in Unit 2; until then a claimed site strands
--   that erase loudly, which is the designed RESTRICT behavior, not a bug)
--   decides handle disposition EXPLICITLY at deletion time — reclaimable vs
--   retired is a recorded policy call, never an implicit CASCADE side effect —
--   and an OPERATOR-LOCKED handle is NEVER silently freed: the procedure must
--   refuse (or explicitly retire) a locked row, not release it to the pool.
--
-- ENUMERATION RESISTANCE (R20 posture): fp_public_site() returns the IDENTICAL
--   empty result for an unknown handle and a claimed-but-never-published
--   handle (`first_published_at` is the discriminator) — the anon RPC is
--   directly callable at the Supabase URL, and must not be a registry oracle
--   for children who never went public. The `offline` state (no content) is
--   returned ONLY for ever-published, currently-hidden pages.
--
-- RLS: enabled on both tables with ZERO client policies — deliberate, not an
--   omission (the rls-enabled-zero-policies learning requires this said out
--   loud): every write is service-role (bypasses RLS), the public read is the
--   SECURITY DEFINER function only, and the reserved list is read by the
--   Unit 2 endpoints via service role. No anon/authenticated grant on either
--   table, ever — availability/enumeration is not served by table reads.
--
-- TS mirror: app/fp/lib/fp-public-site-rules.ts (handle pattern, caps,
--   docVersion gate, reserved list). Parity test:
--   app/fp/lib/__tests__/fp-public-sites-migration-parity.test.ts — no test DB
--   in this suite, so the SQL is parsed as text (the security-definer-sql
--   third-untested-copy learning).
--
-- Idempotent throughout (create ... if not exists / drop-and-create for
-- policies, triggers, functions; seed upserts on conflict do nothing) —
-- re-applying is a no-op. Additive-only.

-- ------------------------------------------------------------ fp_public_sites
create table if not exists public.fp_public_sites (
  -- one site per learner; PK doubles as the UNIQUE the plan requires, matching
  -- fp_player_saves' shape. RESTRICT: see DELETE POSTURE above.
  profile_id uuid primary key references public.fp_player_profiles (id) on delete restrict,
  -- the claimed public handle. Stored lowercase BY CONSTRUCTION: the CHECK
  -- charset has no uppercase, so a mixed-case write is refused outright
  -- (service-role writers normalize first; there is no client write path).
  -- UNIQUE is the atomic-claim arbiter (unique-violation = designed `taken`
  -- branch in Unit 2, per the client-minted-idempotency-key learning).
  handle text not null unique
    check (handle ~ '^[a-z0-9-]{3,20}$'),
  -- sanitized public content projection. Bounded (bounding discipline, like
  -- payer <= 80 on fp_ledger); the trigger below TRUNCATES to these caps
  -- before writing, so the CHECKs bound service-role writers, never a save.
  first_name text not null default '' check (char_length(first_name) <= 80),
  headline   text not null default '' check (char_length(headline) <= 120),
  one_liner  text not null default '' check (char_length(one_liner) <= 140),
  -- parent/child-controlled visibility. Flipped ONLY by the Unit 2 publish/
  -- unpublish endpoints — never inferred from save-doc writes (onboarding
  -- saves land before completion; a projection-inferred publish would make
  -- abandoned onboardings look live, violating R9b).
  published boolean not null default false,
  -- null until the FIRST publish. The R9b/R9d discriminator (never-published =
  -- invisible; ever-published = may show `offline`) AND the parent-notification
  -- idempotency marker (Unit 2 sends the email exactly once per transition).
  first_published_at timestamptz,
  -- operator-only abuse takedown; ALWAYS WINS over `published`. A parent
  -- republish can never override it; only the operator clears it.
  operator_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Structural: published=true implies ever-published. The enumeration-
  -- resistance discriminator (first_published_at) can never be desynced by a
  -- buggy future writer flipping `published` without stamping the first
  -- publish — Unit 2's publish endpoint must set both in one statement.
  constraint fp_public_sites_published_implies_stamped
    check (not published or first_published_at is not null)
);

-- -------------------------------------------------------- fp_reserved_handles
-- Handles no learner may ever claim: app routes, serving infrastructure, and
-- brand/ops names. The Unit 2 claim/availability endpoints read this table
-- (service role) as the server-side authority (the client never re-authors the
-- rules, per the echo-the-server learning); first-profit's vercel.json handle
-- rewrite excludes the route subset (Unit 3) with a cross-reference back here.
-- The reason column keeps the rationale WITH the row, so the list stays
-- curated rather than folklore. Charset is a superset of claimable handles
-- (length 1+) so short route words like `go` could be reserved if ever needed.
create table if not exists public.fp_reserved_handles (
  handle text primary key check (handle ~ '^[a-z0-9-]{1,32}$'),
  reason text not null default ''
);

-- Structural backstop: a reserved handle can never be claimed even by a buggy
-- service-role endpoint. This RAISE is safe (unlike the projection trigger):
-- only Unit 2's claim path inserts here, and a refused claim is a designed
-- error branch there — no learner save doc rides this statement.
create or replace function public.fp_public_sites_reserved_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.fp_reserved_handles r where r.handle = NEW.handle) then
    raise exception 'fp_public_sites: handle "%" is reserved', NEW.handle;
  end if;
  return NEW;
end;
$$;

drop trigger if exists fp_public_sites_reserved_guard on public.fp_public_sites;
create trigger fp_public_sites_reserved_guard
  before insert or update of handle on public.fp_public_sites
  for each row execute function public.fp_public_sites_reserved_guard();

-- Seed (idempotent; curated initial list, owner may extend). Groups:
--   route  — single-segment app/serving paths on firstprofit.school; the
--            vercel.json handle rewrite must exclude these (Unit 3).
--   infra  — serving/crawler artifacts and likely future surfaces.
--   brand  — product/company/ops names and support-impersonation words.
insert into public.fp_reserved_handles (handle, reason) values
  ('signup',      'route: parent signup flow (/signup, /signup/verify)'),
  ('login',       'route: login surface'),
  ('logout',      'route: logout surface'),
  ('verify',      'route: verify-link adjacency'),
  ('app',         'route: app shell'),
  ('parent',      'route: parent surface'),
  ('admin',       'route: admin surface + impersonation risk'),
  ('account',     'route: account surface'),
  ('settings',    'route: settings surface'),
  ('api',         'infra: /api/* function namespace'),
  ('assets',      'infra: /assets/* build output'),
  ('static',      'infra: static file namespace'),
  ('public',      'infra: static file namespace'),
  ('index',       'infra: index.html adjacency'),
  ('home',        'infra: landing adjacency'),
  ('site',        'infra: /api/site handler adjacency'),
  ('sites',       'infra: /api/site handler adjacency'),
  ('www',         'infra: hostname word'),
  ('root',        'infra: hostname word + impersonation risk'),
  ('status',      'infra: status page convention'),
  ('health',      'infra: health check convention'),
  ('robots',      'infra: robots.txt adjacency'),
  ('sitemap',     'infra: sitemap.xml adjacency'),
  ('favicon',     'infra: favicon.ico adjacency'),
  ('firstprofit', 'brand: product name'),
  ('first-profit','brand: product name'),
  ('the120',      'brand: company/backend name'),
  ('school',      'brand: domain word (firstprofit.school)'),
  ('about',       'brand: standard site page'),
  ('contact',     'brand: standard site page'),
  ('help',        'brand: support surface + impersonation risk'),
  ('support',     'brand: support surface + impersonation risk'),
  ('staff',       'brand: impersonation risk'),
  ('official',    'brand: impersonation risk'),
  ('security',    'brand: security contact convention'),
  ('abuse',       'brand: abuse contact convention'),
  ('terms',       'brand: legal page'),
  ('privacy',     'brand: legal page'),
  ('legal',       'brand: legal page'),
  ('mail',        'brand: mail infrastructure word'),
  ('email',       'brand: mail infrastructure word'),
  ('blog',        'brand: likely future surface'),
  ('docs',        'brand: likely future surface'),
  ('news',        'brand: likely future surface'),
  ('shop',        'brand: likely future surface'),
  ('store',       'brand: likely future surface')
on conflict (handle) do nothing;

-- ------------------------------------------- shared clamped extraction (doc→)
-- THE single source of truth for the SaveDoc → projection mapping (see the
-- JSON contract in the header). Used by BOTH the projection trigger below and
-- the Unit 2 claim/publish backfill, so the two can never drift.
--
-- Return contract: NULL = "absent / not extractable — do not touch the
-- column"; EMPTY STRING = a legitimate value that OVERWRITES (clearing a
-- headline must propagate; the public renderer falls back to default copy).
-- A doc string can never be SQL NULL (jsonb null has typeof 'null', which the
-- string checks reject), so the sentinel is unambiguous.
--
-- Defensiveness (every branch, because the doc is client-writable JSON):
--   * jsonb_typeof at every step — ideas must be an array, the element and its
--     `fields` must be objects, each leaf must be a string.
--   * activeIdea: typeof must be 'number' AND its text form must match
--     ^[0-9]{1,9}$ — this rejects "abc" (not a number), 1.5 (dot), -1 (sign;
--     EXPLICITLY: jsonb negative indexing means "from the end", so a bare -1
--     would project the LAST idea — the client's hasIdea rejects negatives and
--     so do we), and unboundedly long digit strings that would overflow ::int
--     (the 9-digit bound keeps the cast safe). Then it must still fall inside
--     jsonb_array_length. 999 with 2 ideas → out of range → skip.
--   * truncation caps: headline left(·,120), one_liner left(·,140) — matching
--     the table CHECKs so the trigger's UPDATE can never violate them.
create or replace function public.fp_public_site_content(p_doc jsonb)
returns table (headline text, one_liner text)
language plpgsql
immutable
as $$
declare
  v_headline  text := null;
  v_one_liner text := null;
  v_ideas     jsonb;
  v_idea      jsonb;
  v_active    integer;
begin
  if p_doc is not null and jsonb_typeof(p_doc) = 'object' then
    if jsonb_typeof(p_doc->'siteHeadline') = 'string' then
      v_headline := left(p_doc->>'siteHeadline', 120);
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
          v_one_liner := left(v_idea->'fields'->>'oneLiner', 140);
        end if;
      end if;
    end if;
  end if;
  return query select v_headline, v_one_liner;
end;
$$;

-- Not part of any public surface: callable by owner/service role only.
revoke execute on function public.fp_public_site_content(jsonb) from public, anon, authenticated;

-- --------------------------------------------------------- projection trigger
-- Keeps the fp_public_sites content columns current on every save-doc write
-- (INSERT for completeness — the login route seeds rows; the CAS UPDATE is the
-- real path). Fires only when a matching site row exists (the UPDATE matches
-- zero rows otherwise); a stale CAS write matches zero fp_player_saves rows
-- and so never reaches this trigger at all. Editing while unpublished still
-- projects (republish shows the latest content, by design).
--
-- Gate: doc->>'docVersion' = '1' AND typeof number — any other/missing version
-- is SKIPPED, so a future doc shape must consciously update this trigger and
-- can never be misparsed by it.
--
-- NEVER ERRORS — see the header. EXCEPTION WHEN OTHERS THEN RETURN NEW is the
-- outermost frame; a projection bug may only ever cost projection freshness,
-- never the learner's save.
--
-- Writer invariant (system-wide impact note in the plan): the content columns
-- (first_name / headline / one_liner) are written ONLY by this trigger and the
-- Unit 2 claim/publish backfill — never a third writer.
create or replace function public.fp_public_sites_project_save()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headline  text;
  v_one_liner text;
begin
  -- Index-backed early exit FIRST: the common case (no site row — every save
  -- of every learner who never claimed) must not pay full jsonb extraction on
  -- every ~3s save. A trigger WHEN clause cannot hold a subquery, so the exit
  -- lives in-body — still inside this exception-wrapped frame.
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
  select c.headline, c.one_liner into v_headline, v_one_liner
    from public.fp_public_site_content(NEW.doc) c;
  if v_headline is null and v_one_liner is null then
    return NEW;
  end if;
  -- Change-guarded: a claimed learner's row must not gain a new tuple version
  -- every ~3s of play with unchanged content — write only when a projected
  -- value actually differs (NULL sentinel = keep, so coalesce mirrors SET).
  update public.fp_public_sites s
     set headline   = coalesce(v_headline, s.headline),
         one_liner  = coalesce(v_one_liner, s.one_liner),
         updated_at = now()
   where s.profile_id = NEW.profile_id
     and (s.headline is distinct from coalesce(v_headline, s.headline)
          or s.one_liner is distinct from coalesce(v_one_liner, s.one_liner));
  return NEW;
exception
  when others then
    -- A raise EXCEPTION here would classify TERMINAL in the FP sync engine and
    -- drop the learner's snapshot (see header). Projection staleness is the
    -- only acceptable failure mode — but it must be VISIBLE in the logs
    -- (the fp_save_doc_guard observability precedent), never silent.
    raise warning 'fp_public_sites_project_save failed: % %', SQLSTATE, SQLERRM;
    return NEW;
end;
$$;

revoke execute on function public.fp_public_sites_project_save() from public, anon, authenticated;

drop trigger if exists fp_public_sites_project_save on public.fp_player_saves;
create trigger fp_public_sites_project_save
  after insert or update of doc on public.fp_player_saves
  for each row execute function public.fp_public_sites_project_save();

-- ------------------------------------------------------ public read function
-- The ONE public read surface (seats_claimed() precedent, hardened per the
-- R20 exposure record): SECURITY DEFINER, STABLE, pinned search_path, EXECUTE
-- revoked from PUBLIC and granted explicitly to anon + authenticated. The
-- argument is normalized (lowercase, trimmed) and charset/length-validated
-- BEFORE it touches the table — an invalid handle returns zero rows without a
-- comparison against real data.
--
-- NORMALIZATION PARITY (accepted, fails-closed): btrim here strips SPACES
-- only, while the TS mirror's .trim() (fp-public-site-rules.ts
-- normalizeHandle) strips all Unicode whitespace. The divergence is
-- deliberate and SAFE: any whitespace btrim leaves behind (tab, newline,
-- NBSP, …) fails the charset regex below and yields zero rows — a stricter
-- SQL side can only under-match, never leak a row the TS side would refuse.
--
-- Result contract (per state):
--   published AND NOT operator_locked  → ('published', first_name, headline, one_liner)
--   ever-published, currently hidden   → ('offline', null, null, null) — no content
--   never published / unknown handle   → ZERO ROWS — byte-identical results,
--                                        see ENUMERATION RESISTANCE above
create or replace function public.fp_public_site(p_handle text)
returns table (state text, first_name text, headline text, one_liner text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when s.published and not s.operator_locked then 'published' else 'offline' end,
    case when s.published and not s.operator_locked then s.first_name end,
    case when s.published and not s.operator_locked then s.headline end,
    case when s.published and not s.operator_locked then s.one_liner end
  from public.fp_public_sites s
  where lower(btrim(coalesce(p_handle, ''))) ~ '^[a-z0-9-]{3,20}$'
    and s.handle = lower(btrim(p_handle))
    and ((s.published and not s.operator_locked) or s.first_published_at is not null);
$$;

revoke execute on function public.fp_public_site(text) from public;
grant execute on function public.fp_public_site(text) to anon, authenticated;

-- ------------------------------------------------------------- RLS + grants
-- Default-deny with ZERO policies on both tables — deliberate, see header.
alter table public.fp_public_sites enable row level security;
alter table public.fp_reserved_handles enable row level security;

revoke all on public.fp_public_sites from anon, authenticated;
revoke all on public.fp_reserved_handles from anon, authenticated;
