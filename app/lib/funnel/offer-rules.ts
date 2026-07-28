/**
 * The review state and the offer bridge — pure rules (funnel U13; R49a, F5).
 *
 * F5's whole point: after C2 the family sees a REAL admissions process, not
 * a stall. The deposit does not open on submission; staff offer through the
 * existing CRM path; the offer email's dashboard link works because a funnel
 * family has a real account (Decision 2). This module owns:
 *  - the offer-capacity arithmetic (offers do NOT reserve seats — the
 *    plan's over-offer trap, surfaced to staff at the point of offer);
 *  - the family-side routing after submission (review / dashboard /
 *    waitlist, F7);
 *  - the copy for the review-wait and waitlist screens, CONFIRMED as
 *    written by Peter 2026-07-28 (neither screen exists in the design
 *    handoff — the build drafted them, the decision batch approved them).
 *    Every factual claim is registered in DRAFT_CLAIMS_FOR_PETER and
 *    pinned by test, so a claim cannot ship unflagged.
 */

import { DEPOSIT_REFUND_DEADLINE_LABEL, SEATS_TOTAL } from "@/app/lib/site";

/* ─────────────────── offer capacity (the over-offer trap) ─────────────────── */

export type OfferCapacityInput = {
  /** Paid, unrefunded deposits — the only thing that actually claims a seat. */
  paidDeposits: number;
  /** Offers out the door with no paid deposit yet (emailed or status
   *  `offered`): promises against seats nothing is holding. */
  outstandingOffers: number;
  seatsTotal?: number;
  /** W6: OF the outstanding offers, how many have a bank debit clearing.
   *  A display distinction ONLY — the subset is already inside
   *  `outstandingOffers` and must never be added to the headroom math
   *  (double-counting fires the over-commit warning early: the
   *  trained-to-click-through failure). */
  clearingDebits?: number;
};

export type OfferHeadroom = {
  /** Seats not yet claimed by money. */
  unclaimed: number;
  /** Seats not claimed AND not already promised — what an offer really draws on. */
  afterOutstanding: number;
  /** Every further offer promises a seat that cannot exist. */
  overCommitted: boolean;
};

export function offerHeadroom(input: OfferCapacityInput): OfferHeadroom {
  const total = input.seatsTotal ?? SEATS_TOTAL;
  const unclaimed = Math.max(0, total - Math.max(0, input.paidDeposits));
  const afterOutstanding = unclaimed - Math.max(0, input.outstandingOffers);
  return { unclaimed, afterOutstanding, overCommitted: afterOutstanding <= 0 };
}

/** What the offer confirm dialog renders: the line AND the warn flag — the
 *  red styling keys on the BOOLEAN, never on the prose (a copy revision
 *  must not silently downgrade the warning to grey). */
export type OfferCapacityDisplay = { line: string; warn: boolean };

/** Remaining MINUS outstanding — what this offer actually draws on. With
 *  `clearingDebits` (W6) the outstanding count splits into money-in-flight
 *  vs unanswered promises; totals and warn semantics are identical. */
export function offerCapacityDisplay(input: OfferCapacityInput): OfferCapacityDisplay {
  const h = offerHeadroom(input);
  const outstanding = Math.max(0, input.outstandingOffers);
  const middle =
    input.clearingDebits === undefined
      ? `${outstanding} offers outstanding`
      : `${Math.min(outstanding, Math.max(0, input.clearingDebits))} clearing bank debits · ${Math.max(0, outstanding - Math.max(0, input.clearingDebits))} offers unanswered`;
  const base = `${h.unclaimed} seats unclaimed · ${middle} · ${Math.max(0, h.afterOutstanding)} truly free`;
  return h.overCommitted
    ? { line: `${base} — this offer promises a seat that is not there. Waitlist instead?`, warn: true }
    : { line: base, warn: false };
}

/** CRM posture when the live seat count is unavailable: say so, in red —
 *  never a confident stale number (the marketing fallback removed the
 *  over-commit warning exactly when it mattered). */
export const CAPACITY_UNKNOWN: OfferCapacityDisplay = {
  line: "Seat capacity unavailable — verify seats before offering.",
  warn: true,
};

