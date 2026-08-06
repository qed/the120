import { afterEach, describe, expect, it } from "vitest";
import {
  extractPickerIdeas,
  firstNameIsScrubbable,
  isImageLabRealContentLive,
  listPickerChildren,
  listPickerIdeas,
  nameTokensFor,
  pickSlotValues,
  scrubNames,
  summarizeSales,
  IMAGE_LAB_NAME_REDACTION,
  type ContentPickerDeps,
  type PickerChildRow,
  type SaleRow,
} from "../content-picker-core";

/**
 * The child-content picker (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 5; origin R12, R12a,
 * R15, R17).
 *
 * This is the module that reads CHILD DATA and hands it to a third-party model,
 * so its four protections each have their own named test: the flag, the
 * docVersion gate, the test-family exclusion, and the name scrub. Deleting any
 * one of them reddens here.
 */

/** The staff member every fill in this suite is minted for. The real token binds
 *  it, so the fake carries it too. */
const STAFF = "staff-1";

const MAYA: PickerChildRow = {
  childId: "child-1",
  profileId: "profile-1",
  firstName: "Maya",
  lastName: "Chen",
  username: "maya.chen@example.com",
  isTest: false,
};

const doc = (over: Record<string, unknown> = {}) => ({
  docVersion: 1,
  ideas: [
    {
      id: "idea-a",
      fields: {
        productName: "Maya's Street Cards",
        oneLiner: "Cards that tell your street's story",
        pitchHook: "Hi, I'm Maya, and I make collectible cards.",
        pitchWhat: "Each card is a local person or place.",
        pitchWhy: "They make community history fun.",
        pitchAsk: "Grab your first pack today.",
      },
    },
  ],
  ...over,
});

function makeDeps(over: Partial<ContentPickerDeps> = {}): ContentPickerDeps {
  return {
    isLive: () => true,
    listChildren: async () => [MAYA],
    findChild: async (id) => (id === MAYA.childId ? MAYA : null),
    loadSaveDoc: async () => doc(),
    loadSales: async () => [],
    // A deterministic stand-in for the HMAC. The real minting is asserted in
    // `source-token.test.ts`; here it only has to be a value the fill carries.
    // ⚠ THE STAFF ID IS IN THE TOKEN. The real minter binds it so a token cannot
    // be replayed by another staff session onto another compose — which would
    // attach source_child_id, the column the revocation purge keys on, to a run
    // holding none of that child's content.
    mintSourceToken: (p, staffId) =>
      `tok:${p.childId}:${p.ideaId ?? ""}:${p.taskId ?? ""}:${staffId}`,
    ...over,
  };
}

// ── 1. The flag ──────────────────────────────────────────────────────────────

