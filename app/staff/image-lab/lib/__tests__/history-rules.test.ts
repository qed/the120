import { describe, expect, it } from "vitest";
import {
  aggregateCost,
  attemptIndexes,
  decideNoteWrite,
  decideTagWrite,
  decideVerdictWrite,
  describeCopyOutcome,
  describeStatsPopulation,
  filledSlotEntries,
  filterHistory,
  formatCostLine,
  formatKeepRate,
  groupCells,
  dropPartialOldestRun,
  heldOverride,
  historyFilterChips,
  historyFilterToQuery,
  historyImageCap,
  imageMatchesFilter,
  isExcludedFailure,
  isHistoryFilterActive,
  isKeepRateDenominatorRow,
  isOverrideSuperseded,
  keepRate,
  keepRateIsMeaningful,
  kitCopyText,
  latestScoredPerCell,
  overrideReducer,
  parseHistoryFilter,
  perModelStats,
  projectImageView,
  projectKit,
  resolveVerdict,
  runMatchesFilter,
  thumbnailState,
  totalCost,
  verdictPatch,
  EMPTY_HISTORY_FILTER,
  EMPTY_OVERRIDES,
  IMAGE_LAB_EVIDENCE_COPY,
  IMAGE_LAB_FILTER_MAX_VALUES,
  IMAGE_LAB_HISTORY_MAX_LIMIT,
  IMAGE_LAB_HISTORY_RUN_LIMIT,
  IMAGE_LAB_RETRY_HEADROOM,
  IMAGE_LAB_VERDICT_NOTE_MAX_CHARS,
  type HistoryFilter,
  type HistoryImageRow,
  type HistoryImageView,
  type HistoryRunRow,
} from "../history-rules";
import { IMAGE_LAB_MAX_CELLS_PER_RUN } from "../run-rules";
import { KEEP_RATE_EXCLUDED_FAILURES } from "../image-lab-rules";

/**
 * The evidence maths — the unit's reason to exist
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6).
 *
 * The Lab's whole product is ONE number per model, and this file is where that
 * number is pinned. Every assertion below corresponds to a way of getting it
 * wrong that would still render, still look plausible, and still be wrong in the
 * direction that changes which model we build the panel engine on.
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
  template: "Draw {{product}} in the style of {{oneLiner}}",
  slotValues: { product: "kites" },
  resolvedPrompt: "Draw kites in the style of {{oneLiner}}",
  referenceIds: [],
  drillTags: [],
  note: "",
  compare: false,
  iteratedOnModel: null,
  iteratedFromRunId: null,
  createdAtMs: NOW - 5000,
  ...over,
});

const filter = (over: Partial<HistoryFilter> = {}): HistoryFilter => ({
  ...EMPTY_HISTORY_FILTER,
  ...over,
});

// ── The keep-rate denominator ────────────────────────────────────────────────

describe("the keep-rate denominator is `done`, and nothing else", () => {
  it("counts a done row", () => {
    expect(isKeepRateDenominatorRow(image({ state: "done" }))).toBe(true);
  });

  it("EXCLUDES requested rows — including the stale ones", () => {
    // Stale is a DERIVED render label over a non-finalized row, never persisted,
    // so a tab someone closed three hours ago is `requested` and must not dilute
    // a model's score.
    const staleRow = image({
      state: "requested",
      attemptedAtMs: null,
      createdAtMs: NOW - 60 * 60 * 1000,
      storageKey: null,
    });
    expect(isKeepRateDenominatorRow(staleRow)).toBe(false);
    expect(
      isKeepRateDenominatorRow(image({ state: "requested", storageKey: null }))
    ).toBe(false);
  });

  it("EXCLUDES failed rows of every reason", () => {
    for (const reason of [
      "timeout",
      "safety_blocked",
      "provider_error",
      "rate_limited",
      "unconfigured",
    ] as const) {
      expect(
        isKeepRateDenominatorRow(image({ state: "failed", failureReason: reason })),
        reason
      ).toBe(false);
    }
  });

  /**
   * ⚠ THE MUTATION TARGET. Drop the excluded-failure clause from
   * `isKeepRateDenominatorRow` and this reddens.
   *
   * The row is the one the migration header describes: a killed function
   * finalized `failed`/`timeout`, the vendor call landed afterwards and finalized
   * `done` over it. Today's biconditional CHECK makes that a constraint violation
   * GOING FORWARD and says nothing about a row written before it, by a hand-run
   * fix, or under a partially applied migration. Counted, it sits in the
   * numerator while the denominator excludes it — keep rate above 100% for
   * precisely the flakiest model.
   */
  it("excludes a `done` row that still carries an excluded failure reason", () => {
    const corrupt = image({ state: "done", failureReason: "timeout", verdict: "keep" });
    expect(isKeepRateDenominatorRow(corrupt)).toBe(false);

    const stats = perModelStats([corrupt], NOW);
    expect(stats[0]!.completions).toBe(0);
    // …and the KEEP is excluded too, so the ratio can never exceed 1.
    expect(stats[0]!.keeps).toBe(0);
    expect(stats[0]!.keepRate).toBeNull();
  });

  it("reads the excluded set from Unit 1 rather than re-spelling it", () => {
    expect([...KEEP_RATE_EXCLUDED_FAILURES].sort()).toEqual([
      "safety_blocked",
      "timeout",
    ]);
    for (const reason of KEEP_RATE_EXCLUDED_FAILURES) {
      expect(isExcludedFailure(reason)).toBe(true);
    }
    expect(isExcludedFailure("provider_error")).toBe(false);
    expect(isExcludedFailure(null)).toBe(false);
  });
});

describe("keep rate = keeps / (keeps + rejects) — JUDGED, not DONE", () => {
  it("computes the ratio over the JUDGED rows", () => {
    expect(keepRate(3, 1)).toBeCloseTo(0.75);
    expect(formatKeepRate(keepRate(3, 1))).toBe("75%");
    expect(keepRate(0, 0)).toBeNull();
  });

  /**
   * ⚠ THE MUTATION TARGET FOR THE WHOLE DECISION. Divide by `done` instead of
   * by `keeps + rejects` and this reddens.
   *
   * The model below has ten completions, five judged, five kept. Under the old
   * formula it read 50% — while a FULLY reviewed model with six keeps of ten read
   * 60%, so the less-reviewed model scored LOWER purely for being unfinished.
   * That is an artifact of OUR REVIEW PACE admitted into the vendor's score, in a
   * unit that deliberately excludes our own timeouts for exactly that reason.
   */
  it("an unjudged completion is NOT in the denominator — it is a caption beside it", () => {
    const halfReviewed = [
      ...Array.from({ length: 5 }, (_, i) =>
        image({ id: `k${i}`, cellOrdinal: i, state: "done", verdict: "keep" as const })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        image({ id: `u${i}`, cellOrdinal: 5 + i, state: "done", verdict: null })
      ),
    ];
    const half = perModelStats(halfReviewed, NOW)[0]!;
    expect(half.completions).toBe(10);
    expect(half.unjudged).toBe(5);
    expect(half.keepRate).toBe(1);

    const fullyReviewed = [
      ...Array.from({ length: 6 }, (_, i) =>
        image({ id: `k${i}`, cellOrdinal: i, state: "done", verdict: "keep" as const })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        image({ id: `r${i}`, cellOrdinal: 6 + i, state: "done", verdict: "reject" as const })
      ),
    ];
    const full = perModelStats(fullyReviewed, NOW)[0]!;
    expect(full.unjudged).toBe(0);
    expect(full.keepRate).toBeCloseTo(0.6);

    // The half-reviewed model no longer scores BELOW the fully-reviewed one for
    // the sole reason that nobody finished looking at it.
    expect(half.keepRate!).toBeGreaterThan(full.keepRate!);
  });

  it("a model with completions but NOTHING judged has no rate at all", () => {
    const stats = perModelStats(
      [
        image({ id: "a", cellOrdinal: 0, state: "done", verdict: null }),
        image({ id: "b", cellOrdinal: 1, state: "done", verdict: null }),
      ],
      NOW
    )[0]!;
    expect(stats.completions).toBe(2);
    expect(stats.scoredCells).toBe(2);
    expect(stats.unjudged).toBe(2);
    expect(stats.keepRate).toBeNull();
    expect(formatKeepRate(stats.keepRate)).toBe("—");
  });

  /**
   * ⚠ T11. `formatKeepRate` was pinned only at values where round and floor
   * agree, so swapping `Math.round` for `Math.floor` survived.
   */
  it("ROUNDS rather than truncates", () => {
    expect(formatKeepRate(1 / 3)).toBe("33%");
    expect(formatKeepRate(2 / 3)).toBe("67%");
    expect(formatKeepRate(0.006)).toBe("1%");
    expect(formatKeepRate(null)).toBe("—");
  });

  /** A run with all-failed cells shows 0 kept, not a divide-by-zero. */
  it("a model whose every cell failed reports 0 kept and NO rate — never NaN", () => {
    const rows = [
      image({ id: "a", cellOrdinal: 0, state: "failed", failureReason: "provider_error", storageKey: null }),
      image({ id: "b", cellOrdinal: 1, state: "failed", failureReason: "timeout", storageKey: null }),
      image({ id: "c", cellOrdinal: 2, state: "failed", failureReason: "safety_blocked", storageKey: null }),
    ];
    const stats = perModelStats(rows, NOW);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.completions).toBe(0);
    expect(stats[0]!.keeps).toBe(0);
    expect(stats[0]!.keepRate).toBeNull();
    expect(Number.isNaN(stats[0]!.keepRate as unknown as number)).toBe(false);
    expect(formatKeepRate(stats[0]!.keepRate)).toBe("—");
  });
});

