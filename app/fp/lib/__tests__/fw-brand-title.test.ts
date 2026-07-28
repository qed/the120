import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { glob } from "tinyglobby";

import { FW_BRAND_SUFFIX } from "../fw-nav-rules";
import { buildFwGuideInviteEmail } from "../fw-guide-invite-email";

/**
 * D1 Option A drift guard (checks 1.1.4 / 3.1.6): every guide-facing `/fp/fw`
 * page title carries the First Profit brand, and keeps carrying it as pages are
 * added.
 *
 * A SOURCE SCAN in the `bar-wiring.test.ts` style, because the property lives in
 * `metadata` exports no behavioural test can render (no jsdom): each page must
 * declare exactly one recognised title construct — a static `metadata` export or
 * a `generateMetadata` — and its title must end on `FW_BRAND_SUFFIX`. A page
 * with NEITHER construct fails, so a new `/fp/fw` page cannot ship titled
 * "localhost:3000" and pass vacuously.
 *
 * Per the 2026-07-27 scan lesson: paths resolve from `import.meta.url` (never
 * cwd), comments are stripped before matching (several of these pages discuss
 * branding in their doc blocks), the glob is asserted non-empty, and the
 * anchors are structural — nothing here pins a page's own separator or word
 * order beyond the suffix constant itself (the 2026-07-14 em-dash lesson).
 *
 * Deliberately OUT of scope: the on-screen `FwBoard.tsx` header stays
 * "Founders Weekend" unsuffixed (Peter, 2026-07-28) — the brand lives in the
 * tab title via `board/[token]/page.tsx` metadata; projector hierarchy stays
 * clean. This scan reads `page.tsx` files only, and must never grow to cover
 * component headers.
 */

const dir = fileURLToPath(new URL(".", import.meta.url));
/** `app/fp/lib/__tests__/` → the repo root. Four levels, from THIS file. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", `file://${dir}`));

/** Same shape as bar-wiring's: any scan over raw source cannot tell a comment
 *  from a construct, and these files' comments name the very thing scanned for. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const STATIC_METADATA = /export\s+const\s+metadata\b/g;
const GENERATE_METADATA =
  /export\s+(?:async\s+)?function\s+generateMetadata\b|export\s+const\s+generateMetadata\b/g;

/** The raw contents of a `title:` string in source, whatever quote carried it. */
const TITLE_VALUE = /title:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/;

/**
 * Does a title's SOURCE text end on the brand? Two spellings are recognised —
 * the interpolated constant (the intended shape) and the literal it resolves to
 * (so a page that inlines the string is drifting in style, not in brand). No
 * other punctuation is pinned.
 */
const carriesBrand = (rawTitle: string) =>
  rawTitle.endsWith("${FW_BRAND_SUFFIX}") || rawTitle.endsWith(FW_BRAND_SUFFIX);

const fwPages = async (): Promise<Map<string, string>> => {
  const files = await glob(["app/fp/fw/**/page.tsx"], {
    cwd: REPO_ROOT,
    absolute: false,
    dot: false,
  });
  // An empty expansion would make every per-page assertion below pass
  // vacuously — the one failure mode a scan like this must not have.
  expect(files.length).toBeGreaterThan(0);
  return new Map(
    files.map((f) => [
      f.replace(/\\/g, "/"),
      stripComments(readFileSync(`${REPO_ROOT}${f}`, "utf8")),
    ])
  );
};

describe("every /fp/fw page title carries the First Profit brand (D1 Option A)", () => {
  it("the glob still reaches the subtree it guards", async () => {
    const pages = await fwPages();
    // One stable representative, so a glob that silently starts expanding
    // against the wrong root reddens rather than scanning zero-or-other files.
    expect([...pages.keys()]).toContain("app/fp/fw/board/[token]/page.tsx");
  });

  it("each page declares exactly one recognised title construct, suffixed", async () => {
    for (const [path, code] of await fwPages()) {
      const constructs =
        (code.match(STATIC_METADATA)?.length ?? 0) +
        (code.match(GENERATE_METADATA)?.length ?? 0);
      // Zero constructs is a FAILURE, not an exemption: a titleless page ships
      // the framework default and the brand silently disappears from the tab.
      expect(constructs, `${path}: expected exactly one title construct`).toBe(1);

      if (GENERATE_METADATA.test(code)) {
        GENERATE_METADATA.lastIndex = 0;
        // A dynamic title cannot be read statically; what CAN be pinned is that
        // the builder reaches for the constant at all.
        expect(code, `${path}: generateMetadata must use FW_BRAND_SUFFIX`).toMatch(
          /\bFW_BRAND_SUFFIX\b/
        );
        continue;
      }

      const title = code.match(TITLE_VALUE);
      expect(title, `${path}: metadata must declare a string title`).not.toBeNull();
      expect(
        carriesBrand(title![2]),
        `${path}: title ${JSON.stringify(title![2])} must end on FW_BRAND_SUFFIX`
      ).toBe(true);
    }
  });
});

describe("the guide invite email carries the brand (D1 Option A)", () => {
  const mail = buildFwGuideInviteEmail({ token: "tok-123" });

  it("subject names both Founders Weekend and First Profit", () => {
    expect(mail.subject).toContain("Founders Weekend");
    expect(mail.subject.endsWith(FW_BRAND_SUFFIX)).toBe(true);
  });

  it("both bodies link the weekend to the First Profit brand", () => {
    expect(mail.text).toContain("First Profit");
    expect(mail.html).toContain("First Profit");
  });

  it("…while the setup URL stays the untouched /fp/fw/invite path", () => {
    // The brand sweep must not touch route identifiers (the path-*/fp rename
    // boundary rule): the token link is load-bearing, not copy.
    expect(mail.text).toContain("/fp/fw/invite/tok-123");
    expect(mail.html).toContain("/fp/fw/invite/tok-123");
  });
});
