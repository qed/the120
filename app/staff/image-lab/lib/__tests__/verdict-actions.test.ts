import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The verdict Server Actions' own seam
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6).
 *
 * `gate-enforcement.test.ts` proves each export reaches `requireStaff()` first
 * and unconditionally. What is left in a thin wire is exactly what is asserted
 * here: the closed sets (a verdict, a drill tag), the note bound, the refusal
 * MAPPING — a parse failure that reported the wrong reason would tell a reviewer
 * to fix something that is not broken (the `run-actions` finding) — and that the
 * service-role handle is what reaches the core.
 */

const { requireStaffSpy, historyDeps, coreSpies } = vi.hoisted(() => ({
  requireStaffSpy: vi.fn(),
  historyDeps: vi.fn(() => ({ marker: "history-deps" })),
  coreSpies: {
    recordVerdict: vi.fn(),
    recordVerdictNote: vi.fn(),
    recordRunTags: vi.fn(),
  },
}));

vi.mock("@/app/crm/lib/auth", () => ({ requireStaff: requireStaffSpy }));
vi.mock("../image-lab-db", () => ({
  imageLabDb: () => ({ marker: "service-role-handle" }),
}));
vi.mock("../history-loader", () => ({ historyDeps }));
vi.mock("../history-core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordVerdict: coreSpies.recordVerdict,
  recordVerdictNote: coreSpies.recordVerdictNote,
  recordRunTags: coreSpies.recordRunTags,
}));

import {
  setImageLabRunDrillTags,
  setImageLabVerdict,
  setImageLabVerdictNote,
} from "../verdict-actions";
import { IMAGE_LAB_VERDICT_NOTE_MAX_CHARS } from "../history-rules";

const IMAGE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  requireStaffSpy.mockResolvedValue({ staffId: "staff-1", email: "s@the120.example" });
  coreSpies.recordVerdict.mockResolvedValue({ ok: true, imageId: IMAGE_ID, verdict: "keep", verdictAtMs: 1 });
  coreSpies.recordVerdictNote.mockResolvedValue({ ok: true, imageId: IMAGE_ID, note: "n" });
  coreSpies.recordRunTags.mockResolvedValue({ ok: true, runId: RUN_ID, tags: [] });
});

describe("setImageLabVerdict", () => {
  it("delegates with the SERVICE-ROLE deps and the parsed verdict", async () => {
    await setImageLabVerdict({ imageId: IMAGE_ID, verdict: "keep" });
    expect(historyDeps).toHaveBeenCalledWith({ marker: "service-role-handle" });
    expect(coreSpies.recordVerdict).toHaveBeenCalledWith(
      { marker: "history-deps" },
      { imageId: IMAGE_ID, verdict: "keep" }
    );
  });

  it("carries `null` through as a real value — un-judging is not a missing field", async () => {
    await setImageLabVerdict({ imageId: IMAGE_ID, verdict: null });
    expect(coreSpies.recordVerdict).toHaveBeenCalledWith(expect.anything(), {
      imageId: IMAGE_ID,
      verdict: null,
    });
  });

  it("refuses a verdict outside the closed set WITHOUT reaching the core", async () => {
    expect(await setImageLabVerdict({ imageId: IMAGE_ID, verdict: "maybe" })).toEqual({
      ok: false,
      reason: "invalid_verdict",
    });
    expect(coreSpies.recordVerdict).not.toHaveBeenCalled();
  });

  it("refuses a non-uuid image id, and an absent body", async () => {
    expect(await setImageLabVerdict({ imageId: "img-1", verdict: "keep" })).toEqual({
      ok: false,
      reason: "invalid_verdict",
    });
    expect(await setImageLabVerdict()).toEqual({ ok: false, reason: "invalid_verdict" });
    expect(coreSpies.recordVerdict).not.toHaveBeenCalled();
  });
});

describe("setImageLabVerdictNote", () => {
  it("passes a note through", async () => {
    await setImageLabVerdictNote({ imageId: IMAGE_ID, note: "hero drifts left" });
    expect(coreSpies.recordVerdictNote).toHaveBeenCalledWith(expect.anything(), {
      imageId: IMAGE_ID,
      note: "hero drifts left",
    });
  });

  it("bounds the note at the MIGRATION's cap — imported, not restated", async () => {
    const ok = await setImageLabVerdictNote({
      imageId: IMAGE_ID,
      note: "x".repeat(IMAGE_LAB_VERDICT_NOTE_MAX_CHARS),
    });
    expect(ok).toMatchObject({ ok: true });

    coreSpies.recordVerdictNote.mockClear();
    const over = await setImageLabVerdictNote({
      imageId: IMAGE_ID,
      note: "x".repeat(IMAGE_LAB_VERDICT_NOTE_MAX_CHARS + 1),
    });
    // The refusal NAMES the right field: an over-long note that came back
    // "invalid image" would send a reviewer to fix an id that is fine.
    expect(over).toEqual({ ok: false, reason: "note_too_long" });
    expect(coreSpies.recordVerdictNote).not.toHaveBeenCalled();
  });
});

describe("setImageLabRunDrillTags", () => {
  it("passes the closed vocabulary through", async () => {
    await setImageLabRunDrillTags({ runId: RUN_ID, tags: ["consistency", "style"] });
    expect(coreSpies.recordRunTags).toHaveBeenCalledWith(expect.anything(), {
      runId: RUN_ID,
      tags: ["consistency", "style"],
    });
  });

  it("refuses a tag outside it WITHOUT reaching the core", async () => {
    expect(await setImageLabRunDrillTags({ runId: RUN_ID, tags: ["kid_appeal"] })).toEqual({
      ok: false,
      reason: "invalid_tag",
    });
    expect(coreSpies.recordRunTags).not.toHaveBeenCalled();
  });

  it("accepts an empty list — clearing every tag is a legitimate edit", async () => {
    await setImageLabRunDrillTags({ runId: RUN_ID, tags: [] });
    expect(coreSpies.recordRunTags).toHaveBeenCalled();
  });
});
