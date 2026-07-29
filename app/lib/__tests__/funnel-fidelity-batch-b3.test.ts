import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Unit 10 BATCH B3 of the First Profit fidelity pass (audit:
 * docs/plans/2026-07-29-fp-fidelity-audit.md, drift item 16/X7 — desktop
 * layouts). Source scans, because `environment: "node"` has no renderer.
 *
 * The authority is the prototype's own desktop CSS (`First Profit.dc.html`):
 *   - marketing-register scenes (landing, explainer/capture, addchild,
 *     apply/wizard) get a 960px desktop body in a ~1080–1180px frame
 *     (`.fp-appframe.is-desktop .fp-appbody{max-width:960px}`), with text
 *     keeping its own 430–440px measure and paired fields/cards flowing into
 *     two columns;
 *   - app-register scenes (the mini-app's seven steps, next steps, arrival)
 *     keep a 560px centered column at desktop
 *     (`.fp-appframe.is-desktop.app .fp-appbody{max-width:560px}`) — the
 *     desktop reference screenshots (08–14 trail/hq, 16, 18) show the same
 *     single column, never a grid, so `max-w-xl` (576px) is the intended
 *     treatment there and is pinned as such.
 * Mobile-first stays untouched: every desktop class is an md:/lg: variant.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("drift 16: marketing-register surfaces widen to the 960px desktop body", () => {
  it("the explainer/capture column is 960 at lg, with the prototype's 440/430 text measures", () => {
    const flow = stripComments(read("app/start/StartFlow.tsx"));
    expect(flow).toContain("max-w-lg flex-col justify-center px-6 py-16 lg:max-w-[960px]");
    expect(flow).toContain("lg:max-w-[440px]"); // explainer body measure
    expect(flow).toContain("lg:max-w-[430px]"); // capture form column
  });

  it("Add Children is 960 at lg; the child cards go two-up and the form fields pair at md", () => {
    const flow = stripComments(read("app/start/children/ChildrenFlow.tsx"));
    expect(flow).toContain("max-w-lg flex-col justify-center px-6 py-16 lg:max-w-[960px]");
    expect(flow).toContain("md:grid md:grid-cols-2");
  });

  it("the dossier wizard shell is 960 at lg", () => {
    const editor = stripComments(read("app/dashboard/DossierEditor.tsx"));
    expect(editor).toContain("max-w-3xl px-6 py-10 lg:max-w-[960px]");
  });

  it("the landing keeps its wide containers and the three-column proof strip", () => {
    const landing = stripComments(read("app/components/landing/LandingPage.tsx"));
    expect(landing).toContain("max-w-[1080px]");
    expect(landing).toContain("sm:grid-cols-3");
  });

  it("the dashboard home keeps its wide container and two-column cards grid", () => {
    const app = stripComments(read("app/dashboard/DashboardApp.tsx"));
    expect(app).toContain("max-w-5xl");
    expect(app).toContain("sm:grid-cols-2");
  });
});

describe("drift 16: app-register surfaces keep the prototype's 560px desktop column", () => {
  // `.fp-appframe.is-desktop.app .fp-appbody{max-width:560px}` — the skinned
  // screens and the post-ladder close never widen to the marketing body.
  const APP_COLUMN: string[] = [
    "app/start/child/[childId]/MiniAppShell.tsx",
    "app/start/next-steps/NextStepsFlow.tsx",
    "app/start/arrival/ArrivalFlow.tsx",
  ];

  it.each(APP_COLUMN)("%s stays a centered max-w-xl column with no desktop grid", (file) => {
    const src = stripComments(read(file));
    expect(src).toMatch(/<main className="mx-auto flex min-h-screen w-full max-w-xl /);
    expect(src).not.toContain("lg:max-w-[960px]");
    expect(src).not.toContain("md:grid-cols");
  });
});
