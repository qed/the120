/**
 * First Profit SAVE DOC GUARD — the pure TS mirror of the fp_player_saves
 * BEFORE UPDATE doc guard (migration
 * supabase/migrations/20260906120000_fp_save_doc_guard.sql).
 *
 * THE SPEC LIVES HERE. This suite has no test database, so the plpgsql in the
 * migration cannot be executed by tests. Instead, `guardSaveDocUpdate` below
 * is a faithful TS re-implementation of the trigger's merge logic — the
 * behavioral tests (__tests__/fp-save-doc-guard-rules.test.ts) exercise THIS
 * function as the executable spec, and the migration-parity test
 * (__tests__/fp-save-doc-guard-migration-parity.test.ts) parses the .sql as
 * text to pin that the SQL implements the same structure (key lists, presence
 * operators, never-raise posture). Change the semantics in BOTH places or the
 * parity test fails.
 *
 * WHY THE GUARD EXISTS (P0 mixed-build data loss): the deployed OLD
 * first-profit build coerces each idea down to { fields, done, doneAt } and
 * knows no top-level `businesses`. Its ordinary SUCCESSFUL CAS write is a
 * full-column replace that omits those keys entirely — permanently erasing a
 * child's promotions and stable-id task progress. The client-side rebase
 * union (unionCompletionMaps in the first-profit gameCore) only protects CAS
 * LOSERS; this trigger repairs the sequential old-code writer server-side.
 *
 * CONTRACT (key-level omission semantics):
 *  - a key entirely ABSENT from the incoming doc = the writer does not know
 *    the field → graft OLD's value;
 *  - a key PRESENT but empty ({} / []) = intentional state → left alone;
 *  - ideas match by `id` when both sides carry string ids, else by array
 *    index; a same-index pair with two different ids is never fused;
 *  - OLD ideas matched by no NEW idea are appended at the tail (no build can
 *    legitimately delete an idea — old build: CREATE_IDEA/HYDRATE only; new
 *    build: "ideas are never reordered or deleted");
 *  - malformed shapes pass NEW through unchanged; the guard never throws.
 *
 * NO `server-only`, NO Next/Supabase imports — unit-testable in the node-only
 * harness (sibling of fp-task-feedback-rules.ts).
 */

/**
 * The MONOTONIC per-idea completion maps, EXACTLY the set the first-profit
 * gameCore's unionCompletionMaps unions per idea (its unionIdeaCompletions
 * helper): entries only ever move toward "more complete", so grafting a map
 * the writer omitted can never overwrite intent. Order mirrors the SQL's
 * foreach array literal (parity-tested).
 */
export const SAVE_DOC_MONOTONIC_IDEA_KEYS = [
  "done",
  "doneAt",
  "doneByTask",
  "doneAtByTask",
] as const;

/**
 * Stable idea identity. Not a completion map, but strictly writer-unknown
 * when absent (the old build never emits ids; the new build always re-emits
 * one it loaded), and losing it would orphan Business.ideaId links and break
 * future id-matching — so it grafts under the same key-absent rule.
 */
export const SAVE_DOC_IDEA_IDENTITY_KEY = "id";

/**
 * Top-level keys carried whole when OLD has them and NEW omits them. The
 * businesses list carries the remaining monotonic state unionCompletionMaps
 * protects (per-business doneByTask/doneAtByTask, archived/archiveStateAt).
 */
export const SAVE_DOC_CARRIED_TOP_KEYS = ["businesses"] as const;

/** JSON-object check matching jsonb_typeof(x) = 'object' (arrays excluded). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The trigger's merge, as a pure function: (OLD.doc, NEW.doc) → the doc that
 * should actually be stored. Never throws; never mutates its inputs. Returns
 * `newDoc` (possibly the same reference) when there is nothing to repair or
 * the shapes are unexpected.
 */
