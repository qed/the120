import { describe, expect, it } from "vitest";
import { validateStudentPassword } from "@/app/lib/fp/provision-rules";
import {
  buildChildPassword,
  candidateWords,
  CHILD_PASSWORD_PREFIX,
  FALLBACK_PASSWORD_WORDS,
  STORY_STOP_WORDS,
} from "../credentials-rules";

/**
 * The v3 kid-credential decisions (plan Unit 3). Randomness is injected, so
 * "per-kid random" is an assertion here rather than a hope.
 */

/** A deterministic `[0,1)` stream — the test's stand-in for the CSPRNG. */
const stream = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

describe("word extraction", () => {
  it("prefers `matters`, then `intro`, and skips stop words and short words", () => {
    expect(candidateWords({ matters: "I like soccer a lot" })[0]).toBe("soccer");
    // "like" is a stop word, "a"/"lot" are short/stopped, so the first real
    // candidate is soccer. ("name" is stopped too; "bake" is the first keeper.)
    expect(candidateWords({ intro: "My name is Ada and I bake bread" })[0]).toBe("bake");
    // matters wins over intro even when intro comes first in the object.
    expect(
      candidateWords({ intro: "I love baking", matters: "soccer matters most" })[0]
    ).toBe("soccer");
  });

  it("falls through to any other answered question when the priority ones are blank", () => {
    expect(candidateWords({ somethingNew: "geology forever" })[0]).toBe("geology");
  });

  it("returns nothing for an empty sheet", () => {
    expect(candidateWords({})).toEqual([]);
    expect(candidateWords(null)).toEqual([]);
    expect(candidateWords({ matters: "  " })).toEqual([]);
  });

  it("the stop list contains the prototype's originals", () => {
    for (const w of ["my", "the", "a", "an", "i", "we", "and", "for"]) {
      expect(STORY_STOP_WORDS.has(w), w).toBe(true);
    }
  });
});

describe("the happy path — iloveschool<word> from the child's own answers", () => {
  it("builds from the answer and passes validateStudentPassword", () => {
    const built = buildChildPassword({
      childName: "Remi Newal",
      answers: { matters: "Soccer matters a lot to me" },
      random: stream(0),
    });
    expect(built).toMatchObject({ source: "answers", word: "soccer" });
    expect(built.password).toBe(`${CHILD_PASSWORD_PREFIX}soccer`);
    expect(validateStudentPassword(built.password, { studentName: "Remi Newal" }).ok).toBe(true);
  });

  it("skips a word that would embed the kid's FIRST name and takes the next one", () => {
    // "remington" contains "remi" — validateStudentPassword refuses it, and the
    // next usable word in the same answer is taken.
    const built = buildChildPassword({
      childName: "Remi Newal",
      answers: { matters: "remington rifles and pancakes" },
      random: stream(0),
    });
    expect(built.source).toBe("answers");
    expect(built.word).toBe("rifles");
    expect(built.password.includes("remi")).toBe(false);
  });

  it("skips a word that would embed the kid's LAST name — stricter than createChild's own check", () => {
    // createChild validates against the FIRST name only; this module passes the
    // full name, so a surname word is refused here.
    const built = buildChildPassword({
      childName: "Remi Newal",
      answers: { matters: "newalness is great, also pancakes" },
      random: stream(0),
    });
    expect(built.password.includes("newal")).toBe(false);
  });

  it("skips a denylisted word (the floor's list, never re-implemented here)", () => {
    const built = buildChildPassword({
      childName: "Sam Okafor",
      answers: { matters: "password, cycling" },
      random: stream(0),
    });
    expect(built.word).toBe("cycling");
  });
});

/* ---------------- the vocabulary itself (whole-branch review, finding 4) --- */