/** An offer is OUTSTANDING when it is out the door (email sent, or the
 *  child moved to offered-or-later) and no paid deposit has landed — a
 *  promise against a seat nothing is holding. */
export function countOutstandingOffers(
  items: {
    offerSentAt: string | null;
    reviewStatus: string;
    deposits: { status: string; refunded_at?: string | null }[];
  }[]
): number {
  // The CRM's ReviewStatus vocabulary, offered-or-later: 'invited' is an
  // ASSESSMENT invite (pre-offer — counting it fired the over-commit
  // warning early and trained staff to click through it), and 'member' is
  // the post-offer rung whose refunded-deposit case is exactly an
  // un-retired promise (both reviewers, by the CRM's own constants).
  const OFFERED_OR_LATER = ["offered", "member"];
  return items.filter((item) => {
    const paid = item.deposits.some((d) => d.status === "paid" && !d.refunded_at);
    if (paid) return false;
    return item.offerSentAt !== null || OFFERED_OR_LATER.includes(item.reviewStatus);
  }).length;
}

/** W6: the SPLIT of the outstanding count — money in flight vs a bare
 *  promise. A pending bank debit already counts as outstanding (no paid
 *  row yet), so this reclassifies rather than adds: clearingDebits +
 *  unansweredOffers === countOutstandingOffers(items), pinned by test.
 *  Staff need the difference at the point of offer; the arithmetic must
 *  not move. */
export type OutstandingSplit = { clearingDebits: number; unansweredOffers: number };

export function categorizeOutstanding(
  items: {
    offerSentAt: string | null;
    reviewStatus: string;
    deposits: { status: string; refunded_at?: string | null }[];
  }[]
): OutstandingSplit {
  const OFFERED_OR_LATER = ["offered", "member"];
  let clearingDebits = 0;
  let unansweredOffers = 0;
  for (const item of items) {
    const paid = item.deposits.some((d) => d.status === "paid" && !d.refunded_at);
    if (paid) continue;
    const outstanding = item.offerSentAt !== null || OFFERED_OR_LATER.includes(item.reviewStatus);
    if (!outstanding) continue;
    // Only a LIVE pending row is money in flight. A refunded, failed, or
    // expired row is a debit that will never clear — the family is back to
    // an unanswered offer, and calling it "clearing" would hold a seat
    // open against nothing (the refund-resurrection lesson, in display form).
    const clearing = item.deposits.some((d) => d.status === "pending" && !d.refunded_at);
    if (clearing) clearingDebits += 1;
    else unansweredOffers += 1;
  }
  return { clearingDebits, unansweredOffers };
}

/* ─────────────────── family routing after C2 (F7) ─────────────────── */

export type PostSubmitDestination = "review" | "dashboard" | "waitlist";

/** children.status values that mean the deposit path is live regardless of
 *  applicant_state — the two-column logic canReserveSeatForChild encodes,
 *  mirrored here because pre-funnel children carry applicant_state NULL and
 *  the sync trigger only bridges funnel children. */
const STATUS_OFFERED_OR_LATER = ["offered", "member"];

/**
 * Where a submitted family's "what happens next" lives. Offered-or-later —
 * by EITHER column — belongs on the dashboard (the deposit CTA is live
 * there); waitlisted goes to the waitlist screen; everyone else waits on
 * the review screen. Seats exhausted does NOT park in-review families on
 * the waitlist wall: they were never waitlisted, staff may still offer,
 * and the wall's membership copy would be a lie that flaps with every
 * refund — the review screen carries a truthful seats-full note instead.
 */
export function postSubmitDestination(input: {
  applicantState: string | null;
  status?: string;
  seatsRemaining: number;
}): PostSubmitDestination {
  const s = input.applicantState;
  if (s === "waitlisted") return "waitlist";
  if (s === "offered" || s === "deposited" || s === "enrolled") return "dashboard";
  if (input.status && STATUS_OFFERED_OR_LATER.includes(input.status)) return "dashboard";
  return "review";
}

/** The truthful seats-full line for in-review families (never the waitlist
 *  wall's membership claims). CONFIRMED as written 2026-07-28 (Peter). */
