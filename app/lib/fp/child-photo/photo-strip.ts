import "server-only";

/**
 * RE-ENCODE a parent-supplied photograph of a child so that NOTHING but pixels
 * survives. The single failure this module exists to prevent: a photo of a minor
 * carrying GPS EXIF leaving our infrastructure for a third-party model provider.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DECISION: `sharp`, ADDED AS A DIRECT DEPENDENCY, RE-ENCODING TO JPEG.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ `sharp` was NOT a declared dependency of this repo before this unit. It was
 * PRESENT in node_modules (0.34.5 / libvips 8.17.3) only as an OPTIONAL,
 * TRANSITIVE dependency of `next` — `next/image` uses it for server-side
 * optimization. Depending on a transitive package is depending on someone else's
 * dependency graph: a Next.js minor that swaps its optimizer, or an install with
 * `--omit=optional`, removes it with no error anywhere until this module throws
 * `MODULE_NOT_FOUND` in production on a request carrying a child's face. So it is
 * now DECLARED in package.json. That is the whole of the "new dependency" cost —
 * the bytes were already being installed.
 *
 * ── THE THREE OPTIONS, AND WHAT EACH ACTUALLY REMOVES ──
 *
 * (1) HAND-WRITTEN TAG DELETION (no dependency). Walk the container and drop
 *     metadata segments.
 *       JPEG — removable: APP1/Exif (GPS lives here), APP1/XMP, APP13/IPTC,
 *               COM. NOT removable this way: anything the encoder left in the
 *               scan data, a second Exif block after the first (legal and
 *               common from editing apps), MPF/APP2 multi-picture payloads that
 *               EMBED A SECOND FULL JPEG — including its own GPS EXIF — inside
 *               the file. Samsung and Apple both ship these.
 *       PNG  — removable: eXIf, tEXt, iTXt, zTXt, tIME. NOT removable: private
 *               ancillary chunks a parser does not know to distrust.
 *       HEIC — not parseable at all without an ISOBMFF box walker; GPS lives in
 *               `meta/iinf/Exif` items that a naive stripper will not find.
 *     REJECTED. Tag deletion is a DENYLIST of the metadata shapes we thought of,
 *     applied to a container format designed to be extensible. The MPF case
 *     alone is disqualifying: a "stripped" file that still contains an entire
 *     second geotagged photograph is exactly the failure we are preventing,
 *     dressed as success.
 *
 * (2) `exifr` / `piexifjs` style pure-JS libraries. Same denylist objection —
 *     these READ metadata well and DELETE only what they model — plus a new
 *     dependency that is not already installed.
 *     REJECTED.
 *
 * (3) FULL DECODE → RE-ENCODE (`sharp`/libvips). The pixels are decoded into a
 *     raw buffer and a NEW file is written from them. Metadata is not deleted;
 *     it is never carried across, because the intermediate representation has
 *     nowhere to put it. libvips copies metadata only when explicitly asked
 *     (`withMetadata()` / `keepMetadata()`), and this module never asks.
 *       JPEG — output contains: JFIF/APP0, the quantization + Huffman tables,
 *               the SOF/SOS scan, and an ICC profile ONLY if we asked for one
 *               (we do not). Exif, GPS, XMP, IPTC, MPF, maker notes, thumbnails,
 *               comments: all absent, because none of them are pixels.
 *       PNG in → JPEG out: eXIf/tEXt/iTXt/zTXt cannot survive a container change.
 *       WebP in → JPEG out: EXIF/XMP chunks likewise cannot survive.
 *       HEIC — CANNOT BE DECODED HERE, so cannot be re-encoded, so is REFUSED at
 *               the door. See FP_CHILD_PHOTO_ACCEPTED_MIME_TYPES in
 *               ./child-photo-rules.ts, which owns that decision and the
 *               capability evidence behind it.
 *     CHOSEN.
 *
 * ── TWO THINGS RE-ENCODING GETS WRONG IF YOU ARE NOT CAREFUL ──
 *
 *   a) ORIENTATION IS METADATA. A phone photo is usually stored in the sensor's
 *      native orientation with an EXIF `Orientation` tag telling viewers to
 *      rotate it. Drop the tag without acting on it and every portrait photo
 *      reaches the model provider on its side. `.rotate()` with no argument
 *      means "apply the EXIF orientation now, then forget it" — it must be
 *      called BEFORE the encoder, and it is the one piece of metadata that is
 *      allowed to influence the output.
 *
 *   b) A DECODER IS AN ATTACK SURFACE. The input is an untrusted file from the
 *      public internet. `limitInputPixels` bounds the decompression-bomb class
 *      (a 100×100 PNG that expands to 100 megapixels), and the door's byte
 *      bound (FP_CHILD_PHOTO_MAX_BYTES) is applied BEFORE these bytes ever reach
 *      libvips.
 *
 * ── THE OUTPUT IS ALWAYS JPEG ──
 * One output format, so exactly one encoder path is exercised, exactly one
 * content type is ever stored, and the "did metadata survive?" test has one
 * answer to check. Alpha is flattened onto white — a photograph has no
 * meaningful transparency, and a model provider receiving RGBA gains nothing.
 */

