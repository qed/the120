/**
 * First Profit SAVE DOC GUARD — the pure TS mirror of the fp_player_saves
 * BEFORE UPDATE doc guard (v5: migration
 * supabase/migrations/20260924120000_fp_save_doc_guard_story_panels.sql, which
 * replaced the v4 function from 20260923120000_fp_save_doc_guard_hero.sql,
 * which replaced the v3 function from
 * 20260922120000_fp_save_doc_guard_story_fields.sql, which replaced the v2
 * function from 20260911120000_fp_save_doc_guard_tombstones.sql, which
 * replaced the v1 function from 20260906120000_fp_save_doc_guard.sql).
 *
 * THE SPEC LIVES HERE. This suite has no test database, so the plpgsql in the
 * migration cannot be executed by tests. Instead, `guardSaveDocUpdate` below
 * is a faithful TS re-implementation of the trigger's merge logic — the
 * behavioral tests (__tests__/fp-save-doc-guard-rules.test.ts) exercise THIS
 * function as the executable spec, and the migration-parity test
 * (__tests__/fp-save-doc-guard-migration-parity.test.ts) parses the .sql as
 * text to pin that the SQL implements the same structure (key lists, presence
 * operators, the docVersion gate, the element-count fuse, the never-reject
 * posture). Change the semantics in BOTH places or the parity test fails.
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
 *  - the ENTIRE repair is gated on docVersion agreement (OLD.doc->>'docVersion'
 *    is-distinct-from NEW.doc->>'docVersion' → pass through): the mixed-build
 *    window this guard targets is explicitly a no-DOC_VERSION-bump window, and
 *    the gate prevents resurrecting docs a client deliberately discarded as
 *    malformed/unknown-version;
 *  - an element-count fuse: either side's `ideas` array longer than
 *    SAVE_DOC_IDEAS_FUSE_LIMIT → pass through (a legitimate save has a handful
 *    of ideas; the fuse bounds the quadratic matcher's CPU);
 *  - a key entirely ABSENT from the incoming doc = the writer does not know
 *    the field → graft OLD's value;
 *  - a key PRESENT but empty ({} / []) = intentional state → left alone —
 *    EXCEPT top-level `businesses` present as an empty array against a
 *    non-empty OLD array, which is carried (coerceBusinesses emits [] when
 *    every entry fails validation; no legitimate writer shrinks businesses
 *    to empty);
 *  - ideas match by `id` when both sides carry string ids, else by array
 *    index; a same-index pair with two different STRING ids is never fused,
 *    but an id-less NEW idea CAN index-fuse with an id-bearing OLD idea — the
 *    migration header's ACCEPTED LOSS MODE, pinned by the behavioral suite;
 *  - OLD ideas matched by no NEW idea are appended at the tail (no build can
 *    ACCIDENTALLY lose an idea — old build: CREATE_IDEA/HYDRATE only; new
 *    build: ideas are never reordered, and the only deletion path is the
 *    explicit tombstoned one below) — UNLESS the idea's id is tombstoned;
 *  - TOMBSTONES (v2, the DELETE_IDEA support): the doc's OPTIONAL top-level
 *    `deletedIdeaIds: string[]` (additive-optional under docVersion 1;
 *    absent = []) is an append-only MONOTONIC set. The guard builds the
 *    effective set from NEW's entries first, then OLD's — scanning only the
 *    first SAVE_DOC_DELETED_IDS_MAX elements of each side, keeping string
 *    entries of 1..SAVE_DOC_DELETED_ID_MAX_CHARS chars, de-duplicated,
 *    capped at SAVE_DOC_DELETED_IDS_MAX total — writes it back whenever it
 *    is non-empty or NEW carried the key (clamping malformed/oversized
 *    values; absent-stays-absent when neither side has tombstones), and
 *    SKIPS re-appending an unmatched OLD idea whose id is in the set. So an
 *    old-build save that omits the field can never un-delete (OLD's
 *    tombstones are re-added, then honored), and tombstones only ever
 *    suppress RE-APPEND — the guard never removes an idea present in NEW;
 *  - MONOTONIC STORY FLAGS (v3): for each key in SAVE_DOC_MONOTONIC_FLAG_KEYS
 *    (`storyIntroSeen`, `firstRunComplete`, `dashboardOrientationSeen`,
 *    `onboardingComplete` — the exact set the client's own unionCompletionMaps
 *    OR-unions in gameCore.ts), if OLD's value is the boolean `true` and
 *    NEW's value is anything else (absent, `false`, or malformed), the
 *    repaired doc's key is forced to `true`. A `false` is NEVER invented —
 *    when OLD is not `true`, NEW's value (of any shape, including absent) is
 *    left exactly as sent;
 *  - COVER LOOK LWW (v3): the OPTIONAL `coverLook`/`coverLookAt` pair is
 *    EDITABLE LATEST-INTENT with LAST-WRITE-WINS, mirroring the client's own
 *    persisted-doc merge with local := NEW, server := OLD. NEW's pair wins
 *    by default; OLD's pair wins ONLY when OLD carries a present STRING
 *    `coverLook` AND a NUMBER `coverLookAt` (the DEFENSIVE PAIRING guard — a
 *    stamped-but-lookless side can never clobber a valid look) AND (NEW's
 *    `coverLook` is not a string, OR NEW's `coverLookAt` is not a number, OR
 *    OLD's stamp is STRICTLY GREATER than NEW's — NEW wins ties). The pair
 *    is written back only when a look survived (absent-stays-absent when
 *    neither side carries a string `coverLook`); the guard never invents
 *    shape NEW didn't send;
 *  - HERO CONFIG LWW (v4): the OPTIONAL `heroConfig`/`heroConfigAt` pair
 *    mirrors COVER LOOK LWW exactly, with `heroConfig` (a jsonb OBJECT
 *    rather than a string) in place of `coverLook`. NEW's pair wins by
 *    default; OLD's pair wins ONLY when OLD carries a present OBJECT
 *    `heroConfig` AND a NUMBER `heroConfigAt` (the same DEFENSIVE PAIRING
 *    guard) AND (NEW's `heroConfig` is not an object, OR NEW's
 *    `heroConfigAt` is not a number, OR OLD's stamp is STRICTLY GREATER than
 *    NEW's — NEW wins ties). The pair is written back only when a config
 *    survived (absent-stays-absent when neither side carries an object
 *    `heroConfig`); there is no "non-empty" validity test for an object the
 *    way there is for a string — `jsonb_typeof(...) = 'object'` is the whole
 *    test, which excludes arrays and scalars; the guard never invents shape
 *    NEW didn't send;
 *  - STORY PANELS (v5): the OPTIONAL top-level `storyPanels` map
 *    (`{ [questionId]: { answer: string; answerAt?: number } }`) carries TWO
 *    semantics at once, and they are NOT the same rule:
 *      (1) KEY EXISTENCE IS MONOTONIC — the merged key set is OLD ∪ NEW. A
 *          key present in OLD but ABSENT from NEW is grafted back VERBATIM
 *          (the old-build clobber this exists to prevent); a key is never
 *          subtracted, whatever its value's shape;
 *      (2) A KEY PRESENT ON BOTH SIDES resolves as an INSEPARABLE UNIT,
 *          last-write-wins on `answerAt`: the winning side's WHOLE value is
 *          taken, never an `answer` from one side with an `answerAt` from the
 *          other. OLD's unit wins ONLY when OLD's `answerAt` is a number AND
 *          (NEW's is not a number OR OLD's is STRICTLY GREATER) — so a larger
 *          stamp wins, an unstamped/non-numeric side loses to a stamped one,
 *          and a TIE (or neither side stamped) goes to NEW, matching the
 *          coverLook/heroConfig tie rule.
 *    `answer` is never inspected (it may legitimately be `""` — an empty
 *    answer is a real edit, unlike coverLook's `""`). A non-object
 *    `storyPanels` on EITHER side is treated as "no panels", never an error
 *    (the SQL's key iteration is gated on OLD being an object because
 *    `jsonb_object_keys()` RAISES on a scalar/array); a non-object per-key
 *    VALUE simply carries no stamp, so it loses a contested key and still
 *    grafts back on an uncontested one. The merged map is written back only
 *    when it is non-empty or NEW carried the key (absent-stays-absent);
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
 * Top-level keys carried whole when OLD has them and NEW omits them (or, for
 * an array-valued key, sends the EMPTY array against a non-empty OLD array —
 * the coerceBusinesses wipe case). The businesses list carries the remaining
 * monotonic state unionCompletionMaps protects (per-business
 * doneByTask/doneAtByTask, archived/archiveStateAt).
 */