describe("IMAGE_LAB_REAL_CONTENT_LIVE gates the whole picker", () => {
  const offDeps = makeDeps({
    isLive: () => false,
    listChildren: async () => {
      throw new Error("must not be reached");
    },
    findChild: async () => {
      throw new Error("must not be reached");
    },
    loadSaveDoc: async () => {
      throw new Error("must not be reached");
    },
  });

  it("refuses every entry point WITHOUT touching a child table", async () => {
    expect(await listPickerChildren(offDeps)).toEqual({ ok: false, reason: "disabled" });
    expect(await listPickerIdeas(offDeps, MAYA.childId)).toEqual({
      ok: false,
      reason: "disabled",
    });
    expect(await pickSlotValues(offDeps, { childId: MAYA.childId, staffId: STAFF })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });
});

// ── 2. The docVersion gate ───────────────────────────────────────────────────

describe("the save doc is read ONLY at a known docVersion", () => {
  it("SKIPS an unknown version rather than parsing it", async () => {
    // "Unknown version" means we do not know what the keys mean; reading
    // `fields.oneLiner` out of it would put arbitrary child text under a slot
    // name the prompt trusts.
    expect(extractPickerIdeas(doc({ docVersion: 99 }))).toBeNull();
    expect(extractPickerIdeas(doc({ docVersion: "1" }))).toBeNull();
    expect(extractPickerIdeas({ ideas: [{ fields: { productName: "x" } }] })).toBeNull();
    expect(extractPickerIdeas(null)).toBeNull();
  });

  it("a skipped doc yields NO ideas and empty slots, never a crash", async () => {
    const deps = makeDeps({ loadSaveDoc: async () => doc({ docVersion: 42 }) });
    const ideas = await listPickerIdeas(deps, MAYA.childId);
    // ⚠ `docReadable: false` IS A DIFFERENT FACT FROM "no ideas", and it gets
    // its own copy: telling a staff member the child has nothing saved invites
    // them to type the content in by hand, which bypasses the scrub entirely.
    expect(ideas).toEqual({ ok: true, ideas: [], docReadable: false });

    const filled = await pickSlotValues(deps, { childId: MAYA.childId, staffId: STAFF });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(filled.docReadable).toBe(false);
    expect(filled.slots).toEqual({ product: "", oneLiner: "", pitch: "", sale: "" });
    expect([...filled.emptySlots].sort()).toEqual([
      "oneLiner",
      "pitch",
      "product",
      "sale",
    ]);
  });

  it("a child with ZERO ideas yields explicit empties", async () => {
    const deps = makeDeps({ loadSaveDoc: async () => ({ docVersion: 1, ideas: [] }) });
    const filled = await pickSlotValues(deps, { childId: MAYA.childId, staffId: STAFF });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(Object.keys(filled.slots).sort()).toEqual([
      "oneLiner",
      "pitch",
      "product",
      "sale",
    ]);
    expect(filled.ideaId).toBeNull();
  });

  it("a malformed idea element is skipped rather than thrown on", () => {
    const ideas = extractPickerIdeas({
      docVersion: 1,
      ideas: [null, "nope", 7, { fields: null }, { fields: { productName: "ok" } }],
    });
    expect(ideas).not.toBeNull();
    expect(ideas!.map((i) => i.productName)).toEqual(["", "ok"]);
  });

  it("joins the four pitch beats, falling back to a legacy single block", () => {
    const beats = extractPickerIdeas(doc())![0]!;
    expect(beats.pitch).toContain("Hi, I'm Maya");
    expect(beats.pitch).toContain("Grab your first pack today.");

    const legacy = extractPickerIdeas({
      docVersion: 1,
      ideas: [{ fields: { pitch: "one block" } }],
    })![0]!;
    expect(legacy.pitch).toBe("one block");
  });
});

// ── 3. The name scrub ────────────────────────────────────────────────────────

describe("the child's own name and username are scrubbed", () => {
  it("removes the first name from a first-person pitch, possessive intact", async () => {
    // A first-person pitch conventionally OPENS with the child's name. This is
    // the hard requirement from the Unit 1 security review.
    const filled = await pickSlotValues(makeDeps(), { childId: MAYA.childId, staffId: STAFF });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;

    const everything = Object.values(filled.slots).join(" ");
    expect(everything).not.toMatch(/maya/i);
    expect(everything).not.toMatch(/chen/i);
    expect(filled.slots.pitch).toContain(`I'm ${IMAGE_LAB_NAME_REDACTION},`);
    expect(filled.slots.product).toBe(`${IMAGE_LAB_NAME_REDACTION}'s Street Cards`);
    expect(filled.scrubbed).toBe(true);
  });

  it("scrubs EVERY slot, not only the pitch", () => {
    const tokens = nameTokensFor({ firstName: "Maya" });
    expect(scrubNames("Maya's Cards", tokens)).toBe(`${IMAGE_LAB_NAME_REDACTION}'s Cards`);
    expect(scrubNames("made by maya", tokens)).toBe(`made by ${IMAGE_LAB_NAME_REDACTION}`);
  });

  it("decomposes an EMAIL-SHAPED username into the names prose actually uses", () => {
    // Usernames on this project may be email-shaped (the120#129). Scrubbing only
    // the whole string removes something that never appears in prose while
    // leaving the two parts that do.
    const tokens = nameTokensFor({ username: "maya.chen@example.com" });
    expect(tokens).toContain("maya");
    expect(tokens).toContain("chen");
    expect(scrubNames("ask chen about it", tokens)).toContain(IMAGE_LAB_NAME_REDACTION);
  });

  it("splits ONLY the local part of an email-shaped handle", () => {
    // ⚠ `icloud` AND `com` ARE NOBODY'S NAME. Splitting the whole string put two
    // cohort-wide strings into the redaction set, so every slot of every run for
    // that child came back with holes in it — degrading the very prompt whose
    // output quality this bench exists to measure.
    const tokens = nameTokensFor({ username: "bakery.kid@icloud.com" });
    expect(tokens).toContain("bakery");
    expect(tokens).toContain("kid");
    expect(tokens).toContain("bakery.kid@icloud.com");
    expect(tokens).not.toContain("icloud");
    expect(tokens).not.toContain("com");
    expect(scrubNames("Order from icloud.com backups", tokens)).toBe(
      "Order from icloud.com backups"
    );
  });

  it("still decomposes a NON-email handle, which has no domain to protect", () => {
    const tokens = nameTokensFor({ username: "maya_chen" });
    expect(tokens).toContain("maya");
    expect(tokens).toContain("chen");
  });

  it("replaces the longest token first, so a compound never becomes two markers", () => {
    // ⚠ THE FIXTURE MATTERS. `{firstName:"Ann", username:"annabel"}` CANNOT tell
    // the sort apart from its absence — the boundary rule already prevents "Ann"
    // matching inside "annabel". This one can: without the longest-first sort,
    // "Ann" and "Bel" both match and the result is "[name].[name]".
    const tokens = nameTokensFor({ firstName: "Ann", username: "Ann.Bel" });
    expect(scrubNames("Ann.Bel", tokens)).toBe(IMAGE_LAB_NAME_REDACTION);
    expect(scrubNames("Ann.Bel", tokens)).not.toBe(
      `${IMAGE_LAB_NAME_REDACTION}.${IMAGE_LAB_NAME_REDACTION}`
    );
    // The sort lives in `scrubNames`, so the caller's order cannot defeat it —
    // handed the SHORTEST first, it still replaces the compound.
    expect(scrubNames("Ann.Bel", ["Ann", "Bel", "Ann.Bel"])).toBe(
      IMAGE_LAB_NAME_REDACTION
    );
  });

  it("removes a REAL two-character name", () => {
    // ⚠ MIN_SCRUBBABLE_TOKEN IS A FLOOR, NOT A SUGGESTION. Children are called
    // Jo, Al, Bo and Vi; with no two-character fixture the suite cannot tell 2
    // from 3, and 3 ships those children's names to OpenAI with everything green.
    for (const name of ["Jo", "Al", "Bo", "Vi"]) {
      const tokens = nameTokensFor({ firstName: name });
      expect(tokens).toContain(name);
      expect(scrubNames(`Hi, I'm ${name}.`, tokens)).toBe(
        `Hi, I'm ${IMAGE_LAB_NAME_REDACTION}.`
      );
    }
  });

  it("matches across an ACCENT MISMATCH, in BOTH directions", () => {
    // An accent typed in one field and omitted in the other is routine, and it
    // used to make the scrub a complete no-op for that child.
    expect(scrubNames("Hi, I'm José", nameTokensFor({ firstName: "Jose" }))).toBe(
      `Hi, I'm ${IMAGE_LAB_NAME_REDACTION}`
    );
    expect(scrubNames("Hi, I'm Jose", nameTokensFor({ firstName: "José" }))).toBe(
      `Hi, I'm ${IMAGE_LAB_NAME_REDACTION}`
    );
    // NFC vs NFD are the same name written two ways.
    const nfd = "José".normalize("NFD");
    const nfc = "José".normalize("NFC");
    expect(scrubNames(`by ${nfd}`, nameTokensFor({ firstName: nfc }))).toBe(
      `by ${IMAGE_LAB_NAME_REDACTION}`
    );
    // Turkish dotted/dotless I, which no amount of NFD reaches on its own.
    expect(scrubNames("by İrem", nameTokensFor({ firstName: "Irem" }))).toBe(
      `by ${IMAGE_LAB_NAME_REDACTION}`
    );
    expect(scrubNames("by Irem", nameTokensFor({ firstName: "İrem" }))).toBe(
      `by ${IMAGE_LAB_NAME_REDACTION}`
    );
  });

  it("keeps the SURVIVING text's own accents and capitals", () => {
    // The match runs on a fold; the redaction lands in the ORIGINAL, so the rest
    // of the prompt is not silently lowercased and stripped on its way to a model.
    expect(scrubNames("Maya's CAFÉ Crème", nameTokensFor({ firstName: "Maya" }))).toBe(
      `${IMAGE_LAB_NAME_REDACTION}'s CAFÉ Crème`
    );
  });

  it("removes the name from a PLURAL, a COMPOUND and a DIGIT-SUFFIXED brand", () => {
    // ⚠ THE WIDEST HOLE THIS SCRUB EVER HAD. A dropped apostrophe or a
    // camel-cased brand name is how a nine-year-old writes their own business
    // name, and a plain "not followed by an alphanumeric" guard left all of it.
    const maya = nameTokensFor({ firstName: "Maya" });
    expect(scrubNames("Welcome to Mayas Cards! Mayas Cards is by Maya.", maya)).not.toMatch(
      /maya/i
    );
    expect(scrubNames("MayaCorp presents MAYA123 and Maya's kit", maya)).not.toMatch(/maya/i);

    const sofia = nameTokensFor({ firstName: "Sofia" });
    expect(
      scrubNames("Sofia’s Bakery and Sofias Bakery and SofiaRossi", sofia)
    ).not.toMatch(/sofia/i);
  });

  /**
   * ⚠ THE FOURTH LEAK, AND THE SUITE'S OWN BLIND SPOT IS WHY IT SURVIVED.
   *
   * The compound/inflection rule was only ever added to the TRAILING side, and
   * every fixture above is a trailing-side fixture — so `leadingBoundaryOk` stayed
   * a plain "the preceding character is not alphanumeric" test with no case and no
   * digit awareness, and a token preceded by an alphanumeric was rejected
   * outright. Verified against the shipped functions with the whole suite green:
   * `MayaCorp` and `Maya123` were caught (they start at index 0) while
   * `CardsByMaya`, `SuperMaya`, `TeamMaya`, `xoxoMaya`, `shopmaya.com` and
   * `2Maya` ALL LEAKED — and `{{product}}` / `{{oneLiner}}` are exactly where a
   * run-together brand name lives.
   */
  it.each([
    ["CardsByMaya", "a capital after a lower-case letter"],
    ["SuperMaya", "a compound with a prefix"],
    ["TeamMaya", "the same, one word"],
    ["xoxoMaya", "a handle-shaped prefix"],
    ["shopmaya.com", "an all-lower-case run-together host"],
    ["2Maya", "a capital after a DIGIT"],
  ])("removes the name from %s (%s) — the leading-side leaks", (text) => {
    const maya = nameTokensFor({ firstName: "Maya" });
    expect(scrubNames(text, maya), text).not.toMatch(/maya/i);
    expect(scrubNames(text, maya), text).toContain(IMAGE_LAB_NAME_REDACTION);
  });

  it("still leaves ordinary words alone — over-scrub is the trade, not the goal", () => {
    // The TRAILING rule is what keeps the new leading clauses from eating the
    // middle of a word: `sample` survives a child called Sam because `p` is
    // neither a boundary, an inflecting `s`, a capital nor a digit.
    expect(scrubNames("a free sample", nameTokensFor({ firstName: "Sam" }))).toBe(
      "a free sample"
    );
    expect(scrubNames("Chenille cushions", nameTokensFor({ lastName: "Chen" }))).toBe(
      "Chenille cushions"
    );
  });

  it("scrubs a NON-LATIN given name, where the two-character floor is meaningless", () => {
    // ⚠ THIS USED TO PRODUCE ZERO TOKENS. One CJK character IS a whole given
    // name, so an ASCII character count applied to it made the scrub a no-op
    // that still reported success — the surface asserting a protection that did
    // not run, which is worse than no protection.
    const tokens = nameTokensFor({ firstName: "美", lastName: "王", username: "mw" });
    expect(tokens).toContain("美");
    expect(tokens).toContain("王");
    const scrubbed = scrubNames("你好，我是美王", tokens);
    expect(scrubbed).not.toContain("美");
    expect(scrubbed).not.toContain("王");
    expect(scrubbed).toContain(IMAGE_LAB_NAME_REDACTION);
  });

  it("pins the DOCUMENTED shapes: hyphenated, apostrophe, and the over-eager case", () => {
    expect(scrubNames("Anne-Marie sells", nameTokensFor({ firstName: "Anne-Marie" }))).toBe(
      `${IMAGE_LAB_NAME_REDACTION} sells`
    );
    expect(scrubNames("O'Brien sells", nameTokensFor({ lastName: "O'Brien" }))).toBe(
      `${IMAGE_LAB_NAME_REDACTION} sells`
    );
    // ⚠ DELIBERATELY OVER-EAGER, and pinned so nobody "fixes" it into a leak.
    // An over-scrubbed prompt makes a slightly worse picture; an under-scrubbed
    // one sends a real child's name to a vendor.
    expect(scrubNames("Art sells art supplies", nameTokensFor({ firstName: "Art" }))).toBe(
      `${IMAGE_LAB_NAME_REDACTION} sells ${IMAGE_LAB_NAME_REDACTION} supplies`
    );
  });

  it("reports scrubCovered=false rather than claiming a scrub that could not run", () => {
    // A roster first name yielding no token makes the scrub a no-op. The UI must
    // NOT then render "the child's first name is removed from every slot".
    expect(firstNameIsScrubbable("Maya")).toBe(true);
    expect(firstNameIsScrubbable("美")).toBe(true);
    expect(firstNameIsScrubbable("J")).toBe(false);
    expect(firstNameIsScrubbable("")).toBe(false);
    expect(firstNameIsScrubbable(null)).toBe(false);
  });

  it("does not scrub a name that is merely a SUBSTRING of another word", () => {
    const tokens = nameTokensFor({ firstName: "Sam" });
    expect(scrubNames("the same sample", tokens)).toBe("the same sample");
    expect(scrubNames("Sam sells", tokens)).toBe(`${IMAGE_LAB_NAME_REDACTION} sells`);
  });

  it("ignores a one-character token, which would redact every letter", () => {
    expect(nameTokensFor({ firstName: "A" })).toEqual([]);
    expect(scrubNames("A cat", [])).toBe("A cat");
  });

  it("leaves a value untouched when there is nothing to remove", async () => {
    const anon: PickerChildRow = { ...MAYA, firstName: "", lastName: "", username: null };
    const deps = makeDeps({
      findChild: async () => anon,
      loadSaveDoc: async () => ({
        docVersion: 1,
        ideas: [{ fields: { productName: "Street Cards" } }],
      }),
    });
    const filled = await pickSlotValues(deps, { childId: anon.childId, staffId: STAFF });
    if (!filled.ok) return;
    expect(filled.slots.product).toBe("Street Cards");
    expect(filled.scrubbed).toBe(false);
  });
});

// ── 4. Test families ─────────────────────────────────────────────────────────

describe("test families are excluded, NULL-safely", () => {
  const rows: PickerChildRow[] = [
    { ...MAYA, childId: "real-false", isTest: false },
    { ...MAYA, childId: "real-null", isTest: null },
    { ...MAYA, childId: "test-family", isTest: true },
  ];

  it("drops only an explicit true — false AND null are real families", async () => {
    const listed = await listPickerChildren(makeDeps({ listChildren: async () => rows }));
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.children.map((c) => c.childId)).toEqual(["real-false", "real-null"]);
  });

  it("refuses to fill slots from a test family's child", async () => {
    const deps = makeDeps({
      findChild: async () => ({ ...MAYA, isTest: true }),
    });
    expect(await pickSlotValues(deps, { childId: MAYA.childId, staffId: STAFF })).toEqual({
      ok: false,
      reason: "unknown_child",
    });
    expect(await listPickerIdeas(deps, MAYA.childId)).toEqual({
      ok: false,
      reason: "unknown_child",
    });
  });

  it("refuses an unknown child id", async () => {
    const deps = makeDeps({ findChild: async () => null });
    expect(await pickSlotValues(deps, { childId: "nope", staffId: STAFF })).toEqual({
      ok: false,
      reason: "unknown_child",
    });
  });
});

