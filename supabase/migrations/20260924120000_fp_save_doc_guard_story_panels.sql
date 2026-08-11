-- First Profit game — fp_player_saves DOC GUARD v5: STORY PANELS UNION+LWW.
-- v4 (20260923120000_fp_save_doc_guard_hero.sql — APPLIED to production
-- 2026-08-10) protects `businesses`, the per-idea monotonic maps/id, the
-- `deletedIdeaIds` tombstone union, the four monotonic story flags, the
-- `coverLook`/`coverLookAt` LAST-WRITE-WINS pair, and the
-- `heroConfig`/`heroConfigAt` LAST-WRITE-WINS pair. It knows NOTHING of the
-- fpv03 `storyPanels` MAP — the kid's per-question story answers, an OPTIONAL
-- top-level jsonb OBJECT keyed by stable question id:
--
--     { "storyPanels": { "<questionId>": { "answer": "…", "answerAt": 1723… } } }
--
-- omitted entirely when the kid has no panels, additive-optional under
-- docVersion 1 (NOT bumped). Like `heroConfig`, this field has NO writer in
-- production yet — the unit that adds Graft D's reader is the first client
-- build to write it — so this migration lands STRICTLY AHEAD of the risk
-- window (the heroConfig posture, not coverLook's catch-up grace window).
-- v5 replaces the guard function whole with v4's semantics carried forward
-- VERBATIM, plus one new graft.
--
-- ✅ APPLIED TO PRODUCTION 2026-08-11 via the Management API playbook
--   (project deolvqnyvhhnavsifgxz). Live ledger top was reconfirmed as
--   20260923120000 immediately before applying, so this file's assumed slot
--   was correct and no rename was needed. Ledger version 20260924120000 was
--   recorded as a SEPARATE step AFTER the DDL returned success.
--   Live confirmation: fp_player_saves_doc_guard prosrc grew 18737 -> 23626
--   bytes and now contains storyPanels, the v_new_panels_ok gates and the
--   jsonb_object_keys iteration; trigger enabled, BEFORE UPDATE FOR EACH ROW.
--   POST-APPLY PROBES: ALL TEN PASSED against the live trigger, run on a
--   scratch table with request.jwt.claims SET and session_exempt asserted
--   FALSE first (the Management API session is JWT-less and would otherwise
--   take the exemption arm and pass vacuously). Passing: FULL-OMISSION keeps
--   both panels (the null-propagation probe), v4 hero + v3 cover/flags still
--   preserved under that same omission, PARTIAL-OMISSION grafts the untouched
--   key while accepting the edited one, older-stamp-loses, newer-stamp-wins,
--   unstamped-NEW-loses, tie-goes-to-NEW, garbage-NEW-keeps-OLD-panels,
--   absent-stays-absent, docVersion-mismatch-passthrough.
--
-- ⚠ VERSION / NEXT-FREE SLOT. Ledger-top confirmation at authoring time:
--   every prior migration in this tree THROUGH
--   20260923120000_fp_save_doc_guard_hero IS APPLIED TO PRODUCTION, so the v4
--   guard file must NOT be amended in place — this change stacks as a NEW
--   migration (the 20260909 convention). The slot below assumes the top of
--   supabase_migrations.schema_migrations is 20260923120000. The TRUE
--   next-free slot MUST be reconfirmed against the LIVE ledger immediately
--   before applying (a migration may have landed between authoring and the
--   gate); if the live top is not 20260923120000, RENAME this file to the
--   real next-free 12:00:00 slot before applying. Apply via the Management
--   API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- ⚠ LEDGER RECORDING: the Management API's raw-SQL endpoint executes the DDL
--   below but does NOT itself record an entry in
--   supabase_migrations.schema_migrations — that endpoint has no knowledge of
--   the CLI's migration bookkeeping. Recording the version is therefore a
--   SEPARATE, VERIFIED step the applier must take AFTER the DDL above has
--   been confirmed to succeed (query pg_trigger / pg_proc to confirm the new
--   function and trigger exist before inserting the ledger row) — never
--   embed an INSERT into supabase_migrations.schema_migrations inside this
--   file, and never record the version speculatively before the DDL is
--   verified live. Getting this order backwards is how the ledger and the
--   database silently diverge.
--
-- AMENDMENT LOG (in-place amendments are allowed ONLY while this file is
--   branch-only / never applied; once applied, changes stack as a new
--   migration):
--   * (none yet — initial authoring.)
--
-- ⚠ DEPLOY ORDERING: this guard v5 is PROTECTIVE and must be LIVE IN
--   PRODUCTION BEFORE any first-profit build that writes `storyPanels`
--   deploys. This is the strict case, exactly like heroConfig: `storyPanels`
--   has NO writer in production today, and the unit that introduces it ships
--   its READER in the same unit — there is no catch-up window the way there
--   was for coverLook (which was already shipping writes before its guard
--   landed). Landing this guard first is simply correct, not merely
--   lower-risk. The MIXED-BUILD ordering from v1/v2/v3/v4 still holds
--   transitively, carried forward verbatim: this guard must stay live BEFORE
--   the first-profit build that writes `businesses` / `doneByTask` /
--   `doneAtByTask` (v1, applied), BEFORE the first-profit build that ships
--   DELETE_IDEA / writes `deletedIdeaIds` (v2, applied THROUGH 20260910 and
--   now live), BEFORE the first-profit builds that write the four v3 story
--   flags / `coverLook` (v3, applied THROUGH 20260921 and now live), and
--   BEFORE the build that writes `heroConfig` (v4, applied 2026-08-10). Old
--   clients against guard v5 are safe: they omit `storyPanels` entirely
--   (key-absent), and the guard re-grafts OLD's whole map, so a stale write
--   can never clear a flag, clobber a newer cover choice, clobber a newer
--   hero choice, or ERASE A KID'S STORY ANSWERS.
--
-- ⚠ POST-APPLY VERIFICATION (the apply is NOT complete until this passes):
--   after applying via the Management API, run a synthetic probe — seed a
--   scratch row (or use the designated test child) with a docVersion-1 doc,
--   then under a REAL child JWT via PostgREST (the Management API session is
--   JWT-less and would otherwise take the exemption arm and pass VACUOUSLY —
--   assert session_exempt = false first, i.e. run with `request.jwt.claims`
--   SET, as the v4 apply did):
--   1. All v4 probes (every v2/v3 probe, plus the HERO-CONFIG LWW +
--      FULL-OMISSION probes — see the v4 header) still pass unchanged.
--   2. STORY-PANELS FULL-OMISSION probe — RUN THIS ONE, IT IS THE PROBE THAT
--      CATCHES THE NULL-PROPAGATION BUG, AND IT MUST NEVER BE REMOVED. Seed
--      OLD with `storyPanels: {"q1":{"answer":"a dog","answerAt":5000}}`,
--      UPDATE with a NEW doc that OMITS `storyPanels` ENTIRELY (the classic
--      old-build write) → the merged row must STILL carry
--      `{"q1":{"answer":"a dog","answerAt":5000}}`. v3's coverLook graft
--      shipped exactly this bug in its FIRST DRAFT: `jsonb_typeof()` of an
--      ABSENT key is SQL NULL, a plain `<>` comparison on that NULL is NULL,
--      the surrounding AND/OR collapsed to NULL, and plpgsql's IF treated it
--      as false — so the first draft passed every OTHER probe while silently
--      DROPPING the protected field on the one write it exists to protect
--      against.
--   3. STORY-PANELS PARTIAL-OMISSION probe (key-set monotonicity). Seed OLD
--      with `{"qA":{"answer":"old A","answerAt":1000},
--      "qB":{"answer":"old B","answerAt":1000}}`; UPDATE with NEW carrying
--      ONLY `{"qB":{"answer":"new B","answerAt":2000}}` → the merged map has
--      BOTH keys: `qA` VERBATIM from OLD (`"old A"`/1000) and `qB` as NEW
--      sent it (`"new B"`/2000). A key present in OLD is NEVER subtracted.
--   4. STORY-PANELS LWW probe, BOTH DIRECTIONS, on a shared key.
--      a. OLD `{"q1":{"answer":"old","answerAt":5000}}` vs NEW
--         `{"q1":{"answer":"new","answerAt":1000}}` (an OLDER stamp — e.g. a
--         backgrounded tab flushing a stale in-memory answer) → merged keeps
--         OLD's UNIT: `{"answer":"old","answerAt":5000}`. The `answer` and
--         `answerAt` must move TOGETHER — a merged
--         `{"answer":"new","answerAt":5000}` is a FAILURE, not a pass.
--      b. Then UPDATE with `{"q1":{"answer":"newer","answerAt":9000}}` → the
--         merged row adopts NEW's unit verbatim.
--   5. STORY-PANELS UNSTAMPED-LOSES probe: OLD `{"q1":{"answer":"stamped",
--      "answerAt":5000}}` vs NEW `{"q1":{"answer":"unstamped"}}` (answerAt
--      OMITTED — the legal unstamped shape) → merged keeps OLD's stamped
--      unit. And the mirror: OLD `{"q1":{"answer":"unstamped"}}` (no stamp)
--      vs NEW `{"q1":{"answer":"stamped","answerAt":1}}` → NEW wins (a side
--      with no usable numeric stamp always LOSES to one that has one).
--   6. STORY-PANELS TIE probe: identical `answerAt` on both sides with
--      DIFFERENT answers → NEW's unit survives (ties go to NEW, matching the
--      v3/v4 coverLook/heroConfig rule). Same when NEITHER side has a usable
--      stamp.
--   7. STORY-PANELS GARBAGE probe (never errors, never destroys the other
--      side): (a) OLD `storyPanels` = `"nope"` / `[1,2]` / `7` with a real
--      NEW map → the UPDATE SUCCEEDS and NEW's map is untouched; (b) OLD a
--      real map with NEW `storyPanels` = `"nope"` / `[1,2]` → the UPDATE
--      SUCCEEDS and OLD's map survives (a non-object side is treated as "no
--      panels", never as an error); (c) a per-key value that is a scalar
--      (e.g. `{"q1":"plain string"}`) on either side → no error, and OLD's
--      scalar entry still grafts back on the key-absent path (key-set
--      monotonicity does not inspect shape).
--   8. STORY-PANELS ABSENT-STAYS-ABSENT probe: neither side carries
--      `storyPanels` → the merged doc does NOT gain the key.
--   ⚠ PROBE-HARNESS GOTCHA, carried forward from v4's header verbatim
--   because it costs an hour every time it is rediscovered: reset the scratch
--   row between probes with DELETE + INSERT, NEVER with UPDATE. An UPDATE
--   reset is itself subject to this trigger, so restoring a seed whose stamp
--   is OLDER than what the previous probe left is correctly REFUSED (the
--   guard re-grafts the newer state) — every later probe then reads the wrong
--   OLD and reports a false failure.
--   Then restore the row to its pre-probe state.
--
-- SEMANTICS v5 (mirrored byte-for-intent by the TS spec,
--   app/lib/fp/fp-save-doc-guard-rules.ts `guardSaveDocUpdate`; parity test:
--   app/lib/fp/__tests__/fp-save-doc-guard-migration-parity.test.ts — which
--   now parses THIS file). Everything from v4 is carried forward unchanged
--   (the docVersion gate, the element-count fuse, key-level omission
--   semantics, the businesses carry, the deletedIdeaIds tombstone union, the
--   tail-append skip, id/index idea matching, the monotonic per-idea grafts,
--   the four monotonic story flags, the coverLook/coverLookAt LWW pair, the
--   heroConfig/heroConfigAt LWW pair, the never-raise posture, the
--   service_role/JWT-less exemption); v5 ADDS, inside the protected repair
--   region, IMMEDIATELY AFTER the heroConfig graft and BEFORE the per-idea
--   `ideas` gate (so the new graft applies even when idea handling is
--   skipped — exactly like the tombstone union and the coverLook/heroConfig
--   grafts):
--
--   * GRAFT D — storyPanels, a per-key UNION with a per-key LAST-WRITE-WINS.
--     This field carries TWO semantics at once and they are NOT the same
--     rule; conflating them is how it breaks:
--
--     (1) KEY EXISTENCE IS MONOTONIC. The merged map's key set is
--         OLD ∪ NEW. A key present in OLD but ABSENT from NEW is GRAFTED
--         BACK VERBATIM — that omitted-key clobber is the entire reason this
--         graft exists (an old build that knows nothing of a question id, or
--         a partial write, must never subtract a kid's answer). A key is
--         NEVER removed from the merged set, whatever its value's shape.
--
--     (2) A KEY PRESENT ON BOTH SIDES resolves as an INSEPARABLE UNIT,
--         last-write-wins on `answerAt`: the whole `{answer, answerAt}`
--         object from the winning side is written, never a mix. OLD's unit
--         wins ONLY when OLD's `answerAt` is a NUMBER and (NEW's `answerAt`
--         is NOT a number, OR OLD's is STRICTLY GREATER). So: a larger stamp
--         wins; a side with a missing/non-numeric stamp LOSES to a side that
--         has a numeric one; on a TIE, or when NEITHER side has a usable
--         stamp, NEW WINS — the same tie rule as the v3 coverLook and v4
--         heroConfig grafts, and the same "local := NEW, server := OLD"
--         orientation (v_doc starts as NEW.doc, so NEW is the default-wins
--         side and OLD only ever overrides it).
--
--     NEVER combine an `answer` from one side with an `answerAt` from the
--     other: the graft only ever `jsonb_set`s the winning side's WHOLE value
--     at the key, so the pair cannot be torn.
--
--     `answer` is not inspected at all (it is always present client-side and
--     may legitimately be `""` — an empty answer is a real edit, unlike
--     coverLook's `""`, which was a missing look). Only `answerAt` is read,
--     and only for its NUMBER-ness.
--
--     GARBAGE / NON-OBJECT SAFETY, both levels:
--       - TOP LEVEL: a `storyPanels` that is not a jsonb OBJECT (scalar,
--         array, JSON null, or absent) on EITHER side is treated as "no
--         panels", never an error. Iterating the keys is gated on OLD being
--         an object — `jsonb_object_keys()` RAISES on a scalar or array, and
--         a raise inside the protected region would discard the ENTIRE
--         repair, so the gate is load-bearing, not cosmetic. When OLD is not
--         an object the graft does nothing at all (NEW's value survives
--         verbatim, whatever it is — the guard never invents shape NEW did
--         not send). When OLD IS an object and NEW is not, the merged map is
--         built from OLD's keys alone (NEW's garbage value is replaced by a
--         real map rather than being allowed to erase the kid's answers).
--       - PER KEY: a value that is not an object contributes no `answerAt`
--         (`->` with a text key on a jsonb scalar/array yields SQL NULL, not
--         an error), so it simply loses the LWW when the key is shared, and
--         grafts back verbatim when the key is OLD-only. No shape check is
--         needed or performed beyond that.
--
--     WRITE-BACK: the merged map is written back only when it is NON-EMPTY
--     or NEW carried the key — so `absent-stays-absent` holds (neither side
--     has panels ⇒ the key is not invented), mirroring the tombstone
--     write-back rule.
--
--   Everything remains CLAMP-NEVER-RAISE: any unexpected shape (a string,
--   number, array, or boolean where an object or number is expected)
--   contributes nothing to the graft, and the save still succeeds.
--
-- ⚠ NULL-SAFETY, THE WAY THIS IS WRITTEN IS LOAD-BEARING (the v3 P0 review
--   finding — READ THIS BEFORE TOUCHING GRAFT D). `->` on a MISSING key
--   yields SQL NULL (not jsonb 'null'), and jsonb_typeof() is STRICT, so
--   `jsonb_typeof(NEW.doc -> 'storyPanels')` is NULL when NEW omits the key.
--   A plain `<> 'object'` comparison on that NULL is NULL, not TRUE; the
--   enclosing OR/AND collapse to NULL; and plpgsql's IF treats NULL as FALSE.
--   Written that way the graft would NOT fire in exactly the case it exists
--   for — an old-build write that omits the map entirely — and since v_doc
--   starts from NEW.doc, the child's story answers would be ERASED by the
--   very guard meant to preserve them. v3's FIRST DRAFT of the coverLook
--   graft shipped exactly this bug and it was caught in review before it
--   reached production; the fix is copied verbatim here rather than
--   reinvented:
--     * every presence/type test uses `is not distinct from` (never NULL,
--       regardless of key presence) — the top-level object tests
--       (v_old_panels_ok / v_new_panels_ok) and the per-key stamp tests
--       (v_old_panel_ok / v_new_panel_ok) alike;
--     * the per-key stamp comparison lives in its OWN NESTED branch (`elsif`
--       under `if v_old_panel_ok` / `if not v_new_panel_ok`) so the
--       ::numeric casts are UNREACHABLE unless BOTH sides are already known
--       numbers — PostgreSQL does not promise left-to-right OR
--       short-circuiting, and a raise inside the protected region would
--       discard the ENTIRE repair (businesses, tombstones, the story flags,
--       coverLook, heroConfig, per-idea grafts), not just this one graft;
--     * the key-absence test uses jsonb's `?` operator on the accumulator
--       (never a NULL-valued comparison), so a key whose VALUE is JSON
--       `null` counts as PRESENT (it is a value the writer sent) rather than
--       silently taking the graft-back path.
--
-- ACCEPTED FAIL-OPEN (JWT-less exemption arm) — carried from v1/v2/v3/v4
--   verbatim: owner maintenance (the r28 erase, doc repairs) runs through the
--   Supabase Management API SQL endpoint, which is a JWT-less session that is
--   NOT service_role — dropping the JWT-less arm would make the guard
--   re-graft state during intentional owner repairs, so the arm stays. The
--   accepted tradeoff: a claims-propagation regression in PostgREST/GoTrue
--   (client requests arriving with empty request.jwt.claims) would silently
--   disable the guard for client traffic — fail-open, not fail-closed.
--   Accepted because such a regression would simultaneously break
--   RLS-scoped reads loudly (nothing would load), and the post-apply probe
--   above verifies the claims path end-to-end at apply time.
--
-- ACCEPTED LOSS MODE (old-build idea fusion) — carried from v1/v2/v3/v4
--   verbatim: the index fallback can FUSE two distinct ideas. If a new-build
--   session creates an idea (id-bearing, at OLD index k) while an old-build
--   session concurrently creates its OWN distinct idea at the same index
--   (id-less, since the old build never emits ids), the old-build write's
--   idea k index-matches the new-build idea: the new idea's id and monotonic
--   maps are grafted onto the old-build idea's content, and the new-build
--   idea is NOT appended at the tail (it was "matched"). The two ideas fuse;
--   the new-build idea's fields are lost. Deliberately NOT heuristically
--   defended: any content-similarity heuristic would misfire worse, exposure
--   is proportional to the length of the mixed-build window (short by the
--   deploy-ordering rule above), and it requires the same child racing two
--   builds while creating ideas in both. Pinned as the accepted outcome by
--   the behavioral suite.
--
-- ACCEPTED BOUND (tombstone cap) — carried from v2/v3/v4 verbatim: ids past
--   the first-100 scan of a side, or past the 100-entry union cap, are
--   dropped from the effective set (their ideas would then re-append as
--   accidents — fail-SAFE toward preservation, never toward deletion).
--   Unreachable for legitimate docs: the FP client caps ideas at
--   MAX_IDEAS = 5, so a real deletedIdeaIds can never approach 100 entries.
--   The cap and per-id length also bound the guard's CPU and the doc's
--   growth (the pg_column_size CHECK edge from v1 is unchanged).
--
-- DELIBERATELY UNCAPPED (storyPanels key count): Graft D scans every key of
--   OLD's map with O(1) work per key — no cap, unlike the tombstone union.
--   A cap here would be SUBTRACTIVE (it would drop a kid's answer past the
--   Nth key), which directly contradicts the key-monotonicity contract that
--   is this graft's whole point, so preservation wins over the CPU bound.
--   The work is already bounded from above by the 256KiB pg_column_size
--   CHECK on the doc column: a map that cannot be stored cannot be scanned,
--   and the loop is linear (single hash lookup per key), not quadratic like
--   the idea matcher that needed the element-count fuse.
--
-- ACCEPTED EDGE (size cap) — carried from v1/v2/v3/v4 verbatim: grafting can
--   only grow NEW.doc; a doc already near the 256KiB pg_column_size CHECK
--   could be pushed over it, failing the old-build write with 23514 (the
--   client shows its honest "couldn't save"). That refusal PRESERVES the
--   server doc — strictly better than the silent erasure this guard exists
--   to stop — and is unreachable for any legitimately-sized save. Graft D
--   can re-add at most the panels OLD already stored, so the merged doc is
--   bounded by (NEW's doc + OLD's storyPanels) — the same order of growth
--   as the businesses carry, not a new class of risk.
--
-- PROJECTION UNCHANGED: fp_public_site_content / fp_public_sites_project_save
--   (20260907..20260909) read doc->'ideas' only — storyPanels (like
--   heroConfig/heroConfigAt) is never extracted or served, so the products
--   projection needs NO change.
--
-- TRIGGER ORDER: BEFORE UPDATE triggers fire in name order;
--   fp_player_saves_doc_guard sorts before fp_player_saves_revision_guard, so
--   the repair runs first. The two are independent (this guard never touches
--   revision/updated_at), so the ordering is incidental, not load-bearing.
--
-- DROP + RECREATE, EVERY ATTRIBUTE RE-ESTABLISHED (the 20260909 convention):
--   the function's signature is unchanged, but the drop discards its
--   attributes and ACL, so everything v1/v2/v3/v4 established is re-applied
--   below — `security definer`, `set search_path = public`, and the trigger
--   wiring (the trigger must be dropped FIRST: it depends on the function).
--   No prior version granted/revoked anything explicitly on this function (a
--   trigger function is invoked by the trigger machinery, never via RPC;
--   PostgREST exposes only functions returning non-trigger types), so there
--   are no grants to re-apply — the default ACL is identical before and
--   after.
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
  v_old_hero   jsonb;
  v_old_hero_at jsonb;
  v_old_hero_ok boolean;
  v_new_hero_ok boolean;
  v_old_panels jsonb;
  v_new_panels jsonb;
  v_panels     jsonb;
  v_panel_key  text;
  v_old_panel  jsonb;
  v_new_panel  jsonb;
  v_old_panels_ok boolean;
  v_new_panels_ok boolean;
  v_old_panel_ok  boolean;
  v_new_panel_ok  boolean;
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
  -- and the story/cover/hero/panel fields are additive-optional under
  -- docVersion 1); a differing version is a deliberate transition or a client
  -- that discarded a malformed/unknown-version doc — never resurrect into it.
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
    -- casts are UNREACHABLE unless both sides are known numbers —
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

    -- ── Graft C (v4): heroConfig / heroConfigAt, LAST-WRITE-WINS ───────
    -- Mirrors Graft B exactly, with `heroConfig` (a jsonb OBJECT) in place of
    -- `coverLook` (a string) and `heroConfigAt` in place of `coverLookAt`.
    -- NEW's pair wins by default (v_doc already carries NEW's values
    -- verbatim); OLD's pair wins ONLY when OLD carries a present jsonb
    -- OBJECT heroConfig AND a NUMBER heroConfigAt (the DEFENSIVE PAIRING
    -- guard — a stamped-but-configless OLD can never clobber a valid config
    -- on NEW) AND (NEW's heroConfig is not an object, OR NEW's heroConfigAt
    -- is not a number, OR OLD's stamp is STRICTLY GREATER than NEW's) — NEW
    -- wins ties, matching the coverLook rule. Never invents shape NEW didn't
    -- send: when OLD does not win, NEW's heroConfig/heroConfigAt are left
    -- exactly as NEW sent them (already the case, since v_doc starts from
    -- NEW.doc).
    --
    -- OBJECT-SHAPE VALIDITY: unlike coverLook's non-empty-STRING test,
    -- "non-empty" has no meaning for an object here — the validity test is
    -- simply `jsonb_typeof(...) = 'object'`, which excludes an array
    -- (jsonb_typeof returns 'array') and any scalar (string/number/boolean).
    --
    -- ⚠ NULL-SAFETY — SAME LOAD-BEARING SHAPE AS GRAFT B (see the note above
    -- Graft B in full; not re-derived here). `->` on a MISSING key yields SQL
    -- NULL, jsonb_typeof() is STRICT, so a plain `<>` comparison against
    -- 'object' on an absent key's NULL typeof would itself be NULL, collapse
    -- the enclosing AND/OR to NULL, and be treated as FALSE by plpgsql's IF —
    -- meaning the graft would NOT fire in exactly the omitted-key case it
    -- exists for, erasing the child's hero. So the presence tests below use
    -- `is not distinct from` (never NULL regardless of key presence), and the
    -- ::numeric stamp comparison lives in its OWN nested branch (the `elsif`
    -- under `if v_old_hero_ok` / `if not v_new_hero_ok`) so the casts are
    -- UNREACHABLE unless both sides are already known numbers — PostgreSQL
    -- does not promise OR short-circuiting, and a raise here would drop the
    -- ENTIRE repair through the exception handler, not just this graft.
    v_old_hero := OLD.doc -> 'heroConfig';
    v_old_hero_at := OLD.doc -> 'heroConfigAt';
    v_old_hero_ok := jsonb_typeof(v_old_hero) is not distinct from 'object'
                      and jsonb_typeof(v_old_hero_at) is not distinct from 'number';
    v_new_hero_ok := jsonb_typeof(NEW.doc -> 'heroConfig') is not distinct from 'object'
                      and jsonb_typeof(NEW.doc -> 'heroConfigAt') is not distinct from 'number';
    if v_old_hero_ok then
      if not v_new_hero_ok then
        -- NEW carries no usable pair (omitted or wrong shape): OLD's
        -- surviving choice is re-grafted rather than dropped.
        v_doc := jsonb_set(v_doc, '{heroConfig}', v_old_hero);
        v_doc := jsonb_set(v_doc, '{heroConfigAt}', v_old_hero_at);
      elsif (OLD.doc ->> 'heroConfigAt')::numeric > (NEW.doc ->> 'heroConfigAt')::numeric then
        -- Both sides valid: strictly-newer stamp wins, so NEW keeps ties.
        v_doc := jsonb_set(v_doc, '{heroConfig}', v_old_hero);
        v_doc := jsonb_set(v_doc, '{heroConfigAt}', v_old_hero_at);
      end if;
    end if;

    -- ── Graft D (v5): storyPanels — key UNION + per-key LAST-WRITE-WINS ─
    -- TWO semantics in one field (see the header's GRAFT D section):
    --   (1) the merged key set is OLD ∪ NEW — a key OLD has and NEW omits is
    --       grafted back VERBATIM, never subtracted (the old-build clobber
    --       this graft exists to prevent);
    --   (2) a key present on BOTH sides resolves as an INSEPARABLE UNIT,
    --       last-write-wins on `answerAt`: the whole `{answer, answerAt}`
    --       value of the winning side is written, never a mix of the two.
    -- Orientation matches Grafts B/C (local := NEW, server := OLD): the
    -- accumulator STARTS as NEW's map, so NEW wins by default and OLD only
    -- ever overrides — hence ties, and the both-sides-unstamped case, go to
    -- NEW. `answer` itself is never inspected (it may legitimately be "");
    -- only `answerAt`'s NUMBER-ness and value are read.
    --
    -- ⚠ NULL-SAFETY / GARBAGE-SAFETY, LOAD-BEARING (see the header's
    -- NULL-SAFETY section; the v3 P0 in a new costume):
    --   * the top-level object tests use `is not distinct from` so an ABSENT
    --     `storyPanels` yields FALSE, not NULL-treated-as-false-by-accident —
    --     v_old_panels_ok is what makes the FULL-OMISSION case (NEW omits the
    --     key entirely) actually fire instead of silently erasing the map;
    --   * iterating is gated on v_old_panels_ok because jsonb_object_keys()
    --     RAISES on a scalar/array, and a raise inside this protected region
    --     would discard the ENTIRE repair, not just this graft. A non-object
    --     `storyPanels` on either side is therefore treated as "no panels",
    --     never an error;
    --   * a per-key value that is not an object yields SQL NULL from
    --     `-> 'answerAt'` (no error), so v_old_panel_ok / v_new_panel_ok are
    --     plain FALSE for it: junk simply loses a contested key and still
    --     grafts back on an uncontested one;
    --   * the ::numeric casts sit in their OWN nested branch (`elsif` under
    --     `if v_old_panel_ok` / `if not v_new_panel_ok`), unreachable unless
    --     BOTH stamps are already known numbers — PostgreSQL does not promise
    --     OR short-circuiting;
    --   * key presence is tested with jsonb's `?` on the accumulator, so a
    --     key whose VALUE is JSON `null` counts as PRESENT (a value the
    --     writer sent) rather than taking the graft-back path.
    v_old_panels := OLD.doc -> 'storyPanels';
    v_new_panels := NEW.doc -> 'storyPanels';
    v_old_panels_ok := jsonb_typeof(v_old_panels) is not distinct from 'object';
    v_new_panels_ok := jsonb_typeof(v_new_panels) is not distinct from 'object';
    if v_old_panels_ok then
      -- Start from NEW's map when it is usable; when it is not (omitted or
      -- garbage) start empty, so OLD's panels are restored rather than lost.
      v_panels := case when v_new_panels_ok then v_new_panels else '{}'::jsonb end;
      for v_panel_key in select k from jsonb_object_keys(v_old_panels) as k loop
        v_old_panel := v_old_panels -> v_panel_key;
        if not (v_panels ? v_panel_key) then
          -- (1) KEY MONOTONICITY: NEW does not know this key — graft OLD's
          -- whole value back verbatim, whatever its shape.
          v_panels := jsonb_set(v_panels, array[v_panel_key], v_old_panel, true);
        else
          -- (2) CONTESTED KEY: resolve the {answer, answerAt} UNIT by LWW.
          v_new_panel := v_panels -> v_panel_key;
          v_old_panel_ok := jsonb_typeof(v_old_panel -> 'answerAt') is not distinct from 'number';
          v_new_panel_ok := jsonb_typeof(v_new_panel -> 'answerAt') is not distinct from 'number';
          if v_old_panel_ok then
            if not v_new_panel_ok then
              -- NEW's side has no usable stamp: OLD's stamped unit wins whole.
              v_panels := jsonb_set(v_panels, array[v_panel_key], v_old_panel, true);
            elsif (v_old_panel ->> 'answerAt')::numeric > (v_new_panel ->> 'answerAt')::numeric then
              -- Both stamped: strictly-newer wins, so NEW keeps ties.
              v_panels := jsonb_set(v_panels, array[v_panel_key], v_old_panel, true);
            end if;
          end if;
        end if;
      end loop;
      -- Written back whenever non-empty OR NEW carried the key; when neither
      -- side has panels the key is not invented (absent-stays-absent), and a
      -- garbage NEW value is thereby CLAMPED to the merged map.
      if v_panels <> '{}'::jsonb or NEW.doc ? 'storyPanels' then
        v_doc := jsonb_set(v_doc, '{storyPanels}', v_panels);
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
