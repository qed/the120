import { describe, expect, it } from "vitest";
import {
  buildGrid,
  canRetryCell,
  cellAttemptName,
  cellRenderState,
  decideChildTextGate,
  decideGenerateAffordance,
  decideRunComposition,
  defaultPromptMode,
  describeAttemptLine,
  describeAttemptNumbering,
  describeCellProgress,
  describeCompositionRefusal,
  describeGenerateOutcome,
  describeUnverified,
  estimateRunCostUsd,
  formatGenerationBreadcrumb,
  formatUsd,
  generateCellRateLimitKey,
  IMAGE_LAB_CLIENT_AWAIT_MS,
  IMAGE_LAB_COMPOSER_SECTIONS,
  IMAGE_LAB_GENERATE_RATE_LIMIT,
  IMAGE_LAB_MAX_CELLS_PER_RUN,
  IMAGE_LAB_MAX_IMAGE_COUNT,
  IMAGE_LAB_RESOLVED_MAX_CHARS,
  IMAGE_LAB_RUN_COPY,
  maxFanCostUsd,
  previewPromptText,
  previewRows,
  promptModeFor,
  resolvePrompt,
  runObjectKey,
  type CellRow,
} from "../run-rules";
import {
  IMAGE_LAB_ROUTE_BUDGET_MS,
  IMAGE_LAB_MODELS,
  unverifiedItems,
} from "../model-registry";
import { IMAGE_LAB_STALE_AFTER_MS } from "../image-lab-rules";
import {
  allCategoryPrompts,
  isCategoryDerivedPrompt,
} from "../category-prompt-rules";

/**
 * The run flow's PURE decisions (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 5).
 *
 * Everything the composer, the grid and the paid route decide lives in
 * `run-rules.ts` precisely so it can be asserted here: the suite is
 * `environment: "node"` with NO jsdom, and Unit 4's review demonstrated that
 * source-scan tests over a component survive deleting the behaviour they claim to
 * cover — nine of them did, at once.
 */

const cell = (over: Partial<CellRow> = {}): CellRow => ({
  id: "img-1",
  runId: "run-1",
  modelId: "gpt-image-2",
  cellOrdinal: 0,
  state: "requested",
  attemptedAtMs: null,
  createdAtMs: 1_000,
  resolvedPrompt: "A bright panel.",
  promptDerived: false,
  failureReason: null,
  failureDetail: null,
  storageKey: null,
  billed: false,
  costEstimatedUsd: null,
  costReportedUsd: null,
  ...over,
});

// ── Slot resolution ──────────────────────────────────────────────────────────

describe("resolvePrompt", () => {
  it("substitutes filled slots and reports nothing unfilled", () => {
    const out = resolvePrompt("Draw {{product}} — {{oneLiner}}", {
      product: "sticker packs",
      oneLiner: "stickers that tell your street's story",
    });
    expect(out.text).toBe("Draw sticker packs — stickers that tell your street's story");
    expect(out.unfilled).toEqual([]);
    expect(out.unknown).toEqual([]);
  });

  it("KEEPS THE LITERAL for an unfilled slot and warns about it", () => {
    // Warn-not-block: a deliberate template test is a legitimate run, and
    // blanking the token would make the preview lie about what the vendor saw.
    const out = resolvePrompt("Draw {{product}} for {{sale}}", { product: "cards" });
    expect(out.text).toBe("Draw cards for {{sale}}");
    expect(out.unfilled).toEqual(["sale"]);
  });

  it("treats a whitespace-only value as unfilled", () => {
    const out = resolvePrompt("{{pitch}}", { pitch: "   " });
    expect(out.text).toBe("{{pitch}}");
    expect(out.unfilled).toEqual(["pitch"]);
  });

  it("reports an unknown token without substituting it", () => {
    const out = resolvePrompt("{{product}} and {{whatever}}", { product: "x" });
    expect(out.text).toBe("x and {{whatever}}");
    expect(out.unknown).toEqual(["whatever"]);
  });

  it("does NOT re-expand a slot token that appears inside a slot VALUE", () => {
    // Child-authored free text can contain anything. One pass over the TEMPLATE
    // is the whole rule; a recursive expansion would let a value rewrite itself.
    const out = resolvePrompt("{{product}}", { product: "{{pitch}}", pitch: "boom" });
    expect(out.text).toBe("{{pitch}}");
  });

  it("does not treat `$&` in a value as a replacement pattern", () => {
    const out = resolvePrompt("A {{product}} B", { product: "$& $1" });
    expect(out.text).toBe("A $& $1 B");
  });

  it("survives a template with no slots at all", () => {
    const out = resolvePrompt("just a prompt", {});
    expect(out.text).toBe("just a prompt");
    expect(out.unfilled).toEqual([]);
  });
});

// ── Cell expansion / compare ─────────────────────────────────────────────────

