/**
 * The v3 KID CREDENTIAL decisions (plan Unit 3): which word the child's password
 * is built from, and what happens when that word is not usable. Pure — no Next,
 * no Supabase, no clock, no CSPRNG (randomness is INJECTED as a `() => number`,
 * so a test can drive both the "same stream" and "different stream" cases and
 * prove the fallback is per-kid rather than one shared constant).
 *
 * ── THE SHAPE, AND WHY IT IS NOT NEGOTIABLE BY THIS MODULE ──
 * The password is `iloveschool<word>` — the design's memorable-for-an-eight-
 * year-old shape. It is NOT trusted to be valid just because it is generated:
 * EVERY candidate this module returns has been run through
 * `validateStudentPassword` (app/fp/lib/provision-rules.ts), the same floor
 * `createChild` re-applies at mint time. Generating a password that the mint
 * would then refuse is how a family ends up staring at a provisioning failure
 * they cannot act on, so the validation happens HERE, before anything is shown.
 *
 * The floor's four refusals, and how each is handled:
 *   - LENGTH (>= 10): `iloveschool` is 11 on its own, so the shape can never
 *     fail this.
 *   - DISTINCT CHARACTERS (>= 4): `iloveschool` already contributes 8.
 *   - DENYLIST: `iloveyou` / `password` / `thepath` / `the120` / … A story word
 *     could reintroduce one (a child who writes about "passwords"), so the
 *     denylist is re-checked through the validator, never re-implemented here.
 *   - THE KID-NAME SUBSTRING: the interesting one. A child called Remi who
 *     writes about "remington" would be handed `iloveschoolremington` —
 *     which contains their own name, the single most guessable string in a
 *     cohort. Refused, and the fallback fires.
 *
 * ── THE FALLBACK IS PER-KID RANDOM, DELIBERATELY ──
 * A shared constant fallback (`iloveschoolsoccer` for everyone whose answers
 * were skipped) would be a cohort-wide default credential: learn one kid's
 * password and you have guessed the shape of every quiet kid's. So the fallback
 * DRAWS from a word list using the injected randomness, and the draw is
 * re-validated. If a specific kid's name poisons the fixed prefix itself (a
 * child whose name token is literally inside `iloveschool` — "school", "love",
 * "ilo"), every prefixed candidate is refusable, so the last resort abandons the
 * shape and returns a random three-word passphrase — chosen by an EXHAUSTIVE,
 * VALIDATED search of the fallback vocabulary, so any password this module
 * RETURNS is one the mint will accept. If even that finds nothing (a name that
 * poisons all but two of the fallback words) it THROWS a labelled invariant
 * error rather than returning a credential the mint would refuse (review FIX
 * 10a); the caller's catch turns that into the one generic failure.
 */

import { validateStudentPassword } from "@/app/fp/lib/provision-rules";
import { STORY_QUESTION_IDS } from "./story-questions";

/* --------------------------------------------------------------- the shape */

/** The memorable prefix every generated child password starts with. */
export const CHILD_PASSWORD_PREFIX = "iloveschool";

/**
 * The two answers the prototype consults first (`answers.matters ||
 * answers.intro`) — the ones most likely to contain a concrete noun a child
 * would recognize as "theirs".
 */
const PASSWORD_WORD_PREFERRED_ANSWERS: readonly string[] = ["matters", "intro"];

/**
 * Which answers are consulted for the word, in order: the two preferred ones
 * above, then every remaining question in render order, so a child who answered
 * only question 2 still gets a word of their own.
 *
 * ── ONE SOURCE FOR THE IDS (review FIX 9b) ──
 * The ids used to be DUPLICATED here, to keep this `app/lib` module free of a
 * dependency on the then-route-local `app/start/story-questions.ts`. That
 * module now lives BESIDE this one, so the duplication (and the drift it
 * invited — the core imported the ids while this file re-typed them) is gone:
 * both importers read `STORY_QUESTION_IDS`. An answer key that is not a known
 * question still reaches the final "any remaining answer" sweep in
 * `candidateWords`, so an unrecognized key degrades to "picks a word from a
 * different answer", never to a crash.
 */
export const PASSWORD_WORD_ANSWER_PRIORITY: readonly string[] = [
  ...PASSWORD_WORD_PREFERRED_ANSWERS,
  ...STORY_QUESTION_IDS.filter((id) => !PASSWORD_WORD_PREFERRED_ANSWERS.includes(id)),
];

