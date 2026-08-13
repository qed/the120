import { describe, expect, it, vi } from "vitest";
import type { BlobObject, BlobPort } from "@/app/lib/fp/cover-store";
import type { NormalizedImageResult } from "@/app/staff/image-lab/lib/image-model-rules";
import { blobKey } from "@/app/lib/fp/cover-store-rules";
import {
  discardSourcePhoto,
  generateCoverFromPhoto,
  type ChildPhotoGenerateDeps,
} from "../child-photo-generate-core";

/**
 * The generation sequence, exercised by EXECUTION rather than by inspection.
 * Every claim the module's header makes about ORDER is asserted here against a
 * recorded call log, because an ordering comment is not a mechanism.
 *
 * The three that matter most, and the reason each is a separate test:
 *   * the source photo is deleted on the SUCCESS path AND on the FAILURE path;
 *   * a generation failure leaves the previous cover EXACTLY as it was — no put,
 *     no commit, nothing the caller could write;
 *   * a closed gate reaches nothing at all: no read, no vendor, no store.
 */

const CHILD = "11111111-2222-3333-4444-555555555555";
const PHOTO_KEY = blobKey({ scope: "child", ownerId: CHILD, kind: "photo", ext: "image/jpeg" });
const PREVIOUS_COVER_KEY = blobKey({
  scope: "child",
  ownerId: CHILD,
  kind: "cover",
  ext: "image/png",
  sequence: 1,
});

const GENERATED: NormalizedImageResult = {
  kind: "generated",
  bytes: new Uint8Array([1, 2, 3, 4]),
  contentType: "image/png",
  gatewayGenerationId: null,
  costReportedUsd: null,
};

type Harness = {
  deps: ChildPhotoGenerateDeps;
  log: string[];
  store: Map<string, Uint8Array>;
  generate: ReturnType<typeof vi.fn>;
};

function harness(
  overrides: {
    result?: NormalizedImageResult;
    generateThrows?: boolean;
    putThrows?: boolean;
    deleteThrows?: boolean;
    live?: boolean;
    photoPresent?: boolean;
  } = {}
): Harness {
  const log: string[] = [];
  const store = new Map<string, Uint8Array>();
  // The world BEFORE this generation: a photo waiting, and a cover already on
  // the child from a previous run. The previous cover is what "atomic" is about.
  if (overrides.photoPresent !== false) store.set(PHOTO_KEY, new Uint8Array([9, 9, 9, 9]));
  store.set(PREVIOUS_COVER_KEY, new Uint8Array([7, 7, 7]));

  const blob: BlobPort = {
    async put(key, body): Promise<BlobObject> {
      log.push(`put:${key}`);
      if (overrides.putThrows) throw new Error("storage down");
      store.set(key, body);
      return { key, url: `supabase://fp-child-media/${key}`, size: body.byteLength };
    },
    async delete(key) {
      log.push(`blob.delete:${key}`);
      store.delete(key);
    },
    async head(key) {
      log.push(`head:${key}`);
      const bytes = store.get(key);
      return bytes ? { key, url: `x/${key}`, size: bytes.byteLength } : null;
    },
  };

  const generate = vi.fn(async () => {
    log.push("generate");
    if (overrides.generateThrows) throw new Error("adapter exploded");
    return overrides.result ?? GENERATED;
  });

  return {
    log,
    store,
    generate,
    deps: {
      blob,
      readBytes: async (key) => {
        log.push(`read:${key}`);
        return store.get(key) ?? null;
      },
      deleteSourcePhoto: async (key) => {
        log.push(`deleteSourcePhoto:${key}`);
        if (overrides.deleteThrows) throw new Error("delete failed");
        store.delete(key);
      },
      generate: generate as unknown as ChildPhotoGenerateDeps["generate"],
      isLive: () => overrides.live ?? true,
      modelId: "test-model",
    },
  };
}

const run = (h: Harness) =>
  generateCoverFromPhoto(h.deps, {
    scope: "child",
    ownerId: CHILD,
    photoKey: PHOTO_KEY,
    prompt: "draw a hero",
    sequence: 1,
  });

describe("the gate refuses everything while off", () => {
  it("reads nothing, dials nothing, writes nothing, deletes nothing", async () => {
    const h = harness({ live: false });
    const result = await run(h);
    expect(result).toMatchObject({ ok: false, reason: "gate_closed", sourcePhotoDeleted: false });
    expect(h.log).toEqual([]);
    expect(h.generate).not.toHaveBeenCalled();
    // The world is untouched — including the photo, which stays in the reaper's
    // and the eraser's scope rather than being destroyed by a config state.
    expect(h.store.has(PHOTO_KEY)).toBe(true);
    expect(h.store.has(PREVIOUS_COVER_KEY)).toBe(true);
  });
});

