/**
 * Unit 7 action-layer tests: the Zod schemas + pure decision helpers the
 * library send actions are built on (`library-rules.ts`). Same posture as
 * `actions-families.test.ts` — no supabase mocking; the actions import
 * these rules and add guarded mutations around them.
 */

import { describe, expect, it } from "vitest";
import {
  bodyToHtml,
  composePrefill,
  escapeHtml,
  familyFirstName,
  helpfulnessApply,
  markSentElsewhereSchema,
  rateHelpfulnessSchema,
  sendFromLibrarySchema,
  sendGate,
  sentConcernsFrom,
  type SendGateFamily,
} from "@/app/crm/lib/library-rules";

const UUID = "3f9f2a44-9a31-4e6c-8f01-2b1a5c7d9e00";
const UUID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const consentedFamily = (
  overrides: Partial<SendGateFamily> = {}
): SendGateFamily => ({
  email: "dana@example.com",
  consent_given: true,
  consent_revoked_at: null,
  ...overrides,
});

/* -------------------------------------------------------------- sendGate */

describe("sendGate", () => {
  it("passes a consented family with an email (email channel)", () => {
    expect(sendGate(consentedFamily(), "email")).toBe("ok");
  });

  it("defaults to the email channel", () => {
    expect(sendGate(consentedFamily({ email: null }))).toBe("no-email");
  });

  it("blocks when consent was never given", () => {
    expect(sendGate(consentedFamily({ consent_given: false }), "email")).toBe(
      "no-consent"
    );
  });

  it("blocks a revocation EVEN while consent_given is still true", () => {
    // Decision 9: consent_given stays true for history; revoked_at gates.
    expect(
      sendGate(
        consentedFamily({ consent_revoked_at: "2026-07-10T12:00:00Z" }),
        "email"
      )
    ).toBe("no-consent");
  });

  it("returns no-email for a consented lead without an address", () => {
    expect(sendGate(consentedFamily({ email: null }), "email")).toBe(
      "no-email"
    );
    expect(sendGate(consentedFamily({ email: "   " }), "email")).toBe(
      "no-email"
    );
  });

  it("consent is checked before email — a non-consented, email-less lead is no-consent", () => {
    expect(
      sendGate(consentedFamily({ email: null, consent_given: false }), "email")
    ).toBe("no-consent");
  });

  it("'other' channel needs no email but still needs consent (flow gap 15)", () => {
    expect(sendGate(consentedFamily({ email: null }), "other")).toBe("ok");
    expect(
      sendGate(consentedFamily({ consent_given: false, email: null }), "other")
    ).toBe("no-consent");
    expect(
      sendGate(
        consentedFamily({ consent_revoked_at: "2026-07-10T12:00:00Z" }),
        "other"
      )
    ).toBe("no-consent");
  });
});

/* --------------------------------------------------------- composePrefill */

describe("composePrefill", () => {
  const item = {
    title: "DEPOSIT + REFUND TERMS",
    body: "The seat deposit is $250 and fully refundable until September 30.",
  };

  it("uses the item title as the subject", () => {
    expect(composePrefill(item, { name: "Dana Osei" }).subject).toBe(
      item.title
    );
  });

  it("greets by first name and includes the item body", () => {
    const { body } = composePrefill(item, { name: "Dana Osei" });
    expect(body).toContain("Hi Dana,");
    expect(body).toContain(item.body);
    expect(body).toContain("The 120 Admissions");
  });

  it("personalizes {first_name} tokens inside the item body too", () => {
    const { body } = composePrefill(
      { title: "T", body: "Thanks for asking, {first_name} — here it is." },
      { name: "Dana Osei" }
    );
    expect(body).toContain("Thanks for asking, Dana — here it is.");
    expect(body).not.toContain("{first_name}");
  });

  it("falls back to 'there' for an unnamed family", () => {
    expect(composePrefill(item, { name: "  " }).body).toContain("Hi there,");
  });

  it("familyFirstName takes the first word only", () => {
    expect(familyFirstName("Dana Osei")).toBe("Dana");
    expect(familyFirstName("  Dana  ")).toBe("Dana");
    expect(familyFirstName("")).toBe("there");
  });
});

