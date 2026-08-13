import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  jpegMetadataSegments,
  realPhotoEncoder,
  STRIPPED_PHOTO_CONTENT_TYPE,
  STRIPPED_PHOTO_MAX_EDGE,
  stripPhotoMetadata,
} from "../photo-strip";

/**
 * THE ONE TEST IN THIS UNIT THAT MAY NOT USE A MOCK.
 *
 * Every other module here is deps-injected so its ORDERING can be observed. This
 * one asserts a property of BYTES — "no metadata survived" — and a fake encoder
 * can only ever restate the claim it was written from. So this file drives the
 * REAL `sharp`, builds a REAL JPEG carrying REAL GPS EXIF, and then reads the
 * OUTPUT BUFFER back three independent ways:
 *
 *   1. structurally — the JPEG marker chain contains no APP1/APP13/COM segment;
 *   2. semantically — sharp's own metadata reader finds no exif/xmp/iptc block;
 *   3. literally — the distinctive strings we planted do not appear anywhere in
 *      the output bytes, at any offset, in any encoding we put them in.
 *
 * (3) is the one that catches the failure the other two would miss: a metadata
 * payload copied into a segment neither a parser nor a marker walk classifies as
 * metadata. If GPS coordinates are in the file, a substring search finds them.
 */

/** A tiny image carrying the metadata we are trying to destroy. The strings are
 *  deliberately distinctive so a substring search over the output is meaningful. */
const OWNER_TAG = "SECRET-OWNER-NAME-9f21";
const CAMERA_TAG = "SECRET-CAMERA-MODEL-4b7e";
const GPS_LATITUDE = "51/1 30/1 0/1";
const GPS_LONGITUDE = "0/1 7/1 0/1";
/** GPS rationals are stored as BINARY, so they are not substring-searchable.
 *  This ASCII GPS tag is, and it is what the literal-search assertions use to
 *  prove the GPS IFD itself is gone rather than merely unparsed. */
const GPS_DATESTAMP = "2026:08:14";

async function makeGeotaggedJpeg(width = 240, height = 180): Promise<Uint8Array> {
  const base = await sharp({
    create: { width, height, channels: 3, background: "#336699" },
  })
    .jpeg()
    .toBuffer();
  const tagged = await sharp(base)
    .withExif({
      IFD0: { Copyright: OWNER_TAG, Software: CAMERA_TAG, Model: CAMERA_TAG },
      // libvips exposes the GPS IFD as IFD3.
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: GPS_LATITUDE,
        GPSLongitudeRef: "W",
        GPSLongitude: GPS_LONGITUDE,
        GPSDateStamp: GPS_DATESTAMP,
      },
    })
    .jpeg()
    .toBuffer();
  return new Uint8Array(tagged);
}

const contains = (haystack: Uint8Array, needle: string): boolean =>
  Buffer.from(haystack).includes(Buffer.from(needle, "latin1"));

