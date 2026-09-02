import { describe, expect, it } from "vitest";
import {
  classifyRoundOnePaymentReadError,
  deriveRoundOnePaymentSummary,
} from "../round-one-payment-rules";

const at = (day: number): string => `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`;

describe("Watchtower Round One payment summary", () => {
  it("counts every distinct enrolled child once with active access first", () => {
    const summary = deriveRoundOnePaymentSummary(
      ["paid", "comped", "grandfathered", "pending", "refunded", "unpaid", "paid"],
      [
        {
          child_id: "paid",
          status: "active",
          grant_kind: "paid",
          updated_at: at(3),
        },
        {
          child_id: "comped",
          status: "active",
          grant_kind: "comped",
          updated_at: at(3),
        },
        {
          child_id: "grandfathered",
          status: "active",
          grant_kind: "grandfathered",
          updated_at: at(3),
        },
        {
          child_id: "refunded",
          status: "revoked",
          grant_kind: "paid",
          revoked_at: at(4),
          updated_at: at(4),
        },
      ],
      [
        // Active access wins over newer-looking history.
        { id: "o-1", child_id: "paid", status: "refunded", updated_at: at(9) },
        { id: "o-2", child_id: "pending", status: "pending", updated_at: at(5) },
        { id: "o-3", child_id: "refunded", status: "refunded", updated_at: at(4) },
      ]
    );

    expect(summary).toEqual({
      unit: "child",
      paidPurchases: 1,
      complimentaryAccess: 2,
      pending: 1,
      unpaid: 1,
      refundedPaid: 1,
      revokedComplimentary: 0,
    });
    expect(
      summary.paidPurchases +
        summary.complimentaryAccess +
        summary.pending +
        summary.unpaid +
        summary.refundedPaid +
        summary.revokedComplimentary
    ).toBe(6);
  });

  it("uses the latest non-active fact, including pending retries and revocations", () => {
    expect(
      deriveRoundOnePaymentSummary(
        ["retry", "revoked", "cancelled", "failed", "tie"],
        [
          {
            child_id: "retry",
            status: "revoked",
            grant_kind: "paid",
            revoked_at: at(2),
          },
          {
            child_id: "revoked",
            status: "revoked",
            grant_kind: "comped",
            revoked_at: at(8),
          },
          {
            child_id: "cancelled",
            status: "revoked",
            grant_kind: "paid",
            revoked_at: at(2),
          },
          {
            child_id: "failed",
            status: "revoked",
            grant_kind: "paid",
            revoked_at: at(2),
          },
          {
            child_id: "tie",
            status: "revoked",
            grant_kind: "paid",
            revoked_at: at(6),
          },
        ],
        [
          { id: "o-1", child_id: "retry", status: "refunded", updated_at: at(2) },
          { id: "o-2", child_id: "retry", status: "pending", updated_at: at(7) },
          { id: "o-3", child_id: "revoked", status: "pending", updated_at: at(3) },
          { id: "o-4", child_id: "cancelled", status: "cancelled", updated_at: at(6) },
          { id: "o-5", child_id: "failed", status: "failed", updated_at: at(6) },
          // The explicit precedence resolves an identical transaction stamp.
          { id: "o-6", child_id: "tie", status: "pending", updated_at: at(6) },
        ]
      )
    ).toEqual({
      unit: "child",
      paidPurchases: 0,
      complimentaryAccess: 0,
      pending: 2,
      unpaid: 2,
      refundedPaid: 0,
      revokedComplimentary: 1,
    });
  });

  it("does not mix real purchases with complimentary grants or their reversals", () => {
    expect(
      deriveRoundOnePaymentSummary(
        ["paid-order", "comp-order", "paid-revoked", "comp-revoked"],
        [
          {
            child_id: "paid-revoked",
            status: "revoked",
            grant_kind: "paid",
            revoked_at: at(6),
          },
          {
            child_id: "comp-revoked",
            status: "revoked",
            grant_kind: "grandfathered",
            revoked_at: at(6),
          },
        ],
        [
          { id: "o-1", child_id: "paid-order", status: "paid", updated_at: at(3) },
          { id: "o-2", child_id: "comp-order", status: "comped", updated_at: at(3) },
          { id: "o-3", child_id: "paid-revoked", status: "paid", updated_at: at(2) },
          {
            id: "o-4",
            child_id: "comp-revoked",
            status: "grandfathered",
            updated_at: at(2),
          },
        ]
      )
    ).toEqual({
      unit: "child",
      paidPurchases: 1,
      complimentaryAccess: 1,
      pending: 0,
      unpaid: 0,
      refundedPaid: 1,
      revokedComplimentary: 1,
    });
  });

  it("is total over malformed/foreign rows and never invents extra children", () => {
    const summary = deriveRoundOnePaymentSummary(
      ["kid-1", "", "kid-1", "kid-2"],
      [
        { child_id: "outsider", status: "active", grant_kind: "paid", updated_at: at(1) },
        { child_id: "kid-1", status: "active", grant_kind: "mystery", updated_at: at(1) },
        { child_id: "kid-2", status: "revoked", grant_kind: "paid", revoked_at: "bad" },
      ],
      [
        { child_id: "kid-1", status: "pending", updated_at: "bad" },
        { child_id: null, status: "refunded", updated_at: at(2) },
      ]
    );
    expect(summary).toEqual({
      unit: "child",
      paidPurchases: 0,
      complimentaryAccess: 0,
      pending: 0,
      unpaid: 2,
      refundedPaid: 0,
      revokedComplimentary: 0,
    });
  });

  it("recognizes rollout schema absence by code without inspecting error text", () => {
    for (const code of ["42P01", "PGRST204", "PGRST205"]) {
      expect(classifyRoundOnePaymentReadError({ code })).toBe("schema_absent");
    }
    expect(classifyRoundOnePaymentReadError({ code: "08006" })).toBe("read_failed");
    expect(classifyRoundOnePaymentReadError({})).toBe("read_failed");
  });
});
