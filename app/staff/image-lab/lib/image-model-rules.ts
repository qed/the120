/**
 * Image Lab — the PURE half of the model adapter.
 *
 * No `server-only`, no `ai` import, no network: everything here is a total
 * function or a closed set. That split is deliberate. The history and keep-rate
 * surfaces render `NormalizedImageResult` and ask `isBilledOutcome` in the
 * BROWSER; importing those from a `server-only` module would either break the
 * client build or push a duplicate copy of the billing rule into the UI, and a
 * second copy of "did this cost money" is the one duplicate this feature cannot
 * afford. Follows the repo's `*-rules.ts` convention (app/fp/lib/access-rules.ts).
 *
 * ── Never echo the vendor ──────────────────────────────────────────────────
 * Safety-block responses conventionally quote the offending prompt back, and the
 * prompt is built from child-authored business content. Echoing a vendor message
 * into `failure_detail` would copy that content into a second DB column and into
 * every log line that ever prints the row. So every `detail` and every safety
 * `reason` is drawn from a CLOSED SET below — and, since this unit's review, the
 * sets are TYPES rather than comments: `detail: err.message` is now a compile
 * error, not merely a discouraged line.
 */

import {
  IMAGE_LAB_MAX_OBJECT_BYTES,
  type ImageLabFailureReason,
  type ImageLabMimeType,
} from "./image-lab-rules";

// ── Closed sets ──────────────────────────────────────────────────────────────

/**
 * Closed set of `provider_error` details. Codes, never prose, and never a vendor
 * string: this value is persisted alongside `failure_reason` and rendered to
 * staff.
 *
 * `api_error` additionally carries an HTTP status as `api_error:503` — digits
 * only, which cannot smuggle prompt text.
 */
export const IMAGE_LAB_PROVIDER_ERROR_DETAILS = [
  /** The call succeeded but carried no image (a prose-only answer). */
  "no_image_returned",
  /** Bytes present but not PNG/JPEG/WebP by magic-byte sniff. */
  "unreadable_image_bytes",
  /** Sniffs as an image but is too small to be one (header with no body). */
  "implausible_image_bytes",
  /** Sniffs as an image but exceeds the bucket's per-object ceiling. */
  "oversize_image_bytes",
  /** The caller named a quality tier this model does not price. Never dialled. */
  "unsupported_quality_tier",
  /** An HTTP-level vendor/gateway failure. Usually suffixed `:<status>`. */
  "api_error",
  /** Anything else, deliberately unenriched. */
  "unknown_error",
] as const;
export type ImageLabProviderErrorDetail =
  (typeof IMAGE_LAB_PROVIDER_ERROR_DETAILS)[number];

/**
 * The full `detail` type. The template member is what lets a status ride along
 * while keeping the value closed — `api_error:${number}` admits digits and
 * nothing else, so no vendor sentence can be assigned here.
 */
export type ImageLabFailureDetail =
  | ImageLabProviderErrorDetail
  | `api_error:${number}`;

/**
 * Human-readable safety reasons, closed for the same reason the details are.
 * The person-generation wording is separate because it is the one a staff member
 * can ACT on (chase the allowlist) rather than reword a prompt.
 */
export const IMAGE_LAB_SAFETY_REASONS = {
  personGeneration:
    "The model refused to render people or characters. This is the " +
    "personGeneration allowlist, not a prompt problem — it blocks every hero " +
    "prompt on the Gemini models until the allowlist request is granted.",
  generic:
    "The model's safety filter blocked this generation. Try rewording the " +
    "prompt; the vendor's explanation is deliberately not stored.",
} as const;
export type ImageLabSafetyReason =
  (typeof IMAGE_LAB_SAFETY_REASONS)[keyof typeof IMAGE_LAB_SAFETY_REASONS];

/**
 * Why we stopped waiting. Both normalize to the schema's single `timeout`
 * reason, but they bill differently, so the distinction is in the type rather
 * than lost at the boundary.
 */
export const IMAGE_LAB_TIMEOUT_CAUSES = [
  /** Our own `AbortSignal.timeout` fired: the vendor was still working. */
  "adapter_timeout",
  /** The CALLER hung up (route budget, or a sibling cancel in a compare fan). */
  "caller_aborted",
] as const;
export type ImageLabTimeoutCause = (typeof IMAGE_LAB_TIMEOUT_CAUSES)[number];