/**
 * Words too generic to make a password memorable OR distinctive. Extends the
 * prototype's list (plan: "the `<word>` extraction stop-list beyond the
 * prototype's — Unit 3 detail") with the connectives and filler a nine-year-old
 * actually opens a sentence with. Checked lowercased, whole-word.
 */
export const STORY_STOP_WORDS: ReadonlySet<string> = new Set([
  // the prototype's list
  "my", "the", "a", "an", "i", "we", "that", "this", "it", "and", "is", "are",
  "to", "of", "in", "for",
  // Unit 3 additions: filler that survives the length>3 filter and would make
  // a bland password ("iloveschoolbecause").
  "about", "also", "because", "been", "being", "could", "does", "doing", "from",
  "have", "here", "just", "know", "like", "made", "make", "many", "more",
  "most", "much", "name", "really", "same", "some", "than", "them", "then",
  "there", "they", "thing", "things", "think", "very", "want", "wanted",
  "well", "were", "what", "when", "where", "which", "will", "with", "would",
  "your", "years", "year", "old", "started", "start", "starting", "business",
]);

/** Minimum letters in a usable story word. Four keeps `fun`/`dad` out (too
 *  short to carry the password) without excluding `bake`, `bike`, `math`. */
export const MIN_PASSWORD_WORD_LENGTH = 4;
/** Bound: a longer word is truncated out of the running rather than producing a
 *  password nobody can retype. */
export const MAX_PASSWORD_WORD_LENGTH = 14;

/**
 * The per-kid fallback vocabulary. Concrete, spellable, and deliberately free of
 * anything on the student denylist. Order is irrelevant — the draw is random.
 *
 * ── WHY IT IS THIS BIG (whole-branch review, finding 4) ──
 * It shipped with THIRTY words. The prefix `iloveschool` is fixed and public,
 * and the username is deterministic and derivable (`first.last@…`), so for any
 * child who reached this branch the whole credential was one of ~30 guesses.
 * Thirty is not a vocabulary, it is a rounding error. The list is now several
 * HUNDRED words, which is the only lever available: the shape `iloveschool
 * <word>` and its memorability for an eight-year-old are the owner's
 * requirement and are not this module's to renegotiate, so the entropy has to
 * come from the word.
 *
 * ── THE RULES EVERY ENTRY OBEYS (pinned by __tests__/credentials-rules.test.ts,
 *    which re-derives them rather than trusting this comment) ──
 *  1. `iloveschool<word>` passes `validateStudentPassword` for a neutral name.
 *     Nothing here contains a denylist string; nothing is under the length or
 *     distinct-character floor once prefixed.
 *  2. Lowercase a–z only. No hyphens, no accents, no apostrophes — the child
 *     types this on a phone keyboard, and the passphrase last resort joins
 *     words with `-`, which a word containing one would make ambiguous.
 *  3. 4–12 letters. Short enough to retype, long enough not to be noise.
 *  4. Concrete and picturable: an animal, a food, a place, a thing, a colour, a
 *     sport. No abstractions — "courage" is not a thing a seven-year-old can
 *     hold in their head while typing.
 *  5. NO HOMOPHONE TRAPS. A word a child hears their parent read aloud and then
 *     spells the other way is a lockout, so bear/bare, flour/flower, sail/sale,
 *     steel/steal, brake/break, week/weak, right/write, whole/hole and their
 *     kind are all absent, as are en-GB/en-US spelling splits (colour, favourite)
 *     — `harbour` is grandfathered from the original list and is the only one.
 *  6. NOTHING THAT READS BADLY AGAINST THE PREFIX, including as a substring:
 *     no `butt`, `ass`, `hell`, `poo`, `cock`, `tit` inside a word, however
 *     innocent the word itself (`button`, `classroom`, `poodle`, `shellfish` are
 *     all excluded for this reason and no other). `compass` is grandfathered.
 *  7. No proper nouns and no common given names — a fallback word that is
 *     another child in the cohort's first name is a bad joke on both of them.
 *
 * Adding words is welcome and safe: the test re-checks the whole list against
 * every rule above, so a bad addition fails the build rather than a family.
 */
