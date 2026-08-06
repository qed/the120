import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SITE_DOC_VERSION_GATE,
  SITE_HEADLINE_MAX_CHARS,
  SITE_MAX_PRODUCTS,
  SITE_ONE_LINER_MAX_CHARS,
  SITE_PRODUCT_NAME_MAX_CHARS,
  extractSiteContent,
} from "../fp-public-site-rules";

// ── Migration ↔ TS parity for 20260909120000_fp_site_products.sql ──
// Same discipline as fp-public-sites-migration-parity.test.ts (the
// security-definer-sql third-untested-copy learning: no test DB here, so the
// SQL is parsed as text). This migration REDEFINES fp_public_site_content,
// the projection trigger, and fp_public_site — the definitions in this file
// are the LIVE ones after apply, so the parity assertions that matter for the
// new behavior are pinned against THIS file; the 20260907 suite keeps pinning
// the (unchanged, applied) originals.
describe("migration parity: fp_site_products.sql", () => {
  const raw = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260909120000_fp_site_products.sql"),
    "utf8"
  );
  const sql = raw.replace(/--[^\n]*/g, "");

  function fnBody(name: string): string {
    const start = sql.search(
      new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "i")
    );
    expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
    const end = sql.indexOf("$$;", start);
    expect(end, `${name} closes with $$;`).toBeGreaterThan(start);
    return sql.slice(start, end);
  }

  const extractBody = fnBody("fp_public_site_content");
  const triggerBody = fnBody("fp_public_sites_project_save");
  const readBody = fnBody("fp_public_site");

  // ------------------------------------------------------ column + backstop
  it("adds products jsonb NOT NULL DEFAULT '[]' additively (if not exists)", () => {
    expect(
      /add\s+column\s+if\s+not\s+exists\s+products\s+jsonb\s+not\s+null\s+default\s+'\[\]'::jsonb/i.test(
        sql
      )
    ).toBe(true);
  });

  it("the bounded CHECK is CASE-guarded (typeof gate ORDERED before jsonb_array_length — bare AND has no evaluation-order guarantee) and caps at SITE_MAX_PRODUCTS", () => {
    const m = sql.match(
      /add\s+constraint\s+fp_public_sites_products_bounded\s+check\s*\(\s*case\s+when\s+jsonb_typeof\s*\(\s*products\s*\)\s*=\s*'array'\s+then\s+jsonb_array_length\s*\(\s*products\s*\)\s*<=\s*(\d+)\s+else\s+false\s+end\s*\)/i
    );
    expect(m, "CASE-shaped bounded CHECK").not.toBeNull();
    expect(Number(m![1])).toBe(SITE_MAX_PRODUCTS);
    // Idempotent: drop-if-exists precedes the add.
    expect(/drop\s+constraint\s+if\s+exists\s+fp_public_sites_products_bounded/i.test(sql)).toBe(true);
  });

  // ------------------------------------------------- extraction v2 structure
  it("the extraction is DROPped and recreated (return-type change) with the products column, and the single-value columns keep their exact clamps and acceptor", () => {
    expect(/drop\s+function\s+if\s+exists\s+public\.fp_public_site_content\s*\(\s*jsonb\s*\)/i.test(sql)).toBe(true);
    expect(/returns\s+table\s*\(\s*headline\s+text\s*,\s*one_liner\s+text\s*,\s*products\s+jsonb\s*\)/i.test(extractBody)).toBe(true);
    // Single-value logic byte-parity with 20260907 (the room/self-read
    // contract): same clamps, same activeIdea acceptor, same bounds check.
    const m1 = extractBody.match(/fp_clamp_public_text\s*\(\s*p_doc\s*->>\s*'siteHeadline'\s*,\s*(\d+)\s*\)/i);
    expect(Number(m1?.[1])).toBe(SITE_HEADLINE_MAX_CHARS);
    const m2 = extractBody.match(/fp_clamp_public_text\s*\(\s*v_idea\s*->\s*'fields'\s*->>\s*'oneLiner'\s*,\s*(\d+)\s*\)/i);
    expect(Number(m2?.[1])).toBe(SITE_ONE_LINER_MAX_CHARS);
    expect(/\(\s*p_doc\s*->>\s*'activeIdea'\s*\)\s+~\s+'\^\[0-9\]\{1,9\}\$'/i.test(extractBody)).toBe(true);
    expect(/v_active\s*<\s*jsonb_array_length\s*\(\s*v_ideas\s*\)/i.test(extractBody)).toBe(true);
  });

  it("the products loop iterates the FIRST least(len, SITE_MAX_PRODUCTS) ideas only", () => {
    const m = extractBody.match(/least\s*\(\s*jsonb_array_length\s*\(\s*v_ideas\s*\)\s*,\s*(\d+)\s*\)/i);
    expect(m, "least(jsonb_array_length(v_ideas), N)").not.toBeNull();
    expect(Number(m![1])).toBe(SITE_MAX_PRODUCTS);
  });

  it("each product's name/oneLiner ride the SHARED fp_clamp_public_text (blocklist on RAW value, then truncate) at 60/140", () => {
    const mn = extractBody.match(
      /fp_clamp_public_text\s*\(\s*v_idea\s*->\s*'fields'\s*->>\s*'productName'\s*,\s*(\d+)\s*\)/i
    );
    expect(mn, "fp_clamp_public_text(...->>'productName', N)").not.toBeNull();
    expect(Number(mn![1])).toBe(SITE_PRODUCT_NAME_MAX_CHARS);
    // The per-product one-liner clamp appears with the SAME cap as the single
    // value's (two mentions of the 140 clamp in the body: active-idea + loop).
    const liners = [
      ...extractBody.matchAll(/fp_clamp_public_text\s*\(\s*v_idea\s*->\s*'fields'\s*->>\s*'oneLiner'\s*,\s*(\d+)\s*\)/gi),
    ];
    expect(liners.length).toBe(2);
    for (const l of liners) expect(Number(l[1])).toBe(SITE_ONE_LINER_MAX_CHARS);
  });

  it("the element shape is jsonb_build_object('n', i + 1, 'name', ..., 'oneLiner', ...) — the renderer contract, n 1-based", () => {
    expect(
      /jsonb_build_object\s*\(\s*'n'\s*,\s*i\s*\+\s*1\s*,\s*'name'\s*,\s*v_name\s*,\s*'oneLiner'\s*,\s*v_pliner\s*\)/i.test(
        extractBody
      )
    ).toBe(true);
  });

  it("fully-empty ideas are EXCLUDED (the both-'' guard) and every per-idea step is jsonb_typeof-guarded", () => {
    expect(/if\s+v_name\s*<>\s*''\s+or\s+v_pliner\s*<>\s*''\s+then/i.test(extractBody)).toBe(true);
    for (const g of [
      /jsonb_typeof\s*\(\s*v_ideas\s*\)\s*=\s*'array'/i,
      /jsonb_typeof\s*\(\s*v_idea\s*\)\s*=\s*'object'/i,
      /jsonb_typeof\s*\(\s*v_idea\s*->\s*'fields'\s*\)\s*=\s*'object'/i,
      /jsonb_typeof\s*\(\s*v_idea\s*->\s*'fields'\s*->\s*'productName'\s*\)\s*=\s*'string'/i,
      /jsonb_typeof\s*\(\s*v_idea\s*->\s*'fields'\s*->\s*'oneLiner'\s*\)\s*=\s*'string'/i,
    ]) {
      expect(g.test(extractBody), String(g)).toBe(true);
    }
  });

  it("the NULL-sentinel/overwrite discipline holds for products: initialized null, set to '[]' only once ideas proves an array; no nullif laundering", () => {
    expect(/v_products\s+jsonb\s*:=\s*null/i.test(extractBody)).toBe(true);
    expect(/v_products\s*:=\s*'\[\]'::jsonb/i.test(extractBody)).toBe(true);
    expect(/nullif/i.test(extractBody)).toBe(false);
  });

  it("the DROP re-applies every grant the applied migrations gave the extraction (revoke public/anon/authenticated, grant service_role)", () => {
    expect(
      /revoke\s+execute\s+on\s+function\s+public\.fp_public_site_content\s*\(\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i.test(sql)
    ).toBe(true);
    expect(
      /grant\s+execute\s+on\s+function\s+public\.fp_public_site_content\s*\(\s*jsonb\s*\)\s+to\s+service_role\s*;/i.test(sql)
    ).toBe(true);
  });

  // --------------------------------------------------------- trigger v2
  it("the trigger keeps the docVersion-1 gate and gains products in BOTH the coalesce SET and the IS DISTINCT FROM write-churn guard", () => {
    const m = triggerBody.match(/\(\s*NEW\.doc\s*->>\s*'docVersion'\s*\)\s+is\s+distinct\s+from\s+'(\d+)'/i);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(SITE_DOC_VERSION_GATE);
    expect(/products\s*=\s*coalesce\s*\(\s*v_products\s*,\s*s\.products\s*\)/i.test(triggerBody)).toBe(true);
    expect(
      /s\.products\s+is\s+distinct\s+from\s+coalesce\s*\(\s*v_products\s*,\s*s\.products\s*\)/i.test(triggerBody)
    ).toBe(true);
    // The all-null early exit now spans all THREE sentinels.
    expect(
      /if\s+v_headline\s+is\s+null\s+and\s+v_one_liner\s+is\s+null\s+and\s+v_products\s+is\s+null\s+then\s+return\s+NEW/i.test(
        triggerBody
      )
    ).toBe(true);
  });

  it("the never-fail law is preserved: catch-all WARNS then returns NEW; the only raise in trigger+extraction is that warning", () => {
    expect(
      /exception\s+when\s+others\s+then\s+raise\s+warning\s+'fp_public_sites_project_save failed: % %'\s*,\s*SQLSTATE\s*,\s*SQLERRM\s*;\s*return\s+NEW\s*;/i.test(
        triggerBody
      )
    ).toBe(true);
    const raises = [...triggerBody.matchAll(/\braise\b\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(raises).toEqual(["warning"]);
    expect(/\braise\b/i.test(extractBody)).toBe(false);
    // Early exit before extraction is retained (the every-~3s-save cost rule).
    const exitAt = triggerBody.search(/if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+public\.fp_public_sites/i);
    const extractAt = triggerBody.search(/from\s+public\.fp_public_site_content/i);
    expect(exitAt).toBeGreaterThanOrEqual(0);
    expect(exitAt).toBeLessThan(extractAt);
  });

  // ----------------------------------------------------- read function v2
  it("fp_public_site is DROPped and recreated with products, published-state-guarded like every other content column", () => {
    expect(/drop\s+function\s+if\s+exists\s+public\.fp_public_site\s*\(\s*text\s*\)/i.test(sql)).toBe(true);
    expect(
      /returns\s+table\s*\(\s*state\s+text\s*,\s*first_name\s+text\s*,\s*headline\s+text\s*,\s*one_liner\s+text\s*,\s*products\s+jsonb\s*\)/i.test(
        readBody
      )
    ).toBe(true);
    const cases = [
      ...readBody.matchAll(/case\s+when\s+s\.published\s+and\s+not\s+s\.operator_locked\s+then\s+([^\s]+)/gi),
    ].map((m) => m[1]!.toLowerCase().replace(/,$/, ""));
    expect(cases).toEqual(["'published'", "s.first_name", "s.headline", "s.one_liner", "s.products"]);
  });

  it("enumeration resistance and security posture unchanged: same WHERE discriminator, SECURITY DEFINER + STABLE + pinned search_path, revoke public + grant anon/authenticated", () => {
    expect(
      /\(\s*\(\s*s\.published\s+and\s+not\s+s\.operator_locked\s*\)\s+or\s+s\.first_published_at\s+is\s+not\s+null\s*\)/i.test(readBody)
    ).toBe(true);
    expect(/lower\s*\(\s*btrim\s*\(\s*coalesce\s*\(\s*p_handle\s*,\s*''\s*\)\s*\)\s*\)\s+~\s+'\^\[a-z0-9-\]\{3,20\}\$'/i.test(readBody)).toBe(true);
    expect(/security\s+definer/i.test(readBody)).toBe(true);
    expect(/\bstable\b/i.test(readBody)).toBe(true);
    expect(/set\s+search_path\s*=\s*public/i.test(readBody)).toBe(true);
    expect(/revoke\s+execute\s+on\s+function\s+public\.fp_public_site\s*\(\s*text\s*\)\s+from\s+public\s*;/i.test(sql)).toBe(true);
    expect(
      /grant\s+execute\s+on\s+function\s+public\.fp_public_site\s*\(\s*text\s*\)\s+to\s+anon\s*,\s*authenticated\s*;/i.test(sql)
    ).toBe(true);
  });

  // ------------------------------------------------------------- backfill
  it("the backfill joins fp_player_saves through the NEW extraction with the trigger's docVersion gate, NULL-sentinel respect, and a change guard", () => {
    const backfill = sql.slice(sql.search(/update\s+public\.fp_public_sites\s+s\s+set\s+products/i));
    expect(backfill.length).toBeGreaterThan(0);
    expect(/from\s+public\.fp_player_saves\s+ps/i.test(backfill)).toBe(true);
    expect(/lateral\s+public\.fp_public_site_content\s*\(\s*ps\.doc\s*\)/i.test(backfill)).toBe(true);
    expect(/jsonb_typeof\s*\(\s*ps\.doc\s*->\s*'docVersion'\s*\)\s*=\s*'number'/i.test(backfill)).toBe(true);
    const gate = backfill.match(/ps\.doc\s*->>\s*'docVersion'\s*=\s*'(\d+)'/i);
    expect(gate).not.toBeNull();
    expect(gate![1]).toBe(SITE_DOC_VERSION_GATE);
    expect(/c\.products\s+is\s+not\s+null/i.test(backfill)).toBe(true);
    expect(/s\.products\s+is\s+distinct\s+from\s+c\.products/i.test(backfill)).toBe(true);
  });

  // ------------------------------------------------------------ header ritual
  it("the header carries the version ritual with the APPLIED-ledger confirmation (both prior fp_public_sites migrations are applied → additive-only)", () => {
    expect(raw).toMatch(/schema_migrations/);
    expect(raw).toMatch(/RENAME this file/i);
    expect(raw).toMatch(/ARE APPLIED TO PRODUCTION/);
    expect(raw).toMatch(/20260908120000/);
    expect(raw).toMatch(/AMENDMENT LOG/);
  });

  it("the header documents the renderer element shape, the MAX_IDEAS cross-repo bound, and a POST-APPLY VERIFICATION products probe", () => {
    expect(raw).toMatch(/PRODUCTS ELEMENT SHAPE/);
    expect(raw).toMatch(/MAX_IDEAS/);
    expect(raw).toMatch(/gameCore\.ts/);
    expect(raw).toMatch(/POST-APPLY VERIFICATION/);
    expect(raw).toMatch(/PRODUCTS PROBE/);
    expect(raw).toMatch(/NEVER-FAIL LAW/);
  });
});

// ── Executable spec, products v2 (THE SPEC LIVES HERE — same contract as the
// SQL loop; the parity suite above pins that the plpgsql implements the same
// structure). Contract recap: products = null when doc.ideas is absent/not an
// array (skip sentinel); [] is a legitimate overwrite; elements are
// {n, name, oneLiner} with n = ORIGINAL 1-based idea position; fully-empty
// ideas are excluded; only the first SITE_MAX_PRODUCTS ideas are read.
describe("extractSiteContent — products (executable spec)", () => {
  const idea = (fields: Record<string, unknown>) => ({ fields, done: {} });
  const doc = (over: Record<string, unknown> = {}) => ({
    docVersion: 1,
    siteHeadline: "Headline",
    ideas: [
      idea({ productName: "Dog Walking", oneLiner: "I walk dogs after school" }),
      idea({ productName: "Lemonade Stand", oneLiner: "Fresh lemonade on Saturdays" }),
    ],
    activeIdea: 0,
    ...over,
  });

  it("happy path: EVERY idea becomes a card {n, name, oneLiner}, n 1-based", () => {
    expect(extractSiteContent(doc()).products).toEqual([
      { n: 1, name: "Dog Walking", oneLiner: "I walk dogs after school" },
      { n: 2, name: "Lemonade Stand", oneLiner: "Fresh lemonade on Saturdays" },
    ]);
  });

  it("fully-empty ideas are EXCLUDED but n preserves the original numbering (Product #N never shifts)", () => {
    const r = extractSiteContent(
      doc({
        ideas: [
          idea({}), // no fields set → excluded
          idea({ productName: "Bracelets", oneLiner: "" }),
          idea({ productName: "", oneLiner: "" }), // both empty → excluded
          idea({ oneLiner: "Watering plants for neighbors" }),
        ],
      })
    );
    expect(r.products).toEqual([
      { n: 2, name: "Bracelets", oneLiner: "" },
      { n: 4, name: "", oneLiner: "Watering plants for neighbors" },
    ]);
  });

  it("clamps: 500-char name → 60, 500-char one-liner → 140", () => {
    const long = "x".repeat(500);
    const r = extractSiteContent(doc({ ideas: [idea({ productName: long, oneLiner: long })] }));
    expect(r.products).toEqual([
      {
        n: 1,
        name: "x".repeat(SITE_PRODUCT_NAME_MAX_CHARS),
        oneLiner: "x".repeat(SITE_ONE_LINER_MAX_CHARS),
      },
    ]);
  });

  it("blocklist per field, per product: a blocked name empties while the sibling one-liner survives; a fully-blocked idea gets NO card", () => {
    const r = extractSiteContent(
      doc({
        ideas: [
          idea({ productName: "f-u-c-k soda", oneLiner: "Still a fine one-liner" }),
          idea({ productName: "selling meth", oneLiner: "buy my shit lemonade" }),
          idea({ productName: "Bass Hole Lures", oneLiner: "Scunthorpe Sweets too" }), // innocent cross-word joins
        ],
      })
    );
    expect(r.products).toEqual([
      { n: 1, name: "", oneLiner: "Still a fine one-liner" },
      // n:2 fully blocked → excluded; n:3 keeps its number.
      { n: 3, name: "Bass Hole Lures", oneLiner: "Scunthorpe Sweets too" },
    ]);
  });

  it(">MAX_IDEAS docs clamp COUNT: only the first SITE_MAX_PRODUCTS ideas are read — a named idea beyond the cap never appears", () => {
    const many = Array.from({ length: 8 }, (_, i) => idea({ productName: `Idea ${i + 1}` }));
    const r = extractSiteContent(doc({ ideas: many }));
    expect(r.products).toHaveLength(SITE_MAX_PRODUCTS);
    expect(r.products![SITE_MAX_PRODUCTS - 1]).toEqual({ n: 5, name: "Idea 5", oneLiner: "" });
    expect(r.products!.some((p) => p.name === "Idea 6")).toBe(false);
  });

  it("adversarial shapes: ideas as string → NULL sentinel; a number element / missing fields / flat fields → that idea excluded, never a throw", () => {
    expect(extractSiteContent(doc({ ideas: "not-an-array" })).products).toBeNull();
    expect(extractSiteContent(doc({ ideas: [42, idea({ productName: "Real" })] })).products).toEqual([
      { n: 2, name: "Real", oneLiner: "" },
    ]);
    expect(extractSiteContent(doc({ ideas: [{ done: {} }] })).products).toEqual([]);
    expect(extractSiteContent(doc({ ideas: [{ fields: "flat" }] })).products).toEqual([]);
    expect(
      extractSiteContent(doc({ ideas: [idea({ productName: 7, oneLiner: { o: 1 } })] })).products
    ).toEqual([]);
  });

  it("[] is a legitimate OVERWRITE (ideas present but empty / all-empty), null is the skip sentinel (no ideas key / non-object doc)", () => {
    expect(extractSiteContent(doc({ ideas: [] })).products).toEqual([]);
    const noIdeas = doc();
    delete (noIdeas as Record<string, unknown>).ideas;
    expect(extractSiteContent(noIdeas).products).toBeNull();
    expect(extractSiteContent(null).products).toBeNull();
  });

  it("products are INDEPENDENT of activeIdea: an adversarial activeIdea still yields the full card array (and no one-liner)", () => {
    const r = extractSiteContent(doc({ activeIdea: -1 }));
    expect(r.oneLiner).toBeNull();
    expect(r.products).toHaveLength(2);
  });
});
