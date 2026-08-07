import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { globSync } from "tinyglobby";

import {
  PROOF_POINTS,
  PROOF_STRIP_HEADLINE,
  WHAT_IS_THE_120,
} from "@/app/components/landing/LandingPage";
import { generateStaticParams } from "@/app/groups/[slug]/page";
import {
  FIRST_PROFIT_LANDING,
  LANDING_HEADLINE_LINE_2,
  LANDING_SUBHEAD_TAIL,
  groupBySlug,
  groups,
} from "@/app/lib/site";

/**
 * The six landings (funnel U5; R19–R27). `environment: "node"` has no
 * renderer, so every assertion here is about DATA identity or SOURCE shape —
 * which is the right altitude anyway: the failure modes worth pinning are a
 * paragraph drifting per-group, a page quietly going dynamic, and a home card
 * pointing at a 404.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("R19/R27 — one template, five groups, scholars included", () => {
  it("generateStaticParams returns ALL FIVE groups", () => {
    const slugs = generateStaticParams().map((p) => p.slug).sort();
    expect(slugs).toEqual(["athletes", "founders", "givers", "makers", "scholars"]);
  });

  it("every href a home card renders is a page the route actually generates", () => {
    // The property U1's deferred-href pin existed to protect, now direct: a
    // card can never point at a notFound().
    const generated = new Set(generateStaticParams().map((p) => `/groups/${p.slug}`));
    for (const g of groups) {
      expect(generated.has(g.href), `${g.slug} → ${g.href}`).toBe(true);
    }
  });

  it("an unknown slug 404s — the notFound survives scholars' admission", () => {
    const src = stripComments(read("app/groups/[slug]/page.tsx"));
    expect(src).toMatch(/if \(!group\) notFound\(\)/);
    // And the scholars-specific exclusion is GONE — admitting it was the
    // point. Dot-all, or a two-line reintroduction walks past the scan.
    expect(src).not.toMatch(/scholars[\s\S]{0,80}notFound|notFound[\s\S]{0,80}scholars/);
  });
});

describe("R21/R22 — the shared content is shared by IDENTITY", () => {
  it("the network paragraph is one exported constant, not group-flavoured", () => {
    // A data assertion, not a render assertion: there is no renderer, and the
    // thing worth pinning is that all six instances reference ONE constant.
    expect(WHAT_IS_THE_120).toContain("selective network of 120 kids");
    expect(WHAT_IS_THE_120).toContain("Athletes");
    const template = read("app/components/landing/LandingPage.tsx");
    expect(template).toContain("{WHAT_IS_THE_120}");
    // No page overrides it: the constant is referenced only in the template
    // and this test.
    const outsideUses = globSync(["app/**/*.tsx"], { cwd: ROOT })
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => !f.includes("__tests__") && !f.endsWith("landing/LandingPage.tsx"))
      .filter((f) => read(f).includes("WHAT_IS_THE_120"));
    expect(outsideUses).toEqual([]);
  });

  it("headline line 2 is the constant, rendered from the constant", () => {
    expect(LANDING_HEADLINE_LINE_2).toBe("We'll show you how right now.");
    expect(read("app/components/landing/LandingPage.tsx")).toContain(
      "{LANDING_HEADLINE_LINE_2}"
    );
  });

  it("every subhead still ends on the constant tail — six instances, one sentence", () => {
    for (const g of [...groups, FIRST_PROFIT_LANDING]) {
      expect(g.subhead.endsWith(LANDING_SUBHEAD_TAIL), g.subhead).toBe(true);
    }
  });

  it("the proof strip is the handoff copy, restored (U10 fidelity, E1 ruling)", () => {
    expect(PROOF_STRIP_HEADLINE).toBe("No simulations. No pretend points.");
    expect(PROOF_POINTS.map((p) => p.title)).toEqual([
      "Real customers",
      "Real money",
      "Verified by real adults",
    ]);
    expect(PROOF_POINTS[0].body).toBe(
      "Strangers say yes at booths, doorsteps and games. Not classmates, not cousins."
    );
    expect(PROOF_POINTS[1].body).toBe(
      "Cash in hand, logged sale by sale. Cost, price and profit your kid can explain."
    );
    expect(PROOF_POINTS[2].body).toBe(
      "Every step checked against a written bar. It's never self-marked, never automated."
    );
    // Copy rule: no em dashes in the restored strip.
    for (const p of PROOF_POINTS) {
      expect(p.title).not.toContain("—");
      expect(p.body).not.toContain("—");
    }
  });

  it("the CTA band carries the handoff headline with its italic accent (U10 fidelity, drift 6)", () => {
    const template = read("app/components/landing/LandingPage.tsx");
    expect(template).toContain("The application is the first day of the business.");
    expect(template).toMatch(/<span className="italic">Start it now\.<\/span>/);
    // The pre-fidelity rewrite is gone.
    expect(template).not.toContain("Ten minutes from now, this is");
  });
});

