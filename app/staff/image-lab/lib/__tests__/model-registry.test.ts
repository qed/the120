import { describe, expect, it } from "vitest";
import {
  assertRouteBudget,
  estimatedCostUsd,
  findModelEntry,
  IMAGE_LAB_MODEL_IDS,
  IMAGE_LAB_MODELS,
  IMAGE_LAB_ROUTE_BUDGET_MS,
  IMAGE_LAB_TIMEOUT_HEADROOM_MS,
  pricedQualityTiers,
  unverifiedItems,
  type ImageLabModelEntry,
} from "../model-registry";

// These assertions pin INVARIANTS that must hold for any FUTURE entry, so adding
// model #4 fails loudly rather than shipping a nonsense row. Deliberately absent:
// anything that merely re-reads the table back to itself (a literal price, a
// literal path), which fails only when someone edits a value on purpose.

const entries = IMAGE_LAB_MODELS.map((entry) => [entry.id, entry] as const);

describe("model-registry: shape invariants", () => {
  it("exposes exactly the launch models, keyed by bare model name", () => {
    // Bare names, not gateway strings: this key is the DB's `model_id` and must
    // survive a re-route to a direct-vendor fallback without rewriting history.
    expect(IMAGE_LAB_MODELS.map((entry) => entry.id)).toEqual([...IMAGE_LAB_MODEL_IDS]);
  });

  it.each(entries)("%s: gatewayModel is a 'provider/model' string matching its provider", (_id, entry: ImageLabModelEntry) => {
    // A bare model name here reaches the gateway as an unroutable id and fails at
    // request time, after the staff member has committed to a run. And the prefix
    // must be the DECLARED provider: the adapter's safety wording branches on
    // `entry.provider`, so a Google model labelled "openai" would tell staff to
    // ignore the allowlist that is actually blocking every hero prompt.
    expect(entry.gatewayModel).toMatch(/^[a-z0-9.-]+\/[a-z0-9._-]+$/);
    expect(entry.gatewayModel.split("/")[0]).toBe(entry.provider);
    expect(entry.gatewayModel.endsWith(entry.id)).toBe(true);
  });

  it.each(entries)("%s: refImageLimit is a positive integer", (_id, entry: ImageLabModelEntry) => {
    // Zero would silently drop the model out of the consistency drill with no
    // error anywhere; the picker would just refuse to select anything.
    expect(Number.isInteger(entry.refImageLimit)).toBe(true);
    expect(entry.refImageLimit).toBeGreaterThan(0);
  });

  it.each(entries)("%s: prices are positive and qualityDefault names a real tier", (_id, entry: ImageLabModelEntry) => {
    const tiers = pricedQualityTiers(entry);
    expect(tiers.length).toBeGreaterThan(0);
    for (const tier of tiers) expect(entry.priceNoteUsd[tier]!).toBeGreaterThan(0);
    // Without this, `estimatedCostUsd(entry)` returns null for the DEFAULT tier
    // and every cost line in the evidence view silently reads blank.
    expect(tiers).toContain(entry.qualityDefault);
    expect(estimatedCostUsd(entry)).toBeGreaterThan(0);
  });

  it.each(entries)("%s: dataUseNote is present (R12a is a per-provider posture)", (_id, entry: ImageLabModelEntry) => {
    expect(entry.dataUseNote.trim().length).toBeGreaterThan(20);
  });

  it.each(entries)("%s: every verify-first item is answered", (_id, entry: ImageLabModelEntry) => {
    // The point of the block is that a capability question nobody answered stays
    // legible AT THE DATA, units later, when a null cost or a blanket refusal
    // looks like a bug.
    expect(Object.keys(entry.verified).sort()).toEqual([
      "costReporting",
      "gatewayRoutable",
      "personGeneration",
      "referenceImageInput",
    ]);
    for (const [key, note] of Object.entries(entry.verified)) {
      expect(["confirmed", "unverified"], key).toContain(note.status);
    }
    expect(unverifiedItems(entry).length).toBeLessThanOrEqual(4);
  });
});

describe("model-registry: quality tiers are OURS, the wire enum is the vendor's", () => {
  // The bug this exists to prevent: `priceNoteUsd` keys doubling as the OpenAI
  // `quality` wire value. Single-tier models key on "standard", which OpenAI does
  // NOT accept — sending it would 400 every call on that model.
  it.each(entries)("%s: apiQualityValues only ever holds wire-legal OpenAI tiers", (_id, entry: ImageLabModelEntry) => {
    if (entry.provider !== "openai") {
      // A non-OpenAI entry has no quality parameter at all, so declaring wire
      // values for it would be describing a parameter that does not exist.
      expect(entry.apiQualityValues).toBeUndefined();
      return;
    }
    expect(entry.apiQualityValues).toBeDefined();
    for (const value of entry.apiQualityValues!) {
      expect(["low", "medium", "high"]).toContain(value);
      // A declared wire value must also be priceable, or a legal call produces
      // no cost evidence.
      expect(estimatedCostUsd(entry, value)).toBeGreaterThan(0);
    }
    expect(entry.apiQualityValues).toContain(entry.qualityDefault);
  });
});

