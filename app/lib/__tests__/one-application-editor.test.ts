import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { globSync } from "tinyglobby";

import {
  MERGED_FLOW_ENABLED,
  MERGED_FORM_STEPS,
  MERGED_NEXT_STEPS,
  mergedInitialStep,
  resolveMergedStep,
  stepListForChild,
  type MergedFlowFacts,
} from "@/app/lib/funnel/merged-flow-rules";
import { MINIAPP_STEPS } from "@/app/lib/funnel/miniapp-rules";

/**
 * Unified-flow Unit 9 (R5/R7): the ATOMIC-SWAP invariants.
 *
 * 1. ONE EDITOR — exactly one surface in the app renders application-form
 *    inputs. Count-pinned so it reddens at ZERO (the swap deleted the wizard
 *    without a reachable replacement — the atomic-swap learning) and at TWO
 *    (a second owner of form state reappeared — the two-owner clobber the
 *    dark-flag staging existed to prevent).
 * 2. The retired surfaces are actually GONE, and no interim scaffolding
 *    (TODO(unified-flow…)) survives anywhere under app/.
 * 3. Assembly audit (the value-level-spec learning): one pinned assembly
 *    fact per changed composite, asserted THROUGH the live flag so a flag
 *    regression reddens the audit, not just the flag pin.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");

const APP_SOURCES: ReadonlyArray<string> = globSync(["app/**/*.{ts,tsx}"], {
  cwd: ROOT,
  absolute: false,
})
  .map((f) => f.replaceAll("\\", "/"))
  .filter((f) => !f.includes("__tests__"));

describe("the ONE-EDITOR invariant (reddens at zero AND at two)", () => {
  it("exactly one surface renders application-form inputs (the basics field set behind real <input>s)", () => {
    // The marker of an application-form SURFACE: it renders inputs AND
    // carries the basics field set's most distinctive member. capture
    // (StartFlow) has firstName/grade but never currentSchool; the store and
    // CRM read the field without rendering an input for it.
    const formSurfaces = APP_SOURCES.filter((f) => {
      const src = read(f);
      return src.includes("<input") && src.includes("currentSchool");
    });
    expect(formSurfaces).toEqual(["app/start/child/[childId]/MergedFormSections.tsx"]);
  });

  it("the retired wizard surfaces are gone from disk", () => {
    for (const gone of [
      "app/dashboard/DossierEditor.tsx",
      "app/dashboard/DossierPreview.tsx",
      "app/dashboard/wizard",
    ]) {
      expect(existsSync(path.resolve(ROOT, gone)), gone).toBe(false);
    }
  });

  it("no interim unified-flow scaffolding survives (TODO(unified-flow…) sweep)", () => {
    const offenders = APP_SOURCES.filter((f) => read(f).includes("TODO(unified-flow"));
    expect(offenders).toEqual([]);
  });

  it("the ONE writer pair backs the one editor: form saves and submit go through the funnel actions", () => {
    const sections = read("app/start/child/[childId]/MergedFormSections.tsx");
    expect(sections).toContain("saveFormStepAction");
    expect(sections).toContain("submitApplicationAction");
    // The retired client-store write path stays retired.
    const store = read("app/dashboard/store.tsx");
    expect(store).not.toMatch(/from\("children"\)\s*\.\s*(update|upsert|delete)/);
  });
});

/* ─────────────── assembly audit (one pinned fact per changed composite) ─────────────── */

/** Facts built THROUGH the live flag: if MERGED_FLOW_ENABLED regresses to
 *  false, every assertion below reddens — the audit pins the assembled
 *  production behaviour, not a hypothetical. */
const liveFacts = (over: Partial<MergedFlowFacts> = {}): MergedFlowFacts => ({
  applicantState: null,
  status: "draft",
  doorConfirmed: false,
  hasProject: false,
  nextStepsReachable: false,
  formProgress: false,
  firstIncompleteFormStep: "basics",
  mergeFlagOn: MERGED_FLOW_ENABLED,
  ...over,
});

describe("assembly audit — the swapped composites, one pinned fact each", () => {
  it("offered card: the reserve block assembles exactly TWO pills — filled Reserve (button) + outlined Review (anchor)", () => {
    const app = read("app/dashboard/DashboardApp.tsx");
    const block = app.slice(
      app.indexOf("const renderReserveCta"),
      app.indexOf("// Auth gate:")
    );
    expect(block.length).toBeGreaterThan(0);
    expect(block.match(/<button\b/g)).toHaveLength(1);
    expect(block.match(/<a\b/g)).toHaveLength(1);
    expect(block).toContain("reviewPillClass");
  });

  it("dashboard entry points: the offered walk lands on the FIRST form step (R3: review from the top)", () => {
    expect(
      resolveMergedStep(
        null,
        liveFacts({ applicantState: "offered", nextStepsReachable: true, formProgress: true })
      )
    ).toBe("basics");
  });

  it("legacy draft entry: the plain href resumes at the first incomplete form step (I2, no regression)", () => {
    expect(
      mergedInitialStep(liveFacts({ status: "draft", firstIncompleteFormStep: "group" }))
    ).toBe("group");
  });

  it("the full gated walk assembles build + seam + form + next-steps, in order, under the LIVE flag", () => {
    expect([
      ...stepListForChild(
        liveFacts({ applicantState: "offered", nextStepsReachable: true })
      ),
    ]).toEqual([...MINIAPP_STEPS, "seam", ...MERGED_FORM_STEPS, ...MERGED_NEXT_STEPS]);
  });

  it("the seam sits between reveal and basics for the build cohort — and nowhere in a legacy walk", () => {
    const build = stepListForChild(liveFacts({ applicantState: "project_created" }));
    expect(build.indexOf("seam")).toBe(build.indexOf("reveal") + 1);
    expect(build.indexOf("basics")).toBe(build.indexOf("seam") + 1);
    expect(stepListForChild(liveFacts())).not.toContain("seam");
  });

  it("review's terminal arms stay assembled in the one section (the Unit 7 endings, still pinned live)", () => {
    const sections = read("app/start/child/[childId]/MergedFormSections.tsx");
    for (const marker of [
      'case "under_review":',
      'case "waitlisted":',
      'case "next_steps":',
      'terminal === "finish_build"',
    ]) {
      expect(sections).toContain(marker);
    }
  });
});
