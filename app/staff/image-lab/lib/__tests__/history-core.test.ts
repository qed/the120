import { describe, expect, it, vi } from "vitest";
import {
  loadHistoryView,
  loadKitView,
  recordRunTags,
  recordVerdict,
  recordVerdictNote,
  type HistoryDeps,
} from "../history-core";
import {
  historyImageCap,
  runMatchesFilter,
  EMPTY_HISTORY_FILTER,
  IMAGE_LAB_KIT_LIMIT,
  type HistoryFilter,
  type HistoryImageRow,
  type HistoryRunRow,
} from "../history-rules";

/**
 * The evidence surfaces' SEQUENCING, against in-memory fakes
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6).
 *
 * `history-rules.test.ts` pins the maths; this file pins what the sequences DO
 * with it: that a verdict write touches one row and two columns, that a repeat is
 * a no-op-shaped success, that a refusal reaches the caller as a typed reason
 * rather than an opaque throw, and that no projection carries a storage key.
 *
 * The fakes are a store, not a canned answer, so "keep → reject → keep ends keep"
 * is an actual sequence of writes rather than three assertions about one mock.
 */

const NOW = 1_800_000_000_000;

const image = (over: Partial<HistoryImageRow> = {}): HistoryImageRow => ({
  id: "img-1",
  runId: "run-1",
  modelId: "gpt-image-2",
  cellOrdinal: 0,
  state: "done",
  attemptedAtMs: NOW - 1000,
  createdAtMs: NOW - 2000,
  failureReason: null,
  failureDetail: null,
  storageKey: "runs/run-1/img-1",
  billed: true,
  resolvedPrompt: "A bright panel.",
  promptDerived: false,
  costEstimatedUsd: 0.053,
  costReportedUsd: null,
  verdict: null,
  verdictNote: "",
  verdictAtMs: null,
  ...over,
});

const run = (over: Partial<HistoryRunRow> = {}): HistoryRunRow => ({
  id: "run-1",
  staffId: "staff-1",
  template: "Draw {{product}}",
  slotValues: { product: "kites" },
  resolvedPrompt: "Draw kites",
  referenceIds: [],
  drillTags: [],
  note: "",
  compare: false,
  iteratedOnModel: null,
  iteratedFromRunId: null,
  sourceChildId: null,
  createdAtMs: NOW - 5000,
  ...over,
});

/**
 * A store-backed {@link HistoryDeps}.
 *
 * ⚠ `listRuns` APPLIES `runMatchesFilter` ITSELF, rather than re-implementing
 * containment by hand. The hand-written copy that used to live here was a THIRD
 * implementation of the rule — after the pure one and the SQL one — and nothing
 * checked it against either, so a loader that drifted to `.overlaps()` would have
 * left this whole suite green on the strength of the fake. The loader suite pins
 * the SQL against the same pure rule from one fixture
 * (`history-loader.test.ts`, "the pure mirror and the emitted SQL agree").
 */
