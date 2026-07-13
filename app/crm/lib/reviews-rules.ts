/**
 * Pure decision logic + Zod schemas for the dossier review actions
 * (plan Unit 5). No I/O and no next/supabase imports — everything here is
 * unit-testable (`actions-reviews.test.ts`); `actions/reviews.ts` imports
 * these and adds the guarded mutations around them (families-rules canon).
 */

import { z } from "zod";
import { GROUPS, REVIEW_STATUSES, type ReviewStatus } from "./constants";

/* ---------------------------------------------------------------- schemas */

export const moveCandidateSchema = z.object({
  childId: z.uuid(),
  reviewStatus: z.enum(REVIEW_STATUSES),
  group: z.enum(GROUPS).optional(),
  note: z.string().trim().max(2000).optional(),
});

export type MoveCandidateInput = z.infer<typeof moveCandidateSchema>;

/** `group: null` = explicit unassign (the chip row's "unassigned" state). */
export const assignGroupSchema = z.object({
  childId: z.uuid(),
  group: z.enum(GROUPS).nullable(),
});

export const saveReviewNotesSchema = z.object({
  childId: z.uuid(),
  /** Empty string allowed — saving an empty box clears the notes. */
  notes: z.string().max(8000),
});

/* -------------------------------------------------- effective review status */

/**
 * The status the queue trusts (Decision 1/6): a `child_reviews` row is
 * authoritative when present; without one, `children.status` is trusted only
 * for the states parents legitimately control (`draft`/`submitted`) — any
 * other value clamps to `submitted` so a forged parent write can never
 * render as review progress.
 */
export function effectiveReviewStatus(
  childStatus: string,
  review: { review_status: string } | null | undefined
): ReviewStatus {
  if (review) {
    return (REVIEW_STATUSES as readonly string[]).includes(review.review_status)
      ? (review.review_status as ReviewStatus)
      : "submitted";
  }
  return childStatus === "draft" ? "draft" : "submitted";
}

/* ------------------------------------------------------------- pill colors */

/**
 * Admin.dc.html pill logic, verbatim: early stages (draft/submitted) =
 * bone/ink, MEMBER = red/white, everything mid-review = blue/white.
 */
export function reviewPillColors(status: ReviewStatus): {
  bg: string;
  text: string;
} {
  if (status === "draft" || status === "submitted") {
    return { bg: "#E0DDD7", text: "#55585E" };
  }
  if (status === "member") return { bg: "#D92632", text: "#FFFFFF" };
  return { bg: "#0300ED", text: "#FFFFFF" };
}

/* ------------------------------------------------------------ completeness */

/**
 * The dossier fields completeness counts — a 1:1 mirror of the parent
 * dashboard's checklist (`app/dashboard/data.ts` `checklist()`), so both
 * sides of the product report the same number: name (first+last), grade,
 * birth year (4 digits), current school, ≥1 subject, ≥1 workshop,
 * interests (≥3 chars), project pitch (≥10 chars). 8 items, equal weight.
 */
export interface DossierFields {
  firstName: string;
  lastName: string;
  grade: number | null;
  birthYear: string;
  currentSchool: string;
  subjects: string[];
  workshopIds: string[];
  interests: string;
  projectPitch: string;
}

export function dossierChecklist(
  f: DossierFields
): { label: string; done: boolean }[] {
  return [
    { label: "Name", done: !!f.firstName.trim() && !!f.lastName.trim() },
    { label: "Grade", done: f.grade !== null },
    { label: "Birth year", done: /^\d{4}$/.test(f.birthYear.trim()) },
    { label: "Current school", done: !!f.currentSchool.trim() },
    { label: "1–2 subjects to accelerate", done: f.subjects.length >= 1 },
    { label: "A workshop of interest", done: f.workshopIds.length >= 1 },
    { label: "The kid's interests", done: f.interests.trim().length >= 3 },
    { label: "A project pitch", done: f.projectPitch.trim().length >= 10 },
  ];
}

/** 0–100, rounded — same math as the parent dashboard's meter. */
export function dossierCompleteness(f: DossierFields): number {
  const items = dossierChecklist(f);
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

/* ----------------------------------------------------------- payment strip */

export interface DepositForStrip {
  status: string;
  amount: number;
  created_at: string;
  refunded_at: string | null;
  stripe_payment_intent: string | null;
}

export type PaymentStripState =
  | {
      kind: "paid";
      amount: number;
      paidAt: string;
      paymentIntent: string | null;
    }
  | {
      kind: "refunded";
      amount: number;
      refundedAt: string | null;
      paymentIntent: string | null;
    }
  | { kind: "none" };

const isLivePaid = (d: DepositForStrip): boolean =>
  d.status === "paid" && !d.refunded_at;

const isRefunded = (d: DepositForStrip): boolean =>
  d.status === "refunded" || Boolean(d.refunded_at);

const newestFirst = (a: DepositForStrip, b: DepositForStrip): number =>
  b.created_at.localeCompare(a.created_at);

/**
 * Resolve one child's deposit rows into the strip state: a live paid
 * deposit wins (newest if several), else the newest refunded one, else
 * NO DEPOSIT. The webhook flips `status` and stamps `refunded_at`
 * (Decision 2a) — either signal reads as refunded here, fail-safe.
 */
export function resolvePaymentStrip(
  deposits: DepositForStrip[]
): PaymentStripState {
  const paid = deposits.filter(isLivePaid).sort(newestFirst)[0];
  if (paid) {
    return {
      kind: "paid",
      amount: paid.amount,
      paidAt: paid.created_at,
      paymentIntent: paid.stripe_payment_intent,
    };
  }
  const refunded = deposits.filter(isRefunded).sort(newestFirst)[0];
  if (refunded) {
    return {
      kind: "refunded",
      amount: refunded.amount,
      refundedAt: refunded.refunded_at,
      paymentIntent: refunded.stripe_payment_intent,
    };
  }
  return { kind: "none" };
}

/**
 * Flow-gap-10 warning: review says MEMBER but no live paid deposit backs it
 * (never paid, or paid then refunded). Renders the MEMBER · NO DEPOSIT chip.
 */
export function memberNoDeposit(
  reviewStatus: ReviewStatus,
  deposits: DepositForStrip[]
): boolean {
  return reviewStatus === "member" && !deposits.some(isLivePaid);
}

/**
 * Stripe test-dashboard deep link (S5 scope — swap to the live URL at S10
 * go-live). Account segment matches the connected test account.
 */
export function stripePaymentUrl(paymentIntent: string): string {
  return `https://dashboard.stripe.com/acct_103s7v25N9cbf3wU/test/payments/${paymentIntent}`;
}