export const SAVE_DOC_CARRIED_TOP_KEYS = ["businesses"] as const;

/**
 * The idea-tombstone key (v2): the OPTIONAL top-level append-only set of
 * deleted idea ids. Additive-optional under docVersion 1 — an old build
 * simply omits it (key-absent = []), and the guard's union re-adds OLD's
 * tombstones so a deletion can never be undone by an old-build save.
 */
export const SAVE_DOC_DELETED_IDS_KEY = "deletedIdeaIds";

/**
 * Tombstone bounds (clamped defensively, never a raise — mirrored by the
 * literals in the migration, parity-pinned): at most this many ids are KEPT
 * in the effective set, and only the first this-many elements of each side's
 * array are even scanned (bounding CPU on adversarial docs). Unreachable for
 * legitimate docs: the FP client caps ideas at MAX_IDEAS = 5.
 */
export const SAVE_DOC_DELETED_IDS_MAX = 100;

/**
 * Per-id sanity bound: a tombstone entry must be a string of 1..64 chars
 * (UUIDs are 36; legacy ids are `legacy-idea-{index}`). Anything else is
 * dropped from the effective set, never an error.
 */
export const SAVE_DOC_DELETED_ID_MAX_CHARS = 64;

/**
 * Element-count fuse: if either side's `ideas` array is longer than this, the
 * guard passes NEW through untouched. A legitimate save has a handful of
 * ideas — past the fuse it is not the mixed-build case this guard targets —
 * and the fuse bounds the quadratic id-matching loop's CPU on adversarial
 * docs. Mirrors the literal `200` in the migration (parity-pinned).
 */
