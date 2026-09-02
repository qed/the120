import { describe, expect, it } from "vitest";
import { buildProgressFixture } from "../gen-fp-progress-fixture";

function generate(): string {
  return `${JSON.stringify(buildProgressFixture(), null, 2)}\n`;
}

describe("First Profit progress cross-repo fixture generator", () => {
  it("is deterministic and carries the versioned analytics cohort contract", () => {
    const first = generate();
    expect(generate()).toBe(first);
    const parsed = JSON.parse(first) as {
      ok: boolean;
      children: unknown[];
      analyticsScope?: {
        revision: string;
        includedFamilies: number;
        excludedFamilies: number;
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.children).toHaveLength(6);
    expect(parsed.analyticsScope).toEqual({
      revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      includedFamilies: 5,
      excludedFamilies: 1,
    });
  });
});
