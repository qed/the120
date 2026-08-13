/**
 * Pure decision rules for the fpv04 CHILD MINT extensions (fpv04 Unit 5a). No
 * Next, no Supabase, no DB — the house pure-module convention (the sibling is
 * ./signup-rules.ts). Three concerns live here:
 *
 *   1. The fpv04 COVER vocabulary the child door validates against: the six
 *      preset look ids (the SPA's src/data/storyLooks.ts ids, mirror-pinned by
 *      a twin test on the SPA side), the five hero vibes, and the two hero
 *      gender presentations. Server-side allowlists, never free strings — a
 *      coverLook is seeded into the kid's save doc, so an arbitrary string
 *      here would become a durable, guard-protected save-doc value.
 *
 *   2. The ONE-TIME memorable kid password: `word-word-NN` (two distinct
 *      lowercase words + two digits, e.g. `maple-lantern-42`). Minted
 *      SERVER-SIDE when the fpv04 caller omits `childPassword` — the kid's
 *      auth password IS this value, returned exactly once in the mint
 *      response and NEVER logged. The wordlist is small and in-repo on
 *      purpose (memorable, typeable by a 7-year-old); entropy is not the
 *      defense — the username is non-public, the login door is rate-limited,
 *      and the parent can reset from the dashboard. Every word is 4-8
 *      lowercase ASCII letters and none contains a PASSWORD_DENYLIST
 *      substring, so a minted password always clears the R29 student floor
 *      (min length 10; >=4 distinct chars; no denylist hit) unless it
 *      collides with the kid's own name — the minting loop re-rolls on that.
 *
 *   3. The PINNED mint-response contract (`FpChildMintBody`), derived from the
 *      type so drift is a compile error — the FpParentSessionBody key-pin
 *      discipline exactly. The SPA's signupApi carries the twin arrays.
 */

/* ------------------------------------------------- the fpv04 cover vocabulary */

/**
 * The six preset cover look ids — MUST stay byte-identical to the SPA's
 * src/data/storyLooks.ts STORY_LOOKS ids (the save doc's `coverLook` value the
 * whole story surface renders from). Order mirrors the SPA's display order.
 * Never rename an entry; ids are durable persisted keys.
 */
export const FP_STORY_LOOK_IDS = [
  "storybook-classic",
  "action-issue",
  "saturday-comics",
  "manga-arc",
  "pastel-daydream",
  "night-hero",
] as const;
export type FpStoryLookId = (typeof FP_STORY_LOOK_IDS)[number];

/** The five hero vibes from the s06 cover step (walkthrough §3d), stable ids. */
export const FP_HERO_VIBES = [
  "builder",
  "explorer",
  "inventor",
  "captain",
  "closer",
] as const;
export type FpHeroVibe = (typeof FP_HERO_VIBES)[number];

/** The s06 boy/girl segmented toggle values (boy is the SPA's default). */
export const FP_HERO_GENDERS = ["boy", "girl"] as const;
export type FpHeroGender = (typeof FP_HERO_GENDERS)[number];

/* --------------------------------------------- the memorable password minter */

/**
 * The in-repo wordlist. Kid-friendly concrete nouns, 4-8 lowercase ASCII
 * letters each, all distinct, none containing a PASSWORD_DENYLIST substring
 * (provision-rules) — pinned by mint-rules tests so an edit here cannot
 * silently mint un-mintable passwords.
 */
export const FP_MEMORABLE_WORDS = [
  "maple", "lantern", "biscuit", "harbor", "pebble", "walnut", "meadow",
  "copper", "willow", "ember", "acorn", "breeze", "cedar", "dune",
  "fable", "garnet", "hazel", "island", "juniper", "kettle", "lagoon",
  "marble", "nutmeg", "orchard", "prairie", "quartz", "raven", "saddle",
  "timber", "umber", "velvet", "wagon", "yonder", "zephyr", "clover",
  "drift", "falcon", "grove", "harvest", "ivory",
] as const;

/** `word-word-NN`: two distinct words joined by hyphens plus two digits. */
export const FP_MEMORABLE_PASSWORD_PATTERN = /^[a-z]{4,8}-[a-z]{4,8}-\d{2}$/;

/**
 * Mint one memorable password. `random` is the impure edge, injected so tests
 * are deterministic (the profile-core randomSuffix precedent): it must return
 * a float in [0, 1). The two words are always DISTINCT (a doubled word would
 * halve the memorability and reads like a bug to a parent).
 */
export function mintMemorablePassword(random: () => number = Math.random): string {
  const pick = (): string =>
    FP_MEMORABLE_WORDS[Math.min(Math.floor(random() * FP_MEMORABLE_WORDS.length), FP_MEMORABLE_WORDS.length - 1)];
  const first = pick();
  let second = pick();
  // Bounded re-roll for distinctness; fall back to a deterministic neighbor so
  // a stuck injected RNG can never loop forever.
  for (let i = 0; i < 10 && second === first; i += 1) second = pick();
  if (second === first) {
    const words: readonly string[] = FP_MEMORABLE_WORDS;
    second = words[(words.indexOf(first) + 1) % words.length];
  }
  const digits = String(Math.min(Math.floor(random() * 100), 99)).padStart(2, "0");
  return `${first}-${second}-${digits}`;
}

/* ------------------------------------------- the pinned mint-response contract */

/**
 * ── THE ONE SOURCE OF TRUTH FOR "WHAT THE CHILD-MINT DOOR RETURNS" ──
 * The pre-fpv04 body was {ok, status, childId, username}; fpv04 U5a ADDS
 * `childPassword` — the one-time memorable password, present (non-empty) ONLY
 * when the server minted it (the caller omitted `childPassword` in the
 * request). A caller-supplied password is NEVER echoed back (empty string).
 * Field ORDER is observable output: do not reorder.
 */
export type FpChildMintBody = {
  ok: true;
  status: "child_created";
  childId: string;
  username: string;
  /** Server-minted one-time password, or "" (parent-set path / replay). */
  childPassword: string;
};

/** Derived from the TYPE so drift is a compile error (FpParentSessionBody's
 *  key-pin discipline). The SPA's signupApi test mirrors this array. */
const FP_CHILD_MINT_BODY_SHAPE: Record<keyof FpChildMintBody, true> = {
  ok: true,
  status: true,
  childId: true,
  username: true,
  childPassword: true,
};

export const FP_CHILD_MINT_BODY_KEYS: readonly string[] = Object.keys(FP_CHILD_MINT_BODY_SHAPE);
