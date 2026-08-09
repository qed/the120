import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyIdentifier } from "@/app/api/fp/login/login-rules";
import {
  appendUsernameSuffix,
  FP_USERNAME_DOMAIN,
  generateUsernameBase,
  generateUsernameLocalPart,
  MAX_USERNAME_LOCAL_LENGTH,
  mintUsername,
  mintUsernameFromNames,
  pickUniqueUsername,
  USERNAME_FALLBACK_BASE,
  usernameLocalPart,
  withUsernameDomain,
  MAX_USERNAME_ATTEMPTS,
} from "../fp-username-rules";

/** fpv03 U3c: every MINTED handle is email-shaped — `<local>@firstprofit.school`. */
const AT = `@${FP_USERNAME_DOMAIN}`;

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

describe("mintUsername — generate-if-missing (email-shaped since fpv03 U3c)", () => {
  it("derives and picks the clean email-shaped handle for a normal name", () => {
    expect(mintUsername({ firstName: "Alex", isTaken: () => false })).toEqual({
      ok: true,
      username: `alex${AT}`,
      base: `alex${AT}`,
      attempt: 1,
      usedFallback: false,
    });
  });

  it("falls back to the 'student' base for an unfoldable name (child never blocked)", () => {
    const res = mintUsername({ firstName: "🙂", isTaken: () => false });
    expect(res).toEqual({
      ok: true,
      username: `${USERNAME_FALLBACK_BASE}${AT}`,
      base: `${USERNAME_FALLBACK_BASE}${AT}`,
      attempt: 1,
      usedFallback: true,
    });
  });

  it("suffixes the fallback base too when 'student' is taken — digits BEFORE the @", () => {
    const taken = new Set([`${USERNAME_FALLBACK_BASE}${AT}`]);
    const res = mintUsername({ firstName: "", isTaken: (c) => taken.has(c) });
    expect(res).toMatchObject({
      ok: true,
      username: `${USERNAME_FALLBACK_BASE}2${AT}`,
      usedFallback: true,
    });
  });

  it("suffixes a real base past a collision — digits BEFORE the @", () => {
    const taken = new Set([`alex${AT}`]);
    expect(mintUsername({ firstName: "Alex", isTaken: (c) => taken.has(c) })).toMatchObject({
      ok: true,
      username: `alex2${AT}`,
      usedFallback: false,
    });
  });
});

