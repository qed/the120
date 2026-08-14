import "server-only";

/**
 * ⚠⚠ THE PLACEHOLDER KITTEN. NOT ARTWORK. NOT A MODEL. NOT FOR FAMILIES. ⚠⚠
 *
 * A {@link CoverImageGenerator} that ignores the photo it is handed and answers
 * with a hand-drawn picture of a CAT, so that the child-photo pipeline can be
 * exercised END TO END — upload, read, source-photo delete, cover put, cover
 * confirm, row commit — before a real image provider is wired.
 *
 * Founder decision, 2026-08-14. It is needed because
 * `FP_COVER_MODEL_ID` does not resolve in the Image Lab registry, so every
 * real call answers `unconfigured` and NO cover has ever committed, which leaves
 * the entire storage + commit path unexercised by anything but unit tests. The
 * point of this module is to prove that path with real bytes in a real bucket.
 *
 * ── HOW IT IS ARMED, AND HOW IT IS NOT ──
 * ONLY by `FP_COVER_PLACEHOLDER_MODE` (see `isCoverPlaceholderMode` in
 * ./child-photo-rules.ts, which documents the three rules the switch obeys).
 * Default OFF. NEVER a fallback for a failed real generation. Founder-only at
 * the door. Nothing in this file reads the environment: the core selects the
 * generator and injects it, so a test can prove the selection rather than the
 * comment.
 *
 * ── WHY THE KITTEN IS AUTHORED HERE, IN SVG, BY HAND ──
 *   * NO NETWORK. A placeholder that fetched a stock image would put a network
 *     call on the one code path that must never depend on one.
 *   * NO ASSET, NO LICENCE. There is no binary in the repo to license, to review,
 *     or to accidentally ship somewhere else.
 *   * NO AMBIGUITY. The caption `PLACEHOLDER` is DRAWN INTO THE ARTWORK (as
 *     stroked vector letterforms on a fixed 6x10 monospace grid — no font file,
 *     no fontconfig, so it renders identically on every machine and in CI). If a
 *     real family ever sees this image, it is self-evidently not their child's
 *     cover: it is a cartoon cat with the word PLACEHOLDER under it.
 *
 * ── WHY IT IS RASTERIZED WITH `sharp` RATHER THAN RETURNED AS SVG ──
 * Two reasons, and the second is a security control:
 *   1. The bucket's accepted types are png/jpeg/webp
 *      (FP_CHILD_MEDIA_ACCEPTED_MIME_TYPES) and the image adapter's contract is
 *      SNIFFED raster bytes. Returning SVG would take a different path through
 *      the store than a real generation, and proving the real path is the entire
 *      point of this exercise.
 *   2. `image/svg+xml` is DELIBERATELY absent from the bucket's allowlist because
 *      an SVG is an executable document on the storage origin. This module must
 *      not be the one thing that puts one there.
 * `sharp` is already a dependency (the metadata re-encoder ./photo-strip.ts uses
 * it), so this adds nothing to the deployed bundle.
 */

import sharp from "sharp";
import type { NormalizedImageResult } from "@/app/staff/image-lab/lib/image-model-rules";
import type { CoverImageGenerator } from "./child-photo-generate-core";

/* --------------------------------------------------- the monospace caption */

/**
 * A minimal stroked alphabet, only the nine letters `PLACEHOLDER` needs, drawn
 * on a 6-wide by 10-tall grid with a fixed advance — monospace BY CONSTRUCTION.
 *
 * Hand-built rather than typeset on purpose: `<text>` in an SVG makes the render
 * depend on a font being installed and on fontconfig resolving a generic family,
 * which is exactly the kind of environment-dependent difference that turns a
 * caption into a blank rectangle on a CI container. A caption that can silently
 * vanish is worse than no caption, because the caption is the ONLY thing that
 * makes this image self-identifying.
 */
const GLYPH_GRID = { width: 6, height: 10, advance: 9 } as const;

const GLYPHS: Readonly<Record<string, string>> = {
  P: "M0,10 L0,0 L4,0 L6,2 L6,3 L4,5 L0,5",
  L: "M0,0 L0,10 L6,10",
  A: "M0,10 L3,0 L6,10 M1,7 L5,7",
  C: "M6,2 L4,0 L2,0 L0,2 L0,8 L2,10 L4,10 L6,8",
  E: "M6,0 L0,0 L0,10 L6,10 M0,5 L4,5",
  H: "M0,0 L0,10 M6,0 L6,10 M0,5 L6,5",
  O: "M2,0 L4,0 L6,2 L6,8 L4,10 L2,10 L0,8 L0,2 Z",
  D: "M0,0 L3,0 L6,3 L6,7 L3,10 L0,10 Z",
  R: "M0,10 L0,0 L4,0 L6,2 L6,3 L4,5 L0,5 M3,5 L6,10",
};

/** The word drawn into every placeholder cover. Exported so the test asserts the
 *  caption exists rather than trusting a comment. */
export const PLACEHOLDER_CAPTION = "PLACEHOLDER";

/** The caption as SVG paths, laid out left to right on the monospace grid. */
function captionPaths(word: string): string {
  return [...word]
    .map((ch, i) => {
      const d = GLYPHS[ch];
      if (!d) throw new Error(`placeholder caption: no glyph for ${JSON.stringify(ch)}`);
      return `<path transform="translate(${i * GLYPH_GRID.advance},0)" d="${d}"/>`;
    })
    .join("");
}

/* ------------------------------------------------------------- the kitten */

/** The rendered square. Comfortably inside the bucket's per-object ceiling as a
 *  flat-colour PNG (a few tens of KB), and large enough that the caption is
 *  legible wherever a cover is shown. */
export const PLACEHOLDER_COVER_SIZE = 1024;

