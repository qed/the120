import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The run Server Actions' own seam
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5).
 *
 * ── WHY THIS FILE HAS TO EXIST ─────────────────────────────────────────────
 * `run-actions.ts` had SIX network-reachable actions and ZERO behavioural tests,
 * and two mutations survived the whole suite green:
 *
 *   * REMOVING THE `imageCount > MAX` BOUND — the client-facing bound on fan-out
 *     and therefore on spend. Nothing anywhere noticed.
 *   * REPLACING `keepKnownSlots(...)` WITH THE RAW PARSED VALUE — the allowlist
 *     that stops arbitrary caller-supplied keys reaching the resolved prompt and
 *     landing on `slot_values`, a column the migration header calls
 *     child-PII-bearing.
 *
 * `gate-enforcement.test.ts` proves each export reaches `requireStaff` first.
 * What is left in a thin wire is exactly what is asserted here: the bounds, the
 * allowlist, the refusal MAPPING, the cooldowns, and that `staff_id` comes from
 * the gate's session rather than from the caller.
 */

const { requireStaffSpy, rateLimitSpy, runDeps, coreSpies, loaderSpies, pickerSpies } =
  vi.hoisted(() => ({
    requireStaffSpy: vi.fn(),
    rateLimitSpy: vi.fn(),
    runDeps: vi.fn(() => ({ marker: "run-deps" })),
    coreSpies: {
      createRun: vi.fn(),
      retryCell: vi.fn(),
    },
    loaderSpies: { loadRunCellViews: vi.fn() },
    pickerSpies: {
      listPickerChildren: vi.fn(),
      listPickerIdeas: vi.fn(),
      pickSlotValues: vi.fn(),
      contentPickerDeps: vi.fn(() => ({ marker: "picker-deps" })),
    },
  }));

vi.mock("@/app/crm/lib/auth", () => ({ requireStaff: requireStaffSpy }));
vi.mock("@/app/fp/lib/rate-limit-store", () => ({
  checkAndRecordRateLimit: rateLimitSpy,
}));
vi.mock("../image-lab-db", () => ({ imageLabDb: () => ({ marker: "service-role-handle" }) }));
vi.mock("../run-loader", () => ({
  runDeps,
  loadRunCellViews: loaderSpies.loadRunCellViews,
}));
vi.mock("../run-core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createRun: coreSpies.createRun,
  retryCell: coreSpies.retryCell,
}));
vi.mock("../content-picker-loader", () => ({
  contentPickerDeps: pickerSpies.contentPickerDeps,
}));
vi.mock("../content-picker-core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listPickerChildren: pickerSpies.listPickerChildren,
  listPickerIdeas: pickerSpies.listPickerIdeas,
  pickSlotValues: pickerSpies.pickSlotValues,
}));

import {
  createImageLabRun,
  fillImageLabSlots,
  listImageLabPickerChildren,
  listImageLabPickerIdeas,
  loadImageLabRunCells,
  retryImageLabCell,
} from "../run-actions";
import {
  IMAGE_LAB_MAX_IMAGE_COUNT,
  IMAGE_LAB_MAX_REFERENCES_PER_RUN,
  IMAGE_LAB_TEMPLATE_MAX_CHARS,
} from "../run-rules";

const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

const compose = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: "compose-key-0001",
  template: "Draw {{product}}",
  slotValues: { product: "kites" },
  modelIds: ["gpt-image-2"],
  imageCount: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireStaffSpy.mockResolvedValue({
    staffId: "staff-from-the-gate",
    email: "staff@the120.example",
  });
  rateLimitSpy.mockReturnValue({ allowed: true, retryAfterMs: 0 });
  coreSpies.createRun.mockResolvedValue({
    ok: true,
    run: { id: UUID, resolvedPrompt: "Draw kites", staffId: "staff-from-the-gate" },
    cells: [],
    duplicate: false,
  });
  coreSpies.retryCell.mockResolvedValue({ ok: true, imageId: UUID });
  loaderSpies.loadRunCellViews.mockResolvedValue({
    run: { id: UUID, staffId: "staff-from-the-gate", resolvedPrompt: "Draw kites" },
    cells: [],
    serverNowMs: 1_700_000_000_000,
  });
  pickerSpies.listPickerChildren.mockResolvedValue({ ok: true, children: [] });
  pickerSpies.listPickerIdeas.mockResolvedValue({ ok: true, ideas: [], docReadable: true });
  pickerSpies.pickSlotValues.mockResolvedValue({ ok: true, slots: {} });
});

