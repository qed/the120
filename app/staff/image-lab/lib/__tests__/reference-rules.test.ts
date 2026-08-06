import { describe, expect, it } from "vitest";
import {
  clampReferenceSelection,
  decideReferenceRefresh,
  decideReferenceRegistration,
  decideReferenceUpload,
  describeReferenceRefusal,
  formatMegabytes,
  IMAGE_LAB_REFERENCE_COPY,
  IMAGE_LAB_REFERENCE_LABEL_MAX,
  IMAGE_LAB_REFERENCE_MINT_RETRY_DELAYS_MS,
  IMAGE_LAB_REFERENCE_MINT_RETRY_LIMIT,
  IMAGE_LAB_REFERENCE_PREFIX,
  IMAGE_LAB_REFERENCE_REMINT_SKEW_MS,
  IMAGE_LAB_REFERENCE_URL_TTL_SECONDS,
  isReferenceStorageKey,
  normalizeReferenceLabel,
  reduceUploadStep,
  refImageLimitFor,
  referenceStorageKey,
  toggleReferenceSelection,
  uploadButtonLabel,
  type ReferenceRefusal,
} from "../reference-rules";
import { IMAGE_LAB_ACCEPTED_MIME_TYPES, IMAGE_LAB_MAX_OBJECT_BYTES } from "../image-lab-rules";
import { IMAGE_LAB_MODELS } from "../model-registry";

const UUID = "6b1f5f6e-6a5e-4a1e-9b62-1f2b3c4d5e6f";
const KEY = `${IMAGE_LAB_REFERENCE_PREFIX}/${UUID}`;

// ── Storage keys ─────────────────────────────────────────────────────────────

describe("reference storage keys", () => {
  it("mints per-upload uuid keys under the references/ prefix", () => {
    expect(referenceStorageKey(UUID)).toBe(KEY);
    expect(isReferenceStorageKey(referenceStorageKey(UUID))).toBe(true);
  });

  it("refuses a key that is not one this feature minted", () => {
    // The registration action takes this from the BROWSER. Without the check a
    // caller could register a GENERATED image (runs/…) as a reference, or point
    // a row at any other object in the bucket and be served a signed URL for it.
    expect(isReferenceStorageKey(`runs/${UUID}/${UUID}`)).toBe(false);
    expect(isReferenceStorageKey(`${IMAGE_LAB_REFERENCE_PREFIX}/../runs/x`)).toBe(false);
    expect(isReferenceStorageKey(`${IMAGE_LAB_REFERENCE_PREFIX}/nested/${UUID}`)).toBe(false);
    expect(isReferenceStorageKey(`${IMAGE_LAB_REFERENCE_PREFIX}/not-a-uuid`)).toBe(false);
    expect(isReferenceStorageKey(`x${KEY}`)).toBe(false);
    expect(isReferenceStorageKey(null)).toBe(false);
    expect(isReferenceStorageKey(42)).toBe(false);
  });
});

// ── Labels ───────────────────────────────────────────────────────────────────

describe("labels", () => {
  it("trims, collapses whitespace, and flattens control characters", () => {
    expect(normalizeReferenceLabel("  Hero   sheet  ")).toBe("Hero sheet");
    expect(normalizeReferenceLabel("Hero\nsheet\tv2")).toBe("Hero sheet v2");
    expect(normalizeReferenceLabel("Hero sheet")).toBe("Hero sheet");
    expect(normalizeReferenceLabel(undefined)).toBe("");
    expect(normalizeReferenceLabel(12)).toBe("");
  });

  it("REFUSES an over-long label rather than silently truncating it", () => {
    // The row can never be edited (append-only trigger), so storing something
    // the staff member did not type is not recoverable.
    const long = "x".repeat(IMAGE_LAB_REFERENCE_LABEL_MAX + 1);
    const decision = decideReferenceUpload({
      declaredContentType: "image/png",
      sizeBytes: 1024,
      label: long,
    });
    expect(decision).toEqual({ ok: false, reason: "label_too_long" });
    expect(describeReferenceRefusal(decision as ReferenceRefusal)).toContain(
      String(IMAGE_LAB_REFERENCE_LABEL_MAX)
    );
  });

  it("REFUSES a 481-character label with the same refusal, naming the cap", () => {
    // ⚠ MUTATION SENTINEL (review finding 15). The action's zod schema used to
    // carry `.max(LABEL_MAX * 4)`, so a label past 480 came back `invalid_input`
    // ("That request was not understood") instead of the refusal that names the
    // number — one field, validated twice, against two different bounds. The
    // pure rule owns it now; restoring the zod bound reddens the action test.
    const decision = decideReferenceUpload({
      declaredContentType: "image/png",
      sizeBytes: 1024,
      label: "x".repeat(IMAGE_LAB_REFERENCE_LABEL_MAX * 4 + 1),
    });
    expect(decision).toEqual({ ok: false, reason: "label_too_long" });
  });
});

