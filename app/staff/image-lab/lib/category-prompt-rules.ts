/**
 * Image Lab — the CATEGORY-DERIVED PROMPT: what a vendor is allowed to be told
 * about a child's business (Unit 8).
 *
 * PLAIN module — no next/supabase/react/ai imports, no I/O, no network, and
 * deliberately NO MODEL CALL. This is a lookup over a closed vocabulary, which is
 * the only shape that can be tested offline and audited by reading it.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS ASYMMETRIC ─────────────────────────────
 * OpenAI's own under-18 API guidance: "You should not use OpenAI services to
 * process any personal data of children under 13 or the applicable age of digital
 * consent without first implementing zero data retention in our API." The beta
 * cohort includes under-13s (band `g3_5`), and ZDR is approval-gated through
 * OpenAI sales rather than self-serve. So THE OPENAI LEG IS BLOCKED BY THE
 * VENDOR'S OWN RULE, and no consent bump on our side unblocks it.
 *
 * Google is not in that position: the Gemini API Additional Terms (effective
 * 2026-03-23) confirm the PAID tier does not train on prompts, and the production
 * key bills against a paid project. There is no equivalent under-18 processing
 * bar.
 *
 *   ⚠ THE CONSTRAINT IS ASYMMETRIC BECAUSE THE VENDORS' TERMS ARE ASYMMETRIC.
 *     Do not "restore symmetry" — see below.
 *
 * ── THIS IS A PROMPT BENCH, NOT A MODEL TOURNAMENT ────────────────────────
 * An earlier draft of this unit made the derived prompt a RUN-WIDE transform, on
 * the reasoning that sending different text to different models would stop the
 * compare grid comparing "like with like". That reasoning was rejected by the
 * owner, and rightly:
 *
 *   "I want to be able to experiment with different prompts to see what is the
 *    best way to get the best results. I don't need to be fair to OpenAI or
 *    Gemini. I just need to get the best results."
 *
 * Discovering that `gpt-image-2` needs a differently-phrased prompt than
 * `gemini-3-pro-image` to produce a usable panel is a RESULT, not a confound — the
 * panel engine will ultimately hand each model its own best prompt, so the bench
 * has to be able to find it. Forcing input uniformity would have destroyed the
 * Lab's main job in order to protect a comparison nobody asked for.
 *
 * So: the prompt is a PER-CELL, STAFF-CONTROLLED choice
 * (`run-rules.ImageLabPromptMode`), every image row records the exact text that
 * produced it, and the ONE non-overridable rule is the dispatch gate in
 * `run-rules.decideChildTextGate` — an OpenAI cell on a run with verified child
 * provenance must carry a prompt from THIS module's closed vocabulary. Everything
 * else is an experiment the staff member gets to run.
 *
 * ── THE FOUR PROPERTIES THE CLASSIFIER MUST HAVE ──────────────────────────
 *   1. DETERMINISTIC AND TOTAL. Same slots in, same string out; never throws;
 *      always yields something drawable, including for `{}`, `undefined`, an
 *      emoji, or 8000 characters of Japanese.
 *   2. CLOSED-VOCABULARY OUTPUT. Every derived prompt is a member of
 *      {@link allCategoryPrompts} — a finite, enumerable set fixed in this file.
 *      That is a STRONGER guarantee than "we stripped the names": no substring of
 *      a child's input can appear in the output because the output was never
 *      built from the input at all, only SELECTED by it.
 *   3. NON-RECONSTRUCTING — WHICH IS NOT THE SAME AS "REVEALS NOTHING". This
 *      property was previously stated as "nothing in an output reconstructs an
 *      input", over an arithmetic that was also wrong (24 × 8 = 192; the fallback
 *      is a MEMBER of the vocabulary, so it is 25 × 8 = 200, as
 *      {@link allCategoryPrompts} and its docblock correctly say). Both halves
 *      are corrected here, because this file is explicitly the artifact whoever
 *      has to defend this design reads.
 *
 *      WHAT IS ACTUALLY PROVEN, and it is proven mechanically: NO SUBSTRING OF
 *      THE INPUT IS TRANSMITTED. The output is not built from the input, only
 *      SELECTED by it, and the suite asserts membership of a set fixed in source
 *      over a table of hostile inputs. That is the strong, durable claim.
 *
 *      WHAT IS NOT PROVEN, stated as the residual it is: the dispatched string
 *      carries BOTH a category and a setting, so it is a classifier of the
 *      child's text with log2(200) ≈ 7.6 bits of resolution. Against a 17-child
 *      beta cohort, a (category, setting) pair approaches a PER-CHILD
 *      FINGERPRINT — 200 bins over 17 children means most children are alone in
 *      theirs. A vendor holding several runs can group them by child without ever
 *      seeing a word the child wrote. "Non-invertible" was the wrong word for
 *      that; "carries no wording, carries a coarse label" is the right one.
 *
 *      ⚠ AND THE SETTING IS A DIFFERENT CLASS OF FACT FROM THE PRODUCT. The
 *      setting keywords include `school`, `classroom`, `recess`, `garage`,
 *      `basement`, `driveway`, `porch` and `beach`. Those transmit roughly WHERE
 *      A MINOR OPERATES — inside a school, at home, on a residential street —
 *      which is a category of information about a child that "what they sell" is
 *      not. It is accepted deliberately (a scene is what makes the panel
 *      drawable) and it is recorded here so the acceptance is visible rather than
 *      implicit.
 *
 *      ⚠ AND "UNCLASSIFIABLE" IS ITSELF A SIGNAL. `general_goods` +
 *      `market_stall` is the MODAL bin: it is where the fallback lands, so it
 *      collects both genuine general-goods businesses and everything the
 *      classifier could not read. A vendor seeing it learns "this one did not
 *      match" — the one bin whose meaning is about our classifier rather than
 *      about the child. That it is modal is what limits the fingerprinting above,
 *      and it is the reason not to grow this vocabulary: a hundred fine-grained
 *      categories would raise the resolution and shrink the crowd to hide in.
 *   4. AN EXPLICIT FALLBACK, NEVER PASSTHROUGH. Unmatched input yields
 *      {@link CATEGORY_FALLBACK_ID}. "We could not classify it, so we sent the
 *      child's text" is the one behaviour this module exists to make impossible,
 *      and `category-prompt-rules.test.ts` has a named test for it.
 *
 * ── WHAT IT DOES NOT REPLACE ──────────────────────────────────────────────
 * The name scrub in `content-picker-core` stays exactly where it is. This is
 * defence in depth ON TOP of it: the scrub still protects the STORED template,
 * slot values and note (which are stored and are sent nowhere), while this
 * protects what leaves for a vendor.
 *
 * ── A KNOWN, ACCEPTED INTERACTION: THE SCRUB RUNS FIRST ────────────────────
 * `pickSlotValues` scrubs the child's name out of every slot BEFORE those slots
 * are ever handed to {@link deriveCategoryPrompt}. The scrub is token-based and
 * does not know what a word is doing in a sentence, so a child named Candy, Rose,
 * Basil, Olive, Jasmine or Clay has that token replaced with `[name]` in the
 * PRODUCT NOUN too — "Candy's candy bags" arrives here as "[name]'s [name] bags",
 * and the `candy_treats` keyword that would have matched is gone.
 *
 * The effect is that those children's prompts classify less well and are pushed
 * toward {@link CATEGORY_FALLBACK_ID}. That is HARMLESS FOR PRIVACY — it fails
 * toward the least specific output, which is the safe direction, and the fallback
 * is a full member of the closed vocabulary — but it is not neutral for the
 * BENCH: it makes those children's derived prompts systematically vaguer, so a
 * model scored on them is being scored on a weaker input for a reason that has
 * nothing to do with the model.
 *
 * Deliberately NOT "fixed" by reordering. Classifying before scrubbing would mean
 * this module reads unscrubbed child text, which is precisely the property that
 * makes it auditable — the scrub-first order is the reason no substring of the
 * input can reach a vendor. Recorded here so that a surprising fallback rate on a
 * particular child is diagnosed rather than rediscovered.
 */

