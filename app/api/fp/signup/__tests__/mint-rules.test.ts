import { describe, expect, it } from "vitest";
import {
  FP_CHILD_MINT_BODY_KEYS,
  FP_HERO_GENDERS,
  FP_HERO_VIBES,
  FP_MEMORABLE_PASSWORD_PATTERN,
  FP_MEMORABLE_WORDS,
  FP_STORY_LOOK_IDS,
  mintMemorablePassword,
  type FpChildMintBody,
} from "../mint-rules";
import { validateStudentPassword } from "@/app/lib/fp/provision-rules";

/**
 * fpv04 U5a mint rules: the cover vocabulary, the memorable-password minter's
 * shape + floor compatibility, and the pinned child-mint response contract
 * (the FpParentSessionBody key-pin discipline; the SPA's signupApi test
 * carries the twin arrays).
 */

describe("the fpv04 cover vocabulary", () => {
  it("pins the six preset look ids in the SPA's display order (durable persisted keys)", () => {
    expect(FP_STORY_LOOK_IDS).toEqual([
      "storybook-classic",
      "action-issue",
      "saturday-comics",
      "manga-arc",
      "pastel-daydream",
      "night-hero",
    ]);
  });

  it("pins the five hero vibes and the two gender presentations", () => {
    expect(FP_HERO_VIBES).toEqual(["builder", "explorer", "inventor", "captain", "closer"]);
    expect(FP_HERO_GENDERS).toEqual(["boy", "girl"]);
  });
});

describe("the memorable password minter", () => {
  it("mints word-word-NN: two distinct lowercase words plus two digits", () => {
    for (let i = 0; i < 200; i += 1) {
      const pw = mintMemorablePassword();
      expect(pw).toMatch(FP_MEMORABLE_PASSWORD_PATTERN);
      const [a, b] = pw.split("-");
      expect(a).not.toBe(b);
    }
  });

  it("is deterministic under an injected RNG (the impure edge is the parameter)", () => {
    const fixed = mintMemorablePassword(() => 0.5);
    expect(fixed).toBe(mintMemorablePassword(() => 0.5));
    expect(fixed).toMatch(FP_MEMORABLE_PASSWORD_PATTERN);
  });

  it("a stuck RNG still yields two DISTINCT words (the deterministic-neighbor fallback)", () => {
    const pw = mintMemorablePassword(() => 0);
    const [a, b] = pw.split("-");
    expect(a).not.toBe(b);
  });

  it("every mintable password clears the R29 student floor (nameless context)", () => {
    for (let i = 0; i < 200; i += 1) {
      const pw = mintMemorablePassword();
      expect(validateStudentPassword(pw, {}).ok, pw).toBe(true);
    }
  });

  it("wordlist hygiene: 4-8 lowercase ASCII letters, all distinct — pinned so an edit cannot mint un-mintable passwords", () => {
    for (const word of FP_MEMORABLE_WORDS) {
      expect(word, word).toMatch(/^[a-z]{4,8}$/);
    }
    expect(new Set(FP_MEMORABLE_WORDS).size).toBe(FP_MEMORABLE_WORDS.length);
    // Shortest two words + separator + digits still clear the 10-char floor.
    const sorted = [...FP_MEMORABLE_WORDS].sort((a, b) => a.length - b.length);
    expect(sorted[0].length + sorted[1].length + 4).toBeGreaterThanOrEqual(10);
  });
});

describe("FpChildMintBody — the pinned child-mint response contract", () => {
  it("pins the exact key set and order (the SPA mirrors this array)", () => {
    expect(FP_CHILD_MINT_BODY_KEYS).toEqual([
      "ok",
      "status",
      "childId",
      "username",
      "childPassword",
    ]);
  });

  it("a literal in field order satisfies the type and matches the pin", () => {
    const body: FpChildMintBody = {
      ok: true,
      status: "child_created",
      childId: "c1",
      username: "dana.reed@firstprofit.school",
      childPassword: "maple-lantern-42",
    };
    expect(Object.keys(body)).toEqual([...FP_CHILD_MINT_BODY_KEYS]);
  });
});