describe("timeout and safety_blocked are their OWN labelled counts", () => {
  // ⚠ NINE DISTINCT CELLS. Every row here is its own
  // `(runId, modelId, cellOrdinal)` position, so this fixture measures the
  // buckets and nothing else; the many-attempts-at-one-cell case has its own
  // describe below.
  const rows = [
    image({ id: "1", cellOrdinal: 0, state: "done", verdict: "keep" }),
    image({ id: "2", cellOrdinal: 1, state: "done", verdict: "reject" }),
    image({ id: "3", cellOrdinal: 2, state: "done", verdict: null }),
    image({ id: "4", cellOrdinal: 3, state: "failed", failureReason: "timeout", storageKey: null }),
    image({ id: "5", cellOrdinal: 4, state: "failed", failureReason: "timeout", storageKey: null }),
    image({ id: "6", cellOrdinal: 5, state: "failed", failureReason: "safety_blocked", storageKey: null }),
    image({ id: "7", cellOrdinal: 6, state: "failed", failureReason: "provider_error", storageKey: null }),
    image({ id: "8", cellOrdinal: 7, state: "requested", attemptedAtMs: NOW - 1000, storageKey: null }),
    image({
      id: "9",
      cellOrdinal: 8,
      state: "requested",
      attemptedAtMs: null,
      createdAtMs: NOW - 60 * 60 * 1000,
      storageKey: null,
    }),
  ];

  /**
   * ⚠ THE MUTATION TARGET. Fold `timeouts`/`safetyBlocked` back into
   * `completions` and this reddens: the denominator becomes 6, the rate 1/6, and
   * the model that our own adapter budget and a pending allowlist happened to
   * punish reads as the worst of the three.
   */
  it("the scored population is the three DONE rows — the five failures are outside it", () => {
    const stats = perModelStats(rows, NOW)[0]!;
    expect(stats.attempts).toBe(9);
    expect(stats.completions).toBe(3);
    expect(stats.scoredCells).toBe(3);
    expect(stats.keeps).toBe(1);
    expect(stats.rejects).toBe(1);
    expect(stats.unjudged).toBe(1);
    // ⚠ keeps / (keeps + rejects) = 1/2, NOT keeps / done = 1/3.
    expect(stats.keepRate).toBeCloseTo(1 / 2);
  });

  it("breaks the two OUR-artifact failures out separately from the vendor's", () => {
    const stats = perModelStats(rows, NOW)[0]!;
    expect(stats.timeouts).toBe(2);
    expect(stats.safetyBlocked).toBe(1);
    expect(stats.otherFailures).toBe(1);

    /**
     * ⚠ THE REAL ASSERTION. What stood here was
     * `expect(completions + timeouts + safetyBlocked).not.toBe(completions)`,
     * which is trivially true whenever either count is non-zero — it says
     * "3 + 2 + 1 ≠ 3", not "our failures are outside the denominator". Folding
     * them straight back in left it green.
     *
     * What is actually claimed is that the SCORED population contains no failed
     * row at all, and that the rate is computed from `keeps + rejects` alone.
     */
    const scored = latestScoredPerCell(rows);
    expect(scored.every((row) => row.state === "done")).toBe(true);
    expect(scored.some((row) => row.failureReason !== null)).toBe(false);
    expect(scored).toHaveLength(stats.scoredCells);
    expect(stats.keepRate).toBeCloseTo(stats.keeps / (stats.keeps + stats.rejects));
    expect(stats.keepRate).not.toBeCloseTo(
      stats.keeps / (stats.keeps + stats.rejects + stats.timeouts + stats.safetyBlocked)
    );
  });

  /**
   * ⚠ THE SEVEN CENSUS BUCKETS SUM TO `attempts`, EXACTLY.
   *
   * A `done` row carrying an excluded failure reason used to be in `attempts` and
   * in NO other bucket, so the rendered counts visibly did not add up and a
   * reader had no way to reconcile them. `anomalies` is that row, surfaced as the
   * data-integrity signal it is.
   */
  it("every row lands in exactly one census bucket, and they sum to attempts", () => {
    const withAnomaly = [
      ...rows,
      image({
        id: "10",
        cellOrdinal: 9,
        state: "done",
        failureReason: "timeout",
        verdict: "keep",
      }),
    ];
    const stats = perModelStats(withAnomaly, NOW)[0]!;
    expect(stats.attempts).toBe(10);
    expect(stats.anomalies).toBe(1);
    expect(
      stats.completions +
        stats.anomalies +
        stats.timeouts +
        stats.safetyBlocked +
        stats.otherFailures +
        stats.pending +
        stats.stale
    ).toBe(stats.attempts);
    // …and the anomaly reaches neither half of the ratio.
    expect(stats.keeps).toBe(1);
    expect(stats.scoredCells).toBe(3);
  });

  it("splits non-finalized rows into in-flight and stale, both outside the rate", () => {
    const stats = perModelStats(rows, NOW)[0]!;
    expect(stats.pending).toBe(1);
    expect(stats.stale).toBe(1);
  });

  it("groups per model and never mixes two models' evidence", () => {
    const stats = perModelStats(
      [
        image({ id: "a", modelId: "gpt-image-2", verdict: "keep" }),
        image({ id: "b", modelId: "gemini-3-pro-image", verdict: "reject" }),
      ],
      NOW
    );
    expect(stats.map((s) => s.modelId)).toEqual(["gemini-3-pro-image", "gpt-image-2"]);
    expect(stats[1]!.keepRate).toBe(1);
    expect(stats[0]!.keepRate).toBe(0);
  });
});

// ── Cost ─────────────────────────────────────────────────────────────────────