import { IMAGE_LAB_SLOTS, type ImageLabSlot } from "./image-lab-rules";

/** Slot values as the composer holds them. Structurally identical to
 *  `run-rules`' `SlotValues`, restated here so this module sits BELOW `run-rules`
 *  in the import graph (`run-rules` imports this one). */
export type CategorySlotValues = Partial<Record<ImageLabSlot, string>>;

// ── The closed vocabulary ────────────────────────────────────────────────────

/**
 * WHAT TO DRAW, as a closed set of product categories.
 *
 * ⚠ MODEST AND HONEST ON PURPOSE. Two dozen categories is enough to carry a panel
 * — "a hand-painted dog-treat stand" tells a model as much as a child's literal
 * pitch does — and few enough that the whole vocabulary fits on one screen and can
 * be read by whoever has to defend it. A hundred fine-grained categories would
 * start to be invertible again, which is the failure mode this list is sized
 * against.
 *
 * ⚠ NO PROPER NOUNS, NO NUMERALS, NO BRANDS anywhere in a phrase. The suite
 * asserts the digit half mechanically; the rest is a reading rule for whoever
 * edits this list.
 */
export const IMAGE_LAB_PRODUCT_CATEGORIES = [
  {
    id: "baked_goods",
    phrase: "a tray of home-baked cookies and cupcakes",
    setting: "kitchen",
    keywords: [
      "cookie", "brownie", "cupcake", "cake", "muffin", "bake", "baking",
      "bakery", "cinnamon roll", "banana bread", "pastry", "donut", "doughnut",
      "pie", "biscuit", "bread",
    ],
  },
  {
    id: "cold_drinks",
    phrase: "a drinks stand with a big pitcher and paper cups",
    setting: "front_yard",
    keywords: [
      "lemonade", "drink", "juice", "smoothie", "iced tea", "hot chocolate",
      "cocoa", "soda", "slushie", "beverage",
    ],
  },
  {
    id: "candy_treats",
    phrase: "a display of wrapped homemade candies",
    setting: "market_stall",
    keywords: [
      "candy", "chocolate", "fudge", "lollipop", "caramel", "gummy", "sweets",
      "toffee", "marshmallow",
    ],
  },
  {
    id: "snack_foods",
    phrase: "a table of packaged homemade snacks in jars and bags",
    setting: "market_stall",
    keywords: [
      "snack", "popcorn", "granola", "trail mix", "pretzel", "chip", "jerky",
      "salsa", "jam", "honey", "hot sauce",
    ],
  },
  {
    id: "pet_treats",
    phrase: "a hand-painted dog-treat stand with jars of biscuits",
    setting: "front_yard",
    keywords: [
      "dog treat", "pet treat", "cat treat", "dog biscuit", "pet snack",
      "dog bakery", "dog cookie",
    ],
  },
  {
    id: "pet_service",
    phrase: "a pet-care cart with leashes, brushes and water bowls",
    setting: "park",
    keywords: [
      "dog walking", "dog walk", "pet sitting", "pet sit", "dog sitting",
      "pet care", "cat sitting", "grooming", "poop scoop",
    ],
  },
  {
    id: "jewelry",
    phrase: "a tray of handmade beaded bracelets and necklaces",
    setting: "craft_desk",
    keywords: [
      "bracelet", "necklace", "jewelry", "jewellery", "earring", "bead",
      "charm", "anklet",
    ],
  },
  {
    id: "slime_putty",
    phrase: "tubs of colourful homemade slime",
    setting: "craft_desk",
    keywords: ["slime", "putty", "playdough", "play dough", "kinetic sand"],
  },
  {
    id: "soap_bath",
    phrase: "a basket of handmade soap bars and bath fizzers",
    setting: "workshop",
    keywords: [
      "soap", "bath bomb", "lotion", "lip balm", "scrub", "bath salt",
      "shampoo",
    ],
  },
  {
    id: "candles",
    phrase: "a set of hand-poured candles in small jars",
    setting: "workshop",
    keywords: ["candle", "wax melt", "diffuser"],
  },
  {
    id: "greeting_cards",
    phrase: "a rack of hand-drawn greeting cards",
    setting: "craft_desk",
    keywords: [
      "greeting card", "birthday card", "card", "invitation", "postcard",
      "stationery",
    ],
  },
  {
    id: "stickers",
    phrase: "a sheet of hand-drawn stickers and little pins",
    setting: "craft_desk",
    keywords: ["sticker", "decal", "enamel pin", "badge", "magnet"],
  },
  {
    id: "art_prints",
    phrase: "a display of small hand-painted pictures on easels",
    setting: "storefront",
    keywords: [
      "painting", "drawing", "art print", "portrait", "watercolor",
      "watercolour", "sketch", "poster", "canvas", "illustration",
    ],
  },
  {
    id: "sewn_goods",
    phrase: "a pile of hand-sewn cloth pouches and soft toys",
    setting: "craft_desk",
    keywords: [
      "sewing", "sewn", "plushie", "plush", "stuffed animal", "pillow",
      "tote bag", "scrunchie", "apron", "quilt",
    ],
  },
  {
    id: "knitted_goods",
    phrase: "a basket of hand-knitted hats and scarves",
    setting: "craft_desk",
    keywords: [
      "knit", "knitting", "crochet", "yarn", "scarf", "beanie", "mitten",
      "amigurumi",
    ],
  },
  {
    id: "clothing_accessories",
    phrase: "a rack of hand-decorated shirts and caps",
    setting: "storefront",
    keywords: [
      "shirt", "tie dye", "hoodie", "hat", "cap", "sock", "clothing",
      "apparel",
    ],
  },
  {
    id: "toys_games",
    phrase: "a table of handmade toys and card games",
    setting: "school_hall",
    keywords: [
      "toy", "game", "puzzle", "board game", "card game", "fidget", "origami",
    ],
  },
  {
    id: "books_zines",
    phrase: "a stack of hand-made booklets and comics",
    setting: "school_hall",
    keywords: [
      "book", "comic", "zine", "story", "journal", "notebook", "bookmark",
      "poem",
    ],
  },
  {
    id: "plants_garden",
    phrase: "a row of potted seedlings and small painted planters",
    setting: "market_stall",
    keywords: [
      "plant", "seedling", "succulent", "flower", "garden", "herb", "bouquet",
      "terrarium", "seed",
    ],
  },
  {
    id: "yard_service",
    phrase: "a lawn-care cart with a push mower and a rake",
    setting: "front_yard",
    keywords: [
      "lawn", "mowing", "mow", "yard work", "raking", "leaf", "snow shovel",
      "shovelling", "shoveling", "weeding",
    ],
  },
  {
    id: "cleaning_service",
    phrase: "a cleaning caddy of brushes, cloths and spray bottles",
    setting: "storefront",
    keywords: [
      "cleaning", "car wash", "washing", "tidying", "organizing", "laundry",
    ],
  },
  {
    id: "tutoring_service",
    phrase: "a small tutoring table with books and a whiteboard",
    setting: "school_hall",
    keywords: [
      "tutoring", "tutor", "lesson", "teaching", "homework help", "math help",
      "coaching",
    ],
  },
  {
    id: "tech_service",
    phrase: "a small workbench with a laptop and hand tools",
    setting: "workshop",
    keywords: [
      "website", "coding", "computer repair", "tech help", "video editing",
      "graphic design", "printing",
    ],
  },
  {
    id: "event_service",
    phrase: "a party-help cart with balloons and serving trays",
    setting: "park",
    keywords: [
      "babysitting", "babysit", "party", "event", "face painting", "balloon",
      "entertainer", "magic show", "photography", "photo booth",
    ],
  },
] as const satisfies readonly CategoryEntry[];