// ── The pre-upload decision ──────────────────────────────────────────────────

describe("decideReferenceUpload", () => {
  it("accepts a valid image and canonicalizes its type", () => {
    const decision = decideReferenceUpload({
      // RFC 2045: type/subtype is case-insensitive and parameters are legal.
      declaredContentType: "image/PNG; charset=binary",
      sizeBytes: 4096,
      label: " Hero sheet ",
    });
    expect(decision).toEqual({
      ok: true,
      contentType: "image/png",
      label: "Hero sheet",
      sizeBytes: 4096,
      strategy: "plain",
    });
  });

  it("routes a big sheet to the resumable leg at the 6 MiB boundary", () => {
    const under = decideReferenceUpload({
      declaredContentType: "image/png",
      sizeBytes: 6 * 1024 * 1024 - 1,
    });
    const at = decideReferenceUpload({
      declaredContentType: "image/png",
      sizeBytes: 6 * 1024 * 1024,
    });
    expect(under.ok && under.strategy).toBe("plain");
    expect(at.ok && at.strategy).toBe("tus");
  });

  it("REFUSES a file over the cap with a refusal NAMING the cap", () => {
    // ⚠ MUTATION SENTINEL (Unit 4 requirement 6). Deleting the size check in
    // the shared ladder must redden here. A generic failure would send a staff
    // member to re-export a character sheet at random sizes.
    const sizeBytes = IMAGE_LAB_MAX_OBJECT_BYTES + 1;
    const decision = decideReferenceUpload({ declaredContentType: "image/png", sizeBytes });
    expect(decision).toEqual({ ok: false, reason: "too_large", sizeBytes });
    const message = describeReferenceRefusal(decision as ReferenceRefusal);
    expect(message).toContain(formatMegabytes(IMAGE_LAB_MAX_OBJECT_BYTES));
    expect(message).toContain("25 MB");
  });

  it("accepts a file exactly at the cap", () => {
    expect(
      decideReferenceUpload({
        declaredContentType: "image/png",
        sizeBytes: IMAGE_LAB_MAX_OBJECT_BYTES,
      }).ok
    ).toBe(true);
  });

  it("refuses an empty file before discussing its type", () => {
    expect(decideReferenceUpload({ declaredContentType: "text/html", sizeBytes: 0 })).toEqual({
      ok: false,
      reason: "empty_file",
    });
  });

  it.each(["image/svg+xml", "text/html", "application/pdf", "image/gif", "video/mp4", ""])(
    "refuses %s at the rules level",
    (type) => {
      // SVG is the one that matters most: an SVG is an executable document, and
      // this bucket's objects are served by signed URL into a staff browser.
      const decision = decideReferenceUpload({ declaredContentType: type, sizeBytes: 1024 });
      expect(decision.ok).toBe(false);
      expect((decision as ReferenceRefusal).reason).toBe("unsupported_type");
      expect(describeReferenceRefusal(decision as ReferenceRefusal)).toContain("image/png");
    }
  );

  it("refuses a missing type rather than defaulting to one", () => {
    expect(decideReferenceUpload({ declaredContentType: null, sizeBytes: 1024 }).ok).toBe(false);
    expect(decideReferenceUpload({ declaredContentType: undefined, sizeBytes: 1024 }).ok).toBe(
      false
    );
  });
});