describe("model-registry: the timeout budget (arithmetic, not assumption)", () => {
  it.each(entries)("%s: timeoutMs leaves the headroom under the route budget", (_id, entry: ImageLabModelEntry) => {
    // An adapter allowed to consume the whole function budget is killed holding
    // paid bytes it never stored — billed, discarded, AND recorded as a timeout.
    expect(entry.timeoutMs).toBeGreaterThan(0);
    expect(entry.timeoutMs).toBeLessThanOrEqual(
      IMAGE_LAB_ROUTE_BUDGET_MS - IMAGE_LAB_TIMEOUT_HEADROOM_MS
    );
  });

  it("assertRouteBudget accepts a route long enough for the slowest model", () => {
    const slowest = Math.max(...IMAGE_LAB_MODELS.map((entry) => entry.timeoutMs));
    const requiredSeconds = (slowest + IMAGE_LAB_TIMEOUT_HEADROOM_MS) / 1000;
    expect(() => assertRouteBudget(requiredSeconds)).not.toThrow();
    expect(() => assertRouteBudget(IMAGE_LAB_ROUTE_BUDGET_MS / 1000)).not.toThrow();
  });

  it("assertRouteBudget REFUSES the repo's habitual maxDuration = 60", () => {
    // The precedent it is defending against is real: app/fp/fw/.../import/page.tsx
    // sets `maxDuration = 60`. Copied onto a generate route, gpt-image-2's 240s
    // abort can never fire — the platform kills the invocation, no finalize runs,
    // the row is stuck `requested` for the full staleness window, and the vendor
    // charges anyway. A module-scope call turns that into a deploy-time crash.
    expect(() => assertRouteBudget(60)).toThrow(/too short/i);
    const slowest = Math.max(...IMAGE_LAB_MODELS.map((entry) => entry.timeoutMs));
    const justUnder = (slowest + IMAGE_LAB_TIMEOUT_HEADROOM_MS) / 1000 - 1;
    expect(() => assertRouteBudget(justUnder)).toThrow(/too short/i);
    expect(() => assertRouteBudget(0)).toThrow(/positive/i);
  });
});

describe("model-registry: lookup fails closed", () => {
  it.each([...IMAGE_LAB_MODEL_IDS])("%s resolves to its own entry", (id) => {
    expect(findModelEntry(id)?.id).toBe(id);
  });

  it.each([
    "openai/gpt-image-2", // the gateway string, not the key — a real confusion
    "gpt-image-3",
    "GPT-IMAGE-2",
    "",
    "constructor", // the shape of bug a naive `MODELS[id]` record lookup has
    null,
    undefined,
  ])("%s resolves to null rather than throwing", (id) => {
    // Nullable, not throwing: the caller resolves a `model_id` read back from
    // Postgres, and a retired-but-still-in-history model is an ordinary state.
    expect(findModelEntry(id as string | null | undefined)).toBeNull();
  });
});

describe("model-registry: the table is immutable at RUNTIME, not just in types", () => {
  it("refuses a write to an entry and to a nested price map", () => {
    // `readonly` is erased at runtime, and `findModelEntry` hands out references
    // into a module-level table that outlives every request in a warm serverless
    // instance. One mutation would poison every later request in that container
    // with no error and no local repro.
    const entry = findModelEntry("gpt-image-2")!;
    expect(() => {
      (entry as { timeoutMs: number }).timeoutMs = 1;
    }).toThrow(TypeError);
    expect(() => {
      (entry.priceNoteUsd as Record<string, number>).high = 0;
    }).toThrow(TypeError);
    expect(() => {
      (IMAGE_LAB_MODELS as ImageLabModelEntry[]).pop();
    }).toThrow(TypeError);
    expect(entry.timeoutMs).toBe(240_000);
  });
});

describe("model-registry: cost estimation", () => {
  it("prices by tier and falls back to the entry's default, never to another tier", () => {
    const gpt = findModelEntry("gpt-image-2")!;
    expect(estimatedCostUsd(gpt)).toBe(estimatedCostUsd(gpt, gpt.qualityDefault));
    expect(estimatedCostUsd(gpt, null)).toBe(estimatedCostUsd(gpt, gpt.qualityDefault));
    // Silently costing an unknown tier at the default would put a WRONG number
    // into the per-model cost line the model decision is made from.
    expect(estimatedCostUsd(gpt, "ultra")).toBeNull();
    expect(estimatedCostUsd(findModelEntry("gemini-3-pro-image")!, "high")).toBeNull();
  });

  it("the worst 12-cell compare fan stays inside the REAL bound", () => {
    // ⚠ Quality is a RUN SETTING, not a fixed property, so the worst case is the
    // most expensive TIER of the most expensive entry — not its default. The
    // earlier version of this test maxed over defaults only (0.134 → $1.61) and
    // claimed to protect a $1.75 bound, while the actual worst fan is
    // gpt-image-2 at `high`: 0.211 × 12 = $2.53, 45% over the bound it "checked".
    //
    // The scope decision "cost controls are social, not technical" is conditioned
    // on this arithmetic. If a price change or a new entry breaks it, that
    // decision needs revisiting — and this fails before the credit card notices.
    const worstPerImage = Math.max(
      ...IMAGE_LAB_MODELS.flatMap((entry) => Object.values(entry.priceNoteUsd))
    );
    expect(worstPerImage).toBeCloseTo(0.211, 6);
    expect(worstPerImage * 12).toBeLessThanOrEqual(2.6);
  });
});
