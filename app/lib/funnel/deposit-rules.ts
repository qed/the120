/**
 * Deposit integrity — the pure decision surface (funnel U14; R50, R51,
 * R51a, R52, R52a, R52b). Every branch the two Stripe routes take lives
 * here, testable without Stripe or a database. Client-safe: no node
 * imports (the policy text renders inline at the point of payment).
 */

import { DEPOSIT_REFUND_DEADLINE_LABEL, SITE_URL } from "@/app/lib/site";

/* ─────────────────── R51: the ask, stated at the point of ask ─────────────────── */

export const DEPOSIT_AMOUNT_CENTS = 25000;

/* ─────────────────── origin validation (never echo a foreign header) ─────────────────── */

/** Redirect URLs are built from OUR origins only. A foreign Origin header
 *  must never reach the Stripe success/cancel URLs — that is an open
 *  redirect through the payment flow. */
export const ALLOWED_ORIGINS: readonly string[] =
  process.env.NODE_ENV === "production"
    ? [SITE_URL]
    : [SITE_URL, "http://localhost:3000"];

export function resolveOrigin(originHeader: string | null): string {
  return originHeader && ALLOWED_ORIGINS.includes(originHeader) ? originHeader : SITE_URL;
}

/* ─────────────────── R51a: the refund policy, full text, versioned ─────────────────── */

/**
 * Policy text CONFIRMED as written 2026-07-28 (Peter, decision batch);
 * the post-deadline-tuition wording remains flagged pending Ontario
 * counsel. Rendered IN FULL at the point of payment above an UNTICKED
 * checkbox — a checkbox containing only a link is explicitly rejected by
 * card issuers as dispute evidence. The accepted version/hash/timestamp/IP
 * persist on the attempt row — and, since 2026-07-28.2, that acceptance
 * record is ALSO the verifiable parental-consent artifact Google's
 * Education terms require BEFORE a student account may be provisioned
 * (the funnel-wrap plan's consent-precedes-minting decision): U15's
 * provisioning refuses to mint unless the fulfilled deposit carries an
 * acceptance at-or-after this version. Change the TEXT → bump the
 * VERSION, always.
 */
export const REFUND_POLICY = {
  version: "2026-07-28.2",
  text:
    `The $250 seat deposit reserves your child's place in The 120's founding cohort. ` +
    `It is fully refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}: email admissions@the120.school ` +
    `from the address on this account and the deposit is returned to the original payment method. ` +
    `After ${DEPOSIT_REFUND_DEADLINE_LABEL}, the deposit is applied to tuition and is no longer refundable. ` +
    `If The 120 cannot offer your child a place in the program, the deposit is refunded in full regardless of date. ` +
    `By paying the deposit you confirm you are the parent or legal guardian of the child named on this application, ` +
    `and you consent to The 120 creating a school account and email address for your child as part of enrolment.`,
} as const;

/** The first policy version whose acceptance includes parental consent to
 *  provision the child's school account (U15 gates minting on this). A
 *  fixed HISTORICAL ANCHOR — it does not move on later text bumps unless
 *  the consent clause itself changes. */
export const CONSENT_MIN_POLICY_VERSION = "2026-07-28.2";

/**
 * Every policy version that has ever been PUBLISHED, oldest first.
 *
 * Exists so consent can be checked against reality rather than against
 * arithmetic. An ordering test alone ("is this at-or-after the anchor?")
 * accepts any well-formed string that sorts late — `2099-01-01.1` passes,
 * as would a version from some other document. That is only safe today
 * because the checkout route pins the accepted version by strict equality
 * to the live constant; a backfill, an admin override, or a second write
 * path would quietly bypass it, and the thing being authorised is a real
 * mailbox for a real child (adversarial review).
 *
 * ⚠️ Append every new version here in the same PR that bumps
 * REFUND_POLICY.version — a test pins that the live version is a member.
 */
export const PUBLISHED_POLICY_VERSIONS: readonly string[] = ["2026-07-28.1", "2026-07-28.2"];

/**
 * Structural "at-or-after" for policy versions ("YYYY-MM-DD.N"). NEVER
 * compare these lexicographically: "2026-07-28.10" < "2026-07-28.2" as a
 * string, but .10 is the LATER revision (U1 review). Malformed versions
 * fail closed (false) — an unparsable acceptance is never treated as
 * consenting.
 */
export function policyVersionAtLeast(version: string | null | undefined, min: string): boolean {
  const parse = (v: string): { date: string; n: number } | null => {
    const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(v);
    return m ? { date: m[1], n: Number(m[2]) } : null;
  };
  const a = version ? parse(version) : null;
  const b = parse(min);
  if (!a || !b) return false;
  if (a.date !== b.date) return a.date > b.date;
  return a.n >= b.n;
}

/** Factual claims in the policy, registered (U13 pattern). Confirmed as
 *  written 2026-07-28 (Peter) except where flagged. */
export const POLICY_CLAIMS_FOR_PETER: { claim: string; phrase: string }[] = [
  { claim: "Deposit is $250 — matches R51", phrase: "$250" },
  {
    claim: `Refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL} — matches site.ts`,
    phrase: DEPOSIT_REFUND_DEADLINE_LABEL,
  },
  {
    claim: "Refund requested by email to admissions@ — CONFIRMED 2026-07-28 (Peter)",
    phrase: "admissions@the120.school",
  },
  {
    claim: "Post-deadline deposit applies to tuition — UNVERIFIED policy, Peter/Ontario counsel to confirm",
    phrase: "applied to tuition",
  },
  {
    claim: "Full refund if no place can be offered — CONFIRMED 2026-07-28 (Peter)",
    phrase: "regardless of date",
  },
  {
    claim:
      "Payment confirms parent/guardian status and consents to the child's school account — UNVERIFIED wording, Peter/Ontario counsel to confirm (ordering decided: consent precedes minting)",
    phrase: "school account and email address",
  },
];

