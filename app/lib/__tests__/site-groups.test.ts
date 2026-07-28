import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FIRST_PROFIT_LANDING,
  LANDING_HEADLINE_LINE_2,
  LANDING_SUBHEAD_TAIL,
  PHASE_TOKENS,
  groups,
  groupBySlug,
} from "@/app/lib/site";

/**
 * R5: `Group` gains the landing-page fields rather than a parallel content
 * module. These assertions are the contract U5 builds six pages against.
 */

describe("the landing-page fields (R5)", () => {
  it("gives all five groups a headline, subhead, hero slot and phase token", () => {
    expect(groups).toHaveLength(5);
    for (const g of groups) {
      expect(g.headline.trim(), g.slug).not.toBe("");
      expect(g.subhead.trim(), g.slug).not.toBe("");
      expect(g.hero, g.slug).toMatch(/^\/.+\.(jpg|jpeg|png|webp|avif)$/);
      expect(PHASE_TOKENS, g.slug).toContain(g.phaseToken);
    }
  });

  it("ends every subhead on the constant sentence, from the constant", () => {
    // Asserted by containment of the exported constant rather than by a
    // retyped copy of the sentence: `environment: "node"` has no renderer to
    // compare output through, so identity of the source is the only check
    // available — and it is the one that matters.
    for (const g of [...groups, FIRST_PROFIT_LANDING]) {
      expect(g.subhead.endsWith(LANDING_SUBHEAD_TAIL), g.subhead).toBe(true);
    }
    expect(LANDING_SUBHEAD_TAIL).toContain("In 10 minutes");
    expect(LANDING_HEADLINE_LINE_2.trim()).not.toBe("");
  });

  it("gives each group a DISTINCT headline, subhead, hero and phase token", () => {
    // The failure this catches is a copy-paste that leaves two groups sharing a
    // door colour or a headline — invisible until six pages are built and two
    // of them look identical.
    for (const field of ["headline", "subhead", "hero", "phaseToken"] as const) {
      const values = groups.map((g) => g[field]);
      expect(new Set(values).size, `${field} is not unique across groups`).toBe(5);
    }
  });

  it("maps door position to phase colour exactly as brief §3.3 / D9 confirms", () => {
    // Athletes coral, Founders blue, Givers purple, Makers green, Scholars
    // gold. Peter confirmed this table; it is authoritative for both the funnel
    // doors and the home-card accents, so it is pinned rather than described.
    const byToken = Object.fromEntries(groups.map((g) => [g.slug, g.phaseToken]));
    expect(byToken).toEqual({
      athletes: "--color-phase-sell",
      founders: "--color-phase-build",
      givers: "--color-phase-validate",
      makers: "--color-phase-grow",
      scholars: "--color-phase-scale",
    });
  });

  it("names phase tokens that actually exist in globals.css", () => {
    // The brief spells them `--tp-phase-*`, which exists nowhere in this repo.
    // A token that resolves to nothing is a silent no-op in CSS: the colour
    // simply does not apply, and nothing anywhere reports it.
    const css = readFileSync(path.resolve(process.cwd(), "app/globals.css"), "utf8");
    for (const token of PHASE_TOKENS) {
      expect(css, token).toContain(`${token}:`);
    }
    expect(css).not.toContain("--tp-phase-");
  });

  it("scholars' href and the landing route moved TOGETHER (U5's scheduled swap)", () => {
    // The U1-era pin held this at /scholars until the route could serve it;
    // U5 is that change. The invariant now: every group's href is a page
    // generateStaticParams actually emits, so a home card can never point at
    // a notFound() — the property the original pin existed to protect,
    // stated directly instead of by freezing one value.
    expect(groupBySlug("scholars")?.href).toBe("/groups/scholars");
    for (const g of groups) {
      expect(g.href, g.slug).toBe(`/groups/${g.slug}`);
    }
  });

  it("gives /first-profit the neutral copy, and no group hint", () => {
    expect(FIRST_PROFIT_LANDING.headline).toBe(
      "Your kid will build a real business this year."
    );
    // Not a group: it must never appear in the five that carry a `?g=` hint.
    expect(groups.map((g) => g.slug)).not.toContain("first-profit");
  });
});