/* ------------------------------------------------------- sentConcernsFrom */

describe("sentConcernsFrom", () => {
  const items = [
    { id: "i1", concern: "refund-terms" },
    { id: "i2", concern: "screen-time" },
    { id: "i3", concern: null },
    { id: "i4", concern: "not-a-real-concern" },
  ];

  it("maps sends to their item's concern", () => {
    const sent = sentConcernsFrom([{ item_id: "i1" }, { item_id: "i2" }], items);
    expect(sent).toEqual(new Set(["refund-terms", "screen-time"]));
  });

  it("dedupes repeat sends of the same concern", () => {
    const sent = sentConcernsFrom(
      [{ item_id: "i1" }, { item_id: "i1" }],
      items
    );
    expect(sent.size).toBe(1);
  });

  it("skips null-concern items, unknown concerns, and unknown item ids", () => {
    const sent = sentConcernsFrom(
      [{ item_id: "i3" }, { item_id: "i4" }, { item_id: "ghost" }],
      items
    );
    expect(sent.size).toBe(0);
  });

  it("returns an empty set for no sends", () => {
    expect(sentConcernsFrom([], items).size).toBe(0);
  });
});

/* -------------------------------------------------------- helpfulnessApply */

describe("helpfulnessApply", () => {
  it("increments and decrements by the delta", () => {
    expect(helpfulnessApply(3, 1)).toBe(4);
    expect(helpfulnessApply(3, -1)).toBe(2);
  });

  it("clamps at zero — a downvote on 0 stays 0", () => {
    expect(helpfulnessApply(0, -1)).toBe(0);
  });
});

/* ---------------------------------------------------------------- schemas */

describe("sendFromLibrarySchema", () => {
  const valid = {
    familyId: UUID,
    itemId: UUID2,
    subject: "DEPOSIT + REFUND TERMS",
    body: "Hi Dana, here are the terms.",
  };

  it("accepts a valid payload", () => {
    expect(sendFromLibrarySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty subject or body", () => {
    expect(
      sendFromLibrarySchema.safeParse({ ...valid, subject: "  " }).success
    ).toBe(false);
    expect(
      sendFromLibrarySchema.safeParse({ ...valid, body: "" }).success
    ).toBe(false);
  });

  it("rejects a non-uuid family id", () => {
    expect(
      sendFromLibrarySchema.safeParse({ ...valid, familyId: "nope" }).success
    ).toBe(false);
  });
});

describe("markSentElsewhereSchema", () => {
  it("accepts with and without a note", () => {
    expect(
      markSentElsewhereSchema.safeParse({ familyId: UUID, itemId: UUID2 })
        .success
    ).toBe(true);
    expect(
      markSentElsewhereSchema.safeParse({
        familyId: UUID,
        itemId: UUID2,
        note: "texted the tuition math",
      }).success
    ).toBe(true);
  });
});

describe("rateHelpfulnessSchema", () => {
  it("accepts only ±1 deltas", () => {
    expect(
      rateHelpfulnessSchema.safeParse({ itemId: UUID, delta: 1 }).success
    ).toBe(true);
    expect(
      rateHelpfulnessSchema.safeParse({ itemId: UUID, delta: -1 }).success
    ).toBe(true);
    expect(
      rateHelpfulnessSchema.safeParse({ itemId: UUID, delta: 2 }).success
    ).toBe(false);
    expect(
      rateHelpfulnessSchema.safeParse({ itemId: UUID, delta: 0 }).success
    ).toBe(false);
  });
});

/* ------------------------------------------------------------- email body */

describe("bodyToHtml", () => {
  it("escapes HTML so composer text can't inject markup", () => {
    expect(escapeHtml('<b>&"\'')).toBe("&lt;b&gt;&amp;&quot;&#39;");
    expect(bodyToHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });

  it("splits blank lines into paragraphs and keeps single newlines as breaks", () => {
    const html = bodyToHtml("Hi Dana,\n\nLine one\nLine two");
    expect(html.match(/<p /g)?.length).toBe(2);
    expect(html).toContain("Line one<br />Line two");
  });
});