// ── 5. The sale slot excludes the buyer ──────────────────────────────────────

describe("the sale slot carries money and timing, never a buyer", () => {
  const sales: SaleRow[] = [
    { amountCents: 600, source: "mock", createdAt: "2026-08-01T10:00:00.000Z" },
    { amountCents: 1200, source: "mock", createdAt: "2026-08-03T10:00:00.000Z" },
  ];

  it("summarizes totals and the most recent date", () => {
    const line = summarizeSales(sales);
    expect(line).toContain("$18.00");
    expect(line).toContain("2026-08-03");
    expect(line).toContain("2 sales");
  });

  it("says nothing at all when there are no sales", () => {
    expect(summarizeSales([])).toBe("");
  });

  it("the buyer's name is not an INPUT, so it cannot be an output", async () => {
    // `SaleRow` has no `payer` field and the loader never selects the column —
    // exclusion by construction rather than by filtering after the fact.
    const withPayer = [
      { ...sales[0]!, payer: "Mrs Alvarez" } as SaleRow & { payer: string },
    ];
    expect(summarizeSales(withPayer)).not.toContain("Alvarez");

    const filled = await pickSlotValues(
      makeDeps({ loadSales: async () => withPayer }),
      { childId: MAYA.childId, staffId: STAFF }
    );
    if (!filled.ok) return;
    expect(filled.slots.sale).not.toContain("Alvarez");
  });

  it("reports the exclusion as a CHIP, never as a silent blank", async () => {
    // A blank field reads as a missing value and a staff member types it back in
    // — reintroducing exactly what the exclusion removed.
    const filled = await pickSlotValues(makeDeps(), { childId: MAYA.childId, staffId: STAFF });
    if (!filled.ok) return;
    expect(filled.excluded).toHaveLength(1);
    expect(filled.excluded[0]!.slot).toBe("sale");
    expect(filled.excluded[0]!.field).toMatch(/buyer/i);
    expect(filled.excluded[0]!.why.length).toBeGreaterThan(20);
  });
});