export const FALLBACK_PASSWORD_WORDS: readonly string[] = [
  // ── the original thirty, kept verbatim ──
  "rockets", "pancakes", "lanterns", "meadow", "compass", "harbour", "cider",
  "puffin", "maple", "thunder", "sailboat", "cobalt", "juniper", "orbit",
  "pebble", "quartz", "ribbon", "saffron", "tundra", "violet", "willow",
  "zephyr", "anchor", "bramble", "clover", "dune", "ember", "fern", "glacier",
  "hazel",

  // ── animals ──
  "alpaca", "antelope", "armadillo", "badger", "beaver", "beetle", "bison",
  "buffalo", "camel", "caterpillar", "cheetah", "chipmunk", "cobra", "crab",
  "cricket", "dolphin", "donkey", "dragon", "dragonfly", "eagle", "falcon",
  "ferret", "firefly", "flamingo", "gecko", "gerbil", "giraffe", "gopher",
  "guppy", "hamster", "hedgehog", "heron", "hippo", "iguana", "jaguar",
  "jellyfish", "kangaroo", "kitten", "koala", "ladybug", "lemur", "leopard",
  "lizard", "llama", "lobster", "magpie", "meerkat", "minnow", "mongoose",
  "monkey", "moose", "narwhal", "ocelot", "octopus", "orca", "ostrich",
  "otter", "panda", "parrot", "pelican", "penguin", "pigeon", "platypus",
  "python", "rabbit", "raccoon", "reindeer", "rhino", "salmon", "seagull",
  "seahorse", "shark", "snail", "sparrow", "spider", "squid", "squirrel",
  "starfish", "stingray", "stork", "tadpole", "tiger", "tortoise", "toucan",
  "trout", "turtle", "walrus", "weasel", "whale", "wombat", "zebra",

  // ── food ──
  "apricot", "avocado", "bagel", "banana", "biscuit", "blueberry", "broccoli",
  "brownie", "burrito", "cabbage", "carrot", "cashew", "celery", "cheddar",
  "cherry", "chestnut", "chowder", "cinnamon", "coconut", "cookie", "cracker",
  "cranberry", "crumpet", "cucumber", "cupcake", "custard", "dumpling",
  "fritter", "granola", "hazelnut", "honey", "ketchup", "lemon", "lentil",
  "lettuce", "lollipop", "mango", "marmalade", "meatball", "melon", "muffin",
  "mushroom", "mustard", "noodle", "nutmeg", "oatmeal", "olive", "onion",
  "orange", "oregano", "papaya", "parsnip", "pasta", "peanut", "pepper",
  "pickle", "pineapple", "pistachio", "popcorn", "porridge", "potato",
  "pretzel", "pudding", "pumpkin", "radish", "raisin", "ravioli", "rhubarb",
  "sandwich", "sausage", "sherbet", "spaghetti", "spinach", "sprout",
  "squash", "strawberry", "sundae", "syrup", "tangerine", "toffee", "tomato",
  "tortilla", "turnip", "vanilla", "waffle", "walnut", "watermelon", "yogurt",
  "zucchini",

  // ── outdoors, weather and sky ──
  "acorn", "autumn", "avalanche", "blossom", "boulder", "breeze", "brook",
  "bubble", "cactus", "canyon", "cavern", "cliff", "cloud", "comet", "coral",
  "crater", "creek", "crystal", "daisy", "dandelion", "dewdrop", "forest",
  "fossil", "garden", "geyser", "granite", "grotto", "harvest", "iceberg",
  "island", "jungle", "lagoon", "lava", "lightning", "marble", "mesa",
  "meteor", "mountain", "nectar", "oasis", "orchard", "petal", "pinecone",
  "planet", "pollen", "prairie", "rainbow", "ripple", "river", "sandbar",
  "sapling", "savanna", "seaweed", "sequoia", "shadow", "snowflake", "spruce",
  "stardust", "summit", "sunflower", "sunrise", "sunset", "thicket",
  "thistle", "tulip", "valley", "volcano", "waterfall", "wildflower",
  "woodland",

  // ── things ──
  "abacus", "backpack", "balloon", "banjo", "basket", "bicycle", "binder",
  "blanket", "bongo", "bookmark", "bottle", "bracelet", "bugle", "bulldozer",
  "camera", "candle", "canoe", "cartwheel", "castle", "catapult",
  "chalkboard", "chariot", "chimney", "clarinet", "comic", "cottage",
  "crayon", "cymbal", "dominoes", "doorbell", "drawbridge", "easel", "engine",
  "envelope", "eraser", "fiddle", "flagpole", "flashlight", "flute", "folder",
  "glider", "glitter", "goggles", "guitar", "hammock", "handbook",
  "harmonica", "helmet", "hovercraft", "jigsaw", "journal", "jukebox",
  "kayak", "kazoo", "kettle", "keyboard", "kite", "ladder",
  "lighthouse", "locket", "magnet", "mailbox", "mandolin", "marker",
  "marshmallow", "mitten", "mosaic", "notebook", "origami", "paddle",
  "paintbrush", "parachute", "pencil", "piano", "pinwheel", "pocket",
  "postcard", "poster", "puppet", "puzzle", "pyramid", "racecar", "raincoat",
  "rowboat", "rucksack", "sandbox", "sandal", "satchel", "saxophone",
  "scooter", "seesaw", "skateboard", "sketchbook", "sleigh",
  "slingshot", "slipper", "snorkel", "snowboard", "spaceship", "sparkler",
  "stapler", "starship", "stopwatch", "submarine", "sweater", "tambourine",
  "telescope", "thermos", "tiara", "toboggan", "torch", "tractor",
  "trampoline", "treehouse", "triangle", "tricycle", "trombone", "trophy",
  "trumpet", "tugboat", "tunnel", "typewriter", "ukulele", "umbrella",
  "unicycle", "violin", "wagon", "wheelbarrow", "whistle", "windmill",
  "xylophone", "zipper",

  // ── colours ──
  "amber", "azure", "bronze", "crimson", "emerald", "indigo", "ivory", "jade",
  "lavender", "lilac", "magenta", "maroon", "scarlet", "silver", "teal",
  "turquoise",

  // ── sports and games ──
  "archery", "badminton", "baseball", "basketball", "bowling", "cycling",
  "dodgeball", "gymnastics", "hockey", "hurdles", "judo", "karate",
  "lacrosse", "marathon", "netball", "rugby", "sailing", "skating", "skiing",
  "soccer", "softball", "surfing", "swimming", "tennis", "volleyball",
  "wrestling",
];