// ── createImageLabRun ────────────────────────────────────────────────────────

describe("createImageLabRun", () => {
  it("takes staff_id from the GATE, never from the input", async () => {
    await createImageLabRun(compose({ staffId: "someone-else" }));
    expect(coreSpies.createRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ staffId: "staff-from-the-gate" })
    );
  });

  it("BOUNDS imageCount — the client-facing bound on fan-out and on spend", async () => {
    // ⚠ REMOVING THIS BOUND SURVIVED THE WHOLE SUITE. It is what stops a caller
    // asking for 400 candidates per model.
    for (const imageCount of [IMAGE_LAB_MAX_IMAGE_COUNT + 1, 99, 0, -1, 1.5]) {
      const result = await createImageLabRun(compose({ imageCount }));
      expect(result.ok, `imageCount=${imageCount}`).toBe(false);
      if (result.ok || !("refusal" in result)) continue;
      expect(result.refusal.reason).toBe("bad_image_count");
    }
    expect(coreSpies.createRun).not.toHaveBeenCalled();
  });

  it("accepts every count inside the bound", async () => {
    for (let n = 1; n <= IMAGE_LAB_MAX_IMAGE_COUNT; n++) {
      expect((await createImageLabRun(compose({ imageCount: n }))).ok).toBe(true);
    }
  });

  it("DROPS a slot key the vocabulary does not know", async () => {
    // ⚠ REPLACING `keepKnownSlots` WITH THE RAW VALUE ALSO SURVIVED. `slot_values`
    // is one of the three columns the migration header calls child-PII-bearing,
    // and an unknown key can never be substituted anyway — so it would accumulate
    // there unaudited.
    await createImageLabRun(
      compose({
        slotValues: { product: "kites", ssn: "000-00-0000", __proto__: "x", pitch: "hi" },
      })
    );
    const passed = coreSpies.createRun.mock.calls[0]![1] as {
      slotValues: Record<string, string>;
    };
    expect(Object.keys(passed.slotValues).sort()).toEqual(["pitch", "product"]);
    expect(passed.slotValues.ssn).toBeUndefined();
  });

  it("keeps a known slot whose value is empty, rather than dropping the key", async () => {
    await createImageLabRun(compose({ slotValues: { product: "" } }));
    const passed = coreSpies.createRun.mock.calls[0]![1] as {
      slotValues: Record<string, string>;
    };
    expect(passed.slotValues).toEqual({ product: "" });
  });

  it("maps a zod failure to the refusal it ACTUALLY is", async () => {
    // ⚠ EVERY PARSE FAILURE USED TO BECOME `empty_template`, which the composer
    // renders as "Write a prompt template first" — so an over-long slot value or
    // a bad drill tag told the staff member to fix something that was not broken.
    const cases: [Record<string, unknown>, string][] = [
      [{ template: "x".repeat(IMAGE_LAB_TEMPLATE_MAX_CHARS + 1) }, "template_too_long"],
      [{ slotValues: { product: "x".repeat(4001) } }, "prompt_too_long"],
      [{ modelIds: Array.from({ length: 17 }, (_, i) => `m${i}`) }, "no_models"],
      [
        {
          referenceIds: Array.from(
            { length: IMAGE_LAB_MAX_REFERENCES_PER_RUN + 1 },
            () => UUID
          ),
        },
        "too_many_references",
      ],
      [{ drillTags: ["kid_appeal"] }, "empty_template"],
      // ⚠ `sourceToken` IS GONE (2026-08-06), and with it `bad_source_token`.
      // An unknown key is now simply ignored by the schema rather than being
      // policed — there is no provenance for a caller to assert.
      [{ promptModes: { "gpt-image-2": "sideways" } }, "empty_template"],
    ];

    for (const [over, reason] of cases) {
      const result = await createImageLabRun(compose(over));
      expect(result.ok, JSON.stringify(over).slice(0, 60)).toBe(false);
      if (result.ok || !("refusal" in result)) continue;
      expect(result.refusal.reason, JSON.stringify(over).slice(0, 60)).toBe(reason);
    }
  });

  it("refuses an unparseable body without throwing a digest at the browser", async () => {
    for (const bad of [undefined, null, "nope", 7, {}]) {
      const result = await createImageLabRun(bad);
      expect(result.ok).toBe(false);
    }
    expect(coreSpies.createRun).not.toHaveBeenCalled();
  });

  /**
   * ⚠ THREE ATTESTATION-COERCION TESTS WERE DELETED HERE (2026-08-06).
   *
   * They pinned that `noChildContentAttested` reached the core as `false` when
   * absent, that only a literal `true` produced an attested run, and that `true`
   * still worked. The field is gone with the attestation, so there is no
   * coercion left at this boundary to defend.
   *
   * THE LESSON THEY EXISTED FOR IS NOT GONE, and it is worth stating because
   * this is exactly where coverage evaporates quietly: a safety default is only
   * as safe as its least-tested coercion boundary
   * (docs/solutions/test-failures/). The remaining coercion boundaries on this
   * file — the zod schema's own bounds, and `keepKnownSlots` — are still
   * covered below, and the picker's scrub (the one privacy control left) is
   * mutation-verified in `content-picker-core.test.ts`.
   */
  it("drops a slot key the vocabulary does not define, at the wire", async () => {
    await createImageLabRun(
      compose({ slotValues: { product: "kept", parentEmail: "dropped@example.com" } })
    );
    const passed = coreSpies.createRun.mock.calls[0]![1] as { slotValues: unknown };
    expect(passed.slotValues).toEqual({ product: "kept" });
  });

  it("forwards NO provenance field of any kind to the core", async () => {
    await createImageLabRun(
      compose({
        sourceToken: "tok:child-1::",
        noChildContentAttested: true,
      })
    );
    const passed = coreSpies.createRun.mock.calls[0]![1] as Record<string, unknown>;
    expect(passed).not.toHaveProperty("sourceToken");
    expect(passed).not.toHaveProperty("noChildContentAttested");
  });

  it("has its OWN cooldown, because minting cells is the supply side of the spend", async () => {
    // ⚠ ONLY REDEMPTION WAS THROTTLED. A loop could mint unlimited generatable
    // rows for free and then spend them at whatever rate the other bucket allowed.
    rateLimitSpy.mockReturnValue({ allowed: false, retryAfterMs: 60_000 });
    const result = await createImageLabRun(compose());
    expect(result).toEqual({ ok: false, reason: "cooldown" });
    expect(coreSpies.createRun).not.toHaveBeenCalled();
    // Keyed per staff member, so one runaway tab cannot lock a colleague out.
    expect(String(rateLimitSpy.mock.calls[0]![0])).toContain("staff-from-the-gate");
  });
});

