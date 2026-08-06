/**
 * Image Lab — the reference library's PURE rules and its copy
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4; origin R6 and R13).
 *
 * PLAIN module — no next/supabase/react imports — so the node suite can pin
 * every bound, refusal and counter decision here. `reference-core.ts` does the
 * sequencing against injected deps, `reference-actions.ts` is the wire, and
 * `ReferenceLibrary.tsx` renders; every decision any of them takes is made in
 * this file and covered by `__tests__/reference-rules.test.ts`.
 *
 * ── WHAT IS DELIBERATELY *NOT* REDEFINED HERE ──────────────────────────────
 * The accepted mime types, the object ceiling, the bucket, and the mime
 * canonicalizer all live in `./image-lab-rules` (Unit 1) and are IMPORTED, not
 * restated. A second copy of the allowlist is a second answer to "is this an
 * accepted image", and the migration's bucket `allowed_mime_types` is a THIRD
 * enforcement layer that only agrees with a single TS source of truth.
 *
 * The plain-vs-TUS boundary, and the already-exists→success interpretation of
 * an upload response, come from `@/app/fp/lib/upload-rules` — the shipped,
 * production-confirmed direct-to-storage rules. Reference uploads take exactly
 * the same two legs against exactly the same Storage API, so a Lab-local copy
 * would be a fork of a rule this repo has already paid to get right twice (the
 * plain leg reads storage-js's parsed `statusCode`; the TUS leg has to parse the
 * 409 out of a body tus-js-client never parses).
 *
 * ── THE APPEND-ONLY CONSEQUENCE THAT SHAPES THIS MODULE ────────────────────
 * `fp_image_lab_references` carries a BEFORE UPDATE OR DELETE trigger that
 * raises — for service_role too. Two things follow, and both are load-bearing:
 *   1. There is NO row deletion in v1, so the upload surface must say so BEFORE
 *      the bytes leave the browser ({@link IMAGE_LAB_REFERENCE_COPY.permanence}).
 *      ⚠ THE TRIGGER IS ON THE TABLE ONLY. Storage objects carry no trigger and
 *      no policy, and the service role removes them freely — which is why a
 *      refused registration DOES tidy up its object (see `reference-core`).
 *   2. A signed thumbnail URL can never be CACHED ON THE ROW the way
 *      `path_evidence_items` caches one, because writing it back would be an
 *      UPDATE the trigger rejects. So the URL is minted per listing at a SHORT
 *      TTL and the freshness decision moves to the reader, which is what
 *      {@link decideReferenceRefresh} is for.
 */

import {
  IMAGE_LAB_ACCEPTED_MIME_TYPES,
  IMAGE_LAB_MAX_OBJECT_BYTES,
  normalizeMimeType,
  type ImageLabMimeType,
} from "./image-lab-rules";
import { IMAGE_LAB_MODELS } from "./model-registry";
import { chooseUploadStrategy, type UploadStrategy } from "@/app/fp/lib/upload-rules";

// ── Storage keys ─────────────────────────────────────────────────────────────

/**
 * The prefix every reference object lives under (the migration header names it).
 * Generated images live under `runs/`, so the prefix is what keeps the two
 * populations separable in a bucket listing and in a sweeper.
 */
export const IMAGE_LAB_REFERENCE_PREFIX = "references";

/**
 * PER-UPLOAD UUID keys, the `app/fp/lib/actions/upload-slot.ts` precedent — NOT
 * a content hash. Re-uploading the same bytes mints a new key and therefore a
 * new row, and that is the documented design (duplicates are tolerated; the
 * `storage_key` unique index guards double-REGISTRATION of ONE upload, not
 * content identity).
 *
 * No extension: the content type lives on the row and on the object, and an
 * extension derived from a client-declared type would be a second, weaker claim
 * about the same fact.
 */