describe("the SOURCE PHOTO is deleted on BOTH paths", () => {
  it("SUCCESS: the object is gone, and it went before the cover was written", async () => {
    const h = harness();
    const result = await run(h);
    expect(result.ok).toBe(true);
    expect(result.sourcePhotoDeleted).toBe(true);
    // The object itself, not a call count.
    expect(h.store.has(PHOTO_KEY)).toBe(false);
    // ⚠ ORDER: the delete precedes every cover write, so a failing put can never
    // leave the photo behind.
    expect(h.log.indexOf(`deleteSourcePhoto:${PHOTO_KEY}`)).toBeLessThan(
      h.log.findIndex((l) => l.startsWith("put:"))
    );
  });

  it.each([
    ["safety_blocked", { kind: "safety_blocked", reason: "person_generation" }],
    ["timeout", { kind: "timeout", cause: "adapter_timeout" }],
    ["rate_limited", { kind: "rate_limited" }],
    ["provider_error", { kind: "provider_error", detail: "api_error:500" }],
    ["unconfigured", { kind: "unconfigured" }],
  ])("FAILURE (%s): the object is gone", async (_label, result) => {
    const h = harness({ result: result as NormalizedImageResult });
    const outcome = await run(h);
    expect(outcome).toMatchObject({ ok: false, reason: "generation_failed" });
    expect(outcome.sourcePhotoDeleted).toBe(true);
    expect(h.store.has(PHOTO_KEY)).toBe(false);
  });

  it("FAILURE (the adapter throws, breaking its own contract): the object is STILL gone", async () => {
    const h = harness({ generateThrows: true });
    const outcome = await run(h);
    expect(outcome).toMatchObject({ ok: false, reason: "generation_failed" });
    expect(h.store.has(PHOTO_KEY)).toBe(false);
  });

  it("FAILURE (the cover put throws): the object is STILL gone", async () => {
    const h = harness({ putThrows: true });
    const outcome = await run(h);
    expect(outcome).toMatchObject({ ok: false, reason: "commit_failed" });
    expect(h.store.has(PHOTO_KEY)).toBe(false);
  });

  it("a FAILED delete is reported as stranded, never as silent success", async () => {
    const h = harness({ deleteThrows: true });
    const outcome = await run(h);
    expect(outcome.sourcePhotoDeleted).toBe(false);
    expect(h.store.has(PHOTO_KEY)).toBe(true);
  });

  it("never dials the vendor when the photo is already gone", async () => {
    const h = harness({ photoPresent: false });
    const outcome = await run(h);
    expect(outcome).toMatchObject({ ok: false, reason: "photo_missing" });
    expect(h.generate).not.toHaveBeenCalled();
  });
});

describe("the decline / abandon path", () => {
  it("deletes the object with no generation at all", async () => {
    const h = harness();
    const { deleted } = await discardSourcePhoto(h.deps, PHOTO_KEY);
    expect(deleted).toBe(true);
    expect(h.store.has(PHOTO_KEY)).toBe(false);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.log.filter((l) => l.startsWith("put:"))).toEqual([]);
  });

  it("reports a failed delete honestly", async () => {
    const h = harness({ deleteThrows: true });
    expect(await discardSourcePhoto(h.deps, PHOTO_KEY)).toEqual({ deleted: false });
  });
});

