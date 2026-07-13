import { describe, it, expect } from "vitest";
import {
  deriveStage,
  shouldClearOverride,
  suggestHeat,
  deriveNextMove,
  suggestedLibraryItems,
  type FamilyTruth,
  type FamilyForCopilot,
  type LibraryItemForSuggestion,
} from "@/app/crm/lib/engine";

/* ------------------------------------------------------------ deriveStage */

describe("deriveStage", () => {
  const base: FamilyTruth = {
    override: null,
    reviews: [],
    deposits: [],
    callBookedAt: null,
    callHeldAt: null,
    children: [],
    parentId: null,
  };

  it("manual lead with nothing → interested", () => {
    expect(deriveStage(base)).toBe("interested");
  });

  it("parent_id present → account_created", () => {
    expect(deriveStage({ ...base, parentId: "p1" })).toBe("account_created");
  });

  it("any child row (all draft) → dossier_started", () => {
    expect(
      deriveStage({ ...base, parentId: "p1", children: [{ status: "draft" }] })
    ).toBe("dossier_started");
  });

  it("any child status ≠ draft → dossier_submitted", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        children: [{ status: "submitted" }],
      })
    ).toBe("dossier_submitted");
  });

  it("call_booked_at → call_booked (outranks dossier)", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        children: [{ status: "submitted" }],
        callBookedAt: "2026-07-20T14:00:00Z",
      })
    ).toBe("call_booked");
  });

  it("call_held_at → call_held (outranks call_booked)", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        callBookedAt: "2026-07-20T14:00:00Z",
        callHeldAt: "2026-07-21T14:00:00Z",
      })
    ).toBe("call_held");
  });

  it("call_held_at set WITHOUT call_booked_at → call_held", () => {
    expect(
      deriveStage({ ...base, parentId: "p1", callHeldAt: "2026-07-21T14:00:00Z" })
    ).toBe("call_held");
  });

  it("any paid deposit → deposit_paid (outranks calls)", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        callHeldAt: "2026-07-21T14:00:00Z",
        deposits: [{ status: "paid" }],
      })
    ).toBe("deposit_paid");
  });

  it("any member review → member (outranks deposit)", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        deposits: [{ status: "paid" }],
        reviews: [{ review_status: "member" }],
      })
    ).toBe("member");
  });

  it("override lost with no higher truth → lost", () => {
    expect(
      deriveStage({ ...base, parentId: "p1", override: "lost" })
    ).toBe("lost");
  });

  it("override waitlist with no higher truth → waitlist", () => {
    expect(deriveStage({ ...base, override: "waitlist" })).toBe("waitlist");
  });

  // Decision 5: overrides are void against higher truth.
  it("override lost + paid deposit → deposit_paid (override void)", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        override: "lost",
        deposits: [{ status: "paid" }],
      })
    ).toBe("deposit_paid");
  });

  it("override waitlist + member review → member (override void)", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        override: "waitlist",
        reviews: [{ review_status: "member" }],
      })
    ).toBe("member");
  });

  it("override lost still wins over mid-funnel truth (call held)", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        override: "lost",
        callHeldAt: "2026-07-21T14:00:00Z",
      })
    ).toBe("lost");
  });

  // Multi-child matrix.
  it("multi-child: member review + draft sibling → member", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        children: [{ status: "draft" }, { status: "submitted" }],
        reviews: [{ review_status: "member" }, { review_status: "draft" }],
      })
    ).toBe("member");
  });

  it("multi-child: submitted + draft → dossier_submitted", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        children: [{ status: "submitted" }, { status: "draft" }],
      })
    ).toBe("dossier_submitted");
  });

  it("non-member reviews alone never make member", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        children: [{ status: "submitted" }],
        reviews: [{ review_status: "in_review" }, { review_status: "offered" }],
      })
    ).toBe("dossier_submitted");
  });

  it("paid + refunded deposits → deposit_paid (one paid is enough)", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        deposits: [{ status: "refunded" }, { status: "paid" }],
      })
    ).toBe("deposit_paid");
  });

  it("all deposits refunded → demotes to next truth (call_held)", () => {
    expect(
      deriveStage({
        ...base,
        parentId: "p1",
        deposits: [{ status: "refunded" }],
        callHeldAt: "2026-07-21T14:00:00Z",
      })
    ).toBe("call_held");
  });

  it("child rows deleted → falls back to account_created", () => {
    expect(
      deriveStage({ ...base, parentId: "p1", children: [] })
    ).toBe("account_created");
  });
});

/* ---------------------------------------------------- shouldClearOverride */

