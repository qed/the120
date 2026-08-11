/**
 * Generate The 120's brand icons — `npx tsx scripts/generate-brand-icons.ts`.
 *
 * Dependency-free on purpose, matching scripts/generate-path-icons.ts: a raw
 * PNG encoder over Node's built-in zlib plus an ICO container, no sharp/canvas.
 * Deterministic — re-running yields byte-identical files, so a diff on the
 * outputs means someone changed THIS script.
 *
 * Design: the "120" badge — white numerals on brand red (globals.css
 * `--color-red: #d92632`). Full-bleed square; iOS masks its own squircle onto
 * apple-touch-icons, so no baked-in rounding.
 *
 * WHY this replaced app/icon.tsx + app/apple-icon.tsx (both deleted):
 *
 *  1. favicon.ico CANNOT be generated. Next's app-icons doc is explicit — "You
 *     cannot generate a favicon icon. Use icon or a favicon.ico file instead."
 *     The old setup shipped no favicon.ico at all, so /favicon.ico was a 404
 *     and every consumer that hard-requests that path (search results, chat
 *     unfurls, RSS readers, bookmark managers) got the HTML 404 page and drew
 *     a blank. Since the .ico has to be a committed file, generating the PNGs
 *     from the SAME script is what keeps all three from drifting apart.
 *
 *  2. The old ImageResponse set `fontWeight: 700` on a text node, but
 *     ImageResponse does not synthesize bold — with no font file supplied it
 *     fell back to regular-weight Noto Sans. The numerals rendered thin at
 *     fontSize 15 on a 32px canvas, then the browser downscaled that to 16px
 *     in the tab strip: a red square with a faint smudge on it.
 *
 * The fix for (2) is drawing the digits as geometry rather than text, so there
 * is no font to fall back on and stroke weight is chosen per size. The mark is
 * OPTICALLY SIZED, not merely scaled: `metrics()` re-derives stroke, gap and
 * cap height at each output size and rounds them to whole pixels, so 16px gets
 * a proportionally heavier stroke on a snapped grid instead of a downsample of
 * the 180px art. That is the entire reason the small sizes stay legible.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** globals.css `--color-red`. */
const RED: [number, number, number] = [0xd9, 0x26, 0x32];
const WHITE: [number, number, number] = [0xff, 0xff, 0xff];

// ── PNG plumbing (same shape as generate-path-icons.ts) ───────────────────────

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * stride + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO plumbing ─────────────────────────────────────────────────────────────

/**
 * One BMP (DIB) entry for an ICO. Deliberately BMP rather than the PNG-in-ICO
 * form that Vista+ also allows: the only consumers still asking for
 * /favicon.ico are the old and the dumb, and BMP is what all of them read.
 *
 * Two format traps, both silent if you get them wrong:
 *  - biHeight is DOUBLE the real height. The header describes the XOR (colour)
 *    and AND (mask) bitmaps stacked, even when 32bpp alpha makes the mask
 *    redundant.
 *  - Rows run BOTTOM-UP, and the AND mask must still be present and padded to
 *    4-byte rows. Omitting it makes some readers treat colour bytes as mask.
 */
function encodeIcoBmp(size: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight — XOR + AND stacked
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y; // bottom-up
    for (let x = 0; x < size; x++) {
      const s = (srcRow * size + x) * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }

  // 1bpp AND mask, rows padded to 4 bytes. All zero = "use the colour data".
  const maskRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRow * size);

  header.writeUInt32LE(xor.length + and.length, 20); // biSizeImage
  return Buffer.concat([header, xor, and]);
}

