import { describe, expect, it } from "vitest";
import {
  allCategoryPrompts,
  categoryPromptVocabulary,
  deriveCategoryPrompt,
  isCategoryDerivedPrompt,
  CATEGORY_FALLBACK_ID,
  IMAGE_LAB_PRODUCT_CATEGORIES,
  IMAGE_LAB_SCENE_SETTINGS,
  type CategorySlotValues,
} from "../category-prompt-rules";

/**
 * THE CLASSIFIER'S FOUR GUARANTEES, ASSERTED RATHER THAN DESCRIBED.
 *
 * This module is the only thing standing between a child's authored business text
 * and an OpenAI endpoint that, by OpenAI's own under-18 guidance, may not process
 * an under-13's personal data without zero data retention we do not have. So the
 * properties are tested as PROPERTIES over a table of hostile inputs, not as three
 * happy-path examples:
 *
 *   1. closed-vocabulary output (membership in a finite set fixed in source);
 *   2. no distinctive substring of the input survives into the output;
 *   3. non-invertibility — different wording, same business kind, same category;
 *   4. an explicit fallback, never a passthrough.
 *
 * There is no jsdom in this suite and no network anywhere near this file, which is
 * the point: a classifier that needed a model call could not be asserted at all.
 */

// ── The table. Every row is something a real child has plausibly typed. ──────

const CASES: readonly { name: string; slots: CategorySlotValues }[] = [
  {
    name: "a child's own name in the product AND the pitch",
    slots: {
      product: "Maya's Dog Treats",
      oneLiner: "Healthy dog treats made by Maya",
      pitch:
        "Hi! My name is Maya and I bake peanut butter dog treats for the dogs on my street.",
      sale: "Sold 6 bags to my neighbour",
    },
  },
  {
    name: "a brand name a child invented",
    slots: {
      product: "CardsByMaya",
      oneLiner: "CardsByMaya makes birthday cards",
      pitch: "I draw greeting cards and sell them at the school fair.",
    },
  },
  {
    name: "emoji, and nothing but emoji in one slot",
    slots: { product: "🍪🍪🍪", oneLiner: "cookies 🍪 from my kitchen", pitch: "🎉🎉" },
  },
  {
    name: "a very long pitch",
    slots: {
      product: "slime",
      pitch: `I make slime. ${"It is really stretchy and it smells nice. ".repeat(200)}`,
    },
  },
  {
    name: "non-Latin script",
    slots: {
      product: "手作りクッキー",
      oneLiner: "Кексы и печенье своими руками",
      pitch: "أنا أصنع الحلوى في المنزل",
    },
  },
  {
    name: "digits the child wrote",
    slots: {
      product: "3 for $5 bracelets",
      oneLiner: "Beaded bracelets, 3 for 5 dollars",
      sale: "Sold 12 on 2026-08-01 to apartment 7B",
    },
  },
  {
    name: "nothing this vocabulary recognizes",
    slots: { product: "zzqqx", oneLiner: "flurbulating widgets", pitch: "quorbling" },
  },
  { name: "empty slots", slots: {} },
];

/**
 * The tokens whose survival would be a leak.
 *
 * ⚠ NOT "every substring", DELIBERATELY, and the honesty matters. The derived
 * prompt is English, and so is a child's pitch, so the two inevitably share words
 * like "and" or "small". What must never survive is anything DISTINCTIVE — a name,
 * a brand, a number, a script we cannot read — and "distinctive" here is given a
 * mechanical definition: a WORD of the input that is not already a word in this
 * module's own closed vocabulary.
 *
 * ⚠ COMPARED AT WORD BOUNDARIES, NOT AS RAW SUBSTRINGS, and the two rows that
 * forced this are worth recording rather than smoothing over: the input word
 * "name" is a substring of the output's "brand names", and "draw" is a substring
 * of "hand-drawn". Neither is a leak — the output contained those letters before
 * it ever saw the input — and a raw-substring rule would have been satisfied only
 * by writing a vocabulary that avoided every English stem a child might use, which
 * is not a property anyone could maintain. The STRONGER claim is proved outright
 * by the membership test above: the output is a member of a set enumerated from
 * source constants, so it cannot contain input text at all.
 */
function distinctiveTokens(slots: CategorySlotValues): string[] {
  const vocabulary = categoryPromptVocabulary();
  const text = Object.values(slots).join(" ").toLowerCase();
  const tokens = text.split(/[^a-z]+/).filter((t) => t.length >= 3);
  return [...new Set(tokens)].filter((t) => !vocabulary.has(t));
}

