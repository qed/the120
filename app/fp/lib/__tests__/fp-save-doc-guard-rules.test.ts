import { describe, expect, it } from "vitest";
import {
  SAVE_DOC_IDEAS_FUSE_LIMIT,
  SAVE_DOC_MONOTONIC_IDEA_KEYS,
  guardSaveDocUpdate,
} from "../fp-save-doc-guard-rules";

// ── Behavioral spec of the fp_player_saves doc guard ─────────────────────────
// This TS MIRROR IS THE SPEC the SQL parity test pins: the node suite has no
// test database, so the plpgsql trigger in
// supabase/migrations/20260906120000_fp_save_doc_guard.sql cannot be executed
// here. These table-driven cases define the exact merge semantics; the parity
// test (fp-save-doc-guard-migration-parity.test.ts) then asserts, by parsing
// the migration as text, that the SQL implements the same structure. A
// semantic change must land in BOTH files or the parity test fails.

/** A representative NEW-BUILD doc: every key it knows is re-emitted. */
function newBuildDoc() {
  return {
    docVersion: 1,
    ideas: [
      {
        id: "idea-a",
        fields: { oneLiner: "dog walking" },
        done: { "1.1#0": true },
        doneAt: { "1.1#0": 1000 },
        doneByTask: { "1.1.1": true },
        doneAtByTask: { "1.1.1": 1000 },
      },
    ],
    activeIdea: 0,
    siteHeadline: "Rex Walks",
    onboardingComplete: true,
    chosenProvider: null,
    businesses: [
      {
        id: "biz-1",
        ideaId: "idea-a",
        archived: false,
        promotedAt: 2000,
        doneByTask: { "4.1.1": true },
        doneAtByTask: { "4.1.1": 3000 },
      },
    ],
  };
}

/** The same save as an OLD-BUILD session re-emits it: ids, the stable-id
 *  maps, and businesses are all stripped (the old fromSaveDoc coercion keeps
 *  only { fields, done, doneAt } per idea and knows no `businesses`). */
function oldBuildRewriteOf(doc: ReturnType<typeof newBuildDoc>) {
  return {
    docVersion: doc.docVersion,
    ideas: doc.ideas.map((idea) => ({
      fields: { ...idea.fields },
      done: { ...idea.done },
      ...(idea.doneAt ? { doneAt: { ...idea.doneAt } } : {}),
    })),
    activeIdea: doc.activeIdea,
    siteHeadline: doc.siteHeadline,
    onboardingComplete: doc.onboardingComplete,
    chosenProvider: doc.chosenProvider,
  };
}

describe("guardSaveDocUpdate — the P0 mixed-build repair", () => {
  it("carries OLD businesses into an old-build write that omits the key entirely", () => {
    const oldDoc = newBuildDoc();
    const incoming = oldBuildRewriteOf(oldDoc);
    const out = guardSaveDocUpdate(oldDoc, incoming) as Record<string, unknown>;
    expect(out.businesses).toEqual(oldDoc.businesses);
  });

  it("grafts the per-idea stable-id maps AND the idea id an old-build write stripped", () => {
    const oldDoc = newBuildDoc();
    const incoming = oldBuildRewriteOf(oldDoc);
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas).toHaveLength(1);
    expect(out.ideas[0].id).toBe("idea-a");
    expect(out.ideas[0].doneByTask).toEqual({ "1.1.1": true });
    expect(out.ideas[0].doneAtByTask).toEqual({ "1.1.1": 1000 });
  });

  it("the full old-build round trip loses NOTHING the new build wrote — while keeping the old build's own progress", () => {
    const oldDoc = newBuildDoc();
    const incoming = oldBuildRewriteOf(oldDoc);
    // The old-build session did real work too: a new legacy completion.
    (incoming.ideas[0].done as Record<string, boolean>)["1.2#0"] = true;
    const out = guardSaveDocUpdate(oldDoc, incoming) as {
      ideas: Record<string, unknown>[];
      businesses: unknown;
    };
    expect(out.businesses).toEqual(oldDoc.businesses);
    expect(out.ideas[0]).toEqual({
      ...incoming.ideas[0],
      id: "idea-a",
      doneByTask: { "1.1.1": true },
      doneAtByTask: { "1.1.1": 1000 },
    });
    // The old build's fresh completion survives the repair (NEW's map wins).
    expect((out.ideas[0].done as Record<string, boolean>)["1.2#0"]).toBe(true);
  });
});

