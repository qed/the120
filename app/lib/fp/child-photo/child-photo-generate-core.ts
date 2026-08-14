import "server-only";

/**
 * THE GENERATION SEQUENCE: a stripped source photo in, a committed cover or an
 * untouched cover out, and NO SOURCE PHOTO LEFT EITHER WAY.
 *
 * Deps-injected throughout (the house core-module pattern) so every ordering
 * claim below is something a test can OBSERVE rather than something a comment
 * asserts. Nothing here reads process.env, constructs a client, or imports the
 * `ai` SDK.
 *
 * ── WHAT IS REUSED, NOT REWRITTEN ──
 *   * THE PROVIDER CALL AND ITS FAILURE TAXONOMY — `generateLabImage` from
 *     app/staff/image-lab/lib/image-model.ts, injected as {@link ChildPhotoGenerateDeps.generate}.
 *     That module already owns: the two call paths (`generateImage` vs
 *     multimodal `generateText`), `maxRetries: 0` (so one attempt is one
 *     charge), per-model `AbortSignal.timeout`, the CONTENT SNIFF that refuses
 *     to trust a vendor-declared media type, safety classification from
 *     STRUCTURED fields only, and the normalization of every outcome —
 *     including a thrown vendor exception — into `NormalizedImageResult`. None
 *     of that is re-implemented here and none of it should be.
 *   * THE MODEL FACTS — the registry, via `FP_COVER_MODEL_ID`.
 *   * THE TWO-STORE ORDERING — `putCoverConfirmed` from
 *     app/lib/fp/cover-store.ts (rule 1: the object is confirmed before any row
 *     claims a status implying it) and the key scheme from cover-store-rules
 *     (a cover key carries its generation number, so a new cover NEVER
 *     overwrites the old one).
 * What is written fresh: the sequencing below, and only the sequencing.
 *
 * ── THE ORDER, AND WHY EACH STEP IS WHERE IT IS ──
 *
 *   1. GATE. Fail-closed before anything is read. A dark build must not so much
 *      as open the photo.
 *   1b. ⚠ CHOOSE THE GENERATOR, from `FP_COVER_PLACEHOLDER_MODE` ALONE. The real
 *      model, or the hand-drawn PLACEHOLDER KITTEN
 *      (./child-photo-placeholder-generator.ts). Made here, before anything is
 *      read, precisely so it cannot be made LATER in response to a failure: there
 *      is no fallback branch anywhere below, and there must never be one. See
 *      step 1b in the code for the full argument.
 *   2. READ the stripped source photo. If it is gone, refuse — there is nothing
 *      to delete and nothing to draw from.
 *   3. GENERATE. Exactly one attempt (the adapter's `maxRetries: 0`).
 *   4. ⚠ DELETE THE SOURCE PHOTO. IMMEDIATELY, UNCONDITIONALLY, AND BEFORE ANY
 *      COVER WORK. This is step 4 and not step 6 on purpose: putting it after
 *      the cover commit would make the photo's deletion depend on the success of
 *      a LATER, FALLIBLE step, and "the storage put failed so we kept the
 *      child's photograph" is not a failure mode this pipeline may have. By
 *      running it here, every path that reached the vendor — success, safety
 *      block, timeout, rate limit, provider error, unconfigured — is downstream
 *      of the delete.
 *   5. If generation did not produce bytes: RETURN. Nothing about the cover has
 *      been read, written, or decided. See the atomicity note below.
 *   6. COMMIT: put the new object, confirm it, then hand the caller the row
 *      update it is now allowed to make.
 *
 * ── ATOMICITY OF THE COVER COMMIT ──
 * "A failure leaves the previous cover exactly as it was" is not enforced by a
 * transaction — Postgres and object storage cannot be written atomically, which
 * is the premise cover-store-rules is built on. It is enforced by CONSTRUCTION,
 * in three parts:
 *   (a) the new object goes to a NEW KEY (`cover-<sequence+1>.<ext>`), so the
 *       previous cover's bytes are never addressed, let alone overwritten;
 *   (b) the row update is the LAST thing, is performed by the caller, and is
 *       only reachable through {@link CoverCommit} — which this module returns
 *       ONLY on the success path. There is no field a failure result could
 *       carry that a careless caller might write anyway;
 *   (c) the old key is NOT deleted here. Dereference-then-delete (rule 2) is a
 *       separate, later step owned by the reaper, so a regeneration that fails
 *       midway leaves at worst an orphan — a bounded leak — and never a row
 *       pointing at bytes that no longer exist.
 */