describe("deriveCategoryPrompt — the closed vocabulary is the whole guarantee", () => {
  const universe = new Set(allCategoryPrompts());

  it.each(CASES)(
    "$name → a prompt that is a MEMBER of the fixed set, and nothing else",
    ({ slots }) => {
      const derived = deriveCategoryPrompt(slots);
      // ⚠ THE LOAD-BEARING ASSERTION. Membership in a set enumerated from source
      // constants cannot be satisfied by any string containing the child's text,
      // which is a stronger claim than any list of forbidden substrings could be.
      expect(universe.has(derived.text)).toBe(true);
      expect(isCategoryDerivedPrompt(derived.text)).toBe(true);
    }
  );

  it.each(CASES)(
    "$name → contains NO distinctive substring of any slot value",
    ({ slots }) => {
      const words = new Set(
        deriveCategoryPrompt(slots).text.toLowerCase().split(/[^a-z]+/)
      );
      for (const token of distinctiveTokens(slots)) {
        expect(words.has(token), `leaked "${token}"`).toBe(false);
      }
    }
  );

  it("never carries a name, a brand, a digit, an emoji or non-Latin script", () => {
    for (const { slots } of CASES) {
      const text = deriveCategoryPrompt(slots).text;
      expect(text.toLowerCase()).not.toContain("maya");
      expect(text.toLowerCase()).not.toContain("cardsbymaya");
      expect(text).not.toContain("🍪");
      expect(text).not.toContain("手作り");
      expect(text).not.toContain("Кексы");
      // ⚠ NO DIGIT, EVER. A price, a quantity, a date or a flat number is
      // identifying in combination and carries nothing a panel needs.
      expect(text).not.toMatch(/[0-9]/);
    }
  });

  it("is TOTAL — undefined, null and junk all yield something drawable", () => {
    for (const input of [undefined, null, {}, { product: "" }] as const) {
      const derived = deriveCategoryPrompt(input as CategorySlotValues | null | undefined);
      expect(universe.has(derived.text)).toBe(true);
      expect(derived.text.length).toBeGreaterThan(40);
    }
  });

  it("is DETERMINISTIC — the same slots yield a byte-identical string", () => {
    // The consistency drill runs the same input repeatedly; a classifier whose
    // answer wobbled would make every such run incomparable with itself.
    for (const { slots } of CASES) {
      const a = deriveCategoryPrompt(slots);
      const b = deriveCategoryPrompt({ ...slots });
      expect(a.text).toBe(b.text);
      expect(a.category).toBe(b.category);
      expect(a.setting).toBe(b.setting);
    }
  });
});

describe("non-invertibility", () => {
  /**
   * ⚠ THE PROPERTY THAT MAKES THIS A CATEGORY AND NOT AN ENCODING. If two
   * children's different wording produced two different prompts, the prompt would
   * be a lossy but real channel for the wording — and the whole exercise would be
   * obfuscation rather than removal.
   */
  it("two children, different wording, same kind of business → SAME category", () => {
    const first = deriveCategoryPrompt({
      product: "friendship bracelets",
      oneLiner: "I make bracelets with beads for my friends",
      pitch: "Every bracelet is a different colour and I make them myself.",
    });
    const second = deriveCategoryPrompt({
      product: "handmade necklaces",
      oneLiner: "Beaded jewelry, one of a kind",
      pitch: "I string beads into necklaces and sell them at my mum's office.",
    });
    expect(first.category).toBe(second.category);
    expect(first.matched).toBe(true);
    expect(second.matched).toBe(true);
  });

  it("the whole cohort can only ever produce a couple of hundred strings", () => {
    // 24 categories + the fallback, × 8 settings. Stated as arithmetic over the
    // constants so adding a category cannot quietly make the space large enough
    // to start being invertible again.
    const expected =
      (IMAGE_LAB_PRODUCT_CATEGORIES.length + 1) * IMAGE_LAB_SCENE_SETTINGS.length;
    expect(allCategoryPrompts()).toHaveLength(expected);
    expect(new Set(allCategoryPrompts()).size).toBe(expected);
    expect(expected).toBeLessThanOrEqual(250);
  });

  it("the vocabulary is modest — a couple of dozen categories, not a taxonomy", () => {
    expect(IMAGE_LAB_PRODUCT_CATEGORIES.length).toBeLessThanOrEqual(24);
    expect(new Set(IMAGE_LAB_PRODUCT_CATEGORIES.map((c) => c.id)).size).toBe(
      IMAGE_LAB_PRODUCT_CATEGORIES.length
    );
  });
});

describe("the explicit fallback", () => {
  /**
   * ⚠ THE NAMED TEST FOR MUTATION (a). Letting an unmatched input fall back to the
   * child's own text is the single most tempting "small" edit in this module — it
   * looks like graceful degradation and it is the vulnerability itself. This test,
   * and the OpenAI dispatch gate in `run-core.test.ts`, both redden on it.
   */
  it("an unrecognized business yields the FALLBACK category, never passthrough", () => {
    const slots: CategorySlotValues = {
      product: "quorbling flurbulator",
      oneLiner: "zzqqx services for the discerning zzqqx",
      pitch: "wibbleflam",
    };
    const derived = deriveCategoryPrompt(slots);

    expect(derived.matched).toBe(false);
    expect(derived.category).toBe(CATEGORY_FALLBACK_ID);
    // …and, explicitly, NOT the input.
    expect(derived.text).not.toContain("quorbling");
    expect(derived.text).not.toContain("zzqqx");
    expect(derived.text).not.toContain("wibbleflam");
    expect(isCategoryDerivedPrompt(derived.text)).toBe(true);
  });

  it("a matched business does NOT take the fallback", () => {
    const derived = deriveCategoryPrompt({ product: "dog treats" });
    expect(derived.matched).toBe(true);
    expect(derived.category).not.toBe(CATEGORY_FALLBACK_ID);
  });
});

describe("isCategoryDerivedPrompt — the gate's actual question", () => {
  it("accepts every string the derivation can produce, and nothing else", () => {
    for (const prompt of allCategoryPrompts()) {
      expect(isCategoryDerivedPrompt(prompt)).toBe(true);
    }
    expect(isCategoryDerivedPrompt("Draw Maya's dog treat stand")).toBe(false);
    expect(isCategoryDerivedPrompt("")).toBe(false);
    expect(isCategoryDerivedPrompt(null)).toBe(false);
    expect(isCategoryDerivedPrompt(undefined)).toBe(false);
    // A near-miss: the real thing with one word changed.
    expect(isCategoryDerivedPrompt(allCategoryPrompts()[0]! + " Also draw Maya.")).toBe(
      false
    );
  });
});
