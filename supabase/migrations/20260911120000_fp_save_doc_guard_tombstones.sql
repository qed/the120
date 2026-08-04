-- First Profit game — fp_player_saves DOC GUARD v2: IDEA TOMBSTONES
-- (deletedIdeaIds). The FP client is gaining a legitimate DELETE_IDEA action;
-- the v1 guard (20260906120000_fp_save_doc_guard.sql — APPLIED to production)
-- treats ANY OLD idea missing from NEW as accidental erasure and re-appends
-- it at the tail, which would resurrect every deliberate deletion. This
-- migration replaces the guard function with v2: the save doc gains an
-- OPTIONAL top-level `deletedIdeaIds: string[]` (additive-optional — NO
-- docVersion bump; absent = []; an append-only MONOTONIC set), and the guard
-- (a) SKIPS re-appending an unmatched OLD idea whose id is tombstoned, and
-- (b) UNIONS OLD's tombstones into NEW's so an old-build save that omits the
-- field can never un-delete.
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. Ledger-top confirmation: every prior
--   migration in this tree THROUGH 20260910120000_fp_feedback_kind IS APPLIED
--   TO PRODUCTION, so the v1 guard file must NOT be amended in place — this
--   change stacks as a new migration (the 20260909 convention). The slot below
--   assumes the top of supabase_migrations.schema_migrations is
--   20260910120000. The TRUE next-free slot MUST be reconfirmed against the
--   LIVE ledger immediately before applying (a migration may have landed
--   between authoring and the gate); if the live top is not 20260910120000,
--   RENAME this file to the real next-free 12:00:00 slot before applying.
--   Apply via the Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- AMENDMENT LOG (in-place amendments are allowed ONLY while this file is
--   branch-only / never applied; once applied, changes stack as a new
--   migration):
--   * (none yet — initial authoring.)
--
-- ⚠ DEPLOY ORDERING: this guard v2 must be LIVE in prod BEFORE the
--   first-profit build that ships DELETE_IDEA deploys — the moment a client
--   writes a doc with an idea removed and its id tombstoned, the v1 guard
--   would re-append the "deleted" idea on the very next save. The original
--   MIXED-BUILD ordering from v1 still holds transitively: this guard must
--   stay live BEFORE the first-profit build that writes `businesses` /
--   `doneByTask` / `doneAtByTask` (already satisfied — v1 is applied).
--   Old clients against guard v2 are safe: they omit `deletedIdeaIds`
--   entirely (key-absent), and the guard re-adds OLD's tombstones and then
--   honors them, so a deletion can never be undone by an old build.
--
-- ⚠ POST-APPLY VERIFICATION (the apply is NOT complete until this passes):
--   after applying via the Management API, run a synthetic probe — seed a
--   scratch row (or use the designated test child) with a docVersion-1 doc
--   containing TWO ideas, then under a REAL child JWT via PostgREST:
--   1. DELETION probe: UPDATE with idea X removed from `ideas` and
--      deletedIdeaIds = [X.id] (same docVersion) → the response row's doc
--      does NOT contain idea X and DOES carry the tombstone.
--   2. OLD-BUILD probe: UPDATE the same row with an old-shape doc that omits
--      `deletedIdeaIds` entirely (and omits businesses / per-idea
--      id/doneByTask/doneAtByTask) → the response row RETAINS the grafted
--      keys (the v1 behavior), RETAINS deletedIdeaIds = [X.id] (the union),
--      and idea X is STILL absent (the tombstone is honored).
--   3. ACCIDENT probe: UPDATE with a NON-tombstoned idea missing from
--      `ideas` → that idea IS re-appended at the tail (the v1 protection
--      stays for accidents).
--   Then restore the row to its pre-probe state. A probe that passes proves
--   the trigger fires under real client claims (the exemption arm below makes
--   a claims-propagation regression silently disable the guard — the probe is
--   the only end-to-end check of that path).
--
-- SEMANTICS v2 (mirrored byte-for-intent by the TS spec,
--   app/fp/lib/fp-save-doc-guard-rules.ts `guardSaveDocUpdate`; parity test:
--   app/fp/lib/__tests__/fp-save-doc-guard-migration-parity.test.ts — which
--   now parses THIS file). Everything from v1 is carried forward unchanged
--   (the docVersion gate, the element-count fuse, key-level omission
--   semantics, the businesses carry, id/index idea matching, the monotonic
--   per-idea grafts, the never-raise posture, the service_role/JWT-less
--   exemption); v2 ADDS, inside the protected repair region:
--
--   * TOMBSTONE UNION (monotonic). The effective tombstone set is built from
--     NEW.doc->'deletedIdeaIds' first, then OLD.doc->'deletedIdeaIds' —
--     collecting, from the FIRST 100 elements of each side, string elements
--     of 1..64 chars, de-duplicated, capped at 100 total (NEW's ids take
--     priority under the cap). The set is written back to the repaired doc's
--     `deletedIdeaIds` whenever it is non-empty OR NEW carried the key (so a
--     malformed/oversized NEW value is CLAMPED to the normalized set, and an
--     old-build write that omitted the key gets OLD's tombstones re-added —
--     absent-stays-absent only when NEITHER side has tombstones). Clamping
--     is defensive, never a raise: a `deletedIdeaIds` that is a string, a
--     number, an object, or a huge array degrades to "no valid entries from
--     that side" / the first-100 scan — the save always succeeds.
--   * TAIL-APPEND SKIP. An unmatched OLD idea whose `id` is a string in the
--     effective tombstone set is NOT re-appended at the tail — that is the
--     deliberate deletion. Every OTHER unmatched OLD idea still re-appends
--     (the v1 accidental-erasure protection stays). Tombstones only ever
--     suppress RE-APPEND: the guard never removes an idea that is present in
--     NEW's `ideas`, and matched ideas graft exactly as in v1.
--
-- ACCEPTED BOUND (tombstone cap): ids past the first-100 scan of a side, or
--   past the 100-entry union cap, are dropped from the effective set (their
--   ideas would then re-append as accidents — fail-SAFE toward preservation,
--   never toward deletion). Unreachable for legitimate docs: the FP client
--   caps ideas at MAX_IDEAS = 5, so a real deletedIdeaIds can never approach
--   100 entries. The cap and per-id length also bound the guard's CPU and the
--   doc's growth (the pg_column_size CHECK edge from v1 is unchanged).
--
-- ACCEPTED FAIL-OPEN (JWT-less exemption arm) — carried from v1 verbatim:
--   owner maintenance (the r28 erase, doc repairs) runs through the Supabase
--   Management API SQL endpoint, which is a JWT-less session that is NOT
--   service_role — dropping the JWT-less arm would make the guard re-graft
--   state during intentional owner repairs, so the arm stays. The accepted
--   tradeoff: a claims-propagation regression in PostgREST/GoTrue (client
--   requests arriving with empty request.jwt.claims) would silently disable
--   the guard for client traffic — fail-open, not fail-closed. Accepted
--   because such a regression would simultaneously break RLS-scoped reads
--   loudly (nothing would load), and the post-apply probe above verifies the
--   claims path end-to-end at apply time.
--
-- ACCEPTED LOSS MODE (old-build idea fusion) — carried from v1 verbatim: the
--   index fallback can FUSE two distinct ideas. If a new-build session
--   creates an idea (id-bearing, at OLD index k) while an old-build session
--   concurrently creates its OWN distinct idea at the same index (id-less,
--   since the old build never emits ids), the old-build write's idea k
--   index-matches the new-build idea: the new idea's id and monotonic maps
--   are grafted onto the old-build idea's content, and the new-build idea is
--   NOT appended at the tail (it was "matched"). The two ideas fuse; the
--   new-build idea's fields are lost. Deliberately NOT heuristically
--   defended: any content-similarity heuristic would misfire worse, exposure
--   is proportional to the length of the mixed-build window (short by the
--   deploy-ordering rule above), and it requires the same child racing two
--   builds while creating ideas in both. Pinned as the accepted outcome by
--   the behavioral suite.
--
-- ACCEPTED EDGE (size cap) — carried from v1 verbatim: grafting can only grow
--   NEW.doc; a doc already near the 256KiB pg_column_size CHECK could be
--   pushed over it, failing the old-build write with 23514 (the client shows
--   its honest "couldn't save"). That refusal PRESERVES the server doc —
--   strictly better than the silent erasure this guard exists to stop — and
--   is unreachable for any legitimately-sized save.
--
-- PROJECTION UNCHANGED: fp_public_site_content / fp_public_sites_project_save
--   (20260907..20260909) read doc->'ideas' only — a deleted idea is simply
--   gone from the array, so the products projection needs NO change and
--   `deletedIdeaIds` is never extracted or served.
--
-- TRIGGER ORDER: BEFORE UPDATE triggers fire in name order;
--   fp_player_saves_doc_guard sorts before fp_player_saves_revision_guard, so
--   the repair runs first. The two are independent (this guard never touches
--   revision/updated_at), so the ordering is incidental, not load-bearing.
--
-- DROP + RECREATE, EVERY ATTRIBUTE RE-ESTABLISHED (the 20260909 convention):
--   the function's signature is unchanged, but the drop discards its
--   attributes and ACL, so everything v1 established is re-applied below —
--   `security definer`, `set search_path = public`, and the trigger wiring
--   (the trigger must be dropped FIRST: it depends on the function). v1
--   granted/revoked NOTHING explicitly on this function (a trigger function
--   is invoked by the trigger machinery, never via RPC; PostgREST exposes
--   only functions returning non-trigger types), so there are no grants to
--   re-apply — the default ACL is identical before and after.
--
-- Idempotent throughout (drop-if-exists + create for the trigger and the
-- function) — re-applying is a no-op. Additive-only: no column, constraint,
-- RLS posture, or grant is removed or narrowed; docVersion is NOT bumped.