describe("estimated and reported cost are SEPARATE and never summed", () => {
  const rows = [
    image({ id: "1", billed: true, costEstimatedUsd: 0.053, costReportedUsd: 0.05 }),
    image({ id: "2", billed: true, costEstimatedUsd: 0.053, costReportedUsd: null }),
    image({
      id: "3",
      billed: false,
      costEstimatedUsd: null,
      costReportedUsd: null,
      state: "failed",
      failureReason: "unconfigured",
      storageKey: null,
    }),
  ];

  /**
   * ⚠ THE MUTATION TARGET. Make `aggregateCost` add the two figures into one
   * total and this reddens: they are two MEASUREMENTS of the same money — a list
   * price and the gateway's own number — and 0.106 + 0.05 is neither what we
   * predicted nor what we were charged.
   */
  it("keeps the two totals apart, with the count behind each", () => {
    const cost = aggregateCost(rows);
    expect(cost.estimatedUsd).toBeCloseTo(0.106, 6);
    expect(cost.reportedUsd).toBeCloseTo(0.05, 6);
    expect(cost.estimatedCount).toBe(2);
    expect(cost.reportedCount).toBe(1);
    // The sum appears NOWHERE in the aggregate.
    expect(Object.values(cost)).not.toContain(0.156);
  });

  it("counts only BILLED rows — an unconfigured cell never dialled anything", () => {
    expect(aggregateCost(rows).billedCount).toBe(2);
  });

  it("still counts a BILLED-BUT-FAILED row: vendors bill on generation", () => {
    const cost = aggregateCost([
      image({
        state: "failed",
        failureReason: "timeout",
        storageKey: null,
        billed: true,
        costEstimatedUsd: 0.053,
      }),
    ]);
    expect(cost.estimatedUsd).toBeCloseTo(0.053, 6);
    expect(cost.billedCount).toBe(1);
  });

  /**
   * ⚠ T4 — THE FULL STRING, NOT `toContain("estimated")`.
   *
   * `toContain` on the two words survives rendering the REPORTED total and count
   * under the ESTIMATED label — on the one function that puts the two money
   * figures in front of a human, on the surface whose documented failure mode is
   * "two measurements of the same money".
   */
  it("labels which figure is which — asserted as the WHOLE rendered line", () => {
    expect(formatCostLine(aggregateCost(rows))).toBe(
      "$0.11 estimated (2 of 2 billed) · $0.0500 reported (1 of 2)"
    );

    const silent = formatCostLine(
      aggregateCost([image({ billed: true, costEstimatedUsd: 0.01, costReportedUsd: null })])
    );
    expect(silent).toBe(
      `$0.0100 estimated (1 of 1 billed) · ${IMAGE_LAB_EVIDENCE_COPY.cost.noneReported}`
    );
    // Never "$0.00 reported", which reads as "the gateway says it was free".
    expect(silent).not.toContain("$0.00 reported");
  });

  it("totals across models are computed from the ROWS, not by re-summing lines", () => {
    const rounded = totalCost([
      image({ id: "a", billed: true, costEstimatedUsd: 0.0336 }),
      image({ id: "b", billed: true, costEstimatedUsd: 0.0336 }),
      image({ id: "c", billed: true, costEstimatedUsd: 0.0336 }),
    ]);
    expect(rounded.estimatedUsd).toBe(0.1008);
  });
});

// ── Filters ──────────────────────────────────────────────────────────────────

describe("the reference filter is CONTAINMENT — the drill retrieved as a set", () => {
  const sheetA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sheetB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("matches a run that attached the reference", () => {
    expect(
      runMatchesFilter(run({ referenceIds: [sheetA] }), filter({ referenceIds: [sheetA] }))
    ).toBe(true);
  });

  it("excludes a run that never attached it", () => {
    expect(
      runMatchesFilter(run({ referenceIds: [sheetB] }), filter({ referenceIds: [sheetA] }))
    ).toBe(false);
    expect(runMatchesFilter(run({ referenceIds: [] }), filter({ referenceIds: [sheetA] }))).toBe(
      false
    );
  });

  /**
   * ⚠ THE MUTATION TARGET. Change the rule (or the loader's `.contains`) to
   * overlap — `some` / `&&` — and this reddens. With two sheets selected the
   * drill asks "which runs used BOTH"; overlap silently answers "either", a wider
   * set with the same shape and no error anywhere.
   */
  it("with TWO references selected, a run carrying only one is EXCLUDED", () => {
    const both = filter({ referenceIds: [sheetA, sheetB] });
    expect(runMatchesFilter(run({ referenceIds: [sheetA] }), both)).toBe(false);
    expect(runMatchesFilter(run({ referenceIds: [sheetB] }), both)).toBe(false);
    expect(runMatchesFilter(run({ referenceIds: [sheetA, sheetB] }), both)).toBe(true);
    expect(runMatchesFilter(run({ referenceIds: [sheetB, sheetA, "x"] }), both)).toBe(true);
  });

  it("drill tags are containment too — two tags means BOTH", () => {
    const both = filter({ drillTags: ["consistency", "style"] });
    expect(runMatchesFilter(run({ drillTags: ["consistency"] }), both)).toBe(false);
    expect(runMatchesFilter(run({ drillTags: ["consistency", "style"] }), both)).toBe(true);
  });

  it("an empty filter term means ANY, never NONE", () => {
    expect(runMatchesFilter(run({ referenceIds: [] }), EMPTY_HISTORY_FILTER)).toBe(true);
    expect(isHistoryFilterActive(EMPTY_HISTORY_FILTER)).toBe(false);
  });

  /**
   * ⚠ T3. `isHistoryFilterActive` was only ever asserted FALSE, so replacing
   * its body with `return false` survived — and `history/page.tsx` branches on it
   * to choose between "No runs yet. Compose one on the Bench" and "No runs match
   * these filters", which is precisely the nothing-was-ever-generated versus
   * widen-your-filter misreading the two strings exist to prevent.
   */
  it("is ACTIVE for each term on its own", () => {
    expect(isHistoryFilterActive(filter({ modelIds: ["gpt-image-2"] }))).toBe(true);
    expect(isHistoryFilterActive(filter({ verdict: "keep" }))).toBe(true);
    expect(isHistoryFilterActive(filter({ verdict: "unjudged" }))).toBe(true);
    expect(isHistoryFilterActive(filter({ drillTags: ["style"] }))).toBe(true);
    expect(isHistoryFilterActive(filter({ referenceIds: [sheetA] }))).toBe(true);
    // A non-default LIMIT is not a filter: it widens or narrows the page, it does
    // not change which runs qualify, and calling it "active" would put the
    // wrong empty-state copy on an unfiltered bench.
    expect(isHistoryFilterActive(filter({ limit: 200 }))).toBe(false);
  });
});

describe("filters compose with AND", () => {
  const sheet = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const runs = [
    run({ id: "keeper", referenceIds: [sheet], drillTags: ["consistency"] }),
    run({ id: "no-sheet", referenceIds: [], drillTags: ["consistency"] }),
    run({ id: "no-tag", referenceIds: [sheet], drillTags: [] }),
  ];
  const images = [
    image({ id: "k1", runId: "keeper", modelId: "gpt-image-2", verdict: "keep" }),
    image({ id: "k2", runId: "keeper", modelId: "gemini-3-pro-image", verdict: "keep" }),
    image({ id: "k3", runId: "keeper", modelId: "gpt-image-2", verdict: "reject" }),
    image({ id: "n1", runId: "no-sheet", modelId: "gpt-image-2", verdict: "keep" }),
    image({ id: "t1", runId: "no-tag", modelId: "gpt-image-2", verdict: "keep" }),
  ];

  it("model + verdict + tag + reference, all four at once", () => {
    const result = filterHistory(
      runs,
      images,
      filter({
        modelIds: ["gpt-image-2"],
        verdict: "keep",
        drillTags: ["consistency"],
        referenceIds: [sheet],
      })
    );
    expect(result.runs.map((r) => r.id)).toEqual(["keeper"]);
    expect(result.images.map((i) => i.id)).toEqual(["k1"]);
  });

  it("drops a run whose every image the image-level half filtered out", () => {
    // `no-tag` passes neither half; `keeper` passes the run half but has no
    // `unjudged` image, so it is not a run with zero images — it is not in the
    // answer at all.
    const result = filterHistory(runs, images, filter({ verdict: "unjudged" }));
    expect(result.runs).toEqual([]);
    expect(result.images).toEqual([]);
  });

  it("the verdict filter distinguishes unjudged from rejected", () => {
    expect(imageMatchesFilter({ modelId: "m", verdict: null }, filter({ verdict: "unjudged" }))).toBe(
      true
    );
    expect(
      imageMatchesFilter({ modelId: "m", verdict: "reject" }, filter({ verdict: "unjudged" }))
    ).toBe(false);
    expect(imageMatchesFilter({ modelId: "m", verdict: null }, filter({ verdict: "any" }))).toBe(
      true
    );
  });
});

