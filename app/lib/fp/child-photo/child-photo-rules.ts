/**
 * PURE rules for the child-photo → AI illustration pipeline (fp photo Unit 1).
 * No Next, no Supabase, no sharp, no `ai` SDK — only the closed sets, the
 * bounds, the fail-CLOSED gate and the refusal shaping. The impure halves live
 * in ./child-photo-store.ts (Supabase Storage BlobPort), ./photo-strip.ts
 * (re-encode) and ./child-photo-generate-core.ts (the generation sequence).
 *
 * ── WHAT ALREADY EXISTED, AND WHAT THIS UNIT ADDS ──
 * The v3 cover pipeline already owns: the KEY SCHEME and the two-store ordering
 * rules (app/lib/fp/cover-store-rules.ts), the port those rules are obeyed
 * through (app/lib/fp/cover-store.ts `BlobPort`), the consent gate
 * (app/api/fp/signup/consent-rules.ts `photoConsentVerdict`), the draft reaper
 * (app/lib/v3-signup/draft-reaper-*) and family erasure
 * (app/lib/funnel/erase-family-*). NONE of that is re-implemented here.
 *
 * What did NOT exist, and is what this unit is:
 *   1. A REAL STORE. `BlobPort` had no adapter at all — the vendor seam at the
 *      bottom of cover-store.ts was an unimplemented plan for `@vercel/blob`.
 *   2. A DOOR that accepts photo BYTES. `POST /api/fp/cover` refuses a photo
 *      body from the content type alone, by design, and always has.
 *   3. METADATA STRIPPING. Nothing in the repo removes EXIF from anything.
 *   4. A GENERATOR. `CoverDeps.generateImage` was declared and never supplied.
 *
 * ── THE GATE IS THE UNIT'S ONE SWITCH, AND IT IS OFF ──
 * {@link isChildPhotoLive} reads `FP_CHILD_PHOTO_LIVE` and every new door
 * consults it FIRST. Absent env var = off, and every value except the two
 * allowlisted "on" spellings = off. See the function for why an allowlist
 * rather than truthiness.
 *
 * ── ONE BUCKET, NOT TWO ──
 * Source photos and generated artwork share {@link FP_CHILD_MEDIA_BUCKET}
 * because they already share ONE key namespace: `cover-store-rules.blobKey`
 * emits `fp/v3/drafts/<id>/photo.<ext>` and `fp/v3/drafts/<id>/cover-N.<ext>`
 * under the SAME `blobPrefix()`. That prefix is the erasure and reaper
 * primitive — "everything belonging to this subject, enumerable without a
 * database round trip". Splitting the two kinds across two buckets would make
 * every sweep and every erasure a two-bucket walk in which forgetting the
 * second bucket is silent, and would buy nothing: both kinds are private,
 * service-role-only, and equally sensitive (one IS a minor's likeness, the
 * other is DERIVED from it).
 *
 * ── TWO SIZE LIMITS, ON PURPOSE ──
 * {@link FP_CHILD_PHOTO_MAX_BYTES} (the DOOR) is deliberately far below
 * {@link FP_CHILD_MEDIA_MAX_OBJECT_BYTES} (the BUCKET). They bound different
 * things: the door bounds an INBOUND REQUEST BODY that must fit under the
 * platform's ~4.5 MB function-body ceiling (the photo cannot go direct to
 * storage — it must pass through our server to be re-encoded, see
 * ./photo-strip.ts), while the bucket bounds any OBJECT, including a generated
 * PNG that the door never sees and that can legitimately be larger than the
 * photo it came from.
 */


/* --------------------------------------------------------------- the gate */

/**
 * Nothing in this pipeline runs unless `FP_CHILD_PHOTO_LIVE` is explicitly on.
 *
 * FAIL CLOSED, and read at CALL TIME, never captured at module load: a
 * module-level constant freezes the value into a warm serverless instance, so
 * flipping the flag would take effect only for containers that happened to cold
 * start afterwards — which for a KILL switch is the wrong direction of failure.
 *
 * Allowlisted values only, matching `isImageLabLive` and `isCoverAiLive`.
 * `FP_CHILD_PHOTO_LIVE=false` and `=0` are the two ways an operator says "off"
 * in a dashboard, and a plain truthiness check reads BOTH as on — here that
 * would mean sending a real child's face to a third party because someone typed
 * the word "false".
 *
 * This is the ONLY switch. There is deliberately no second flag: a second one
 * invites the reading that either alone is sufficient.
 */
export function isChildPhotoLive(env?: { FP_CHILD_PHOTO_LIVE?: string | undefined }): boolean {
  const raw = (env ? env.FP_CHILD_PHOTO_LIVE : process.env.FP_CHILD_PHOTO_LIVE)
    ?.trim()
    .toLowerCase();
  return raw === "1" || raw === "true";
}

/* ----------------------------------------------------------- the model id */