export function referenceStorageKey(uploadId: string): string {
  return `${IMAGE_LAB_REFERENCE_PREFIX}/${uploadId}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this a key THIS feature minted?
 *
 * The registration action receives the storage key from the BROWSER (it is the
 * only party that knows the upload finished), so it is client input and is
 * treated as such. Without this check a caller could register
 * `runs/<run>/<image>` — a generated image — as a "reference", or point a row at
 * an arbitrary object in the bucket and have the library serve it a signed URL.
 * Anchored at both ends and shape-checked, so no `..` or nested prefix passes.
 */
export function isReferenceStorageKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return (
    parts.length === 2 &&
    parts[0] === IMAGE_LAB_REFERENCE_PREFIX &&
    UUID_RE.test(parts[1]!)
  );
}

/**
 * The `accept` attribute for the file input, DERIVED from the one allowlist.
 *
 * A hand-written `"image/png,image/jpeg,image/webp"` in the JSX would be a
 * fourth copy of the allowlist (rules, bucket, row CHECK, picker) and the only
 * one with no test behind it — so the day a type is added or dropped, the file
 * chooser is the surface that silently disagrees. `accept` is a HINT, never
 * enforcement: it filters the chooser, and every real refusal still comes from
 * {@link decideReferenceUpload} and the two server-side layers.
 */
export const IMAGE_LAB_ACCEPTED_MIME_TYPES_ATTR =
  IMAGE_LAB_ACCEPTED_MIME_TYPES.join(",");

// ── Labels ───────────────────────────────────────────────────────────────────

/** Mirrors `fp_image_lab_references_label_bounded` in the migration. */
export const IMAGE_LAB_REFERENCE_LABEL_MAX = 120;

/**
 * Canonicalize a label: trim, collapse internal whitespace runs, and drop
 * control characters.
 *
 * Deliberately does NOT truncate — an over-long label is a REFUSAL
 * ({@link decideReferenceUpload}), not a silent trim. Truncating would store
 * something the staff member did not type, on a row that can never be edited.
 */
export function normalizeReferenceLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  // Control characters (a pasted newline, a stray NUL) collapse to spaces BEFORE
  // the whitespace squeeze, so a multi-line paste cannot land a label that renders
  // as several lines on a row nobody can ever correct.
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

// ── Refusals ─────────────────────────────────────────────────────────────────

/**
 * Every way a reference upload or registration can be refused.
 *
 * STRUCTURED, and `too_large` carries the OBSERVED size because that is the one
 * number the message needs and the one the reader does not already have. The
 * BOUNDS are not payload: the cap and the accepted list are module constants
 * both sides of the wire already import, and shipping them back as fields was a
 * second copy that could disagree with the rule that refused. A refusal that
 * reads "upload failed" for an over-cap file sends a staff member to re-export a
 * character sheet at random until one happens to fit; the cap is a fact the
 * server knows and must say (Unit 4 requirement 6).
 */
export type ReferenceRefusal =
  | { ok: false; reason: "unsupported_type"; declared: string | null }
  | { ok: false; reason: "too_large"; sizeBytes: number }
  | { ok: false; reason: "empty_file" }
  | { ok: false; reason: "label_too_long" }
  | { ok: false; reason: "invalid_key" }
  | { ok: false; reason: "object_missing" }
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "unavailable" };

/**
 * "25 MB" / "1.5 MB" / "30 KB" — bytes as a staff member reads them, base-2 like
 * the cap.
 *
 * Falls to KB under a tenth of a megabyte. A 30 KB style swatch is a legitimate
 * upload, and rendering it as "0 MB" on its own card reads as a corrupt row.
 */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const rounded = Math.round(mb * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} MB`;
}

