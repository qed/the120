import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reference Server Actions' own seam
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4).
 *
 * `__tests__/gate-enforcement.test.ts` already proves the WIRING — that each
 * export here reaches the authoritative `requireStaff` before anything else.
 * This file covers the two things left in a thin wire, both of which are
 * decisions no other test can see:
 *
 *   1. A malformed payload maps to a TYPED `invalid_input`, not a zod throw.
 *      These are network-reachable POST endpoints; an uncaught parse error
 *      reaches the browser as an opaque digest, and a picker that renders
 *      "something went wrong" is exactly the generic failure this unit's
 *      structured refusals exist to replace.
 *   2. `created_by` comes from the GATE'S SESSION and never from the input. The
 *      row is append-only, so a caller that could name someone else as the
 *      uploader would be forging an attribution nobody can correct.
 */

const { requireStaffSpy, depsToken, referenceDeps, coreSpies } = vi.hoisted(() => {
  const token = { marker: "reference-deps" };
  return {
    requireStaffSpy: vi.fn(),
    depsToken: token,
    referenceDeps: vi.fn(() => token),
    coreSpies: {
      mintReferenceSlot: vi.fn(),
      registerReference: vi.fn(),
      listReferenceViews: vi.fn(),
    },
  };
});

vi.mock("@/app/crm/lib/auth", () => ({ requireStaff: requireStaffSpy }));
vi.mock("../image-lab-db", () => ({ imageLabDb: () => ({ marker: "service-role-handle" }) }));
vi.mock("../reference-loader", () => ({ referenceDeps }));
vi.mock("../reference-core", () => coreSpies);

import { IMAGE_LAB_REFERENCE_LABEL_MAX } from "../reference-rules";
import {
  listReferenceLibrary,
  mintReferenceUploadSlot,
  registerReferenceUpload,
} from "../reference-actions";

const KEY = "references/11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireStaffSpy.mockResolvedValue({
    staffId: "staff-from-the-gate",
    email: "staff@the120.example",
  });
  coreSpies.mintReferenceSlot.mockResolvedValue({ ok: true, strategy: "plain" });
  coreSpies.registerReference.mockResolvedValue({ ok: true, duplicate: false });
  coreSpies.listReferenceViews.mockResolvedValue({ ok: true, references: [] });
});

describe("mintReferenceUploadSlot", () => {
  it("delegates a well-formed request to the core with the service-role deps", async () => {
    await mintReferenceUploadSlot({ contentType: "image/png", sizeBytes: 4096, label: "sheet" });
    expect(coreSpies.mintReferenceSlot).toHaveBeenCalledWith(depsToken, {
      declaredContentType: "image/png",
      sizeBytes: 4096,
      label: "sheet",
    });
  });

  it("passes a missing content type through as null rather than defaulting it", async () => {
    await mintReferenceUploadSlot({ sizeBytes: 10 });
    expect(coreSpies.mintReferenceSlot).toHaveBeenCalledWith(
      depsToken,
      expect.objectContaining({ declaredContentType: null })
    );
  });

  it("passes an ABSURDLY long label through to the pure rule, which names the cap", async () => {
    // ⚠ MUTATION SENTINEL (review finding 15). The schema used to carry
    // `.max(IMAGE_LAB_REFERENCE_LABEL_MAX * 4)`, so a 481-character label came
    // back `invalid_input` ("That request was not understood") — contradicting
    // the comment directly above it, which promised the refusal that names the
    // limit. One field, validated twice, against two different bounds. Restore
    // the `.max()` and this reddens.
    const label = "x".repeat(IMAGE_LAB_REFERENCE_LABEL_MAX * 4 + 1);
    await mintReferenceUploadSlot({ contentType: "image/png", sizeBytes: 4096, label });
    expect(coreSpies.mintReferenceSlot).toHaveBeenCalledWith(
      depsToken,
      expect.objectContaining({ label })
    );
  });

  it("builds its deps from the SERVICE-ROLE handle, explicitly", async () => {
    // `referenceDeps` no longer defaults its handle: a default makes the
    // service-role choice invisible at the call site, which is the one fact
    // about this feature a reviewer must be able to see in one file.
    await mintReferenceUploadSlot({ contentType: "image/png", sizeBytes: 10 });
    expect(referenceDeps).toHaveBeenCalledWith({ marker: "service-role-handle" });
  });

  it.each([
    ["nothing at all", undefined],
    ["a non-object", "not an object"],
    ["a missing size", { contentType: "image/png" }],
    ["a non-numeric size", { contentType: "image/png", sizeBytes: "4096" }],
    ["a fractional size", { contentType: "image/png", sizeBytes: 1.5 }],
  ])("maps %s to a typed invalid_input without touching the core", async (_why, input) => {
    await expect(mintReferenceUploadSlot(input)).resolves.toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(coreSpies.mintReferenceSlot).not.toHaveBeenCalled();
  });
});

describe("registerReferenceUpload", () => {
  it("records the uploader from the GATE, never from the input", async () => {
    await registerReferenceUpload({
      storageKey: KEY,
      label: "sheet",
      // A caller trying to attribute the upload to somebody else.
      staffId: "somebody-else",
      createdBy: "somebody-else",
    });
    expect(coreSpies.registerReference).toHaveBeenCalledWith(depsToken, {
      storageKey: KEY,
      label: "sheet",
      staffId: "staff-from-the-gate",
    });
  });

  it("maps a malformed payload to invalid_input without touching the core", async () => {
    await expect(registerReferenceUpload({ label: "no key" })).resolves.toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(coreSpies.registerReference).not.toHaveBeenCalled();
  });

  it("leaves key VALIDATION to the pure rule rather than duplicating it here", async () => {
    // The schema only bounds the string. `isReferenceStorageKey` is the one
    // place that decides what a reference key IS — a second, looser copy in a
    // zod regex would be a rule that drifts.
    await registerReferenceUpload({ storageKey: "runs/r1/i1" });
    expect(coreSpies.registerReference).toHaveBeenCalledWith(
      depsToken,
      expect.objectContaining({ storageKey: "runs/r1/i1" })
    );
  });
});

describe("listReferenceLibrary", () => {
  it("takes no input and delegates to the core", async () => {
    await expect(listReferenceLibrary()).resolves.toEqual({ ok: true, references: [] });
    expect(coreSpies.listReferenceViews).toHaveBeenCalledWith(depsToken);
  });
});