describe("shouldClearOverride", () => {
  const base: FamilyTruth = {
    override: null,
    reviews: [],
    deposits: [],
    callBookedAt: null,
    callHeldAt: null,
    children: [],
    parentId: "p1",
  };

  it("false when no override is set, even with paid deposit", () => {
    expect(
      shouldClearOverride({ ...base, deposits: [{ status: "paid" }] })
    ).toBe(false);
  });

  it("false when override set but no higher truth", () => {
    expect(
      shouldClearOverride({
        ...base,
        override: "lost",
        callHeldAt: "2026-07-21T14:00:00Z",
      })
    ).toBe(false);
  });

  it("true when override set and a deposit is paid", () => {
    expect(
      shouldClearOverride({
        ...base,
        override: "lost",
        deposits: [{ status: "paid" }],
      })
    ).toBe(true);
  });

  it("true when override set and a review is member", () => {
    expect(
      shouldClearOverride({
        ...base,
        override: "waitlist",
        reviews: [{ review_status: "member" }],
      })
    ).toBe(true);
  });

  it("false when override set and all deposits refunded", () => {
    expect(
      shouldClearOverride({
        ...base,
        override: "lost",
        deposits: [{ status: "refunded" }],
      })
    ).toBe(false);
  });
});

/* ------------------------------------------------------------ suggestHeat */

describe("suggestHeat", () => {
  it("interested base → 2", () => {
    expect(suggestHeat([], 0, "interested")).toBe(2);
  });

  it("account_created base → 3", () => {
    expect(suggestHeat([], 0, "account_created")).toBe(3);
  });

  it("dossier stages base → 3", () => {
    expect(suggestHeat([], 0, "dossier_started")).toBe(3);
    expect(suggestHeat([], 0, "dossier_submitted")).toBe(3);
  });

  it("call_booked base → 4 (documented choice: booked call signals intent)", () => {
    expect(suggestHeat([], 0, "call_booked")).toBe(4);
  });

  it("call_held base → 4", () => {
    expect(suggestHeat([], 0, "call_held")).toBe(4);
  });

  it("deposit_paid and member base → 5", () => {
    expect(suggestHeat([], 0, "deposit_paid")).toBe(5);
    expect(suggestHeat([], 0, "member")).toBe(5);
  });

  it("lost short-circuits to 1 even with 5 signals", () => {
    const five = [
      "explainer-sent",
      "gauntlet-played",
      "info-session",
      "group-sheet-sent",
      "parents-story-sent",
    ];
    expect(suggestHeat(five, 0, "lost")).toBe(1);
  });

  it("waitlist short-circuits to 1", () => {
    expect(suggestHeat(["info-session"], 0, "waitlist")).toBe(1);
  });

  it("3 signals → +1", () => {
    expect(
      suggestHeat(["explainer-sent", "gauntlet-played", "info-session"], 0, "interested")
    ).toBe(3);
  });

  it("5 signals → +2", () => {
    expect(
      suggestHeat(
        [
          "explainer-sent",
          "gauntlet-played",
          "info-session",
          "group-sheet-sent",
          "deposit-link-shared",
        ],
        0,
        "interested"
      )
    ).toBe(4);
  });

  it("15 days since touch → −1", () => {
    expect(suggestHeat([], 15, "account_created")).toBe(2);
  });

  it("22 days since touch → −2", () => {
    expect(suggestHeat([], 22, "account_created")).toBe(1);
  });

  it("boundary: exactly 14 days → no penalty, exactly 21 days → −1", () => {
    expect(suggestHeat([], 14, "account_created")).toBe(3);
    expect(suggestHeat([], 21, "account_created")).toBe(2);
  });

  it("clamps at 5: member with 5 signals stays 5", () => {
    expect(
      suggestHeat(
        [
          "explainer-sent",
          "gauntlet-played",
          "info-session",
          "group-sheet-sent",
          "deposit-link-shared",
        ],
        0,
        "member"
      )
    ).toBe(5);
  });

  it("clamps at 1: interested, 22 days cold", () => {
    expect(suggestHeat([], 22, "interested")).toBe(1);
  });

  it("interaction: ≥5 signals (+2) vs >21 days (−2) cancel out", () => {
    expect(
      suggestHeat(
        [
          "explainer-sent",
          "gauntlet-played",
          "info-session",
          "group-sheet-sent",
          "deposit-link-shared",
        ],
        22,
        "interested"
      )
    ).toBe(2);
  });

  it("unknown signal strings are ignored by scoring, never throw", () => {
    expect(suggestHeat(["bogus", "nope", "??"], 0, "interested")).toBe(2);
  });

  it("mixed known/unknown signals: only known ones count", () => {
    expect(
      suggestHeat(
        ["explainer-sent", "bogus", "gauntlet-played", "info-session", "nope"],
        0,
        "interested"
      )
    ).toBe(3); // 3 known → +1, not +2
  });
});

/* --------------------------------------------------------- deriveNextMove */