function fakeDeps(
  runs: HistoryRunRow[],
  images: HistoryImageRow[],
  over: Partial<HistoryDeps> = {}
): { deps: HistoryDeps; runs: HistoryRunRow[]; images: HistoryImageRow[] } {
  const deps: HistoryDeps = {
    now: () => NOW,
    async listRuns(filter: HistoryFilter) {
      return runs.filter((r) => runMatchesFilter(r, filter)).slice(0, filter.limit);
    },
    async countRuns(filter: HistoryFilter) {
      // ⚠ THE SAME PREDICATE, WITHOUT THE LIMIT — "showing 50 of 312" is a lie
      // the moment the count and the list describe different populations.
      return runs.filter((r) => runMatchesFilter(r, filter)).length;
    },
    async listRunsByIds(ids) {
      return runs.filter((r) => ids.includes(r.id));
    },
    async listImagesForRuns(ids, limit) {
      return images.filter((i) => ids.includes(i.runId)).slice(0, limit);
    },
    async listKeptImages(limit) {
      return images.filter((i) => i.verdict === "keep").slice(0, limit);
    },
    async listReferencesByIds(ids) {
      return ids.map((id) => ({ id, label: `label-${id}` }));
    },
    async listAllReferences() {
      return [{ id: "ref-1", label: "Hero sheet" }];
    },
    async signUrls(keys) {
      return new Map(keys.map((key) => [key, `https://signed/${key}`]));
    },
    async loadImage(id) {
      return images.find((i) => i.id === id) ?? null;
    },
    async updateVerdict(id, patch) {
      const row = images.findIndex((i) => i.id === id);
      if (row === -1) return 0;
      images[row] = {
        ...images[row]!,
        verdict: patch.verdict,
        verdictAtMs: patch.verdictAtMs,
      };
      return 1;
    },
    async updateNote(id, note) {
      const row = images.findIndex((i) => i.id === id);
      if (row === -1) return 0;
      images[row] = { ...images[row]!, verdictNote: note };
      return 1;
    },
    async updateRunTags(id, tags) {
      const row = runs.findIndex((r) => r.id === id);
      if (row === -1) return 0;
      runs[row] = { ...runs[row]!, drillTags: [...tags] };
      return 1;
    },
    ...over,
  };
  return { deps, runs, images };
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

describe("a verdict is idempotent and touches ONE row", () => {
  it("keep → reject → keep ends `keep`, and the stamp moves with it", async () => {
    const { deps, images } = fakeDeps([run()], [image()]);

    expect(await recordVerdict(deps, { imageId: "img-1", verdict: "keep" })).toMatchObject({
      ok: true,
      verdict: "keep",
      verdictAtMs: NOW,
    });
    await recordVerdict(deps, { imageId: "img-1", verdict: "reject" });
    const final = await recordVerdict(deps, { imageId: "img-1", verdict: "keep" });

    expect(final).toMatchObject({ ok: true, verdict: "keep" });
    expect(images[0]!.verdict).toBe("keep");
    expect(images[0]!.verdictAtMs).toBe(NOW);
  });

  it("a REPEATED keep is a legal write, not a refusal", async () => {
    const { deps, images } = fakeDeps([run()], [image()]);
    await recordVerdict(deps, { imageId: "img-1", verdict: "keep" });
    const again = await recordVerdict(deps, { imageId: "img-1", verdict: "keep" });
    expect(again.ok).toBe(true);
    expect(images[0]!.verdict).toBe("keep");
  });

  it("clearing sets BOTH columns to null together", async () => {
    const { deps, images } = fakeDeps([run()], [image({ verdict: "keep", verdictAtMs: NOW })]);
    const cleared = await recordVerdict(deps, { imageId: "img-1", verdict: null });
    expect(cleared).toMatchObject({ ok: true, verdict: null, verdictAtMs: null });
    expect(images[0]!.verdict).toBeNull();
    expect(images[0]!.verdictAtMs).toBeNull();
  });

  it("writes verdict AND verdict_at as one patch — never one without the other", async () => {
    const updateVerdict: HistoryDeps["updateVerdict"] = vi.fn(async () => 1);
    const { deps } = fakeDeps([run()], [image()], { updateVerdict });
    await recordVerdict(deps, { imageId: "img-1", verdict: "reject" });
    expect(updateVerdict).toHaveBeenCalledWith("img-1", {
      verdict: "reject",
      verdictAtMs: NOW,
    });
    // The schema's own rule, asserted on the payload the loader will send.
    const patch = vi.mocked(updateVerdict).mock.calls[0]![1];
    expect(patch.verdict === null).toBe(patch.verdictAtMs === null);
  });

  it("REFUSES cleanly on a non-done row, without reaching the write", async () => {
    const updateVerdict: HistoryDeps["updateVerdict"] = vi.fn(async () => 1);
    const { deps } = fakeDeps(
      [run()],
      [image({ state: "failed", failureReason: "timeout", storageKey: null })],
      { updateVerdict }
    );
    expect(await recordVerdict(deps, { imageId: "img-1", verdict: "keep" })).toEqual({
      ok: false,
      reason: "not_done",
    });
    expect(updateVerdict).not.toHaveBeenCalled();
  });

  it("refuses a nonexistent image id cleanly", async () => {
    const { deps } = fakeDeps([run()], [image()]);
    expect(await recordVerdict(deps, { imageId: "missing", verdict: "keep" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports not_found when the row vanishes between the read and the write", async () => {
    const { deps } = fakeDeps([run()], [image()], { updateVerdict: async () => 0 });
    expect(await recordVerdict(deps, { imageId: "img-1", verdict: "keep" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("maps a thrown write to `unavailable` rather than propagating a digest", async () => {
    const { deps } = fakeDeps([run()], [image()], {
      updateVerdict: async () => {
        throw new Error("42501");
      },
    });
    expect(await recordVerdict(deps, { imageId: "img-1", verdict: "keep" })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("notes and tags are independent of the verdict", () => {
  it("a note edit does not disturb the verdict, and vice versa", async () => {
    const { deps, images } = fakeDeps([run()], [image()]);

    await recordVerdictNote(deps, { imageId: "img-1", note: "hero drifts left" });
    expect(images[0]!.verdictNote).toBe("hero drifts left");
    expect(images[0]!.verdict).toBeNull();

    await recordVerdict(deps, { imageId: "img-1", verdict: "reject" });
    expect(images[0]!.verdictNote).toBe("hero drifts left");

    await recordVerdictNote(deps, { imageId: "img-1", note: "fixed in the retry" });
    expect(images[0]!.verdict).toBe("reject");
    expect(images[0]!.verdictNote).toBe("fixed in the retry");
  });

  it("a note may be written on a row that can never be judged", async () => {
    const { deps, images } = fakeDeps(
      [run()],
      [image({ state: "failed", failureReason: "safety_blocked", storageKey: null })]
    );
    expect(await recordVerdictNote(deps, { imageId: "img-1", note: "allowlist" })).toMatchObject({
      ok: true,
    });
    expect(images[0]!.verdictNote).toBe("allowlist");
  });

  /** ⚠ THE ONE RUN-LEVEL WRITE, AND IT TOUCHES ONLY `drill_tags`. */
  it("tag writes touch the run's tags and nothing else", async () => {
    const updateRunTags = vi.fn(async () => 1);
    const { deps } = fakeDeps([run()], [image()], { updateRunTags });
    expect(await recordRunTags(deps, { runId: "run-1", tags: ["consistency"] })).toEqual({
      ok: true,
      runId: "run-1",
      tags: ["consistency"],
    });
    expect(updateRunTags).toHaveBeenCalledWith("run-1", ["consistency"]);
  });

  it("refuses a tag outside the vocabulary before any write", async () => {
    const updateRunTags = vi.fn(async () => 1);
    const { deps } = fakeDeps([run()], [image()], { updateRunTags });
    expect(await recordRunTags(deps, { runId: "run-1", tags: ["kid_appeal"] })).toEqual({
      ok: false,
      reason: "invalid_tag",
    });
    expect(updateRunTags).not.toHaveBeenCalled();
  });

  /**
   * ⚠ T5. Only `recordVerdict` tested the `matched === 0 → not_found` branch, so
   * deleting the guard from either of the other two survived — and a write that
   * matched ZERO rows returned `ok`, which means the surface KEEPS its optimistic
   * paint instead of rolling back. The card would show a note or a tag set the
   * database does not hold, with nothing announced.
   */
  it("a note write that matched NO row is not_found, never a silent success", async () => {
    const { deps } = fakeDeps([run()], [image()], { updateNote: async () => 0 });
    expect(await recordVerdictNote(deps, { imageId: "img-1", note: "x" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("a tag write that matched NO row is not_found, never a silent success", async () => {
    const { deps } = fakeDeps([run()], [image()], { updateRunTags: async () => 0 });
    expect(await recordRunTags(deps, { runId: "run-1", tags: ["style"] })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("maps a thrown note or tag write to `unavailable`", async () => {
    const boom = async () => {
      throw new Error("42501");
    };
    const { deps } = fakeDeps([run()], [image()], {
      updateNote: boom,
      updateRunTags: boom,
    });
    expect(await recordVerdictNote(deps, { imageId: "img-1", note: "x" })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await recordRunTags(deps, { runId: "run-1", tags: [] })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

// ── History ──────────────────────────────────────────────────────────────────

describe("loadHistoryView", () => {
  const sheet = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const runs = () => [
    run({ id: "with-sheet", referenceIds: [sheet], drillTags: ["consistency"] }),
    run({ id: "without", referenceIds: [], drillTags: ["consistency"] }),
  ];
  const rows = () => [
    image({ id: "a", runId: "with-sheet", modelId: "gpt-image-2", verdict: "keep" }),
    image({ id: "b", runId: "with-sheet", modelId: "gemini-3-pro-image", verdict: "reject" }),
    image({ id: "c", runId: "without", modelId: "gpt-image-2", verdict: "keep" }),
  ];
  /** The same rows with DISTINCT storage keys — see the mint test below. */
  const keyedRows = () =>
    rows().map((row) => ({ ...row, storageKey: `runs/${row.runId}/${row.id}` }));

  it("filter by reference returns exactly the runs joined to it", async () => {
    const { deps } = fakeDeps(runs(), rows());
    const result = await loadHistoryView(deps, {
      ...EMPTY_HISTORY_FILTER,
      referenceIds: [sheet],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.runs.map((r) => r.id)).toEqual(["with-sheet"]);
    expect(result.images.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("filters compose — reference AND tag AND model AND verdict", async () => {
    const { deps } = fakeDeps(runs(), rows());
    const result = await loadHistoryView(deps, {
      ...EMPTY_HISTORY_FILTER,
      referenceIds: [sheet],
      drillTags: ["consistency"],
      modelIds: ["gpt-image-2"],
      verdict: "keep",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images.map((i) => i.id)).toEqual(["a"]);
    expect(result.stats.map((s) => s.modelId)).toEqual(["gpt-image-2"]);
  });

  /** ⚠ NO STORAGE KEY IN ANY CLIENT-FACING PROJECTION. */
  it("hands back signed URLs and never a storage key", async () => {
    const { deps } = fakeDeps(runs(), rows());
    const result = await loadHistoryView(deps, EMPTY_HISTORY_FILTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const view of result.images) {
      expect("storageKey" in view).toBe(false);
      expect(view.signedUrl).toMatch(/^https:\/\/signed\//);
      expect(view.hasObject).toBe(true);
    }
    // The key survives ONLY inside the signature the storage layer minted from
    // it — never as a field of its own that a later feature could re-sign.
    expect(
      Object.keys(result.images[0]!).filter((key) => key.toLowerCase().includes("storage"))
    ).toEqual([]);
  });

  /**
   * ⚠ THIS TEST USED TO PROVE NOTHING.
   *
   * All three fixture rows carried the SAME `storageKey`, so the throwing branch
   * fired for every one of them and every URL came back null — which is exactly
   * what a mint failure that blanked the WHOLE PAGE would look like. The
   * assertion `expect(view.signedUrl).toBeNull()` for all three passed either
   * way. Distinct keys, one failure, and the SIBLINGS ARE ASSERTED TO STILL
   * CARRY URLS.
   */
  it("one failed mint costs ONE thumbnail — the siblings keep their URLs", async () => {
    const { deps } = fakeDeps(runs(), keyedRows(), {
      signUrls: async (keys) =>
        new Map(
          keys
            .filter((key) => !key.endsWith("/a"))
            .map((key) => [key, `https://signed/${key}`])
        ),
    });
    const result = await loadHistoryView(deps, EMPTY_HISTORY_FILTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(3);

    const byId = new Map(result.images.map((view) => [view.id, view]));
    // The one that failed.
    expect(byId.get("a")!.signedUrl).toBeNull();
    // …and the two that did not. THIS is what separates "one thumbnail" from
    // "the page".
    expect(byId.get("b")!.signedUrl).toBe("https://signed/runs/with-sheet/b");
    expect(byId.get("c")!.signedUrl).toBe("https://signed/runs/without/c");

    for (const view of result.images) {
      // The evidence lives on the ROW, so every cell is still judgeable.
      expect(view.state).toBe("done");
      expect(view.hasObject).toBe(true);
    }
  });

  it("a signing dep that THROWS costs thumbnails, never the page", async () => {
    const { deps } = fakeDeps(runs(), keyedRows(), {
      signUrls: async () => {
        throw new Error("storage down");
      },
    });
    const result = await loadHistoryView(deps, EMPTY_HISTORY_FILTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(3);
    expect(result.images.every((v) => v.signedUrl === null)).toBe(true);
    expect(result.images.every((v) => v.state === "done")).toBe(true);
  });

  it("mints each storage key ONCE, however many rows point at it", async () => {
    const seen: string[][] = [];
    const { deps } = fakeDeps(runs(), keyedRows(), {
      signUrls: async (keys) => {
        // ⚠ ONE BATCHED CALL, NOT ONE PER ROW. The singular version fanned an
        // unbounded Promise.all over as many as a thousand rows, on a page whose
        // stated target device is a phone.
        seen.push([...keys]);
        return new Map(keys.map((key) => [key, `https://signed/${key}`]));
      },
    });
    await loadHistoryView(deps, EMPTY_HISTORY_FILTER);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(3);
  });

  it("a failed QUERY is `unavailable`, never an empty history", async () => {
    const { deps } = fakeDeps(runs(), rows(), {
      listRuns: async () => {
        throw new Error("42501");
      },
    });
    expect(await loadHistoryView(deps, EMPTY_HISTORY_FILTER)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("computes stats and cost over the FILTERED population", async () => {
    const { deps } = fakeDeps(runs(), rows());
    const result = await loadHistoryView(deps, EMPTY_HISTORY_FILTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost.billedCount).toBe(3);
    expect(result.cost.estimatedUsd).toBeCloseTo(0.159, 6);
    expect(result.cost.reportedUsd).toBe(0);
    expect(result.cost.reportedCount).toBe(0);
  });
});

// ── Kit ──────────────────────────────────────────────────────────────────────

describe("loadKitView", () => {
  it("returns the explicit EMPTY state when nothing is kept", async () => {
    const { deps } = fakeDeps([run()], [image({ verdict: "reject" })]);
    // ⚠ EMPTY **AND** NOTHING UNRESOLVED — that pair is what makes this the
    // honestly-empty kit rather than the data-problem state beside it.
    expect(await loadKitView(deps)).toEqual({
      ok: true,
      groups: [],
      keptCount: 0,
      unresolved: 0,
      capped: false,
      limit: IMAGE_LAB_KIT_LIMIT,
    });
  });

  it("groups kept results under their template and carries the slot values", async () => {
    const { deps } = fakeDeps(
      [run({ id: "run-1", referenceIds: ["ref-1"] })],
      [image({ id: "a", verdict: "keep" }), image({ id: "b", verdict: "reject" })]
    );
    const kit = await loadKitView(deps);
    expect(kit.ok).toBe(true);
    if (!kit.ok) return;
    expect(kit.keptCount).toBe(1);
    expect(kit.groups[0]!.template).toBe("Draw {{product}}");
    expect(kit.groups[0]!.results[0]!.slotValues).toEqual({ product: "kites" });
    expect(kit.groups[0]!.results[0]!.referenceLabels).toEqual(["label-ref-1"]);
    expect("storageKey" in kit.groups[0]!.results[0]!).toBe(false);
  });

  it("a failed query is `unavailable`, which is NOT the empty kit", async () => {
    const { deps } = fakeDeps([run()], [image({ verdict: "keep" })], {
      listKeptImages: async () => {
        throw new Error("boom");
      },
    });
    expect(await loadKitView(deps)).toEqual({ ok: false, reason: "unavailable" });
  });

  /**
   * ⚠ T7. `keptCount` was asserted only where groups and results were BOTH one,
   * so `groups.reduce(...)` → `groups.length` survived — and the Kit's headline
   * count would have read "1 kept result" over a page showing three.
   */
  it("counts RESULTS, not groups", async () => {
    const { deps } = fakeDeps(
      [run({ id: "run-1" }), run({ id: "run-2", template: "Draw {{product}}" })],
      [
        image({ id: "a", runId: "run-1", verdict: "keep" }),
        image({ id: "b", runId: "run-1", verdict: "keep" }),
        image({ id: "c", runId: "run-2", verdict: "keep" }),
      ]
    );
    const kit = await loadKitView(deps);
    expect(kit.ok).toBe(true);
    if (!kit.ok) return;
    // Both runs share one template, so ONE group — with THREE results in it.
    expect(kit.groups).toHaveLength(1);
    expect(kit.keptCount).toBe(3);
    expect(kit.keptCount).not.toBe(kit.groups.length);
  });

  /**
   * ⚠ FAIL LOUD ON A SHORT READ (the `listCells` precedent, Unit 5).
   *
   * `projectKit` used to drop every kept image whose run did not come back, so
   * in the terminal case the page rendered "Nothing kept yet" over a bench that
   * HAS kept results — the exact confusion its own docblock forbids.
   */
  it("REFUSES a short read of the runs behind the kept images", async () => {
    const { deps } = fakeDeps([run({ id: "run-1" })], [image({ verdict: "keep" })], {
      listRunsByIds: async () => [],
    });
    expect(await loadKitView(deps)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports an unresolved keep as its OWN state, never as an empty kit", async () => {
    // The read is complete (so no throw) but the projection still cannot place
    // the image — the second line of the same defence.
    const orphan = image({ id: "orphan", runId: "run-1", verdict: "keep" });
    const { deps } = fakeDeps([run({ id: "run-1" })], [orphan], {
      // The run comes back, satisfying the length check, but under another id.
      listRunsByIds: async () => [run({ id: "run-1" })],
    });
    const ok = await loadKitView(deps);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.unresolved).toBe(0);

    const { deps: broken } = fakeDeps([], [orphan], {
      listKeptImages: async () => [orphan],
      listRunsByIds: async () => [run({ id: "somewhere-else" })],
    });
    const result = await loadKitView(broken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ⚠ EMPTY GROUPS **AND** A NON-ZERO UNRESOLVED COUNT. The page renders this
    // as a data problem, never as "nothing kept yet".
    expect(result.groups).toEqual([]);
    expect(result.unresolved).toBe(1);
    expect(result.keptCount).toBe(0);
  });

  it("admits the window it read rather than presenting it as the whole harvest", async () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      image({ id: `k${i}`, cellOrdinal: i, verdict: "keep" })
    );
    const { deps } = fakeDeps([run()], many);

    const capped = await loadKitView(deps, 3);
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.capped).toBe(true);
    expect(capped.limit).toBe(3);

    const roomy = await loadKitView(deps, 10);
    expect(roomy.ok).toBe(true);
    if (!roomy.ok) return;
    expect(roomy.capped).toBe(false);
  });

  it("defaults to the reviewed kit limit", async () => {
    const listKeptImages = vi.fn(async () => []);
    const { deps } = fakeDeps([run()], [], { listKeptImages });
    await loadKitView(deps);
    expect(listKeptImages).toHaveBeenCalledWith(IMAGE_LAB_KIT_LIMIT);
  });
});

// ── The window, the count, and the cap ───────────────────────────────────────

describe("History says how much of the bench it is showing", () => {
  const manyRuns = (n: number) =>
    Array.from({ length: n }, (_, i) => run({ id: `run-${i}`, createdAtMs: NOW - i }));

  /**
   * ⚠ THE KEEP RATE WAS A 50-RUN WINDOW PRESENTED AS THE BENCH. No count, no
   * "showing 50 of N", no pagination — and the number this whole feature exists
   * to produce sat on top of it.
   */
  it("reports the TOTAL matching the filter, not just the page", async () => {
    const runs = manyRuns(120);
    const images = runs.map((r) =>
      image({ id: `i-${r.id}`, runId: r.id, verdict: "keep" })
    );
    const { deps } = fakeDeps(runs, images);
    const result = await loadHistoryView(deps, { ...EMPTY_HISTORY_FILTER, limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.runs).toHaveLength(50);
    expect(result.totalRuns).toBe(120);
    expect(result.totalRuns).not.toBe(result.runs.length);
  });

  it("counts the FILTERED population, not every run on the bench", async () => {
    const sheet = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const runs = [
      run({ id: "with", referenceIds: [sheet] }),
      run({ id: "without", referenceIds: [] }),
    ];
    const { deps } = fakeDeps(runs, [
      image({ id: "a", runId: "with", verdict: "keep" }),
      image({ id: "b", runId: "without", verdict: "keep" }),
    ]);
    const result = await loadHistoryView(deps, {
      ...EMPTY_HISTORY_FILTER,
      referenceIds: [sheet],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalRuns).toBe(1);
  });

  /**
   * ⚠ THE CAP IS DERIVED FROM THE LIMIT, AND ITS TRUNCATION IS ANNOUNCED.
   *
   * A flat 1000-row cap against a 200-run limit returned ZERO images for the
   * oldest runs, `filterHistory` pruned them, and they vanished beneath copy
   * saying "History is complete by design — nothing is ever pruned". Stats and
   * cost then described the surviving suffix, and asking for MORE runs showed
   * FEWER.
   */
  it("passes a cap derived from the run limit, and ANNOUNCES hitting it", async () => {
    const runs = manyRuns(2);
    const cap = historyImageCap(2);
    // Exactly at the ceiling.
    const images = Array.from({ length: cap }, (_, i) =>
      image({ id: `i${i}`, runId: runs[i % 2]!.id, cellOrdinal: i, verdict: "keep" })
    );
    const seen: number[] = [];
    const { deps } = fakeDeps(runs, images, {
      async listImagesForRuns(ids, limit) {
        seen.push(limit);
        return images.filter((i) => ids.includes(i.runId)).slice(0, limit);
      },
    });

    const result = await loadHistoryView(deps, { ...EMPTY_HISTORY_FILTER, limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toEqual([cap]);
    expect(result.imageCap).toBe(cap);
    expect(result.imagesTruncated).toBe(true);
  });

  it("does NOT claim truncation when the read came back under the ceiling", async () => {
    const { deps } = fakeDeps(manyRuns(2), [
      image({ id: "a", runId: "run-0", verdict: "keep" }),
    ]);
    const result = await loadHistoryView(deps, { ...EMPTY_HISTORY_FILTER, limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imagesTruncated).toBe(false);
  });

  it("asking for MORE runs asks for MORE images, never the same flat number", async () => {
    const seen: number[] = [];
    const { deps } = fakeDeps(manyRuns(3), [image({ id: "a", runId: "run-0" })], {
      async listImagesForRuns(_ids, limit) {
        seen.push(limit);
        return [];
      },
    });
    await loadHistoryView(deps, { ...EMPTY_HISTORY_FILTER, limit: 50 });
    await loadHistoryView(deps, { ...EMPTY_HISTORY_FILTER, limit: 200 });
    expect(seen[1]!).toBeGreaterThan(seen[0]!);
  });

  it("a failed COUNT is `unavailable`, never a page claiming to show all of nothing", async () => {
    const { deps } = fakeDeps([run()], [image()], {
      countRuns: async () => {
        throw new Error("42501");
      },
    });
    expect(await loadHistoryView(deps, EMPTY_HISTORY_FILTER)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  /** The filter rides out with the result, because the stats are computed over
   *  it and the surface must render which population produced them. */
  it("hands the applied filter back so the stats can be labelled with it", async () => {
    const applied: HistoryFilter = { ...EMPTY_HISTORY_FILTER, verdict: "keep" };
    const { deps } = fakeDeps([run()], [image({ verdict: "keep" })]);
    const result = await loadHistoryView(deps, applied);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter).toEqual(applied);
  });

  /** ⚠ A PARTIALLY-JUDGED MODEL, end to end: the rate is over the judged rows
   *  and `unjudged` rides beside it. */
  it("carries a partially-judged model's completeness caption through the sequence", async () => {
    const rows = [
      image({ id: "a", cellOrdinal: 0, verdict: "keep" }),
      image({ id: "b", cellOrdinal: 1, verdict: "reject" }),
      image({ id: "c", cellOrdinal: 2, verdict: null }),
      image({ id: "d", cellOrdinal: 3, verdict: null }),
    ];
    const { deps } = fakeDeps([run()], rows);
    const result = await loadHistoryView(deps, EMPTY_HISTORY_FILTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = result.stats[0]!;
    expect(stats.completions).toBe(4);
    expect(stats.unjudged).toBe(2);
    expect(stats.keepRate).toBeCloseTo(0.5);
    // NOT keeps / done, which would be 0.25.
    expect(stats.keepRate).not.toBeCloseTo(0.25);
  });
});

