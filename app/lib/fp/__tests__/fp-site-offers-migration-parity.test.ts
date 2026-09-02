import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("migration parity: fp_site_offers.sql", () => {
  const raw = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260928120000_fp_site_offers.sql"),
    "utf8",
  );
  const sql = raw.replace(/--[^\n]*/g, "");

  function fnBody(name: string): string {
    const start = sql.search(
      new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "i"),
    );
    expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
    const end = sql.indexOf("$$;", start);
    expect(end, `${name} closes with $$;`).toBeGreaterThan(start);
    return sql.slice(start, end);
  }

  const publicSite = fnBody("fp_public_site");
  const checkout = fnBody("fp_public_site_checkout");

  it("keeps the Payment Link bounded to an exact HTTPS Stripe host and one opaque path id", () => {
    expect(
      /checkout_url\s+~\s+'\^https:\/\/buy\[\.\]stripe\[\.\]com\/\[A-Za-z0-9_-\]\+/.test(sql),
    ).toBe(true);
    expect(sql).toContain("[^#[:cntrl:]]*");
    expect(
      /foreign\s+key\s*\(\s*checkout_approved_by\s*\)\s+references\s+public\.parents\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i.test(
        sql,
      ),
    ).toBe(true);
  });

  it("requires a complete, stamped offer whenever checkout is enabled", () => {
    for (const required of [
      /storefront_headline/i,
      /offer_name/i,
      /price_cents\s+is\s+not\s+null/i,
      /price_cents\s*>\s*0/i,
      /checkout_url\s+is\s+not\s+null/i,
      /checkout_approved_at\s+is\s+not\s+null/i,
      /checkout_approved_by\s+is\s+not\s+null/i,
    ]) {
      expect(required.test(sql), String(required)).toBe(true);
    }
  });

  it("never projects the Payment Link through the cacheable public page RPC", () => {
    const signature = publicSite.slice(0, publicSite.search(/language\s+sql/i));
    expect(signature).toContain("checkout_ready boolean");
    expect(signature).toContain("image_url text");
    expect(signature).not.toContain("checkout_url");
    expect(publicSite).toMatch(/security\s+definer/i);
    expect(publicSite).toMatch(/set\s+search_path\s*=\s*public/i);
  });

  it("shows offer copy only after approval by the child's current parent", () => {
    expect(publicSite).toMatch(/join\s+public\.fp_player_profiles\s+p\s+on\s+p\.id\s*=\s*s\.profile_id/i);
    expect(publicSite).toMatch(/join\s+public\.children\s+c\s+on\s+c\.id\s*=\s*p\.child_id/i);
    const currentParentChecks = publicSite.match(/s\.checkout_approved_by\s*=\s*c\.parent_id/gi) ?? [];
    // Headline, template, theme, image, five offer fields and checkout-ready
    // all carry a current-parent gate. Pin a floor rather than a brittle exact
    // count so adding another approved projection cannot weaken this test.
    expect(currentParentChecks.length).toBeGreaterThanOrEqual(10);
  });

  it("bounds the parent headline and exposes only the closed saved-cover choice", () => {
    expect(sql).toMatch(/char_length\s*\(\s*storefront_headline\s*\)\s*<=\s*120/i);
    expect(sql).toMatch(/image_choice\s+in\s*\(\s*'none'\s*,\s*'cover'\s*\)/i);
    expect(publicSite).toMatch(/s\.image_choice\s*=\s*'cover'/i);
    expect(publicSite).toMatch(/char_length\s*\(\s*c\.fp_cover_data_url\s*\)\s*<=\s*262144/i);
    expect(publicSite).toContain("data:image/(svg[+]xml|png|jpeg|webp);base64");
    expect(publicSite).not.toMatch(/https?:\/\//i);
  });

  it("keeps drafts owned by one parent and requires the approver to be that owner", () => {
    expect(sql).toMatch(/foreign\s+key\s*\(\s*offer_edited_by\s*\)\s+references\s+public\.parents/i);
    expect(sql).toMatch(/checkout_approved_by\s+is\s+null\s+or\s+checkout_approved_by\s*=\s*offer_edited_by/i);
  });

  it("the fresh checkout RPC fails closed on visibility, operator lock, enablement, and current-parent approval", () => {
    for (const gate of [
      /s\.published/i,
      /not\s+s\.operator_locked/i,
      /s\.checkout_enabled/i,
      /s\.checkout_url\s+is\s+not\s+null/i,
      /s\.checkout_approved_at\s+is\s+not\s+null/i,
      /s\.checkout_approved_by\s*=\s*c\.parent_id/i,
      /e\.product_key\s*=\s*'round_one_sell'/i,
      /e\.access_code\s*=\s*'phase:sell'/i,
      /e\.status\s*=\s*'active'/i,
    ]) {
      expect(gate.test(checkout), String(gate)).toBe(true);
    }
    expect(checkout).toMatch(/security\s+definer/i);
    expect(checkout).toMatch(/set\s+search_path\s*=\s*public/i);
    expect(publicSite).toMatch(/e\.access_code\s*=\s*'phase:sell'/i);
    expect(
      /revoke\s+execute\s+on\s+function\s+public\.fp_public_site_checkout\s*\(\s*text\s*\)\s+from\s+public/i.test(
        sql,
      ),
    ).toBe(true);
    expect(
      /grant\s+execute\s+on\s+function\s+public\.fp_public_site_checkout\s*\(\s*text\s*\)\s+to\s+anon\s*,\s*authenticated/i.test(
        sql,
      ),
    ).toBe(true);
  });

  it("binds both public checkout decisions to the entitled catalog version and its global fail-off", () => {
    for (const body of [publicSite, checkout]) {
      expect(body).toMatch(
        /join\s+public\.fp_billing_products\s+b\s+on\s+b\.product_key\s*=\s*e\.product_key\s+and\s+b\.version\s*=\s*e\.product_version/i,
      );
      expect(body).toMatch(/b\.storefront_checkout_enabled\s*=\s*true/i);
    }
  });
});