/**
 * The kitten, hand-authored. A friendly front-facing cat: ears, striped brow,
 * two big eyes with highlights, a small nose and muzzle, whiskers, a body and a
 * curled tail — and the caption beneath it.
 *
 * Deliberately flat and simple. This is a placeholder, and it should LOOK like a
 * placeholder next to anything a real illustrator or model would produce.
 */
export function placeholderKittenSvg(size: number = PLACEHOLDER_COVER_SIZE): string {
  const captionScale = 3;
  const captionWidth =
    GLYPH_GRID.width + (PLACEHOLDER_CAPTION.length - 1) * GLYPH_GRID.advance;
  const captionX = (1024 - captionWidth * captionScale) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#FBF3E4"/>
  <circle cx="512" cy="470" r="360" fill="#F3E3CB"/>

  <!-- tail, curling out from behind the body -->
  <path d="M700,760 C820,760 860,660 800,600 C770,570 720,590 730,640"
        fill="none" stroke="#C98F5A" stroke-width="34" stroke-linecap="round"/>

  <!-- body -->
  <path d="M512,560 C648,560 706,664 706,758 C706,782 690,794 664,794 L360,794 C334,794 318,782 318,758 C318,664 376,560 512,560 Z" fill="#E0A96D"/>
  <ellipse cx="424" cy="780" rx="52" ry="24" fill="#F6DCBB"/>
  <ellipse cx="600" cy="780" rx="52" ry="24" fill="#F6DCBB"/>

  <!-- ears -->
  <path d="M336,352 L360,178 L494,282 Z" fill="#E0A96D"/>
  <path d="M688,352 L664,178 L530,282 Z" fill="#E0A96D"/>
  <path d="M372,330 L386,238 L456,292 Z" fill="#F0A9AE"/>
  <path d="M652,330 L638,238 L568,292 Z" fill="#F0A9AE"/>

  <!-- head -->
  <circle cx="512" cy="450" r="212" fill="#E9B87C"/>

  <!-- brow stripes -->
  <g fill="none" stroke="#C98F5A" stroke-width="16" stroke-linecap="round">
    <path d="M470,300 L452,344"/>
    <path d="M512,290 L512,338"/>
    <path d="M554,300 L572,344"/>
  </g>

  <!-- eyes -->
  <ellipse cx="434" cy="446" rx="40" ry="48" fill="#3B332B"/>
  <ellipse cx="590" cy="446" rx="40" ry="48" fill="#3B332B"/>
  <circle cx="448" cy="428" r="13" fill="#FFFFFF"/>
  <circle cx="604" cy="428" r="13" fill="#FFFFFF"/>

  <!-- muzzle, nose and mouth -->
  <ellipse cx="512" cy="546" rx="86" ry="58" fill="#F6DCBB"/>
  <path d="M488,524 L536,524 L512,552 Z" fill="#E58A93"/>
  <path d="M512,552 L512,568 M512,568 C500,586 478,584 472,566 M512,568 C524,586 546,584 552,566"
        fill="none" stroke="#8A6A46" stroke-width="9" stroke-linecap="round"/>

  <!-- whiskers -->
  <g fill="none" stroke="#8A6A46" stroke-width="8" stroke-linecap="round" opacity="0.75">
    <path d="M410,528 L286,502"/>
    <path d="M410,552 L286,558"/>
    <path d="M614,528 L738,502"/>
    <path d="M614,552 L738,558"/>
  </g>

  <!-- ⚠ THE CAPTION. Removing this makes the image indistinguishable from real
       artwork at a glance, which is the one thing it must never be. -->
  <g transform="translate(${captionX},898) scale(${captionScale})"
     fill="none" stroke="#8A7F6F" stroke-width="1.1"
     stroke-linecap="round" stroke-linejoin="round">
    ${captionPaths(PLACEHOLDER_CAPTION)}
  </g>
</svg>`;
}

/**
 * Rasterize the kitten to PNG. Separate from the generator below so a test can
 * assert the BYTES are a real, decodable PNG of the expected size without going
 * through the generator's request/response shape.
 */
export async function renderPlaceholderKittenPng(
  size: number = PLACEHOLDER_COVER_SIZE
): Promise<Uint8Array> {
  const png = await sharp(Buffer.from(placeholderKittenSvg(size))).png().toBuffer();
  return new Uint8Array(png);
}

/* ---------------------------------------------------------- the generator */

/**
 * The placeholder generator, shaped exactly like the real adapter so it plugs
 * into the SAME seam (`ChildPhotoGenerateDeps.generatePlaceholder`) and its
 * output travels the SAME store and commit path.
 *
 * ⚠ IT NEVER READS `request`. The reference images it is handed are a photograph
 * of a real child; this function must not inspect them, hash them, size-log them
 * or echo them. `void request` is deliberate and load-bearing documentation.
 *
 * Answers the adapter's normalized union, so a failure to rasterize is a
 * `provider_error` the core already knows how to refuse on — it does NOT throw,
 * and it does NOT return a success-shaped value over missing bytes.
 */
export const placeholderKittenGenerator: CoverImageGenerator = async (
  request
): Promise<NormalizedImageResult> => {
  void request; // ⚠ the request carries a minor's photograph. Never touched.
  try {
    const bytes = await renderPlaceholderKittenPng();
    return {
      kind: "generated",
      bytes,
      contentType: "image/png",
      gatewayGenerationId: null,
      // Not null-because-unknown, like the real adapter: null because NOTHING
      // was billed. No vendor was dialled.
      costReportedUsd: null,
    };
  } catch {
    // The message is dropped rather than echoed: it is a rasterizer error about
    // our own SVG, and the core's `detail` is a closed set by contract.
    return { kind: "provider_error", detail: "no_image_returned" };
  }
};
