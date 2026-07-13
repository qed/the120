/**
 * Unit 5 action-layer tests: the Zod schemas + pure decision helpers the
 * dossier review actions and panes are built on (`reviews-rules.ts`).
 * No supabase mocking — actions are structured so the decision logic
 * imports cleanly (families-rules canon).
 */

import { describe, expect, it } from "vitest";
import {
  assignGroupSchema,
  dossierChecklist,
  dossierCompleteness,
  effectiveReviewStatus,
  memberNoDeposit,
  moveCandidateSchema,
  resolvePaymentStrip,
  reviewPillColors,
  saveReviewNotesSchema,
  stripePaymentUrl,
  type DepositForStrip,
  type DossierFields,
} from "@/app/crm/lib/reviews-rules";

const UUID = "3f9f2a44-9a31-4e6c-8f01-2b1a5c7d9e00";

/* ---------------------------------------------------------------- schemas */

describe("moveCandidateSchema", () => {
  it("accepts a minimal valid move", () => {
    const parsed = moveCandidateSchema.safeParse({
      childId: UUID,
      reviewStatus: "in_review",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an optional group and note", () => {
    const parsed = moveCandidateSchema.safeParse({
      childId: UUID,
      reviewStatus: "member",
      group: "makers",
      note: "Founding member #6.",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid review status", () => {
    const parsed = moveCandidateSchema.safeParse({
      childId: UUID,
      reviewStatus: "member-of-the-120", // the brief's display label, not the enum
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid group", () => {
    const parsed = moveCandidateSchema.safeParse({
      childId: UUID,
      reviewStatus: "offered",
      group: "wizards",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-uuid child id", () => {
    const parsed = moveCandidateSchema.safeParse({
      childId: "child-1",
      reviewStatus: "invited",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("assignGroupSchema", () => {
  it("accepts each of the five groups", () => {
    for (const group of ["athletes", "founders", "makers", "scholars", "givers"]) {
      expect(assignGroupSchema.safeParse({ childId: UUID, group }).success).toBe(
        true
      );
    }
  });

  it("accepts null (explicit unassign)", () => {
    const parsed = assignGroupSchema.safeParse({ childId: UUID, group: null });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown group", () => {
    const parsed = assignGroupSchema.safeParse({
      childId: UUID,
      group: "Scholars", // labels are display-layer; enum is lowercase
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing group key (must be explicit null)", () => {
    const parsed = assignGroupSchema.safeParse({ childId: UUID });
    expect(parsed.success).toBe(false);
  });
});

describe("saveReviewNotesSchema", () => {
  it("accepts notes", () => {
    const parsed = saveReviewNotesSchema.safeParse({
      childId: UUID,
      notes: "Assessment slot: Jul 12.",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty string (clearing the notes)", () => {
    const parsed = saveReviewNotesSchema.safeParse({ childId: UUID, notes: "" });
    expect(parsed.success).toBe(true);
  });

  it("rejects notes beyond 8000 chars", () => {
    const parsed = saveReviewNotesSchema.safeParse({
      childId: UUID,
      notes: "x".repeat(8001),
    });
    expect(parsed.success).toBe(false);
  });
});

/* ------------------------------------------------ effective review status */

describe("effectiveReviewStatus", () => {
  it("prefers the child_reviews row when present", () => {
    expect(effectiveReviewStatus("submitted", { review_status: "offered" })).toBe(
      "offered"
    );
  });

  it("clamps an unknown review row value to submitted", () => {
    expect(effectiveReviewStatus("submitted", { review_status: "wat" })).toBe(
      "submitted"
    );
  });

  it("trusts children.status only for draft", () => {
    expect(effectiveReviewStatus("draft", null)).toBe("draft");
  });

  it("clamps a forged parent-side status to submitted without a review row", () => {
    // Decision 1/6: parents legitimately control only draft/submitted.
    expect(effectiveReviewStatus("member", null)).toBe("submitted");
    expect(effectiveReviewStatus("offered", undefined)).toBe("submitted");
  });
});

/* ------------------------------------------------------------ pill colors */

describe("reviewPillColors (Admin.dc.html pill logic)", () => {
  it("early stages = bone/ink", () => {
    expect(reviewPillColors("draft")).toEqual({ bg: "#E0DDD7", text: "#55585E" });
    expect(reviewPillColors("submitted")).toEqual({
      bg: "#E0DDD7",
      text: "#55585E",
    });
  });

  it("mid stages = blue/white", () => {
    for (const s of ["in_review", "invited", "offered"] as const) {
      expect(reviewPillColors(s)).toEqual({ bg: "#0300ED", text: "#FFFFFF" });
    }
  });

  it("MEMBER = red/white", () => {
    expect(reviewPillColors("member")).toEqual({
      bg: "#D92632",
      text: "#FFFFFF",
    });
  });
});

/* ----------------------------------------------------------- completeness */

const fullDossier: DossierFields = {
  firstName: "Zoe",
  lastName: "Tremblay",
  grade: 8,
  birthYear: "2013",
  currentSchool: "Homeschool",
  subjects: ["Math", "Science"],
  workshopIds: ["botball-robotics"],
  interests: "Ham radio licence (basic), Arduino since age 9.",
  projectPitch: "Build and launch a high-altitude glider.",
};

const emptyDossier: DossierFields = {
  firstName: "",
  lastName: "",
  grade: null,
  birthYear: "",
  currentSchool: "",
  subjects: [],
  workshopIds: [],
  interests: "",
  projectPitch: "",
};

describe("dossierCompleteness (mirrors the parent dashboard checklist)", () => {
  it("counts 8 checklist items", () => {
    expect(dossierChecklist(fullDossier)).toHaveLength(8);
  });

  it("full dossier = 100", () => {
    expect(dossierCompleteness(fullDossier)).toBe(100);
  });

  it("empty dossier = 0", () => {
    expect(dossierCompleteness(emptyDossier)).toBe(0);
  });

  it("half-done dossier rounds like the dashboard meter", () => {
    // name + grade + school + subjects done; birth year, workshop,
    // interests, pitch missing → 4/8 = 50.
    const half: DossierFields = {
      ...emptyDossier,
      firstName: "Theo",
      lastName: "Vandermeer",
      grade: 4,
      currentSchool: "Cottingham Jr PS",
      subjects: ["Math"],
    };
    expect(dossierCompleteness(half)).toBe(50);
  });

  it("applies the dashboard's thresholds, not mere presence", () => {
    const thin: DossierFields = {
      ...fullDossier,
      birthYear: "13", // not 4 digits
      interests: "ok", // < 3 chars
      projectPitch: "too short", // < 10 chars
    };
    const items = dossierChecklist(thin);
    expect(items.find((i) => i.label === "Birth year")?.done).toBe(false);
    expect(items.find((i) => i.label === "The kid's interests")?.done).toBe(false);
    // "too short" is 9 chars — below the 10-char pitch threshold.
    expect(items.find((i) => i.label === "A project pitch")?.done).toBe(false);
  });
});

/* ---------------------------------------------------------- payment strip */

const paidDeposit: DepositForStrip = {
  status: "paid",
  amount: 25000,
  created_at: "2026-07-20T12:00:00Z",
  refunded_at: null,
  stripe_payment_intent: "pi_paid",
};

const refundedDeposit: DepositForStrip = {
  status: "refunded",
  amount: 25000,
  created_at: "2026-07-15T12:00:00Z",
  refunded_at: "2026-07-18T12:00:00Z",
  stripe_payment_intent: "pi_refunded",
};

describe("resolvePaymentStrip", () => {
  it("no deposits → none", () => {
    expect(resolvePaymentStrip([])).toEqual({ kind: "none" });
  });

  it("live paid deposit → paid with amount, date, and payment intent", () => {
    expect(resolvePaymentStrip([paidDeposit])).toEqual({
      kind: "paid",
      amount: 25000,
      paidAt: "2026-07-20T12:00:00Z",
      paymentIntent: "pi_paid",
    });
  });

  it("refunded via status flip → refunded", () => {
    const state = resolvePaymentStrip([refundedDeposit]);
    expect(state.kind).toBe("refunded");
  });

  it("refunded via refunded_at alone (status not yet flipped) → refunded", () => {
    const state = resolvePaymentStrip([
      { ...refundedDeposit, status: "paid" },
    ]);
    expect(state).toEqual({
      kind: "refunded",
      amount: 25000,
      refundedAt: "2026-07-18T12:00:00Z",
      paymentIntent: "pi_refunded",
    });
  });

  it("a live paid deposit wins over an older refunded one", () => {
    const state = resolvePaymentStrip([refundedDeposit, paidDeposit]);
    expect(state.kind).toBe("paid");
  });

  it("two paid deposits → the newest wins", () => {
    const older = { ...paidDeposit, created_at: "2026-07-14T12:00:00Z", stripe_payment_intent: "pi_old" };
    const state = resolvePaymentStrip([older, paidDeposit]);
    expect(state.kind === "paid" && state.paymentIntent).toBe("pi_paid");
  });
});

describe("memberNoDeposit (flow gap 10)", () => {
  it("member + no deposit → warns", () => {
    expect(memberNoDeposit("member", [])).toBe(true);
  });

  it("member + refunded deposit → warns", () => {
    expect(memberNoDeposit("member", [refundedDeposit])).toBe(true);
  });

  it("member + live paid deposit → quiet", () => {
    expect(memberNoDeposit("member", [paidDeposit])).toBe(false);
  });

  it("non-member without a deposit → quiet", () => {
    expect(memberNoDeposit("offered", [])).toBe(false);
    expect(memberNoDeposit("submitted", [refundedDeposit])).toBe(false);
  });
});

describe("stripePaymentUrl", () => {
  it("deep-links into the test dashboard's payment view", () => {
    expect(stripePaymentUrl("pi_123")).toBe(
      "https://dashboard.stripe.com/acct_103s7v25N9cbf3wU/test/payments/pi_123"
    );
  });
});
