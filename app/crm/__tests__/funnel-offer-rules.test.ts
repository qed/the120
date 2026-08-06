import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CAPACITY_UNKNOWN,
  DRAFT_CLAIMS_FOR_PETER,
  categorizeOutstanding,
  countOutstandingOffers,
  draftedCopy,
  offerCapacityDisplay,
  offerHeadroom,
  postSubmitDestination,
} from "@/app/lib/funnel/offer-rules";
import { offerEmailTemplate, offerButtonState } from "@/app/crm/lib/offer-rules";
import { canReserveSeatForChild } from "@/app/dashboard/data";
import { SITE_URL } from "@/app/lib/site";
import { V2_DEEP_ROUTE_TARGET } from "@/app/lib/v3-signup/v2-deep-routes";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

/** U13 (R49a, F5): the review state and the offer bridge. */

describe("offerHeadroom — offers do not reserve seats (the over-offer trap)", () => {
  it("computes unclaimed, after-outstanding, and the over-commit flag", () => {
    const h = offerHeadroom({ paidDeposits: 7, outstandingOffers: 5, seatsTotal: 120 });
    expect(h).toEqual({ unclaimed: 113, afterOutstanding: 108, overCommitted: false });
  });

  it("flags over-commitment exactly when outstanding promises exhaust the unclaimed seats", () => {
    expect(
      offerHeadroom({ paidDeposits: 100, outstandingOffers: 19, seatsTotal: 120 }).overCommitted
    ).toBe(false);
    expect(
      offerHeadroom({ paidDeposits: 100, outstandingOffers: 20, seatsTotal: 120 }).overCommitted
    ).toBe(true);
    expect(
      offerHeadroom({ paidDeposits: 120, outstandingOffers: 0, seatsTotal: 120 }).overCommitted
    ).toBe(true);
  });

  it("garbage inputs clamp instead of going negative", () => {
    const h = offerHeadroom({ paidDeposits: 200, outstandingOffers: -3, seatsTotal: 120 });
    expect(h.unclaimed).toBe(0);
    expect(h.overCommitted).toBe(true);
  });

  it("the staff display carries all three numbers, and the warn FLAG (not prose) drives the styling", () => {
    const fine = offerCapacityDisplay({ paidDeposits: 7, outstandingOffers: 5, seatsTotal: 120 });
    expect(fine.line).toContain("113");
    expect(fine.line).toContain("5 offers outstanding");
    expect(fine.line).toContain("108 truly free");
    expect(fine.warn).toBe(false);
    const over = offerCapacityDisplay({ paidDeposits: 120, outstandingOffers: 1, seatsTotal: 120 });
    expect(over.warn).toBe(true);
  });

  it("W6: outstanding splits into clearing debits vs unanswered offers, and the SUM equals the old count", () => {
    const item = (over: Record<string, unknown>) => ({
      offerSentAt: "2026-07-28T00:00:00Z",
      reviewStatus: "offered",
      deposits: [] as { status: string; refunded_at?: string | null }[],
      ...over,
    });
    const items = [
      item({ deposits: [{ status: "pending" }] }), // clearing bank debit
      item({ deposits: [] }), // unanswered
      item({ deposits: [{ status: "expired" }] }), // failed debit → unanswered
      item({ deposits: [{ status: "paid", refunded_at: null }] }), // paid → not outstanding at all
      item({ offerSentAt: null, reviewStatus: "in_review", deposits: [{ status: "pending" }] }), // not offered → excluded
    ];
    const split = categorizeOutstanding(items);
    expect(split.clearingDebits).toBe(1);
    expect(split.unansweredOffers).toBe(2);
    // The invariant that prevents double-counting: split sums to the exact
    // count offerHeadroom already consumes — never a second input to it.
    expect(split.clearingDebits + split.unansweredOffers).toBe(countOutstandingOffers(items));
  });

  it("W6: the sum invariant holds across the FULL status × deposit-state space, not hand-picked cases", () => {
    // Both functions call isOutstandingOffer, so the invariant is
    // structural — this sweeps the space that would have caught a drift
    // back when they were two hand-synchronized predicates (U2 review).
    const statuses = ["draft", "submitted", "in_review", "invited", "offered", "member", "waitlisted"];
    const depositSets: { status: string; refunded_at?: string | null }[][] = [
      [],
      [{ status: "pending" }],
      [{ status: "pending", refunded_at: "2026-07-29T00:00:00Z" }],
      [{ status: "paid", refunded_at: null }],
      [{ status: "paid", refunded_at: "2026-07-29T00:00:00Z" }],
      [{ status: "refunded", refunded_at: "2026-07-29T00:00:00Z" }],
      [{ status: "failed" }],
      [{ status: "expired" }],
      [{ status: "expired" }, { status: "pending" }],
      [{ status: "pending" }, { status: "paid", refunded_at: null }],
    ];
    for (const reviewStatus of statuses) {
      for (const offerSentAt of [null, "2026-07-28T00:00:00Z"]) {
        for (const deposits of depositSets) {
          const items = [{ offerSentAt, reviewStatus, deposits }];
          const s = categorizeOutstanding(items);
          expect(
            s.clearingDebits + s.unansweredOffers,
            `${reviewStatus} / offerSentAt=${offerSentAt} / ${JSON.stringify(deposits)}`
          ).toBe(countOutstandingOffers(items));
        }
      }
    }
  });

  it("W7: waitlisting retires the outstanding promise, even though the offer stamp remains", () => {
    const waitlisted = {
      offerSentAt: "2026-07-28T00:00:00Z",
      reviewStatus: "waitlisted",
      deposits: [] as { status: string; refunded_at?: string | null }[],
    };
    expect(countOutstandingOffers([waitlisted])).toBe(0);
    const split = categorizeOutstanding([waitlisted]);
    expect(split.clearingDebits + split.unansweredOffers).toBe(0);
    // Un-waitlisting brings the promise back.
    expect(countOutstandingOffers([{ ...waitlisted, reviewStatus: "offered" }])).toBe(1);
  });

  it("W6: a refunded or downgraded row is never 'clearing money'", () => {
    const child = (deposits: { status: string; refunded_at?: string | null }[]) => ({
      offerSentAt: "2026-07-28T00:00:00Z",
      reviewStatus: "offered",
      deposits,
    });
    const split = categorizeOutstanding([
      child([{ status: "pending", refunded_at: "2026-07-29T00:00:00Z" }]),
      child([{ status: "failed" }]),
    ]);
    expect(split.clearingDebits).toBe(0);
    expect(split.unansweredOffers).toBe(2);
  });

  it("W6: the dialog line carries the two-part breakdown when provided, same totals, same warn semantics", () => {
    const display = offerCapacityDisplay({
      paidDeposits: 7,
      outstandingOffers: 5,
      seatsTotal: 120,
      clearingDebits: 2,
    });
    expect(display.line).toContain("113 seats unclaimed");
    expect(display.line).toContain("2 clearing bank debits");
    expect(display.line).toContain("3 offers unanswered");
    expect(display.line).toContain("108 truly free");
    expect(display.warn).toBe(false);
    // Legacy single-count call keeps the original line (other call sites).
    const legacy = offerCapacityDisplay({ paidDeposits: 7, outstandingOffers: 5, seatsTotal: 120 });
    expect(legacy.line).toContain("5 offers outstanding");
  });

  it("an unavailable seat count renders as UNKNOWN with the warn flag, never a confident stale number", () => {
    // The marketing fallback (hand-maintained 113) in the offer dialog
    // would REMOVE the over-commit warning exactly when it matters.
    expect(CAPACITY_UNKNOWN.warn).toBe(true);
    expect(CAPACITY_UNKNOWN.line.toLowerCase()).toContain("unavailable");
    const page = read("app/crm/(app)/dossiers/page.tsx");
    expect(page).toContain("getSeatsRemainingStrict");
    expect(page).toContain("CAPACITY_UNKNOWN");
  });
});

