/**
 * `asStoredCoverDataUrl` — the gate every cover crosses before it is carried
 * onto a child row and handed to a sign-in door (fpv04 U7c widened it).
 *
 * ⚠ WHY THIS FILE EXISTS. Every door test seeds an SVG artifact, so before
 * this file the RASTER arm — the only shape the generate route actually writes
 * — was asserted nowhere in this repo. Deleting the three raster prefixes left
 * the whole suite green while every generated cover was silently dropped by
 * all three doors, with the only guard living in the OTHER repo, on the other
 * side of an independent deploy.
 *
 * TWIN: First Profit's `asCoverUrl` (src/lib/cover.ts) must accept exactly the
 * same set. The literal list below is duplicated there on purpose: iterating
 * the local constant would pass in both repos while they disagreed.
 */
import { describe, expect, it } from "vitest";
import {
  COVER_DATA_URL_MAX,
  COVER_DATA_URL_PREFIXES,
  asStoredCoverDataUrl,
} from "../cover-store-rules";

const payload = "PHN2Zy8+";

/** The twin's list, written out rather than imported. */
const EXPECTED_PREFIXES = [
  "data:image/svg+xml;base64,",
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/webp;base64,",
];

describe("asStoredCoverDataUrl", () => {
  it("accepts exactly the four forms First Profit's asCoverUrl accepts", () => {
    expect([...COVER_DATA_URL_PREFIXES]).toEqual(EXPECTED_PREFIXES);
    for (const prefix of EXPECTED_PREFIXES) {
      const url = `${prefix}${payload}`;
      expect(asStoredCoverDataUrl(url), prefix).toBe(url);
    }
  });

  it("refuses the forms that were never about size", () => {
    for (const bad of [
      // A third-party request from a child's browser.
      "https://cdn.example.com/cover.png",
      "http://cdn.example.com/cover.png",
      // The URL parser over untrusted text beside the XML parser.
      "data:image/svg+xml,<svg/>",
      "data:image/svg+xml;utf8,<svg/>",
      // Not an image.
      "data:text/html;base64,PGgxPmhpPC9oMT4=",
      42,
      null,
      undefined,
      {},
    ]) {
      expect(asStoredCoverDataUrl(bad as unknown), String(bad)).toBeNull();
    }
  });

  it("refuses a bare prefix — half a data URL is a broken image, not a cover", () => {
    for (const prefix of EXPECTED_PREFIXES) {
      expect(asStoredCoverDataUrl(prefix), prefix).toBeNull();
    }
  });

  it("refuses over the ceiling whole, and admits right up to it", () => {
    for (const prefix of EXPECTED_PREFIXES) {
      expect(asStoredCoverDataUrl(`${prefix}${"A".repeat(COVER_DATA_URL_MAX)}`)).toBeNull();
      const atCap = `${prefix}${"A".repeat(COVER_DATA_URL_MAX - prefix.length)}`;
      expect(atCap.length).toBe(COVER_DATA_URL_MAX);
      expect(asStoredCoverDataUrl(atCap), prefix).toBe(atCap);
    }
  });
});
