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

  it("levels internal separators to a single dash (Jean-Luc → jean-luc)", () => {
    expect(generateUsernameBase("Jean Luc")).toEqual({ ok: true, base: "jean-luc" });
  });

  it("drops elision marks (O'Brien → obrien)", () => {
    expect(generateUsernameBase("O'Brien")).toEqual({ ok: true, base: "obrien" });
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
