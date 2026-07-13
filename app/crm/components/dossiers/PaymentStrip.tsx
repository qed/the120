"use client";

/**
 * Payment strip (plan Unit 5; brief §6 addition): deposit state chip
 * ($250 PAID · Jul 20 green / REFUNDED red / NO DEPOSIT gray) + "Open in
 * Stripe" deep link (test dashboard until S10), plus the flow-gap-10
 * MEMBER · NO DEPOSIT warning chip. All state resolution is pure
 * (`reviews-rules.ts`) and unit-tested.
 */

import type { ReviewStatus } from "@/app/crm/lib/constants";
import {
  memberNoDeposit,
  resolvePaymentStrip,
  stripePaymentUrl,
  type DepositForStrip,
} from "@/app/crm/lib/reviews-rules";
import { fmtDay } from "@/app/crm/lib/dates";

const CHIP =
  "inline-block whitespace-nowrap rounded-full px-2.5 py-[5px] font-mono text-[9px] uppercase tracking-[0.06em]";

const dollars = (cents: number) => `$${Math.round(cents / 100)}`;

export default function PaymentStrip({
  deposits,
  reviewStatus,
}: {
  deposits: DepositForStrip[];
  reviewStatus: ReviewStatus;
}) {
  const state = resolvePaymentStrip(deposits);
  const warn = memberNoDeposit(reviewStatus, deposits);
  const paymentIntent = state.kind !== "none" ? state.paymentIntent : null;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {state.kind === "paid" && (
        <span className={CHIP} style={{ backgroundColor: "#0E8A5F", color: "#FFFFFF" }}>
          {dollars(state.amount)} paid · {fmtDay(state.paidAt)}
        </span>
      )}
      {state.kind === "refunded" && (
        <span className={CHIP} style={{ backgroundColor: "#D92632", color: "#FFFFFF" }}>
          Refunded{state.refundedAt ? ` · ${fmtDay(state.refundedAt)}` : ""}
        </span>
      )}
      {state.kind === "none" && (
        <span className={CHIP} style={{ backgroundColor: "#E0DDD7", color: "#55585E" }}>
          No deposit
        </span>
      )}

      {warn && (
        <span
          title="Review says MEMBER but no paid deposit backs it — collect or refund-check before Tin Can."
          className={`${CHIP} border border-crm-amber bg-transparent text-crm-amber`}
        >
          Member · no deposit
        </span>
      )}

      {paymentIntent && (
        <a
          href={stripePaymentUrl(paymentIntent)}
          target="_blank"
          rel="noopener noreferrer"
          className="no-print font-mono text-[10px] uppercase tracking-[0.08em] text-crm-blue underline decoration-crm-blue/40 underline-offset-2 hover:decoration-crm-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue"
        >
          Open in Stripe ↗
        </a>
      )}
    </div>
  );
}
