import { describe, expect, it } from "vitest";
import {
  challengeDeckFromResults,
  encodeChallenge,
  parseChallenge,
} from "../challenge";
import { canonicalProblemFromKey } from "../problems";

const skills = ["mul", "sub"];

describe("gauntlet friend challenges", () => {
  it("round-trips a fixed deck, including unicode fact keys", () => {
    const deck = challengeDeckFromResults([
      { key: "mul:7×8", encounter: "quickfire" },
      { key: "sub:12−5", encounter: "quickfire" },
    ]);
    const encoded = encodeChallenge({
      skillId: "mul",
      level: 3,
      time: 42,
      handle: "RIVAL-7",
      deck,
    });

    expect(parseChallenge(encoded, skills, 5, 120)).toEqual({
      skillId: "mul",
      level: 3,
      time: 42,
      handle: "RIVAL-7",
      deck,
    });
  });

  it("keeps versionless challenge links playable", () => {
    const oldLink = btoa(JSON.stringify({ s: "mul", l: 2, t: 31, h: "old rival" }));
    expect(parseChallenge(oldLink, skills, 5, 120)).toEqual({
      skillId: "mul",
      level: 2,
      time: 31,
      handle: "OLDRIVAL",
    });
  });

  it("rejects a v2 link whose supposedly fair deck was tampered with", () => {
    const encoded = encodeChallenge({
      skillId: "mul",
      level: 1,
      time: 20,
      deck: [{ key: "not-a-fact", encounter: "quickfire" }],
    });
    expect(parseChallenge(encoded, skills, 5, 120)).toBeNull();
  });

  it("rebuilds stable prompts and choices from the same key", () => {
    expect(canonicalProblemFromKey("mul:7×8")).toEqual(
      canonicalProblemFromKey("mul:7×8")
    );
    expect(canonicalProblemFromKey("congruence:SSS")).toEqual(
      canonicalProblemFromKey("congruence:SSS")
    );
  });
});
