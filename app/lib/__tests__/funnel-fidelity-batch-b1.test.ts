import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Unit 10 BATCH B1 of the First Profit fidelity pass (audit:
 * docs/plans/2026-07-29-fp-fidelity-audit.md, drift items 12, 15/X1, and the
 * application-register half of 9). Source scans, because
 * `environment: "node"` has no renderer: the floating nav card exists once
 * and every application-register surface mounts it; the funnel's display
 * headings are Georgia (`.display`), never `font-display` (Space Grotesk);
 * the landing hero carries the handoff's lightbox and gradient byte for
 * byte. The card's VARIANT decisions are pure and tested in
 * funnel-nav-card-rules.test.ts — these pin the wiring.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CARD = "app/components/funnel/ProgressNavCard.tsx";

describe("X1: the floating nav card component (the ONE bar)", () => {
  const card = stripComments(read(CARD));

  it("is the handoff card: white, 14px radius, the prototype's shadow, sticky", () => {
    expect(card).toContain("rounded-[14px]");
    expect(card).toContain("bg-white");
    expect(card).toContain("shadow-[0_4px_18px_rgba(19,20,22,0.14)]");
    expect(card).toContain("sticky top-4");
  });

  it("carries the brand lockup and the 4px red bar on the track token, .35s width transition", () => {
    expect(card).toMatch(/<Wordmark \/>/);
    expect(card).toContain("bg-track");
    expect(card).toContain("bg-red");
    expect(card).toContain("transition-[width] duration-[350ms]");
  });

  it("renders SIGN OUT for the identity variants and reuses the supabase sign-out", () => {
    expect(card).toContain("SIGN OUT");
    expect(card).toMatch(/supabaseBrowser\(\)\.auth\.signOut\(\)/);
    // Surfaces with their own sign-out (the dashboard store) can pass it in.
    expect(card).toMatch(/onSignOut/);
  });

  it("its variant comes from nav-card-rules — layout only, no percent math here", () => {
    expect(card).toContain('from "@/app/lib/funnel/nav-card-rules"');
    expect(card).not.toMatch(/progressPercent|PROGRESS_STEPS/);
  });
});

describe("X1: every application-register surface mounts the card", () => {
  const MOUNTS: Array<[file: string, model: RegExp]> = [
    ["app/start/StartFlow.tsx", /navCardForStep\(step, null\)/],
    ["app/start/children/ChildrenFlow.tsx", /navCardForStep\("add_child", null\)/],
    ["app/start/child/[childId]/MiniAppShell.tsx", /miniAppNavCard\(step\)/],
    ["app/dashboard/DossierEditor.tsx", /wizardProgressStep\(step, child\.status !== "draft"\)/],
    ["app/start/next-steps/NextStepsFlow.tsx", /navCardIdentityOnly\(parentName\)/],
    ["app/start/arrival/ArrivalFlow.tsx", /navCardIdentityOnly\(parentName\)/],
  ];

  it.each(MOUNTS)("%s renders <ProgressNavCard> with its rules-derived model", (file, model) => {
    const src = stripComments(read(file));
    expect(src).toMatch(/<ProgressNavCard/);
    expect(src).toMatch(model);
  });

  it("the bare in-column bars are gone — the bar lives only in the card", () => {
    for (const [file] of MOUNTS) {
      const src = stripComments(read(file));
      expect(src, file).not.toMatch(/h-1 w-full overflow-hidden rounded-full bg-track/);
    }
  });

  it("the wizard's card carries the parent identity and the store's sign-out", () => {
    const editor = stripComments(read("app/dashboard/DossierEditor.tsx"));
    expect(editor).toMatch(/navCardIdentityName\(parent\?\.firstName \?\? "", parent\?\.lastName \?\? ""\)/);
    expect(editor).toMatch(/onSignOut=\{signOut\}/);
  });

  it("the editor view swaps DashHeader for the card — never both bars at once", () => {
    const app = stripComments(read("app/dashboard/DashboardApp.tsx"));
    expect(app).toMatch(/\{!\(ready && view === "editor" && selected\) && <DashHeader \/>\}/);
  });

  it("next-steps and arrival pages read the parent for the identity line", () => {
    for (const f of ["app/start/next-steps/page.tsx", "app/start/arrival/page.tsx"]) {
      const src = stripComments(read(f));
      expect(src, f).toMatch(/from\("parents"\)/);
      expect(src, f).toMatch(/navCardIdentityName\(/);
    }
  });
});

describe("drift 12: Georgia display headings on application-register funnel screens", () => {
  const GEORGIA_HEADINGS: Array<[file: string, pattern: RegExp]> = [
    // Explainer titles + capture h1.
    ["app/start/StartFlow.tsx", /className="display mt-3 text-3xl text-ink"/],
    ["app/start/StartFlow.tsx", /className="display text-3xl text-ink"/],
    // Children-grid hero.
    ["app/start/children/ChildrenFlow.tsx", /className="display text-3xl text-ink"/],
    // Next-steps titles.
    ["app/start/next-steps/NextStepsFlow.tsx", /className="display mt-2 text-3xl"/],
    // Wizard headers: the dossier header card + step section headers.
    ["app/dashboard/DossierEditor.tsx", /className="display mt-1 text-2xl text-ink"/],
    ["app/dashboard/wizard/shared.tsx", /className="display text-lg text-ink"/],
  ];

  it.each(GEORGIA_HEADINGS)("%s uses `.display` (Georgia 400)", (file, pattern) => {
    expect(stripComments(read(file))).toMatch(pattern);
  });

  it("no funnel application-register heading still uses font-display (Space Grotesk)", () => {
    for (const f of [
      "app/start/StartFlow.tsx",
      "app/start/children/ChildrenFlow.tsx",
      "app/start/next-steps/NextStepsFlow.tsx",
    ]) {
      expect(stripComments(read(f)), f).not.toMatch(/<h1 className="[^"]*font-display/);
    }
  });

  it("the display token stays Georgia-first and font-display stays Space Grotesk (site body)", () => {
    const css = read("app/globals.css");
    expect(css).toContain('--font-serif: Georgia, "Times New Roman", serif;');
    expect(css).toMatch(/\.display \{\r?\n\s+font-family: var\(--font-serif\);/);
    // The fix is the CLASS on funnel headings, never a token flip that would
    // swap the whole site's body face.
    expect(css).toContain(
      '--font-display: var(--font-space-grotesk), "Space Grotesk", sans-serif;'
    );
  });
});

describe("drift 9 (application-register half): the landing hero lightbox", () => {
  const landing = stripComments(read("app/components/landing/LandingPage.tsx"));

  it("the gradient stops are the handoff's, byte for byte", () => {
    expect(landing).toContain(
      "linear-gradient(rgba(19,20,22,0.30) 0%, rgba(19,20,22,0.06) 30%, rgba(19,20,22,0.10) 55%, rgba(19,20,22,0.82) 100%)"
    );
    // The pre-fidelity stops are gone.
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
    // Source-pinned rather than imported: LandingPage pulls in Footer/next
    // modules a node test must not evaluate.
    expect(landing).toContain(
      'FOUNDING_COHORT_LINE = "FOUNDING COHORT · FALL 2026 · TORONTO"'
    );
  });
});
