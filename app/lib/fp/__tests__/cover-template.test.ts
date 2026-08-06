import { describe, expect, it } from "vitest";
import {
  COVER_HEIGHT,
  COVER_NAME_MAX,
  COVER_PALETTES,
  COVER_WIDTH,
  coverTemplateDataUrl,
  coverTemplateKey,
  coverTemplateSvg,
  escapeXmlText,
  pickCoverPalette,
  renderTemplateCover,
  truncateCodePoints,
  type CoverTemplateInput,
} from "../cover-template";

/**
 * The template compositor (plan Unit 4). Two properties carry the whole module:
 * it is DETERMINISTIC (which is what lets Unit 4 write no blobs at all) and it
 * SAFELY ESCAPES untrusted text (a kid's name and their free-text answers are
 * parent/child input landing in a live XML document).
 */

const decode = (dataUrl: string): string =>
  Buffer.from(dataUrl.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");

/* --------------------------------------------------------------- determinism */

describe("determinism — the reason nothing needs storing", () => {
  it("produces byte-identical SVG for identical inputs", () => {
    const input = { firstName: "Remi", age: 11, answers: { q1: "lemonade", q2: "my street" } };
    expect(coverTemplateSvg(input)).toBe(coverTemplateSvg({ ...input }));
    expect(renderTemplateCover(input)).toBe(renderTemplateCover({ ...input }));
  });

  it("does not depend on answer key ORDER (jsonb round-trips reorder keys)", () => {
    const a = coverTemplateSvg({ firstName: "Remi", age: 11, answers: { q1: "one", q2: "two" } });
    const b = coverTemplateSvg({ firstName: "Remi", age: 11, answers: { q2: "two", q1: "one" } });
    expect(a).toBe(b);
  });

  it("changes when the personalization changes, and only then", () => {
    const base = { firstName: "Remi", age: 11, answers: {} };
    expect(coverTemplateSvg({ ...base, firstName: "Ada" })).not.toBe(coverTemplateSvg(base));
    expect(coverTemplateSvg({ ...base, age: 12 })).not.toBe(coverTemplateSvg(base));
    expect(coverTemplateSvg({ ...base, answers: { q1: "hi" } })).not.toBe(coverTemplateSvg(base));
  });

  it("picks a stable palette per kid from the authored list", () => {
    const key = coverTemplateKey({ firstName: "Remi", age: 11, answers: {} });
    expect(pickCoverPalette(key)).toBe(pickCoverPalette(key));
    expect(COVER_PALETTES).toContain(pickCoverPalette(key));
  });

  it("is TOTAL — every degenerate input still yields a well-formed document", () => {
    const degenerate: CoverTemplateInput[] = [
      { firstName: null, age: null },
      { firstName: "", age: 0, answers: {} },
      { firstName: "   ", age: -3, answers: null },
      { firstName: "Remi", age: 9999, answers: { q1: "   " } },
    ];
    for (const input of degenerate) {
      const svg = coverTemplateSvg(input);
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain(`width="${COVER_WIDTH}"`);
      expect(svg).toContain(`height="${COVER_HEIGHT}"`);
    }
  });
});

/* ------------------------------------------------------------------ escaping */

describe("escaping untrusted text into the SVG", () => {
  it("escapes the five XML-significant characters", () => {
    expect(escapeXmlText(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });

  it("escapes & FIRST so nothing is double-escaped", () => {
    // A naive implementation that escapes `<` before `&` yields `&amp;lt;`.
    expect(escapeXmlText("<")).toBe("&lt;");
    expect(escapeXmlText("&lt;")).toBe("&amp;lt;");
  });

  it("cannot be used to close our element and open another", () => {
    const hostile = `</text><script>alert(1)</script><text>`;
    const svg = coverTemplateSvg({ firstName: hostile, age: 10, answers: {} });
    // The payload survives only as INERT TEXT: every angle bracket it brought
    // is an entity, so it opens no element of its own.
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;/text&gt;&lt;script&gt;");
    // The document is still exactly one <svg> element with a matched close, and
    // the <text> elements are exactly the ones this module opened.
    expect(svg.split("<svg ").length - 1).toBe(1);
    expect(svg.split("</svg>").length - 1).toBe(1);
    expect(svg.split("<text ").length).toBe(svg.split("</text>").length);
  });

  it("survives an apostrophe in a name without breaking the possessive title", () => {
    const svg = coverTemplateSvg({ firstName: "O'Neil", age: 8, answers: {} });
    expect(svg).toContain("O&apos;Neil");
    expect(svg).not.toMatch(/O'Neil/);
    expect(svg).toContain("&apos;s Journey");
  });

  it("keeps emoji intact and never emits a lone surrogate", () => {
    const svg = coverTemplateSvg({ firstName: "Remi 🎉", age: 9, answers: {} });
    expect(svg).toContain("🎉");
    for (const ch of svg) {
      const code = ch.codePointAt(0)!;
      expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
    }
  });

  it("truncates a very long name by CODE POINTS, not UTF-16 units", () => {
    const long = "Bartholomew".repeat(20);
    const svg = coverTemplateSvg({ firstName: long, age: 10, answers: {} });
    expect(svg.length).toBeLessThan(6000);
    expect(svg).toContain("…");
    // An all-emoji name of the same length is bounded the same way, and the
    // cut never lands inside a pair.
    const emojiName = "🎉".repeat(200);
    const emojiSvg = coverTemplateSvg({ firstName: emojiName, age: 10, answers: {} });
    expect(Array.from(truncateCodePoints(emojiName, COVER_NAME_MAX)).length).toBe(COVER_NAME_MAX);
    for (const ch of emojiSvg) {
      const code = ch.codePointAt(0)!;
      expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
    }
  });

  it("drops control characters, which are illegal in XML and unescapable", () => {
    const vtab = String.fromCharCode(11);
    const nul = String.fromCharCode(0);
    expect(escapeXmlText(`a${vtab}b${nul}c`)).toBe("abc");
    // Real whitespace collapses to a single space rather than vanishing.
    expect(escapeXmlText(["a", "b"].join("\n\t"))).toBe("a b");
  });

  it("escapes hostile ANSWER text the same way it escapes a name", () => {
    const svg = coverTemplateSvg({
      firstName: "Remi",
      age: 11,
      answers: { q1: `<img src=x onerror="alert(1)">`, q2: "tom & jerry" },
    });
    expect(svg).not.toContain("<img");
    // `onerror` survives only as text inside an escaped, inert pseudo-tag —
    // never as an attribute of a real element.
    expect(svg).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(svg).not.toMatch(/<[a-z]+[^>]*\sonerror=/i);
    expect(svg).toContain("tom &amp; jerry");
  });
});

/* -------------------------------------------------------------- the data url */

describe("delivery", () => {
  it("round-trips through the base64 data url", () => {
    const svg = coverTemplateSvg({ firstName: "Remi 🎉 & co", age: 11, answers: {} });
    const url = coverTemplateDataUrl(svg);
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(decode(url)).toBe(svg);
  });
});
