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
 * dependency on the then-route-local `app/start/v3/story-questions.ts`. That
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
 */
export const FALLBACK_PASSWORD_WORDS: readonly string[] = [
  "rockets", "pancakes", "lanterns", "meadow", "compass", "harbour", "cider",
  "puffin", "maple", "thunder", "sailboat", "cobalt", "juniper", "orbit",
  "pebble", "quartz", "ribbon", "saffron", "tundra", "violet", "willow",
  "zephyr", "anchor", "bramble", "clover", "dune", "ember", "fern", "glacier",
  "hazel",
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
  const pool = rotatedFallback(input.random);
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
  // about it. So the fallback is made total IN FACT — search the WHOLE space of
  // distinct triples from the same per-kid rotation, validating each, and find a
  // valid one whenever one exists (4060 checks at the shipped list size, and
  // only on a path nothing real reaches).
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