export const SAVE_DOC_IDEAS_FUSE_LIMIT = 200;

/**
 * The MONOTONIC top-level story flags (v3), EXACTLY the set the first-profit
 * gameCore's persisted-doc union OR-unions (storyIntroSeen since fpv03 U5,
 * coverLook's sibling firstRunComplete and dashboardOrientationSeen since U6/
 * U7a, and the legacy pre-fpv03 onboardingComplete since U7b deleted its own
 * writer). Once true, always true: a stale/old-build write that omits or
 * regresses one of these can never clear it server-side. Order mirrors the
 * SQL's foreach array literal (parity-tested).
 */
export const SAVE_DOC_MONOTONIC_FLAG_KEYS = [
  "storyIntroSeen",
  "firstRunComplete",
  "dashboardOrientationSeen",
  "onboardingComplete",
] as const;

/** The editable-latest-intent cover-look pair (v3, fpv03 U6 S07). */
export const SAVE_DOC_COVER_LOOK_KEY = "coverLook";
export const SAVE_DOC_COVER_LOOK_AT_KEY = "coverLookAt";

/**
 * The editable-latest-intent hero-config pair (v4, fpv03 U9a). Mirrors
 * SAVE_DOC_COVER_LOOK_KEY/_AT_KEY exactly, but the value is a jsonb OBJECT
 * (the kid's avatar choices) rather than a string.
 */
export const SAVE_DOC_HERO_CONFIG_KEY = "heroConfig";
export const SAVE_DOC_HERO_CONFIG_AT_KEY = "heroConfigAt";

/**
 * The story-panels map (v5): an OPTIONAL top-level object keyed by stable
 * question id, each value an inseparable `{ answer, answerAt? }` unit. Unlike
 * every other protected field this one is BOTH monotonic (in its KEY SET) and
 * last-write-wins (WITHIN a contested key) — see the CONTRACT above and the
 * migration's GRAFT D section.
 */
export const SAVE_DOC_STORY_PANELS_KEY = "storyPanels";

/**
 * The per-panel LWW stamp. OPTIONAL: a panel may be unstamped, and an
 * unstamped side always LOSES to a side carrying a numeric stamp. The sibling
 * `answer` is deliberately NOT a constant here — the guard never reads it (an
 * empty answer is a legitimate edit), it only ever moves the whole unit.
 */
export const SAVE_DOC_STORY_PANEL_AT_KEY = "answerAt";

/** JSON-object check matching jsonb_typeof(x) = 'object' (arrays excluded). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * jsonb `? key` semantics: OWN-key presence only (never the prototype chain,
 * which the `in` operator would also consult).
 */
function hasKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(obj, key);
}