describe("the filter parser is total and degrades to a WIDER view", () => {
  it("reads repeated and comma-joined params alike", () => {
    const parsed = parseHistoryFilter({
      model: ["gpt-image-2", "gemini-3-pro-image"],
      tag: "consistency,style",
      verdict: "keep",
      ref: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    });
    expect(parsed.modelIds).toEqual(["gpt-image-2", "gemini-3-pro-image"]);
    expect(parsed.drillTags).toEqual(["consistency", "style"]);
    expect(parsed.verdict).toBe("keep");
    // Normalized: a uuid pasted in upper case must still match the stored value.
    expect(parsed.referenceIds).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  });

  it("drops junk instead of refusing — a stale bookmark widens, never errors", () => {
    const parsed = parseHistoryFilter({
      verdict: "maybe",
      tag: "kid_appeal",
      ref: "not-a-uuid",
      model: ["../../etc/passwd"],
    });
    expect(parsed).toEqual(EMPTY_HISTORY_FILTER);
  });

  it("caps a hand-edited limit", () => {
    expect(parseHistoryFilter({ limit: "99999" }).limit).toBe(IMAGE_LAB_HISTORY_MAX_LIMIT);
    expect(parseHistoryFilter({ limit: "-3" }).limit).toBe(EMPTY_HISTORY_FILTER.limit);
    expect(parseHistoryFilter(undefined).limit).toBe(EMPTY_HISTORY_FILTER.limit);
  });

  /**
   * ⚠ T6. `IMAGE_LAB_FILTER_MAX_VALUES` is exported and documented ("so a
   * hand-rolled query cannot ask for 10k ids") and was asserted NOWHERE, so
   * removing `.slice(0, MAX)` from either path survived.
   */
  it("BOUNDS every list, so a hand-rolled query cannot ask for ten thousand ids", () => {
    const manyModels = Array.from({ length: 40 }, (_, i) => `model-${i}`);
    expect(parseHistoryFilter({ model: manyModels }).modelIds).toHaveLength(
      IMAGE_LAB_FILTER_MAX_VALUES
    );

    const hex = "0123456789abcdef";
    const manyRefs = Array.from(
      { length: 40 },
      (_, i) => `${hex[i % 16]!.repeat(8)}-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`
    );
    expect(parseHistoryFilter({ ref: manyRefs }).referenceIds).toHaveLength(
      IMAGE_LAB_FILTER_MAX_VALUES
    );
  });

  it("round-trips through a query string", () => {
    const original = filter({
      modelIds: ["gpt-image-2"],
      verdict: "keep",
      drillTags: ["style"],
      referenceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    });
    const query = historyFilterToQuery(original);
    const params = Object.fromEntries(new URLSearchParams(query.slice(1)).entries());
    const reparsed = parseHistoryFilter(params);
    expect(reparsed.modelIds).toEqual(original.modelIds);
    expect(reparsed.verdict).toBe(original.verdict);
    expect(reparsed.drillTags).toEqual(original.drillTags);
    expect(reparsed.referenceIds).toEqual(original.referenceIds);
    expect(historyFilterToQuery(EMPTY_HISTORY_FILTER)).toBe("");
  });

  /**
   * ⚠ THE LIMIT ROUND-TRIPS. It did not, so a hand-set `?limit=200` was
   * silently discarded by the next Apply while the URL still said 200 and the
   * reader still believed they were reading two hundred runs.
   */
  it("round-trips the LIMIT, and omits it when it is the default", () => {
    const wide = filter({ limit: 200 });
    const query = historyFilterToQuery(wide);
    expect(query).toContain("limit=200");
    const params = Object.fromEntries(new URLSearchParams(query.slice(1)).entries());
    expect(parseHistoryFilter(params).limit).toBe(200);

    expect(historyFilterToQuery(filter({ limit: IMAGE_LAB_HISTORY_RUN_LIMIT }))).toBe("");
    // …and it survives a chip drop, which rebuilds the query from the filter.
    const chips = historyFilterChips(filter({ limit: 200, verdict: "keep" }));
    expect(chips[0]!.dropQuery).toContain("limit=200");
  });
});

// ── The client projection ────────────────────────────────────────────────────