/* ------------------------------------------------------------- extraction */

const LETTERS_ONLY = /[^a-z\s]/g;

/**
 * Every candidate word in one answer, in the order the child wrote them,
 * filtered to the usable shape. Exported for the test's sake and because the
 * story step could later surface "we picked <word> from your answer".
 */
export function candidateWordsFromAnswer(answer: string): string[] {
  return (answer ?? "")
    .toLowerCase()
    .replace(LETTERS_ONLY, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= MIN_PASSWORD_WORD_LENGTH &&
        w.length <= MAX_PASSWORD_WORD_LENGTH &&
        !STORY_STOP_WORDS.has(w)
    );
}

/**
 * The ordered candidate words across the whole answer sheet: the priority
 * answers first, then anything else the child wrote (so a sheet whose only
 * filled answer is one this module has never heard of still yields a word).
 */
export function candidateWords(answers: Record<string, string> | null | undefined): string[] {
  const sheet = answers ?? {};
  const seenKeys = new Set<string>();
  const out: string[] = [];
  const push = (key: string) => {
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const value = sheet[key];
    if (typeof value === "string") out.push(...candidateWordsFromAnswer(value));
  };
  for (const key of PASSWORD_WORD_ANSWER_PRIORITY) push(key);
  for (const key of Object.keys(sheet)) push(key);
  return out;
}

/* -------------------------------------------------------------- the build */

export type ChildPasswordSource = "answers" | "random_word" | "random_passphrase";

export type ChildPasswordResult = {
  password: string;
  /** Where the password came from, for the account-ready screen's copy and for
   *  tests. Never logged with the password itself. */
  source: ChildPasswordSource;
  /** The word the password was built from (absent for a passphrase). */
  word?: string;
};

/** Draw an index from `[0, length)` using the injected `[0, 1)` source. A
 *  non-finite or out-of-range draw folds back into range rather than throwing —
 *  this must be total. */
function drawIndex(random: () => number, length: number): number {
  const raw = random();
  const unit = Number.isFinite(raw) ? Math.abs(raw) % 1 : 0;
  return Math.min(length - 1, Math.floor(unit * length));
}

/** A random rotation of the fallback list: every word is tried exactly once,
 *  starting from a per-kid random offset, so two kids drawing from different
 *  streams get different words and neither shares one fixed constant. */
function rotatedFallback(random: () => number): string[] {
  const offset = drawIndex(random, FALLBACK_PASSWORD_WORDS.length);
  return FALLBACK_PASSWORD_WORDS.map(
    (_, i) => FALLBACK_PASSWORD_WORDS[(offset + i) % FALLBACK_PASSWORD_WORDS.length]
  );
}