/**
 * Write one OWN data entry into a mutable accumulator — the JS equivalent of
 * jsonb's `map || jsonb_build_object(key, value)`.
 *
 * WHY NOT THE OBVIOUS `obj[key] = value`: to Postgres a jsonb key is just a
 * string, but in JS `__proto__` is not. A bracket ASSIGNMENT on an object that
 * has no OWN `__proto__` key reaches Object.prototype's inherited `__proto__`
 * ACCESSOR and REASSIGNS the object's [[Prototype]] instead of storing an
 * entry — the value then vanishes from `Object.keys()` and
 * `JSON.stringify()`, which is precisely the silent data loss this guard
 * exists to prevent. And the key really can arrive off the wire:
 * `JSON.parse('{"__proto__":{}}')` yields a genuine OWN property, so a
 * question id of `__proto__` is representable in a stored doc.
 * `Object.defineProperty` always creates/overwrites an own data property, so
 * it behaves exactly like the object-literal computed-key form
 * (`{ ...out, [key]: value }`) every other graft in this file uses — which is
 * safe for the same reason (a computed key in a literal is a CreateDataProperty,
 * never a setter call).
 */
function setOwnEntry(
  obj: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * The text `doc ->> 'docVersion'` would yield: null when the doc is not an
 * object, the key is absent, or the value is JSON null; otherwise the value's
 * text form (numbers/strings/booleans stringify identically to Postgres).
 */
function docVersionText(doc: unknown): string | null {
  if (!isJsonObject(doc) || !hasKey(doc, "docVersion")) return null;
  const v = doc.docVersion;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Collect one side's tombstones into the effective set (v2). Mirrors the SQL
 * side-scan loop exactly: only an ARRAY value contributes (any other shape —
 * string, number, object, absent — contributes nothing, never an error);
 * only the FIRST SAVE_DOC_DELETED_IDS_MAX elements are scanned; only string
 * entries of 1..SAVE_DOC_DELETED_ID_MAX_CHARS chars are kept; duplicates are
 * dropped; the set caps at SAVE_DOC_DELETED_IDS_MAX total. (JS `.length`
 * counts UTF-16 units where Postgres char_length counts characters — the
 * bound is a defensive clamp, not identity-critical, so the divergence on
 * astral-plane ids is accepted; no legitimate id contains them.)
 */
function collectTombstones(
  doc: Record<string, unknown>,
  into: string[],
  seen: Set<string>,
): void {
  const raw = doc[SAVE_DOC_DELETED_IDS_KEY];
  if (!Array.isArray(raw)) return;
  const scan = Math.min(raw.length, SAVE_DOC_DELETED_IDS_MAX);
  for (let i = 0; i < scan; i++) {
    if (into.length >= SAVE_DOC_DELETED_IDS_MAX) return;
    const entry = raw[i];
    if (typeof entry !== "string") continue;
    if (entry.length < 1 || entry.length > SAVE_DOC_DELETED_ID_MAX_CHARS) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    into.push(entry);
  }
}

/**
 * The trigger's merge, as a pure function: (OLD.doc, NEW.doc) → the doc that
 * should actually be stored. Never throws; never mutates its inputs. Returns
 * `newDoc` (possibly the same reference) when there is nothing to repair or
 * the shapes are unexpected. Structure mirrors the SQL: the docVersion gate,
 * shape checks, and the fuse run BEFORE the protected try block; the repair
 * builds a local doc and the result is produced exactly once at the end.
 */
export function guardSaveDocUpdate(oldDoc: unknown, newDoc: unknown): unknown {
  // ── docVersion gate (first check; `is distinct from` on the text form) ──
  // A version disagreement means a deliberate schema transition or a client
  // that discarded a malformed/unknown-version doc — never resurrect into it.
  if (docVersionText(oldDoc) !== docVersionText(newDoc)) return newDoc;

  // Malformed / non-object docs (including a seeded {} OLD): pass through.
  if (!isJsonObject(oldDoc) || !isJsonObject(newDoc)) return newDoc;

  // ── Element-count fuse (before any matching loop) ──────────────────────
  if (
    (Array.isArray(oldDoc.ideas) && oldDoc.ideas.length > SAVE_DOC_IDEAS_FUSE_LIMIT) ||
    (Array.isArray(newDoc.ideas) && newDoc.ideas.length > SAVE_DOC_IDEAS_FUSE_LIMIT)
  ) {
    return newDoc;
  }

  // ── Protected repair region (mirrors the SQL's begin/exception block) ──
  try {
    let out: Record<string, unknown> = newDoc;

    // ── Top-level carry: businesses ────────────────────────────────────
    // Absent key = writer-unknown (old build). Present-but-EMPTY-array is
    // also carried when OLD's is a non-empty array: coerceBusinesses emits
    // [] when every entry fails validation, and no legitimate writer shrinks
    // businesses to empty (archival keeps records; owner erasure runs
    // service_role-exempt). Non-empty NEW businesses stays untouched.
    for (const key of SAVE_DOC_CARRIED_TOP_KEYS) {
      if (!hasKey(oldDoc, key)) continue;
      const oldVal = oldDoc[key];
      const emptyArrayWipe =
        hasKey(newDoc, key) &&
        Array.isArray(newDoc[key]) &&
        (newDoc[key] as unknown[]).length === 0 &&
        Array.isArray(oldVal) &&
        oldVal.length > 0;
      if (!hasKey(newDoc, key) || emptyArrayWipe) {
        out = { ...out, [key]: oldVal };
      }
    }

    // ── Tombstone union: deletedIdeaIds (v2) ───────────────────────────
    // The effective MONOTONIC set: NEW's valid entries first, then OLD's —
    // so an old-build save that omits the key re-adds OLD's tombstones (and
    // the tail loop below then honors them: a deletion can never be undone
    // by an old build). Written back whenever non-empty OR NEW carried the
    // key (a malformed/oversized NEW value is thereby CLAMPED to the
    // normalized set); when NEITHER side has tombstones the key is not
    // invented (absent-stays-absent).
    const tombstones: string[] = [];
    const tombstoned = new Set<string>();
    collectTombstones(newDoc, tombstones, tombstoned);
    collectTombstones(oldDoc, tombstones, tombstoned);
    if (tombstones.length > 0 || hasKey(newDoc, SAVE_DOC_DELETED_IDS_KEY)) {
      out = { ...out, [SAVE_DOC_DELETED_IDS_KEY]: tombstones };
    }

    // ── Graft A (v3): monotonic story flags ────────────────────────────
    // Mirrors the client's own unionCompletionMaps OR-union of these exact
    // four flags: if OLD carried the boolean `true` and NEW's value at the
    // same key is anything other than `true` (absent, `false`, or a
    // malformed shape), the repaired doc's key is forced to `true`. A
    // `false` is NEVER invented — when OLD is not `true`, NEW's value
    // (present or absent, any shape) is left exactly as sent.
    for (const key of SAVE_DOC_MONOTONIC_FLAG_KEYS) {
      if (oldDoc[key] === true && newDoc[key] !== true) {
        out = { ...out, [key]: true };
      }
    }

    // ── Graft B (v3): coverLook / coverLookAt, LAST-WRITE-WINS ─────────
    // Mirrors the client's own persisted-doc merge (gameCore.ts) with
    // local := NEW, server := OLD: NEW's pair wins by default (`out`
    // already carries NEW's values verbatim, whatever their shape); OLD's
    // pair wins ONLY when OLD carries a present STRING coverLook AND a
    // NUMBER coverLookAt (the DEFENSIVE PAIRING guard — a stamped-but-
    // lookless OLD can never clobber a valid look on NEW) AND (NEW carries
    // no usable pair, OR OLD's stamp is STRICTLY GREATER than NEW's — NEW
    // wins ties, matching the client's own `sCoverAt > coverLookAt` rule).
    //
    // A usable look must be a NON-EMPTY string. The client's check is a
    // truthiness test (`serverDoc.coverLook &&` in gameCore.ts), which an
    // empty string fails; a bare `typeof === "string"` here would let an
    // empty look win over the other side's real one. The client never
    // persists `""` (fromSaveDoc strips it), but the SQL trigger reads raw
    // jsonb with no such normalization, so the two must agree explicitly.
    {
      const oldCover = oldDoc[SAVE_DOC_COVER_LOOK_KEY];
      const oldAt = oldDoc[SAVE_DOC_COVER_LOOK_AT_KEY];
      const newCover = newDoc[SAVE_DOC_COVER_LOOK_KEY];
      const newAt = newDoc[SAVE_DOC_COVER_LOOK_AT_KEY];
      const oldCoverOk =
        typeof oldCover === "string" && oldCover !== "" && typeof oldAt === "number";
      const newCoverOk =
        typeof newCover === "string" && newCover !== "" && typeof newAt === "number";
      if (oldCoverOk && (!newCoverOk || (oldAt as number) > (newAt as number))) {
        out = {
          ...out,
          [SAVE_DOC_COVER_LOOK_KEY]: oldCover,
          [SAVE_DOC_COVER_LOOK_AT_KEY]: oldAt,
        };
      }
    }

    // ── Graft C (v4): heroConfig / heroConfigAt, LAST-WRITE-WINS ───────
    // Mirrors Graft B exactly, with `heroConfig` (a jsonb OBJECT) in place of
    // `coverLook` (a string). NEW's pair wins by default (`out` already
    // carries NEW's values verbatim); OLD's pair wins ONLY when OLD carries
    // a present OBJECT heroConfig AND a NUMBER heroConfigAt (the same
    // DEFENSIVE PAIRING guard as coverLook — a stamped-but-configless OLD
    // can never clobber a valid config on NEW) AND (NEW carries no usable
    // pair, OR OLD's stamp is STRICTLY GREATER than NEW's — NEW wins ties).
    //
    // OBJECT-SHAPE VALIDITY: unlike coverLook's non-empty-STRING test, there
    // is no meaningful "empty but invalid" object, so the validity test here
    // is exactly `isJsonObject(...)` (mirrors jsonb_typeof(...) = 'object'),
    // which excludes arrays (isJsonObject explicitly rejects Array.isArray)
    // and scalars.
    {
      const oldHero = oldDoc[SAVE_DOC_HERO_CONFIG_KEY];
      const oldHeroAt = oldDoc[SAVE_DOC_HERO_CONFIG_AT_KEY];
      const newHero = newDoc[SAVE_DOC_HERO_CONFIG_KEY];
      const newHeroAt = newDoc[SAVE_DOC_HERO_CONFIG_AT_KEY];
      const oldHeroOk = isJsonObject(oldHero) && typeof oldHeroAt === "number";
      const newHeroOk = isJsonObject(newHero) && typeof newHeroAt === "number";
      if (oldHeroOk && (!newHeroOk || (oldHeroAt as number) > (newHeroAt as number))) {
        out = {
          ...out,
          [SAVE_DOC_HERO_CONFIG_KEY]: oldHero,
          [SAVE_DOC_HERO_CONFIG_AT_KEY]: oldHeroAt,
        };
      }
    }

    // ── Graft D (v5): storyPanels — key UNION + per-key LAST-WRITE-WINS ─
    // TWO semantics in one field (see the CONTRACT above):
    //   (1) the merged key set is OLD ∪ NEW — a key OLD has and NEW omits is
    //       grafted back VERBATIM, never subtracted (the old-build clobber
    //       this graft exists to prevent);
    //   (2) a key present on BOTH sides resolves as an INSEPARABLE UNIT,
    //       last-write-wins on `answerAt` — the WHOLE value of the winning
    //       side is taken, never a mix of the two sides' fields.
    // Orientation matches Grafts B/C (local := NEW, server := OLD): the
    // accumulator STARTS as NEW's map, so NEW wins by default and OLD only
    // ever overrides — hence ties, and the both-sides-unstamped case, go to
    // NEW. `answer` is never inspected (it may legitimately be "").
    //
    // GARBAGE SAFETY, mirroring the SQL: a non-object `storyPanels` on either
    // side is "no panels", never an error (the SQL gates its
    // jsonb_object_keys() iteration on OLD being an object because that
    // function RAISES on a scalar/array, which inside the protected region
    // would discard the WHOLE repair). When OLD is not an object the graft
    // does nothing at all (NEW's value survives verbatim); when OLD IS an
    // object and NEW is not, the merged map is built from OLD's keys alone, so
    // a garbage NEW value cannot erase the kid's answers. A non-object per-key
    // VALUE carries no stamp (the SQL's `-> 'answerAt'` on a scalar is SQL
    // NULL, not an error), so it loses a contested key and still grafts back
    // on an uncontested one.
    {
      const oldPanels = oldDoc[SAVE_DOC_STORY_PANELS_KEY];
      const newPanels = newDoc[SAVE_DOC_STORY_PANELS_KEY];
      if (isJsonObject(oldPanels)) {
        const merged: Record<string, unknown> = isJsonObject(newPanels)
          ? { ...newPanels }
          : {};
        for (const key of Object.keys(oldPanels)) {
          const oldPanel = oldPanels[key];
          if (!hasKey(merged, key)) {
            // (1) KEY MONOTONICITY: NEW does not know this key — graft OLD's
            // whole value back verbatim, whatever its shape. setOwnEntry, not
            // `merged[key] = ...`: a question id of `__proto__` would otherwise
            // hit Object.prototype's inherited setter and silently DROP the
            // panel (see setOwnEntry's note).
            setOwnEntry(merged, key, oldPanel);
            continue;
          }
          // (2) CONTESTED KEY: resolve the {answer, answerAt} UNIT by LWW.
          const newPanel = merged[key];
          const oldAt = isJsonObject(oldPanel)
            ? oldPanel[SAVE_DOC_STORY_PANEL_AT_KEY]
            : undefined;
          const newAt = isJsonObject(newPanel)
            ? newPanel[SAVE_DOC_STORY_PANEL_AT_KEY]
            : undefined;
          const oldPanelOk = typeof oldAt === "number";
          const newPanelOk = typeof newAt === "number";
          if (oldPanelOk && (!newPanelOk || (oldAt as number) > (newAt as number))) {
            // Same reasoning as above. (Here the own key already exists, so a
            // bracket assignment would happen to work — the helper is used
            // anyway so the two writes cannot drift apart.)
            setOwnEntry(merged, key, oldPanel);
          }
        }
        // Written back whenever non-empty OR NEW carried the key; when neither
        // side has panels the key is not invented (absent-stays-absent), and a
        // garbage NEW value is thereby CLAMPED to the merged map.
        if (
          Object.keys(merged).length > 0 ||
          hasKey(newDoc, SAVE_DOC_STORY_PANELS_KEY)
        ) {
          out = { ...out, [SAVE_DOC_STORY_PANELS_KEY]: merged };
        }
      }
    }

    // ── Per-idea grafts (only when BOTH sides have an ideas ARRAY) ─────
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

      // Match by id when both sides carry string ids (duplicates resolve
      // first-unused), else by index. A same-index pair with DIFFERENT
      // string ids is two distinct ideas: not fused. An id-less NEW idea CAN
      // index-fuse with an id-bearing OLD idea (ACCEPTED LOSS MODE — see the
      // migration header).
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
        // old doc the new build just id-minted — index fallback, gated on
        // the OLD entry NOT carrying a string id.
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
          !hasKey(newIdea, SAVE_DOC_IDEA_IDENTITY_KEY)
        ) {
          newIdea = { ...newIdea, [SAVE_DOC_IDEA_IDENTITY_KEY]: oldIdea[SAVE_DOC_IDEA_IDENTITY_KEY] };
        }
        // Monotonic maps: grafted only when ENTIRELY ABSENT on NEW and a
        // well-shaped object on OLD; present-but-empty {} stays untouched.
        for (const key of SAVE_DOC_MONOTONIC_IDEA_KEYS) {
          if (isJsonObject(oldIdea[key]) && !hasKey(newIdea, key)) {
            newIdea = { ...newIdea, [key]: oldIdea[key] };
          }
        }
      }

      outIdeas.push(newIdea);
    }

    // OLD ideas no NEW idea matched: appended at the tail in OLD order —
    // UNLESS the idea's id is in the effective tombstone set (v2): that is a
    // DELIBERATE deletion and is skipped; every other unmatched OLD idea
    // still re-appends (accidental erasure stays protected). Non-object
    // entries not resurrected. The EMPTY NEW ideas list is preserved-into on
    // purpose: an old tab that loaded an empty list while a new-build
    // session created ideas is a legitimate save, and the discard/
    // fresh-start cascade is handled by the docVersion gate above — kept as
    // is.
    for (let j = 0; j < oldIdeas.length; j++) {
      if (used.has(j)) continue;
      const candidate = oldIdeas[j];
      if (!isJsonObject(candidate)) continue;
      const candidateId = candidate[SAVE_DOC_IDEA_IDENTITY_KEY];
      if (typeof candidateId === "string" && tombstoned.has(candidateId)) continue;
      outIdeas.push(candidate);
    }

    return { ...out, ideas: outIdeas };
  } catch {
    // Never-reject posture, mirrored: any unexpected failure degrades to the
    // pre-guard behavior — the doc exactly as the writer sent it (the SQL
    // additionally emits `raise warning` for log visibility; the pure mirror
    // has no side channel).
    return newDoc;
  }
}