describe("no storageKey reaches a client-facing projection", () => {
  /**
   * ⚠ THE MUTATION TARGET. Spread the whole row (or re-add `storageKey`) in
   * `projectImageView` and this reddens. The bucket is private, so a key is not a
   * credential — but it is the INPUT to one, and a UI that holds keys is a UI
   * whose next feature mints URLs from them client-side.
   */
  it("strips the key and reports only that bytes exist", () => {
    const view = projectImageView(image({ storageKey: "runs/run-1/img-1" }), "https://s/x");
    expect(Object.keys(view)).not.toContain("storageKey");
    expect("storageKey" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain("runs/run-1/img-1");
    expect(view.hasObject).toBe(true);
    expect(view.signedUrl).toBe("https://s/x");
  });

  it("a failed mint still yields a renderable, judgeable row", () => {
    const view = projectImageView(image(), null);
    expect(view.hasObject).toBe(true);
    expect(view.signedUrl).toBeNull();
    expect(view.state).toBe("done");
    expect(view.costEstimatedUsd).toBe(0.053);
  });

  it("a row with no object says so", () => {
    const view = projectImageView(image({ storageKey: null, state: "failed", failureReason: "timeout" }), null);
    expect(view.hasObject).toBe(false);
  });
});

// ── Verdict decisions ────────────────────────────────────────────────────────

describe("verdict writes", () => {
  it("verdict and verdict_at are ALWAYS produced together", () => {
    const kept = verdictPatch("keep", NOW);
    expect(kept).toEqual({ verdict: "keep", verdictAtMs: NOW });
    const cleared = verdictPatch(null, NOW);
    expect(cleared).toEqual({ verdict: null, verdictAtMs: null });
    // The schema's rule: `(verdict is null) = (verdict_at is null)`.
    for (const patch of [kept, cleared, verdictPatch("reject", NOW)]) {
      expect(patch.verdict === null).toBe(patch.verdictAtMs === null);
    }
  });

  /**
   * ⚠ THE MUTATION TARGET. Drop the `state === "done"` clause and this reddens —
   * and in production the CHECK `fp_image_lab_images_verdict_needs_done` answers
   * a button press with a 23514 naming a constraint.
   */
  it("REFUSES a verdict on a non-done row, cleanly", () => {
    for (const state of ["requested", "failed"] as const) {
      expect(decideVerdictWrite({ state }, "keep")).toEqual({
        ok: false,
        reason: "not_done",
      });
    }
    expect(decideVerdictWrite({ state: "done" }, "keep")).toEqual({
      ok: true,
      verdict: "keep",
    });
  });

  it("still allows CLEARING on a row that later failed", () => {
    // A row judged before a late `failed` finalize must remain un-judgeable, not
    // un-clearable — otherwise a keep is stuck on a cell with no image.
    expect(decideVerdictWrite({ state: "failed" }, null)).toEqual({
      ok: true,
      verdict: null,
    });
  });

  it("refuses a nonexistent image cleanly", () => {
    expect(decideVerdictWrite(null, "keep")).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a verdict outside the closed set", () => {
    expect(decideVerdictWrite({ state: "done" }, "maybe")).toEqual({
      ok: false,
      reason: "invalid_verdict",
    });
  });
});

describe("notes and tags are independent of the verdict", () => {
  it("accepts a note on an unjudged and even a failed row", () => {
    expect(decideNoteWrite({ state: "done" }, "hero drifts left")).toEqual({
      ok: true,
      note: "hero drifts left",
    });
    expect(decideNoteWrite({ state: "failed" }, "timed out twice")).toEqual({
      ok: true,
      note: "timed out twice",
    });
  });

  it("bounds the note at the migration's cap", () => {
    expect(decideNoteWrite({ state: "done" }, "x".repeat(IMAGE_LAB_VERDICT_NOTE_MAX_CHARS)).ok).toBe(
      true
    );
    expect(
      decideNoteWrite({ state: "done" }, "x".repeat(IMAGE_LAB_VERDICT_NOTE_MAX_CHARS + 1))
    ).toEqual({ ok: false, reason: "note_too_long" });
  });

  it("closes drill tags to Unit 1's vocabulary and de-duplicates", () => {
    expect(decideTagWrite(["consistency", "consistency", "style"])).toEqual({
      ok: true,
      tags: ["consistency", "style"],
    });
    // The silent failure this closes: `kid_appeal` for `kid-appeal` drops the run
    // out of every drill filter with no error anywhere.
    expect(decideTagWrite(["kid_appeal"])).toEqual({ ok: false, reason: "invalid_tag" });
    expect(decideTagWrite("consistency")).toEqual({ ok: false, reason: "invalid_tag" });
    expect(decideTagWrite([])).toEqual({ ok: true, tags: [] });
  });
});

// ── The Kit ──────────────────────────────────────────────────────────────────

describe("the Kit is kept results only, and copy yields the TEMPLATE", () => {
  const view = (over: Partial<HistoryImageView> = {}): HistoryImageView => {
    const { storageKey, ...rest } = image();
    void storageKey;
    return { ...rest, hasObject: true, signedUrl: "https://s/x", ...over };
  };

  const runs = [
    run({
      id: "run-1",
      template: "Draw {{product}} in the style of {{oneLiner}}",
      resolvedPrompt: "Draw kites in the style of Fly higher",
      slotValues: { product: "kites", oneLiner: "Fly higher" },
      referenceIds: ["ref-1"],
      drillTags: ["consistency"],
    }),
    run({
      id: "run-2",
      template: "Draw {{product}} in the style of {{oneLiner}}",
      resolvedPrompt: "Draw slime in the style of Squish it",
      slotValues: { product: "slime" },
      referenceIds: [],
    }),
  ];

  const images = [
    view({ id: "a", runId: "run-1", verdict: "keep", modelId: "gpt-image-2" }),
    view({ id: "b", runId: "run-2", verdict: "keep", modelId: "gemini-3-pro-image" }),
    view({ id: "c", runId: "run-1", verdict: "reject" }),
    view({ id: "d", runId: "run-1", verdict: null }),
  ];

  const references = [{ id: "ref-1", label: "Hero sheet" }];

  it("includes ONLY images judged keep", () => {
    const { groups, unresolved } = projectKit(runs, images, references);
    const ids = groups.flatMap((group) => group.results.map((r) => r.imageId));
    expect(ids.sort()).toEqual(["a", "b"]);
    expect(unresolved).toBe(0);
  });

  it("groups the two runs under their one shared template", () => {
    const { groups } = projectKit(runs, images, references);
    expect(groups).toHaveLength(1);
    expect([...groups[0]!.modelIds].sort()).toEqual(["gemini-3-pro-image", "gpt-image-2"]);
  });

  /**
   * ⚠ THE MUTATION TARGET. Make `kitCopyText` return the resolved prompt and this
   * reddens. The resolved prompt has one child's product name baked into it —
   * copying it into the panel engine would hardcode one child's business into a
   * template meant to be filled from every child's record.
   */
  it("copy yields the {{slot}} template VERBATIM, not the resolved prompt", () => {
    const group = projectKit(runs, images, references).groups[0]!;
    const copied = kitCopyText(group);
    expect(copied).toBe("Draw {{product}} in the style of {{oneLiner}}");
    expect(copied).toContain("{{product}}");
    expect(copied).toContain("{{oneLiner}}");
    expect(copied).not.toContain("kites");
    expect(copied).not.toContain("Fly higher");
  });

  it("shows the slot values ALONGSIDE, so the reader sees what filled it", () => {
    const group = projectKit(runs, images, references).groups[0]!;
    const fromRun1 = group.results.find((r) => r.runId === "run-1")!;
    expect(fromRun1.slotValues).toEqual({ product: "kites", oneLiner: "Fly higher" });
    expect(fromRun1.resolvedPrompt).toBe("Draw kites in the style of Fly higher");
    expect(fromRun1.referenceLabels).toEqual(["Hero sheet"]);
    expect(fromRun1.drillTags).toEqual(["consistency"]);
  });

  it("nothing kept yields NO groups — the surface's explicit empty state", () => {
    expect(projectKit(runs, [view({ verdict: "reject" })], references)).toEqual({
      groups: [],
      unresolved: 0,
    });
    expect(projectKit([], [], [])).toEqual({ groups: [], unresolved: 0 });
  });

  it("names a reference that is no longer listed rather than rendering a blank", () => {
    const { groups } = projectKit(runs, images, []);
    const labels = groups[0]!.results.flatMap((r) => r.referenceLabels);
    expect(labels.some((label) => label.includes("no longer listed"))).toBe(true);
  });

  /**
   * ⚠ THE ONE FAILURE THE KIT EXISTS TO PREVENT.
   *
   * The map used to be keyed on `hashSignature(template)` — a 32-bit FNV-1a — so
   * two DIFFERENT templates that collide would share a group and `kitCopyText`
   * would hand over the WRONG one. The templates are in hand at grouping time;
   * keying on the text makes the collision unreachable, and the hash survives
   * only as a React key.
   */
  it("groups on the TEMPLATE TEXT, so a hash collision cannot merge two templates", () => {
    const two = [
      run({ id: "r1", template: "Draw {{product}}" }),
      run({ id: "r2", template: "Paint {{product}}" }),
    ];
    const { groups } = projectKit(
      two,
      [
        view({ id: "a", runId: "r1", verdict: "keep" }),
        view({ id: "b", runId: "r2", verdict: "keep" }),
      ],
      []
    );
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      // Whatever the key is, the text handed to the clipboard is the template
      // that actually produced every result in the group.
      const runIds = new Set(group.results.map((r) => r.runId));
      const expected = two.filter((r) => runIds.has(r.id)).map((r) => r.template);
      expect(new Set(expected)).toEqual(new Set([kitCopyText(group)]));
    }
    // The key is derived, and distinct for distinct text.
    expect(new Set(groups.map((g) => g.templateKey)).size).toBe(2);
  });

  /**
   * ⚠ THE FOURTH STATE. A kept image whose run is missing is COUNTED, not
   * dropped — dropping it silently is how the page came to render "Nothing kept
   * yet" over a bench that HAS kept results.
   */
  it("COUNTS a kept image whose run is missing rather than vanishing it", () => {
    const orphan = projectKit(
      [],
      [view({ id: "a", runId: "gone", verdict: "keep" })],
      []
    );
    expect(orphan.groups).toEqual([]);
    expect(orphan.unresolved).toBe(1);

    const mixed = projectKit(
      [runs[0]!],
      [
        view({ id: "a", runId: "run-1", verdict: "keep" }),
        view({ id: "z", runId: "gone", verdict: "keep" }),
      ],
      references
    );
    expect(mixed.groups).toHaveLength(1);
    expect(mixed.unresolved).toBe(1);
  });

  /**
   * ⚠ T8. The newest-first order and its id tie-break were unasserted —
   * reversing the comparator survived, because every other Kit assertion sorts
   * ids before comparing or uses `.find()`.
   */
  it("orders results NEWEST FIRST, with the id as the tie-break", () => {
    const sameInstant = [
      view({ id: "aaa", runId: "run-1", verdict: "keep", createdAtMs: 1000 }),
      view({ id: "ccc", runId: "run-1", verdict: "keep", createdAtMs: 1000 }),
      view({ id: "bbb", runId: "run-1", verdict: "keep", createdAtMs: 2000 }),
    ];
    const { groups } = projectKit([runs[0]!], sameInstant, references);
    // `bbb` is newest. The two sharing an instant fall back to the id —
    // DESCENDING, matching the newest-first intent — which is what stops the
    // runtime's sort choosing between them differently on every render.
    expect(groups[0]!.results.map((r) => r.imageId)).toEqual(["bbb", "ccc", "aaa"]);
    // …and the order does not depend on the order they arrived in.
    const reversed = projectKit([runs[0]!], [...sameInstant].reverse(), references);
    expect(reversed.groups[0]!.results.map((r) => r.imageId)).toEqual([
      "bbb",
      "ccc",
      "aaa",
    ]);
  });
});

