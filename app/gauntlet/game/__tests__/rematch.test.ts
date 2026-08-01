import { describe, expect, it } from "vitest";
import { rematchKeysFromResults } from "../rematch";

describe("Fix My Misses deck", () => {
  it("puts misses first, deduplicates, then adds the slowest facts", () => {
    expect(
      rematchKeysFromResults([
        { key: "mul:7×8", ms: 900, correct: false },
        { key: "mul:7×8", ms: 800, correct: false },
        { key: "add:4+9", ms: 8_000, correct: true },
        { key: "sub:12−5", ms: 7_000, correct: true },
        { key: "mul:2×3", ms: 500, correct: true },
      ])
    ).toEqual(["mul:7×8", "add:4+9", "sub:12−5"]);
  });

  it("drops malformed fact keys and respects the cap", () => {
    expect(
      rematchKeysFromResults(
        [
          { key: "bad", ms: 10_000, correct: false },
          { key: "mul:2×3", ms: 10_000, correct: false },
          { key: "mul:3×4", ms: 10_000, correct: false },
        ],
        1
      )
    ).toEqual(["mul:2×3"]);
  });
});
