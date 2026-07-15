/**
 * Pure decision logic + Zod schemas for the dossier review actions
 * (plan Unit 5). No I/O and no next/supabase imports — everything here is
 * unit-testable (`actions-reviews.test.ts`); `actions/reviews.ts` imports
 * these and adds the guarded mutations around them (families-rules canon).
 */

import { z } from "zod";
import { hasLiveWorkshopPick } from "@/app/dashboard/data";
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

/**
 * Send-offer-email input (plan 2026-07-15-001 Unit 3). `resendOf` is the
 * stamp the confirming staff member saw, passed back VERBATIM as an opaque
 * string for the compare-and-swap resend claim — `{ offset: true }` because
 * PostgREST serializes timestamptz with `+00:00`, which Zod's strict
 * datetime default would reject (breaking every legitimate resend). Never
 * coerce this to a Date: a re-serialization can change precision/format and
 * silently defeat the CAS equality.
 */
export const sendOfferEmailSchema = z.object({
  childId: z.uuid(),
  resendOf: z.iso.datetime({ offset: true }).optional(),
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

/* ------------------------------------------------------------ queue counts */

/**
 * R14 — dossier-queue visibility derivation. "Needs review" counts every
 * candidate still gated from the seat deposit: all statuses after `draft`
 * and before `offered` (submitted, in_review, invited) — so a family staff
 * touched and then stalled on can't go invisible mid-process. `byStage`
 * feeds the per-chip counts that break the badge total down.
 */
export function queueCounts(items: { reviewStatus: ReviewStatus }[]): {
  needsReview: number;
  byStage: Record<ReviewStatus, number>;
} {
  const byStage = Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0])) as Record<
    ReviewStatus,
    number
  >;
  for (const i of items) byStage[i.reviewStatus] += 1;
  const draftIdx = REVIEW_STATUSES.indexOf("draft");
  const offeredIdx = REVIEW_STATUSES.indexOf("offered");
  const needsReview = items.filter((i) => {
    const idx = REVIEW_STATUSES.indexOf(i.reviewStatus);
    return idx > draftIdx && idx < offeredIdx;
  }).length;
  return { needsReview, byStage };
}

/* ------------------------------------------------------------ completeness */

/**
 * The dossier fields completeness counts — a 1:1 mirror of the parent
 * dashboard's checklist (`app/dashboard/data.ts` `checklist()`), so both
 * sides of the product report the same number. Group-aware (R14): name
 * (first+last), grade, birth year (4 digits), current school, a group,
 * academics (an entry with subject+plan, or legacy ≥1 subject), a workshop
 * (Scholars only), interests (≥3 chars), project pitch (≥10 chars) —
 * 8 items (9 for Scholars), equal weight.
 *
 * LOCKSTEP MIRRORS (R14): this definition is duplicated in
 * `app/dashboard/data.ts` (checklist — parent meter) and
 * `app/lib/nurture/rules.ts` (dossierCompleteness — stall nudge). Change
 * all three together or the parent meter, nudge, and queue % disagree.
 */
export interface DossierFields {
  firstName: string;
  lastName: string;
  grade: number | null;
  birthYear: string;
  currentSchool: string;
  /** The parent's group pick; "" (or a missing column) = not chosen yet. */
  groupSlug: string;
  /** jsonb array of {subject, plan, goal} — tolerant-parsed, never trusted. */
  academics: unknown;
  subjects: string[];
  workshopIds: string[];
  interests: string;
  projectPitch: string;
}

/** One structured academics entry, post tolerant parse. */
export interface DossierAcademic {
  subject: string;
  plan: string;
  goal: string;
}

/** Tolerant jsonb parse — non-arrays and junk entries render as empty. */
export function asAcademics(value: unknown): DossierAcademic[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      subject: typeof a.subject === "string" ? a.subject : "",
      plan: typeof a.plan === "string" ? a.plan : "",
      goal: typeof a.goal === "string" ? a.goal : "",
    }));
}

/** An academics entry counts toward completeness when subject AND plan are set. */
const academicEntryComplete = (a: DossierAcademic): boolean =>
  a.subject.trim() !== "" && a.plan.trim() !== "";

export function dossierChecklist(
  f: DossierFields
): { label: string; done: boolean }[] {
  const groupSlug = f.groupSlug ?? "";
  const items = [
    { label: "Name", done: !!f.firstName.trim() && !!f.lastName.trim() },
    { label: "Grade", done: f.grade !== null },
    { label: "Birth year", done: /^\d{4}$/.test(f.birthYear.trim()) },
    { label: "Current school", done: !!f.currentSchool.trim() },
    { label: "A group", done: groupSlug !== "" },
    {
      label: "Academics (a subject + plan)",
      done:
        asAcademics(f.academics).some(academicEntryComplete) ||
        f.subjects.length >= 1,
    },
  ];
  if (groupSlug === "scholars") {
    items.push({ label: "A workshop of interest", done: hasLiveWorkshopPick(f.workshopIds) });
  }
  items.push(
    { label: "The kid's interests", done: f.interests.trim().length >= 3 },
    { label: "A project pitch", done: f.projectPitch.trim().length >= 10 }
  );
  return items;
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
