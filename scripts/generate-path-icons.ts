/**
 * Generate The Path's PWA icons (T1 Unit 11) — `npx tsx scripts/generate-path-icons.ts`.
 *
 * Dependency-free on purpose: a raw PNG encoder over Node's built-in zlib (no
 * sharp/canvas — neither is a dependency here and neither is worth adding for
 * three small icons). Deterministic: re-running yields byte-identical files,
 * so a diff on public/path-icon-*.png means someone changed THIS script.
 *
 * Design: the phase-01 terracotta (globals.css `--phase-sell: 14 78% 54%`) as
 * the ground, with a winding trail of cream footstep-dots growing toward the
 * top — the Path, walked. Full-bleed square: iOS masks its own squircle onto
 * apple-touch-icons, so no baked-in rounding.
 *
 * Outputs (committed):
 *   app/fp/apple-icon.png   — apple-touch-icon (iOS wants exactly 180×180).
 *     The FILE CONVENTION in the /fp segment, so it replaces the root
 *     "120"-badge apple-icon.tsx for /fp pages only; its URL
 *     (/fp/apple-icon.png) is allowlisted in proxy-rules so an
 *     unauthenticated Add-to-Home-Screen can fetch it.
 *   public/path-icon-192.png  — manifest icon
 *   public/path-icon-512.png  — manifest icon
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// globals.css --phase-sell: hsl(14 78% 54%) and the trail-canvas cream family.
const GROUND: [number, number, number] = hslToRgb(14, 0.78, 0.54);
const DOT: [number, number, number] = [248, 244, 236]; // warm cream

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ── PNG plumbing ──────────────────────────────────────────────────────────────

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
  // scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── the artwork ───────────────────────────────────────────────────────────────

function bezier(t: number, p: [number, number][]): [number, number] {
  const u = 1 - t;
  const x = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
  const y = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
  return [x, y];
}

function drawIcon(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = GROUND[0];
    px[i * 4 + 1] = GROUND[1];
    px[i * 4 + 2] = GROUND[2];
    px[i * 4 + 3] = 255;
  }

  // A winding S-trail, bottom-left to top-right, dots growing as it climbs.
  const curve: [number, number][] = [
    [0.2, 0.84],
    [1.08, 0.72],
    [-0.08, 0.28],
    [0.8, 0.16],
  ];
  const dots = [0.04, 0.27, 0.5, 0.73, 0.96].map((t, i) => {
    const [cx, cy] = bezier(t, curve);
    return { cx: cx * size, cy: cy * size, r: (0.052 + i * 0.009) * size };
  });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let alpha = 0;
      for (const d of dots) {
        const dist = Math.hypot(x + 0.5 - d.cx, y + 0.5 - d.cy);
        // 1px-wide smoothstep edge for anti-aliasing.
        const a = Math.max(0, Math.min(1, d.r + 0.5 - dist));
        alpha = Math.max(alpha, a);
      }
      if (alpha > 0) {
        const i = (y * size + x) * 4;
        px[i] = Math.round(DOT[0] * alpha + GROUND[0] * (1 - alpha));
        px[i + 1] = Math.round(DOT[1] * alpha + GROUND[1] * (1 - alpha));
        px[i + 2] = Math.round(DOT[2] * alpha + GROUND[2] * (1 - alpha));
      }
    }
  }
  return px;
}

const OUTPUTS: [number, string][] = [
  [180, "../app/fp/apple-icon.png"],
  [192, "../public/path-icon-192.png"],
  [512, "../public/path-icon-512.png"],
];
for (const [size, rel] of OUTPUTS) {
  writeFileSync(resolve(__dirname, rel), encodePng(size, drawIcon(size)));
  console.log(`wrote ${rel.replace("../", "")}`);
}
