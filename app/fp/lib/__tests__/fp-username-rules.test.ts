import { describe, expect, it } from "vitest";
import {
  generateUsernameBase,
  mintUsername,
  pickUniqueUsername,
  USERNAME_FALLBACK_BASE,
  MAX_USERNAME_ATTEMPTS,
} from "../fp-username-rules";

/**
 * The pure username decisions (Slice B Unit 12): fold+slug base derivation, the
 * numeric suffixer, and the shared generate-if-missing primitive. No DB.
 */

describe("generateUsernameBase — fold + slug", () => {
  it("lowercases and slugs a plain first name", () => {
    expect(generateUsernameBase("Alex")).toEqual({ ok: true, base: "alex" });
  });

  it("folds diacritics to ASCII (Álex → alex)", () => {
    expect(generateUsernameBase("Álex")).toEqual({ ok: true, base: "alex" });
  });

  it("folds an undecomposable Latin letter (Weiß → weiss)", () => {
    expect(generateUsernameBase("Weiß")).toEqual({ ok: true, base: "weiss" });
  });

  it("STRIPS internal separators for the username namespace (Jean Luc → jeanluc)", () => {
    // The shared FW slugger levels separators to a DASH (jean-luc), valid for the
    // .fw@ ADDRESS path; the username path strips them so the result stays inside
    // `^[a-z0-9]+$` (the CHECK / index / login namespace). No dash survives.
    expect(generateUsernameBase("Jean Luc")).toEqual({ ok: true, base: "jeanluc" });
  });

  it("STRIPS a hyphen too (Anna-Lee → annalee), not a dash", () => {
    expect(generateUsernameBase("Anna-Lee")).toEqual({ ok: true, base: "annalee" });
  });

  it("collapses a multi-word name to alnum-only (Mary Jane → maryjane)", () => {
    expect(generateUsernameBase("Mary Jane")).toEqual({ ok: true, base: "maryjane" });
  });

  it("drops elision marks (O'Brien → obrien)", () => {
    expect(generateUsernameBase("O'Brien")).toEqual({ ok: true, base: "obrien" });
  });

  it("fails closed (verdict, not throw) on a name that is ONLY separators/punctuation", () => {
    // buildFwLocalBaseFromFirstName folds "- -" to nothing (throws → underivable);
    // even a name that folds to a bare dash strips to "" here → underivable, so
    // mintUsername applies the `student` fallback rather than minting an empty base.
    const v = generateUsernameBase("- -");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("underivable");
  });

  it("fails closed (verdict, not throw) on an empty first name", () => {
    const v = generateUsernameBase("");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("underivable");
  });

  it("fails closed on an all-emoji / no-address-safe first name", () => {
    const v = generateUsernameBase("🙂🙂");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("underivable");
  });

  it("fails closed on a non-Latin (homoglyph-risk) script rather than silently mangling", () => {
    // Cyrillic а — the fold guard refuses instead of minting a near-miss.
    const v = generateUsernameBase("Мая");
    expect(v.ok).toBe(false);
  });
});

