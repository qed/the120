import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE SURVIVORS OF THE FIDELITY-PIN FAMILY (v3 plan Unit 9).
 *
 * `funnel-fidelity-batch-{a,b1,b2,b3}`, `funnel-merged-shell`,
 * `one-application-editor` and `funnel-next-steps-shim` read the v2 `/start`
 * flow's source off disk and asserted on its TEXT. That flow moved to
 * `archive/new-user-v2/`, and those files were RETIRED WITH IT — they were
 * documentation of a surface the archive now preserves verbatim, so re-pointing
 * them at the archive would have been pinning a museum piece.
 *
 * A minority of their assertions were never about the v2 flow at all: they
 * pinned the theme tokens, the marketing landing page, and the dashboard —
 * surfaces that are still live and still shipping. Those are re-homed here
 * rather than deleted, because losing them was never part of the archive
 * decision. Nothing in this file reads anything under `archive/`.
 *
 * NOT re-homed, deliberately:
 *  - `app/components/funnel/ProgressNavCard.tsx` ("the ONE bar"). Every one of
 *    its mounts was a v2 flow screen, so after the archive it has NO live call
 *    site. Pinning the internals of an unmounted component is pinning dead
 *    code; the component itself is on Unit 10's deletion sweep.
 *  - the mini-app / arrival / next-steps copy and layout pins — v2 surfaces,
 *    retired with the flow.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("theme tokens (fidelity batch A drift 2 / B1 drift 12)", () => {
  const css = read("app/globals.css");

  it("carries the handoff's track and line-strong values", () => {
    expect(css).toContain("--color-track: #eceae5;");
    expect(css).toContain("--color-line-strong: #d8d5cf;");
  });

  it("`.display` stays Georgia-first and font-display stays Space Grotesk (site body)", () => {
    // The funnel's Georgia headings were a CLASS decision, never a token flip
    // that would swap the whole site's body face — that distinction outlives
    // the funnel screens it was made for.
    expect(css).toContain('--font-serif: Georgia, "Times New Roman", serif;');
    expect(css).toMatch(/\.display \{\r?\n\s+font-family: var\(--font-serif\);/);
    expect(css).toContain(
      '--font-display: var(--font-space-grotesk), "Space Grotesk", sans-serif;'
    );
  });
});

describe("the marketing landing hero (fidelity batch B1 drift 9 / B3 drift 16)", () => {
  const landing = stripComments(read("app/components/landing/LandingPage.tsx"));

  it("the gradient stops are the handoff's, byte for byte", () => {
    expect(landing).toContain(
      "linear-gradient(rgba(19,20,22,0.30) 0%, rgba(19,20,22,0.06) 30%, rgba(19,20,22,0.10) 55%, rgba(19,20,22,0.82) 100%)"
    );
    expect(landing).not.toContain("rgba(19,20,22,0.18)");
  });

  it("the text lightbox card exists: rgba .55, 14px radius, blur 2px, padding 16/18", () => {
    expect(landing).toContain('background: "rgba(19,20,22,0.55)"');
    expect(landing).toContain("rounded-[14px]");
    expect(landing).toContain("backdrop-blur-[2px]");
    expect(landing).toContain('padding: "16px 18px"');
  });

  it("carries the spec's contents in order: seats, headline, divider, subhead + cohort line, CTA", () => {
    const seats = landing.indexOf("seatsDisplay(seatsRemaining)");
    const headline = landing.indexOf("{content.headline}");
    const divider = landing.indexOf("bg-white/45");
    const subhead = landing.indexOf("{content.subhead}");
    const cohort = landing.indexOf("{FOUNDING_COHORT_LINE}");
    const cta = landing.indexOf("<StartCta", subhead);
    for (const i of [seats, headline, divider, subhead, cohort, cta]) {
      expect(i).toBeGreaterThan(-1);
    }
    expect(seats).toBeLessThan(headline);
    expect(headline).toBeLessThan(divider);
    expect(divider).toBeLessThan(subhead);
    expect(subhead).toBeLessThan(cohort);
    expect(cohort).toBeLessThan(cta);
  });

  it("the cohort line is the prototype's, byte for byte (no em dashes)", () => {
    expect(landing).toContain(
      'FOUNDING_COHORT_LINE = "FOUNDING COHORT · FALL 2026 · TORONTO"'
    );
  });

  it("keeps its wide containers and the three-column proof strip", () => {
    expect(landing).toContain("max-w-[1080px]");
    expect(landing).toContain("sm:grid-cols-3");
  });
});

describe("the dashboard's own chrome (fidelity batch A drift 8 / B1 X1 / B3 drift 16)", () => {
  const app = stripComments(read("app/dashboard/DashboardApp.tsx"));

  it("+ ADD A CHILD goes secondary once ≥1 child exists", () => {
    expect(app).toMatch(
      /children\.length > 0\s*\?\s*"border border-red bg-white text-red hover:bg-red\/5"\s*:\s*"bg-red text-white hover:bg-red-dark"/
    );
  });

  it("renders ONE top bar per register — the retired editor view's second bar never returns", () => {
    expect(app).toMatch(/\{!isPath && <DashHeader \/>\}/);
    expect(app).not.toContain("DossierEditor");
    expect(app).not.toContain('view === "editor"');
  });

  it("keeps its wide container and two-column cards grid", () => {
    expect(app).toContain("max-w-5xl");
    expect(app).toContain("sm:grid-cols-2");
  });
});
