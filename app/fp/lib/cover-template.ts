/**
 * THE TEMPLATE COVER — a PURE, DETERMINISTIC, server-rendered SVG comic cover
 * personalized from what we already store about a kid (New User Flow v3, Unit 4).
 *
 * ── WHY DETERMINISTIC IS THE WHOLE DESIGN, NOT A LIMITATION ──
 * The plan's Unit 4 pairs an AI generator (gpt-image-2) with a "template
 * fallback". This unit ships the TEMPLATE PATH ONLY (owner decision: no new
 * dependencies, the AI vendor adapter is deferred), and the template is written
 * as a pure function of (first name, age, story answers) — all three of which
 * already live on `fp_onboarding_drafts` / `children`.
 *
 * ── ⚠ DETERMINISTIC IS NOT THE SAME AS RE-DERIVABLE LATER (v3 Unit 7) ──
 * Unit 4 concluded from purity that the cover needed no storage: it could be
 * re-computed from the row at any time, so only the STATUS was recorded. That
 * was wrong, and the way it was wrong is worth keeping written down.
 *
 * The picture varies on (first name, AGE, STORY ANSWERS). Only the first of
 * those survives provisioning — `kid_age` and `answers` live on
 * `fp_onboarding_drafts`, which is consumed and reaped once the child exists.
 * So anything re-rendering from the CHILD row later has the name and nothing
 * else, and produces a DIFFERENT picture: different palette (the palette hashes
 * the whole key), no age badge, generic captions instead of the kid's own
 * words. Determinism was never in doubt; the INPUTS were.
 *
 * The rule now, from the owner: THERE IS EXACTLY ONE RENDER, and it happens in
 * `POST /api/fp/cover` during parent signup. That render is persisted verbatim
 * (`fp_onboarding_drafts.cover_data_url` → `children.fp_cover_data_url`,
 * migration 20260917120000) and served verbatim to every surface forever after.
 * Both FP sign-in doors read the column; neither imports this module.
 *
 * ⚠ IF YOU ARE ABOUT TO CALL `renderTemplateCover` FROM SOMEWHERE NEW, STOP.
 * There is one call site (app/api/fp/cover/cover-core.ts, phase two) and adding
 * a second means some kid somewhere sees two different covers. Read the stored
 * artifact instead.
 *
 * The two-store consistency rules in ./cover-store-rules.ts remain vacuous on
 * this path: the artifact is a column, not an object, so there is still no
 * second store, no blob key, and nothing for an orphan sweep or an R28 blob
 * erasure to chase. See `decideCoverStatusWrite`'s `source: "derived"` arm.
 *
 * ── NO NEXT, NO SUPABASE, NO server-only ──
 * Pure by repo convention. The only Node builtin used is `Buffer`, for the data
 * URL, and that is confined to `coverTemplateDataUrl` so the SVG builder itself
 * is environment-free.
 *
 * ── EVERY INTERPOLATED VALUE IS UNTRUSTED ──
 * A kid's first name, and their free-text story answers, are parent/child input.
 * They land inside XML text nodes, so `escapeXmlText` is applied at EVERY
 * interpolation site without exception (see its doc comment for what it defends
 * against, and app/fp/lib/__tests__/cover-template.test.ts for the proofs).
 * There is no "this one is safe" case: the moment one interpolation skips the
 * escape, the whole document is attacker-shaped.
 */

/* --------------------------------------------------------------- geometry */

/** Fixed page box. A comic cover is 4:5, which is also what the client's
 *  `V3ComicCover` frame reserves, so the image never letterboxes. */
export const COVER_WIDTH = 800;
export const COVER_HEIGHT = 1000;

/* ---------------------------------------------------------------- escaping */

/**
 * XML-escape one untrusted string for an SVG TEXT NODE.
 *
 * What it defends against, in order of how badly each one ends:
 *   - `<` / `>` — the injection that matters. Unescaped, a name containing
 *     `</text><script>…` closes our element and opens the attacker's. SVG is a
 *     live document, not an image format, so this is a real XSS sink the moment
 *     the data URL is rendered in an <img> or inlined.
 *   - `&` — must be escaped FIRST (escaping it after `<` would double-escape the
 *     `&lt;` we just produced) or the document is not well-formed and the whole
 *     cover fails to render.
 *   - `"` / `'` — not strictly required in a text node, but escaped anyway so a
 *     later refactor that moves a value into an ATTRIBUTE cannot silently become
 *     an injection. Cheap insurance against the most likely future edit.
 *   - C0/C1 CONTROL CHARACTERS — illegal in XML 1.0. A single stray 0x0B in a
 *     pasted answer makes the parser reject the document, so they are dropped
 *     rather than escaped (there is no legal escape for them).
 *   - LONE SURROGATES — a half of an emoji pair, which some clipboards produce.
 *     Also illegal, also dropped; a WELL-FORMED pair is preserved untouched, so
 *     emoji in a kid's name render as emoji.
 * Newlines/tabs collapse to a single space: the SVG lays text out itself, and a
 * literal newline in a <text> node is just whitespace anyway.
 */