/** One sentence per refusal, always naming the bound that was crossed. */
export function describeReferenceRefusal(refusal: ReferenceRefusal): string {
  const copy = IMAGE_LAB_REFERENCE_COPY.refusals;
  switch (refusal.reason) {
    case "unsupported_type":
      return copy.unsupportedType(IMAGE_LAB_ACCEPTED_MIME_TYPES, refusal.declared);
    case "too_large":
      return copy.tooLarge(refusal.sizeBytes, IMAGE_LAB_MAX_OBJECT_BYTES);
    case "empty_file":
      return copy.emptyFile;
    case "label_too_long":
      return copy.labelTooLong(IMAGE_LAB_REFERENCE_LABEL_MAX);
    case "invalid_key":
      return copy.invalidKey;
    case "object_missing":
      return copy.objectMissing;
    case "invalid_input":
      return copy.invalidInput;
    case "unavailable":
      return copy.unavailable;
  }
}

// ── The one size→type→label ladder, applied at both boundaries ───────────────

type AcceptedFile = { contentType: ImageLabMimeType; sizeBytes: number; label: string };

/**
 * The SHARED ladder both public decisions run, in the one order that matters:
 * an empty file is refused before its type is discussed, the size cap is checked
 * before the label so the most fundamental refusal wins, and the type is
 * canonicalized through the single {@link normalizeMimeType}.
 *
 * Private on purpose. The two exported entry points below are NOT
 * interchangeable — one takes what the browser CLAIMED, the other only what the
 * server OBSERVED — and collapsing them into one exported function with a
 * "trusted?" flag would put the whole guarantee behind a boolean argument.
 */
function validateReferenceFile(input: {
  contentType: string | null | undefined;
  sizeBytes: number | null;
  label?: unknown;
}): { ok: true; value: AcceptedFile } | { ok: false; refusal: ReferenceRefusal } {
  const sizeBytes = input.sizeBytes;
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, refusal: { ok: false, reason: "empty_file" } };
  }
  if (sizeBytes > IMAGE_LAB_MAX_OBJECT_BYTES) {
    return { ok: false, refusal: { ok: false, reason: "too_large", sizeBytes } };
  }

  const contentType = normalizeMimeType(input.contentType);
  if (contentType === null) {
    return {
      ok: false,
      refusal: {
        ok: false,
        reason: "unsupported_type",
        declared: typeof input.contentType === "string" ? input.contentType : null,
      },
    };
  }

  const label = normalizeReferenceLabel(input.label);
  if (label.length > IMAGE_LAB_REFERENCE_LABEL_MAX) {
    return { ok: false, refusal: { ok: false, reason: "label_too_long" } };
  }

  return { ok: true, value: { contentType, sizeBytes, label } };
}

// ── The pre-upload decision ──────────────────────────────────────────────────

export type ReferenceUploadDecision =
  | {
      ok: true;
      /** The canonical type, from {@link normalizeMimeType} — never the raw header. */
      contentType: ImageLabMimeType;
      label: string;
      sizeBytes: number;
      strategy: UploadStrategy;
    }
  | ReferenceRefusal;

/**
 * Decide whether a picked file may be uploaded at all, BEFORE a slot is minted.
 *
 * ⚠ The content type resolved here is ADVISORY. It comes from the browser's
 * `File.type`, and the browser is also what sets the object's content type at
 * PUT time — the server mints the slot but cannot bind the type (upload-slot.ts
 * says so explicitly). So this check exists to give a friendly refusal before a
 * pointless upload; the type that reaches the ROW is pinned separately at
 * registration from the SERVER-OBSERVED object ({@link decideReferenceRegistration}),
 * and the bucket's `allowed_mime_types` governs the OBJECT. Three layers, on
 * purpose — see the migration header.
 *
 * ⚠ THE LABEL IS REFUSED HERE, AND HERE IS WHERE IT COSTS NOTHING. This is the
 * only boundary that can still refuse an over-long label BEFORE 25 MB leave the
 * laptop; the registration leg re-checks (it receives the label again, from the
 * client, and the row cannot be edited afterwards) but by then a refusal costs
 * an upload — which is why that arm now deletes the object it refused.
 */