describe("deriveNextMove", () => {
  const base: FamilyForCopilot = {
    stage: "interested",
    heat_score: 3,
    concerns: [],
    daysSinceLastTouch: 0,
    deposit_asked_referral: false,
  };

  it("rule 1: lost → no action", () => {
    const result = deriveNextMove({ ...base, stage: "lost" }, new Set());
    expect(result.ruleId).toBe(1);
    expect(result.message).toContain("Lost");
  });

  it("rule 2: deposit_paid without referral ask → founding-120 ask", () => {
    const result = deriveNextMove({ ...base, stage: "deposit_paid" }, new Set());
    expect(result.ruleId).toBe(2);
    expect(result.message).toContain("Founding 120");
  });

  it("rule 2: member without referral ask → founding-120 ask", () => {
    const result = deriveNextMove({ ...base, stage: "member" }, new Set());
    expect(result.ruleId).toBe(2);
    expect(result.message).toContain("introduction");
  });

  it("rule 2 not triggered once referral was asked → falls through", () => {
    const result = deriveNextMove(
      { ...base, stage: "deposit_paid", deposit_asked_referral: true },
      new Set()
    );
    expect(result.ruleId).toBe(9);
  });

  it("rule 3: call_held, day 1 → T+1 recap + deposit link", () => {
    const result = deriveNextMove(
      { ...base, stage: "call_held", daysSinceLastTouch: 1 },
      new Set()
    );
    expect(result.ruleId).toBe(3);
    expect(result.message).toContain("T+1 recap");
    expect(result.message).toContain("deposit link");
  });

  it("rule 3 not triggered same-day (days 0)", () => {
    const result = deriveNextMove({ ...base, stage: "call_held" }, new Set());
    expect(result.ruleId).not.toBe(3);
  });

  it("rule 4: dossier_submitted, 2 days, no call → call personally", () => {
    const result = deriveNextMove(
      { ...base, stage: "dossier_submitted", daysSinceLastTouch: 2 },
      new Set()
    );
    expect(result.ruleId).toBe(4);
    expect(result.message).toContain("Call them personally");
  });

  it("rule 4 not triggered at day 1", () => {
    const result = deriveNextMove(
      { ...base, stage: "dossier_submitted", daysSinceLastTouch: 1 },
      new Set()
    );
    expect(result.ruleId).not.toBe(4);
  });

  it("rule 5: unaddressed concern → send the labeled answer", () => {
    const result = deriveNextMove(
      { ...base, concerns: ["screen-time"] },
      new Set()
    );
    expect(result.ruleId).toBe(5);
    expect(result.message).toContain("Screen time");
  });

  it("rule 5: first sent, second unaddressed → second concern's label", () => {
    const result = deriveNextMove(
      { ...base, concerns: ["price-value", "refund-terms"] },
      new Set(["price-value"])
    );
    expect(result.ruleId).toBe(5);
    expect(result.message).toContain("Refund terms");
  });

  it("rule 5 skipped when all concerns addressed", () => {
    const result = deriveNextMove(
      { ...base, concerns: ["price-value"] },
      new Set(["price-value"])
    );
    expect(result.ruleId).not.toBe(5);
  });

  it("rule 5: unknown concern strings are ignored, never throw", () => {
    const result = deriveNextMove(
      { ...base, concerns: ["not-a-real-concern"] },
      new Set()
    );
    expect(result.ruleId).toBe(9);
  });

  it("rule 6: account_created, no kids, 2 days → dossier nudge", () => {
    const result = deriveNextMove(
      { ...base, stage: "account_created", daysSinceLastTouch: 2 },
      new Set()
    );
    expect(result.ruleId).toBe(6);
    expect(result.message).toContain("dossier is the application");
  });

  it("rule 6 not triggered at day 1", () => {
    const result = deriveNextMove(
      { ...base, stage: "account_created", daysSinceLastTouch: 1 },
      new Set()
    );
    expect(result.ruleId).toBe(9);
  });

  it("rule 7: 22 days cold + heat 2 → last invite", () => {
    const result = deriveNextMove(
      { ...base, daysSinceLastTouch: 22, heat_score: 2 },
      new Set()
    );
    expect(result.ruleId).toBe(7);
    expect(result.message).toContain("info-session invite");
  });

  it("rule 7 not triggered: 22 days but heat 3", () => {
    const result = deriveNextMove(
      { ...base, daysSinceLastTouch: 22, heat_score: 3 },
      new Set()
    );
    expect(result.ruleId).not.toBe(7);
  });

  it("rule 8: interested, heat 4, 6 days → hot and cooling", () => {
    const result = deriveNextMove(
      { ...base, heat_score: 4, daysSinceLastTouch: 6 },
      new Set()
    );
    expect(result.ruleId).toBe(8);
    expect(result.message).toContain("20-min call");
  });

  it("rule 8 also fires for account_created", () => {
    const result = deriveNextMove(
      {
        ...base,
        stage: "account_created",
        heat_score: 5,
        daysSinceLastTouch: 6,
      },
      new Set()
    );
    // days 6 also satisfies rule 6 (account, ≥2 days) — rule 6 wins by order.
    expect(result.ruleId).toBe(6);
  });

  it("rule 8: interested only — not dossier stages", () => {
    const result = deriveNextMove(
      { ...base, stage: "dossier_started", heat_score: 4, daysSinceLastTouch: 6 },
      new Set()
    );
    expect(result.ruleId).toBe(9);
  });

  it("rule 9: fallback → personal note", () => {
    const result = deriveNextMove(base, new Set());
    expect(result.ruleId).toBe(9);
    expect(result.message).toContain("personal note");
  });

  it("waitlist is not terminal — falls through to concern rule", () => {
    const result = deriveNextMove(
      { ...base, stage: "waitlist", concerns: ["logistics"] },
      new Set()
    );
    expect(result.ruleId).toBe(5);
    expect(result.message).toContain("Logistics");
  });

  it("priority: lost beats everything", () => {
    const result = deriveNextMove(
      {
        stage: "lost",
        heat_score: 1,
        concerns: ["price-value"],
        daysSinceLastTouch: 30,
        deposit_asked_referral: false,
      },
      new Set()
    );
    expect(result.ruleId).toBe(1);
  });

  it("priority: rule 2 beats rule 5 (deposit_paid with concerns)", () => {
    const result = deriveNextMove(
      { ...base, stage: "deposit_paid", concerns: ["refund-terms"] },
      new Set()
    );
    expect(result.ruleId).toBe(2);
  });

  it("priority: rule 5 beats rule 6 (account + concern + 3 days)", () => {
    const result = deriveNextMove(
      {
        ...base,
        stage: "account_created",
        concerns: ["curriculum-fit"],
        daysSinceLastTouch: 3,
      },
      new Set()
    );
    expect(result.ruleId).toBe(5);
  });

  it("priority: rule 5 beats rule 7 (cold family with unaddressed concern)", () => {
    const result = deriveNextMove(
      {
        ...base,
        concerns: ["spouse-buy-in"],
        daysSinceLastTouch: 25,
        heat_score: 1,
      },
      new Set()
    );
    expect(result.ruleId).toBe(5);
  });
});

