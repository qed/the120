import { describe, expect, it } from "vitest";

import { deriveRoundOneBillingReviews } from "../round-one-billing-review-rules";

const children = [
  {
    id: "child-1",
    fp_username: "alex",
    follow_up_parent_key: "parent-1",
    follow_up_parent_name: "Morgan Lee",
    follow_up_parent_phone: "+14165550100",
    follow_up_child_name: "Alex Lee",
  },
];

describe("Round One billing review shaping", () => {
  it("returns the minimal actionable staff queue in newest-first order", () => {
    const result = deriveRoundOneBillingReviews(children, [
      {
        id: "11111111-1111-4111-8111-111111111111",
        child_id: "child-1",
        review_kind: "partial_refund",
        review_state: "open",
        last_observed_at: "2026-09-02T11:00:00Z",
        stripe_object_id: "ch_must_not_escape",
        processor_amount: 12_500,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        child_id: "child-1",
        review_kind: "stripe_dispute",
        review_state: "open",
        last_observed_at: "2026-09-02T12:00:00Z",
        processor_reason: "fraudulent",
      },
    ]);

    expect(result).toEqual({
      ok: true,
      value: {
        unit: "review_item",
        openCount: 2,
        items: [
          {
            reviewKey: "22222222-2222-4222-8222-222222222222",
            parentKey: "parent-1",
            parentName: "Morgan Lee",
            parentPhone: "+14165550100",
            childUsername: "alex",
            childName: "Alex Lee",
            reason: "stripe_dispute",
            observedAt: "2026-09-02T12:00:00.000Z",
          },
          {
            reviewKey: "11111111-1111-4111-8111-111111111111",
            parentKey: "parent-1",
            parentName: "Morgan Lee",
            parentPhone: "+14165550100",
            childUsername: "alex",
            childName: "Alex Lee",
            reason: "partial_refund",
            observedAt: "2026-09-02T11:00:00.000Z",
          },
        ],
      },
    });
    const wire = JSON.stringify(result);
    expect(wire).not.toContain("ch_must_not_escape");
    expect(wire).not.toContain("processor");
    expect(wire).not.toContain("12500");
  });

  it("represents a successful empty read as a real zero", () => {
    expect(deriveRoundOneBillingReviews([], [])).toEqual({
      ok: true,
      value: { unit: "review_item", openCount: 0, items: [] },
    });
  });

  it.each([
    [{ ...children[0], follow_up_parent_key: null }],
    [{ ...children[0], fp_username: "" }],
  ])("fails closed when actionable contact linkage is malformed", (badChild) => {
    expect(
      deriveRoundOneBillingReviews([badChild], [
        {
          id: "11111111-1111-4111-8111-111111111111",
          child_id: "child-1",
          review_kind: "partial_refund",
          review_state: "open",
          last_observed_at: "2026-09-02T11:00:00Z",
        },
      ])
    ).toEqual({ ok: false });
  });

  it.each([
    { id: "not-a-uuid" },
    { child_id: "outside-roster" },
    { review_kind: "manual_note" },
    { review_state: "resolved" },
    { last_observed_at: "not-a-date" },
  ])("fails the whole optional contract for a malformed row: %o", (override) => {
    expect(
      deriveRoundOneBillingReviews(children, [
        {
          id: "11111111-1111-4111-8111-111111111111",
          child_id: "child-1",
          review_kind: "partial_refund",
          review_state: "open",
          last_observed_at: "2026-09-02T11:00:00Z",
          ...override,
        },
      ])
    ).toEqual({ ok: false });
  });

  it("refuses duplicate case keys rather than double-counting them", () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      child_id: "child-1",
      review_kind: "partial_refund",
      review_state: "open",
      last_observed_at: "2026-09-02T11:00:00Z",
    } as const;
    expect(deriveRoundOneBillingReviews(children, [row, row])).toEqual({ ok: false });
  });
});