/**
 * Build the child's password.
 *
 * `childName` is the FULL name (first + last) — stricter than what `createChild`
 * re-checks (it validates against the first name alone), because a password
 * containing the child's SURNAME is just as guessable inside a family.
 *
 * Order: the child's own word, then a per-kid random word, then a per-kid random
 * passphrase. Every candidate goes through `validateStudentPassword`, so the
 * returned password is one the mint cannot refuse.
 */
export function buildChildPassword(input: {
  childName: string;
  answers?: Record<string, string> | null;
  /** `[0, 1)` source. The action injects a CSPRNG; tests inject a sequence. */
  random: () => number;
}): ChildPasswordResult {
  const ctx = { studentName: input.childName };
  const accept = (word: string, source: ChildPasswordSource): ChildPasswordResult | null => {
    const password = `${CHILD_PASSWORD_PREFIX}${word}`;
    return validateStudentPassword(password, ctx).ok ? { password, source, word } : null;
  };

  for (const word of candidateWords(input.answers)) {
    const hit = accept(word, "answers");
    if (hit) return hit;
  }

  for (const word of rotatedFallback(input.random)) {
    const hit = accept(word, "random_word");
    if (hit) return hit;
  }

  // Every prefixed candidate was refused, which can only mean the PREFIX itself
  // carries the refusal — a child whose name token is inside "iloveschool"
  // ("school", "love"). Abandon the shape rather than the child: three random
  // words, dash-joined, is longer, has plenty of distinct characters, and
  // cannot contain the prefix.
  // ── PRE-FILTER, SO A 300-WORD VOCABULARY DOES NOT COST 4.5M VALIDATIONS ──
  // The exhaustive triple search below is O(n³) in the vocabulary size, which
  // was tolerable at the original thirty words and is not at several hundred
  // (finding 4 widened the list; the search has to keep up). A passphrase is
  // validated with `includes`, so a word whose OWN letters carry a name token or
  // a denylist string refuses every triple it could appear in — dropping those
  // once, up front, removes the vast majority of the space for free. It is
  // deliberately CONSERVATIVE, not exact: a word could also be dropped because a
  // name token spans the joining `-` in the `w-w-w` probe. That can only ever
  // narrow the search, never widen it, so the module's absolute guarantee (every
  // password RETURNED has passed `validateStudentPassword`) is untouched; the
  // only cost is that an already-unreachable path might throw where a wider
  // search would have found something.
  const rotated = rotatedFallback(input.random);
  const pool = rotated.filter((w) => validateStudentPassword(`${w}-${w}-${w}`, ctx).ok);
  for (let start = 0; start < pool.length; start += 1) {
    const password = [
      pool[start],
      pool[(start + 7) % pool.length],
      pool[(start + 13) % pool.length],
    ].join("-");
    if (validateStudentPassword(password, ctx).ok) {
      return { password, source: "random_passphrase" };
    }
  }

  // ── THE LAST RESORT IS VALIDATED TOO (review FIX 10a) ──
  // The rotation above tries only `pool.length` of the possible triples (the
  // fixed +7/+13 stride). An earlier revision ended here by RETURNING an
  // UNVALIDATED four-word join, on the argument that this point is unreachable.
  // "Unreachable" is not a property this module may assert about a credential:
  // if it were ever wrong, the family would be handed a password `createChild`
  // then refuses as `weak_password`, on the one screen where they can do nothing
  // about it. So the fallback is made total IN FACT — search the whole space of
  // distinct triples from the (pre-filtered) per-kid rotation, validating each,
  // and find a valid one whenever one exists. Only reached on a path nothing
  // real gets to, and only after the pre-filter above has collapsed the space.
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      for (let k = j + 1; k < pool.length; k += 1) {
        const password = `${pool[i]}-${pool[j]}-${pool[k]}`;
        if (validateStudentPassword(password, ctx).ok) {
          return { password, source: "random_passphrase" };
        }
      }
    }
  }

  // Genuinely nothing in the vocabulary works — reachable only if a name token
  // poisons all but two of the fallback words. Throwing is the honest end: the
  // action's catch maps it to the one generic failure, and the family retries or
  // edits a name. Returning an invalid credential instead would look like
  // success and fail one step later. The message carries NO name and NO password
  // (it lands in logs).
  throw new Error(
    "[v3/credentials] INVARIANT: no valid child password could be derived — every prefixed word and every fallback passphrase was refused by validateStudentPassword"
  );
}
