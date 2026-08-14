import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  PLACEHOLDER_CAPTION,
  PLACEHOLDER_COVER_SIZE,
  placeholderKittenGenerator,
  placeholderKittenSvg,
  renderPlaceholderKittenPng,
} from "../child-photo-placeholder-generator";

/**
 * The placeholder kitten, asserted on the BYTES it produces rather than on the
 * SVG source, because the bytes are what travels the store path and the bytes
 * are what a family would see.
 *
 * The two properties that make this safe to exist at all:
 *   * it produces a REAL RASTER the bucket accepts, so the placeholder proves
 *     the same storage path a real generation uses (never an SVG — see the
 *     module header: an SVG in that bucket is a stored XSS);
 *   * it is SELF-IDENTIFYING. The caption is drawn into the artwork, and this
 *     file pins that it survives rasterization — the whole point of hand-built
 *     letterforms rather than `<text>` is that a missing font cannot silently
 *     erase it.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("the placeholder kitten's bytes", () => {
  it("is a real, decodable PNG at the declared size", async () => {
    const bytes = await renderPlaceholderKittenPng();
    expect([...bytes.slice(0, 8)]).toEqual(PNG_MAGIC);

    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(PLACEHOLDER_COVER_SIZE);
    expect(meta.height).toBe(PLACEHOLDER_COVER_SIZE);
  });

  it("is small enough for the bucket's per-object ceiling with room to spare", async () => {
    const bytes = await renderPlaceholderKittenPng();
    // A flat-colour illustration. If this ever approaches the 8 MB bucket limit,
    // something has gone wrong with the drawing, not with the limit.
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    expect(bytes.byteLength).toBeLessThan(1_000_000);
  });

  it("is DETERMINISTIC — the same bytes every time, on every machine", async () => {
    const a = await renderPlaceholderKittenPng();
    const b = await renderPlaceholderKittenPng();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("is not an SVG, and never becomes one", async () => {
    const bytes = await renderPlaceholderKittenPng();
    // The bucket refuses image/svg+xml deliberately. A regression that returned
    // the SVG source instead of the raster would land it there anyway.
    expect(Buffer.from(bytes).subarray(0, 200).includes(Buffer.from("<svg"))).toBe(false);
  });
});

describe("⚠ the caption is DRAWN INTO the artwork", () => {
  it("every letter of PLACEHOLDER has a glyph and reaches the SVG", () => {
    const svg = placeholderKittenSvg();
    // One path per character of the caption, all inside one transformed group.
    const captionGroup = svg.slice(svg.indexOf("stroke=\"#8A7F6F\""));
    const paths = [...captionGroup.matchAll(/<path transform="translate\(\d+,0\)"/g)];
    expect(paths).toHaveLength(PLACEHOLDER_CAPTION.length);
  });

  it("uses NO <text> element and NO font-family — a missing font cannot erase it", () => {
    const svg = placeholderKittenSvg();
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("font-family");
  });

  it("survives rasterization as real ink — the caption band is not blank", async () => {
    const bytes = await renderPlaceholderKittenPng();
    // Crop the caption band and count distinct-from-background pixels. A blank
    // band (the failure mode a font-dependent caption has) would be uniform.
    const band = await sharp(Buffer.from(bytes))
      .extract({ left: 300, top: 880, width: 424, height: 70 })
      .stats();
    // `stdev` over a uniform region is 0. Real strokes move it well off zero.
    const maxStdev = Math.max(...band.channels.map((c) => c.stdev));
    expect(maxStdev).toBeGreaterThan(5);
  });
});

describe("the generator's contract", () => {
  const request = {
    modelId: "irrelevant",
    prompt: "irrelevant",
    referenceImages: [
      { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" as const },
    ],
  };

  it("answers a `generated` result the core can commit", async () => {
    const result = await placeholderKittenGenerator(request);
    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") return;
    expect(result.contentType).toBe("image/png");
    expect([...result.bytes.slice(0, 8)]).toEqual(PNG_MAGIC);
  });

  it("⚠ IGNORES the reference photo entirely — the output cannot depend on a child's face", async () => {
    const a = await placeholderKittenGenerator(request);
    const b = await placeholderKittenGenerator({
      ...request,
      referenceImages: [
        { bytes: new Uint8Array([255, 254, 253, 252]), contentType: "image/png" as const },
      ],
    });
    if (a.kind !== "generated" || b.kind !== "generated") throw new Error("expected bytes");
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it("bills nothing, and claims no gateway generation", async () => {
    const result = await placeholderKittenGenerator(request);
    if (result.kind !== "generated") throw new Error("expected bytes");
    expect(result.costReportedUsd).toBeNull();
    expect(result.gatewayGenerationId).toBeNull();
  });
});