type CategoryEntry = {
  readonly id: string;
  readonly phrase: string;
  readonly setting: string;
  readonly keywords: readonly string[];
};

export type ImageLabProductCategory =
  | (typeof IMAGE_LAB_PRODUCT_CATEGORIES)[number]["id"]
  | typeof CATEGORY_FALLBACK_ID;

/**
 * THE EXPLICIT FALLBACK.
 *
 * ⚠ THE WHOLE POINT OF NAMING IT. An unmatched input is the moment a "just send
 * the text through, it is only this once" shortcut becomes tempting — and that
 * shortcut is the vulnerability, not a degradation of it. There is a category for
 * "we do not know what this is", it is drawable, and it is what gets sent.
 */
export const CATEGORY_FALLBACK_ID = "general_goods" as const;

const FALLBACK_CATEGORY = {
  id: CATEGORY_FALLBACK_ID,
  phrase: "a small handmade-goods stand with a simple display",
  setting: "market_stall",
  keywords: [] as readonly string[],
} as const;

/**
 * WHERE IT IS DRAWN — a second, smaller closed enum.
 *
 * Kept separate from the category rather than folded into its phrase so that two
 * children selling the same thing in different places still land on the same
 * CATEGORY, while the panel still gets a scene worth drawing.
 *
 * ⚠ THE SETTING IS THE MORE SENSITIVE HALF, AND THE MODULE HEADER SAYS SO. Its
 * keywords include `school`, `classroom`, `recess`, `garage`, `basement`,
 * `driveway`, `porch` and `beach` — so the dispatched string carries a coarse
 * statement of WHERE A MINOR OPERATES, which is a different class of fact from
 * what they sell. Accepted, not overlooked: read property 3 in the header before
 * adding a setting.
 */
