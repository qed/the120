/**
 * MathRaiders sprite generation via Nano Banana Pro (gemini-3-pro-image).
 * Usage: node scripts/gen-sprites.mjs [only-id ...]
 * Reads GEMINI_API_KEY from .env.local. Writes public/raiders/.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env.local"), "utf8");
const KEY = env.match(/GEMINI_API_KEY=(.+)/)?.[1]?.trim();
if (!KEY) throw new Error("GEMINI_API_KEY missing from .env.local");

const OUT = join(root, "public", "raiders");
mkdirSync(OUT, { recursive: true });

const STYLE_SPRITE =
  "Cute flat vector game sprite, bold clean shapes, soft shading, thick silhouette, " +
  "kid-friendly, vibrant against dark backgrounds, centered, full body visible with margin, " +
  "no text, no watermark, standing on a plain solid pure white background — flat #FFFFFF, absolutely no checkerboard pattern, no shadows on the ground.";

const STYLE_SCENE =
  "Stylized painterly game background art, dark and atmospheric but kid-friendly, " +
  "rich color, soft depth of field, no characters in frame, no text, no watermark.";

const SPRITES = [
  {
    id: "boss-clank",
    aspect: "1:1",
    prompt:
      `${STYLE_SPRITE} A cute round-headed grey robot boss called Clank: dome head with a thin antenna, ` +
      `dark visor with two glowing rectangular green eyes, boxy grey torso with a glowing cyan core circle, ` +
      `stubby cylindrical arms. Friendly-menacing lab sentinel.`,
  },
  {
    id: "boss-gloop",
    aspect: "1:1",
    prompt:
      `${STYLE_SPRITE} A goofy bright-green slime blob monster boss called Gloop: wobbly gelatinous body, ` +
      `two huge round white eyes with black pupils, wide open dark red mouth with a single white buck tooth, ` +
      `glossy highlights.`,
  },
  {
    id: "boss-magmar",
    aspect: "1:1",
    prompt:
      `${STYLE_SPRITE} A hulking molten rock golem boss called Magmar: jagged black volcanic stone body, ` +
      `glowing orange and red magma cracks between plates, small fierce amber eyes, massive stone fists, ` +
      `ember particles.`,
  },
  {
    id: "boss-vex",
    aspect: "1:1",
    prompt:
      `${STYLE_SPRITE} A gunmetal battle robot boss called Vex: angular head with two glowing red eyes, ` +
      `armored torso with a glowing blue orb core, one arm is a large cannon with a glowing blue muzzle, ` +
      `heavy sci-fi plating.`,
  },
  {
    id: "arena-clank",
    aspect: "16:9",
    prompt:
      `${STYLE_SCENE} Dark teal sci-fi laboratory arena: circular raised metal platform in the center ` +
      `(empty, for a boss), banks of consoles with glowing green screens, cables on the floor, ` +
      `robotic arms hanging from the ceiling, cool cyan rim lighting. Center platform area kept clear.`,
  },
  {
    id: "arena-gloop",
    aspect: "16:9",
    prompt:
      `${STYLE_SCENE} Murky swamp cavern arena: shallow green water, mossy stones forming a clear central ` +
      `mound (empty, for a boss), giant glowing mushrooms, hanging vines, fireflies, green misty light.`,
  },
  {
    id: "arena-magmar",
    aspect: "16:9",
    prompt:
      `${STYLE_SCENE} Volcanic lava cavern arena: black basalt central platform (empty, for a boss) surrounded ` +
      `by glowing lava rivers, floating embers, orange rim light on dark rocks, heat haze.`,
  },
  {
    id: "arena-vex",
    aspect: "16:9",
    prompt:
      `${STYLE_SCENE} Dark military robot hangar arena: central launch platform (empty, for a boss), ` +
      `blue holographic targeting rings, armored walls, warning stripes, cool blue and indigo lighting.`,
  },
  {
    id: "keyart",
    aspect: "16:9",
    prompt:
      `Stylized painterly key art for a kids math battle game, landscape: a small party of cute blocky ` +
      `voxel-style heroes (a blonde kid with a sword, a blue-hatted wizard casting a glowing spell, a gold ` +
      `knight with a shield) on the left facing off against a huge molten rock golem, a gunmetal robot with ` +
      `a glowing cannon and a goofy green slime on the right, on a dark ember-lit rocky battlefield at dusk. ` +
      `Leave the top-center area calmer and darker for a logo. Warm dramatic lighting, kid-friendly, ` +
      `no text, no watermark.`,
  },
];

async function generate(s, attempt = 1) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent",
    {
      method: "POST",
      headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: s.prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: s.aspect, imageSize: s.aspect === "16:9" ? "2K" : "1K" },
        },
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${s.id}: HTTP ${res.status} ${t.slice(0, 160)}`);
  }
  const j = await res.json();
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) {
    if (attempt < 3) return generate(s, attempt + 1);
    throw new Error(`${s.id}: no image in response`);
  }
  const buf = Buffer.from(part.inlineData.data, "base64");
  const mime = part.inlineData.mimeType;
  // PNG color type 6/4 = has alpha channel
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const colorType = isPng ? buf[25] : -1;
  const hasAlpha = colorType === 6 || colorType === 4;
  const ext = isPng ? "png" : "jpg";
  const file = join(OUT, `${s.id}.${ext}`);
  writeFileSync(file, buf);
  console.log(
    `${s.id}: ${mime} ${(buf.length / 1024).toFixed(0)}KB colorType=${colorType} alpha=${hasAlpha} -> ${file}`
  );
  return { id: s.id, hasAlpha, ext };
}

const only = process.argv.slice(2);
const targets = only.length ? SPRITES.filter((s) => only.includes(s.id)) : SPRITES;
for (const s of targets) {
  try {
    await generate(s);
  } catch (e) {
    console.error("FAIL", e.message);
  }
}
