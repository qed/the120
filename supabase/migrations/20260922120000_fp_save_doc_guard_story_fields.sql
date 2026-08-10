-- First Profit game — fp_player_saves DOC GUARD v3: STORY FIELDS (monotonic
-- flags + coverLook LWW). v2 (20260911120000_fp_save_doc_guard_tombstones.sql
-- — APPLIED to production) protects `businesses`, the per-idea monotonic
-- maps/id, and the `deletedIdeaIds` tombstone union. It knows NOTHING of the
-- fpv03 U6/U7a story-state fields the first-profit client has been unioning
-- CLIENT-SIDE all along (unionCompletionMaps in src/state/gameCore.ts):
-- `storyIntroSeen`, `firstRunComplete`, `dashboardOrientationSeen`,
-- `onboardingComplete` (all MONOTONIC booleans, OR'd) and the
-- `coverLook`/`coverLookAt` pair (EDITABLE LATEST-INTENT, LAST-WRITE-WINS on
-- the stamp). An old/mixed-build sequential server write — the same class of
-- bug v1/v2 exist to repair — can silently CLEAR a monotonic flag or clobber
-- a newer chosen cover with a stale one, exactly as v1's original businesses
-- bug did. v3 replaces the guard function whole with v2's semantics carried
-- forward VERBATIM, plus these two new grafts.
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. Ledger-top confirmation: every prior
--   migration in this tree THROUGH 20260921120000_fp_login_code_and_username_
--   legacy IS APPLIED TO PRODUCTION, so the v2 guard file must NOT be amended
--   in place — this change stacks as a new migration (the 20260909
--   convention). The slot below assumes the top of
--   supabase_migrations.schema_migrations is 20260921120000. The TRUE
--   next-free slot MUST be reconfirmed against the LIVE ledger immediately
--   before applying (a migration may have landed between authoring and the
--   gate); if the live top is not 20260921120000, RENAME this file to the
--   real next-free 12:00:00 slot before applying. Apply via the Management
--   API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- AMENDMENT LOG (in-place amendments are allowed ONLY while this file is
--   branch-only / never applied; once applied, changes stack as a new
--   migration):
--   * (none yet — initial authoring.)
--
-- ⚠ DEPLOY ORDERING: this guard v3 is PROTECTIVE and should be LIVE in prod
--   BEFORE fpv03 U8 gives `coverLook` a reader (nothing in the shipped app
--   reads `coverLook` yet — see gameCore.ts's own note that "nothing READS
--   coverLook until U8"). But `coverLook`/`coverLookAt` are ALREADY being
--   WRITTEN by the shipped U6 (S07 pick-your-book-cover), so applying this
--   guard SOONER strictly REDUCES risk — there is no reason to wait for U8.
--   Similarly `storyIntroSeen` (U5), `firstRunComplete` (U6), and
--   `dashboardOrientationSeen` (U7a) are already-shipped writers; only
--   `onboardingComplete` predates fpv03 entirely. The original MIXED-BUILD
--   ordering from v1/v2 still holds transitively, carried forward verbatim:
--   this guard must stay live BEFORE the first-profit build that writes
--   `businesses` / `doneByTask` / `doneAtByTask` (v1, applied), and BEFORE the
--   first-profit build that ships DELETE_IDEA / writes `deletedIdeaIds` (v2,
--   applied THROUGH 20260910 — the ledger top confirmed when v2 was authored —
--   and now live). Old clients against guard v3 are safe: they omit the story
--   fields entirely (key-absent), and the guard re-grafts OLD's values, so a
--   stale write can never clear a flag or clobber a newer cover choice.
--
-- ⚠ POST-APPLY VERIFICATION (the apply is NOT complete until this passes):
--   after applying via the Management API, run a synthetic probe — seed a
--   scratch row (or use the designated test child) with a docVersion-1 doc,
--   then under a REAL child JWT via PostgREST:
--   1. All v2 probes (DELETION / OLD-BUILD / ACCIDENT — see the v2 header)
--      still pass unchanged.
--   2. MONOTONIC-FLAG REGRESSION probe: seed OLD with `firstRunComplete:
--      true` (and the other three flags true too), UPDATE with a NEW doc
--      that OMITS `firstRunComplete` entirely (an old-build write) → the
--      response row's doc still has `firstRunComplete: true`. Repeat with a
--      NEW doc that explicitly sends `firstRunComplete: false` (a
--      stale/buggy client) → the response row STILL has `firstRunComplete:
--      true` (regression, not just omission, is repaired). Same for
--      `storyIntroSeen`, `dashboardOrientationSeen`, `onboardingComplete`.
--   3. COVER-LOOK LWW probe: seed OLD with `coverLook: "night-hero",
--      coverLookAt: 5000`, UPDATE with a NEW doc carrying `coverLook:
--      "storybook-classic", coverLookAt: 1000` (an OLDER stamp — e.g. a
--      backgrounded tab flushing a stale in-memory choice) → the response
--      row's doc comes back with `coverLook: "night-hero", coverLookAt:
--      5000` (the NEWER look survives, not the stale write). Then UPDATE
--      again with `coverLook: "manga-arc", coverLookAt: 9000` (a NEWER
--      stamp) → the response row adopts it verbatim.
--   4. COVER-LOOK FULL-OMISSION probe — RUN THIS ONE, IT CAUGHT A REAL BUG.
--      Seed OLD with `coverLook: "night-hero", coverLookAt: 5000`, UPDATE
--      with a NEW doc that OMITS BOTH keys entirely (the classic old-build
--      write) → the response row must STILL carry `coverLook: "night-hero",
--      coverLookAt: 5000`. The v3 review found the first draft of Graft B
--      failed exactly here: `jsonb_typeof()` of an ABSENT key is NULL, a
--      plain `<> 'string'` on NULL is NULL, the whole condition collapsed to
--      NULL, and plpgsql's IF treated it as false — so the guard silently
--      DROPPED the cover instead of preserving it. Probes 1-3 all passed
--      while that was broken; only this one fails. Never remove it.
--   Then restore the row to its pre-probe state.
--
-- SEMANTICS v3 (mirrored byte-for-intent by the TS spec,
--   app/lib/fp/fp-save-doc-guard-rules.ts `guardSaveDocUpdate`; parity test:
--   app/lib/fp/__tests__/fp-save-doc-guard-migration-parity.test.ts — which
--   now parses THIS file). Everything from v2 is carried forward unchanged
--   (the docVersion gate, the element-count fuse, key-level omission
--   semantics, the businesses carry, the deletedIdeaIds tombstone union, the
--   tail-append skip, id/index idea matching, the monotonic per-idea grafts,
--   the never-raise posture, the service_role/JWT-less exemption); v3 ADDS,
--   inside the protected repair region, AFTER the tombstone union and BEFORE
--   the per-idea `ideas` gate (so both new grafts apply even when idea
--   handling is skipped — exactly like the tombstone union):
--
--   * GRAFT A — MONOTONIC STORY FLAGS. For each key, in this exact order:
--     `storyIntroSeen`, `firstRunComplete`, `dashboardOrientationSeen`,
--     `onboardingComplete` — if OLD's value at that key is the JSON boolean
--     `true` and NEW's value is not `true` (absent, `false`, or any other
--     shape), the repaired doc's key is set to `true`. These mirror the
--     CLIENT'S OWN unionCompletionMaps OR-union of the same four flags
--     (gameCore.ts) — the server must never let a stale/old-build write
--     clear one. A `false` is NEVER invented: when OLD is not `true`, the
--     key is left exactly as NEW sent it (present, absent, or any shape) —
--     absent-stays-absent, matching the client's own emission rule of
--     "present only when true".
--   * GRAFT B — coverLook / coverLookAt, LAST-WRITE-WINS. Mirrors the
--     client's own merge (gameCore.ts's persisted-doc union) with local :=
--     NEW and server := OLD (the guard's repaired doc starts as NEW, so NEW
--     is the "local" / default-wins side and OLD only overrides it):
--       result.coverLook   := NEW.coverLook
--       result.coverLookAt := NEW.coverLookAt
--       if OLD.coverLook is a non-empty-shaped STRING
--          and OLD.coverLookAt is a NUMBER
--          and ( NEW.coverLook is not a string
--                or NEW.coverLookAt is not a number
--                or OLD.coverLookAt > NEW.coverLookAt )
--       then result := OLD's pair (both coverLook and coverLookAt).
--     The pair is written back to the repaired doc ONLY when a look
--     survived (absent-stays-absent when NEITHER side carries a string
--     coverLook); the stamp is written back only when it is a valid number.
--     NEW wins ties and wins whenever OLD carries no valid stamp, so the
--     merge is deterministic in both directions — identical to the client's
--     own `sCoverAt > coverLookAt` (strict-greater) tie rule.
--     DEFENSIVE PAIRING: a stamped-but-lookless side (a valid coverLookAt
--     with no string coverLook — a malformed/hand-edited doc) must never
--     null out a valid look on the other side. Requiring OLD.coverLook to be
--     a present STRING before OLD can win blocks a lookless OLD stamp from
--     clobbering NEW's look; NEW's own coverLook/coverLookAt are carried
--     forward verbatim (whatever shape NEW sent, valid or not) whenever OLD
--     does not win, so a lookless-but-stamped NEW can never be "fixed" into
--     losing its (absent) look either — the guard never invents shape NEW
--     didn't send.
--
--   Everything remains CLAMP-NEVER-RAISE: any unexpected shape (a string,
--   number, object, or array where a boolean or number is expected)
--   contributes nothing to either graft, and the save still succeeds.
--
-- ACCEPTED FAIL-OPEN (JWT-less exemption arm) — carried from v1/v2 verbatim:
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
-- ACCEPTED LOSS MODE (old-build idea fusion) — carried from v1/v2 verbatim:
--   the index fallback can FUSE two distinct ideas. If a new-build session
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
-- ACCEPTED BOUND (tombstone cap) — carried from v2 verbatim: ids past the
--   first-100 scan of a side, or past the 100-entry union cap, are dropped
--   from the effective set (their ideas would then re-append as accidents —
--   fail-SAFE toward preservation, never toward deletion). Unreachable for
--   legitimate docs: the FP client caps ideas at MAX_IDEAS = 5, so a real
--   deletedIdeaIds can never approach 100 entries. The cap and per-id length
--   also bound the guard's CPU and the doc's growth (the pg_column_size
--   CHECK edge from v1 is unchanged).
--
-- ACCEPTED EDGE (size cap) — carried from v1/v2 verbatim: grafting can only
--   grow NEW.doc; a doc already near the 256KiB pg_column_size CHECK could be
--   pushed over it, failing the old-build write with 23514 (the client shows
--   its honest "couldn't save"). That refusal PRESERVES the server doc —
--   strictly better than the silent erasure this guard exists to stop — and
--   is unreachable for any legitimately-sized save. The two new v3 grafts
--   add at most a handful of scalar keys, so this edge is not meaningfully
--   widened.
--
-- PROJECTION UNCHANGED: fp_public_site_content / fp_public_sites_project_save
--   (20260907..20260909) read doc->'ideas' only — the new story fields are
--   never extracted or served, so the products projection needs NO change.
--
-- TRIGGER ORDER: BEFORE UPDATE triggers fire in name order;
--   fp_player_saves_doc_guard sorts before fp_player_saves_revision_guard, so
--   the repair runs first. The two are independent (this guard never touches
--   revision/updated_at), so the ordering is incidental, not load-bearing.
--
-- DROP + RECREATE, EVERY ATTRIBUTE RE-ESTABLISHED (the 20260909 convention):
--   the function's signature is unchanged, but the drop discards its
--   attributes and ACL, so everything v1/v2 established is re-applied below —
--   `security definer`, `set search_path = public`, and the trigger wiring
--   (the trigger must be dropped FIRST: it depends on the function). Neither
--   v1 nor v2 granted/revoked anything explicitly on this function (a trigger
--   function is invoked by the trigger machinery, never via RPC; PostgREST
--   exposes only functions returning non-trigger types), so there are no
--   grants to re-apply — the default ACL is identical before and after.
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
  v_flag_key   text;
  v_tombstones jsonb;
  v_side       jsonb;
  v_entry      jsonb;
  v_id         text;
  v_old_cover  jsonb;
  v_old_at     jsonb;
  v_old_cover_ok boolean;
  v_new_cover_ok boolean;
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
  -- and the v3 story fields are additive-optional under docVersion 1); a
  -- differing version is a deliberate transition or a client that discarded
  -- a malformed/unknown-version doc — never resurrect into it.
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

    -- ── Graft A (v3): monotonic story flags ────────────────────────────
    -- Mirrors the client's own unionCompletionMaps OR-union of these exact
    -- four flags (gameCore.ts): if OLD carried the JSON boolean `true` and
    -- NEW's value at the same key is anything other than `true` (absent,
    -- `false`, or a malformed shape), the repaired doc's key is forced to
    -- `true`. A `false` is NEVER invented — when OLD is not `true`, NEW's
    -- value (present or absent, any shape) is left exactly as sent.
    foreach v_flag_key in array array[
      'storyIntroSeen', 'firstRunComplete', 'dashboardOrientationSeen', 'onboardingComplete'
    ] loop
      if (OLD.doc -> v_flag_key) = 'true'::jsonb
         and (NEW.doc -> v_flag_key) is distinct from 'true'::jsonb then
        v_doc := jsonb_set(v_doc, array[v_flag_key], 'true'::jsonb);
      end if;
    end loop;

    -- ── Graft B (v3): coverLook / coverLookAt, LAST-WRITE-WINS ─────────
    -- Mirrors the client's own persisted-doc merge (gameCore.ts) with
    -- local := NEW, server := OLD: NEW's pair wins by default (v_doc already
    -- carries NEW's values verbatim, whatever their shape); OLD's pair wins
    -- ONLY when OLD carries a present STRING coverLook AND a NUMBER
    -- coverLookAt AND (NEW's coverLook is not a string, OR NEW's coverLookAt
    -- is not a number, OR OLD's stamp is STRICTLY GREATER than NEW's) — the
    -- same strict-greater tie rule as the client (NEW wins ties). Requiring
    -- OLD.coverLook to be a present string is the DEFENSIVE PAIRING guard: a
    -- stamped-but-lookless OLD (malformed/hand-edited) can never clobber a
    -- valid look on NEW. Never invents shape NEW didn't send: when OLD does
    -- not win, NEW's coverLook/coverLookAt are left exactly as NEW sent
    -- them (already the case, since v_doc starts from NEW.doc).
    -- ⚠ NULL-SAFETY, THE WAY THIS IS WRITTEN IS LOAD-BEARING (v3 review, P0).
    -- `->` on a MISSING key yields SQL NULL (not jsonb 'null'), and
    -- jsonb_typeof() is STRICT, so `jsonb_typeof(NEW.doc -> 'coverLook')` is
    -- NULL when NEW omits the key. A plain `<> 'string'` on that NULL is NULL,
    -- not TRUE; the enclosing OR/AND collapse to NULL; and plpgsql's IF treats
    -- NULL as FALSE. Written that way the graft would NOT fire in exactly the
    -- case it exists for — an old-build write that omits the pair entirely —
    -- and since v_doc starts from NEW.doc, the child's cover would be ERASED
    -- by the very guard meant to preserve it. (Verified against production
    -- Postgres: the whole condition evaluates to NULL for an absent key.)
    -- So: the presence tests below use `is not distinct from` (never NULL),
    -- and the stamp comparison lives in its OWN nested branch so the ::numeric
    -- casts are UNREACHABLE unless both sides are already known numbers —
    -- PostgreSQL does not promise left-to-right OR short-circuiting, and a
    -- raise here would drop the ENTIRE repair (businesses, tombstones, graft
    -- A, per-idea) through the exception handler, not just this graft.
    --
    -- Non-EMPTY string is required to mirror the client's truthiness check
    -- (`serverDoc.coverLook &&` in gameCore.ts): an empty look is not a look,
    -- and must never win over the other side's real one.
    v_old_cover := OLD.doc -> 'coverLook';
    v_old_at := OLD.doc -> 'coverLookAt';
    v_old_cover_ok := jsonb_typeof(v_old_cover) is not distinct from 'string'
                      and coalesce(OLD.doc ->> 'coverLook', '') <> ''
                      and jsonb_typeof(v_old_at) is not distinct from 'number';
    v_new_cover_ok := jsonb_typeof(NEW.doc -> 'coverLook') is not distinct from 'string'
                      and coalesce(NEW.doc ->> 'coverLook', '') <> ''
                      and jsonb_typeof(NEW.doc -> 'coverLookAt') is not distinct from 'number';
    if v_old_cover_ok then
      if not v_new_cover_ok then
        -- NEW carries no usable pair (omitted, wrong shape, or an empty look):
        -- OLD's surviving choice is re-grafted rather than dropped.
        v_doc := jsonb_set(v_doc, '{coverLook}', v_old_cover);
        v_doc := jsonb_set(v_doc, '{coverLookAt}', v_old_at);
      elsif (OLD.doc ->> 'coverLookAt')::numeric > (NEW.doc ->> 'coverLookAt')::numeric then
        -- Both sides valid: strictly-newer stamp wins, so NEW keeps ties.
        v_doc := jsonb_set(v_doc, '{coverLook}', v_old_cover);
        v_doc := jsonb_set(v_doc, '{coverLookAt}', v_old_at);
      end if;
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