/** Codes the adapter may print to the operator log. Never vendor text. */
export type ImageLabFailureLogCode =
  | ImageLabFailureDetail
  | ImageLabTimeoutCause
  | "rate_limited"
  | "safety_blocked";

// ── The normalized result union ──────────────────────────────────────────────

/**
 * The union every caller consumes. Each non-generated member maps 1:1 onto an
 * `IMAGE_LAB_FAILURE_REASON` from Unit 1 — a mapping a test pins in both
 * directions, because a seventh member added here without a matching reason
 * would be a row the schema's CHECK constraint refuses at 3am on the finalize
 * write.
 */
export type NormalizedImageResult =
  | {
      kind: "generated";
      /** Sniff-validated image bytes. Safe to store as-is. */
      bytes: Uint8Array;
      /** PINNED FROM THE BYTES. Never the vendor's declared type. */
      contentType: ImageLabMimeType;
      gatewayGenerationId: string | null;
      /** Null is expected: image-modality cost parity is unverified. */
      costReportedUsd: number | null;
    }
  | { kind: "safety_blocked"; reason: ImageLabSafetyReason }
  | { kind: "timeout"; cause: ImageLabTimeoutCause }
  | { kind: "rate_limited" }
  | { kind: "provider_error"; detail: ImageLabFailureDetail }
  | { kind: "unconfigured" };

/**
 * The decision table, pure and total. Returns null for a success so the caller
 * cannot accidentally file a completed generation under a failure reason.
 *
 * An exhaustive switch rather than `result.kind as ...`: the union and the DB's
 * closed set are two different lists that only a compiler error keeps aligned.
 */
export function failureReasonForResult(
  result: NormalizedImageResult
): ImageLabFailureReason | null {
  switch (result.kind) {
    case "generated":
      return null;
    case "safety_blocked":
      return "safety_blocked";
    case "timeout":
      return "timeout";
    case "rate_limited":
      return "rate_limited";
    case "provider_error":
      return "provider_error";
    case "unconfigured":
      return "unconfigured";
  }
}

/**
 * `provider_error` details that mean THE VENDOR COMPLETED A GENERATION.
 *
 * All four are 200-level outcomes: the model ran, the meter ran, and the payload
 * was then unusable to US. `no_image_returned` is the documented prose-only
 * answer the registry's response-modality option exists to prevent — "a billed
 * call and zero files". The three byte-level rejections happen strictly AFTER
 * bytes arrived. Reporting any of them unbilled understates spend on exactly the
 * failures worth chasing.
 */
const BILLED_PROVIDER_ERROR_DETAILS: readonly ImageLabFailureDetail[] = [
  "no_image_returned",
  "unreadable_image_bytes",
  "implausible_image_bytes",
  "oversize_image_bytes",
];

/**
 * Did this outcome put a charge on the invoice?
 *
 * The images table splits `attempted_at` ("we latched this cell") from `billed`
 * ("this will appear on the invoice"), and the split only pays off if something
 * decides.
 *
 * Vendors bill on GENERATION, not on delivery, so an `adapter_timeout` is
 * conservatively billed: the call may well have completed server-side after we
 * hung up. A `caller_aborted` is NOT — that abort is our own initiative (a route
 * running out of residual budget, or a compare fan cancelling eleven siblings),
 * and charging a staff member for eleven runs they cancelled would overstate
 * spend far more often than the reverse understates it.
 *
 * `api_error` and `unknown_error` stay unbilled: those are requests the vendor
 * rejected or never ran.
 */
export function isBilledOutcome(result: NormalizedImageResult): boolean {
  switch (result.kind) {
    case "generated":
      return true;
    case "timeout":
      return result.cause === "adapter_timeout";
    case "provider_error":
      return BILLED_PROVIDER_ERROR_DETAILS.includes(result.detail);
    case "safety_blocked":
    case "rate_limited":
    case "unconfigured":
      return false;
  }
}

// ── Magic-byte sniffing ──────────────────────────────────────────────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]; // "WEBP", at offset 8

const startsWith = (bytes: Uint8Array, magic: number[], offset = 0): boolean =>
  bytes.length >= offset + magic.length &&
  magic.every((byte, i) => bytes[offset + i] === byte);