export function escapeXmlText(raw: string | null | undefined): string {
  const source = typeof raw === "string" ? raw : "";
  let out = "";
  for (const ch of source) {
    const code = ch.codePointAt(0) ?? 0;
    // Lone surrogate (a well-formed pair iterates as ONE code point > 0xFFFF,
    // so anything landing in the surrogate range here is unpaired).
    if (code >= 0xd800 && code <= 0xdfff) continue;
    // C0 (except the whitespace we normalize below) and C1.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      out += code === 0x09 || code === 0x0a || code === 0x0d ? " " : "";
      continue;
    }
    switch (ch) {
      case "&":
        out += "&amp;";
        break;
      case "<":
        out += "&lt;";
        break;
      case ">":
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      case "'":
        out += "&apos;";
        break;
      default:
        out += ch;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Bound a string by CODE POINTS, never by UTF-16 units.
 *
 * `String.prototype.slice` cuts inside a surrogate pair and produces a lone
 * surrogate — which `escapeXmlText` would then have to drop, silently eating the
 * last emoji. Counting code points also means a name of 200 emoji is bounded the
 * same way a name of 200 letters is, which is the point: the cover has finite
 * room and a very long name must degrade to an ellipsis, not overflow the page
 * or blow up the response.
 */
export function truncateCodePoints(raw: string, max: number): string {
  const points = Array.from(raw);
  if (points.length <= max) return raw;
  return `${points.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/* ------------------------------------------------------------ the palette */

/**
 * A stable 32-bit FNV-1a over the personalization key. Used ONLY to pick one of
 * a handful of authored palettes, so two kids' covers do not all look identical
 * while one kid's cover never changes between renders. Not a security hash and
 * never used as one.
 */
export function coverHash(key: string): number {
  let h = 0x811c9dc5;
  for (const ch of key) {
    h ^= ch.codePointAt(0)! & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Authored palettes, in the v3 paper-grain aesthetic (cream stock, ink line,
 *  one accent). Order is part of the deterministic contract — inserting in the
 *  middle would repaint every existing kid's cover. Append only. */
export const COVER_PALETTES = [
  { accent: "#2f7d5d", wash: "#e8f1ea" },
  { accent: "#b4472e", wash: "#f6e7e1" },
  { accent: "#2f5f8f", wash: "#e3ecf5" },
  { accent: "#8a5b1f", wash: "#f5ebdc" },
  { accent: "#6b3f7a", wash: "#efe6f3" },
] as const;

export type CoverPalette = (typeof COVER_PALETTES)[number];

export const pickCoverPalette = (key: string): CoverPalette =>
  COVER_PALETTES[coverHash(key) % COVER_PALETTES.length];

/* -------------------------------------------------------------- the cover */

export type CoverTemplateInput = {
  firstName: string | null | undefined;
  age: number | null | undefined;
  /** The story answers, keyed by question id. Values are free text; only their
   *  presence and content matter here, not which question they came from — the
   *  first two non-empty ones become the cover's caption lines. */
  answers?: Record<string, string> | null;
};

/** Longest name that fits the title line before it is ellipsized. */
export const COVER_NAME_MAX = 24;
/** Longest caption line. Two lines are drawn. */
export const COVER_CAPTION_MAX = 64;

/**
 * The personalization key: everything the picture varies on, in a fixed order.
 * Exported because it is the honest statement of what the cover DEPENDS ON —
 * name, age, and every answer. Two of those three do not survive provisioning,
 * which is exactly why the render is stored rather than repeated (see the
 * module header). Same key ⇒ byte-identical SVG.
 */
export function coverTemplateKey(input: CoverTemplateInput): string {
  const answers = input.answers ?? {};
  const parts = Object.keys(answers)
    .sort()
    .map((k) => `${k}=${answers[k] ?? ""}`);
  return [`n=${input.firstName ?? ""}`, `a=${input.age ?? ""}`, ...parts].join("|");
}

/**
 * Compose the cover. PURE and TOTAL: any input — empty name, null age, missing
 * answers, hostile text — produces a valid, well-formed SVG document.
 *
 * The result is always a complete standalone SVG (its own `xmlns`), because it
 * is delivered as a `data:` URL to an `<img>`, which parses it as a document in
 * a sandbox with no script execution. The escaping above is still absolute:
 * these exact bytes are stored and later handed to First Profit, which renders
 * them ONLY as an `<img src>` and never inlines them into the DOM.
 */
export function coverTemplateSvg(input: CoverTemplateInput): string {
  const rawName = (input.firstName ?? "").trim();
  // A cover with nobody on it is still a cover. "Their" reads correctly in the
  // one place the name is used as a possessive.
  const displayName = rawName.length > 0 ? truncateCodePoints(rawName, COVER_NAME_MAX) : "Their";
  const name = escapeXmlText(displayName);
  const possessive = rawName.length > 0 ? `${name}&apos;s` : name;

  const age =
    typeof input.age === "number" && Number.isInteger(input.age) && input.age > 0 && input.age < 130
      ? String(input.age)
      : null;

  const answers = input.answers ?? {};
  const captionSource = Object.keys(answers)
    .sort()
    .map((k) => (answers[k] ?? "").trim())
    .filter((v) => v.length > 0)
    .slice(0, 2)
    .map((v) => escapeXmlText(truncateCodePoints(v, COVER_CAPTION_MAX)));
  const captions =
    captionSource.length > 0
      ? captionSource
      : ["version 1 of the idea.", "it was a big piece of paper."];

  const palette = pickCoverPalette(coverTemplateKey(input));

  // Initial for the character medallion: the first LETTER-ish code point of the
  // name, escaped like everything else. Falls back to a dot rather than an empty
  // <text>, which some renderers lay out as a stray baseline.
  const initial = escapeXmlText(Array.from(displayName)[0] ?? "·");

  const captionLines = captions
    .map(
      (line, i) =>
        `<text x="400" y="${842 + i * 40}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="26" fill="#3b3a36">${line}</text>`
    )
    .join("");

  const ageBadge = age
    ? `<g><circle cx="700" cy="120" r="56" fill="${palette.accent}"/><text x="700" y="112" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="40" font-weight="bold" fill="#fdfaf3">${escapeXmlText(age)}</text><text x="700" y="142" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="18" fill="#fdfaf3">years old</text></g>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}" role="img" aria-label="First Profit comic cover">` +
    `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="#fdfaf3"/>` +
    `<rect x="24" y="24" width="${COVER_WIDTH - 48}" height="${COVER_HEIGHT - 48}" fill="none" stroke="#26241f" stroke-width="6"/>` +
    `<rect x="52" y="52" width="${COVER_WIDTH - 104}" height="150" fill="${palette.wash}" stroke="#26241f" stroke-width="4"/>` +
    `<text x="88" y="118" font-family="Georgia, 'Times New Roman', serif" font-size="26" letter-spacing="6" fill="${palette.accent}">FIRST PROFIT</text>` +
    `<text x="88" y="168" font-family="Georgia, 'Times New Roman', serif" font-size="44" font-weight="bold" fill="#26241f">${possessive} Journey</text>` +
    ageBadge +
    `<rect x="52" y="232" width="${COVER_WIDTH - 104}" height="560" fill="${palette.wash}" stroke="#26241f" stroke-width="4"/>` +
    `<circle cx="400" cy="470" r="150" fill="#fdfaf3" stroke="${palette.accent}" stroke-width="10"/>` +
    `<text x="400" y="530" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="170" font-weight="bold" fill="${palette.accent}">${initial}</text>` +
    `<rect x="180" y="650" width="440" height="90" fill="#fdfaf3" stroke="#26241f" stroke-width="4"/>` +
    `<text x="400" y="708" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="38" font-weight="bold" fill="#26241f">Meet ${name}</text>` +
    captionLines +
    `<text x="400" y="944" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="20" letter-spacing="4" fill="#8a867c">ISSUE No. 1</text>` +
    `</svg>`
  );
}

/**
 * The delivery form: a base64 `data:` URL an `<img src>` can take directly.
 *
 * BASE64, NOT `encodeURIComponent`. A percent-encoded SVG data URL is smaller,
 * but it puts raw `#` / `&` / quote handling on the URL parser as well as the
 * XML parser, and two parsers over untrusted text is one more than necessary.
 * Base64 has exactly one interpretation.
 */
export function coverTemplateDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** The one call the cover core makes. */
export const renderTemplateCover = (input: CoverTemplateInput): string =>
  coverTemplateDataUrl(coverTemplateSvg(input));