export const IMAGE_LAB_SCENE_SETTINGS = [
  {
    id: "market_stall",
    phrase: "at a small outdoor market stall",
    keywords: ["market", "fair", "festival", "stall", "booth"],
  },
  {
    id: "front_yard",
    phrase: "at a front-yard table on a sunny day",
    keywords: ["yard", "driveway", "sidewalk", "porch", "curb"],
  },
  {
    id: "kitchen",
    phrase: "on a tidy kitchen counter",
    keywords: ["kitchen", "oven", "stove", "counter"],
  },
  {
    id: "craft_desk",
    phrase: "on a bright craft desk",
    keywords: ["desk", "studio", "workspace", "craft room"],
  },
  {
    id: "school_hall",
    phrase: "in a cheerful school hallway",
    keywords: ["school", "classroom", "recess", "lunchroom"],
  },
  {
    id: "park",
    phrase: "in a neighbourhood park",
    keywords: ["park", "playground", "trail", "beach", "pool"],
  },
  {
    id: "workshop",
    phrase: "in a small home workshop",
    keywords: ["garage", "workshop", "basement", "shed"],
  },
  {
    id: "storefront",
    phrase: "in a tiny storefront window",
    keywords: ["shop", "store", "storefront"],
  },
] as const satisfies readonly SettingEntry[];