// ── The registration decision (what reaches the row) ─────────────────────────

describe("decideReferenceRegistration — the SERVER pins the content type", () => {
  it("A CLIENT-DECLARED TYPE CANNOT WIN: the row's type comes from the object", () => {
    // ⚠ MUTATION SENTINEL (Unit 4 requirement 3). The client said PNG; Storage
    // observed WebP. Trusting the client here — passing a declared type through
    // to the row — must redden this test. The function deliberately takes NO
    // client-declared type parameter at all, so a mutation has to add one.
    const decision = decideReferenceRegistration({
      observedContentType: "image/webp",
      observedSizeBytes: 2048,
      label: "claims to be a png",
    });
    expect(decision).toEqual({
      ok: true,
      contentType: "image/webp",
      byteSize: 2048,
      label: "claims to be a png",
    });
    // THE SIGNATURE IS THE GUARANTEE: one argument, carrying only
    // server-observed facts — there is nowhere to put a declared type. Kept
    // through the collapse of the two decision ladders into one shared
    // validator, which is exactly the refactor that could have quietly widened
    // it into `(observed, declared)`.
    expect(decideReferenceRegistration.length).toBe(1);
  });

  it("refuses when the object is NOT an accepted image, whatever was declared", () => {
    const decision = decideReferenceRegistration({
      observedContentType: "image/svg+xml",
      observedSizeBytes: 2048,
    });
    expect(decision).toEqual({
      ok: false,
      reason: "unsupported_type",
      declared: "image/svg+xml",
    });
  });

  it("canonicalizes a parameterized observed type onto the row", () => {
    const decision = decideReferenceRegistration({
      observedContentType: "IMAGE/JPEG; charset=binary",
      observedSizeBytes: 10,
    });
    expect(decision.ok && decision.contentType).toBe("image/jpeg");
  });

  it("enforces the size cap against the OBSERVED size, naming the cap", () => {
    // ⚠ MUTATION SENTINEL (Unit 4 requirement 6, registration leg).
    const decision = decideReferenceRegistration({
      observedContentType: "image/png",
      observedSizeBytes: IMAGE_LAB_MAX_OBJECT_BYTES + 1,
    });
    expect(decision).toEqual({
      ok: false,
      reason: "too_large",
      sizeBytes: IMAGE_LAB_MAX_OBJECT_BYTES + 1,
    });
    expect(describeReferenceRefusal(decision as ReferenceRefusal)).toContain(
      formatMegabytes(IMAGE_LAB_MAX_OBJECT_BYTES)
    );
  });

  it("refuses an unreadable or zero size rather than storing 0", () => {
    // byte_size carries `check (byte_size > 0 …)`, so a 0 would be a constraint
    // violation surfacing as an opaque insert failure after the bytes landed.
    expect(
      decideReferenceRegistration({ observedContentType: "image/png", observedSizeBytes: null }).ok
    ).toBe(false);
    expect(
      decideReferenceRegistration({ observedContentType: "image/png", observedSizeBytes: 0 }).ok
    ).toBe(false);
  });

  it("applies the SAME ladder in the SAME order as the upload leg", () => {
    // The two entry points share one private validator, and the shared order is
    // the thing worth pinning: an over-cap file that is ALSO not an image is
    // `too_large` on both legs, so the two boundaries can never disagree about
    // which refusal a staff member is shown.
    const both = { sizeBytes: IMAGE_LAB_MAX_OBJECT_BYTES + 1 };
    expect(
      decideReferenceUpload({ declaredContentType: "application/pdf", ...both })
    ).toMatchObject({ reason: "too_large" });
    expect(
      decideReferenceRegistration({
        observedContentType: "application/pdf",
        observedSizeBytes: both.sizeBytes,
      })
    ).toMatchObject({ reason: "too_large" });
  });
});

// ── The ref-limit counter ────────────────────────────────────────────────────