describe("the fallback vocabulary", () => {
  /**
   * The list IS the entropy. `iloveschool` is a fixed, public prefix and the
   * username is deterministic and derivable, so for any child on the fallback
   * branch the number of candidate passwords is exactly the number of words
   * here. It shipped at THIRTY. These rows re-derive every rule the constant's
   * docblock states, so a future addition that breaks one fails the build
   * instead of a family.
   */

  it("is several hundred words, not a rounding error", () => {
    // The floor, not the count: adding words must never require editing this.
    // 30 (what shipped) must fail it; a few hundred must pass.
    expect(FALLBACK_PASSWORD_WORDS.length).toBeGreaterThanOrEqual(250);
  });

  it("has no duplicates — a repeat is silent entropy loss, not a typo", () => {
    expect(new Set(FALLBACK_PASSWORD_WORDS).size).toBe(FALLBACK_PASSWORD_WORDS.length);
  });

  it("is lowercase a-z only, 4-12 letters — typeable by an eight-year-old", () => {
    for (const w of FALLBACK_PASSWORD_WORDS) {
      expect(w, w).toMatch(/^[a-z]{4,12}$/);
    }
  });

  it("EVERY word yields a password the mint accepts — the whole point of the list", () => {
    for (const w of FALLBACK_PASSWORD_WORDS) {
      const verdict = validateStudentPassword(`${CHILD_PASSWORD_PREFIX}${w}`, {
        studentName: "Sam Okafor",
      });
      expect(verdict.ok, `${CHILD_PASSWORD_PREFIX}${w}: ${verdict.ok ? "" : verdict.error}`).toBe(
        true
      );
    }
  });

  it("carries nothing that reads badly against the fixed prefix", () => {
    // Rule 6 in the constant's docblock. Innocent words are excluded on the
    // strength of a substring alone (`button`, `classroom`, `poodle`), because
    // the family reads `iloveschool<word>` as one string.
    const forbiddenSubstrings = ["ass", "butt", "hell", "poo", "cock", "tit", "damn", "crap"];
    const grandfathered = new Set(["compass"]); // shipped in the original thirty
    for (const w of FALLBACK_PASSWORD_WORDS) {
      if (grandfathered.has(w)) continue;
      for (const bad of forbiddenSubstrings) {
        expect(w.includes(bad), `${w} contains "${bad}"`).toBe(false);
      }
    }
  });

  it("carries no known homophone trap — a misspelled password is a lockout", () => {
    // Rule 5. Not exhaustive English, and it cannot be: this is the standing
    // list of pairs a child hears and spells the other way, and it is the place
    // to add one the day a family reports it.
    const traps = [
      "bear", "bare", "flour", "flower", "sail", "sale", "steel", "steal",
      "brake", "break", "week", "weak", "right", "write", "whole", "hole",
      "meat", "meet", "pear", "pair", "tail", "tale", "deer", "dear", "mail",
      "male", "peace", "piece", "plane", "plain", "road", "rode", "wait",
      "weight", "which", "witch", "wood", "would", "board", "bored", "beach",
      "beech", "cereal", "serial", "currant", "current", "principal",
      "principle", "root", "route", "scene", "seen", "vain", "vein",
      "weather", "whether", "stair", "stare", "waist", "waste", "heal",
      "heel", "knight", "night", "berry", "bury", "colour", "favourite",
    ];
    for (const trap of traps) {
      expect(FALLBACK_PASSWORD_WORDS, trap).not.toContain(trap);
    }
  });
});