describe("decideRunComposition", () => {
  const base = {
    template: "Draw {{product}}",
    slotValues: { product: "cards" },
    imageCount: 2,
  };

  it("expands cells for exactly the selected models, ordinals per column", () => {
    const decision = decideRunComposition({
      ...base,
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    // The prompt fields are asserted in their own describe below; this test is
    // about the FAN's shape and column order.
    expect(
      decision.cells.map((c) => ({ modelId: c.modelId, cellOrdinal: c.cellOrdinal }))
    ).toEqual([
      { modelId: "gpt-image-2", cellOrdinal: 0 },
      { modelId: "gpt-image-2", cellOrdinal: 1 },
      { modelId: "gemini-3-pro-image", cellOrdinal: 0 },
      { modelId: "gemini-3-pro-image", cellOrdinal: 1 },
    ]);
    // The THIRD registry model is not in the fan at all.
    expect(decision.cells.some((c) => c.modelId === "gemini-3.1-flash-lite-image")).toBe(
      false
    );
    expect(decision.compare).toBe(true);
  });

  it("records a ONE-model selection as a normal run, not a comparison", () => {
    const decision = decideRunComposition({ ...base, modelIds: ["gpt-image-2"] });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.compare).toBe(false);
    expect(decision.cells).toHaveLength(2);
  });

  it("REFUSES zero models", () => {
    const decision = decideRunComposition({ ...base, modelIds: [] });
    expect(decision).toEqual({ ok: false, reason: "no_models" });
  });

  it("refuses an unknown model rather than silently dropping it", () => {
    const decision = decideRunComposition({ ...base, modelIds: ["gpt-image-9"] });
    expect(decision).toEqual({ ok: false, reason: "unknown_model", modelId: "gpt-image-9" });
  });

  it("de-duplicates a doubled model id (which would double that column's bill)", () => {
    const decision = decideRunComposition({
      ...base,
      imageCount: 1,
      modelIds: ["gpt-image-2", "gpt-image-2"],
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.cells).toHaveLength(1);
    expect(decision.compare).toBe(false);
  });

  it.each([0, -1, 1.5, IMAGE_LAB_MAX_IMAGE_COUNT + 1])(
    "refuses an image count of %s",
    (count) => {
      const decision = decideRunComposition({
        ...base,
        imageCount: count,
        modelIds: ["gpt-image-2"],
      });
      expect(decision.ok).toBe(false);
    }
  );

  it("refuses an empty template", () => {
    const decision = decideRunComposition({
      ...base,
      template: "   ",
      modelIds: ["gpt-image-2"],
    });
    expect(decision).toEqual({ ok: false, reason: "empty_template" });
  });

  it("refuses a resolved prompt past the column's bound", () => {
    const decision = decideRunComposition({
      template: "{{pitch}}",
      slotValues: { pitch: "x".repeat(IMAGE_LAB_RESOLVED_MAX_CHARS + 1) },
      imageCount: 1,
      modelIds: ["gpt-image-2"],
    });
    expect(decision).toEqual({
      ok: false,
      reason: "prompt_too_long",
      max: IMAGE_LAB_RESOLVED_MAX_CHARS,
    });
  });

  it("the largest legal fan is exactly the derived cell cap", () => {
    const decision = decideRunComposition({
      ...base,
      imageCount: IMAGE_LAB_MAX_IMAGE_COUNT,
      modelIds: IMAGE_LAB_MODELS.map((m) => m.id),
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.cells).toHaveLength(IMAGE_LAB_MAX_CELLS_PER_RUN);
  });

  it("every refusal has copy that names its bound", () => {
    for (const refusal of [
      { ok: false, reason: "no_models" },
      { ok: false, reason: "unknown_model", modelId: "z" },
      { ok: false, reason: "bad_image_count", max: 4 },
      { ok: false, reason: "empty_template" },
      { ok: false, reason: "template_too_long", max: 8000 },
      { ok: false, reason: "prompt_too_long", max: 12000 },
      { ok: false, reason: "too_many_references", max: 16 },
    ] as const) {
      expect(describeCompositionRefusal(refusal).length).toBeGreaterThan(10);
    }
  });
});

// ── Cost ─────────────────────────────────────────────────────────────────────

describe("estimateRunCostUsd", () => {
  it("sums list prices at the registry's default tier", () => {
    const estimate = estimateRunCostUsd([
      { modelId: "gemini-3.1-flash-lite-image", cellOrdinal: 0, promptText: "p", promptDerived: false },
      { modelId: "gemini-3.1-flash-lite-image", cellOrdinal: 1, promptText: "p", promptDerived: false },
    ]);
    expect(estimate.totalUsd).toBeCloseTo(0.0672, 6);
  });

  it("prices the REAL worst fan, computed from the composer's own rules", () => {
    // ⚠ THE OLD FIGURE WAS ARITHMETICALLY IMPOSSIBLE. Two tests pinned 12 ×
    // $0.211 (gpt-image-2 at high) as the ceiling, but `decideRunComposition`
    // caps candidates at 4 PER MODEL — so twelve cells can only ever be 4+4+4
    // across three DIFFERENT models, and quality is not a run setting at all.
    // Computed here rather than asserted, so a fourth model cannot leave a stale
    // number in the evidence.
    const modelIds = IMAGE_LAB_MODELS.map((entry) => entry.id);
    const decision = decideRunComposition({
      template: "Draw {{product}}",
      slotValues: { product: "x" },
      modelIds,
      imageCount: IMAGE_LAB_MAX_IMAGE_COUNT,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.cells).toHaveLength(IMAGE_LAB_MAX_CELLS_PER_RUN);

    const expected =
      IMAGE_LAB_MAX_IMAGE_COUNT * (0.053 + 0.134 + 0.0336); // = $0.88
    expect(maxFanCostUsd(modelIds)).toBeCloseTo(expected, 6);
    expect(maxFanCostUsd(modelIds)).toBeCloseTo(0.8824, 4);
    expect(estimateRunCostUsd(decision.cells).totalUsd).toBeCloseTo(expected, 6);
  });

  it("prices an unknown model at zero rather than throwing", () => {
    // `decideRunComposition` refuses an unknown model long before this, so the
    // branch is defensive only — but a NaN in a money line is worse than a zero.
    expect(estimateRunCostUsd([
      { modelId: "not-a-model", cellOrdinal: 0, promptText: "p", promptDerived: false },
    ]).totalUsd).toBe(0);
  });

  it("formats money the way each model needs to be read", () => {
    expect(formatUsd(2.532)).toBe("$2.53");
    expect(formatUsd(0.0336)).toBe("$0.0336");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

// ── Staleness / grid ─────────────────────────────────────────────────────────

describe("cellRenderState and canRetryCell", () => {
  const now = 10_000_000;

  it("distinguishes requested, pending, stale, done and failed", () => {
    expect(cellRenderState(cell({ createdAtMs: now }), now)).toBe("requested");
    expect(
      cellRenderState(cell({ createdAtMs: now, attemptedAtMs: now }), now)
    ).toBe("pending");
    expect(
      cellRenderState(
        cell({ createdAtMs: now, attemptedAtMs: now - IMAGE_LAB_STALE_AFTER_MS }),
        now
      )
    ).toBe("stale");
    expect(cellRenderState(cell({ state: "done" }), now)).toBe("done");
    expect(cellRenderState(cell({ state: "failed" }), now)).toBe("failed");
  });

  it("ages a NEVER-attempted row from created_at, so a closed tab still goes stale", () => {
    // `now - attemptedAt` is NaN for this row, which reads as "not stale" and
    // leaves the cell un-retryable forever.
    const orphan = cell({ createdAtMs: now - IMAGE_LAB_STALE_AFTER_MS, attemptedAtMs: null });
    expect(cellRenderState(orphan, now)).toBe("stale");
    // ⚠ STALE, BUT NOT RETRYABLE — see `run-rules-surfaces.test.ts`. Retrying a
    // row nothing ever attempted appends a SECOND live `requested` row for one
    // intended image, and both are generatable. Generate the existing row.
    expect(canRetryCell(orphan, now)).toBe(false);
  });

  it("REFUSES retry on a pending cell and allows it once stale", () => {
    const pending = cell({ createdAtMs: now, attemptedAtMs: now - 1_000 });
    expect(canRetryCell(pending, now)).toBe(false);
    expect(canRetryCell(pending, now + IMAGE_LAB_STALE_AFTER_MS)).toBe(true);
  });

  it("allows retry on a finalized cell immediately", () => {
    expect(canRetryCell(cell({ state: "failed", attemptedAtMs: now }), now)).toBe(true);
    expect(canRetryCell(cell({ state: "done", attemptedAtMs: now }), now)).toBe(true);
  });

  it("stale is DERIVED, never a fourth persisted state", () => {
    // A row rendered stale still says `requested` on the row — nothing writes it.
    const row = cell({ createdAtMs: 0, attemptedAtMs: null });
    expect(cellRenderState(row, IMAGE_LAB_STALE_AFTER_MS)).toBe("stale");
    expect(row.state).toBe("requested");
  });
});

/**
 * The grid's LIVE-REGION SENTENCE (Unit 7's keyboard/AT pass, fixed in Unit 5's
 * home because that is where the rule lives).
 *
 * The bench used to wrap `<ResultGrid>` itself in `aria-live="polite"`, so every
 * poll tick re-announced twelve cards. The announcement is now this one sentence,
 * and these assertions are what stop it silently regressing to a census nobody
 * can hold.
 */
/**
 * The ACCESSIBLE NAME of one attempt (Unit 7's AT pass).
 *
 * Unit 6 fixed this on History and left the bench grid with the older half of
 * the same bug: it stacks attempts inside a cell and gave every one of them a
 * byte-identical `alt`. The sentence is one rule now, and both surfaces call it.
 */
describe("cellAttemptName", () => {
  it("is SHORT when a cell has exactly one attempt", () => {
    expect(cellAttemptName("gpt-image-2", 2, { index: 1, of: 1 })).toBe(
      "gpt-image-2 candidate 3"
    );
  });

  it("carries the attempt index once a cell has more than one", () => {
    // Two pictures, two Keep buttons, two different names.
    expect(cellAttemptName("gpt-image-2", 2, { index: 1, of: 2 })).toBe(
      "gpt-image-2 candidate 3, attempt 1 of 2"
    );
    expect(cellAttemptName("gpt-image-2", 2, { index: 2, of: 2 })).toBe(
      "gpt-image-2 candidate 3, attempt 2 of 2"
    );
  });

  it("gives two attempts of the SAME cell DIFFERENT names", () => {
    const a = cellAttemptName("gemini-3-pro-image", 0, { index: 1, of: 2 });
    const b = cellAttemptName("gemini-3-pro-image", 0, { index: 2, of: 2 });
    expect(a).not.toBe(b);
  });

  it("counts the cell ordinal from ONE for a reader", () => {
    expect(cellAttemptName("m", 0, { index: 1, of: 1 })).toContain("candidate 1");
  });
});

describe("describeUnverified — the badge that had no caller", () => {
  it("names every open capability question on an entry", () => {
    // ⚠ `unverifiedItems` claimed to drive "an honest badge on the bench" and was
    // called by nothing. Two of the three launch models are gated by the
    // `personGeneration` allowlist and the third by the reference-carriage
    // question, and either makes a model look worse than it is.
    const entry = IMAGE_LAB_MODELS.find((e) => unverifiedItems(e).length > 0);
    expect(entry, "no model has an open question — has the registry changed?").toBeDefined();
    const line = describeUnverified(entry!);
    for (const item of unverifiedItems(entry!)) expect(line).toContain(item);
    // …and it says why a staff member should care, not just that a flag is set.
    expect(line).toMatch(/rather than the model/);
  });

  it("says NOTHING for a fully verified entry", () => {
    const clean = {
      ...IMAGE_LAB_MODELS[0]!,
      verified: {
        costReporting: { status: "confirmed" as const, note: "" },
        gatewayRoutable: { status: "confirmed" as const, note: "" },
        personGeneration: { status: "confirmed" as const, note: "" },
        referenceImageInput: { status: "confirmed" as const, note: "" },
      },
    };
    expect(describeUnverified(clean)).toBe("");
  });
});

describe("describeAttemptLine — ONE numbering rule, two renderings", () => {
  it("says NOTHING for a single attempt", () => {
    // Which is what makes `cellAttemptName` fall back to the short name and the
    // grid render no line at all.
    expect(describeAttemptLine({ index: 1, of: 1 })).toBe("");
    expect(cellAttemptName("m", 0, { index: 1, of: 1 })).toBe("m candidate 1");
  });

  it("agrees with the ACCESSIBLE NAME, because both derive from one rule", () => {
    // ⚠ THE VISIBLE LINE USED TO BE A SECOND, HAND-BUILT COPY of the numbering,
    // written inline in `ResultGrid`, absent from the COPY constant (contrary to
    // that file's convention) and untested.
    for (const attempt of [
      { index: 1, of: 2 },
      { index: 2, of: 2 },
      { index: 3, of: 5 },
    ]) {
      expect(cellAttemptName("m", 0, attempt)).toContain(
        describeAttemptNumbering(attempt)
      );
      expect(describeAttemptLine(attempt)).toContain(describeAttemptNumbering(attempt));
    }
  });

  it("marks an EARLIER attempt on the visible line only", () => {
    // The stack is newest-first, so "earlier" is POSITIONAL — it belongs on the
    // printed line and not in a name a reader hears out of context.
    expect(describeAttemptLine({ index: 2, of: 2 })).toBe("attempt 2 of 2");
    expect(describeAttemptLine({ index: 1, of: 2 })).toBe("attempt 1 of 2 (earlier)");
    expect(cellAttemptName("m", 0, { index: 1, of: 2 })).not.toContain("earlier");
  });

  it("takes its strings from the COPY constant, like everything else here", () => {
    expect(describeAttemptNumbering({ index: 2, of: 3 })).toBe(
      IMAGE_LAB_RUN_COPY.grid.attemptOrdinal(2, 3)
    );
    expect(describeAttemptLine({ index: 1, of: 3 })).toContain(
      IMAGE_LAB_RUN_COPY.grid.attemptEarlier
    );
  });
});

describe("describeCellProgress", () => {
  const now = 10_000_000;

  it("says NOTHING for an empty grid", () => {
    // An empty grid is not "0 attempts" — it is a surface with no news.
    expect(describeCellProgress([], now)).toBe("");
  });

  it("names only the buckets that have rows, in a fixed order", () => {
    const cells = [
      cell({ id: "a", state: "done" }),
      cell({ id: "b", state: "done" }),
      cell({ id: "c", state: "failed" }),
      cell({ id: "d", createdAtMs: now, attemptedAtMs: now }),
    ];
    expect(describeCellProgress(cells, now)).toBe(
      "4 attempts: 2 done, 1 failed, 1 generating."
    );
  });

  it("counts ATTEMPT ROWS, not cells — a retried cell contributes two", () => {
    // Two rows at the same cell ordinal: the reader tabbing the cards sees two
    // cards, so the sentence must say two.
    const cells = [
      cell({ id: "a", cellOrdinal: 0, state: "failed" }),
      cell({ id: "b", cellOrdinal: 0, state: "done" }),
    ];
    expect(describeCellProgress(cells, now)).toBe("2 attempts: 1 done, 1 failed.");
  });

  it("uses the DERIVED render state, so a stranded row is announced as stale", () => {
    const orphan = cell({
      id: "a",
      createdAtMs: now - IMAGE_LAB_STALE_AFTER_MS,
      attemptedAtMs: null,
    });
    expect(describeCellProgress([orphan], now)).toBe(
      "1 attempt: 1 with no answer yet."
    );
  });

  it("is STABLE across two reads of an unchanged grid — an unchanged poll is silent", () => {
    // React only mutates the text node when the string differs, so equality here
    // is what makes a three-second poll stop announcing.
    const cells = [cell({ id: "a", state: "done" }), cell({ id: "b", state: "failed" })];
    expect(describeCellProgress(cells, now)).toBe(describeCellProgress(cells, now + 1));
  });

  it("singularizes one attempt", () => {
    expect(describeCellProgress([cell({ id: "a", state: "done" })], now)).toBe(
      "1 attempt: 1 done."
    );
  });
});

describe("buildGrid", () => {
  it("stacks retries within their cell, newest first, with a count", () => {
    const first = cell({ id: "a", createdAtMs: 100, state: "failed" });
    const retry = cell({ id: "b", createdAtMs: 200 });
    const grid = buildGrid([first, retry], ["gpt-image-2"]);
    expect(grid).toHaveLength(1);
    expect(grid[0]!.attemptCount).toBe(2);
    expect(grid[0]!.attempts.map((a) => a.id)).toEqual(["b", "a"]);
  });

  it("breaks a created_at TIE deterministically (every cell of a run shares one)", () => {
    // Postgres now() is the transaction timestamp: a comparator reading only the
    // timestamp hands the order to the runtime, and the grid re-flows on a
    // re-render with no data change.
    const a = cell({ id: "aaa", createdAtMs: 100 });
    const b = cell({ id: "bbb", createdAtMs: 100 });
    expect(buildGrid([a, b], ["gpt-image-2"])[0]!.attempts.map((x) => x.id)).toEqual([
      "bbb",
      "aaa",
    ]);
    expect(buildGrid([b, a], ["gpt-image-2"])[0]!.attempts.map((x) => x.id)).toEqual([
      "bbb",
      "aaa",
    ]);
  });

  it("keeps the RUN's model order, so a wholly-failed model keeps its column", () => {
    const rows = [
      cell({ id: "g", modelId: "gemini-3-pro-image" }),
      cell({ id: "o", modelId: "gpt-image-2" }),
    ];
    const grid = buildGrid(rows, ["gpt-image-2", "gemini-3-pro-image"]);
    expect(grid.map((c) => c.modelId)).toEqual(["gpt-image-2", "gemini-3-pro-image"]);
  });
});

// ── The composer's decisions ─────────────────────────────────────────────────

describe("decideGenerateAffordance", () => {
  const okDecision = decideRunComposition({
    template: "Draw {{product}} and {{sale}}",
    slotValues: { product: "cards" },
    modelIds: ["gpt-image-2"],
    imageCount: 1,
  });

  it("WARNS about an unfilled slot but leaves Generate enabled", () => {
    const affordance = decideGenerateAffordance({
      decision: okDecision,
      submitting: false,
      live: true,
    });
    expect(affordance.enabled).toBe(true);
    expect(affordance.blocker).toBeNull();
    expect(affordance.warnings.join(" ")).toContain("sale");
  });

  it("BLOCKS on a refusal and says which", () => {
    const affordance = decideGenerateAffordance({
      decision: { ok: false, reason: "no_models" },
      submitting: false,
      live: true,
    });
    expect(affordance.enabled).toBe(false);
    expect(affordance.blocker).toBe(IMAGE_LAB_RUN_COPY.refusals.noModels);
  });

  it("warns when generation is switched off, without blocking the compose", () => {
    const affordance = decideGenerateAffordance({
      decision: okDecision,
      submitting: false,
      live: false,
    });
    expect(affordance.enabled).toBe(true);
    expect(affordance.warnings.join(" ")).toContain("IMAGE_LAB_LIVE");
  });

  it("disables itself while a compose is in flight", () => {
    expect(
      decideGenerateAffordance({ decision: okDecision, submitting: true, live: true }).enabled
    ).toBe(false);
  });
});

describe("the composer's section order", () => {
  it("puts the resolved-prompt preview BEFORE every irreversible control", () => {
    // The preview is the last human check before child-authored text leaves for a
    // vendor, so it cannot sit below the button that sends it.
    const order = IMAGE_LAB_COMPOSER_SECTIONS;
    expect(order.indexOf("template")).toBeLessThan(order.indexOf("slots"));
    expect(order.indexOf("slots")).toBeLessThan(order.indexOf("preview"));
    expect(order.indexOf("preview")).toBeLessThan(order.indexOf("references"));
    expect(order.indexOf("references")).toBeLessThan(order.indexOf("models"));
    expect(order.indexOf("models")).toBeLessThan(order.indexOf("generate"));
    expect(order.indexOf("generate")).toBeLessThan(order.indexOf("results"));
  });
});

// ── Storage keys, budgets, breadcrumbs ───────────────────────────────────────

describe("runObjectKey", () => {
  it("is deterministic, prefixed, and carries no extension", () => {
    expect(runObjectKey("run-1", "img-9")).toBe("runs/run-1/img-9");
    expect(runObjectKey("run-1", "img-9")).toBe(runObjectKey("run-1", "img-9"));
    expect(runObjectKey("run-1", "img-9")).not.toMatch(/\.(png|jpe?g|webp)$/);
  });

  it("never collides with the reference prefix", () => {
    expect(runObjectKey("r", "i").startsWith("references/")).toBe(false);
  });
});

describe("the two budgets that must not be inverted", () => {
  it("the CLIENT waits longer than the SERVER's whole function budget", () => {
    // Invert this and duplicate spend becomes the designed behaviour for the
    // slowest model: the browser gives up, the server keeps going, the vendor
    // bills, and the staff member retries a cell that says "failed".
    expect(IMAGE_LAB_CLIENT_AWAIT_MS).toBeGreaterThan(IMAGE_LAB_ROUTE_BUDGET_MS);
  });

  it("the cooldown burst allows a FULL 12-cell compare fan, twice over", () => {
    expect(IMAGE_LAB_GENERATE_RATE_LIMIT.limit).toBeGreaterThanOrEqual(
      IMAGE_LAB_MAX_CELLS_PER_RUN
    );
    expect(IMAGE_LAB_GENERATE_RATE_LIMIT.limit).toBeGreaterThan(
      2 * IMAGE_LAB_MAX_CELLS_PER_RUN
    );
  });

  it("keys the cooldown per staff member, so one runaway tab cannot lock a colleague out", () => {
    expect(generateCellRateLimitKey("a")).not.toBe(generateCellRateLimitKey("b"));
    expect(generateCellRateLimitKey("a")).toContain("a");
  });
});

describe("formatGenerationBreadcrumb", () => {
  it("carries who/when/which/how-many and the DB-content boolean", () => {
    const line = formatGenerationBreadcrumb({
      staffId: "staff-1",
      atIso: "2026-08-05T00:00:00.000Z",
      modelId: "gpt-image-2",
      cellCount: 12,
      usedDbContent: true,
      outcome: "done",
      billed: true,
    });
    expect(line).toContain("staff=staff-1");
    expect(line).toContain("model=gpt-image-2");
    expect(line).toContain("runCells=12");
    expect(line).toContain("dbContent=true");
  });

  it("has no field a prompt, a slot value or a child field could travel in", () => {
    // The TYPE is the enforcement — this asserts the rendered line as well, so a
    // future field added to the type is caught by a human-readable failure.
    const line = formatGenerationBreadcrumb({
      staffId: "s",
      atIso: "2026-08-05T00:00:00.000Z",
      modelId: "m",
      cellCount: 1,
      usedDbContent: false,
      outcome: "done",
      billed: false,
    });
    expect(line).not.toMatch(/prompt|slot|template|child|pitch/i);
  });
});

describe("outcome copy", () => {
  it("says something actionable for every member of the closed set", () => {
    const outcomes = [
      { kind: "done", imageId: "i" },
      { kind: "failed", imageId: "i", reason: "safety_blocked", detail: "d" },
      { kind: "not_found" },
      { kind: "not_admitted" },
      { kind: "already_finalized", state: "done" },
      { kind: "retry_refused", retryAfterMs: 60_000 },
      { kind: "run_purged" },
      { kind: "cooldown", retryAfterMs: 60_000 },
      { kind: "invalid_input" },
      { kind: "unavailable" },
    ] as const;
    for (const outcome of outcomes) {
      expect(describeGenerateOutcome(outcome).length).toBeGreaterThan(3);
    }
  });

  it("tells staff a late success can still land beside a retry", () => {
    // `failed → done` is a real transition when a killed function's vendor call
    // completes afterwards. Staff must be told before they press Retry.
    expect(IMAGE_LAB_RUN_COPY.grid.retryWarning).toMatch(/late|still/i);
    expect(IMAGE_LAB_RUN_COPY.grid.retryWarning).toMatch(/billed/i);
  });
});

// ── The prompt choice, and the gate ──────────────────────────────────────────

/**
 * ⚠ THE ASYMMETRY IS THE DESIGN, NOT AN OVERSIGHT.
 *
 * OpenAI's under-18 API guidance bars processing an under-13's personal data
 * without zero data retention, which is sales-approval gated and which we do not
 * have. Google's paid tier is confirmed no-training under the 2026-03-23 Gemini
 * API Additional Terms and carries no such bar. So the constraint lands on one
 * vendor because the vendors' terms differ — not because we decided to be even
 * handed.
 *
 * The tests below pin BOTH directions. Under-restriction leaks child text to a
 * vendor that told us not to send it; OVER-restriction is a real defect too,
 * because it would block the per-model prompt experimentation the Lab exists for.
 */
describe("defaultPromptMode / promptModeFor", () => {
  /**
   * ⚠ THE THIRD ARGUMENT IS THE STAFF ATTESTATION, AND ABSENT MEANS FALSE.
   *
   * `defaultPromptMode("gpt-image-2", false)` used to be `authored`: a run with
   * no verified provenance sent whatever was typed, to OpenAI. But provenance is
   * a property of the FETCH PATH, not of the CONTENT — a child's pitch typed
   * straight into the template produces exactly that run — so "no provenance"
   * never meant "no child content". It now takes an explicit assertion, and the
   * assertion defaults off.
   */
  it("derives for an OpenAI model unless the run is BOTH unprovenanced AND attested", () => {
    expect(defaultPromptMode("gpt-image-2", true)).toBe("derived");
    // No provenance, no attestation — still derived. This is the P0 fix.
    expect(defaultPromptMode("gpt-image-2", false)).toBe("derived");
    expect(defaultPromptMode("gpt-image-2", false, false)).toBe("derived");
    // Attested: full experimentation is back.
    expect(defaultPromptMode("gpt-image-2", false, true)).toBe("authored");
    // …and the attestation cannot buy off verified provenance.
    expect(defaultPromptMode("gpt-image-2", true, true)).toBe("derived");
  });

  /** ⚠ GOOGLE IS UNTOUCHED BY THE ATTESTATION IN EVERY COMBINATION. */
  it("never constrains a Google model, attested or not", () => {
    for (const modelId of ["gemini-3-pro-image", "gemini-3.1-flash-lite-image"]) {
      for (const provenance of [true, false]) {
        for (const attested of [true, false]) {
          expect(defaultPromptMode(modelId, provenance, attested)).toBe("authored");
        }
      }
    }
  });

  it("leaves Google models on the authored prompt, provenance or not", () => {
    expect(defaultPromptMode("gemini-3-pro-image", true)).toBe("authored");
    expect(defaultPromptMode("gemini-3.1-flash-lite-image", true)).toBe("authored");
  });

  it("an explicit staff choice wins over the default where there IS a choice", () => {
    expect(
      promptModeFor("gemini-3-pro-image", true, { "gemini-3-pro-image": "derived" })
    ).toBe("derived");
    // An attested, unprovenanced OpenAI cell has a real choice, both ways.
    expect(
      promptModeFor("gpt-image-2", false, { "gpt-image-2": "derived" }, true)
    ).toBe("derived");
    expect(
      promptModeFor("gpt-image-2", false, { "gpt-image-2": "authored" }, true)
    ).toBe("authored");
  });

  /**
   * ⚠ THIS REPLACES THE ASSERTION THAT PINNED THE COMPOSER LOCK TRAP.
   *
   * It used to read: `promptModeFor("gpt-image-2", true, {"gpt-image-2":
   * "authored"})` is `"authored"`, defended as "this is a default resolver, not
   * the gate". That defence ignored what the composer does with the answer.
   * `promptModes` is written only by the select's `onChange` and is never cleared
   * when a token arrives or a chip is deselected, so: set gpt-image-2 to "As
   * written", THEN fill the slots from a child, and the stale entry survived.
   *
   * The result was a UI that contradicted itself and a run that could not be
   * saved: the disabled select displayed "As written" directly above a note
   * saying the model was locked to derived; the preview — documented as the last
   * human check on child-authored text leaving for a vendor — showed the child's
   * pitch as what would be sent; all N cells were composed with it and priced in
   * the estimate; every one 403'd at dispatch; and the refusal copy told staff to
   * switch the model to derived using a control the UI had disabled. The only
   * escape was a reload that discarded the composition.
   *
   * So the FORCED mode wins here, at the rules layer, where it is testable —
   * this suite has no jsdom, and the composer is where the trap was but not where
   * it can be caught.
   */
  it("the FORCED mode beats a stale explicit choice — the composer lock is authoritative", () => {
    // Provenance arrived after the staff member had already picked "authored".
    expect(promptModeFor("gpt-image-2", true, { "gpt-image-2": "authored" })).toBe(
      "derived"
    );
    // The same, via the attestation rather than provenance.
    expect(
      promptModeFor("gpt-image-2", false, { "gpt-image-2": "authored" }, false)
    ).toBe("derived");
    // And Google keeps its explicit choice — the lock is OpenAI-only.
    expect(
      promptModeFor("gemini-3-pro-image", true, { "gemini-3-pro-image": "authored" })
    ).toBe("authored");
  });

  it("a junk mode falls back to the default rather than throwing", () => {
    expect(
      promptModeFor("gpt-image-2", true, {
        "gpt-image-2": "verbatim" as unknown as "authored",
      })
    ).toBe("derived");
    expect(promptModeFor("gpt-image-2", true, undefined)).toBe("derived");
    // On the leg where there IS a choice, junk still degrades to the default.
    expect(
      promptModeFor(
        "gpt-image-2",
        false,
        { "gpt-image-2": "verbatim" as unknown as "authored" },
        true
      )
    ).toBe("authored");
  });
});

describe("decideChildTextGate — the one non-overridable rule", () => {
  const derived = allCategoryPrompts()[0]!;

  it("refuses an OpenAI cell whose prompt is not from the closed vocabulary", () => {
    expect(
      decideChildTextGate({
        modelId: "gpt-image-2",
        childProvenance: true,
        promptText: "Draw Maya's dog treat stand, she sells them on her street",
      })
    ).toEqual({ ok: false, reason: "child_text_to_openai" });
  });

  it("admits an OpenAI cell carrying a derived prompt", () => {
    expect(
      decideChildTextGate({
        modelId: "gpt-image-2",
        childProvenance: true,
        promptText: derived,
      })
    ).toEqual({ ok: true });
  });

  /**
   * ⚠ MUTATION (f), AT THE RULES LAYER. Extending the gate to Google reddens
   * this. The Gemini leg is governed by `IMAGE_LAB_REAL_CONTENT_LIVE` and the
   * name scrub, not by this rule.
   */
  it("does NOT constrain Google models, even with child provenance", () => {
    for (const modelId of ["gemini-3-pro-image", "gemini-3.1-flash-lite-image"]) {
      expect(
        decideChildTextGate({
          modelId,
          childProvenance: true,
          promptText: "Draw Maya's dog treat stand, she sells them on her street",
        })
      ).toEqual({ ok: true });
    }
  });

  /**
   * ⚠ REPLACES "does not constrain anything at all without child provenance".
   *
   * That was the gate's first line — `if (!input.childProvenance) return { ok:
   * true }` — and it is the P0 hole in one assertion. `sourceChildId` is set only
   * when a picker token verifies, so a staff member who pastes a child's pitch
   * into the TEMPLATE (no token, empty slots) reached this early return with the
   * child's verbatim prose in hand.
   */
  it("constrains an UNPROVENANCED OpenAI cell unless the compose is attested", () => {
    const childsOwnWords = "Hi, I am Maya and I make collectible cards on my street";
    expect(
      decideChildTextGate({
        modelId: "gpt-image-2",
        childProvenance: false,
        promptText: childsOwnWords,
      })
    ).toEqual({ ok: false, reason: "child_text_to_openai" });
    // Explicitly false is the same answer as absent.
    expect(
      decideChildTextGate({
        modelId: "gpt-image-2",
        childProvenance: false,
        noChildContentAttested: false,
        promptText: childsOwnWords,
      })
    ).toEqual({ ok: false, reason: "child_text_to_openai" });
    // Attested: the staff member's own wording goes through untouched.
    expect(
      decideChildTextGate({
        modelId: "gpt-image-2",
        childProvenance: false,
        noChildContentAttested: true,
        promptText: "Draw a comic panel of a lemonade stand",
      })
    ).toEqual({ ok: true });
  });

  /** An attestation is a claim about typed text. Once the server has VERIFIED
   *  the run was built from a child's saved work, a staff opinion about it is
   *  not admissible — otherwise the attestation is a bypass, not a default. */
  it("the attestation cannot lift the gate on a PROVENANCE-bearing run", () => {
    expect(
      decideChildTextGate({
        modelId: "gpt-image-2",
        childProvenance: true,
        noChildContentAttested: true,
        promptText: "Draw Maya's dog treat stand",
      })
    ).toEqual({ ok: false, reason: "child_text_to_openai" });
  });

  /**
   * ⚠ FAIL CLOSED. This read `const provider = entry?.provider ?? null; if
   * (provider !== "openai") return { ok: true }` — so an unregistered id took the
   * GOOGLE exit and PASSED. Nothing escaped only because `image-model.ts` does
   * its own exact-match lookup and answers `unconfigured`, which means this
   * gate's safety was entirely borrowed from a different module's unrelated
   * behaviour. An unknown model cannot generate, so refusing costs nothing.
   */
  it("REFUSES an unknown model id rather than taking the Google exit", () => {
    for (const provenance of [true, false]) {
      expect(
        decideChildTextGate({
          modelId: "gpt-image-9-turbo",
          childProvenance: provenance,
          noChildContentAttested: true,
          promptText: "Draw a comic panel of a lemonade stand",
        })
      ).toEqual({ ok: false, reason: "unknown_model" });
    }
  });

  /**
   * ⚠ THE GATE IS NOT ONLY A TEXT GATE. Its input was `{ modelId,
   * childProvenance, promptText }` while `generateCell` handed gpt-image-2 up to
   * 16 reference objects on the same call, on the very run whose text had just
   * been forced down to a 200-string vocabulary. The only control was copy in an
   * upload dialog, and references are append-only and undeletable.
   */
  it("REFUSES reference images on an OpenAI cell of a provenance run, with its OWN reason", () => {
    expect(
      decideChildTextGate({
        modelId: "gpt-image-2",
        childProvenance: true,
        promptText: derived,
        hasReferences: true,
      })
    ).toEqual({ ok: false, reason: "child_reference_to_openai" });
  });

  /** ⚠ AND NEVER ON GOOGLE, AND NEVER WITHOUT PROVENANCE. Over-restriction is a
   *  real defect: the reference library is how a character sheet is carried, and
   *  the attestation is a claim about typed text, not about an uploaded PNG. */
  it("leaves references alone on Google, and on any run with no provenance", () => {
    expect(
      decideChildTextGate({
        modelId: "gemini-3-pro-image",
        childProvenance: true,
        promptText: "Draw Maya's dog treat stand",
        hasReferences: true,
      })
    ).toEqual({ ok: true });
    expect(
      decideChildTextGate({
        modelId: "gpt-image-2",
        childProvenance: false,
        noChildContentAttested: true,
        promptText: "Draw a comic panel of a lemonade stand",
        hasReferences: true,
      })
    ).toEqual({ ok: true });
  });

  /**
   * ⚠ IT JUDGES THE STRING IN HAND. There is no template parameter on this
   * function and there must not be one: a template of pure `{{slot}}` tokens is
   * innocent-looking and resolves to a child's whole pitch, so a template-level
   * check proves nothing about what is dispatched.
   */
  it("judges the dispatched text — an innocent template cannot vouch for it", () => {
    const dispatched = "I bake dog treats and my name is Maya";
    expect(
      decideChildTextGate({
        modelId: "gpt-image-2",
        childProvenance: true,
        promptText: dispatched,
      }).ok
    ).toBe(false);
  });
});

describe("decideRunComposition — the per-cell prompt", () => {
  const base = {
    template: "Draw {{product}}",
    slotValues: { product: "dog treats" },
    imageCount: 1,
  };

  it("gives each model its own prompt, and stamps every cell with it", () => {
    const decision = decideRunComposition({
      ...base,
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
      childProvenance: true,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    const openai = decision.cells.find((c) => c.modelId === "gpt-image-2")!;
    const google = decision.cells.find((c) => c.modelId === "gemini-3-pro-image")!;
    expect(openai.promptDerived).toBe(true);
    expect(isCategoryDerivedPrompt(openai.promptText)).toBe(true);
    expect(google.promptDerived).toBe(false);
    expect(google.promptText).toBe("Draw dog treats");

    // The RUN-level resolution stays the authored one — it is the default and
    // the stored `resolved_prompt`, not a claim about what any cell sent.
    expect(decision.resolved.text).toBe("Draw dog treats");
  });

  it("without provenance AND without an attestation, the OpenAI cell still derives", () => {
    const decision = decideRunComposition({
      ...base,
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
    });
    if (!decision.ok) return;
    const openai = decision.cells.find((c) => c.modelId === "gpt-image-2")!;
    const google = decision.cells.find((c) => c.modelId === "gemini-3-pro-image")!;
    expect(openai.promptDerived).toBe(true);
    expect(google.promptDerived).toBe(false);
    expect(google.promptText).toBe("Draw dog treats");
  });

  it("with the attestation, every cell carries the authored text", () => {
    const decision = decideRunComposition({
      ...base,
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
      noChildContentAttested: true,
    });
    if (!decision.ok) return;
    expect(decision.cells.every((c) => c.promptText === "Draw dog treats")).toBe(true);
    expect(decision.cells.every((c) => c.promptDerived === false)).toBe(true);
  });

  it("staff can choose derived on a Google model — that is the experiment", () => {
    const decision = decideRunComposition({
      ...base,
      modelIds: ["gemini-3-pro-image"],
      childProvenance: true,
      promptModes: { "gemini-3-pro-image": "derived" },
    });
    if (!decision.ok) return;
    expect(decision.cells[0]!.promptDerived).toBe(true);
    expect(isCategoryDerivedPrompt(decision.cells[0]!.promptText)).toBe(true);
  });
});

describe("previewRows — the preview IS the dispatched string", () => {
  it("one row per selected model, each holding that model's exact text", () => {
    const decision = decideRunComposition({
      template: "Draw {{product}}",
      slotValues: { product: "dog treats" },
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
      imageCount: 2,
      childProvenance: true,
    });
    if (!decision.ok) return;

    const rows = previewRows(decision);
    expect(rows.map((r) => r.modelId)).toEqual([
      "gpt-image-2",
      "gemini-3-pro-image",
    ]);
    // ⚠ THE EQUALITY THE WHOLE SURFACE RESTS ON. Every cell of a model must carry
    // exactly the string this model's preview row shows.
    for (const row of rows) {
      for (const cell of decision.cells.filter((c) => c.modelId === row.modelId)) {
        expect(cell.promptText).toBe(row.text);
        expect(cell.promptDerived).toBe(row.derived);
      }
    }
  });

  it("says WHY a derived row is derived, and distinguishes required from chosen", () => {
    const required = previewRows(
      decideRunComposition({
        template: "Draw {{product}}",
        slotValues: { product: "dog treats" },
        modelIds: ["gpt-image-2"],
        imageCount: 1,
        childProvenance: true,
      })
    );
    expect(required[0]!.note).toBe(IMAGE_LAB_RUN_COPY.composer.preview.derivedRequired);

    const chosen = previewRows(
      decideRunComposition({
        template: "Draw {{product}}",
        slotValues: { product: "dog treats" },
        modelIds: ["gemini-3-pro-image"],
        imageCount: 1,
        childProvenance: true,
        promptModes: { "gemini-3-pro-image": "derived" },
      })
    );
    expect(chosen[0]!.note).toBe(IMAGE_LAB_RUN_COPY.composer.preview.derivedChosen);

    // An authored row says nothing extra — the text speaks for itself.
    const authored = previewRows(
      decideRunComposition({
        template: "Draw {{product}}",
        slotValues: { product: "dog treats" },
        modelIds: ["gemini-3-pro-image"],
        imageCount: 1,
        childProvenance: true,
      })
    );
    expect(authored[0]!.note).toBe("");
  });

  it("a refused composition previews nothing rather than a stale string", () => {
    const decision = decideRunComposition({
      template: "",
      slotValues: {},
      modelIds: ["gpt-image-2"],
      imageCount: 1,
    });
    expect(previewRows(decision)).toEqual([]);
    expect(previewPromptText(decision)).toBe(IMAGE_LAB_RUN_COPY.composer.preview.empty);
  });
});