describe("countOutstandingOffers", () => {
  const item = (over: Partial<Parameters<typeof countOutstandingOffers>[0][number]> = {}) => ({
    offerSentAt: null as string | null,
    reviewStatus: "in_review",
    deposits: [] as { status: string; refunded_at?: string | null }[],
    ...over,
  });

  it("counts emailed offers, 'offered', and 'member', and NOT the pre-offer 'invited'", () => {
    // 'invited' is an assessment invite (before offered in the CRM ladder);
    // counting it fired the over-commit warning early and trained staff to
    // click through it (both reviewers). 'member' without a live deposit is
    // an un-retired promise (the memberNoDeposit flow-gap).
    expect(
      countOutstandingOffers([
        item({ offerSentAt: "2026-07-28T00:00:00Z" }),
        item({ reviewStatus: "offered" }),
        item({ reviewStatus: "member" }),
        item({ reviewStatus: "invited" }),
        item(),
      ])
    ).toBe(3);
  });

  it("a live paid deposit retires the promise; a refunded one does not", () => {
    expect(
      countOutstandingOffers([
        item({ reviewStatus: "offered", deposits: [{ status: "paid", refunded_at: null }] }),
        item({
          reviewStatus: "offered",
          deposits: [{ status: "paid", refunded_at: "2026-07-01T00:00:00Z" }],
        }),
      ])
    ).toBe(1);
  });
});