type SettingEntry = {
  readonly id: string;
  readonly phrase: string;
  readonly keywords: readonly string[];
};

export type ImageLabSceneSetting = (typeof IMAGE_LAB_SCENE_SETTINGS)[number]["id"];

/**
 * The FIXED frame every derived prompt is poured into.
 *
 * ⚠ "NO LETTERING, NO LOGOS, NO BRAND NAMES" IS A PRIVACY INSTRUCTION, not a
 * style note. A model that decides to letter a sign on the stall will invent a
 * business name, and an invented business name on a panel filed under a real
 * child's run is worse than no panel: a reviewer reads it as the child's.
 */
export function frameCategoryPrompt(
  categoryPhrase: string,
  settingPhrase: string
): string {
  return (
    "A bright, friendly comic-style illustration of a young entrepreneur's " +
    `small business: ${categoryPhrase}, ${settingPhrase}. ` +
    "Warm daylight, hand-made and cheerful. " +
    "No lettering, no logos, no brand names, no readable text of any kind."
  );
}

// ── Matching ─────────────────────────────────────────────────────────────────

/**
 * How much a slot's text counts toward a category score.
 *
 * `product` is the most reliable signal by a distance — it is the field a child
 * fills with the noun — and `sale` is the noisiest, so the weights say so. Fixed
 * integers rather than tuned floats: this is a lookup, and a reader has to be able
 * to reproduce the winner by hand.
 */