/* ─────────────────── the webhook taxonomy (R52, R52b) ─────────────────── */

export type WebhookPlan =
  | { kind: "fulfil" }
  | { kind: "pending" }
  | { kind: "payment_failed" }
  | { kind: "expired" }
  | { kind: "refund" }
  | { kind: "ignore" };

/**
 * Which branch an event takes — "on error" is not a specification (the
 * R40a lesson, applied to money). `completed` with `payment_status:
 * "unpaid"` is a DELAYED payment method: record pending, do not fulfil;
 * `async_payment_succeeded` fulfils through the SAME idempotent path.
 */
export function webhookPlan(event: {
  type: string;
  paymentStatus?: string | null;
}): WebhookPlan {
  switch (event.type) {
    case "checkout.session.completed":
      return event.paymentStatus === "paid" ? { kind: "fulfil" } : { kind: "pending" };
    case "checkout.session.async_payment_succeeded":
      return { kind: "fulfil" };
    case "checkout.session.async_payment_failed":
      return { kind: "payment_failed" };
    case "checkout.session.expired":
      return { kind: "expired" };
    case "charge.refunded":
      return { kind: "refund" };
    default:
      return { kind: "ignore" };
  }
}

/* ─────────────────── fulfilment verdicts (the refund-resurrection bug) ─────────────────── */

export type ExistingDeposit = {
  status: string;
  refunded_at: string | null;
} | null;

export type FulfilVerdict = "write" | "replay_noop" | "refused_refunded";

/**
 * The documented bug this closes: a redelivered `completed` after a refund
 * re-set `paid` WITHOUT clearing `refunded_at`, leaving `hasPaidDeposit`
 * and `isLivePaid` permanently disagreeing. The refund is newer truth than
 * any replayed fulfilment: a refunded row is never resurrected.
 */
export function fulfilVerdict(existing: ExistingDeposit): FulfilVerdict {
  if (!existing) return "write";
  if (existing.status === "refunded" || existing.refunded_at) return "refused_refunded";
  if (existing.status === "paid") return "replay_noop";
  // pending / failed / expired rows upgrade to paid.
  return "write";
}

/** Terminal-state guard for the non-fulfil updates: expired/failed must
 *  never downgrade a row that already reached paid or refunded. */
export function downgradeAllowed(existing: ExistingDeposit): boolean {
  if (!existing) return false;
  return existing.status !== "paid" && existing.status !== "refunded" && !existing.refunded_at;
}

/* ─────────────────── W6a: the over-capacity alarm ─────────────────── */

/**
 * A cleared bank debit is ALWAYS honoured — the webhook fulfils it even if
 * the last seat sold while it cleared (W6a). Over-allocation is absorbed
 * by staff judgment, and staff can only absorb what they can see: this
 * decides whether a landed fulfilment must page ops.
 *
 * `claimed` is `seats_claimed()` read AFTER the write, so the fulfilment
 * that just landed is included: claimed === sellable is exactly "we just
 * sold the last seat", and greater than is a real over-allocation. An
 * unreadable count fails CLOSED (no alert) — the alert must never be the
 * thing that fails a fulfilment.
 */
export function capacityAlarm(
  claimed: number | null,
  seatsTotal: number,
  foundingCommitments: number
): boolean {
  if (claimed === null || !Number.isFinite(claimed)) return false;
  return claimed >= Math.max(0, seatsTotal - foundingCommitments);
}

/* ─────────────────── R50: Next Steps (three swipes) ─────────────────── */

/** Reachable from the offer email or the dashboard once offered — NEVER
 *  directly from submission. Same offered-or-later logic as the deposit
 *  gate's two columns. */
export function nextStepsReachable(input: {
  applicantState: string | null;
  status: string;
}): boolean {
  const s = input.applicantState;
  if (s === "offered" || s === "deposited" || s === "enrolled") return true;
  return input.status === "offered" || input.status === "member";
}

/** CONFIRMED as written 2026-07-28 (Peter, decision batch). Swipe 2's goal
 *  input persists to the children row (family_goal) — editable, never
 *  required. */
export const NEXT_STEPS = {
  swipes: [
    {
      id: "progress",
      title: "Look how far this went.",
      body: "An idea became a project, the project became an application, and the application earned a seat offer. That work stays, whatever you decide.",
    },
    {
      id: "goal",
      title: "Set the year's goal.",
      body: "One sentence, in your family's words: what should this year of building add up to? You can change it any time.",
    },
    {
      id: "seat",
      title: "Secure the seat.",
      body: `The $250 deposit reserves the seat and stays fully refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}. The full refund policy is shown at payment.`,
    },
  ],
} as const;

export const GOAL_MAX_CHARS = 280;

/**
 * U10 fidelity (audit drift 12-label): the final Next Steps CTA is the
 * handoff's "Hold {name}'s seat · $250 →": the seat is held for a NAMED
 * child, and the ask is stated on the button (R51's spirit). The routing
 * (to the dashboard reserve block, where the R51a policy text lives) is the
 * decided policy-at-payment shape and does not change with the label.
 */
export function holdSeatCta(firstName: string): string {
  const name = firstName.trim() || "your builder";
  return `Hold ${name}'s seat · $250 →`;
}