import sharp from "sharp";
import {
  FP_CHILD_PHOTO_MAX_BYTES,
  type ChildPhotoMimeType,
} from "./child-photo-rules";

/** What every stored/transmitted source photo becomes. Not configurable: see
 *  the header's "the output is always JPEG". */
export const STRIPPED_PHOTO_CONTENT_TYPE = "image/jpeg" as const;

/**
 * The longest edge we keep. 1536px is well above what any image model consumes
 * as a reference (they downsample anyway) and well below what a modern phone
 * emits (4032px), so this is also the single biggest reduction in how much of a
 * child's face we retain and transmit. Data minimization as a default, not as a
 * setting.
 */
export const STRIPPED_PHOTO_MAX_EDGE = 1536;

/**
 * The decompression-bomb ceiling handed to libvips, in pixels. 40 megapixels is
 * roughly 4× a flagship phone sensor — generous for a real photo, nowhere near
 * enough for a crafted bomb. Exceeding it makes libvips REFUSE rather than
 * allocate.
 */
export const STRIPPED_PHOTO_MAX_INPUT_PIXELS = 40_000_000;

/** Quality of the re-encode. 82 is visually indistinguishable from source at
 *  this resolution and keeps the output comfortably inside the bucket bound. */
export const STRIPPED_PHOTO_QUALITY = 82;

export type StripFailureReason =
  /** The bytes are not a decodable image of a type we accept, or the decoder
   *  refused them (truncated file, unsupported subformat, HEIC). One reason for
   *  all of these on purpose: the caller must not become an oracle telling an
   *  uploader which malformed inputs get further into the decoder. */
  | "undecodable"
  /** Decoded fine, but the input exceeds STRIPPED_PHOTO_MAX_INPUT_PIXELS. */
  | "too_many_pixels"
  /** The re-encode produced something implausible (empty, or somehow larger
   *  than the door's own inbound bound). Refused rather than stored: an
   *  unexplained output is not a photo we are willing to send anywhere. */
  | "reencode_implausible";

export type StripResult =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: typeof STRIPPED_PHOTO_CONTENT_TYPE;
      width: number;
      height: number;
    }
  | { ok: false; reason: StripFailureReason };

/**
 * The image pipeline, as an injectable seam.
 *
 * Injected for ONE reason only: so a caller's tests can prove the ORDERING
 * around the strip (that generation never runs on unstripped bytes, that a
 * strip failure deletes nothing and generates nothing) without paying for a
 * real decode in every case. It is NOT injected so this module's OWN tests can
 * fake it — {@link stripPhotoMetadata}'s test uses the REAL sharp and asserts on
 * the REAL OUTPUT BYTES, because a mock cannot tell you whether EXIF survived.
 */
export type PhotoEncoder = (
  bytes: Uint8Array
) => Promise<{ data: Uint8Array; info: { width: number; height: number } }>;

/** The real encoder. Exported so it is testable in its own right — it is the
 *  only place the "no metadata" guarantee is actually made. */