const SLOT_WEIGHT: Record<ImageLabSlot, number> = {
  product: 3,
  oneLiner: 2,
  pitch: 1,
  sale: 1,
};

/**
 * Lower-cased, letters-only, space-padded.
 *
 * Everything that is not an ASCII letter becomes a space — digits, punctuation,
 * emoji, CJK, Cyrillic, the lot — so a keyword can only ever match a run of Latin
 * letters at a word boundary. Non-Latin text therefore matches nothing and takes
 * the fallback, which is the correct and honest answer for input this vocabulary
 * cannot read.
 */
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z]+/gi, " ").trim()} `;
}

/**
 * One compiled matcher per keyword, built ONCE at module load.
 *
 * Non-global on purpose (`image-lab-rules` documents the shared-`lastIndex` trap
 * at length): a `/g` regex reused across requests in a warm serverless instance
 * makes one staff member's scan change another's result.
 *
 * `(?:s|es)?` is the only inflection allowed. A bare `\w*` suffix would let "cat"
 * match "catalogue" and quietly mis-file a business.
 */
function keywordMatcher(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}(?:s|es)?\\b`);
}

const CATEGORY_MATCHERS: readonly {
  readonly entry: CategoryEntry;
  readonly matchers: readonly RegExp[];
}[] = IMAGE_LAB_PRODUCT_CATEGORIES.map((entry) => ({
  entry,
  matchers: entry.keywords.map(keywordMatcher),
}));

const SETTING_MATCHERS: readonly {
  readonly entry: (typeof IMAGE_LAB_SCENE_SETTINGS)[number];
  readonly matchers: readonly RegExp[];
}[] = IMAGE_LAB_SCENE_SETTINGS.map((entry) => ({
  entry,
  matchers: entry.keywords.map(keywordMatcher),
}));

/** The four slots, normalized once, with their weights. Total: a missing or
 *  non-string slot contributes an empty haystack rather than throwing. */
function haystacks(values: CategorySlotValues | null | undefined): {
  text: string;
  weight: number;
}[] {
  return IMAGE_LAB_SLOTS.map((slot) => {
    const raw = values?.[slot];
    return {
      text: typeof raw === "string" ? normalize(raw) : " ",
      weight: SLOT_WEIGHT[slot],
    };
  });
}

// ── The derivation ───────────────────────────────────────────────────────────

export type DerivedCategoryPrompt = {
  /** The EXACT text that will be sent. Always a member of {@link allCategoryPrompts}. */
  readonly text: string;
  readonly category: ImageLabProductCategory;
  readonly setting: ImageLabSceneSetting;
  /** False ⇒ nothing in the vocabulary matched and {@link CATEGORY_FALLBACK_ID}
   *  was used. NEVER a signal to fall back to the child's text. */
  readonly matched: boolean;
};

/**
 * A child's slot values → a drawable prompt built from the closed vocabulary
 * above, and from NOTHING ELSE.
 *
 * ⚠ THE INPUT IS READ, NEVER CARRIED. Every character of the output comes from
 * this module's own constants; the input's only effect is to SELECT among them.
 * That is what makes the "no substring of the child's input" property structural
 * rather than a filter someone has to keep up to date.
 *
 * Deterministic tie-break: the highest weighted score wins, and equal scores are
 * broken by declaration order in {@link IMAGE_LAB_PRODUCT_CATEGORIES}. A `Map`
 * iteration order or a `sort` without a total comparator would let two runs of the
 * same input disagree, which would break the consistency drill the Lab exists to
 * run.
 */
