import { describe, expect, it } from "vitest";
import {
  buildGrid,
  canRetryCell,
  cellAttemptName,
  cellRenderState,
  decideDispatchGate,
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
  type PromptModes,
  runObjectKey,
  type CellRow,
} from "../run-rules";
import {
  IMAGE_LAB_ROUTE_BUDGET_MS,
  IMAGE_LAB_MODELS,
  unverifiedItems,
} from "../model-registry";
import { IMAGE_LAB_STALE_AFTER_MS } from "../image-lab-rules";
import { isCategoryDerivedPrompt } from "../category-prompt-rules";

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
  it("carries who/when/which/how-many", () => {
    const line = formatGenerationBreadcrumb({
      staffId: "staff-1",
      atIso: "2026-08-05T00:00:00.000Z",
      modelId: "gpt-image-2",
      cellCount: 12,
      outcome: "done",
      billed: true,
    });
    expect(line).toContain("staff=staff-1");
    expect(line).toContain("model=gpt-image-2");
    expect(line).toContain("runCells=12");
  });

  /**
   * ⚠ `dbContent=` USED TO BE ASSERTED IN BOTH DIRECTIONS HERE. It reported
   * whether a run was built from a child's saved content, derived from
   * `source_child_id`. That column is no longer written (2026-08-06), so the
   * field could only ever have printed `false` — a privacy-relevant fact stated
   * incorrectly, which is worse than not stating it. It was removed from the
   * type and the line; this pins the absence rather than leaving the old
   * assertion to be "fixed" back into existence.
   */
  it("states nothing about child content, because nothing can know it", () => {
    const line = formatGenerationBreadcrumb({
      staffId: "s",
      atIso: "2026-08-05T00:00:00.000Z",
      modelId: "m",
      cellCount: 1,
      outcome: "done",
      billed: false,
    });
    expect(line).not.toContain("dbContent");
  });

  it("has no field a prompt, a slot value or a child field could travel in", () => {
    // The TYPE is the enforcement — this asserts the rendered line as well, so a
    // future field added to the type is caught by a human-readable failure.
    const line = formatGenerationBreadcrumb({
      staffId: "s",
      atIso: "2026-08-05T00:00:00.000Z",
      modelId: "m",
      cellCount: 1,
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

// ── The prompt choice, and the one gate that is left ────────────────────────

/**
 * ⚠ THE PER-VENDOR ASYMMETRY IS GONE (2026-08-06, owner decision).
 *
 * `forcedPromptMode` and `decideChildTextGate` used to encode it: an OpenAI cell
 * on a run with child provenance, or without a staff attestation, was forced onto
 * the closed derived vocabulary and refused at dispatch if it carried anything
 * else. The justification was OpenAI's under-18 API guidance. That constraint was
 * removed by the owner on legal advice — reference images will only ever be
 * AI-generated, and scrubbed child-authored business text was cleared as not
 * personal data of a child.
 *
 * So the tests below invert: the two vendors must now be INDISTINGUISHABLE, and
 * `derived` must be selectable everywhere and required nowhere. Over-restriction
 * was always a real defect here (it blocks the per-model prompt experimentation
 * the Lab exists for); it is now the ONLY defect on this path.
 */
describe("defaultPromptMode / promptModeFor", () => {
  it("defaults to `authored` on EVERY model, with no per-vendor branch", () => {
    expect(defaultPromptMode()).toBe("authored");
    for (const modelId of ["gpt-image-2", "gemini-3-pro-image", "gemini-3-flash-image"]) {
      expect(promptModeFor(modelId, undefined)).toBe("authored");
      expect(promptModeFor(modelId, {})).toBe("authored");
    }
  });

  it("honours an explicit staff choice on EVERY model, in both directions", () => {
    for (const modelId of ["gpt-image-2", "gemini-3-pro-image"]) {
      expect(promptModeFor(modelId, { [modelId]: "derived" })).toBe("derived");
      expect(promptModeFor(modelId, { [modelId]: "authored" })).toBe("authored");
    }
  });

  /**
   * ⚠ THE DIRECT INVERSE OF THE DELETED "the FORCED mode beats a stale explicit
   * choice" TEST. That test existed because `promptModes` is written only by the
   * select's `onChange` and never cleared, so a stale entry could disagree with a
   * lock the UI had applied. There is no lock any more, so the explicit entry is
   * simply authoritative — and a `forcedPromptMode` reappearing anywhere would
   * redden this.
   */
  it("an explicit `authored` on an OpenAI model is NOT overridden", () => {
    expect(promptModeFor("gpt-image-2", { "gpt-image-2": "authored" })).toBe("authored");
  });

  it("a junk mode falls back to the default rather than throwing", () => {
    const modes = { "gpt-image-2": "sideways" } as unknown as PromptModes;
    expect(promptModeFor("gpt-image-2", modes)).toBe("authored");
  });

  it("an UNKNOWN model id still resolves a mode — the refusal lives elsewhere", () => {
    // `decideRunComposition` refuses an unknown id outright and
    // `decideDispatchGate` fails closed on one; this function answers a composer
    // question and must not throw on an id it has never seen.
    expect(promptModeFor("gpt-image-9-turbo", undefined)).toBe("authored");
  });
});

/**
 * ⚠ WHAT `decideChildTextGate`'s TEST BLOCK COVERED, AND WHERE IT WENT.
 *
 * Deleted with the behaviour: refusing an OpenAI cell whose prompt was outside
 * the closed vocabulary; admitting one that was inside it; the attestation's
 * inability to lift a provenance-bearing run; the reference-image refusal on the
 * OpenAI leg; and "Google is never constrained" (which is now vacuous, because
 * nothing is constrained).
 *
 * KEPT, because it is the one property that was never about vendors: an unknown
 * model id FAILS CLOSED. The original read `provider = entry?.provider ?? null;
 * if (provider !== "openai") return ok`, so an unrecognized id took the
 * non-OpenAI exit and passed — safe only because `image-model.ts` happens to do
 * its own exact-match lookup. That borrowed safety is exactly what
 * `decideDispatchGate` still exists to stop.
 */
describe("decideDispatchGate — fail closed, and no vendor branch", () => {
  it("REFUSES an unknown model id rather than taking a pass exit", () => {
    expect(decideDispatchGate({ modelId: "gpt-image-9-turbo" })).toEqual({
      ok: false,
      reason: "unknown_model",
    });
    expect(decideDispatchGate({ modelId: "" })).toEqual({
      ok: false,
      reason: "unknown_model",
    });
  });

  it("ADMITS every registry model identically, whoever the vendor is", () => {
    for (const entry of IMAGE_LAB_MODELS) {
      expect(decideDispatchGate({ modelId: entry.id })).toEqual({ ok: true });
    }
    // Both vendors are represented, so "identically" is a claim with content.
    expect(new Set(IMAGE_LAB_MODELS.map((m) => m.provider)).size).toBeGreaterThan(1);
  });

  /**
   * ⚠ THE STRUCTURAL VERSION OF THE SAME CLAIM. The gate takes ONLY a model id —
   * no prompt text, no provenance, no attestation, no reference flag — so there
   * is nothing for a per-vendor rule to key on even if someone tried. A widened
   * signature is the first move of any regression here, and it changes this.
   */
  it("takes a model id and nothing else", () => {
    expect(decideDispatchGate.length).toBe(1);
    expect(decideDispatchGate({ modelId: "gpt-image-2" })).toEqual({ ok: true });
  });
});

describe("decideRunComposition — the per-cell prompt", () => {
  const base = {
    template: "Draw {{product}}",
    slotValues: { product: "dog treats" },
    imageCount: 1,
  };

  it("gives every model the AUTHORED text by default, and stamps every cell", () => {
    const decision = decideRunComposition({
      ...base,
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    // ⚠ IDENTICAL ACROSS VENDORS. This assertion used to be its opposite: the
    // OpenAI cell derived and the Google cell did not. There is no vendor branch
    // left, and a returning one reddens here.
    for (const cell of decision.cells) {
      expect(cell.promptDerived).toBe(false);
      expect(cell.promptText).toBe("Draw dog treats");
    }
    expect(decision.resolved.text).toBe("Draw dog treats");
  });

  it("staff can choose derived on ANY model — that is the experiment", () => {
    for (const modelId of ["gpt-image-2", "gemini-3-pro-image"]) {
      const decision = decideRunComposition({
        ...base,
        modelIds: [modelId],
        promptModes: { [modelId]: "derived" },
      });
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      expect(decision.cells[0]!.promptDerived).toBe(true);
      expect(isCategoryDerivedPrompt(decision.cells[0]!.promptText)).toBe(true);
    }
  });

  it("mixes modes within one run — a derived leg beside an authored one", () => {
    const decision = decideRunComposition({
      ...base,
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
      promptModes: { "gpt-image-2": "derived" },
    });
    if (!decision.ok) return;
    const openai = decision.cells.find((c) => c.modelId === "gpt-image-2")!;
    const google = decision.cells.find((c) => c.modelId === "gemini-3-pro-image")!;
    expect(openai.promptDerived).toBe(true);
    expect(google.promptDerived).toBe(false);
    expect(google.promptText).toBe("Draw dog treats");
    // The RUN-level resolution stays the authored one — it is the default and
    // the stored `resolved_prompt`, not a claim about what any cell sent.
    expect(decision.resolved.text).toBe("Draw dog treats");
  });
});

describe("previewRows — the preview IS the dispatched string", () => {
  it("one row per selected model, each holding that model's exact text", () => {
    const decision = decideRunComposition({
      template: "Draw {{product}}",
      slotValues: { product: "dog treats" },
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
      imageCount: 2,
      promptModes: { "gpt-image-2": "derived" },
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

  /**
   * ⚠ THIS USED TO DISTINGUISH "required" FROM "chosen", AND THAT DISTINCTION IS
   * GONE. `derivedRequired` named OpenAI's under-18 guidance as the reason a
   * model had no choice; nothing requires `derived` on any model now, so the
   * copy would have been false on every row it rendered. ONE note, and no vendor
   * branch — which is also the surface-level version of the dispatch-path claim.
   */
  it("says the SAME thing about a derived row on either vendor", () => {
    const noteFor = (modelId: string) =>
      previewRows(
        decideRunComposition({
          template: "Draw {{product}}",
          slotValues: { product: "dog treats" },
          modelIds: [modelId],
          imageCount: 1,
          promptModes: { [modelId]: "derived" },
        })
      )[0]!.note;

    expect(noteFor("gpt-image-2")).toBe(IMAGE_LAB_RUN_COPY.composer.preview.derivedChosen);
    expect(noteFor("gemini-3-pro-image")).toBe(noteFor("gpt-image-2"));

    // An authored row says nothing extra — the text speaks for itself.
    const authored = previewRows(
      decideRunComposition({
        template: "Draw {{product}}",
        slotValues: { product: "dog treats" },
        modelIds: ["gemini-3-pro-image"],
        imageCount: 1,
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