/**
 * The image model this pipeline dials, as an Image Lab REGISTRY KEY — never a
 * gateway `"provider/model"` string. The registry
 * (app/staff/image-lab/lib/model-registry.ts) owns the gateway id, the timeout,
 * the price, the reference-image limit and the provider options; resolving
 * through it is what keeps this pipeline from becoming a second adapter with a
 * second set of those numbers.
 *
 * ⚠⚠ THIS ID DOES NOT RESOLVE TODAY, AND THAT IS THE SHIPPED STATE. ⚠⚠
 *
 * The build instruction named `gemini-3-flash-image` as "one of the three the
 * Image Lab already wires". It is not. Verified against the working tree:
 *
 *   - the registry's three ids are `gpt-image-2`, `gemini-3-pro-image` and
 *     `gemini-3.1-flash-lite-image`;
 *   - the installed `@ai-sdk/gateway` catalog contains no `gemini-3-flash-image`
 *     at all. Its nearest neighbours are `google/gemini-3.1-flash-image`,
 *     `google/gemini-3.1-flash-image-preview` and the registry's own
 *     `google/gemini-3.1-flash-lite-image`.
 *
 * So this constant is left as the id that was ORDERED, and `findModelEntry`
 * returns null for it, and `generateLabImage` therefore answers `unconfigured`
 * without dialling anything. The pipeline FAILS CLOSED: no vendor call, no
 * cover change, and (see ./child-photo-generate-core.ts) the source photo is
 * still deleted.
 *
 * Silently substituting a model that DOES resolve was rejected. A pipeline that
 * quietly sends a real child's face to a different vendor model than the one an
 * authorization decision was made about is the exact failure this unit's whole
 * posture is built to prevent — and the substitution would be invisible, because
 * a working generation looks like success.
 *
 * ⚠ FOUNDER INPUT REQUIRED before this pipeline can generate anything:
 *   confirm WHICH model the personGeneration allowlist grant actually covers,
 *   then add a registry entry for it (gateway id, price, timeout, refImageLimit,
 *   dataUseNote, and a `verified.personGeneration` note recording the grant) and
 *   point this constant at that entry's id. Note that adding a registry entry
 *   also adds a column to the staff Image Lab's compare selector, which is why
 *   this unit does not do it unilaterally.
 */
export const FP_COVER_MODEL_ID = "gemini-3-flash-image";

/* ------------------------------------------------------------- the bucket */

/** The private Supabase Storage bucket the migration creates. Never public;
 *  every read is a service-role read or a short-lived signed URL. */
export const FP_CHILD_MEDIA_BUCKET = "fp-child-media";

/**
 * The bucket's `file_size_limit`, byte-identical to the migration (parity
 * test). 8 MB: comfortably above any generated cover this pipeline writes and
 * twice the door's own inbound bound, so the bucket is a BACKSTOP against a
 * future writer that forgets the door's limit rather than a duplicate of it.
 * Well under the project's 50 MB Free-tier per-object hard ceiling.
 */
export const FP_CHILD_MEDIA_MAX_OBJECT_BYTES = 8388608; // 8 * 1024 * 1024

/** The project's Free-tier per-object hard ceiling (supabase/migrations/
 *  20260722140000_path_storage.sql). Pinned so raising the pair past it is a
 *  test failure rather than an opaque storage error weeks later. */
export const SUPABASE_TIER_MAX_OBJECT_BYTES = 52428800; // 50 * 1024 * 1024

/**
 * Types the BUCKET accepts. The union of what a parent may upload
 * ({@link FP_CHILD_PHOTO_ACCEPTED_MIME_TYPES}) and what the generator emits —
 * which is the same three, because ./photo-strip.ts re-encodes every accepted
 * upload to one of them and the image adapter's sniff produces the same set.
 *
 * ⚠ `image/svg+xml` is absent and must stay absent. An SVG is an executable
 * document on the storage origin; a bucket that accepts one is a stored XSS
 * against whatever session is handed a signed URL.
 *
 * ⚠ `image/heic` is absent DELIBERATELY, and that is a real product decision,
 * not an oversight — see {@link FP_CHILD_PHOTO_ACCEPTED_MIME_TYPES}.
 */
export const FP_CHILD_MEDIA_ACCEPTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type ChildMediaMimeType = (typeof FP_CHILD_MEDIA_ACCEPTED_MIME_TYPES)[number];