export const SEATS_FULL_REVIEW_NOTE =
  "All 120 seats are currently spoken for. Reviews continue, and seats can open if plans change.";

/* ─────────────────── the review-wait screen (confirmed 2026-07-28) ─────────────────── */

/** CONFIRMED as written 2026-07-28 (Peter, decision batch). Every factual
 *  claim below is registered in DRAFT_CLAIMS_FOR_PETER. */
export const REVIEW_SCREEN = {
  kicker: "Application received",
  title: "A real person reads this next.",
  intro:
    "Your application is in the review queue. Nothing else is needed from you right now.",
  steps: [
    {
      label: "Review",
      detail:
        "Our admissions team reads the full application: the project, the group choice, and what you told us about your builder.",
    },
    {
      label: "Decision",
      detail: "You hear from us by email within five business days, whichever way it goes.",
    },
    {
      label: "The seat",
      detail: `If a seat is offered, you reserve it from your dashboard with the $250 deposit, fully refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}.`,
    },
  ],
  footer:
    "Questions in the meantime? Reply to any email from us, or write admissions@the120.school.",
} as const;

/* ─────────────────── the waitlist screen (confirmed 2026-07-28) ─────────────────── */

export const WAITLIST_SCREEN = {
  kicker: "The founding cohort",
  title: "The 120 seats are spoken for.",
  intro:
    "Your builder's application stays exactly where it is, and the work they did stays theirs.",
  steps: [
    {
      label: "You hold a place in line",
      detail:
        "Seats open when a family's plans change. Deposits stay refundable until the published deadline, and released seats go to the waitlist in order.",
    },
    {
      label: "We contact you first",
      detail:
        "If a seat opens for your builder's group, the offer email comes to this address before the seat goes anywhere else.",
    },
  ],
  footer: "No action is needed to stay on the waitlist.",
} as const;

/**
 * EVERY factual claim in the drafted screens, registered and CONFIRMED
 * as written by Peter on 2026-07-28 (the decision batch). The test asserts
 * each claim's key phrase actually appears in the copy — so editing the
 * copy without re-visiting this register fails the suite, and a claim
 * cannot ship silently. New or reworded claims re-enter as UNVERIFIED.
 */
export const DRAFT_CLAIMS_FOR_PETER: { claim: string; phrase: string }[] = [
  {
    claim: "Review decisions arrive within five business days — CONFIRMED 2026-07-28 (Peter)",
    phrase: "five business days",
  },
  {
    claim: "Deposit is $250 — matches R51",
    phrase: "$250",
  },
  {
    claim: `Deposit refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL} — matches site.ts`,
    phrase: DEPOSIT_REFUND_DEADLINE_LABEL,
  },
  {
    claim: "Released seats go to the waitlist in order — CONFIRMED 2026-07-28 (Peter)",
    phrase: "in order",
  },
  {
    claim: "Waitlist families are contacted before a released seat goes elsewhere — CONFIRMED 2026-07-28 (Peter)",
    phrase: "before the seat goes anywhere else",
  },
  {
    claim: "admissions@the120.school is the contact address — matches the locked-wizard banner",
    phrase: "admissions@the120.school",
  },
  {
    claim: "A human admissions team reads every full application — CONFIRMED 2026-07-28 (Peter)",
    phrase: "admissions team reads the full application",
  },
  {
    claim: "The seat is reserved from the dashboard — true since the U13 offer-bridge trigger (applicant_state syncs from status)",
    phrase: "from your dashboard",
  },
];

/** The full drafted copy set, flattened for the claim-coverage test. */
export function draftedCopy(): string[] {
  return [
    REVIEW_SCREEN.kicker,
    REVIEW_SCREEN.title,
    REVIEW_SCREEN.intro,
    ...REVIEW_SCREEN.steps.flatMap((s) => [s.label, s.detail]),
    REVIEW_SCREEN.footer,
    WAITLIST_SCREEN.kicker,
    WAITLIST_SCREEN.title,
    WAITLIST_SCREEN.intro,
    ...WAITLIST_SCREEN.steps.flatMap((s) => [s.label, s.detail]),
    WAITLIST_SCREEN.footer,
  ];
}