/**
 * The content type of a payload, decided by its own first bytes, or null.
 *
 * THE SECURITY BOUNDARY of this feature. The declared type is not consulted at
 * all — not as a hint, not as a tie-break — because the objects in this bucket
 * are served by signed URL into a staff browser on the storage origin, where an
 * `image/svg+xml` (or an HTML error page a proxy substituted for the image) is
 * an executable document. Unit 1's mime allowlist already excludes SVG; this
 * makes the exclusion true of the BYTES rather than of a label.
 *
 * WebP needs the two-part check: `RIFF` alone is also AVI and WAV, so a payload
 * that is RIFF-but-not-WEBP must fail, not pass as an image.
 */
export function sniffImageType(bytes: Uint8Array): ImageLabMimeType | null {
  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (startsWith(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (startsWith(bytes, RIFF_MAGIC) && startsWith(bytes, WEBP_MAGIC, 8)) {
    return "image/webp";
  }
  return null;
}

/**
 * Plausibility floor. A correct 1×1 PNG is 67 bytes and the smallest real JPEG
 * is larger still, so anything under this is a signature with no image behind
 * it — a truncated stream or a header-shaped stub.
 *
 * It matters because such a payload PASSES the sniff: without this floor an
 * 8-byte PNG signature is stored, billed, served as a broken image, and counted
 * in the keep-rate denominator as a success.
 */
export const IMAGE_LAB_MIN_IMAGE_BYTES = 64;

/** The minimum of a generated file this feature reads. */
export type ImageLabGeneratedFile = {
  readonly uint8Array: Uint8Array;
  readonly mediaType: string;
};

export type ImageLabFilePick =
  | {
      ok: true;
      file: ImageLabGeneratedFile;
      /** PINNED FROM THE BYTES. */
      contentType: ImageLabMimeType;
      /** Usable images we did NOT take. Logged, so drafts are visible. */
      discarded: number;
    }
  | { ok: false; detail: ImageLabProviderErrorDetail };

/**
 * Choose the one file to keep out of everything a model returned.
 *
 * ONE implementation for BOTH call legs, because the two used to disagree:
 * `generateImage` took `images[0]` blindly and the multimodal leg took the first
 * non-empty file without sniffing, so the same vendor response could be stored
 * on one path and rejected on the other.
 *
 * WHICH ONE: the LAST file that sniffs as an image. `gemini-3-pro-image` is a
 * THINKING model — it emits interim/draft images before the final one, so index
 * 0 is routinely a draft. Taking index 0 would store and score a draft while
 * paying for the final, which quietly corrupts the exact comparison the Lab
 * exists to produce. The `generateImage` leg asks for `n: 1`, so "last" and
 * "first" coincide there and the shared rule costs it nothing.
 *
 * Order of rejection is deliberate: "nothing came back" and "something came back
 * that we cannot use" are different bills and different bugs.
 */
export function pickUsableFile(
  files: readonly ImageLabGeneratedFile[]
): ImageLabFilePick {
  const nonEmpty = files.filter((file) => file.uint8Array.length > 0);
  if (nonEmpty.length === 0) return { ok: false, detail: "no_image_returned" };

  const sniffed = nonEmpty
    .map((file) => ({ file, contentType: sniffImageType(file.uint8Array) }))
    .filter(
      (candidate): candidate is { file: ImageLabGeneratedFile; contentType: ImageLabMimeType } =>
        candidate.contentType !== null
    );
  if (sniffed.length === 0) {
    // Deliberately does NOT report what the vendor claimed: that string is
    // vendor-controlled and this value is persisted and rendered.
    return { ok: false, detail: "unreadable_image_bytes" };
  }

  const chosen = sniffed[sniffed.length - 1]!;
  const bytes = chosen.file.uint8Array;
  if (bytes.length < IMAGE_LAB_MIN_IMAGE_BYTES) {
    return { ok: false, detail: "implausible_image_bytes" };
  }
  // The bucket's own per-object ceiling (Unit 1, mirrored in the migration).
  // Checked HERE so an oversize payload is a recorded outcome rather than an
  // opaque storage error after the money is already spent.
  if (bytes.length > IMAGE_LAB_MAX_OBJECT_BYTES) {
    return { ok: false, detail: "oversize_image_bytes" };
  }

  return {
    ok: true,
    file: chosen.file,
    contentType: chosen.contentType,
    discarded: nonEmpty.length - 1,
  };
}
