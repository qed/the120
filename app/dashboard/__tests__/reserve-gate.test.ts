import { describe, expect, it } from "vitest";
import { RESERVE_GATE_MESSAGE, canReserveSeat, hasPaidDeposit } from "../data";

/**
 * The seat-deposit approval gate (R11–R13): one pure predicate consumed by
 * BOTH the dashboard CTA and the checkout route, so UI and server can't
 * drift. Allow-list semantics — reservable only at `offered` or any later
 * status — and the full deposit list, never a single find()'d row.
 */
describe("canReserveSeat (approval gate, R11–R13)", () => {
  const paid = { status: "paid" };
  const refunded = { status: "refunded" };

  it("offered + no deposits → reservable", () => {
    expect(canReserveSeat("offered", [])).toBe(true);
  });

  it("member + no deposits → reservable (a member-no-deposit child must not be locked out)", () => {
    expect(canReserveSeat("member", [])).toBe(true);
  });

  it("every pre-approval status → not reservable", () => {
    for (const s of ["submitted", "in_review", "invited"] as const) {
      expect(canReserveSeat(s, []), s).toBe(false);
    }
  });

  it("draft → not reservable", () => {
    expect(canReserveSeat("draft", [])).toBe(false);
  });

  it("unknown/garbage status → not reservable (allow-list, not blacklist)", () => {
    expect(canReserveSeat("approved", [])).toBe(false);
    expect(canReserveSeat("", [])).toBe(false);
    expect(canReserveSeat("OFFERED", [])).toBe(false);
  });

  it("offered + paid deposit → not reservable (already paid)", () => {
    expect(canReserveSeat("offered", [paid])).toBe(false);
  });

  it("offered + only refunded deposits → reservable again (re-reserve flow)", () => {
    expect(canReserveSeat("offered", [refunded])).toBe(true);
  });

  it("offered + [refunded, paid] (refund-then-repay child) → NOT reservable", () => {
    // The multi-row case a single find() gets wrong: the refunded row can
    // come back first from an unordered select while a paid row exists.
    expect(canReserveSeat("offered", [refunded, paid])).toBe(false);
    expect(canReserveSeat("offered", [paid, refunded])).toBe(false);
  });
});

describe("hasPaidDeposit (paid-banner derivation — must match the gate's)", () => {
  it("finds the paid row regardless of order", () => {
    expect(hasPaidDeposit([{ status: "refunded" }, { status: "paid" }])).toBe(true);
    expect(hasPaidDeposit([{ status: "paid" }])).toBe(true);
    expect(hasPaidDeposit([{ status: "refunded" }])).toBe(false);
    expect(hasPaidDeposit([])).toBe(false);
  });
});

describe("RESERVE_GATE_MESSAGE", () => {
  it("is the distinct non-retry rejection copy (client branches on it verbatim)", () => {
    expect(RESERVE_GATE_MESSAGE).toBe(
      "Your application is still under review — checkout opens once it's approved."
    );
  });
});
