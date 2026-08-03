import { describe, expect, it } from "vitest";
import type { Problem } from "../../game/problems";
import { placementDeadlineMs } from "../PlacementTrial";

function problem(topic: Problem["topic"]): Problem {
  return {
    topic,
    key: `${topic}:test`,
    prompt: "Test",
    answer: "1",
    kind: "numeric",
  };
}

describe("placement timing", () => {
  it("gives full midpoint coordinate work a twenty-second checkpoint window", () => {
    expect(placementDeadlineMs(problem("midpoint"))).toBe(20_000);
  });

  it("gives young readers at least ten seconds even on recall anchors", () => {
    expect(placementDeadlineMs(problem("mul"))).toBe(10_000);
  });
});