import {
  putCoverConfirmed,
  type BlobPort,
  type BlobReader,
} from "@/app/lib/fp/cover-store";
import type { CoverOwnerScope, CoverStatus } from "@/app/lib/fp/cover-store-rules";
import type { NormalizedImageResult } from "@/app/staff/image-lab/lib/image-model-rules";
import {
  FP_COVER_MODEL_ID,
  isChildPhotoLive,
  isCoverPlaceholderMode,
  coverDataUrl,
} from "./child-photo-rules";
import { STRIPPED_PHOTO_CONTENT_TYPE } from "./photo-strip";

/* ------------------------------------------------------------------- deps */

/** The Image Lab adapter's shape, narrowed to what this pipeline calls. Typed
 *  structurally so `generateLabImage` satisfies it without this module
 *  importing the `server-only`, SDK-bearing implementation. */
export type CoverImageGenerator = (request: {
  modelId: string;
  prompt: string;
  referenceImages?: readonly { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" | "image/webp" }[];
  abortSignal?: AbortSignal;
}) => Promise<NormalizedImageResult>;

export type ChildPhotoGenerateDeps = {
  /** Storage. Only `put` is used here; `delete` is reached through
   *  {@link ChildPhotoGenerateDeps.deleteSourcePhoto} so the deletion is
   *  separately observable in a test. */
  blob: BlobPort;
  /** Reads the stripped source photo back out. */
  readBytes: BlobReader;
  /**
   * THE source-photo delete. A dedicated dep rather than `blob.delete` so a test
   * can assert "this was called, with this key, on this path" without also
   * matching the cover writes — and so the mutation check on the
   * delete-after-generation invariant has a single seam to break.
   */
  deleteSourcePhoto: (key: string) => Promise<void>;
  /** THE REAL ONE. The model. Dialled unless the placeholder switch is on. */
  generate: CoverImageGenerator;
  /**
   * ⚠⚠ THE PLACEHOLDER GENERATOR. The hand-drawn kitten
   * (./child-photo-placeholder-generator.ts), supplied by a caller that has
   * decided to run in placeholder mode.
   *
   * SEPARATE FIELD, NOT A SUBSTITUTED `generate`, on purpose: the field name is
   * the audit trail. `grep generatePlaceholder` finds every caller that can
   * possibly produce a kitten, which a caller that quietly passed the kitten as
   * `generate` would hide completely.
   */
  generatePlaceholder?: CoverImageGenerator;
  /** Overridable so no test touches process.env. */
  isLive?: () => boolean;
  /** ⚠ THE PLACEHOLDER SWITCH, overridable for the same reason as `isLive`.
   *  Defaults to `FP_COVER_PLACEHOLDER_MODE` — off unless explicitly on. */
  isPlaceholderMode?: () => boolean;
  /** The registry key to dial. Defaults to {@link FP_COVER_MODEL_ID}; a
   *  parameter only so a test can prove the id reaches the adapter. */
  modelId?: string;
};

/* ----------------------------------------------------------------- result */

export type CoverGenerateRefusal =
  /** `FP_CHILD_PHOTO_LIVE` is not on. Nothing was read, dialled or deleted. */
  | "gate_closed"
  /** The stripped source photo is not in the store (reaped, erased, or never
   *  written). Nothing was dialled. */
  | "photo_missing"
  /** ⚠ PLACEHOLDER MODE IS ON AND NO PLACEHOLDER GENERATOR WAS SUPPLIED. A
   *  MISCONFIGURATION, REFUSED — never quietly satisfied by dialling the real
   *  model instead. Decided before the photo is read, so nothing was read,
   *  dialled or deleted. See {@link ChildPhotoGenerateDeps.generatePlaceholder}. */
  | "placeholder_unavailable"
  /** The model answered with no usable image: a safety block, a timeout, a rate
   *  limit, a provider error, or an unresolvable model id. The `detail` carries
   *  the adapter's NORMALIZED kind and nothing from the vendor's prose — vendor
   *  bodies echo the prompt, and this prompt is about a named child. */
  | "generation_failed"
  /** Bytes arrived but the store would not confirm them, or the confirmed key
   *  fell outside the subject's own namespace. The previous cover is untouched. */
  | "commit_failed";

/**
 * The row update the caller is NOW ALLOWED to make, handed back only after the
 * object behind it is confirmed. See "atomicity of the cover commit" (b).
 */
export type CoverCommit = {
  scope: CoverOwnerScope;
  ownerId: string;
  coverBlobKey: string;
  status: CoverStatus;
  /** The new generation number to persist. Always `input.sequence + 1`. */
  sequence: number;
  contentType: string;
  byteSize: number;
  /** The serving copy for `children.fp_cover_data_url`, or null when the image
   *  is too big to inline. The doors serve this; the blob is the durable
   *  artifact. Both are written in one statement so they cannot disagree. */
  dataUrl: string | null;
};

/**
 * WHICH GENERATOR ACTUALLY RAN. Reported on every outcome so the caller can log
 * it, the door can refuse on it, and a test can assert the SELECTION rather than
 * inferring it from the bytes. `"placeholder"` means the committed cover is a
 * picture of a cat.
 */
export type CoverGeneratorUsed = "model" | "placeholder" | "none";

export type CoverGenerateResult =
  | {
      ok: true;
      commit: CoverCommit;
      /** False means the object survives and must be treated as STRANDED —
       *  a minor's photograph we failed to delete. Never silently true. */
      sourcePhotoDeleted: boolean;
      generatorUsed: CoverGeneratorUsed;
    }
  | {
      ok: false;
      reason: CoverGenerateRefusal;
      detail: string;
      generatorUsed: CoverGeneratorUsed;
      /** Same meaning as on the success branch. `false` on `gate_closed` and
       *  `photo_missing` is not a stranding — nothing was attempted, and the
       *  photo (if any) stays in the reaper's and the eraser's scope. */
      sourcePhotoDeleted: boolean;
    };

/* --------------------------------------------------------------- the flow */

export async function generateCoverFromPhoto(
  deps: ChildPhotoGenerateDeps,
  input: {
    scope: CoverOwnerScope;
    ownerId: string;
    /** The key of the ALREADY-STRIPPED source photo. ⚠ This module does not
     *  strip: it assumes ./photo-strip.ts ran at the door, which is where the
     *  bytes first existed. Handing it an unstripped key sends EXIF to a
     *  vendor, so nothing but the upload door may produce this value. */
    photoKey: string;
    /** The resolved prompt. Never logged here — see the failure branch. */
    prompt: string;
    /** The generation count OBSERVED by the caller; the new cover is
     *  `sequence + 1`. Keeping the old and new keys distinct is atomicity (a). */
    sequence: number;
    abortSignal?: AbortSignal;
  }
): Promise<CoverGenerateResult> {
  const isLive = deps.isLive ?? (() => isChildPhotoLive());

  // 1. THE GATE. Before the photo is read, before a client is used.
  if (!isLive()) {
    return {
      ok: false,
      reason: "gate_closed",
      detail: "FP_CHILD_PHOTO_LIVE is not on",
      sourcePhotoDeleted: false,
      generatorUsed: "none",
    };
  }

  // ── 1b. ⚠⚠ CHOOSE THE GENERATOR. FROM THE SWITCH ALONE, AND HERE. ⚠⚠
  //
  // Placed BEFORE the read for two reasons. First, a misconfiguration must cost
  // a minor's photograph nothing: refusing here reads nothing and deletes
  // nothing, exactly like a closed gate. Second, and more important, the choice
  // is made where NO OUTCOME IS KNOWN YET. There is deliberately no branch
  // further down that could reach for the placeholder because the real model
  // answered `unconfigured`, timed out, or was safety-blocked.
  //
  // ⚠ THAT ABSENCE IS THE WHOLE DESIGN. `FP_COVER_MODEL_ID` does not resolve
  // today, so a failure-triggered fallback would fire on EVERY request, in every
  // environment, and the pipeline would look like it worked. A placeholder
  // reaches production through a fallback, not through a flag.
  const usePlaceholder = (deps.isPlaceholderMode ?? (() => isCoverPlaceholderMode()))();
  const generator = usePlaceholder ? deps.generatePlaceholder : deps.generate;
  const generatorUsed: CoverGeneratorUsed = usePlaceholder ? "placeholder" : "model";
  if (!generator) {
    // Placeholder mode with no placeholder supplied. REFUSE. Falling through to
    // `deps.generate` here would send a real child's face to a vendor because a
    // caller forgot to wire a stub, which is the failure this branch exists to
    // make impossible.
    return {
      ok: false,
      reason: "placeholder_unavailable",
      detail: "FP_COVER_PLACEHOLDER_MODE is on but no placeholder generator was supplied",
      sourcePhotoDeleted: false,
      generatorUsed,
    };
  }

  // 2. READ. The only read of the source photo in the whole pipeline.
  const photoBytes = await deps.readBytes(input.photoKey);
  if (!photoBytes || photoBytes.byteLength === 0) {
    return {
      ok: false,
      reason: "photo_missing",
      detail: "the stripped source photo could not be read",
      sourcePhotoDeleted: false,
      generatorUsed,
    };
  }

  // 3. GENERATE. One attempt. Every outcome comes back normalized; this call
  //    does not throw (the adapter's contract), but it is wrapped anyway so a
  //    future adapter that breaks that contract cannot skip step 4.
  let generated: NormalizedImageResult;
  try {
    generated = await generator({
      modelId: deps.modelId ?? FP_COVER_MODEL_ID,
      prompt: input.prompt,
      referenceImages: [{ bytes: photoBytes, contentType: STRIPPED_PHOTO_CONTENT_TYPE }],
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
  } catch (err) {
    const sourcePhotoDeleted = await discardSource(deps, input.photoKey);
    return {
      ok: false,
      reason: "generation_failed",
      // The adapter is contracted never to throw. If it did, the error MESSAGE
      // is still not repeated: a vendor exception routinely quotes the prompt.
      detail: `the image adapter threw (${err instanceof Error ? err.name : "unknown"})`,
      sourcePhotoDeleted,
      generatorUsed,
    };
  }

  // 4. ⚠ THE SOURCE PHOTO DIES HERE, ON EVERY PATH BELOW. Do not move this
  //    call past step 6 (module header, step 4).
  const sourcePhotoDeleted = await discardSource(deps, input.photoKey);

  // 5. NO BYTES → NO COVER STATE IS TOUCHED AT ALL.
  if (generated.kind !== "generated") {
    return {
      ok: false,
      reason: "generation_failed",
      // The NORMALIZED kind only. `safety_blocked` carries a closed-set reason
      // and `provider_error` a closed-set detail; neither is vendor prose.
      detail: `model returned ${generated.kind}`,
      sourcePhotoDeleted,
      generatorUsed,
    };
  }

  // 6. COMMIT. `putCoverConfirmed` writes the object and applies rule (1); it
  //    hands back a status only once the store confirmed the bytes.
  const sequence = input.sequence + 1;
  let put: Awaited<ReturnType<typeof putCoverConfirmed>>;
  try {
    put = await putCoverConfirmed(
      { blob: deps.blob },
      {
        scope: input.scope,
        ownerId: input.ownerId,
        sequence,
        body: generated.bytes,
        contentType: generated.contentType,
        status: "final",
      }
    );
  } catch (err) {
    // A throwing put is the port's CONTRACT for a failed write (cover-store's
    // requirement 3). The previous cover is untouched: nothing was addressed
    // but the new, unused key.
    return {
      ok: false,
      reason: "commit_failed",
      detail: `cover object write failed (${err instanceof Error ? err.name : "unknown"})`,
      sourcePhotoDeleted,
      generatorUsed,
    };
  }
  if (!put.ok) {
    return {
      ok: false,
      reason: "commit_failed",
      detail: put.detail,
      sourcePhotoDeleted,
      generatorUsed,
    };
  }

  return {
    ok: true,
    sourcePhotoDeleted,
    generatorUsed,
    commit: {
      scope: input.scope,
      ownerId: input.ownerId,
      coverBlobKey: put.coverBlobKey,
      status: put.status,
      sequence,
      contentType: generated.contentType,
      byteSize: generated.bytes.byteLength,
      dataUrl: coverDataUrl(generated.bytes, generated.contentType),
    },
  };
}

/**
 * Delete the source photo and report whether it is really gone.
 *
 * Never throws and never propagates: a storage failure here must not abort the
 * sequence (the caller still has a decision to record), but it must also never
 * be reported as success. A `false` return is a STRANDED minor's photograph and
 * is logged as one — the same "stranded, never silently skipped" discipline
 * family erasure applies to an unreachable object.
 */
async function discardSource(deps: ChildPhotoGenerateDeps, key: string): Promise<boolean> {
  try {
    await deps.deleteSourcePhoto(key);
    return true;
  } catch (err) {
    // The KEY is logged. It contains a draft or child UUID and nothing else —
    // no name, no image, no prompt — and without it an operator cannot clean up
    // the one object that must not survive.
    console.error(
      `[fp/child-photo] STRANDED SOURCE PHOTO ${key}: delete failed (${err instanceof Error ? err.message : String(err)})`
    );
    return false;
  }
}

/**
 * THE DECLINE / ABANDON PATH.
 *
 * A parent who uploads a photo and then backs out — closes the tab, taps
 * "skip", declines at the consent step — must not leave their child's
 * photograph sitting in a bucket waiting for a seven-day reaper. This is the
 * same delete as step 4, reachable without a generation, and it is deliberately
 * a NAMED EXPORT rather than a private helper so the abandon surfaces have
 * something to call that is obviously the right thing.
 *
 * Returns the same stranding-honest boolean.
 */
export async function discardSourcePhoto(
  deps: Pick<ChildPhotoGenerateDeps, "deleteSourcePhoto">,
  photoKey: string
): Promise<{ deleted: boolean }> {
  const deleted = await discardSource(deps as ChildPhotoGenerateDeps, photoKey);
  return { deleted };
}