// ── retryImageLabCell ────────────────────────────────────────────────────────

describe("retryImageLabCell", () => {
  it("passes the gate's staff id, so a run's owner can be checked", async () => {
    await retryImageLabCell({ imageId: UUID });
    expect(coreSpies.retryCell).toHaveBeenCalledWith(expect.anything(), {
      imageId: UUID,
      staffId: "staff-from-the-gate",
    });
  });

  it("refuses a malformed id as TYPED input, never as a throw", async () => {
    for (const bad of [undefined, {}, { imageId: "not-a-uuid" }, { imageId: 7 }]) {
      const result = await retryImageLabCell(bad);
      expect(result).toEqual({ ok: false, outcome: { kind: "invalid_input" } });
    }
    expect(coreSpies.retryCell).not.toHaveBeenCalled();
  });

  it("is on the SUPPLY-side cooldown too — a retry mints a generatable row", async () => {
    rateLimitSpy.mockReturnValue({ allowed: false, retryAfterMs: 60_000 });
    const result = await retryImageLabCell({ imageId: UUID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome.kind).toBe("cooldown");
    expect(coreSpies.retryCell).not.toHaveBeenCalled();
  });
});

// ── loadImageLabRunCells ─────────────────────────────────────────────────────

describe("loadImageLabRunCells", () => {
  it("returns the cells, the server clock, the run's prompt and its columns", async () => {
    loaderSpies.loadRunCellViews.mockResolvedValue({
      run: { id: UUID, staffId: "staff-from-the-gate", resolvedPrompt: "Draw kites" },
      cells: [{ id: "a", modelId: "gpt-image-2" }, { id: "b", modelId: "gemini-3-pro-image" }],
      serverNowMs: 42,
    });
    const result = await loadImageLabRunCells({ runId: UUID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverNowMs).toBe(42);
    expect(result.resolvedPrompt).toBe("Draw kites");
    // The RUN's columns, so a chip toggle cannot re-narrate a recorded run.
    expect(result.modelIds).toEqual(["gpt-image-2", "gemini-3-pro-image"]);
  });

  it("REFUSES another staff member's run rather than minting signed URLs for it", async () => {
    loaderSpies.loadRunCellViews.mockResolvedValue({
      run: { id: UUID, staffId: "somebody-else", resolvedPrompt: "x" },
      cells: [],
      serverNowMs: 1,
    });
    expect(await loadImageLabRunCells({ runId: UUID })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a malformed run id, and degrades a thrown load to `unavailable`", async () => {
    expect(await loadImageLabRunCells({ runId: "nope" })).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    loaderSpies.loadRunCellViews.mockRejectedValue(new Error("boom"));
    expect(await loadImageLabRunCells({ runId: UUID })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

// ── The picker actions ───────────────────────────────────────────────────────

describe("the three picker actions", () => {
  it("listImageLabPickerChildren delegates with the service-role deps", async () => {
    await listImageLabPickerChildren();
    expect(pickerSpies.contentPickerDeps).toHaveBeenCalled();
    expect(pickerSpies.listPickerChildren).toHaveBeenCalledTimes(1);
  });

  it("listImageLabPickerIdeas refuses a malformed child id", async () => {
    expect(await listImageLabPickerIdeas({ childId: "nope" })).toEqual({
      ok: false,
      reason: "unknown_child",
    });
    expect(pickerSpies.listPickerIdeas).not.toHaveBeenCalled();

    await listImageLabPickerIdeas({ childId: UUID });
    expect(pickerSpies.listPickerIdeas).toHaveBeenCalledWith(expect.anything(), UUID);
  });

  it("fillImageLabSlots passes the idea id through, and bounds its SHAPE", async () => {
    await fillImageLabSlots({ childId: UUID, ideaId: "idea:2" });
    // ⚠ NO `staffId` AND NO `taskId`. `staffId` was here to bind the provenance
    // token this fill used to mint; `taskId` was recorded as run provenance.
    // Both were removed on 2026-08-06 — see `content-picker-core`.
    expect(pickerSpies.pickSlotValues).toHaveBeenCalledWith(expect.anything(), {
      childId: UUID,
      ideaId: "idea:2",
    });

    // ⚠ THE SHAPE BOUND SURVIVED THE PROVENANCE REMOVAL WITH A SMALLER JOB. It
    // used to bound `source_idea_id` on the run row too; what is left is a
    // closed character class on a value that goes straight into a lookup.
    pickerSpies.pickSlotValues.mockClear();
    expect(
      await fillImageLabSlots({ childId: UUID, ideaId: "Maya Chen's idea" })
    ).toEqual({ ok: false, reason: "unknown_child" });
    expect(pickerSpies.pickSlotValues).not.toHaveBeenCalled();
  });

  it("normalizes an absent idea id to null rather than undefined", async () => {
    await fillImageLabSlots({ childId: OTHER_UUID });
    expect(pickerSpies.pickSlotValues).toHaveBeenCalledWith(expect.anything(), {
      childId: OTHER_UUID,
      ideaId: null,
    });
  });
});