// ── 6. Provenance ────────────────────────────────────────────────────────────

describe("provenance is ids only (origin R17)", () => {
  it("returns the child and idea ids the run row will record", async () => {
    const filled = await pickSlotValues(makeDeps(), {
      childId: MAYA.childId,
      ideaId: "idea-a",
      taskId: "1.1.2",
      staffId: STAFF,
    });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(filled.childId).toBe("child-1");
    expect(filled.ideaId).toBe("idea-a");
    expect(filled.taskId).toBe("1.1.2");
    // …and carries no name field of any kind.
    expect(Object.keys(filled)).not.toContain("firstName");
    expect(Object.keys(filled)).not.toContain("username");
  });

  it("REFUSES when the requested idea no longer resolves — never substitutes", async () => {
    // ⚠ THE OLD FALLBACK SPENT MONEY ON A DIFFERENT CHILD'S IDEA THAN THE ONE
    // SELECTED, and recorded THAT idea as `source_idea_id` — so the consent
    // audit trail pointed at the wrong one. Positional ids (`idea:2`) are
    // exactly the ones that move when the child edits between the two round
    // trips, which makes this the common case rather than the exotic one.
    expect(
      await pickSlotValues(makeDeps(), {
        childId: MAYA.childId,
        ideaId: "idea-that-was-deleted",
        staffId: STAFF,
      })
    ).toEqual({ ok: false, reason: "unknown_idea" });
  });

  it("flags a DEFAULTED idea so the composer can re-sync its select", async () => {
    const filled = await pickSlotValues(makeDeps(), { childId: MAYA.childId, staffId: STAFF });
    if (!filled.ok) return;
    expect(filled.ideaId).toBe("idea-a");
    expect(filled.substituted).toBe(true);

    const chosen = await pickSlotValues(makeDeps(), {
      childId: MAYA.childId,
      ideaId: "idea-a",
      staffId: STAFF,
    });
    if (!chosen.ok) return;
    expect(chosen.substituted).toBe(false);
  });

  it("degrades to `unavailable` rather than throwing when a read fails", async () => {
    const deps = makeDeps({
      loadSaveDoc: async () => {
        throw new Error("boom");
      },
    });
    expect(await pickSlotValues(deps, { childId: MAYA.childId, staffId: STAFF })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

// ── 6. The flag's own parser, EXECUTED ───────────────────────────────────────

describe("isImageLabRealContentLive is a real, executed allowlist", () => {
  const original = process.env.IMAGE_LAB_REAL_CONTENT_LIVE;
  afterEach(() => {
    if (original === undefined) delete process.env.IMAGE_LAB_REAL_CONTENT_LIVE;
    else process.env.IMAGE_LAB_REAL_CONTENT_LIVE = original;
  });

  /**
   * ⚠ NOTHING EXECUTED THIS FUNCTION. Every picker test injected `isLive`, so
   * mutating the parser to `return true` survived the whole suite — a flag that
   * fails OPEN on real children's authored text, invisible to CI. These cases
   * run the real thing through `process.env`.
   */
  const cases: [string | undefined, boolean][] = [
    [undefined, false],
    ["", false],
    // `=false` and `=0` are how an operator says "off" in a dashboard, and a
    // truthiness check reads both as ON.
    ["0", false],
    ["false", false],
    ["no", false],
    ["yes", false],
    ["on", false],
    ["1", true],
    ["true", true],
    ["TRUE", true],
    [" true ", true],
  ];

  it.each(cases)("%o → %s", (value, expected) => {
    if (value === undefined) delete process.env.IMAGE_LAB_REAL_CONTENT_LIVE;
    else process.env.IMAGE_LAB_REAL_CONTENT_LIVE = value;
    expect(isImageLabRealContentLive()).toBe(expected);
  });

  it("is read at CALL TIME, so flipping it does not need a cold start", () => {
    process.env.IMAGE_LAB_REAL_CONTENT_LIVE = "1";
    expect(isImageLabRealContentLive()).toBe(true);
    process.env.IMAGE_LAB_REAL_CONTENT_LIVE = "0";
    expect(isImageLabRealContentLive()).toBe(false);
  });
});