export const realPhotoEncoder: PhotoEncoder = async (bytes) => {
  const out = await sharp(Buffer.from(bytes), {
    limitInputPixels: STRIPPED_PHOTO_MAX_INPUT_PIXELS,
    // Tolerate the truncated-but-viewable JPEGs phones and messaging apps
    // routinely produce. This RELAXES decode strictness, never metadata
    // handling: a partially-decoded image still re-encodes from pixels only.
    failOn: "error",
  })
    // (a) in the header: consume the EXIF orientation, then let it die with the
    // rest of the metadata. Must precede resize/encode.
    .rotate()
    .resize({
      width: STRIPPED_PHOTO_MAX_EDGE,
      height: STRIPPED_PHOTO_MAX_EDGE,
      fit: "inside",
      // Never upscale a small photo into a large file that carries no more
      // information.
      withoutEnlargement: true,
    })
    // A photograph has no meaningful alpha; flattening keeps the JPEG encoder
    // from inventing a background.
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: STRIPPED_PHOTO_QUALITY, mozjpeg: false })
    // ⚠ THE GUARANTEE IS THE ABSENCE OF A CALL. There is deliberately no
    // `.withMetadata()` / `.keepMetadata()` / `.withIccProfile()` anywhere in
    // this chain. Adding one re-attaches EXIF — including GPS — to a minor's
    // photograph. If you are here to "keep the colour profile", do not.
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength),
    info: { width: out.info.width, height: out.info.height },
  };
};

/**
 * Strip every scrap of metadata from a photograph by re-encoding it.
 *
 * `declaredType` is accepted and deliberately IGNORED for decoding: the decoder
 * sniffs the real container, so a JPEG mislabelled `image/png` still works and a
 * non-image labelled `image/jpeg` still fails. It exists in the signature so
 * call sites read honestly and so a future format decision has somewhere to
 * live.
 *
 * Never throws. Every decoder failure — malformed input, unsupported subformat,
 * a HEIC that reached here despite the door — normalizes to
 * `{ok: false, reason: "undecodable"}`, because a caller that must `try/catch`
 * around a security control is a caller that will one day forget to.
 */
export async function stripPhotoMetadata(
  bytes: Uint8Array,
  declaredType: ChildPhotoMimeType | null | undefined,
  encode: PhotoEncoder = realPhotoEncoder
): Promise<StripResult> {
  void declaredType; // see the docblock: the decoder sniffs, the header claims

  let encoded: Awaited<ReturnType<PhotoEncoder>>;
  try {
    encoded = await encode(bytes);
  } catch (err) {
    // The message is inspected for the ONE distinguishable case worth its own
    // reason (a bomb), and is otherwise DISCARDED — never logged and never
    // returned. libvips echoes file details into its errors, and this file is a
    // photograph of a child.
    const message = err instanceof Error ? err.message : "";
    if (/pixels|limitInputPixels|too large/i.test(message)) {
      return { ok: false, reason: "too_many_pixels" };
    }
    return { ok: false, reason: "undecodable" };
  }

  const { data, info } = encoded;
  if (
    data.byteLength === 0 ||
    data.byteLength > FP_CHILD_PHOTO_MAX_BYTES ||
    !Number.isInteger(info.width) ||
    !Number.isInteger(info.height) ||
    info.width <= 0 ||
    info.height <= 0
  ) {
    return { ok: false, reason: "reencode_implausible" };
  }

  return {
    ok: true,
    bytes: data,
    contentType: STRIPPED_PHOTO_CONTENT_TYPE,
    width: info.width,
    height: info.height,
  };
}

/**
 * Does this JPEG carry ANY metadata segment at all?
 *
 * Exported because it is the assertion the strip test makes on REAL BYTES, and
 * an assertion that lives in the test file is one a second test cannot reuse.
 * Walks the JPEG marker chain and reports every APPn / COM segment it finds; a
 * clean re-encode returns `[]` or at most `["APP0"]` (the JFIF density header,
 * which carries no provenance).
 *
 * Returns the marker names rather than a boolean so a failing test says WHICH
 * segment survived.
 */
export function jpegMetadataSegments(bytes: Uint8Array): string[] {
  const found: string[] = [];
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return found;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1]!;
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2) break;
    if (marker >= 0xe0 && marker <= 0xef) found.push(`APP${marker - 0xe0}`);
    else if (marker === 0xfe) found.push("COM");
    // SOS: entropy-coded data follows and the marker chain is over for our
    // purposes. Metadata after SOS is not a thing an encoder emits.
    if (marker === 0xda) break;
    i += 2 + length;
  }
  return found;
}