export function decideReferenceUpload(input: {
  declaredContentType: string | null | undefined;
  sizeBytes: number;
  label?: unknown;
}): ReferenceUploadDecision {
  const checked = validateReferenceFile({
    contentType: input.declaredContentType,
    sizeBytes: input.sizeBytes,
    label: input.label,
  });
  if (!checked.ok) return checked.refusal;

  return {
    ok: true,
    contentType: checked.value.contentType,
    label: checked.value.label,
    sizeBytes: checked.value.sizeBytes,
    strategy: chooseUploadStrategy(checked.value.sizeBytes),
  };
}

// ── The registration decision (the type that reaches the row) ────────────────

export type ReferenceRegistrationDecision =
  | { ok: true; contentType: ImageLabMimeType; byteSize: number; label: string }
  | ReferenceRefusal;

/**
 * Decide what is WRITTEN, from what the server itself observed on the stored
 * object — never from what the client said it was uploading.
 *
 * ⚠ THE CLIENT-DECLARED TYPE IS NOT A PARAMETER OF THIS FUNCTION, and that is
 * the point rather than an omission. A caller that disagrees with reality has
 * nothing to disagree WITH here: `observedContentType` is the object's own
 * `metadata.mimetype` read back out of Storage, and it is canonicalized through
 * the same {@link normalizeMimeType} the bucket allowlist mirrors. The row's
 * `content_type` CHECK is the last of the three layers; this is the one that
 * decides what it sees.
 *
 * `observedSizeBytes` is likewise the object's real size, so the cap is enforced
 * against what actually landed rather than against a number a client typed.
 */
export function decideReferenceRegistration(input: {
  observedContentType: string | null | undefined;
  observedSizeBytes: number | null;
  label?: unknown;
}): ReferenceRegistrationDecision {
  const checked = validateReferenceFile({
    contentType: input.observedContentType,
    sizeBytes: input.observedSizeBytes,
    label: input.label,
  });
  if (!checked.ok) return checked.refusal;

  return {
    ok: true,
    contentType: checked.value.contentType,
    byteSize: checked.value.sizeBytes,
    label: checked.value.label,
  };
}

// ── Serving ──────────────────────────────────────────────────────────────────

/**
 * SHORT TTL for a reference thumbnail — ten minutes, against the evidence
 * surface's one hour.
 *
 * Shorter on purpose, and the reason is the append-only table: a signed URL for
 * evidence is CACHED ON ITS ROW and reused for its whole life (minting per
 * render triples the CDN bill), which only works because that row can be
 * updated. This row cannot, so every listing mints fresh anyway and a long life
 * would buy nothing while leaving a longer-lived bearer URL in an RSC payload
 * and a browser cache. Ten minutes comfortably outlives the picker session that
 * asked for it.
 *
 * ⚠ THE *UPLOAD* SLOT IS NOT SHORT-LIVED, and the two must not be read as one
 * posture. `createSignedUploadUrl` on this storage-js version takes no
 * `expiresIn` (its only option is `upsert`), so a minted write token carries
 * Supabase's default — roughly TWO HOURS — during which it is a bearer grant to
 * write ONE named object into this private bucket. That is acceptable (the key
 * is a fresh UUID, upsert is off, and a landed object is unreplaceable), but it
 * is a real window and it is stated here rather than implied away by the ten
 * minutes above.
 */
export const IMAGE_LAB_REFERENCE_URL_TTL_SECONDS = 10 * 60;

/**
 * How early a still-valid signed URL is treated as stale.
 *
 * PROPORTIONAL TO THIS FEATURE'S TTL, not inherited. `evidence-rules`'
 * `SIGNED_URL_REMINT_SKEW_MS` is 300s, which was tuned against a ONE-HOUR
 * evidence TTL (a 5/60 skew). Applied to this surface's ten minutes it is a
 * 5/10 skew: every URL would be "near expiry" for half its life and the picker
 * would re-mint all sixty every five minutes forever. Sixty seconds against ten
 * minutes is the same 1/10 posture as the surface it was borrowed from.
 */
