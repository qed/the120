-- First Profit game — fp_player_saves DOC GUARD: a BEFORE UPDATE trigger that
-- preserves monotonic save-doc sub-state an incoming full-column doc REPLACE
-- omits at the KEY level (P0 mixed-build data-loss finding).
--
-- THE HAZARD. fp_player_saves stores the whole game save as one JSONB `doc`
--   column written by CAS full-column replace (`set doc = $new, revision =
--   revision + 1 where revision = $base`). During a mixed-build deploy window
--   the currently-shipped OLD first-profit build knows an older doc shape: its
--   fromSaveDoc coercion KEEPS only { fields, done, doneAt } per idea and has
--   no top-level `businesses` at all. An old-build session's ordinary
--   SUCCESSFUL write (CAS passes — it is the sequential writer, not a CAS
--   loser) therefore re-emits the doc WITHOUT the new build's keys: top-level
--   `businesses` (promotions, archive state, phase 4-5 progress) and per-idea
--   `id` / `doneByTask` / `doneAtByTask` — permanently erasing them, with no
--   legacy shadow to recover from. The client-side rebase union
--   (unionCompletionMaps) only protects CAS LOSERS; this trigger is the
--   server-side guard for the sequential old-code writer.
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. The placeholder slot below assumes the
--   top of supabase_migrations.schema_migrations is still 20260905120000
--   fp_task_feedback (the latest file in this tree at authoring time). The
--   TRUE next-free slot MUST be reconfirmed against the LIVE ledger
--   immediately before applying (a migration may have landed between authoring
--   and the gate). If the live top is not 20260905120000, RENAME this file to
--   the real next-free 12:00:00 slot before applying. Apply via the Management
--   API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- ⚠ DEPLOY ORDERING (MIXED-BUILD window): this guard must be LIVE in prod
--   BEFORE the first-profit build that writes `businesses` /
--   `doneByTask` / `doneAtByTask` deploys — the erasure it prevents happens
--   the first time an old-build session saves over a new-build doc, so the
--   window opens the moment the new build serves its first session.
--
-- SEMANTICS (mirrored byte-for-intent by the TS spec,
--   app/fp/lib/fp-save-doc-guard-rules.ts `guardSaveDocUpdate`; parity test:
--   app/fp/lib/__tests__/fp-save-doc-guard-migration-parity.test.ts):
--
--   * KEY-LEVEL omission only. A key entirely ABSENT from the incoming doc
--     means "this writer does not know the field" → repair by grafting OLD's
--     value. A key PRESENT but empty ({} / []) is an intentional state →
--     left strictly alone.
--   * Top-level: OLD.doc has 'businesses' and NEW.doc does not → carry OLD's
--     `businesses` into NEW.doc unchanged.
--   * Per idea (NEW.doc->'ideas', matched to OLD.doc->'ideas' by `id` when
--     both sides carry string ids, else by array index — ids are stable
--     identity, minted deterministically for legacy docs; ideas are
--     append-only in every build, never reordered): graft each MONOTONIC map
--     the matched OLD idea has and the NEW idea lacks. The monotonic key list
--     is EXACTLY the set unionCompletionMaps unions per idea in the
--     first-profit gameCore: done, doneAt, doneByTask, doneAtByTask. The
--     idea's `id` (stable identity, not monotonic but strictly
--     writer-unknown when absent) is grafted under the same key-absent rule
--     so an old-build save cannot orphan Business.ideaId links.
--   * OLD ideas matched by NO NEW idea are APPENDED at the tail in OLD order.
--     Justified because NO build can legitimately delete an idea: the old
--     build's only idea writers are CREATE_IDEA (append) and HYDRATE, and the
--     new build documents "ideas are never reordered or deleted"
--     (fromSaveDoc's legacy-id minting depends on it). RESET_SESSION wipes
--     in-memory state only at a session boundary where the sync engine is
--     stopped and generation-guarded — it never persists. This matches
--     unionCompletionMaps, which likewise appends unmatched server ideas.
--   * NO-OP for new-build writes: the new build always re-emits every key it
--     loaded (absent-stays-absent discipline), so every graft condition is
--     false and the doc passes through semantically unchanged.
--   * NEVER raises — it repairs, it does not reject. Malformed shapes (either
--     doc not a JSON object, `ideas` not an array, non-object idea entries)
--     degrade to passing NEW through unchanged, and the whole body is wrapped
--     in a catch-all that returns NEW. Rejection stays the CHECK/RLS/revision
--     guard's job.
--   * EXEMPT: service_role and JWT-less (non-PostgREST) sessions — the owner
--     must stay able to intentionally reset or repair a save (r28 erase,
--     dashboard maintenance) without the guard resurrecting state.
--
-- ACCEPTED EDGE (size cap): grafting can only grow NEW.doc; a doc already
--   near the 256KiB pg_column_size CHECK could be pushed over it, failing the
--   old-build write with 23514 (the client shows its honest "couldn't save").
--   That refusal PRESERVES the server doc — strictly better than the silent
--   erasure this guard exists to stop — and is unreachable for any
--   legitimately-sized save.
--
-- TRIGGER ORDER: BEFORE UPDATE triggers fire in name order;
--   fp_player_saves_doc_guard sorts before fp_player_saves_revision_guard, so
--   the repair runs first. The two are independent (this guard never touches
--   revision/updated_at), so the ordering is incidental, not load-bearing.
--
-- Idempotent throughout (create or replace / drop-and-create trigger) —
-- re-applying is a no-op. Additive-only.

create or replace function public.fp_player_saves_doc_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_ideas jsonb;
  v_new_ideas jsonb;
  v_out_ideas jsonb;
  v_new_idea  jsonb;
  v_old_idea  jsonb;
  v_new_id    text;
  v_match     integer;
  v_used      integer[];
  v_key       text;
begin
  -- Owner/maintenance sessions may rewrite the doc freely (intentional reset,
  -- PII scrub, repair). Every PostgREST child request carries jwt claims, so
  -- this opens nothing to clients (the fp_task_feedback guard precedent).
  if auth.role() = 'service_role'
     or current_setting('request.jwt.claims', true) is null
     or current_setting('request.jwt.claims', true) = '' then
    return NEW;
  end if;

  -- Malformed / non-object docs (including the seeded '{}' OLD, which simply
  -- has no keys to carry): repair is impossible or unnecessary — pass through.
  if OLD.doc is null or NEW.doc is null
     or jsonb_typeof(OLD.doc) <> 'object'
     or jsonb_typeof(NEW.doc) <> 'object' then
    return NEW;
  end if;

  -- ── Top-level carry: businesses ────────────────────────────────────────
  -- Key entirely absent = the writer does not know the field (old build).
  -- Present-but-empty ([]) is intentional and untouched.
  if OLD.doc ? 'businesses' and not NEW.doc ? 'businesses' then
    NEW.doc := jsonb_set(NEW.doc, '{businesses}', OLD.doc -> 'businesses');
  end if;

  -- ── Per-idea grafts ────────────────────────────────────────────────────
  v_old_ideas := OLD.doc -> 'ideas';
  v_new_ideas := NEW.doc -> 'ideas';
  if v_old_ideas is null or v_new_ideas is null
     or jsonb_typeof(v_old_ideas) <> 'array'
     or jsonb_typeof(v_new_ideas) <> 'array' then
    return NEW;
  end if;

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
    -- else by array index (ideas are append-only, so indexes are stable for
    -- id-less pairs). A same-index pair with two DIFFERENT ids is two
    -- distinct ideas and is never fused (the unionCompletionMaps contract).
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
      -- NEW carries an id but the same-index OLD idea predates ids (an old
      -- doc the new build just re-loaded and id-minted): index fallback.
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
      -- only when the key is ENTIRELY ABSENT on NEW and a well-shaped object
      -- on OLD; a present-but-empty {} on NEW is intentional and untouched.
      foreach v_key in array array['done', 'doneAt', 'doneByTask', 'doneAtByTask'] loop
        if jsonb_typeof(v_old_idea -> v_key) = 'object' and not (v_new_idea ? v_key) then
          v_new_idea := jsonb_set(v_new_idea, array[v_key], v_old_idea -> v_key);
        end if;
      end loop;
    end if;

    v_out_ideas := v_out_ideas || jsonb_build_array(v_new_idea);
  end loop;

  -- OLD ideas no NEW idea matched: appended at the tail in OLD order (no
  -- build can legitimately delete an idea — see the header). Non-object
  -- entries are unexpected shape and are not resurrected.
  for j in 0 .. jsonb_array_length(v_old_ideas) - 1 loop
    if not (v_used @> array[j]) and jsonb_typeof(v_old_ideas -> j) = 'object' then
      v_out_ideas := v_out_ideas || jsonb_build_array(v_old_ideas -> j);
    end if;
  end loop;

  NEW.doc := jsonb_set(NEW.doc, '{ideas}', v_out_ideas);
  return NEW;
exception
  when others then
    -- This guard REPAIRS; it must never turn a save into a refusal. Any
    -- unexpected failure degrades to the pre-guard behavior (NEW as sent).
    return NEW;
end;
$$;

drop trigger if exists fp_player_saves_doc_guard on public.fp_player_saves;
create trigger fp_player_saves_doc_guard
  before update on public.fp_player_saves
  for each row execute function public.fp_player_saves_doc_guard();