// ── Cells, not rows ──────────────────────────────────────────────────────────

/**
 * RETRY APPENDS A ROW AT THE SAME `(run_id, model_id, cell_ordinal)`.
 *
 * `canRetryCell` explicitly allows retrying a `done` cell for a better variant,
 * so the more a model is ITERATED ON, the worse a row count makes it look — and
 * the inverse abuse, retrying until one lands and judging only the winner, is
 * equally invisible to one.
 */
describe("the rate counts CELLS, and the iteration is reported beside it", () => {
  const threeAttempts = [
    // One cell. Three attempts. The reviewer kept the third.
    image({ id: "a1", cellOrdinal: 0, createdAtMs: 1000, state: "done", verdict: "reject" }),
    image({ id: "a2", cellOrdinal: 0, createdAtMs: 2000, state: "done", verdict: "reject" }),
    image({ id: "a3", cellOrdinal: 0, createdAtMs: 3000, state: "done", verdict: "keep" }),
  ];

  /**
   * ⚠ THE MUTATION TARGET. Count rows instead of the latest attempt per cell and
   * this reddens: the rate falls to 1/3 for a cell the reviewer considers a
   * success, and a model gets worse every time somebody tries harder on it.
   */
  it("three attempts at ONE cell, one kept, is ONE cell kept — 100%, not 33%", () => {
    const stats = perModelStats(threeAttempts, NOW)[0]!;
    expect(stats.attempts).toBe(3);
    expect(stats.cells).toBe(1);
    expect(stats.scoredCells).toBe(1);
    expect(stats.keeps).toBe(1);
    expect(stats.rejects).toBe(0);
    expect(stats.keepRate).toBe(1);
    expect(stats.keepRate).not.toBeCloseTo(1 / 3);
  });

  it("reports attempts per cell, so iteration is VISIBLE rather than penalised", () => {
    expect(perModelStats(threeAttempts, NOW)[0]!.attemptsPerCell).toBeCloseTo(3);
    expect(
      perModelStats([image({ id: "solo", cellOrdinal: 0 })], NOW)[0]!.attemptsPerCell
    ).toBe(1);
  });

  it("the inverse abuse is visible too: retry until one lands, judge only the winner", () => {
    const churn = [
      image({ id: "b1", cellOrdinal: 0, createdAtMs: 1000, state: "done", verdict: null }),
      image({ id: "b2", cellOrdinal: 0, createdAtMs: 2000, state: "done", verdict: null }),
      image({ id: "b3", cellOrdinal: 0, createdAtMs: 3000, state: "done", verdict: "keep" }),
    ];
    const stats = perModelStats(churn, NOW)[0]!;
    // The rate is honest — one cell, kept — but three attempts were paid for and
    // the caption says so.
    expect(stats.keepRate).toBe(1);
    expect(stats.attemptsPerCell).toBeCloseTo(3);
  });

  /**
   * ⚠ THE SAME `created_at`, WHICH IS THE NORMAL CASE. The migration states every
   * cell of one run shares it byte-for-byte (one transaction), which is why the
   * comparator has an id tie-break at all.
   */
  it("breaks a created_at tie by id rather than leaving it to the runtime", () => {
    const tied = [
      image({ id: "aaa", cellOrdinal: 0, createdAtMs: 5000, state: "done", verdict: "reject" }),
      image({ id: "zzz", cellOrdinal: 0, createdAtMs: 5000, state: "done", verdict: "keep" }),
    ];
    const forwards = latestScoredPerCell(tied);
    const backwards = latestScoredPerCell([...tied].reverse());
    expect(forwards.map((r) => r.id)).toEqual(["zzz"]);
    expect(backwards.map((r) => r.id)).toEqual(["zzz"]);
  });

  /**
   * "LATEST DONE", not "latest". A cell whose newest attempt timed out but whose
   * previous attempt produced a kept image is still a cell the model delivered —
   * letting one of OUR timeouts erase a verdict is the excluded-failure bug in a
   * different hat.
   */
  it("takes the latest DONE attempt, so a later timeout cannot erase a verdict", () => {
    const rows = [
      image({ id: "ok", cellOrdinal: 0, createdAtMs: 1000, state: "done", verdict: "keep" }),
      image({
        id: "late",
        cellOrdinal: 0,
        createdAtMs: 2000,
        state: "failed",
        failureReason: "timeout",
        storageKey: null,
      }),
    ];
    expect(latestScoredPerCell(rows).map((r) => r.id)).toEqual(["ok"]);
    const stats = perModelStats(rows, NOW)[0]!;
    expect(stats.keeps).toBe(1);
    expect(stats.keepRate).toBe(1);
    expect(stats.timeouts).toBe(1);
  });

  it("keys the cell on the RUN too — the same ordinal in two runs is two cells", () => {
    const twoRuns = [
      image({ id: "x", runId: "run-1", cellOrdinal: 0, state: "done", verdict: "keep" }),
      image({ id: "y", runId: "run-2", cellOrdinal: 0, state: "done", verdict: "reject" }),
    ];
    expect(groupCells(twoRuns)).toHaveLength(2);
    const stats = perModelStats(twoRuns, NOW)[0]!;
    expect(stats.cells).toBe(2);
    expect(stats.keepRate).toBeCloseTo(0.5);
  });

  /**
   * ⚠ THE ACCESSIBILITY DEFECT, AS A RULE. Two attempts at one cell rendered
   * with identical headings and identical `aria-label`s — different pictures,
   * independent Keep buttons, indistinguishable names.
   */
  it("indexes attempts within a cell, OLDEST FIRST, so two cards cannot share a name", () => {
    const indexes = attemptIndexes(threeAttempts);
    expect(indexes.get("a1")).toEqual({ index: 1, of: 3 });
    expect(indexes.get("a2")).toEqual({ index: 2, of: 3 });
    expect(indexes.get("a3")).toEqual({ index: 3, of: 3 });
    // A cell with one attempt is "1 of 1" — the surface suppresses the suffix.
    expect(attemptIndexes([image({ id: "solo" })]).get("solo")).toEqual({
      index: 1,
      of: 1,
    });
  });
});

// ── The image cap ────────────────────────────────────────────────────────────

/**
 * ⚠ A FLAT CAP AGAINST A SETTABLE LIMIT DOES NOT "TRUNCATE" — IT DELETES RUNS.
 *
 * `IMAGE_PAGE_LIMIT = 1000` with a run limit settable to 200 (200 × 12 = 2400)
 * returned ZERO images for the oldest runs; `filterHistory`'s withImages rule
 * then pruned them, and they vanished from a page whose own copy says "History is
 * complete by design — nothing is ever pruned". Asking for MORE runs showed
 * FEWER.
 */
/**
 * ⚠ THE CAP CUTS THE OLDEST RUN MID-RUN, AND A PARTIAL RUN IS THE WORST OUTCOME.
 *
 * `IMAGE_LAB_RETRY_HEADROOM = 2` is a BUDGET, not a guarantee — retry is
 * unbounded, so a cell retried five times spends another run's allowance. With
 * the read ordered by recency, the row the cap cuts is always in the oldest run
 * it reached, and that run's keep rate, attempts-per-cell and cost would all be
 * computed over a fragment with nothing on the page saying so.
 */