export const IMAGE_LAB_REFERENCE_REMINT_SKEW_MS = 60_000;

/**
 * Backoff before re-listing to retry a FAILED signed-URL mint, per consecutive
 * failed round. Ends: after {@link IMAGE_LAB_REFERENCE_MINT_RETRY_LIMIT}
 * rounds the picker stops asking and the affected cards stay label-only.
 */
export const IMAGE_LAB_REFERENCE_MINT_RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;

export const IMAGE_LAB_REFERENCE_MINT_RETRY_LIMIT =
  IMAGE_LAB_REFERENCE_MINT_RETRY_DELAYS_MS.length;

export type ReferenceRefreshDecision =
  | { refresh: false }
  | { refresh: true; cause: "near_expiry" | "mint_retry" };

/**
 * Should the reader ask for a fresh listing?
 *
 * ⚠ A FAILED MINT IS NOT "NEAR EXPIRY", and conflating the two is a feedback
 * loop rather than a refresh. A reference whose `createSignedUrl` call failed
 * arrives with `signedUrl: null` and no expiry; treating a null expiry as
 * always-stale (the inherited `shouldRemintSignedUrl` posture, which is correct
 * when null means "never minted, ask once") makes the sixty-second poll re-list
 * forever, firing sixty concurrent mints per minute into storage that is
 * already failing, for the life of the tab.
 *
 * So the two causes are separated:
 *   * NEAR EXPIRY — a URL that EXISTS and is inside the skew. Unbounded, because
 *     it is the healthy path and it is what keeps thumbnails alive.
 *   * MINT RETRY — a URL that is missing because the mint failed. BACKED OFF and
 *     CAPPED: degraded storage gets three widening attempts, not a permanent
 *     minute-by-minute hammer.
 *
 * Expiry is compared against a CLIENT-ANCHORED deadline (see
 * `ReferenceView.signedUrlExpiresInMs` — the server returns a LIFETIME and the
 * reader stamps it against its own clock at receipt), so a browser whose clock
 * is minutes off no longer sees every URL as stale on arrival, or none of them
 * ever.
 */
export function decideReferenceRefresh(input: {
  references: readonly { signedUrl: string | null; expiresAtMs: number | null }[];
  nowMs: number;
  /** Consecutive listings that came back with at least one failed mint. */
  failedMintRounds: number;
  /** When the last listing was applied — the anchor the backoff measures from. */
  lastListedAtMs: number | null;
  skewMs?: number;
}): ReferenceRefreshDecision {
  const skew = input.skewMs ?? IMAGE_LAB_REFERENCE_REMINT_SKEW_MS;

  const nearExpiry = input.references.some(
    (r) => r.signedUrl !== null && r.expiresAtMs !== null && input.nowMs >= r.expiresAtMs - skew
  );
  if (nearExpiry) return { refresh: true, cause: "near_expiry" };

  const missing = input.references.some((r) => r.signedUrl === null);
  if (!missing) return { refresh: false };
  if (input.failedMintRounds >= IMAGE_LAB_REFERENCE_MINT_RETRY_LIMIT) return { refresh: false };

  const delay =
    IMAGE_LAB_REFERENCE_MINT_RETRY_DELAYS_MS[
      Math.min(input.failedMintRounds, IMAGE_LAB_REFERENCE_MINT_RETRY_LIMIT - 1)
    ];
  if (input.lastListedAtMs === null) return { refresh: false };
  if (input.nowMs - input.lastListedAtMs < delay) return { refresh: false };
  return { refresh: true, cause: "mint_retry" };
}