describe("guardSaveDocUpdate — matching rules", () => {
  it("matches ideas by id across DIFFERENT indexes when both sides carry ids", () => {
    const oldDoc = {
      ideas: [
        { id: "a", fields: {}, done: {}, doneByTask: { "1.1.1": true } },
        { id: "b", fields: {}, done: {}, doneByTask: { "1.1.2": true } },
      ],
    };
    const incoming = {
      ideas: [
        { id: "b", fields: {}, done: {} },
        { id: "a", fields: {}, done: {} },
      ],
    };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas[0]).toEqual({ id: "b", fields: {}, done: {}, doneByTask: { "1.1.2": true } });
    expect(out.ideas[1]).toEqual({ id: "a", fields: {}, done: {}, doneByTask: { "1.1.1": true } });
  });

  it("falls back to index matching when the NEW idea has no id (old-build writer)", () => {
    const oldDoc = {
      ideas: [
        { id: "a", fields: {}, done: {}, doneAtByTask: { "1.1.1": 5 } },
        { id: "b", fields: {}, done: {}, doneAtByTask: { "1.1.2": 6 } },
      ],
    };
    const incoming = { ideas: [{ fields: {}, done: {} }, { fields: {}, done: {} }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas[0].id).toBe("a");
    expect(out.ideas[0].doneAtByTask).toEqual({ "1.1.1": 5 });
    expect(out.ideas[1].id).toBe("b");
    expect(out.ideas[1].doneAtByTask).toEqual({ "1.1.2": 6 });
  });

  it("falls back to index when NEW carries an id but the same-index OLD idea predates ids", () => {
    // A new build re-loading an old-shape doc mints `legacy-idea-{i}` ids and
    // saves; the OLD row still has id-less ideas at the same indexes.
    const oldDoc = { ideas: [{ fields: {}, done: { "1.1#0": true } }] };
    const incoming = { ideas: [{ id: "legacy-idea-0", fields: {}, done: { "1.1#0": true } }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas).toHaveLength(1); // matched — NOT duplicated at the tail
    expect(out.ideas[0].id).toBe("legacy-idea-0"); // NEW's id kept (present key untouched)
  });

  it("never fuses a same-index pair with two DIFFERENT ids — the OLD idea appends at the tail", () => {
    const oldDoc = {
      ideas: [{ id: "server-idea", fields: { oneLiner: "x" }, done: {}, doneByTask: { "1.1.1": true } }],
    };
    const incoming = { ideas: [{ id: "fresh-idea", fields: {}, done: {} }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas).toHaveLength(2);
    expect(out.ideas[0]).toEqual({ id: "fresh-idea", fields: {}, done: {} }); // no grafts
    expect(out.ideas[1]).toEqual(oldDoc.ideas[0]); // preserved whole
  });

  it("preserves OLD ideas that appear in no NEW idea (no build legitimately deletes ideas)", () => {
    const oldDoc = {
      ideas: [
        { id: "a", fields: {}, done: {} },
        { id: "b", fields: { oneLiner: "kept" }, done: { "1.1#0": true } },
      ],
    };
    const incoming = { ideas: [{ id: "a", fields: {}, done: {} }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas).toHaveLength(2);
    expect(out.ideas[1]).toEqual(oldDoc.ideas[1]);
  });

  it("preserves ALL OLD ideas against an empty NEW ideas list (fresh-start writer over a real save)", () => {
    // Kept deliberately: an old tab that loaded an empty list while a
    // new-build session created ideas is a legitimate save; the intentional
    // discard/fresh-start cascade is handled by the docVersion gate.
    const oldDoc = newBuildDoc();
    const incoming = { docVersion: 1, ideas: [], activeIdea: 0 };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: unknown[] };
    expect(out.ideas).toEqual(oldDoc.ideas);
  });

  it("ACCEPTED LOSS MODE: an id-less old-build NEW idea index-fuses with an id-bearing OLD idea a concurrent new-build session created", () => {
    // The migration header's documented accepted outcome, pinned exactly:
    // OLD = [A(id a), B(id b)] where B was created by a new-build session;
    // NEW = two id-less ideas (an old-build session that created its OWN
    // distinct second idea). NEW[1] index-matches B: b's id (and monotonic
    // maps) graft onto the old-build idea's content, and B is NOT appended
    // at the tail — the two ideas fuse. Exposure is proportional to the
    // mixed-build window length; deliberately not heuristically defended.
    const oldDoc = {
      ideas: [
        { id: "a", fields: { oneLiner: "walk dogs" }, done: {} },
        { id: "b", fields: { oneLiner: "new-build idea" }, done: {}, doneByTask: { "1.1.1": true } },
      ],
    };
    const incoming = {
      ideas: [
        { fields: { oneLiner: "walk dogs" }, done: {} },
        { fields: { oneLiner: "old-build fresh idea" }, done: {} },
      ],
    };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas).toHaveLength(2); // B is NOT appended at the tail
    expect(out.ideas[1].id).toBe("b"); // fused: b's id grafted onto the old-build idea
    expect(out.ideas[1].fields).toEqual({ oneLiner: "old-build fresh idea" }); // NEW's content wins — B's fields are lost
    expect(out.ideas[1].doneByTask).toEqual({ "1.1.1": true });
  });

  it("resolves DUPLICATE ids within one array with first-unused semantics", () => {
    const oldDoc = {
      ideas: [
        { id: "dup", fields: {}, done: {}, doneByTask: { first: true } },
        { id: "dup", fields: {}, done: {}, doneByTask: { second: true } },
      ],
    };
    const incoming = { ideas: [{ id: "dup", fields: {}, done: {} }, { id: "dup", fields: {}, done: {} }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas).toHaveLength(2); // both matched — neither OLD entry re-appended
    expect(out.ideas[0].doneByTask).toEqual({ first: true });
    expect(out.ideas[1].doneByTask).toEqual({ second: true });
  });

  it("treats a non-string (numeric) id on NEW as id-less and falls to the index branch", () => {
    const oldDoc = { ideas: [{ id: "a", fields: {}, done: {}, doneByTask: { t: true } }] };
    const incoming = { ideas: [{ id: 7, fields: {}, done: {} }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas).toHaveLength(1); // index-matched, not duplicated at the tail
    expect(out.ideas[0].id).toBe(7); // present key (even non-string) is never overwritten
    expect(out.ideas[0].doneByTask).toEqual({ t: true });
  });

  it("passes a NEW doc that omits the `ideas` KEY entirely through without resurrecting OLD's ideas", () => {
    // Intended boundary: the guard covers per-idea keys and `businesses`,
    // not the ideas list itself — no known writer omits the `ideas` key.
    const oldDoc = { docVersion: 1, ideas: [{ id: "a", fields: {}, done: {} }] };
    const incoming = { docVersion: 1, activeIdea: 0 };
    const out = guardSaveDocUpdate(oldDoc, incoming) as Record<string, unknown>;
    expect(Object.hasOwn(out, "ideas")).toBe(false);
  });
});

describe("guardSaveDocUpdate — docVersion gate", () => {
  it("passes through untouched when docVersion differs (deliberate schema transition)", () => {
    const oldDoc = newBuildDoc();
    const incoming = { ...oldBuildRewriteOf(oldDoc), docVersion: 2 };
    expect(guardSaveDocUpdate(oldDoc, incoming)).toBe(incoming);
  });

  it("passes through when OLD lacks docVersion and NEW says 1 (discarded malformed/unknown-version doc)", () => {
    const oldDoc = { ideas: [{ id: "a", fields: {}, done: {}, doneByTask: { t: true } }], businesses: [{ id: "biz" }] };
    const incoming = { docVersion: 1, ideas: [{ fields: {}, done: {} }] };
    expect(guardSaveDocUpdate(oldDoc, incoming)).toBe(incoming);
  });

  it("still repairs when both sides agree on the version", () => {
    const oldDoc = newBuildDoc();
    const incoming = oldBuildRewriteOf(oldDoc); // same docVersion
    const out = guardSaveDocUpdate(oldDoc, incoming) as Record<string, unknown>;
    expect(out.businesses).toEqual(oldDoc.businesses);
  });
});

describe("guardSaveDocUpdate — element-count fuse", () => {
  const manyIdeas = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `idea-${i}`, fields: {}, done: {} }));
  const manyIdealess = (n: number) => Array.from({ length: n }, () => ({ fields: {}, done: {} }));

  it("passes through untouched when OLD's ideas exceed the fuse (not the mixed-build case)", () => {
    const oldDoc = { ideas: manyIdeas(SAVE_DOC_IDEAS_FUSE_LIMIT + 1), businesses: [{ id: "biz" }] };
    const incoming = { ideas: manyIdealess(2) };
    expect(guardSaveDocUpdate(oldDoc, incoming)).toBe(incoming);
  });

  it("passes through untouched when NEW's ideas exceed the fuse", () => {
    const oldDoc = { ideas: manyIdeas(1), businesses: [{ id: "biz" }] };
    const incoming = { ideas: manyIdealess(SAVE_DOC_IDEAS_FUSE_LIMIT + 1) };
    expect(guardSaveDocUpdate(oldDoc, incoming)).toBe(incoming);
  });

  it("still repairs at EXACTLY the fuse limit (the fuse is strictly greater-than)", () => {
    const oldDoc = { ideas: manyIdeas(SAVE_DOC_IDEAS_FUSE_LIMIT) };
    const incoming = { ideas: manyIdealess(SAVE_DOC_IDEAS_FUSE_LIMIT) };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas[0].id).toBe("idea-0");
    expect(out.ideas[SAVE_DOC_IDEAS_FUSE_LIMIT - 1].id).toBe(`idea-${SAVE_DOC_IDEAS_FUSE_LIMIT - 1}`);
  });
});

