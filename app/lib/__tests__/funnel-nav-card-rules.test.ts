import { describe, expect, it } from "vitest";

import { PROGRESS_STEPS, progressPercent } from "@/app/lib/funnel/capture-rules";
import { miniAppNavCard, MINIAPP_STEPS } from "@/app/lib/funnel/miniapp-rules";
import {
  NAV_CARD_IDENTITY_STEPS,
  navCardForStep,
  navCardIdentityName,
  navCardIdentityOnly,
  navCardLabel,
  navCardShortLabel,
} from "@/app/lib/funnel/nav-card-rules";

/**
 * Unit 10 BATCH B1 (audit X1/X2): the floating nav card's variant + percent
 * mapping. The handoff's interaction rule, as return values: bar + full
 * label explainer → reveal; bar + short label + NAME · SIGN OUT from the
 * wizard on; name + SIGN OUT alone post-ladder (next steps / arrival).
 */

describe("navCardForStep — pre-wizard steps render the bar-only card", () => {
  const preWizard = PROGRESS_STEPS.map((s) => s.id).filter(
    (id) => !NAV_CARD_IDENTITY_STEPS.includes(id)
  );

  it("every pre-wizard rung is kind 'progress' on R32's own percent", () => {
    for (const step of preWizard) {
      const model = navCardForStep(step, "DAVID OKAFOR");
      expect(model.kind, step).toBe("progress");
      if (model.kind === "progress") {
        expect(model.percent).toBe(progressPercent(step));
        expect(model.label).toBe(`APPLICATION · ${progressPercent(step)}%`);
      }
    }
  });

  it("an identity passed early never leaks onto a bar-only surface", () => {
    const model = navCardForStep("capture", "DAVID OKAFOR");
    expect(model).not.toHaveProperty("identity");
  });
});

describe("navCardForStep — the wizard zone adds NAME · SIGN OUT", () => {
  it("wizard_1/2/3 + submitted are the identity zone, on 80/90/96/100", () => {
    expect([...NAV_CARD_IDENTITY_STEPS]).toEqual([
      "wizard_1",
      "wizard_2",
      "wizard_3",
      "submitted",
    ]);
    for (const step of NAV_CARD_IDENTITY_STEPS) {
      const model = navCardForStep(step, "DAVID OKAFOR");
      expect(model.kind, step).toBe("progress_identity");
      if (model.kind === "progress_identity") {
        expect(model.percent).toBe(progressPercent(step));
        // Short label beside the identity — the prototype's flowPctShort.
        expect(model.label).toBe(`${progressPercent(step)}%`);
        expect(model.identity).toBe("DAVID OKAFOR");
      }
    }
  });

  it("a missing identity degrades to null, never a stray string", () => {
    const model = navCardForStep("wizard_2", null);
    expect(model.kind).toBe("progress_identity");
    if (model.kind === "progress_identity") expect(model.identity).toBeNull();
  });
});

describe("navCardIdentityOnly — the post-ladder card (next steps / arrival)", () => {
  it("carries no bar, only the identity", () => {
    expect(navCardIdentityOnly("DAVID OKAFOR")).toEqual({
      kind: "identity",
      identity: "DAVID OKAFOR",
    });
    expect(navCardIdentityOnly(null)).toEqual({ kind: "identity", identity: null });
  });
});

describe("navCardIdentityName — the prototype's dashUser", () => {
  it("uppercases the trimmed full name", () => {
    expect(navCardIdentityName("David", "Okafor")).toBe("DAVID OKAFOR");
    expect(navCardIdentityName("  David ", "")).toBe("DAVID");
    expect(navCardIdentityName("", " Okafor ")).toBe("OKAFOR");
  });

  it("nothing usable is null — the card renders SIGN OUT alone", () => {
    expect(navCardIdentityName("", "")).toBeNull();
    expect(navCardIdentityName("   ", " ")).toBeNull();
  });
});

describe("the labels", () => {
  it("full and short formats match the prototype byte for byte", () => {
    expect(navCardLabel(15)).toBe("APPLICATION · 15%");
    expect(navCardShortLabel(96)).toBe("96%");
  });
});

describe("miniAppNavCard — the mini-app delegates, bar-only", () => {
  it("every mini-app step renders the progress card on its own rung", () => {
    for (const step of MINIAPP_STEPS) {
      const model = miniAppNavCard(step);
      expect(model.kind, step).toBe("progress");
      if (model.kind === "progress") {
        expect(model.percent).toBe(progressPercent(step));
      }
    }
  });
});