export function guardSaveDocUpdate(oldDoc: unknown, newDoc: unknown): unknown {
  try {
    // Malformed / non-object docs (including a seeded {} OLD): pass through.
    if (!isJsonObject(oldDoc) || !isJsonObject(newDoc)) return newDoc;

    let out: Record<string, unknown> = newDoc;

    // ── Top-level carry: businesses (key absent = writer-unknown) ──────────
    for (const key of SAVE_DOC_CARRIED_TOP_KEYS) {
      if (key in oldDoc && !(key in newDoc)) {
        out = { ...out, [key]: oldDoc[key] };
      }
    }

    // ── Per-idea grafts ────────────────────────────────────────────────────
    const oldIdeas = oldDoc.ideas;
    const newIdeas = newDoc.ideas;
    if (!Array.isArray(oldIdeas) || !Array.isArray(newIdeas)) return out;

    const used = new Set<number>();
    const outIdeas: unknown[] = [];

    for (let i = 0; i < newIdeas.length; i++) {
      let newIdea = newIdeas[i];
      // Non-object entries are unexpected shape: passed through untouched.
      if (!isJsonObject(newIdea)) {
        outIdeas.push(newIdea);
        continue;
      }

      // Match by id when both sides carry string ids, else by index. A
      // same-index pair with DIFFERENT ids is two distinct ideas: not fused.
      const newId = typeof newIdea[SAVE_DOC_IDEA_IDENTITY_KEY] === "string"
        ? (newIdea[SAVE_DOC_IDEA_IDENTITY_KEY] as string)
        : null;
      let match: number | null = null;
      if (newId !== null) {
        for (let j = 0; j < oldIdeas.length; j++) {
          const candidate = oldIdeas[j];
          if (
            !used.has(j) &&
            isJsonObject(candidate) &&
            candidate[SAVE_DOC_IDEA_IDENTITY_KEY] === newId
          ) {
            match = j;
            break;
          }
        }
        // NEW carries an id but the same-index OLD idea predates ids: the
        // old doc the new build just id-minted — index fallback.
        if (match === null && i < oldIdeas.length && !used.has(i)) {
          const candidate = oldIdeas[i];
          if (
            isJsonObject(candidate) &&
            typeof candidate[SAVE_DOC_IDEA_IDENTITY_KEY] !== "string"
          ) {
            match = i;
          }
        }
      } else if (i < oldIdeas.length && !used.has(i) && isJsonObject(oldIdeas[i])) {
        match = i;
      }

      if (match !== null) {
        used.add(match);
        const oldIdea = oldIdeas[match] as Record<string, unknown>;
        // Stable identity graft (old-build writes strip ids).
        if (
          typeof oldIdea[SAVE_DOC_IDEA_IDENTITY_KEY] === "string" &&
          !(SAVE_DOC_IDEA_IDENTITY_KEY in newIdea)
        ) {
          newIdea = { ...newIdea, [SAVE_DOC_IDEA_IDENTITY_KEY]: oldIdea[SAVE_DOC_IDEA_IDENTITY_KEY] };
        }
        // Monotonic maps: grafted only when ENTIRELY ABSENT on NEW and a
        // well-shaped object on OLD; present-but-empty {} stays untouched.
        for (const key of SAVE_DOC_MONOTONIC_IDEA_KEYS) {
          if (isJsonObject(oldIdea[key]) && !(key in newIdea)) {
            newIdea = { ...newIdea, [key]: oldIdea[key] };
          }
        }
      }

      outIdeas.push(newIdea);
    }

    // OLD ideas no NEW idea matched: appended at the tail in OLD order (no
    // build legitimately deletes ideas). Non-object entries not resurrected.
    for (let j = 0; j < oldIdeas.length; j++) {
      if (!used.has(j) && isJsonObject(oldIdeas[j])) outIdeas.push(oldIdeas[j]);
    }

    return { ...out, ideas: outIdeas };
  } catch {
    // Never-raise posture, mirrored: any unexpected failure degrades to the
    // pre-guard behavior (the doc exactly as the writer sent it).
    return newDoc;
  }
}
