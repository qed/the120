import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PhaseKey } from "@/app/fp/content/types";
import { PHASES, phaseByKey, phaseColor, phaseColorAlpha } from "../phases";

const KEYS: PhaseKey[] = ["SELL", "BUILD", "VALIDATE", "GROW", "SCALE"];

describe("phases (design-system metadata)", () => {
  it("declares the five phases in order with 1-based indices, name mirroring key", () => {
    expect(PHASES.map((p) => p.key)).toEqual(KEYS);
    expect(PHASES.map((p) => p.index)).toEqual([1, 2, 3, 4, 5]);
    for (const p of PHASES) expect(p.name).toBe(p.key);
  });

  it("phaseByKey returns populated metadata for every key", () => {
    for (const k of KEYS) {
      const meta = phaseByKey(k);
      expect(meta.key).toBe(k);
      expect(meta.tagline.length).toBeGreaterThan(0);
      expect(meta.territory.length).toBeGreaterThan(0);
    }
  });

  it("phaseColor resolves each phase to its channel-backed hsl() var", () => {
    expect(phaseColor("SELL")).toBe("hsl(var(--phase-sell))");
    expect(phaseColor("BUILD")).toBe("hsl(var(--phase-build))");
    expect(phaseColor("VALIDATE")).toBe("hsl(var(--phase-validate))");
    expect(phaseColor("GROW")).toBe("hsl(var(--phase-grow))");
    expect(phaseColor("SCALE")).toBe("hsl(var(--phase-scale))");
  });

  it("phaseColorAlpha composes alpha into the hsl() var (valid CSS, not a hex append)", () => {
    // The prototype's `${hexColor}22` alpha-append is invalid once the color is an
    // hsl() value; this is the faithful, valid replacement.
    expect(phaseColorAlpha("SELL", 0.13)).toBe("hsl(var(--phase-sell) / 0.13)");
    expect(phaseColorAlpha("SCALE", 1)).toBe("hsl(var(--phase-scale) / 1)");
    expect(phaseColorAlpha("GROW", 0)).toBe("hsl(var(--phase-grow) / 0)");
  });

  // Closes the phases.ts <-> globals.css coupling the reviewers flagged as
  // untested: phaseColor emits `hsl(var(--phase-*))`, and those channel variables
  // must actually be declared in the stylesheet or the color silently resolves to
  // nothing at runtime. A rename on either side fails here instead of on screen.
  it("every --phase-* channel phaseColor references is declared in globals.css", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    for (const k of KEYS) {
      const varRef = phaseColor(k).replace(/^hsl\(var\(/, "").replace(/\)\)$/, "");
      expect(varRef).toMatch(/^--phase-[a-z]+$/);
      expect(css).toContain(`${varRef}:`);
    }
  });
});