function encodeIco(images: { size: number; rgba: Uint8Array }[]): Buffer {
  const bodies = images.map((i) => encodeIcoBmp(i.size, i.rgba));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map((img, i) => {
    const e = Buffer.alloc(16);
    e[0] = img.size === 256 ? 0 : img.size; // 0 encodes 256
    e[1] = img.size === 256 ? 0 : img.size;
    e[2] = 0; // palette size
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(bodies[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += bodies[i].length;
    return e;
  });

  return Buffer.concat([dir, ...entries, ...bodies]);
}

// ── signed-distance primitives ───────────────────────────────────────────────
//
// Each returns distance from a point to the shape's CENTRELINE; the caller
// subtracts the stroke half-width and converts to coverage. Same 1px-ramp
// antialiasing idea as generate-path-icons.ts, but distance-based so it works
// on strokes rather than just discs.

type Shape = (x: number, y: number) => number;

function segment(ax: number, ay: number, bx: number, by: number): Shape {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  return (x, y) => {
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  };
}

/**
 * Distance to an ellipse outline, via the first-order approximation
 * f / |grad f| for f = (x/rx)² + (y/ry)² - 1. The naive `(k - 1) * min(rx, ry)`
 * form is badly wrong at the ends of a squashed ellipse, and the "0" here is
 * squashed hard (4×9px at favicon size).
 */
function ellipse(cx: number, cy: number, rx: number, ry: number): Shape {
  return (x, y) => {
    const px = x - cx;
    const py = y - cy;
    const k = (px / rx) ** 2 + (py / ry) ** 2 - 1;
    const grad = 2 * Math.hypot(px / (rx * rx), py / (ry * ry));
    return grad === 0 ? Math.min(rx, ry) : Math.abs(k / grad);
  };
}

/** Distance to a circular arc between two angles (radians, y-down, CCW-in-screen). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): Shape {
  const TAU = Math.PI * 2;
  const span = a1 - a0;
  return (x, y) => {
    const px = x - cx;
    const py = y - cy;
    const a = Math.atan2(py, px);
    // Bring the angle into [a0, a0 + TAU) so the span test is a plain compare.
    let rel = a - a0;
    rel -= Math.floor(rel / TAU) * TAU;
    if (rel <= span) return Math.abs(Math.hypot(px, py) - r);
    // Outside the sweep: nearest endpoint.
    const e0x = cx + r * Math.cos(a0);
    const e0y = cy + r * Math.sin(a0);
    const e1x = cx + r * Math.cos(a1);
    const e1y = cy + r * Math.sin(a1);
    return Math.min(Math.hypot(x - e0x, y - e0y), Math.hypot(x - e1x, y - e1y));
  };
}

// ── the mark ─────────────────────────────────────────────────────────────────

/**
 * Optical sizing. Every value is rounded to whole pixels so stems land on the
 * grid rather than straddling two columns at half coverage — the difference
 * between a crisp 16px "120" and the grey smear the old text render produced.
 */
function metrics(n: number) {
  const stroke = Math.max(1, Math.round(n * 0.07));
  const pad = Math.max(1, Math.round(n * 0.08));
  const gap = Math.max(1, Math.round(n * 0.035));
  const digitW = Math.floor((n - 2 * pad - 2 * gap) / 3);
  const capH = Math.round(n * 0.56);
  // Re-centre on what the rounding actually produced, not on what was asked.
  const totalW = 3 * digitW + 2 * gap;
  const left = Math.round((n - totalW) / 2);
  const top = Math.round((n - capH) / 2);
  // Stem darkening, as a font rasterizer does at small ppem. At 16px the whole
  // mark is a 1px stroke, and only the pixels a centreline passes exactly
  // through come out white — a snapped vertical stem does, but nothing curved
  // or diagonal can, so an ungained "2" and "0" render pale pink beside a crisp
  // "1". Multiplying coverage fixes the density mismatch without touching the
  // geometry; counters stay open because a fully-inside pixel has coverage 0,
  // and 0 times anything is still 0.
  const gain = 1 + 16 / n;
  return { stroke, gap, digitW, capH, left, top, gain };
}

/**
 * Snap a stroke's centreline so its edges land on pixel boundaries: odd stroke
 * widths want a half-integer centre, even ones a whole integer.
 */
function snap(v: number, stroke: number): number {
  return stroke % 2 === 1 ? Math.round(v - 0.5) + 0.5 : Math.round(v);
}

/** Shapes for one digit in a local box of `w` × `h` at origin (ox, oy). */
function digitShapes(d: "1" | "2" | "0", ox: number, oy: number, w: number, h: number, stroke: number): Shape[] {
  const hw = stroke / 2;
  const top = oy + hw;
  const bottom = oy + h - hw;

  if (d === "1") {
    // Stem slightly right of centre to leave room for the flag, as in a
    // geometric grotesque (Space Grotesk, the site's display face). No foot
    // serif — that face has none.
    const stemX = snap(ox + w * 0.62, stroke);
    return [
      segment(stemX, top, stemX, bottom),
      segment(stemX, top, ox + w * 0.14, oy + h * 0.22),
    ];
  }

  if (d === "0") {
    const cx = ox + w / 2;
    const cy = oy + h / 2;
    return [ellipse(cx, cy, w / 2 - hw, h / 2 - hw)];
  }

  // "2": a top bowl, a diagonal down to the baseline, and a flat base.
  // Angles are y-DOWN, so 180° is the left of the bowl, 270° its top, and the
  // sweep runs 160° → 20° (+360) — starting just below the horizontal on the
  // left, over the top, and ending just below it on the right, where the
  // diagonal takes over.
  const r = w / 2 - hw;
  const cx = ox + w / 2;
  const cy = top + r;
  const a0 = (160 * Math.PI) / 180;
  const a1 = (380 * Math.PI) / 180;
  const baseY = snap(bottom, stroke);
  return [
    arc(cx, cy, r, a0, a1),
    segment(cx + r * Math.cos(a1), cy + r * Math.sin(a1), ox + hw, baseY),
    segment(ox + hw, baseY, ox + w - hw, baseY),
  ];
}

function drawIcon(n: number): Uint8Array {
  const { stroke, gap, digitW, capH, left, top, gain } = metrics(n);
  const hw = stroke / 2;

  const shapes: Shape[] = [];
  (["1", "2", "0"] as const).forEach((d, i) => {
    shapes.push(...digitShapes(d, left + i * (digitW + gap), top, digitW, capH, stroke));
  });

  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      let dist = Infinity;
      for (const s of shapes) dist = Math.min(dist, s(cx, cy));
      // 1px linear ramp centred on the stroke edge, then stem darkening.
      const alpha = Math.max(0, Math.min(1, (hw + 0.5 - dist) * gain));
      const i = (y * n + x) * 4;
      px[i] = Math.round(WHITE[0] * alpha + RED[0] * (1 - alpha));
      px[i + 1] = Math.round(WHITE[1] * alpha + RED[1] * (1 - alpha));
      px[i + 2] = Math.round(WHITE[2] * alpha + RED[2] * (1 - alpha));
      px[i + 3] = 255;
    }
  }
  return px;
}

// ── outputs ──────────────────────────────────────────────────────────────────

const ICO_SIZES = [16, 32, 48];

writeFileSync(
  resolve(__dirname, "../app/favicon.ico"),
  encodeIco(ICO_SIZES.map((size) => ({ size, rgba: drawIcon(size) })))
);
console.log(`wrote app/favicon.ico (${ICO_SIZES.join(", ")})`);

for (const [size, rel] of [
  [32, "../app/icon.png"],
  [180, "../app/apple-icon.png"],
] as const) {
  writeFileSync(resolve(__dirname, rel), encodePng(size, drawIcon(size)));
  console.log(`wrote ${rel.replace("../", "")}`);
}
