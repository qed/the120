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
 *  - the DRAFTED copy for the review-wait and waitlist screens. Neither
 *    screen exists in the design handoff — Peter revises. Every factual
 *    claim in the copy is registered in DRAFT_CLAIMS_FOR_PETER and pinned
 *    by test, so a claim cannot ship unflagged.
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

/** Remaining MINUS outstanding — what this offer actually draws on. */
export function offerCapacityDisplay(input: OfferCapacityInput): OfferCapacityDisplay {
  const h = offerHeadroom(input);
  const base = `${h.unclaimed} seats unclaimed · ${Math.max(0, input.outstandingOffers)} offers outstanding · ${Math.max(0, h.afterOutstanding)} truly free`;
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
 *  wall's membership claims). ⚠ DRAFT, Peter revises. */
export const SEATS_FULL_REVIEW_NOTE =
  "All 120 seats are currently spoken for. Reviews continue, and seats can open if plans change.";

/* ─────────────────── the review-wait screen (DRAFT — Peter revises) ─────────────────── */

/** ⚠ DRAFT COPY, Peter revises (decision on file 2026-07-28). Every factual
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

/* ─────────────────── the waitlist screen (DRAFT — Peter revises) ─────────────────── */

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
 * ⚠ EVERY factual claim in the drafted screens, registered for Peter's
 * revision pass. The test asserts each claim's key phrase actually appears
 * in the copy — so editing the copy without re-visiting this register
 * fails the suite, and a claim cannot ship silently.
 */
export const DRAFT_CLAIMS_FOR_PETER: { claim: string; phrase: string }[] = [
  {
    claim: "Review decisions arrive within five business days — UNVERIFIED, Peter to confirm or reword",
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
    claim: "Released seats go to the waitlist in order — UNVERIFIED policy, Peter to confirm",
    phrase: "in order",
  },
  {
    claim: "Waitlist families are contacted before a released seat goes elsewhere — UNVERIFIED policy, Peter to confirm",
    phrase: "before the seat goes anywhere else",
  },
  {
    claim: "admissions@the120.school is the contact address — matches the locked-wizard banner",
    phrase: "admissions@the120.school",
  },
  {
    claim: "A human admissions team reads every full application — UNVERIFIED staffing promise, Peter to confirm",
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