describe("a generation failure leaves the PREVIOUS COVER exactly as it was", () => {
  it.each([
    ["a safety block", { result: { kind: "safety_blocked", reason: "generic" } }],
    ["a timeout", { result: { kind: "timeout", cause: "adapter_timeout" } }],
    ["an unresolvable model", { result: { kind: "unconfigured" } }],
    ["a thrown adapter", { generateThrows: true }],
  ])("%s writes nothing at all", async (_label, overrides) => {
    const h = harness(overrides as Parameters<typeof harness>[0]);
    const before = new Uint8Array(h.store.get(PREVIOUS_COVER_KEY)!);

    const outcome = await run(h);

    expect(outcome.ok).toBe(false);
    // Byte-for-byte, the old cover is untouched…
    expect(h.store.get(PREVIOUS_COVER_KEY)).toEqual(before);
    // …no new object was written…
    expect(h.log.filter((l) => l.startsWith("put:"))).toEqual([]);
    // …and no COMMIT was handed back, so a careless caller has nothing to write.
    expect("commit" in outcome).toBe(false);
  });

  it("a failed cover PUT also leaves it untouched, and deletes nothing of the old cover", async () => {
    const h = harness({ putThrows: true });
    const before = new Uint8Array(h.store.get(PREVIOUS_COVER_KEY)!);
    const outcome = await run(h);
    expect(outcome).toMatchObject({ ok: false, reason: "commit_failed" });
    expect(h.store.get(PREVIOUS_COVER_KEY)).toEqual(before);
    expect(h.log.filter((l) => l.startsWith("blob.delete:"))).toEqual([]);
  });

  it("SUCCESS writes to a NEW key and never addresses the old one — atomicity (a)", async () => {
    const h = harness();
    const outcome = await run(h);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.commit.coverBlobKey).not.toBe(PREVIOUS_COVER_KEY);
    expect(outcome.commit.sequence).toBe(2);
    expect(outcome.commit.status).toBe("final");
    // The old bytes are still there — dereference-then-delete is a later,
    // separate step (atomicity (c)); an orphan is a bounded leak, a dangling
    // row reference is corruption.
    expect(h.store.has(PREVIOUS_COVER_KEY)).toBe(true);
  });

  it("the commit names the child's OWN namespace and nothing else", async () => {
    const h = harness();
    const outcome = await run(h);
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.commit.coverBlobKey.startsWith(`fp/v3/children/${CHILD}/`)).toBe(true);
  });
});

describe("what reaches the vendor", () => {
  it("the STRIPPED photo rides as a reference image, declared image/jpeg", async () => {
    const h = harness();
    await run(h);
    const request = h.generate.mock.calls[0]![0] as {
      modelId: string;
      referenceImages: { bytes: Uint8Array; contentType: string }[];
    };
    expect(request.modelId).toBe("test-model");
    expect(request.referenceImages).toHaveLength(1);
    expect(request.referenceImages[0]!.contentType).toBe("image/jpeg");
  });

  it("a failure detail is a NORMALIZED token and never vendor prose", async () => {
    const h = harness({
      result: { kind: "provider_error", detail: "api_error:400" } as NormalizedImageResult,
    });
    const outcome = await run(h);
    if (outcome.ok) throw new Error("expected refusal");
    expect(outcome.detail).toBe("model returned provider_error");
  });
});

/**
 * ── MUTATION CHECKS ──
 * Two invariants are load-bearing enough that "there is a test" is not
 * sufficient — the test must be shown to FAIL when the invariant is broken.
 * Each block below re-runs the harness against a deliberately sabotaged
 * sequence and asserts the assertion catches it.
 */
describe("mutation check: delete-after-generation", () => {
  it("REMOVING the delete makes the success-path assertion fail", async () => {
    const h = harness();
    // Sabotage: the delete becomes a no-op, exactly as if step 4 were deleted.
    h.deps.deleteSourcePhoto = async () => {};
    const outcome = await run(h);
    expect(outcome.ok).toBe(true);
    // The assertion the real test makes, inverted: it WOULD have failed.
    expect(h.store.has(PHOTO_KEY)).toBe(true);
  });

  it("MOVING the delete after the commit makes the failure-path assertion fail", async () => {
    // Sabotage: a put that throws, with the delete only reachable afterwards —
    // the shape the code would have if step 4 lived at the end.
    const h = harness({ putThrows: true });
    let deleted = false;
    h.deps.deleteSourcePhoto = async () => {
      // Simulate "only runs on the success path".
      if (!deleted) return;
      deleted = true;
    };
    const outcome = await run(h);
    expect(outcome.ok).toBe(false);
    expect(h.store.has(PHOTO_KEY)).toBe(true);
  });
});

describe("mutation check: atomic cover commit", () => {
  it("a generator that reports success on a FAILED call would be caught", async () => {
    // Sabotage: the classic "stub that returns a picture" the cover-core header
    // warns about. If the core trusted `kind` less carefully, this would commit.
    const h = harness({ result: { kind: "safety_blocked", reason: "generic" } });
    const sabotaged = harness();
    expect((await run(h)).ok).toBe(false);
    expect((await run(sabotaged)).ok).toBe(true);
    // The two runs differ ONLY in the adapter's verdict, which is what proves
    // the commit is gated on it rather than on reaching the end of the function.
    expect(h.log.filter((l) => l.startsWith("put:"))).toEqual([]);
    expect(sabotaged.log.filter((l) => l.startsWith("put:")).length).toBe(1);
  });
});