describe("postSubmitDestination (F7 routing, two-column)", () => {
  it("routes each rung of the ladder to its screen", () => {
    const seats = { seatsRemaining: 10 };
    expect(postSubmitDestination({ applicantState: "submitted", ...seats })).toBe("review");
    expect(postSubmitDestination({ applicantState: "in_review", ...seats })).toBe("review");
    expect(postSubmitDestination({ applicantState: null, ...seats })).toBe("review");
    expect(postSubmitDestination({ applicantState: "offered", ...seats })).toBe("dashboard");
    expect(postSubmitDestination({ applicantState: "deposited", ...seats })).toBe("dashboard");
    expect(postSubmitDestination({ applicantState: "enrolled", ...seats })).toBe("dashboard");
    expect(postSubmitDestination({ applicantState: "waitlisted", ...seats })).toBe("waitlist");
  });

  it("children.status carries the decision for pre-funnel children (applicant_state NULL)", () => {
    expect(
      postSubmitDestination({ applicantState: null, status: "offered", seatsRemaining: 10 })
    ).toBe("dashboard");
    expect(
      postSubmitDestination({ applicantState: null, status: "member", seatsRemaining: 10 })
    ).toBe("dashboard");
    expect(
      postSubmitDestination({ applicantState: null, status: "in_review", seatsRemaining: 10 })
    ).toBe("review");
  });

  it("seats exhausted does NOT park in-review families on the waitlist wall", () => {
    // The wall asserts membership ('you hold a place in line'); an in-review
    // family at seats 0 stays on the review screen, which carries the
    // truthful seats-full note instead. Staff may still offer them.
    expect(postSubmitDestination({ applicantState: "submitted", seatsRemaining: 0 })).toBe(
      "review"
    );
    expect(postSubmitDestination({ applicantState: "offered", seatsRemaining: 0 })).toBe(
      "dashboard"
    );
  });
});

describe("the offer bridge (the U13 critical: applicant_state must advance)", () => {
  it("the sync trigger exists in the migrations: status transitions derive applicant_state for funnel children", () => {
    const all = read("supabase/migrations/20260810120000_funnel_applicant_state_sync.sql");
    expect(all).toContain("children_applicant_state_sync");
    expect(all).toContain("before update of status");
    // The mapping the checkout gate depends on:
    expect(all).toMatch(/when 'offered'\s+then 'offered'/);
    expect(all).toMatch(/when 'member'\s+then 'enrolled'/);
    // Forward-only, and pre-funnel NULLs untouched:
    expect(all).toContain("if NEW.applicant_state is null");
    expect(all).toContain("v_new_idx > v_old_idx");
  });
});

describe("the deposit gate (direct reserve 2026-08-02) vs the STAFF offer gate (unchanged)", () => {
  it("the checkout predicate admits every pre-offer funnel state; only waitlisted refuses", () => {
    for (const state of ["added", "project_created", "submitted", "in_review"]) {
      expect(
        canReserveSeatForChild({ status: "submitted", applicantState: state, deposits: [] }),
        state
      ).toBe(true);
    }
    expect(
      canReserveSeatForChild({ status: "submitted", applicantState: "waitlisted", deposits: [] })
    ).toBe(false);
    expect(
      canReserveSeatForChild({ status: "offered", applicantState: "offered", deposits: [] })
    ).toBe(true);
  });

  it("the STAFF offer-email gate keeps offered-or-later — a draft child is never sendable", () => {
    // The deliberate split (nav-deposit-shortcut plan): relaxing the parent
    // deposit gate must NOT leak into the offer-email gates, which still mean
    // "staff approved this child". offerButtonState delegates to bare
    // canReserveSeat, whose ladder is untouched.
    for (const reviewStatus of ["draft", "submitted", "in_review"]) {
      expect(
        offerButtonState({
          reviewStatus,
          deposits: [],
          effectiveParentEmail: "p@x.com",
          offerSentAt: null,
        }),
        reviewStatus
      ).toBe("not_offered");
    }
  });

  it("a staff offer makes the CTA reachable: the button predicate flips from not_offered to sendable", () => {
    expect(
      offerButtonState({
        reviewStatus: "in_review",
        deposits: [],
        effectiveParentEmail: "p@x.com",
        offerSentAt: null,
      })
    ).toBe("not_offered");
    expect(
      offerButtonState({
        reviewStatus: "offered",
        deposits: [],
        effectiveParentEmail: "p@x.com",
        offerSentAt: null,
      })
    ).toBe("sendable");
  });
});