describe("the fallback is PER KID, never one shared constant", () => {
  it("all answers skipped → a random word, still valid", () => {
    const built = buildChildPassword({
      childName: "Remi Newal",
      answers: {},
      random: stream(0),
    });
    expect(built.source).toBe("random_word");
    expect(FALLBACK_PASSWORD_WORDS).toContain(built.word);
    expect(validateStudentPassword(built.password, { studentName: "Remi Newal" }).ok).toBe(true);
  });

  it("two kids with different streams get DIFFERENT words — the shared-constant regression", () => {
    const a = buildChildPassword({ childName: "Ada Lin", answers: {}, random: stream(0) });
    const b = buildChildPassword({ childName: "Bo Lin", answers: {}, random: stream(0.5) });
    expect(a.source).toBe("random_word");
    expect(b.source).toBe("random_word");
    expect(a.password).not.toBe(b.password);
  });

  it("the draw spans the whole list — not one hot value the offset always lands on", () => {
    // A deliberately SYNTHETIC control name. Any real name shares letters with
    // some of the several hundred words, and each such word is (correctly)
    // refused and replaced by its rotation neighbour — which would show up here
    // as a collision and hide the property under test. `Zjq Wvx` overlaps
    // nothing, so a missing word can only mean the DRAW never reached it.
    const NEUTRAL = "Zjq Wvx";
    const seen = new Set<string>();
    for (let i = 0; i < FALLBACK_PASSWORD_WORDS.length; i += 1) {
      // Mid-bucket, not the bucket edge: `drawIndex` multiplies the draw back
      // out by the list length, and at several hundred words the edge value
      // `i/n` lands one below its own bucket for a handful of `i` purely from
      // float rounding. `(i+0.5)/n` asks the question the test means to ask —
      // does every index in the list get drawn — without testing IEEE 754.
      const draw = (i + 0.5) / FALLBACK_PASSWORD_WORDS.length;
      seen.add(
        buildChildPassword({ childName: NEUTRAL, answers: {}, random: stream(draw) }).word!
      );
    }
    expect(seen.size).toBe(FALLBACK_PASSWORD_WORDS.length);
  });

  it("a name that poisons the PREFIX itself falls all the way to a passphrase", () => {
    // "school" is inside `iloveschool`, so EVERY prefixed candidate is refused.
    const built = buildChildPassword({
      childName: "School Smith",
      answers: { matters: "pancakes" },
      random: stream(0.1),
    });
    expect(built.source).toBe("random_passphrase");
    expect(built.password.includes(CHILD_PASSWORD_PREFIX)).toBe(false);
    expect(validateStudentPassword(built.password, { studentName: "School Smith" }).ok).toBe(true);
  });

  it("is TOTAL: every shape it can return clears the student password floor", () => {
    const names = ["Remi Newal", "School Smith", "Love Wang", "Al Bo", "Zoë Ó Súilleabháin"];
    for (const name of names) {
      for (const draw of [0, 0.25, 0.5, 0.75, 0.99]) {
        const built = buildChildPassword({ childName: name, answers: {}, random: stream(draw) });
        expect(validateStudentPassword(built.password, { studentName: name }).ok, `${name}/${draw}`).toBe(
          true
        );
      }
    }
  });

  it("a non-finite random draw does not throw and still yields a valid password", () => {
    const built = buildChildPassword({
      childName: "Ada Lin",
      answers: {},
      random: () => Number.NaN,
    });
    expect(validateStudentPassword(built.password, { studentName: "Ada Lin" }).ok).toBe(true);
  });
});

/* -------------------- the last resort is validated too (review FIX 10a) */

describe("the exhaustive fallback", () => {
  /** A name whose tokens are the ENTIRE fallback vocabulary. Absurd as a name,
   *  and precisely the shape that poisons every prefixed candidate AND every
   *  triple the fixed +7/+13 rotation would try. Nothing shorter reaches the
   *  branch that used to return an UNVALIDATED four-word join. */
  const poisonAll = FALLBACK_PASSWORD_WORDS.join(" ");

  it("reaches the last resort and THROWS a labelled invariant rather than returning an invalid credential", () => {
    // The old code path returned `pool[0]-pool[1]-pool[2]-pool[3]` here without
    // ever calling validateStudentPassword, on the argument that it was
    // unreachable. It is reachable, and what it returned was a password
    // `createChild` would refuse as `weak_password` — on the one screen where a
    // family can do nothing about it.
    let thrown: unknown;
    try {
      buildChildPassword({ childName: poisonAll, answers: {}, random: () => 0 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("[v3/credentials] INVARIANT");
    // The message is a log line: no name, no password.
    expect((thrown as Error).message).not.toContain(FALLBACK_PASSWORD_WORDS[0]);
  });

  it("keeps deriving past the rotation: a name poisoning the rotation's triples still gets a VALID passphrase", () => {
    // Poison the whole prefixed shape ("school") plus the three words the
    // rotation's first triple would have used, so the answer must come from the
    // exhaustive search rather than the +7/+13 stride.
    const pool = FALLBACK_PASSWORD_WORDS;
    const name = ["school", pool[0], pool[7], pool[13]].join(" ");
    const built = buildChildPassword({ childName: name, answers: {}, random: () => 0 });
    expect(built.source).toBe("random_passphrase");
    expect(validateStudentPassword(built.password, { studentName: name }).ok).toBe(true);
    // ... and it is a real derivation, not the old unvalidated four-word join.
    expect(built.password.split("-")).toHaveLength(3);
  });
});
