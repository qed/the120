import { describe, expect, it } from "vitest";
import { criteriaFor } from "../path-criteria";
import { pathSteps, pathStepsKid } from "../data";
import type { Audience } from "../cta-source";

describe("criteriaFor — Path criteria voice selection", () => {
  it("kids + KID VOICE returns the kid-voiced phases (pathStepsKid)", () => {
    expect(criteriaFor("kids", true)).toBe(pathStepsKid);
  });

  it("kids + ORIGINAL returns the original phases (pathSteps)", () => {
    expect(criteriaFor("kids", false)).toBe(pathSteps);
  });

  it("parents always returns the original phases, for either kidVoice value", () => {
    expect(criteriaFor("parents", true)).toBe(pathSteps);
    expect(criteriaFor("parents", false)).toBe(pathSteps);
  });

  it("every returned phase has exactly 5 criteria in every state", () => {
    const audiences: Audience[] = ["parents", "kids"];
    for (const audience of audiences) {
      for (const kidVoice of [true, false]) {
        const phases = criteriaFor(audience, kidVoice);
        expect(phases).toHaveLength(5);
        for (const phase of phases) {
          expect(phase.criteria).toHaveLength(5);
        }
      }
    }
  });
});