export function deriveCategoryPrompt(
  values: CategorySlotValues | null | undefined
): DerivedCategoryPrompt {
  const fields = haystacks(values);

  let best: CategoryEntry = FALLBACK_CATEGORY;
  let bestScore = 0;
  for (const { entry, matchers } of CATEGORY_MATCHERS) {
    let score = 0;
    for (const field of fields) {
      for (const matcher of matchers) {
        if (matcher.test(field.text)) score += field.weight;
      }
    }
    // Strictly greater: declaration order breaks a tie, so the winner is stable.
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  const matched = bestScore > 0;

  let setting = best.setting as ImageLabSceneSetting;
  let settingScore = 0;
  for (const { entry, matchers } of SETTING_MATCHERS) {
    let score = 0;
    for (const field of fields) {
      for (const matcher of matchers) {
        if (matcher.test(field.text)) score += field.weight;
      }
    }
    if (score > settingScore) {
      settingScore = score;
      setting = entry.id;
    }
  }

  const settingPhrase =
    IMAGE_LAB_SCENE_SETTINGS.find((entry) => entry.id === setting)?.phrase ??
    IMAGE_LAB_SCENE_SETTINGS[0].phrase;

  return {
    text: frameCategoryPrompt(best.phrase, settingPhrase),
    category: best.id as ImageLabProductCategory,
    setting,
    matched,
  };
}

/**
 * EVERY string {@link deriveCategoryPrompt} can ever return.
 *
 * ⚠ THIS IS THE PROOF, NOT A CONVENIENCE. The suite asserts that a derived prompt
 * over a table of hostile inputs — a child's name in the pitch, a brand name, an
 * emoji, an 8000-character pitch, non-Latin script — is a MEMBER of this set. A
 * membership assertion against a set fixed in source cannot be satisfied by any
 * string containing child text, which is a stronger and more durable claim than
 * any list of forbidden substrings.
 *
 * 25 categories (24 + the fallback) × 8 settings = 200 possible prompts for the
 * whole cohort, forever.
 */
export function allCategoryPrompts(): string[] {
  const categories = [...IMAGE_LAB_PRODUCT_CATEGORIES, FALLBACK_CATEGORY];
  const out: string[] = [];
  for (const category of categories) {
    for (const setting of IMAGE_LAB_SCENE_SETTINGS) {
      out.push(frameCategoryPrompt(category.phrase, setting.phrase));
    }
  }
  return out;
}

/**
 * THE SET, MEMOIZED — and {@link isCategoryDerivedPrompt} is what the dispatch
 * gate actually asks.
 *
 * ⚠ MEMBERSHIP, NOT `text === deriveCategoryPrompt(slots).text`. The equality
 * check looks equivalent and is strictly weaker: if a future edit ever made
 * `deriveCategoryPrompt` fall back to the child's own text on an unrecognized
 * category, an equality gate would compare that text against itself and PASS,
 * waving the exact payload the gate exists to stop straight through to OpenAI.
 * Membership of a set fixed in source cannot be satisfied that way, and
 * `category-prompt-rules.test.ts` pins the difference.
 */
const DERIVED_PROMPTS = new Set(allCategoryPrompts());

export function isCategoryDerivedPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && DERIVED_PROMPTS.has(text);
}

/** Every distinct word that can appear in any derived prompt. Used by the suite
 *  to prove a vendor can only ever be told words this file already contains. */
export function categoryPromptVocabulary(): Set<string> {
  const words = new Set<string>();
  for (const prompt of allCategoryPrompts()) {
    for (const word of prompt.toLowerCase().split(/[^a-z]+/)) {
      if (word !== "") words.add(word);
    }
  }
  return words;
}