describe("the reference budget", () => {
  it("is the STRICTEST limit across the chosen models", () => {
    const limits = IMAGE_LAB_MODELS.map((m) => m.refImageLimit);
    const ids = IMAGE_LAB_MODELS.map((m) => m.id);
    expect(refImageLimitFor(ids)).toBe(Math.min(...limits));
    // A compare run sends the same references to every column, so the maximum
    // would build a selection that silently fails on the strictest model.
    expect(refImageLimitFor(ids)).not.toBe(Math.max(...limits));
  });

  it("falls back to the registry minimum when no model is chosen yet", () => {
    expect(refImageLimitFor([])).toBe(Math.min(...IMAGE_LAB_MODELS.map((m) => m.refImageLimit)));
  });

  it("reads one model's own limit when only it is chosen", () => {
    for (const model of IMAGE_LAB_MODELS) {
      expect(refImageLimitFor([model.id])).toBe(model.refImageLimit);
    }
  });
});

describe("selection is BLOCKED at the limit, with the count visible", () => {
  it("selects up to the limit and then refuses, naming it", () => {
    let selected: string[] = [];
    for (const id of ["a", "b", "c"]) {
      const step = toggleReferenceSelection({ selectedIds: selected, id, limit: 3 });
      expect(step.ok).toBe(true);
      selected = step.selectedIds;
    }
    expect(selected).toEqual(["a", "b", "c"]);

    const blocked = toggleReferenceSelection({ selectedIds: selected, id: "d", limit: 3 });
    expect(blocked).toEqual({
      ok: false,
      reason: "limit_reached",
      limit: 3,
      selectedIds: ["a", "b", "c"],
    });
    expect(IMAGE_LAB_REFERENCE_COPY.picker.limitReached(3)).toContain("3");
  });

  it("renders the count as text, not a hover affordance", () => {
    expect(IMAGE_LAB_REFERENCE_COPY.selectionCounter(2, 4)).toBe("2 of 4 selected");
    expect(IMAGE_LAB_REFERENCE_COPY.selectionCounter(0, 4)).toBe("0 of 4 selected");
  });

  it("NEVER refuses a deselection, even from an over-limit selection", () => {
    // Reachable when references are picked first and a stricter model second.
    // Refusing here would wedge that selection permanently.
    expect(
      toggleReferenceSelection({ selectedIds: ["a", "b", "c", "d"], id: "b", limit: 2 })
    ).toEqual({ ok: true, selectedIds: ["a", "c", "d"] });
  });

  it("preserves pick order, because that is the order sent to the model", () => {
    const first = toggleReferenceSelection({ selectedIds: ["a"], id: "b", limit: 4 });
    const second = toggleReferenceSelection({
      selectedIds: first.selectedIds,
      id: "c",
      limit: 4,
    });
    expect(second.selectedIds).toEqual(["a", "b", "c"]);
  });

  it("clamps an existing selection to a newly stricter limit, keeping the earliest", () => {
    expect(clampReferenceSelection(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
    expect(clampReferenceSelection(["a"], 4)).toEqual(["a"]);
    expect(clampReferenceSelection(["a"], 0)).toEqual([]);
  });

  it("clamps the real Gemini→gpt-image-2 case the counter used to conceal", () => {
    // Eleven picked under the Gemini pair, then gpt-image-2 (4) chosen. The
    // picker COMMITS this array; rendering it without reporting it is what let
    // "4 of 4 selected" sit over a parent still holding eleven.
    const eleven = Array.from({ length: 11 }, (_, i) => `ref-${i}`);
    const strictest = Math.min(...IMAGE_LAB_MODELS.map((m) => m.refImageLimit));
    expect(clampReferenceSelection(eleven, strictest)).toHaveLength(strictest);
  });
});

// ── The refresh decision ─────────────────────────────────────────────────────

const url = (expiresAtMs: number | null) => ({ signedUrl: "https://s/x", expiresAtMs });
const failedMint = { signedUrl: null, expiresAtMs: null };

describe("decideReferenceRefresh", () => {
  const nowMs = 1_000_000_000;
  const base = { nowMs, failedMintRounds: 0, lastListedAtMs: nowMs - 60_000 };

  it("uses a skew PROPORTIONAL to this feature's 10-minute TTL, not the inherited 5 minutes", () => {
    // ⚠ MUTATION SENTINEL (review finding 7, second half). `evidence-rules`'
    // SIGNED_URL_REMINT_SKEW_MS is 300s, tuned against a ONE-HOUR TTL. Against
    // ten minutes that is a 5/10 skew: every URL is "near expiry" for half its
    // life and the picker re-mints all sixty every five minutes, forever.
    expect(IMAGE_LAB_REFERENCE_REMINT_SKEW_MS).toBe(60_000);
    expect(IMAGE_LAB_REFERENCE_REMINT_SKEW_MS).toBeLessThan(
      (IMAGE_LAB_REFERENCE_URL_TTL_SECONDS * 1000) / 4
    );
    // Five minutes into a ten-minute URL is NOT stale under this skew.
    expect(
      decideReferenceRefresh({ ...base, references: [url(nowMs + 5 * 60_000)] })
    ).toEqual({ refresh: false });
  });

  it("refreshes a URL inside the skew", () => {
    expect(
      decideReferenceRefresh({ ...base, references: [url(nowMs + 30_000)] })
    ).toEqual({ refresh: true, cause: "near_expiry" });
    expect(
      decideReferenceRefresh({ ...base, references: [url(nowMs - 1)] })
    ).toEqual({ refresh: true, cause: "near_expiry" });
  });

  it("does NOT treat a FAILED MINT as always-stale", () => {
    // ⚠ MUTATION SENTINEL (review finding 7, first half). A failed mint arrives
    // with a null expiry. The inherited `shouldRemintSignedUrl` reads null as
    // "never minted, ask now" — correct there, a feedback loop here: the
    // sixty-second poll fires sixty concurrent createSignedUrl calls into
    // already-degraded storage every minute for the life of the tab.
    expect(
      decideReferenceRefresh({
        ...base,
        references: [failedMint],
        lastListedAtMs: nowMs - 1_000,
      })
    ).toEqual({ refresh: false });
  });

  it("retries a failed mint on a WIDENING backoff", () => {
    for (const [round, delay] of IMAGE_LAB_REFERENCE_MINT_RETRY_DELAYS_MS.entries()) {
      expect(
        decideReferenceRefresh({
          ...base,
          references: [failedMint],
          failedMintRounds: round,
          lastListedAtMs: nowMs - delay + 1,
        }),
        `round ${round} must still be waiting`
      ).toEqual({ refresh: false });
      expect(
        decideReferenceRefresh({
          ...base,
          references: [failedMint],
          failedMintRounds: round,
          lastListedAtMs: nowMs - delay,
        }),
        `round ${round} must fire at its delay`
      ).toEqual({ refresh: true, cause: "mint_retry" });
    }
  });

  it("STOPS after the retry cap rather than hammering storage forever", () => {
    expect(
      decideReferenceRefresh({
        ...base,
        references: [failedMint],
        failedMintRounds: IMAGE_LAB_REFERENCE_MINT_RETRY_LIMIT,
        lastListedAtMs: nowMs - 24 * 60 * 60_000,
      })
    ).toEqual({ refresh: false });
  });

  it("near-expiry beats the backoff — a live URL must never be allowed to lapse", () => {
    expect(
      decideReferenceRefresh({
        ...base,
        references: [failedMint, url(nowMs + 1_000)],
        failedMintRounds: IMAGE_LAB_REFERENCE_MINT_RETRY_LIMIT,
      })
    ).toEqual({ refresh: true, cause: "near_expiry" });
  });

  it("asks for nothing when there is nothing to ask about", () => {
    expect(decideReferenceRefresh({ ...base, references: [] })).toEqual({ refresh: false });
    expect(
      decideReferenceRefresh({ ...base, references: [url(nowMs + 10 * 60_000)] })
    ).toEqual({ refresh: false });
  });
});

// ── The upload reducer ───────────────────────────────────────────────────────

const refusal = (reason: ReferenceRefusal["reason"]): ReferenceRefusal =>
  reason === "unsupported_type"
    ? { ok: false, reason, declared: "text/html" }
    : reason === "too_large"
      ? { ok: false, reason, sizeBytes: 99 }
      : ({ ok: false, reason } as ReferenceRefusal);

describe("the upload step reducer — the picker's decisions, made where they can be tested", () => {
  it("names an empty submit instead of doing nothing at all", () => {
    // It used to be a SILENT no-op: no notice, no phase change, and the input
    // was not `required` — a tap that appears to do nothing on a phone.
    const state = reduceUploadStep({ type: "submitted_without_file" });
    expect(state.phase).toBe("idle");
    expect(state.notice).toEqual({ tone: "bad", text: IMAGE_LAB_REFERENCE_COPY.upload.noFile });
  });

  it("reports a LOCAL refusal with the sentence that names the bound", () => {
    const state = reduceUploadStep({ type: "refused_locally", refusal: refusal("too_large") });
    expect(state.phase).toBe("idle");
    expect(state.notice?.tone).toBe("bad");
    expect(state.notice?.text).toContain("capped at");
  });

  it("reports a SLOT refusal the same way — the server's answer is not a different kind", () => {
    const state = reduceUploadStep({ type: "slot_refused", refusal: refusal("unavailable") });
    expect(state).toEqual({
      phase: "idle",
      notice: { tone: "bad", text: IMAGE_LAB_REFERENCE_COPY.refusals.unavailable },
    });
  });

  it("moves to uploading once a slot exists, clearing any earlier notice", () => {
    expect(reduceUploadStep({ type: "slot_minted" })).toEqual({
      phase: "uploading",
      notice: null,
    });
  });

  it("shows PROGRESS — a 25 MB phone upload with no feedback reads as a hung page", () => {
    expect(reduceUploadStep({ type: "transfer_progressed", percent: 42 })).toEqual({
      phase: "uploading",
      notice: { tone: "ok", text: IMAGE_LAB_REFERENCE_COPY.upload.uploadingPercent(42) },
    });
  });

  it("a TRANSFER FAILURE is NOT terminal — registration still decides", () => {
    // ⚠ MUTATION SENTINEL. `uploadWithSlot` returns `retry` for any thrown
    // transport error, INCLUDING one thrown after the bytes landed and the ack
    // was lost. The browser is not the authority on whether the object exists;
    // statObject is. Ending the flow here is how a completed upload gets
    // re-uploaded into a second permanent row.
    const state = reduceUploadStep({ type: "transfer_failed", message: "network lost" });
    expect(state.phase).toBe("saving");
    expect(state.notice).toEqual({ tone: "bad", text: "network lost" });
  });

  it("reports a REGISTRATION refusal and returns to idle", () => {
    const state = reduceUploadStep({
      type: "registration_refused",
      refusal: refusal("object_missing"),
    });
    expect(state).toEqual({
      phase: "idle",
      notice: { tone: "bad", text: IMAGE_LAB_REFERENCE_COPY.refusals.objectMissing },
    });
  });

  it("distinguishes a DUPLICATE from a fresh save — both are successes", () => {
    expect(reduceUploadStep({ type: "registered", duplicate: false })).toEqual({
      phase: "idle",
      notice: { tone: "ok", text: IMAGE_LAB_REFERENCE_COPY.upload.succeeded },
    });
    expect(reduceUploadStep({ type: "registered", duplicate: true })).toEqual({
      phase: "idle",
      notice: { tone: "ok", text: IMAGE_LAB_REFERENCE_COPY.upload.duplicate },
    });
  });

  it("maps a thrown anything to the unavailable sentence, back at idle", () => {
    expect(reduceUploadStep({ type: "threw" })).toEqual({
      phase: "idle",
      notice: { tone: "bad", text: IMAGE_LAB_REFERENCE_COPY.refusals.unavailable },
    });
  });

  it("EVERY terminal event returns the form to idle — a stuck phase disables submit forever", () => {
    const terminal = [
      { type: "submitted_without_file" },
      { type: "refused_locally", refusal: refusal("empty_file") },
      { type: "slot_refused", refusal: refusal("invalid_input") },
      { type: "registration_refused", refusal: refusal("invalid_key") },
      { type: "registered", duplicate: false },
      { type: "threw" },
    ] as const;
    for (const event of terminal) {
      expect(reduceUploadStep(event).phase, event.type).toBe("idle");
    }
  });

  it("labels the submit button per phase, and never leaves it blank", () => {
    for (const phase of ["idle", "preparing", "uploading", "saving"] as const) {
      expect(uploadButtonLabel(phase).length, phase).toBeGreaterThan(3);
    }
    expect(uploadButtonLabel("idle")).toBe(IMAGE_LAB_REFERENCE_COPY.upload.submit);
    expect(new Set((["idle", "preparing", "uploading", "saving"] as const).map(uploadButtonLabel)).size)
      .toBe(4);
  });
});

// ── Copy ─────────────────────────────────────────────────────────────────────

describe("copy", () => {
  it("states the permanence rule the migration header commits the UI to", () => {
    const body = IMAGE_LAB_REFERENCE_COPY.permanence.body.toLowerCase();
    expect(body).toContain("cannot be deleted");
    // The three named cases, verbatim from the migration header.
    expect(body).toContain("drawing");
    expect(body).toContain("product photo");
    expect(body).toContain("likeness");
    expect(body).toContain("unrecoverable");
  });

  it("names the size cap and the accepted types on the upload surface", () => {
    expect(IMAGE_LAB_REFERENCE_COPY.upload.accepted).toContain(
      formatMegabytes(IMAGE_LAB_MAX_OBJECT_BYTES)
    );
    expect(IMAGE_LAB_REFERENCE_COPY.upload.accepted).toMatch(/PNG.*JPEG.*WebP/);
  });

  it("says out loud that a capped page is a capped page", () => {
    // The table is append-only and unpaged, so at row 61 the OLDEST hero sheet
    // leaves the grid. A library that loses one silently is worse than one that
    // says it has more.
    const line = IMAGE_LAB_REFERENCE_COPY.picker.showingSome(60, 214);
    expect(line).toContain("60");
    expect(line).toContain("214");
  });

  it("formats byte counts the way the cap reads — and never renders a real file as 0 MB", () => {
    expect(formatMegabytes(IMAGE_LAB_MAX_OBJECT_BYTES)).toBe("25 MB");
    expect(formatMegabytes(1024 * 1024)).toBe("1 MB");
    expect(formatMegabytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    // A 30 KB style swatch is a legitimate upload; "0 MB" on its card reads as
    // a corrupt row.
    expect(formatMegabytes(30 * 1024)).toBe("30 KB");
    expect(formatMegabytes(1)).toBe("1 KB");
    expect(formatMegabytes(50 * 1024)).not.toContain("0 MB");
  });

  it("has a message for EVERY refusal reason", () => {
    // A refusal with no sentence renders as an empty error, which is the
    // generic failure this unit exists to avoid.
    const refusals: ReferenceRefusal[] = [
      { ok: false, reason: "unsupported_type", declared: "text/html" },
      { ok: false, reason: "too_large", sizeBytes: 99 },
      { ok: false, reason: "empty_file" },
      { ok: false, reason: "label_too_long" },
      { ok: false, reason: "invalid_key" },
      { ok: false, reason: "object_missing" },
      { ok: false, reason: "invalid_input" },
      { ok: false, reason: "unavailable" },
    ];
    for (const r of refusals) {
      expect(describeReferenceRefusal(r).length, r.reason).toBeGreaterThan(10);
    }
    // …and the unsupported-type sentence lists the allowlist even though the
    // refusal no longer ships a copy of it.
    expect(describeReferenceRefusal(refusals[0])).toContain(
      IMAGE_LAB_ACCEPTED_MIME_TYPES.join(", ")
    );
  });
});