describe("guardSaveDocUpdate — present-but-empty is intentional", () => {
  // ONE exception to the present-but-empty rule (reviewed decision): a NEW
  // `businesses` present as the EMPTY array while OLD's is a non-empty array
  // is carried, because the client's coerceBusinesses emits [] when every
  // entry fails validation, and no legitimate writer shrinks businesses to
  // empty (archival keeps records; owner erasure runs service_role-exempt).
  it("carries OLD's non-empty businesses over a present-but-EMPTY [] (the coerceBusinesses wipe)", () => {
    const oldDoc = newBuildDoc();
    const incoming = { ...oldBuildRewriteOf(oldDoc), businesses: [] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as Record<string, unknown>;
    expect(out.businesses).toEqual(oldDoc.businesses);
  });

  it("leaves a present-but-empty businesses [] alone when OLD's is also empty", () => {
    const oldDoc = { ...newBuildDoc(), businesses: [] };
    const incoming = { ...oldBuildRewriteOf(newBuildDoc()), businesses: [] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as Record<string, unknown>;
    expect(out.businesses).toEqual([]);
  });

  it("leaves a NON-empty NEW businesses strictly untouched", () => {
    const oldDoc = newBuildDoc();
    const incoming = {
      ...oldBuildRewriteOf(oldDoc),
      businesses: [{ id: "biz-2", ideaId: "idea-a", archived: false }],
    };
    const out = guardSaveDocUpdate(oldDoc, incoming) as Record<string, unknown>;
    expect(out.businesses).toEqual(incoming.businesses);
  });

  it("leaves present-but-empty per-idea maps {} alone", () => {
    const oldDoc = {
      ideas: [{ id: "a", fields: {}, done: { x: true }, doneByTask: { "1.1.1": true }, doneAtByTask: { "1.1.1": 9 } }],
    };
    const incoming = {
      ideas: [{ id: "a", fields: {}, done: {}, doneByTask: {}, doneAtByTask: {} }],
    };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas[0].done).toEqual({});
    expect(out.ideas[0].doneByTask).toEqual({});
    expect(out.ideas[0].doneAtByTask).toEqual({});
  });

  it("a key present with a NON-object value on NEW also counts as present (never overwritten)", () => {
    const oldDoc = { ideas: [{ id: "a", fields: {}, done: {}, doneByTask: { "1.1.1": true } }] };
    const incoming = { ideas: [{ id: "a", fields: {}, done: {}, doneByTask: null }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect(out.ideas[0].doneByTask).toBeNull();
  });
});

describe("guardSaveDocUpdate — new-build writes are a semantic no-op", () => {
  it("returns a new-build full re-emit unchanged (deep equality)", () => {
    const oldDoc = newBuildDoc();
    const incoming = newBuildDoc();
    // The new build did some work since loading:
    incoming.ideas[0].doneByTask["1.1.2"] = true;
    incoming.businesses[0].doneByTask["4.1.2"] = true;
    const before = JSON.parse(JSON.stringify(incoming));
    const out = guardSaveDocUpdate(oldDoc, incoming);
    expect(out).toEqual(before);
  });

  it("does not invent keys neither side has (absent-stays-absent)", () => {
    const oldDoc = { docVersion: 1, ideas: [{ fields: {}, done: {} }], activeIdea: 0 };
    const incoming = { docVersion: 1, ideas: [{ fields: {}, done: {} }], activeIdea: 0 };
    const out = guardSaveDocUpdate(oldDoc, incoming) as Record<string, unknown>;
    expect("businesses" in out).toBe(false);
    const idea = (out.ideas as Record<string, unknown>[])[0];
    expect("doneByTask" in idea).toBe(false);
    expect("doneAtByTask" in idea).toBe(false);
    expect("doneAt" in idea).toBe(false);
    expect("id" in idea).toBe(false);
  });
});

describe("guardSaveDocUpdate — defensive posture (repairs, never rejects)", () => {
  it.each([
    ["NEW doc not an object", newBuildDoc(), "corrupt"],
    ["NEW doc is null", newBuildDoc(), null],
    ["NEW doc is an array", newBuildDoc(), [1, 2]],
  ])("passes NEW through unchanged when %s", (_name, oldDoc, incoming) => {
    expect(guardSaveDocUpdate(oldDoc, incoming)).toBe(incoming);
  });

  it.each([
    ["OLD doc not an object", 42],
    ["OLD doc is null", null],
    ["OLD doc is the seeded empty {}", {}],
  ])("passes NEW through unchanged when %s (nothing to carry)", (_name, oldDoc) => {
    const incoming = { docVersion: 1, ideas: [], activeIdea: 0 };
    const out = guardSaveDocUpdate(oldDoc, incoming);
    expect(out).toEqual(incoming);
  });

  it("skips idea handling (but still carries businesses) when either ideas is not an array", () => {
    const oldDoc = { docVersion: 1, ideas: "not-an-array", businesses: [{ id: "biz-1" }] };
    const incoming = { docVersion: 1, ideas: [{ fields: {}, done: {} }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as Record<string, unknown>;
    expect(out.businesses).toEqual([{ id: "biz-1" }]);
    expect(out.ideas).toEqual(incoming.ideas); // untouched
    const out2 = guardSaveDocUpdate(
      { docVersion: 1, ideas: [{ fields: {}, done: {} }] },
      { docVersion: 1, ideas: { not: "array" } },
    ) as Record<string, unknown>;
    expect(out2.ideas).toEqual({ not: "array" });
  });

  it("passes non-object NEW idea entries through and never resurrects non-object OLD entries", () => {
    const oldDoc = { ideas: [null, "junk", { id: "a", fields: {}, done: {}, doneByTask: { t: true } }] };
    const incoming = { ideas: ["weird", { id: "a", fields: {}, done: {} }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: unknown[] };
    // "weird" passes through; idea a matched+grafted; null/"junk" NOT appended.
    expect(out.ideas).toEqual([
      "weird",
      { id: "a", fields: {}, done: {}, doneByTask: { t: true } },
    ]);
  });

  it("ignores a malformed (non-object) OLD map value rather than grafting it", () => {
    const oldDoc = { ideas: [{ id: "a", fields: {}, done: {}, doneByTask: "corrupt" }] };
    const incoming = { ideas: [{ id: "a", fields: {}, done: {} }] };
    const out = guardSaveDocUpdate(oldDoc, incoming) as { ideas: Record<string, unknown>[] };
    expect("doneByTask" in out.ideas[0]).toBe(false);
  });

  it("never mutates its inputs", () => {
    const oldDoc = newBuildDoc();
    const incoming = oldBuildRewriteOf(oldDoc);
    const oldSnapshot = JSON.parse(JSON.stringify(oldDoc));
    const newSnapshot = JSON.parse(JSON.stringify(incoming));
    guardSaveDocUpdate(oldDoc, incoming);
    expect(oldDoc).toEqual(oldSnapshot);
    expect(incoming).toEqual(newSnapshot);
  });
});

describe("the monotonic key list", () => {
  it("is exactly the per-idea set unionCompletionMaps unions in the first-profit gameCore", () => {
    // unionIdeaCompletions unions done, doneAt, doneByTask, doneAtByTask —
    // pinned here so a future gameCore addition forces a deliberate update.
    expect([...SAVE_DOC_MONOTONIC_IDEA_KEYS]).toEqual([
      "done",
      "doneAt",
      "doneByTask",
      "doneAtByTask",
    ]);
  });
});