/**
 * Types the UPLOAD DOOR accepts from a parent.
 *
 * ⚠ HEIC IS REFUSED, and the reason is a hard capability fact rather than a
 * preference: the `sharp` build available here (0.34.5 / libvips 8.17.3) reports
 * `heif` support whose `fileSuffix` is `[".avif"]` only — it carries an AV1
 * decoder, not the HEVC decoder a camera HEIC needs. So a HEIC CANNOT be
 * decoded, and therefore cannot be RE-ENCODED, and therefore cannot have its
 * GPS EXIF removed by the only mechanism this pipeline trusts (./photo-strip.ts
 * explains why tag deletion is not an acceptable substitute).
 *
 * The two ways to be wrong here, both rejected:
 *   - accept HEIC and pass it through unstripped — ships a minor's home
 *     coordinates to a third-party model provider, which is precisely the
 *     failure this unit exists to prevent;
 *   - accept HEIC and let the strip "best effort" fail open — same outcome,
 *     with a comment claiming otherwise.
 * So the door refuses it with a reason the UI can state plainly. In practice
 * this costs less than it looks: iOS's own file/photo pickers transcode to JPEG
 * on upload for `accept="image/jpeg,image/png"`, so a HEIC arrives mainly when a
 * caller bypasses the picker. If HEIC ever must be accepted, the fix is a
 * libheif-enabled decode path, NOT a relaxed allowlist.
 */
export const FP_CHILD_PHOTO_ACCEPTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type ChildPhotoMimeType = (typeof FP_CHILD_PHOTO_ACCEPTED_MIME_TYPES)[number];

/**
 * The DOOR's inbound bound. ~3.8 MB, deliberately under the platform's ~4.5 MB
 * serverless function request-body ceiling: a photo must traverse our origin to
 * be re-encoded, so unlike the Image Lab's references there is no
 * direct-to-storage leg to hide a larger body behind. A body over the platform
 * ceiling is rejected by the platform with a response we do not control, so the
 * door's own limit sits below it and produces OUR refusal instead.
 */
export const FP_CHILD_PHOTO_MAX_BYTES = 4_000_000;

/** The smallest thing that could be a photograph. Zero-length and few-byte
 *  bodies are refused BEFORE the decoder is handed them: a decoder is a large
 *  attack surface and there is no reason to reach it with 3 bytes. */
export const FP_CHILD_PHOTO_MIN_BYTES = 512;

/**
 * Canonicalize a declared content type, or null if it is not an accepted photo.
 *
 * Per RFC 2045 the type/subtype is case-INSENSITIVE and parameters are legal,
 * so `image/JPEG` and `image/jpeg; charset=binary` normalize rather than
 * refuse. Callers STORE the returned canonical form, never the raw header.
 *
 * ⚠ A DECLARED TYPE IS A CLAIM, NOT EVIDENCE. This function gates which bytes
 * are worth handing to a decoder; what the object is ACTUALLY stored as comes
 * from ./photo-strip.ts, which re-encodes and therefore KNOWS.
 */
export function normalizePhotoMimeType(
  value: string | null | undefined
): ChildPhotoMimeType | null {
  if (typeof value !== "string") return null;
  const base = value.split(";")[0]!.trim().toLowerCase();
  return (FP_CHILD_PHOTO_ACCEPTED_MIME_TYPES as readonly string[]).includes(base)
    ? (base as ChildPhotoMimeType)
    : null;
}

/** Convenience membership predicate, used by the migration parity test (which
 *  asks a SET-MEMBERSHIP question and has no use for the normalized form). */
export const isAcceptedPhotoMimeType = (value: string | null | undefined): boolean =>
  normalizePhotoMimeType(value) !== null;

/* ------------------------------------------------------ upload admission */

export type PhotoAdmissionRefusal =
  /** The unit's kill switch is off. Checked FIRST, before size or type, so a
   *  dark build never reports a size opinion about a minor's photo. */
  | "gate_closed"
  | "missing_photo"
  | "unsupported_type"
  | "too_large"
  | "too_small";

export type PhotoAdmission =
  | { ok: true; contentType: ChildPhotoMimeType; byteSize: number }
  | { ok: false; reason: PhotoAdmissionRefusal };

/**
 * May these bytes be admitted for stripping?
 *
 * ORDER IS THE CONTRACT and is asserted by test: gate → presence → type →
 * size. The gate first because a closed gate must never be distinguishable from
 * a well-formed upload; type before size because "we do not take HEIC" is
 * actionable and "too large" about a file we would have refused anyway is not.
 *
 * Pure and total. The caller supplies the already-measured byte length rather
 * than the bytes, so admission can be decided about a stream before it is
 * buffered.
 */
export function decidePhotoAdmission(input: {
  live: boolean;
  contentType: string | null | undefined;
  byteSize: number;
}): PhotoAdmission {
  if (!input.live) return { ok: false, reason: "gate_closed" };
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, reason: "missing_photo" };
  }
  const contentType = normalizePhotoMimeType(input.contentType);
  if (!contentType) return { ok: false, reason: "unsupported_type" };
  if (input.byteSize > FP_CHILD_PHOTO_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (input.byteSize < FP_CHILD_PHOTO_MIN_BYTES) return { ok: false, reason: "too_small" };
  return { ok: true, contentType, byteSize: input.byteSize };
}

/* ------------------------------------------------------- rate limiting */




/* ------------------------------------------------------------ time budgets */