describe("the three renderings carry the same deposit target", () => {
  it("text and html both point at the LIVE destination, never the retired /start/next-steps", () => {
    // R50 put this mail at `/start/next-steps`. v3 Unit 9 archived that flow
    // and left the URL a bare redirect; Unit 10 did the copy pass, so the mail
    // now names where the family actually lands — read from the same retirement
    // table the redirect stubs read, so the two can never disagree.
    const t = offerEmailTemplate({ childFirstName: "Maya", parentName: "Sam" });
    expect(t.text).toContain(`${SITE_URL}${V2_DEEP_ROUTE_TARGET}`);
    expect(t.html).toContain(`${SITE_URL}${V2_DEEP_ROUTE_TARGET}`);
    expect(t.text).not.toContain("/start/next-steps");
    expect(t.html).not.toContain("/start/next-steps");
  });

  it("the confirm-dialog preview renders the SAME template function (wiring scan)", () => {
    const src = read("app/crm/components/dossiers/OfferEmailButton.tsx");
    expect(src).toContain("offerEmailTemplate(");
    expect(src).toContain("{template.text}");
    // No second link literal (any quote style) that could drift from the
    // template's target: the single-quote-only check was dead in a
    // double-quoted TSX file (reviewer).
    expect(src).not.toMatch(/["'`]\/(dashboard|start\/next-steps)/);
  });

  it("the capacity display is threaded to the dialog (wiring scan)", () => {
    const page = read("app/crm/(app)/dossiers/page.tsx");
    expect(page).toContain("offerCapacityDisplay(");
    expect(page).toContain("countOutstandingOffers(");
    // W6: the dialog sees the split — clearing money vs mere promises.
    expect(page).toContain("categorizeOutstanding(");
    const button = read("app/crm/components/dossiers/OfferEmailButton.tsx");
    expect(button).toContain("capacity.warn");
  });
});

describe("the confirmed screens (2026-07-28 decision batch)", () => {
  it("the review screen says what happens next AND WHEN", () => {
    const copy = draftedCopy().join(" ");
    expect(copy).toMatch(/within .* days/);
    expect(copy).toContain("$250");
  });

  it("every registered factual claim actually appears in the copy — a claim cannot drift unflagged", () => {
    const copy = draftedCopy().join(" ");
    expect(DRAFT_CLAIMS_FOR_PETER.length).toBeGreaterThanOrEqual(4);
    for (const { claim, phrase } of DRAFT_CLAIMS_FOR_PETER) {
      expect(copy, claim).toContain(phrase);
    }
  });

  it("every claim is confirmed — zero UNVERIFIED remain in this register (2026-07-28 batch)", () => {
    // The counsel-flagged item lives in POLICY_CLAIMS_FOR_PETER
    // (deposit-rules), not here. A new or reworded claim re-enters as
    // UNVERIFIED and deliberately reddens this pin.
    const unverified = DRAFT_CLAIMS_FOR_PETER.filter((c) => c.claim.includes("UNVERIFIED"));
    expect(unverified).toEqual([]);
  });

  it("copy rules hold: no em dashes, no 'failed', no promised outcomes", () => {
    for (const line of draftedCopy()) {
      expect(line, line).not.toContain("—");
      expect(line.toLowerCase(), line).not.toMatch(/\bfail(ed|ure)?\b/);
      expect(line.toLowerCase(), line).not.toMatch(/will (earn|make)|guaranteed/);
    }
  });
});