/** How many references a single listing returns. The library is small by design
 *  (staff-authored sheets), and an unbounded list would mint an unbounded number
 *  of signed URLs per page load. The TOTAL is returned alongside the page so the
 *  picker can say so — see {@link IMAGE_LAB_REFERENCE_COPY.picker.showingSome}. */
export const IMAGE_LAB_REFERENCE_LIST_LIMIT = 60;

// ── The ref-limit counter ────────────────────────────────────────────────────

/**
 * The reference budget for a SET of chosen models — the minimum across them.
 *
 * A compare run sends the SAME references to every selected model, so the
 * binding limit is the strictest one (gpt-image-2 accepts 4; the Gemini pair
 * accept 11 and 14). Taking the maximum, or the first model's, would let a
 * staff member build a selection that silently fails or silently truncates on
 * one column of the compare grid — which is exactly the column they are trying
 * to judge.
 *
 * An empty selection (no model chosen yet — the state the bench opens in) falls
 * back to the strictest limit in the registry, so a selection made before
 * choosing a model is always still legal afterwards.
 */
export function refImageLimitFor(modelIds: readonly string[]): number {
  const chosen = IMAGE_LAB_MODELS.filter((m) => modelIds.includes(m.id));
  const pool = chosen.length > 0 ? chosen : IMAGE_LAB_MODELS;
  return pool.reduce((min, m) => Math.min(min, m.refImageLimit), Number.POSITIVE_INFINITY);
}

export type ReferenceSelectionResult =
  | { ok: true; selectedIds: string[] }
  | { ok: false; reason: "limit_reached"; limit: number; selectedIds: string[] };

/**
 * Toggle one reference in the selection, bounded by the chosen model's limit.
 *
 * DESELECTION IS NEVER REFUSED — including from a selection that is already
 * over the limit, which is reachable when the staff member picks references
 * first and a stricter model second. A rule that blocks at the limit in both
 * directions would wedge that selection permanently.
 *
 * Order is preserved (append on select) because it is the order the references
 * are sent to the model, and a set that reorders itself between runs makes two
 * runs of "the same" prompt quietly incomparable.
 */
export function toggleReferenceSelection(input: {
  selectedIds: readonly string[];
  id: string;
  limit: number;
}): ReferenceSelectionResult {
  const current = [...input.selectedIds];
  const at = current.indexOf(input.id);
  if (at > -1) {
    current.splice(at, 1);
    return { ok: true, selectedIds: current };
  }
  if (current.length >= input.limit) {
    return { ok: false, reason: "limit_reached", limit: input.limit, selectedIds: current };
  }
  return { ok: true, selectedIds: [...current, input.id] };
}

/**
 * Bring an existing selection back inside a (newly stricter) limit, keeping the
 * EARLIEST picks. Called when the chosen model set changes under a selection
 * that was legal a moment ago — dropping the tail is predictable, whereas
 * leaving it over-limit hands an over-long array to a vendor call.
 *
 * ⚠ THE CLAMP IS ONLY A REPAIR IF SOMEBODY IS TOLD. The picker COMMITS the
 * clamped array through its selection channel rather than merely rendering it —
 * a derived value the owner of the selection cannot see is a counter that reads
 * "4 of 4" while the parent still holds eleven and Generate sends eleven refs to
 * a model that accepts four. See `ReferenceLibrary`'s clamp effect.
 */
export function clampReferenceSelection(
  selectedIds: readonly string[],
  limit: number
): string[] {
  return selectedIds.slice(0, limit);
}

// ── The upload reducer (the picker's decisions, made here) ───────────────────

export type UploadPhase = "idle" | "preparing" | "uploading" | "saving";

export type UploadNotice = { tone: "ok" | "bad"; text: string };

export type UploadStepState = { phase: UploadPhase; notice: UploadNotice | null };