describe("pickUniqueUsername — suffixer (alex → alex2 → alex3)", () => {
  it("returns the bare base when nothing is taken", () => {
    expect(pickUniqueUsername({ base: "alex", isTaken: () => false })).toEqual({
      ok: true,
      username: "alex",
      attempt: 1,
    });
  });

  it("walks to the next numeric suffix until free (starts at 2)", () => {
    const taken = new Set(["alex", "alex2"]);
    expect(pickUniqueUsername({ base: "alex", isTaken: (c) => taken.has(c) })).toEqual({
      ok: true,
      username: "alex3",
      attempt: 3,
    });
  });

  it("exhausts loudly after MAX_USERNAME_ATTEMPTS", () => {
    const res = pickUniqueUsername({ base: "alex", isTaken: () => true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("exhausted");
  });

  it("the exhaustion bound matches MAX_USERNAME_ATTEMPTS", () => {
    // Take every candidate except attempt MAX; that one must still be found.
    const taken = new Set<string>(["alex"]);
    for (let i = 2; i < MAX_USERNAME_ATTEMPTS; i += 1) taken.add(`alex${i}`);
    const res = pickUniqueUsername({ base: "alex", isTaken: (c) => taken.has(c) });
    expect(res).toEqual({ ok: true, username: `alex${MAX_USERNAME_ATTEMPTS}`, attempt: MAX_USERNAME_ATTEMPTS });
  });
});

describe("mintUsername — generate-if-missing (fallback on unfoldable)", () => {
  it("derives and picks the clean handle for a normal name", () => {
    expect(mintUsername({ firstName: "Alex", isTaken: () => false })).toEqual({
      ok: true,
      username: "alex",
      base: "alex",
      attempt: 1,
      usedFallback: false,
    });
  });

  it("falls back to the 'student' base for an unfoldable name (child never blocked)", () => {
    const res = mintUsername({ firstName: "🙂", isTaken: () => false });
    expect(res).toEqual({
      ok: true,
      username: USERNAME_FALLBACK_BASE,
      base: USERNAME_FALLBACK_BASE,
      attempt: 1,
      usedFallback: true,
    });
  });

  it("suffixes the fallback base too when 'student' is taken", () => {
    const taken = new Set([USERNAME_FALLBACK_BASE]);
    const res = mintUsername({ firstName: "", isTaken: (c) => taken.has(c) });
    expect(res).toMatchObject({ ok: true, username: `${USERNAME_FALLBACK_BASE}2`, usedFallback: true });
  });

  it("suffixes a real base past a collision", () => {
    const taken = new Set(["alex"]);
    expect(mintUsername({ firstName: "Alex", isTaken: (c) => taken.has(c) })).toMatchObject({
      ok: true,
      username: "alex2",
      usedFallback: false,
    });
  });
});

/* ------------------------------------------------------------- SEAM regression */

describe("generator === CHECK === unique index === login namespace (^[a-z0-9]+$)", () => {
  // The exact regexes the generator's output must satisfy, replicated from their
  // sources so a drift in EITHER end trips this test (the per-unit generator tests
  // above never checked output against the DB CHECK or the login regex — that gap
  // let the dash-leveling P0 through):
  //   - login  app/api/fp/login/login-rules.ts   `const USERNAME_FORMAT = /^[a-z0-9]+$/`
  //   - storage supabase/migrations/20260831120000_fp_children_username.sql
  //             CHECK (fp_username ~ '^[a-z0-9]+$') + unique index lower(fp_username)
  const LOGIN_USERNAME_FORMAT = /^[a-z0-9]+$/;
  const DB_CHECK_FORMAT = /^[a-z0-9]+$/;

  // A spread that previously produced a dash (multi-word, hyphenated), an elision
  // mark (apostrophe), a diacritic (accented), and leading/internal/trailing
  // whitespace — every separator class the FW slugger levels to a dash.
  const names = ["Mary Jane", "Anna-Lee", "O'Brien", "José", "Lily  Rose  ", "Jean-Luc van der Berg"];

  it("generateUsernameBase output ALWAYS matches BOTH the login regex and the DB CHECK", () => {
    for (const name of names) {
      const v = generateUsernameBase(name);
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect(v.base).toMatch(LOGIN_USERNAME_FORMAT);
        expect(v.base).toMatch(DB_CHECK_FORMAT);
      }
    }
  });

  it("mintUsername output (base AND final username, incl. suffix) ALWAYS matches both regexes", () => {
    // Suffix the first pick so the collision path is exercised too — a numeric
    // suffix must not break `^[a-z0-9]+$` either.
    for (const name of names) {
      const taken = new Set<string>();
      for (let i = 0; i < 3; i += 1) {
        const mint = mintUsername({ firstName: name, isTaken: (c) => taken.has(c) });
        expect(mint.ok).toBe(true);
        if (mint.ok) {
          expect(mint.username).toMatch(LOGIN_USERNAME_FORMAT);
          expect(mint.username).toMatch(DB_CHECK_FORMAT);
          expect(mint.base).toMatch(LOGIN_USERNAME_FORMAT);
          taken.add(mint.username.toLowerCase());
        }
      }
    }
  });

  it("the specific P0 cases land on their alnum-only handles", () => {
    expect(mintUsername({ firstName: "Mary Jane", isTaken: () => false })).toMatchObject({
      ok: true,
      username: "maryjane",
      usedFallback: false,
    });
    expect(mintUsername({ firstName: "Anna-Lee", isTaken: () => false })).toMatchObject({
      ok: true,
      username: "annalee",
      usedFallback: false,
    });
  });

  it("a separators-only first name falls back to `student` (never an empty/invalid handle)", () => {
    const mint = mintUsername({ firstName: "- -", isTaken: () => false });
    expect(mint).toMatchObject({ ok: true, username: USERNAME_FALLBACK_BASE, usedFallback: true });
    if (mint.ok) expect(mint.username).toMatch(LOGIN_USERNAME_FORMAT);
  });
});