drop trigger if exists fp_player_saves_doc_guard on public.fp_player_saves;
drop function if exists public.fp_player_saves_doc_guard();

create function public.fp_player_saves_doc_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_ideas  jsonb;
  v_new_ideas  jsonb;
  v_doc        jsonb;
  v_out_ideas  jsonb;
  v_new_idea   jsonb;
  v_old_idea   jsonb;
  v_new_id     text;
  v_match      integer;
  v_used       integer[];
  v_key        text;
  v_tombstones jsonb;
  v_side       jsonb;
  v_entry      jsonb;
  v_id         text;
begin
  -- Owner/maintenance sessions may rewrite the doc freely (intentional reset,
  -- PII scrub, repair). Every PostgREST child request carries jwt claims, so
  -- this opens nothing to clients (the fp_task_feedback guard precedent). The
  -- JWT-less arm is load-bearing: owner maintenance runs via the Management
  -- API SQL endpoint (JWT-less, NOT service_role) — see the header's ACCEPTED
  -- FAIL-OPEN paragraph for the tradeoff.
  if auth.role() = 'service_role'
     or current_setting('request.jwt.claims', true) is null
     or current_setting('request.jwt.claims', true) = '' then
    return NEW;
  end if;

  -- ── docVersion gate ────────────────────────────────────────────────────
  -- The whole repair requires schema agreement. The mixed-build window this
  -- guard targets is explicitly a no-DOC_VERSION-bump window (deletedIdeaIds
  -- is additive-optional under docVersion 1); a differing version is a
  -- deliberate transition or a client that discarded a malformed/
  -- unknown-version doc — never resurrect into it.
  if (OLD.doc ->> 'docVersion') is distinct from (NEW.doc ->> 'docVersion') then
    return NEW;
  end if;

  -- Malformed / non-object docs (including the seeded '{}' OLD, which simply
  -- has no keys to carry): repair is impossible or unnecessary — pass through.
  if OLD.doc is null or NEW.doc is null
     or jsonb_typeof(OLD.doc) <> 'object'
     or jsonb_typeof(NEW.doc) <> 'object' then
    return NEW;
  end if;

  v_old_ideas := OLD.doc -> 'ideas';
  v_new_ideas := NEW.doc -> 'ideas';

  -- ── Element-count fuse (before any matching loop) ──────────────────────
  -- A legitimate save has a handful of ideas; past the fuse this is not the
  -- mixed-build case, and bailing here bounds the quadratic id-matcher's CPU.
  -- Mirrored by SAVE_DOC_IDEAS_FUSE_LIMIT in fp-save-doc-guard-rules.ts.
  if (jsonb_typeof(v_old_ideas) = 'array' and jsonb_array_length(v_old_ideas) > 200)
     or (jsonb_typeof(v_new_ideas) = 'array' and jsonb_array_length(v_new_ideas) > 200) then
    return NEW;
  end if;

  -- ── Protected repair region ────────────────────────────────────────────
  -- The repaired doc is built in v_doc and NEW.doc is assigned EXACTLY ONCE
  -- at the end, so the exception handler's `return NEW` really does return
  -- the doc as the writer sent it (no half-repaired state can escape).
  begin
    v_doc := NEW.doc;

    -- ── Top-level carry: businesses ────────────────────────────────────
    -- Key entirely absent = the writer does not know the field (old build).
    -- Present-but-empty [] is ALSO carried when OLD's is a non-empty array:
    -- the client's coerceBusinesses emits [] when every entry fails
    -- validation, and no legitimate writer shrinks businesses to empty
    -- (archival keeps records; owner erasure runs service_role-exempt).
    -- A present NON-empty NEW businesses stays strictly untouched.
    if OLD.doc ? 'businesses'
       and (
         not NEW.doc ? 'businesses'
         or (
           (NEW.doc -> 'businesses') = '[]'::jsonb
           and jsonb_typeof(OLD.doc -> 'businesses') = 'array'
           and jsonb_array_length(OLD.doc -> 'businesses') > 0
         )
       ) then
      v_doc := jsonb_set(v_doc, '{businesses}', OLD.doc -> 'businesses');
    end if;

    -- ── Tombstone union: deletedIdeaIds (v2) ───────────────────────────
    -- Build the effective MONOTONIC tombstone set: NEW's entries first, then
    -- OLD's — so an old-build save that omits the key re-adds OLD's
    -- tombstones (and the tail loop below then honors them: a deletion can
    -- never be undone by an old build). Bounds mirror the TS spec
    -- (SAVE_DOC_DELETED_IDS_MAX / SAVE_DOC_DELETED_ID_MAX_CHARS): only the
    -- FIRST 100 elements of each side are scanned, only string elements of
    -- 1..64 chars are collected, duplicates dropped, 100 entries total.
    -- Clamp, never raise: any other shape contributes nothing.
    v_tombstones := '[]'::jsonb;
    for s in 1 .. 2 loop
      v_side := case when s = 1
        then NEW.doc -> 'deletedIdeaIds'
        else OLD.doc -> 'deletedIdeaIds'
      end;
      if jsonb_typeof(v_side) = 'array' then
        for i in 0 .. least(jsonb_array_length(v_side), 100) - 1 loop
          exit when jsonb_array_length(v_tombstones) >= 100;
          v_entry := v_side -> i;
          if jsonb_typeof(v_entry) = 'string' then
            v_id := v_side ->> i;
            if char_length(v_id) between 1 and 64
               and not (v_tombstones ? v_id) then
              v_tombstones := v_tombstones || jsonb_build_array(v_entry);
            end if;
          end if;
        end loop;
      end if;
    end loop;
    -- Written back whenever non-empty OR NEW carried the key (a malformed /
    -- oversized NEW value is thereby CLAMPED to the normalized set); when
    -- NEITHER side has tombstones the key is not invented
    -- (absent-stays-absent).
    if jsonb_array_length(v_tombstones) > 0 or NEW.doc ? 'deletedIdeaIds' then
      v_doc := jsonb_set(v_doc, '{deletedIdeaIds}', v_tombstones);
    end if;

    -- ── Per-idea grafts (only when BOTH sides have an ideas ARRAY) ─────
    if jsonb_typeof(v_old_ideas) = 'array' and jsonb_typeof(v_new_ideas) = 'array' then
      v_out_ideas := '[]'::jsonb;
      v_used := '{}';

      for i in 0 .. jsonb_array_length(v_new_ideas) - 1 loop
        v_new_idea := v_new_ideas -> i;
        -- A non-object entry is unexpected shape: pass it through untouched.
        if jsonb_typeof(v_new_idea) <> 'object' then
          v_out_ideas := v_out_ideas || jsonb_build_array(v_new_idea);
          continue;
        end if;

        -- Find the matching OLD idea: by id when both sides carry string ids,
        -- else by array index (ideas are append-only, so indexes are stable
        -- for id-less pairs; duplicate ids resolve first-unused). A same-index
        -- pair with two DIFFERENT ids is two distinct ideas and is never
        -- fused (the unionCompletionMaps contract) — but see the header's
        -- ACCEPTED LOSS MODE for the id-less-NEW vs id-bearing-OLD fusion.
        v_match := null;
        v_new_id := case
          when jsonb_typeof(v_new_idea -> 'id') = 'string' then v_new_idea ->> 'id'
          else null
        end;

        if v_new_id is not null then
          for j in 0 .. jsonb_array_length(v_old_ideas) - 1 loop
            if not (v_used @> array[j])
               and jsonb_typeof(v_old_ideas -> j) = 'object'
               and jsonb_typeof(v_old_ideas -> j -> 'id') = 'string'
               and (v_old_ideas -> j ->> 'id') = v_new_id then
              v_match := j;
              exit;
            end if;
          end loop;
          -- NEW carries an id but the same-index OLD idea predates ids (an
          -- old doc the new build just re-loaded and id-minted): index
          -- fallback, gated on the OLD entry NOT carrying a string id (a
          -- different string id there means two distinct ideas — no fuse).
          if v_match is null
             and i < jsonb_array_length(v_old_ideas)
             and not (v_used @> array[i])
             and jsonb_typeof(v_old_ideas -> i) = 'object'
             and jsonb_typeof(v_old_ideas -> i -> 'id') is distinct from 'string' then
            v_match := i;
          end if;
        else
          if i < jsonb_array_length(v_old_ideas)
             and not (v_used @> array[i])
             and jsonb_typeof(v_old_ideas -> i) = 'object' then
            v_match := i;
          end if;
        end if;

        if v_match is not null then
          v_used := v_used || v_match;
          v_old_idea := v_old_ideas -> v_match;
          -- Stable identity: an old-build write strips `id`; graft it back so
          -- Business.ideaId links and future id-matching survive.
          if jsonb_typeof(v_old_idea -> 'id') = 'string' and not (v_new_idea ? 'id') then
            v_new_idea := jsonb_set(v_new_idea, '{id}', v_old_idea -> 'id');
          end if;
          -- The monotonic per-idea maps (the unionCompletionMaps set). Grafted
          -- only when the key is ENTIRELY ABSENT on NEW and a well-shaped
          -- object on OLD; a present-but-empty {} on NEW is intentional and
          -- untouched.
          foreach v_key in array array['done', 'doneAt', 'doneByTask', 'doneAtByTask'] loop
            if jsonb_typeof(v_old_idea -> v_key) = 'object' and not (v_new_idea ? v_key) then
              v_new_idea := jsonb_set(v_new_idea, array[v_key], v_old_idea -> v_key);
            end if;
          end loop;
        end if;

        v_out_ideas := v_out_ideas || jsonb_build_array(v_new_idea);
      end loop;

      -- OLD ideas no NEW idea matched: appended at the tail in OLD order —
      -- UNLESS the idea's id is in the effective tombstone set (v2): a
      -- tombstoned id is a DELIBERATE deletion and is skipped; every other
      -- unmatched OLD idea still re-appends (no build ACCIDENTALLY loses an
      -- idea — the v1 protection stays). Non-object entries are unexpected
      -- shape and are not resurrected. This includes the EMPTY NEW ideas
      -- list on purpose: an old tab that loaded an empty list while a
      -- new-build session created ideas is a legitimate save; the
      -- discard/fresh-start cascade is handled by the docVersion gate above,
      -- so preservation here is safe and kept as is.
      for j in 0 .. jsonb_array_length(v_old_ideas) - 1 loop
        if not (v_used @> array[j]) and jsonb_typeof(v_old_ideas -> j) = 'object' then
          if jsonb_typeof(v_old_ideas -> j -> 'id') = 'string'
             and v_tombstones ? (v_old_ideas -> j ->> 'id') then
            continue;
          end if;
          v_out_ideas := v_out_ideas || jsonb_build_array(v_old_ideas -> j);
        end if;
      end loop;

      v_doc := jsonb_set(v_doc, '{ideas}', v_out_ideas);
    end if;

    NEW.doc := v_doc;
    return NEW;
  exception
    when others then
      -- This guard REPAIRS; it must never turn a save into a refusal. Any
      -- unexpected failure is made VISIBLE in the logs, then degrades to the
      -- pre-guard behavior: NEW exactly as the writer sent it (NEW.doc was
      -- never touched before the single assignment above).
      raise warning 'fp_save_doc_guard failed: % %', SQLSTATE, SQLERRM;
      return NEW;
  end;
end;
$$;

drop trigger if exists fp_player_saves_doc_guard on public.fp_player_saves;
create trigger fp_player_saves_doc_guard
  before update on public.fp_player_saves
  for each row execute function public.fp_player_saves_doc_guard();