/**
 * Every event the upload form can experience, and nothing else.
 *
 * The picker cannot be RENDERED in this suite (node environment, no jsdom), so
 * the alternative to this reducer is a set of source greps that survive every
 * meaningful mutation — which is what review found. Extracting the decisions
 * makes them assertable: each branch below is a named test in
 * `__tests__/reference-rules.test.ts`, and deleting one reddens.
 */
export type UploadEvent =
  | { type: "submitted_without_file" }
  | { type: "refused_locally"; refusal: ReferenceRefusal }
  | { type: "slot_minted" }
  | { type: "slot_refused"; refusal: ReferenceRefusal }
  | { type: "transfer_progressed"; percent: number }
  | { type: "transfer_failed"; message: string }
  | { type: "registration_refused"; refusal: ReferenceRefusal }
  | { type: "registered"; duplicate: boolean }
  | { type: "threw" };

/**
 * The upload form's phase + notice, decided purely.
 *
 * ⚠ A TRANSFER FAILURE DOES NOT END THE UPLOAD. `uploadWithSlot` reports
 * `retry` for any thrown transport error — including one thrown AFTER the bytes
 * landed and the final ack was lost — so the browser is not the authority on
 * whether the object exists. `statObject` is. The state machine therefore keeps
 * a failed transfer in the SAVING phase with the transport message as a
 * non-final notice, and the caller attempts registration anyway; `object_missing`
 * is the answer that makes the failure real.
 */
export function reduceUploadStep(event: UploadEvent): UploadStepState {
  const copy = IMAGE_LAB_REFERENCE_COPY.upload;
  switch (event.type) {
    case "submitted_without_file":
      return { phase: "idle", notice: { tone: "bad", text: copy.noFile } };
    case "refused_locally":
    case "slot_refused":
      return { phase: "idle", notice: { tone: "bad", text: describeReferenceRefusal(event.refusal) } };
    case "slot_minted":
      return { phase: "uploading", notice: null };
    case "transfer_progressed":
      return {
        phase: "uploading",
        notice: { tone: "ok", text: copy.uploadingPercent(event.percent) },
      };
    case "transfer_failed":
      // Not terminal — see the docblock. Registration is still attempted, and
      // the message is kept so a genuine failure reads as itself rather than as
      // the generic "the upload did not land".
      return { phase: "saving", notice: { tone: "bad", text: event.message } };
    case "registration_refused":
      return {
        phase: "idle",
        notice: { tone: "bad", text: describeReferenceRefusal(event.refusal) },
      };
    case "registered":
      return {
        phase: "idle",
        notice: { tone: "ok", text: event.duplicate ? copy.duplicate : copy.succeeded },
      };
    case "threw":
      return {
        phase: "idle",
        notice: { tone: "bad", text: IMAGE_LAB_REFERENCE_COPY.refusals.unavailable },
      };
  }
}

/** The label on the submit button for a phase — the one place "busy" is named. */
export function uploadButtonLabel(phase: UploadPhase): string {
  const copy = IMAGE_LAB_REFERENCE_COPY.upload;
  switch (phase) {
    case "preparing":
      return copy.preparing;
    case "uploading":
      return copy.uploading;
    case "saving":
      return copy.registering;
    case "idle":
      return copy.submit;
  }
}

// ── Copy ─────────────────────────────────────────────────────────────────────

/**
 * ALL user-facing reference-library strings, in ONE constant (the `shell-rules`
 * precedent). Copy and the rules that choose between copies live together so a
 * refusal can never be rendered by a string the decision does not know about.
 */