describe("withUsernameDomain / usernameLocalPart (fpv03 U3c)", () => {
  it("appends the fixed domain", () => {
    expect(withUsernameDomain("remi.newal")).toBe(`remi.newal${AT}`);
  });

  it("bounds the local part and never leaves it ending on punctuation after the cut", () => {
    const long = `${"a".repeat(MAX_USERNAME_LOCAL_LENGTH - 1)}.zzzz`;
    const out = withUsernameDomain(long);
    const local = out.slice(0, out.indexOf("@"));
    expect(local.length).toBeLessThanOrEqual(MAX_USERNAME_LOCAL_LENGTH);
    expect(local).toMatch(/[a-z0-9]$/);
    // Total stays under the storage CHECK's 80 even with suffix headroom.
    expect(out.length + 3).toBeLessThanOrEqual(80);
  });

  it("usernameLocalPart strips the domain and passes a plain handle through", () => {
    expect(usernameLocalPart(`remi.newal${AT}`)).toBe("remi.newal");
    expect(usernameLocalPart("remi.newal")).toBe("remi.newal");
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

  // The MINTED handle is email-shaped since fpv03 U3c; its LOCAL PART must
  // still be the alnum-only slug (dot-joined), and the whole handle must fit
  // the broadened (email-shaped) acceptors — asserted by the nesting-invariant
  // block below against the real classifyIdentifier + migration CHECK.
  it("mintUsername output's LOCAL PART (incl. suffix) always matches the strict slug shape", () => {
    for (const name of names) {
      const taken = new Set<string>();
      for (let i = 0; i < 3; i += 1) {
        const mint = mintUsername({ firstName: name, isTaken: (c) => taken.has(c) });
        expect(mint.ok).toBe(true);
        if (mint.ok) {
          expect(mint.username.endsWith(AT)).toBe(true);
          expect(usernameLocalPart(mint.username)).toMatch(/^[a-z0-9]+$/);
          taken.add(mint.username.toLowerCase());
        }
      }
    }
  });

  it("the specific P0 cases land on their alnum-only local parts", () => {
    expect(mintUsername({ firstName: "Mary Jane", isTaken: () => false })).toMatchObject({
      ok: true,
      username: `maryjane${AT}`,
      usedFallback: false,
    });
    expect(mintUsername({ firstName: "Anna-Lee", isTaken: () => false })).toMatchObject({
      ok: true,
      username: `annalee${AT}`,
      usedFallback: false,
    });
  });

  it("a separators-only first name falls back to `student` (never an empty/invalid handle)", () => {
    const mint = mintUsername({ firstName: "- -", isTaken: () => false });
    expect(mint).toMatchObject({
      ok: true,
      username: `${USERNAME_FALLBACK_BASE}${AT}`,
      usedFallback: true,
    });
  });
});

/* ==========================================================================
   New User Flow v3, Unit 3 — the TWO-NAME variant (`remi.newal`)
   ========================================================================== */

describe("generateUsernameLocalPart — firstname.lastname", () => {
  it("joins the two slugged names with a single dot", () => {
    expect(generateUsernameLocalPart("Remi", "Newal")).toEqual({ ok: true, base: "remi.newal" });
    expect(generateUsernameLocalPart("Álex", "Ó Súilleabháin")).toEqual({
      ok: true,
      base: "alex.osuilleabhain",
    });
  });

  it("DEGRADES to the first name alone when the last name is absent or underivable — never `remi.`", () => {
    for (const last of [undefined, null, "", "   ", "- -", "🙂"]) {
      expect(generateUsernameLocalPart("Remi", last)).toEqual({ ok: true, base: "remi" });
    }
  });

  it("refuses only on an underivable FIRST name, so mintUsernameFromNames can fall back", () => {
    const v = generateUsernameLocalPart("- -", "Newal");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("underivable");
  });
});

describe("mintUsernameFromNames — collision suffix BEFORE the @", () => {
  it("first kid gets the clean handle, the next gets the numeric suffix before the @", () => {
    const taken = new Set<string>();
    const first = mintUsernameFromNames({
      firstName: "Remi",
      lastName: "Newal",
      isTaken: (c) => taken.has(c),
    });
    expect(first).toMatchObject({ ok: true, username: `remi.newal${AT}`, attempt: 1 });
    if (first.ok) taken.add(first.username);

    const second = mintUsernameFromNames({
      firstName: "Remi",
      lastName: "Newal",
      isTaken: (c) => taken.has(c),
    });
    expect(second).toMatchObject({ ok: true, username: `remi.newal2${AT}`, attempt: 2 });
    if (second.ok) taken.add(second.username);

    const third = mintUsernameFromNames({
      firstName: "Remi",
      lastName: "Newal",
      isTaken: (c) => taken.has(c),
    });
    expect(third).toMatchObject({ ok: true, username: `remi.newal3${AT}` });
  });

  it("NFKC/diacritic fold carries through to the email-shaped handle", () => {
    expect(
      mintUsernameFromNames({ firstName: "Álex", lastName: "Ó Súilleabháin", isTaken: () => false })
    ).toMatchObject({ ok: true, username: `alex.osuilleabhain${AT}` });
  });

  it("`underivable` first name keeps the `student` base through the two-name variant", () => {
    const mint = mintUsernameFromNames({
      firstName: "- -",
      lastName: "Newal",
      isTaken: () => false,
    });
    expect(mint).toMatchObject({
      ok: true,
      username: `${USERNAME_FALLBACK_BASE}${AT}`,
      usedFallback: true,
    });
  });

  it("is byte-identical to mintUsername when no last name is supplied", () => {
    for (const name of ["Mary Jane", "Anna-Lee", "José", "- -"]) {
      const a = mintUsername({ firstName: name, isTaken: () => false });
      const b = mintUsernameFromNames({ firstName: name, isTaken: () => false });
      expect(b).toEqual(a);
    }
  });

  it("appendUsernameSuffix places the digits BEFORE an @ when the base is email-shaped", () => {
    // No generator emits an `@` today, but the storage CHECK and login regex both
    // ADMIT email-shaped handles, so the suffixer must not turn one into a
    // different address.
    expect(appendUsernameSuffix("cedric@firstprofit.school", 1)).toBe("cedric@firstprofit.school");
    expect(appendUsernameSuffix("cedric@firstprofit.school", 2)).toBe("cedric2@firstprofit.school");
    expect(appendUsernameSuffix("remi.newal", 2)).toBe("remi.newal2");
  });
});

describe("THE THREE-PARTY NESTING INVARIANT: generator ⊆ DB CHECK === login regex", () => {
  // The acceptors are read from their SOURCE OF TRUTH rather than restated:
  //   - the DB CHECK regex is extracted from the migration file on disk;
  //   - the login acceptor is the real `classifyIdentifier`, imported.
  // A widening (or narrowing) of either that this generator does not fit fails
  // here rather than at a 23514 on a live child insert.
  const MIGRATION = "supabase/migrations/20260904120000_fp_username_email_shaped.sql";
  const sql = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", MIGRATION),
    "utf8"
  );
  const extracted = /fp_username ~ '([^']+)'/.exec(sql);

  it("the migration still states a single fp_username CHECK regex we can read", () => {
    expect(extracted).not.toBeNull();
  });

  const DB_CHECK = new RegExp(extracted![1]);

  const NAMES: Array<[string, string]> = [
    ["Remi", "Newal"],
    ["Mary Jane", "van der Berg"],
    ["Jean-Luc", "Ng"],
    ["Anna-Lee", "O'Brien"],
    ["José", "Ó Súilleabháin"],
    ["Weiß", "Schäfer"],
    ["Lily  Rose  ", "  Ng  "],
    ["- -", "Newal"],
    ["Remi", ""],
  ];

  it("every generated username (base, suffixed, and the fallback) is accepted by BOTH", () => {
    for (const [first, last] of NAMES) {
      const taken = new Set<string>();
      for (let i = 0; i < 3; i += 1) {
        const mint = mintUsernameFromNames({
          firstName: first,
          lastName: last,
          isTaken: (c) => taken.has(c),
        });
        expect(mint.ok, `${first}/${last}`).toBe(true);
        if (!mint.ok) continue;
        taken.add(mint.username);

        // (a) storage: the DB CHECK, straight from the migration.
        expect(DB_CHECK.test(mint.username), `CHECK rejects ${mint.username}`).toBe(true);
        expect(mint.username.length, mint.username).toBeLessThanOrEqual(80);

        // (b) login: the real acceptor, and it must classify as a USERNAME —
        // a handle that merely "matches a regex" but refuses at login is a kid
        // who cannot sign in.
        const classified = classifyIdentifier(mint.username);
        expect(classified.kind, `login refuses ${mint.username}`).toBe("username");
        if (classified.kind === "username") {
          // (c) the case-insensitive unique index: the stored handle IS its own
          // normalized form, so the index and the lookup cannot disagree.
          expect(classified.normalized).toBe(mint.username);
        }
      }
    }
  });

  it("the generator is a STRICT SUBSET: it never emits the punctuation the acceptors merely tolerate", () => {
    const GENERATOR_SHAPE = /^[a-z0-9]+(\.[a-z0-9]+)?[0-9]*@firstprofit\.school$/;
    for (const [first, last] of NAMES) {
      const mint = mintUsernameFromNames({ firstName: first, lastName: last, isTaken: () => false });
      if (mint.ok) expect(mint.username).toMatch(GENERATOR_SHAPE);
    }
  });
});