describe("dropPartialOldestRun", () => {
  const img = (id: string, runId: string): HistoryImageRow => ({
    id,
    runId,
    modelId: "gpt-image-2",
    cellOrdinal: 0,
    state: "done",
    attemptedAtMs: 1,
    createdAtMs: 1,
    failureReason: null,
    failureDetail: null,
    storageKey: `k/${id}`,
    billed: true,
    resolvedPrompt: "A bright panel.",
    promptDerived: false,
    costEstimatedUsd: 0.05,
    costReportedUsd: null,
    verdict: "keep",
    verdictAtMs: 2,
    verdictNote: "",
  });

  it("changes NOTHING when the read did not hit the cap", () => {
    const images = [img("a", "r1"), img("b", "r2")];
    const out = dropPartialOldestRun(images, false);
    expect(out.images).toEqual(images);
    expect(out.droppedRunIds).toEqual([]);
  });

  it("drops the OLDEST run WHOLE when truncated — recency order puts it last", () => {
    const images = [img("a", "r1"), img("b", "r1"), img("c", "r2")];
    const out = dropPartialOldestRun(images, true);
    expect(out.droppedRunIds).toEqual(["r2"]);
    expect(out.images.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("drops EVERY row of that run, not just the ones past the cut", () => {
    const images = [img("a", "r1"), img("b", "r2"), img("c", "r2"), img("d", "r2")];
    const out = dropPartialOldestRun(images, true);
    expect(out.images.map((i) => i.runId)).toEqual(["r1"]);
  });

  it("KEEPS a lone partial run rather than emptying the page", () => {
    // A partial single run behind a truncation banner beats a blank screen.
    const images = [img("a", "r1"), img("b", "r1")];
    const out = dropPartialOldestRun(images, true);
    expect(out.images).toEqual(images);
    expect(out.droppedRunIds).toEqual([]);
  });

  it("tolerates an empty read", () => {
    expect(dropPartialOldestRun([], true)).toEqual({ images: [], droppedRunIds: [] });
  });
});

describe("the image cap is DERIVED from the run limit", () => {
  it("covers every cell of every run asked for, with retry headroom", () => {
    expect(historyImageCap(IMAGE_LAB_HISTORY_RUN_LIMIT)).toBe(
      IMAGE_LAB_HISTORY_RUN_LIMIT * IMAGE_LAB_MAX_CELLS_PER_RUN * IMAGE_LAB_RETRY_HEADROOM
    );
    // The case that lost whole runs: 200 runs × 12 cells is already 2400 rows,
    // more than double the old flat 1000.
    expect(historyImageCap(IMAGE_LAB_HISTORY_MAX_LIMIT)).toBeGreaterThan(
      IMAGE_LAB_HISTORY_MAX_LIMIT * IMAGE_LAB_MAX_CELLS_PER_RUN
    );
    expect(historyImageCap(IMAGE_LAB_HISTORY_MAX_LIMIT)).toBeGreaterThan(1000);
  });

  it("never returns zero, and never exceeds the ceiling the parser enforces", () => {
    expect(historyImageCap(0)).toBeGreaterThan(0);
    expect(historyImageCap(-5)).toBeGreaterThan(0);
    expect(historyImageCap(10_000)).toBe(historyImageCap(IMAGE_LAB_HISTORY_MAX_LIMIT));
  });
});

// ── Which population produced the number ─────────────────────────────────────

/**
 * ⚠ THE STATS ARE COMPUTED OVER THE FILTERED SET AND USED TO BE RENDERED WITH NO
 * FILTER BESIDE THEM.
 *
 * `history-core`'s own comment claimed "the copy names the filter beside the
 * stats so the reader always knows which population produced the number" — and
 * `filter` was never passed to the stats block at all. `?verdict=keep` rendered
 * "100% keep rate" on every model card and `?verdict=reject` rendered "0%", both
 * screenshot-able and both indistinguishable from an unfiltered page.
 */
describe("a filtered number says so", () => {
  it("describes NO population when nothing is filtered", () => {
    expect(describeStatsPopulation(EMPTY_HISTORY_FILTER)).toBeNull();
  });

  it("names every applied term when anything is", () => {
    const sentence = describeStatsPopulation(
      filter({
        modelIds: ["gpt-image-2"],
        verdict: "keep",
        drillTags: ["consistency"],
        referenceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      })
    );
    expect(sentence).not.toBeNull();
    expect(sentence).toContain("gpt-image-2");
    expect(sentence).toContain("consistency");
    expect(sentence).toContain(IMAGE_LAB_EVIDENCE_COPY.filters.verdictOptions.keep);
    expect(sentence).toContain("1 reference image");
  });

  /**
   * ⚠ AND UNDER A VERDICT FILTER THE RATE IS NOT RENDERED AT ALL. Over
   * `verdict=keep` the rate is a RESTATEMENT OF THE FILTER — necessarily 100% —
   * not a measurement of anything.
   */
  it("suppresses the keep rate entirely when the verdict filter is applied", () => {
    expect(keepRateIsMeaningful(EMPTY_HISTORY_FILTER)).toBe(true);
    expect(keepRateIsMeaningful(filter({ modelIds: ["gpt-image-2"] }))).toBe(true);
    for (const verdict of ["keep", "reject", "unjudged"] as const) {
      expect(keepRateIsMeaningful(filter({ verdict })), verdict).toBe(false);
    }
  });

  it("the tautology is REAL — which is why the rate is suppressed rather than shown", () => {
    // Filtering to keeps and computing the rate over the result is 100% by
    // construction, for every model, always.
    const keptOnly = [
      image({ id: "a", cellOrdinal: 0, state: "done", verdict: "keep" }),
      image({ id: "b", cellOrdinal: 1, state: "done", verdict: "keep" }),
    ];
    expect(perModelStats(keptOnly, NOW)[0]!.keepRate).toBe(1);
    expect(keepRateIsMeaningful(filter({ verdict: "keep" }))).toBe(false);
  });
});

// ── The applied-filter chips ─────────────────────────────────────────────────

/**
 * ⚠ THE PARSER'S DOCBLOCK JUSTIFIED ITS SILENT DROPS BY POINTING AT CHIPS THAT
 * DID NOT EXIST — `historyFilterToQuery` had NO CALLER anywhere in the tree.
 */
describe("the applied filter is rendered back, with a link that drops each term", () => {
  const sheet = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("has no chips for an untouched filter", () => {
    expect(historyFilterChips(EMPTY_HISTORY_FILTER)).toEqual([]);
  });

  it("emits ONE chip per applied value, including each of two references", () => {
    const chips = historyFilterChips(filter({ referenceIds: [sheet, other] }));
    expect(chips).toHaveLength(2);
    expect(new Set(chips.map((c) => c.key))).toEqual(
      new Set([`ref:${sheet}`, `ref:${other}`])
    );
  });

  it("each chip's link drops ONLY its own term", () => {
    const applied = filter({
      modelIds: ["gpt-image-2"],
      verdict: "keep",
      drillTags: ["style"],
      referenceIds: [sheet, other],
    });
    for (const chip of historyFilterChips(applied)) {
      const dropped = parseHistoryFilter(
        Object.fromEntries(
          [...new URLSearchParams(chip.dropQuery.slice(1)).entries()].map(([k]) => [
            k,
            new URLSearchParams(chip.dropQuery.slice(1)).getAll(k),
          ])
        )
      );
      // Exactly one term less than what was applied.
      const before =
        applied.modelIds.length +
        applied.drillTags.length +
        applied.referenceIds.length +
        1;
      const after =
        dropped.modelIds.length +
        dropped.drillTags.length +
        dropped.referenceIds.length +
        (dropped.verdict === "any" ? 0 : 1);
      expect(after, chip.key).toBe(before - 1);
    }
  });

  it("names a reference by its label, and falls back to its id rather than dropping it", () => {
    const labelled = historyFilterChips(filter({ referenceIds: [sheet] }), () => "Hero sheet");
    expect(labelled[0]!.label).toContain("Hero sheet");
    const unlabelled = historyFilterChips(filter({ referenceIds: [sheet] }));
    expect(unlabelled[0]!.label).toContain(sheet.slice(0, 8));
  });
});

// ── The optimistic paint, as a pure reducer ──────────────────────────────────

/**
 * ⚠ MOVED OUT OF THE COMPONENT SO IT CAN BE TESTED AT ALL.
 *
 * This repo runs `environment: "node"` with no jsdom, and the override lifecycle
 * is where two real defects lived: the entry was NEVER CLEARED ON SUCCESS (so a
 * card could contradict the stats block on the same screen indefinitely), and a
 * failed NOTE save rolled back a whole `{verdict, note}` snapshot, pinning the
 * card's VERDICT to a stale value. Notes are not in this state at all now.
 */
describe("the optimistic verdict override: paint, settle, roll back", () => {
  const card = (over: Partial<HistoryImageView> = {}): HistoryImageView => {
    const { storageKey, ...rest } = image();
    void storageKey;
    return { ...rest, hasObject: true, signedUrl: null, ...over };
  };

  it("renders the server's value when nothing has been painted", () => {
    expect(resolveVerdict(EMPTY_OVERRIDES, card({ verdict: "reject" }))).toBe("reject");
    expect(heldOverride(EMPTY_OVERRIDES, "img-1")).toBeNull();
  });

  it("paints immediately", () => {
    const painted = overrideReducer(EMPTY_OVERRIDES, {
      kind: "paint",
      imageId: "img-1",
      override: { verdict: "keep", basedOnVerdictAtMs: null },
    });
    expect(resolveVerdict(painted, card({ verdict: null }))).toBe("keep");
  });

  /**
   * ⚠ THE ENTRY IS SETTLED ON SUCCESS. Leaving the unconfirmed paint standing is
   * what let a card disagree with the stats block on the same screen forever.
   */
  it("settles to the CONFIRMED value carrying the server's own stamp", () => {
    const painted = overrideReducer(EMPTY_OVERRIDES, {
      kind: "paint",
      imageId: "img-1",
      override: { verdict: "keep", basedOnVerdictAtMs: null },
    });
    const settled = overrideReducer(painted, {
      kind: "settle",
      imageId: "img-1",
      verdict: "keep",
      verdictAtMs: NOW,
    });
    expect(settled["img-1"]).toEqual({ verdict: "keep", basedOnVerdictAtMs: NOW });
    // The row the server rendered still says null; the confirmed paint wins.
    expect(resolveVerdict(settled, card({ verdict: null, verdictAtMs: null }))).toBe("keep");
    // …and once the server catches up, the two simply agree.
    expect(resolveVerdict(settled, card({ verdict: "keep", verdictAtMs: NOW }))).toBe("keep");
  });

  it("rolls back to EXACTLY the previous paint, and to NOTHING when there was none", () => {
    const first = overrideReducer(EMPTY_OVERRIDES, {
      kind: "paint",
      imageId: "img-1",
      override: { verdict: "keep", basedOnVerdictAtMs: null },
    });
    const second = overrideReducer(first, {
      kind: "paint",
      imageId: "img-1",
      override: { verdict: "reject", basedOnVerdictAtMs: null },
    });
    const rolled = overrideReducer(second, {
      kind: "rollback",
      imageId: "img-1",
      previous: first["img-1"]!,
    });
    expect(resolveVerdict(rolled, card({ verdict: null }))).toBe("keep");

    // No previous paint: the entry is DELETED, not set to a guessed value —
    // "there was no override" is what lets the next server render through.
    const cleared = overrideReducer(first, {
      kind: "rollback",
      imageId: "img-1",
      previous: null,
    });
    expect("img-1" in cleared).toBe(false);
    expect(resolveVerdict(cleared, card({ verdict: "reject" }))).toBe("reject");
  });

  /**
   * ⚠ KEYED BY `imageId + verdictAtMs`, so a NEWER SERVER STAMP SUPERSEDES a
   * stale local paint. Last-write-wins is the accepted v1 model, and a second
   * reviewer's newer answer must not be hidden behind this tab's older one.
   */
  it("a newer server stamp supersedes a stale paint", () => {
    const painted = overrideReducer(EMPTY_OVERRIDES, {
      kind: "paint",
      imageId: "img-1",
      override: { verdict: "keep", basedOnVerdictAtMs: NOW },
    });
    // Same stamp: our paint is still the freshest thing anyone knows.
    expect(resolveVerdict(painted, card({ verdict: "reject", verdictAtMs: NOW }))).toBe("keep");
    // NEWER stamp: somebody else answered after us.
    expect(
      resolveVerdict(painted, card({ verdict: "reject", verdictAtMs: NOW + 1 }))
    ).toBe("reject");
    // OLDER stamp: our paint stands.
    expect(
      resolveVerdict(painted, card({ verdict: "reject", verdictAtMs: NOW - 1 }))
    ).toBe("keep");
  });

  it("a paint made against an UNSTAMPED row is superseded by any stamp at all", () => {
    const held = { verdict: "keep" as const, basedOnVerdictAtMs: null };
    expect(isOverrideSuperseded(held, { verdictAtMs: null })).toBe(false);
    expect(isOverrideSuperseded(held, { verdictAtMs: NOW })).toBe(true);
  });

  it("touches only the image it names", () => {
    const two = overrideReducer(
      overrideReducer(EMPTY_OVERRIDES, {
        kind: "paint",
        imageId: "a",
        override: { verdict: "keep", basedOnVerdictAtMs: null },
      }),
      { kind: "paint", imageId: "b", override: { verdict: "reject", basedOnVerdictAtMs: null } }
    );
    const rolled = overrideReducer(two, { kind: "rollback", imageId: "b", previous: null });
    expect(resolveVerdict(rolled, card({ id: "a", verdict: null }))).toBe("keep");
    expect("b" in rolled).toBe(false);
  });
});

// ── Component-owned logic, pulled out of the components ──────────────────────

/**
 * ⚠ THESE ARE REAL BRANCHES `environment: "node"` CANNOT REACH INSIDE A `.tsx`.
 *
 * The alternative was the anti-pattern Unit 4's review killed: source scans over
 * a component, nine of which survived deleting the component they claimed to
 * test. So the branches moved here instead.
 */
describe("what the surfaces render, decided here", () => {
  it("reports a clipboard failure rather than swallowing it", () => {
    expect(describeCopyOutcome(true)).toBe(IMAGE_LAB_EVIDENCE_COPY.kit.copied);
    // The insecure-origin / permission-denied path — a button that silently does
    // nothing teaches a reviewer that the Kit is broken.
    expect(describeCopyOutcome(false)).toBe(IMAGE_LAB_EVIDENCE_COPY.kit.copyFailed);
    expect(describeCopyOutcome(false)).not.toBe(describeCopyOutcome(true));
  });

  it("renders only slot values that were actually given", () => {
    expect(filledSlotEntries({ product: "kites", oneLiner: "" })).toEqual([
      ["product", "kites"],
    ]);
    expect(filledSlotEntries({})).toEqual([]);
    // A cleared field is not a value: "product: " with nothing after it reads as
    // a value that IS empty rather than one that was never given.
    expect(filledSlotEntries({ product: "" })).toEqual([]);
  });

  /** The client half of the `projectImageView` contract — three cases, and
   *  collapsing any two loses the distinction the projection carries. */
  it("distinguishes an image, a failed mint, and no bytes at all", () => {
    expect(thumbnailState({ signedUrl: "https://s/x", hasObject: true })).toBe("image");
    // Bytes exist, the mint failed: still evidence, still judgeable.
    expect(thumbnailState({ signedUrl: null, hasObject: true })).toBe("unavailable");
    expect(thumbnailState({ signedUrl: null, hasObject: false })).toBe("missing");
    // Each has its own words.
    const copy = IMAGE_LAB_EVIDENCE_COPY.kit.thumbnail;
    expect(copy.unavailable).not.toBe(copy.missing);
  });
});
