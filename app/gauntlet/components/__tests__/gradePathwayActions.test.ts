import { describe, expect, it } from "vitest";
import { topicCardAction } from "../GradePathway";

const base = {
  active: true,
  passed: false,
  secure: false,
  mission: false,
  skillId: "place-value",
  backHref: "/gauntlet/beta" as const,
};

describe("pathway topic card actions", () => {
  it("keeps the grade checkpoint on the grade CTA instead of every topic card", () => {
    expect(topicCardAction(base)).toEqual({
      kind: "details",
      label: "How this is tested",
    });
  });

  it("launches the exact confirmed-gap mission", () => {
    expect(topicCardAction({ ...base, mission: true })).toEqual({
      kind: "link",
      href: "/gauntlet/beta?play=mission&skill=place-value",
      label: "Beat this boss",
    });
  });

  it("offers exact practice for a secure topic", () => {
    expect(topicCardAction({ ...base, secure: true })).toEqual({
      kind: "link",
      href: "/gauntlet/beta?play=practice&skill=place-value",
      label: "Practice",
    });
  });

  it("does not make locked topics interactive", () => {
    expect(topicCardAction({ ...base, active: false })).toEqual({
      kind: "none",
      label: "Locked",
    });
  });
});