describe("photo-strip: the source photo really is scrubbed", () => {
  it("the FIXTURE actually carries GPS EXIF — otherwise every assertion below is vacuous", async () => {
    const input = await makeGeotaggedJpeg();
    const meta = await sharp(Buffer.from(input)).metadata();
    expect(meta.exif, "fixture must carry an EXIF block").toBeTruthy();
    expect(jpegMetadataSegments(input)).toContain("APP1");
    expect(contains(input, OWNER_TAG)).toBe(true);
    expect(contains(input, CAMERA_TAG)).toBe(true);
    expect(contains(input, GPS_DATESTAMP), "the GPS IFD must really be in the fixture").toBe(true);
  });

  it("the re-encode removes EXIF, GPS and every planted string FROM THE OUTPUT BYTES", async () => {
    const input = await makeGeotaggedJpeg();
    const result = await stripPhotoMetadata(input, "image/jpeg");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // (1) structural: no metadata-bearing marker segment survives. APP0 (JFIF
    // density) is permitted — it carries no provenance.
    const segments = jpegMetadataSegments(result.bytes);
    expect(segments.filter((s) => s !== "APP0")).toEqual([]);

    // (2) semantic: sharp's own reader finds nothing.
    const meta = await sharp(Buffer.from(result.bytes)).metadata();
    expect(meta.exif).toBeFalsy();
    expect(meta.xmp).toBeFalsy();
    expect(meta.iptc).toBeFalsy();
    expect(meta.orientation).toBeFalsy();

    // (3) literal: the planted values are nowhere in the file, at any offset.
    expect(contains(result.bytes, OWNER_TAG)).toBe(false);
    expect(contains(result.bytes, CAMERA_TAG)).toBe(false);
    expect(contains(result.bytes, GPS_DATESTAMP)).toBe(false);
    expect(contains(result.bytes, "Exif")).toBe(false);
  });

  it("the output is always JPEG, whatever went in", async () => {
    const png = await sharp({
      create: { width: 120, height: 90, channels: 4, background: "#ff00ff" },
    })
      .png()
      .toBuffer();
    const result = await stripPhotoMetadata(new Uint8Array(png), "image/png");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe(STRIPPED_PHOTO_CONTENT_TYPE);
    // The first two bytes of any JPEG are SOI.
    expect([result.bytes[0], result.bytes[1]]).toEqual([0xff, 0xd8]);
  });

  it("PNG text chunks cannot survive the container change either", async () => {
    const png = await sharp({
      create: { width: 120, height: 90, channels: 3, background: "#123456" },
    })
      .png()
      .withMetadata({ exif: { IFD0: { Copyright: OWNER_TAG } } })
      .toBuffer();
    const result = await stripPhotoMetadata(new Uint8Array(png), "image/png");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(contains(result.bytes, OWNER_TAG)).toBe(false);
  });

  it("EXIF orientation is APPLIED before it is discarded — a portrait does not arrive sideways", async () => {
    // Orientation 6 means "rotate 90° clockwise on display". A stripper that
    // deletes the tag without acting on it leaves a 240x180 landscape frame; a
    // correct one hands back 180x240.
    const base = await sharp({
      create: { width: 240, height: 180, channels: 3, background: "#446688" },
    })
      .jpeg()
      .toBuffer();
    const rotated = await sharp(base).withMetadata({ orientation: 6 }).jpeg().toBuffer();

    const result = await stripPhotoMetadata(new Uint8Array(rotated), "image/jpeg");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.width, result.height]).toEqual([180, 240]);
    // …and the tag itself is gone, so nothing rotates it a second time.
    const meta = await sharp(Buffer.from(result.bytes)).metadata();
    expect(meta.orientation).toBeFalsy();
  });

  it("downsamples to the max edge — data minimization, not a rendering preference", async () => {
    const big = await sharp({
      create: { width: 3200, height: 2400, channels: 3, background: "#777777" },
    })
      .jpeg()
      .toBuffer();
    const result = await stripPhotoMetadata(new Uint8Array(big), "image/jpeg");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.max(result.width, result.height)).toBe(STRIPPED_PHOTO_MAX_EDGE);
  });

  it("never enlarges a small photo into a bigger file carrying no more information", async () => {
    const small = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#222222" },
    })
      .jpeg()
      .toBuffer();
    const result = await stripPhotoMetadata(new Uint8Array(small), "image/jpeg");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.width, result.height]).toEqual([80, 60]);
  });

  it("HEIC is undecodable here — which is exactly why the door refuses it", async () => {
    // The `heif` feature this build reports is AVIF-only (no HEVC decoder), so a
    // real camera HEIC cannot be re-encoded and therefore cannot be stripped.
    // Pinned as a CAPABILITY assertion: if a future sharp gains HEVC, this test
    // fails and someone gets to reconsider the door's allowlist deliberately.
    expect(sharp.format.heif?.input?.fileSuffix ?? []).not.toContain(".heic");
  });

  it("garbage is refused, and the vendor's error text is never surfaced", async () => {
    const junk = new Uint8Array(2048).fill(0x41);
    const result = await stripPhotoMetadata(junk, "image/jpeg");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("undecodable");
    // The refusal is a closed-set token — never a decoder message that could
    // quote the file.
    expect(Object.keys(result)).toEqual(["ok", "reason"]);
  });

  it("an empty body is refused rather than stored", async () => {
    const result = await stripPhotoMetadata(new Uint8Array(0), "image/jpeg");
    expect(result.ok).toBe(false);
  });

  it("never throws — a security control a caller must try/catch is one they will forget", async () => {
    await expect(stripPhotoMetadata(new Uint8Array([1, 2, 3]), "image/png")).resolves.toMatchObject(
      { ok: false }
    );
  });

  it("an implausible re-encode is refused, not stored", async () => {
    // The encoder seam exists so a caller can prove ordering; here it proves the
    // output plausibility check is real rather than decorative.
    const result = await stripPhotoMetadata(
      await makeGeotaggedJpeg(),
      "image/jpeg",
      async () => ({ data: new Uint8Array(0), info: { width: 10, height: 10 } })
    );
    expect(result).toEqual({ ok: false, reason: "reencode_implausible" });
  });

  it("a decompression bomb is classified as itself", async () => {
    const result = await stripPhotoMetadata(await makeGeotaggedJpeg(), "image/jpeg", async () => {
      throw new Error("Input image exceeds pixel limit (limitInputPixels)");
    });
    expect(result).toEqual({ ok: false, reason: "too_many_pixels" });
  });

  it("realPhotoEncoder is the ONLY place the guarantee is made, and it makes it", async () => {
    // Exercised directly so the wrapper cannot rot behind the seam.
    const out = await realPhotoEncoder(await makeGeotaggedJpeg());
    expect(contains(out.data, "Exif")).toBe(false);
    expect(out.info.width).toBeGreaterThan(0);
  });

  it("⚠ SOURCE GUARD: the encoder never asks sharp to keep metadata", async () => {
    // The guarantee is the ABSENCE of a call, and an absence is not something a
    // behavioural test can see once someone adds it back with a filter. So the
    // module's own source is read: `.withMetadata(` / `.keepMetadata(` /
    // `.withIccProfile(` anywhere in the encoder is the regression.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(
      path.resolve(process.cwd(), "app/lib/fp/child-photo/photo-strip.ts"),
      "utf8"
    );
    // Strip comments so the module's own warning about these calls does not
    // satisfy the assertion it warns about.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\.withMetadata\s*\(/);
    expect(code).not.toMatch(/\.keepMetadata\s*\(/);
    expect(code).not.toMatch(/\.keepExif\s*\(/);
    expect(code).not.toMatch(/\.withIccProfile\s*\(/);
  });
});