/* -------------------------------------------------- suggestedLibraryItems */

describe("suggestedLibraryItems", () => {
  const items: LibraryItemForSuggestion[] = [
    { id: "a", concern: "price-value", helpfulness: 5, send_count: 2 }, // score 12
    { id: "b", concern: "price-value", helpfulness: 1, send_count: 20 }, // score 22
    { id: "c", concern: "price-value", helpfulness: 4, send_count: 1 }, // score 9
    { id: "d", concern: "price-value", helpfulness: 0, send_count: 0 }, // score 0
    { id: "e", concern: "screen-time", helpfulness: 9, send_count: 50 },
    { id: "f", concern: null, helpfulness: 0, send_count: 30 },
    { id: "g", concern: "logistics", helpfulness: 0, send_count: 40 },
  ];

  it("matches the first unaddressed concern, scored helpfulness*2 + send_count", () => {
    const result = suggestedLibraryItems(items, ["price-value"], new Set());
    expect(result.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("skips sent concerns — second concern becomes the target", () => {
    const result = suggestedLibraryItems(
      items,
      ["price-value", "screen-time"],
      new Set(["price-value"])
    );
    expect(result[0].id).toBe("e");
  });

  it("backfills globally by send_count when fewer than 3 match", () => {
    const result = suggestedLibraryItems(items, ["screen-time"], new Set());
    expect(result.map((i) => i.id)).toEqual(["e", "g", "f"]);
  });

  it("no unaddressed concern → 3 global items by send_count", () => {
    const result = suggestedLibraryItems(items, [], new Set());
    expect(result.map((i) => i.id)).toEqual(["e", "g", "f"]);
  });

  it("unknown concern strings are ignored → global backfill, no throw", () => {
    const result = suggestedLibraryItems(items, ["bogus-concern"], new Set());
    expect(result.map((i) => i.id)).toEqual(["e", "g", "f"]);
  });

  it("returns fewer than 3 when the whole library is smaller", () => {
    const two = items.slice(0, 2);
    const result = suggestedLibraryItems(two, ["price-value"], new Set());
    expect(result).toHaveLength(2);
  });

  it("never duplicates a matched item into the backfill", () => {
    const result = suggestedLibraryItems(items, ["logistics"], new Set());
    const ids = result.map((i) => i.id);
    expect(ids[0]).toBe("g");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