export const IMAGE_LAB_REFERENCE_COPY = {
  heading: "Reference library",
  intro:
    "Upload a character sheet or style sample once and reuse it across runs. The consistency drill is one hero sheet, several prompts, per model — so the sheet has to be a stable thing, not a file you re-attach each time.",

  empty: {
    headline: "No references yet.",
    body: "Upload a character sheet or style sample and it will appear here, ready to attach to any run.",
  },

  /**
   * ⚠ THE PERMANENCE NOTICE, and it is stated AT THE POINT OF UPLOAD rather
   * than in a help page. The table is append-only by trigger, so there is no
   * delete path in v1 and no operator workaround short of a migration — which
   * makes an accidental upload of a child's drawing, product photo, or likeness
   * unrecoverable. The migration header commits Unit 4's UI to saying exactly
   * this; changing it here changes what a staff member was told.
   */
  permanence: {
    headline: "A reference cannot be removed.",
    body: "References are append-only in v1: once uploaded, a reference cannot be deleted or edited — not by you, and not by an operator. Upload staff-authored character sheets and style samples only. A reference derived from a child's drawing, product photo, or likeness is an unrecoverable mistake.",
  },

  upload: {
    heading: "Add a reference",
    fileLabel: "Character sheet or style sample",
    accepted: `PNG, JPEG, or WebP, up to ${formatMegabytes(IMAGE_LAB_MAX_OBJECT_BYTES)}.`,
    labelLabel: "Label",
    labelHint: `Optional, up to ${IMAGE_LAB_REFERENCE_LABEL_MAX} characters. Labels cannot be changed later.`,
    labelPlaceholder: "Hero sheet — front, side, three-quarter",
    submit: "Upload reference",
    preparing: "Preparing…",
    uploading: "Uploading…",
    uploadingPercent: (percent: number) => `Uploading… ${percent}%`,
    registering: "Saving…",
    succeeded: "Reference added.",
    duplicate: "That upload was already saved — showing the existing reference.",
    /** Submitting an empty form used to be a silent no-op with no phase change. */
    noFile: "Choose a character sheet or style sample first.",
  },

  picker: {
    /** Rendered as visible text, not a tooltip — see the counter below. */
    selectionLabel: "Selected for this run",
    limitNote: (limit: number) =>
      `The strictest selected model accepts ${limit} reference image${limit === 1 ? "" : "s"}.`,
    limitReached: (limit: number) =>
      `Limit reached: ${limit} reference image${limit === 1 ? "" : "s"}. Deselect one to pick another.`,
    select: "Select",
    selected: "Selected",
    untitled: "Untitled reference",
    refreshing: "Preview unavailable",
    /**
     * ⚠ THE CAP IS SAID OUT LOUD. The table is append-only and unpaged, so at
     * row 61 the OLDEST hero sheet leaves the grid — and a library whose whole
     * job is to hold a stable sheet must not lose one silently.
     */
    showingSome: (shown: number, total: number) =>
      `Showing the ${shown} newest of ${total} references.`,
    /** A selected reference that is no longer in the newest page. Without a row
     *  to tap, the counter reads "4 of 4" over three cards and the fourth can
     *  never be released — an unexitable state. */
    unlistedSelection: "Selected earlier — not in the newest page.",
  },

  selectionCounter: (selectedCount: number, limit: number) =>
    `${selectedCount} of ${limit} selected`,

  refusals: {
    unsupportedType: (accepted: readonly string[], declared: string | null) =>
      `That file is ${declared ? `a ${declared} file` : "not an accepted image"}. References must be ${accepted.join(", ")}.`,
    tooLarge: (sizeBytes: number, maxBytes: number) =>
      `That file is ${formatMegabytes(sizeBytes)}. References are capped at ${formatMegabytes(maxBytes)} — export the sheet smaller and try again.`,
    emptyFile: "That file is empty — there are no bytes to store.",
    labelTooLong: (maxLength: number) =>
      `Labels are capped at ${maxLength} characters.`,
    invalidKey:
      "That upload does not belong to the reference library, so it was not registered.",
    objectMissing:
      "The upload did not land in storage, so there is nothing to register. Try uploading again.",
    invalidInput: "That request was not understood, so nothing was saved.",
    unavailable:
      "The reference library is unreachable right now. Nothing was saved — try again.",
  },

  loadFailed: "The reference library could not be loaded. Reload to try again.",
} as const;