describe("Decision 4 — the landings EMIT params and never READ them", () => {
  // `app/first-profit/page.tsx` was the sixth landing. v3 plan Unit 10 retired
  // it to a redirect (R16: no First Profit surface on the120.school), so it is
  // no longer a landing to hold to landing rules — the pins that survive it are
  // the two below: that it still RESOLVES, and that nothing internal links it.
  const LANDING_SOURCES = [
    "app/groups/[slug]/page.tsx",
    "app/components/landing/LandingPage.tsx",
  ];

  it("no landing file touches searchParams — the thing that silently destroys static generation", () => {
    for (const f of LANDING_SOURCES) {
      expect(stripComments(read(f)), f).not.toMatch(/searchParams/);
    }
  });

  it("no landing file forces dynamic rendering", () => {
    for (const f of LANDING_SOURCES) {
      expect(stripComments(read(f)), f).not.toMatch(/force-dynamic/);
    }
  });

  it("seats come from getSeatsRemaining (ISR), never the scaffolding constant directly", () => {
    for (const f of ["app/groups/[slug]/page.tsx"]) {
      const src = stripComments(read(f));
      expect(src, f).toMatch(/getSeatsRemaining/);
      expect(src, f).not.toMatch(/SEATS_REMAINING/);
    }
  });

  it("the seats fetch cannot stall a six-page build — env guard AND a timeout", () => {
    // The env guard covers "no config"; the abort covers "config present,
    // endpoint HANGING", which fails slow and now sits in the build path of
    // six static pages (adversarial review).
    const seats = stripComments(read("app/lib/seats.ts"));
    // Since U13 the guard THROWS inside the shared live read and the
    // marketing wrapper catches to the constant (the CRM wrapper must not).
    expect(seats).toMatch(/if \(!url \|\| !key\) throw/);
    expect(seats).toMatch(/return SEATS_REMAINING/);
    expect(seats).toMatch(/AbortSignal\.timeout\(/);
  });

  it("zero seats renders the waitlist state, never '0 OF 120 SEATS REMAIN'", async () => {
    const { seatsDisplay, WAITLIST_LABEL } = await import("@/app/lib/site");
    expect(seatsDisplay(0)).toBe(WAITLIST_LABEL);
    expect(seatsDisplay(-1)).toBe(WAITLIST_LABEL);
    expect(seatsDisplay(7)).toContain("7 OF 120");
    // The template renders through seatsDisplay, not seatsLabel.
    const template = stripComments(read("app/components/landing/LandingPage.tsx"));
    expect(template).toMatch(/seatsDisplay\(/);
    expect(template).not.toMatch(/seatsLabel\(/);
  });
});

describe("R24/R25 — attribution and the ad-only sixth page", () => {
  it("group landings carry g and src", () => {
    const groupPage = stripComments(read("app/groups/[slug]/page.tsx"));
    expect(groupPage).toMatch(/source: groupCtaSource\(group\.slug\)/);
    expect(groupPage).toMatch(/group: group\.slug/);
  });

  it("/first-profit is RETIRED to a redirect, and still resolves (R16, v3 Unit 10)", () => {
    // Broad ad creative already in flight names this URL, so it may not 404.
    // The whole body is the redirect — no render, no data read, no session.
    const fp = stripComments(read("app/first-profit/page.tsx"));
    expect(fp).toContain("FP_LANDING_TARGET");
    expect(fp).toContain("redirect(FP_LANDING_TARGET)");
    expect(fp).not.toContain("return (");
    expect(fp).not.toMatch(/source: "fp-generic"/);
  });

  it("nothing internal links to /first-profit (R25 — the broad-ads destination only)", () => {
    // The stem anywhere in a string context, not only as an exact quoted
    // literal — "/first-profit?ref=x", a trailing slash, or a template
    // interpolation all count (the documented spelling-sweep lesson). Config
    // files are scanned too: a redirect in next.config is an internal link.
    const files = globSync(["app/**/*.{ts,tsx}", "next.config.*", "middleware.*", "proxy.*"], {
      cwd: ROOT,
    })
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => !f.includes("__tests__") && !f.startsWith("app/first-profit/"));
    // The negative lookahead excludes asset paths ("…/heroes/first-profit.jpg")
    // while still catching "/first-profit", "/first-profit/", and
    // "/first-profit?ref=x" — the ROUTE, not the filename stem.
    const offenders = files.filter((f) =>
      /\/first-profit(?![\w.-])/.test(stripComments(read(f)))
    );
    expect(offenders).toEqual([]);
  });

  it("R26: the retiring chrome is gone — one exit, forward", () => {
    const template = stripComments(read("app/components/landing/LandingPage.tsx"));
    expect(template).not.toMatch(/Book a call/i);
    expect(template).not.toMatch(/JoinButton|useAccountModal/);
    expect(template).not.toMatch(/← THE 120|see the groups/i);
  });

  it("R27: /scholars stays live, reroutes to scholars-legacy, and no card links to it", () => {
    expect(read("app/scholars/page.tsx")).toContain('source={"scholars-legacy"}');
    expect(groupBySlug("scholars")?.href).toBe("/groups/scholars");
  });
});
