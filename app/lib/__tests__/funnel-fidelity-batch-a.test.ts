import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { holdSeatCta } from "@/app/lib/funnel/deposit-rules";

/**
 * Unit 10 BATCH A of the First Profit fidelity pass (audit:
 * docs/plans/2026-07-29-fp-fidelity-audit.md, drift items 1-8 + E1/E3).
 * These pin the RESTORED handoff-spec strings and tokens that live in
 * components (no pure function to call under `environment: "node"`), so a
 * later rewrite reddens a test instead of silently re-drifting. Sibling
 * pins live beside their modules' own suites (landing-content,
 * funnel-reveal-rules, funnel-miniapp-rules).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("drift 1 + 4: the explainer (StartFlow)", () => {
  const flow = stripComments(read("app/start/StartFlow.tsx"));

  it('the eyebrow is always "HOW IT WORKS" (R29 + handoff agree)', () => {
    expect(flow).toContain('const EXPLAINER_EYEBROW = "HOW IT WORKS"');
    expect(flow).toContain("{EXPLAINER_EYEBROW}");
    expect(flow).not.toContain("STEP ONE");
  });

  it("the swipe titles and bodies are the handoff's EXP array, byte for byte", () => {
    expect(flow).toContain('"Your child designs a real business."');
    expect(flow).toContain(`"You'll see exactly where it leads."`);
    expect(flow).toContain('"This is the application."');
    expect(flow).toContain(
      "A guided 10-minute project builder. You can do it together, or hand them the device."
    );
    expect(flow).toContain(
      "We'll show you their first phase complete, and every step between here and there."
    );
    expect(flow).toContain(
      "What your child builds today carries into the program. Nothing is throwaway."
    );
  });

  it('CTA labels per spec: "Continue" → "Start Building →" → capture "Next Step →"', () => {
    expect(flow).toContain('stage === 2 ? "Start Building →" : "Continue"');
    expect(flow).toContain('"Next Step →"');
    // The pre-fidelity labels are gone from the flow.
    expect(flow).not.toContain('"Start Here →"');
    expect(flow).not.toContain('"Next →"');
  });
});

describe("drift 2: tokens: capture disabled #d8d5cf, progress track #eceae5", () => {
  it("the theme carries the track token at the handoff value", () => {
    const css = read("app/globals.css");
    expect(css).toContain("--color-track: #eceae5;");
    expect(css).toContain("--color-line-strong: #d8d5cf;");
  });

  it("the capture CTA's disabled state is line-strong (#d8d5cf), never a faded red", () => {
    const flow = stripComments(read("app/start/StartFlow.tsx"));
    expect(flow).toContain("disabled:bg-line-strong");
    // The submit button no longer dims red for its disabled state.
    expect(flow).not.toMatch(/Next Step[\s\S]{0,400}disabled:opacity-60/);
  });

  it("every funnel progress bar runs on the track token", () => {
    for (const f of [
      "app/start/StartFlow.tsx",
      "app/start/children/ChildrenFlow.tsx",
      "app/start/child/[childId]/MiniAppShell.tsx",
    ]) {
      const src = stripComments(read(f));
      expect(src, f).toMatch(/h-1 w-full overflow-hidden rounded-full bg-track/);
    }
  });
});

describe("drift 3: the tasks screen renders the spec chrome (MiniAppShell)", () => {
  const shell = stripComments(read("app/start/child/[childId]/MiniAppShell.tsx"));

  it("compose header (eyebrow + project name), Step-n chips, footer line, CTA", () => {
    expect(shell).toContain("{REVEAL_UI_COPY.tasksEyebrow}");
    expect(shell).toContain("{REVEAL_UI_COPY.tasksIntro}");
    expect(shell).toContain("{REVEAL_UI_COPY.tasksFooter}");
    expect(shell).toContain("{REVEAL_UI_COPY.tasksNext}");
    expect(shell).toContain("Step {i + 1}");
  });
});

describe("drift 5: the next-steps final CTA (deposit-rules + NextStepsFlow)", () => {
  it('is "Hold {name}\'s seat · $250 →", named for the child', () => {
    expect(holdSeatCta("Theo")).toBe("Hold Theo's seat · $250 →");
    expect(holdSeatCta("  ")).toBe("Hold your builder's seat · $250 →");
  });

  it("the flow renders it and the old label is gone", () => {
    const flow = stripComments(read("app/start/next-steps/NextStepsFlow.tsx"));
    expect(flow).toContain("{holdSeatCta(firstName)}");
    expect(flow).not.toContain("Reserve the seat →");
  });
});

describe("drift 7: the handoff screen carries the centered logo tile", () => {
  it("renders the First Profit mark on an ink tile above the seam copy", () => {
    const shell = stripComments(read("app/start/child/[childId]/MiniAppShell.tsx"));
    expect(shell).toMatch(/Image src="\/path-logo\.svg"/);
    // …and the copy renders from the rules module, every field.
    for (const field of ["eyebrow", "title", "body", "parentLine", "cta"]) {
      expect(shell).toContain(`{copy.${field}}`);
    }
  });
});

describe("drift 8: + ADD A CHILD goes secondary once ≥1 child exists", () => {
  it("the dashboard pill is white/red-outline with children, red only when empty", () => {
    const src = stripComments(read("app/dashboard/DashboardApp.tsx"));
    expect(src).toMatch(
      /children\.length > 0\s*\?\s*"border border-red bg-white text-red hover:bg-red\/5"\s*:\s*"bg-red text-white hover:bg-red-dark"/
    );
  });

  it("the funnel grid's add button mirrors the treatment", () => {
    const src = stripComments(read("app/start/children/ChildrenFlow.tsx"));
    expect(src).toMatch(
      /children\.length === 0\s*\?\s*"bg-red text-white hover:bg-red-dark"\s*:\s*"border border-red bg-white text-red hover:bg-red\/5"/
    );
  });
});
