/**
 * Offer-email decision logic (plan 2026-07-15-001 Unit 2). Pure functions,
 * no I/O — tested in `__tests__/offer-rules.test.ts` (families-rules canon).
 *
 * The button gate delegates to the exported `canReserveSeat` — the SAME
 * predicate the parent dashboard CTA and the checkout route consume — so the
 * email can never promise a call to action that isn't live. Never restate
 * that rule (lockstep-mirror lesson, docs/solutions logic-errors).
 */

import { canReserveSeat, hasPaidDeposit, statusIndex, type SeatStatus } from "@/app/dashboard/data";
import { escapeHtml } from "@/app/crm/lib/library-rules";
import { DEPOSIT_REFUND_DEADLINE_LABEL, SITE_URL } from "@/app/lib/site";

/* ---------------------------------------------------------------- template */

/** Subject-header defense: CR/LF-strip + truncate. Distinct from HTML
 *  escaping — applying only one reproduces the documented incident class
 *  (docs/solutions/security-issues, 2026-07-14). */
const headerSafe = (raw: string): string =>
  raw.replace(/[\r\n]+/g, " ").trim().slice(0, 80);

const P_STYLE = "font-size:14px;line-height:1.65;color:#131416;margin:0 0 14px";

export interface OfferEmailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * The ONE rendering of the offer email — the confirm dialog previews this
 * exact output and the send action re-renders it from server truth, so the
 * preview and the inbox can never diverge (and there is a single injection
 * surface to defend). Child's first name appears in subject AND body (F1).
 */
export function offerEmailTemplate(opts: {
  childFirstName: string;
  parentName: string;
}): OfferEmailContent {
  const child = opts.childFirstName.trim() || "your child";
  const parent = opts.parentName.trim() || "there";
  const link = `${SITE_URL}/dashboard`;

  const subject = `${headerSafe(child)} has been offered a seat at The 120`;

  const text =
    `Hi ${parent},\n\n` +
    `Great news: ${child} has been offered a seat in The 120's founding cohort.\n\n` +
    `The next step is yours. Sign in to your dashboard and reserve ${child}'s seat ` +
    `with the $250 deposit — fully refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}.\n\n` +
    `Reserve the seat: ${link}\n\n` +
    `Questions? Just reply to this email.\n\n` +
    `— The 120 Admissions`;

  const c = escapeHtml(child);
  const p = escapeHtml(parent);
  const html =
    `<p style="${P_STYLE}">Hi ${p},</p>` +
    `<p style="${P_STYLE}">Great news: <strong>${c}</strong> has been offered a seat in The 120&#39;s founding cohort.</p>` +
    `<p style="${P_STYLE}">The next step is yours. Sign in to your dashboard and reserve ${c}&#39;s seat ` +
    `with the $250 deposit — fully refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}.</p>` +
    `<p style="${P_STYLE}"><a href="${link}" style="color:#0300ED">Reserve the seat at ${SITE_URL.replace("https://", "")}/dashboard</a></p>` +
    `<p style="${P_STYLE}">Questions? Just reply to this email.</p>` +
    `<p style="${P_STYLE}">— The 120 Admissions</p>`;

  return { subject, text, html };
}

/* ------------------------------------------------------------ button state */

/**
 * R6 disabled-state precedence: gate state first (not offered / paid), then
 * "no parent contact info" only when otherwise send-eligible. The enum
 * drives INTERACTIVITY only — whether the sent-date badge renders is driven
 * by `offerSentAt` being non-null, independent of this state (R9: the badge
 * survives every gate-closed state).
 */
export type OfferButtonState =
  | "sendable"
  | "resendable"
  | "not_offered"
  | "deposit_paid"
  | "no_contact";

export function offerButtonState(opts: {
  reviewStatus: string;
  deposits: { status: string }[];
  effectiveParentEmail: string;
  offerSentAt: string | null;
}): OfferButtonState {
  if (!canReserveSeat(opts.reviewStatus, opts.deposits)) {
    return hasPaidDeposit(opts.deposits) ? "deposit_paid" : "not_offered";
  }
  if (!opts.effectiveParentEmail.trim()) return "no_contact";
  return opts.offerSentAt ? "resendable" : "sendable";
}

/* ----------------------------------------------------------- demote warning */

/**
 * F2: warn before moving a child PRE-Offered while an offer email is out and
 * no deposit is paid — the parent holds an email pointing at a "Reserve
 * seat" button the move would kill. `targetStatus` is typed (menu targets
 * are always a known stage), so the compiler owns validity — unlike
 * `offerButtonState`, which deliberately accepts raw DB strings.
 */
export function demoteWarning(opts: {
  targetStatus: SeatStatus;
  offerSentAt: string | null;
  deposits: { status: string }[];
}): boolean {
  if (!opts.offerSentAt) return false;
  if (hasPaidDeposit(opts.deposits)) return false;
  return statusIndex(opts.targetStatus) < statusIndex("offered");
}

/* --------------------------------------------------------- effective email */

/**
 * The send-address authority rule in ONE place for the offer path (Decision
 * 4 shape: the linked parent account's email wins; the family snapshot only
 * serves the edge where the parents row carries no usable address). `||`
 * (not `??`) is deliberate: an empty-string parent email must fall through.
 * Consumed by both `fetchDossierQueue` (the button/dialog) and
 * `sendOfferEmail` (the server verdict) so the two can never disagree.
 */
export function effectiveEmail(
  parentEmail: string | null | undefined,
  familyEmail: string | null | undefined
): string {
  return (parentEmail || familyEmail || "").trim();
}

/* ----------------------------------------------- claim/unclaim interpretation */

export type OfferSendStatus =
  | "sent"
  | "already_sent"
  | "gate_closed"
  | "not_found"
  | "send_failed";

export interface OfferSendResult {
  status: OfferSendStatus;
  /** Fresh stamp on `sent` and `already_sent` — the client's next CAS token. */
  sentAt?: string;
  error?: string;
  warning?: string;
}

/**
 * Zero rows claimed — interpret the follow-up probe of `child_reviews`
 * (NOT the children row: a child with no review row was never sent
 * anything, and reporting `already_sent` there would be a lie).
 */
export function interpretClaimMiss(probe: {
  exists: boolean;
  stamp: string | null;
}): { status: "already_sent"; freshStamp: string } | { status: "not_found" | "gate_closed" } {
  if (!probe.exists) return { status: "not_found" };
  if (probe.stamp) return { status: "already_sent", freshStamp: probe.stamp };
  // Row exists but the stamp is null: our claim raced a concurrent unclaim
  // or the row appeared mid-flight — refresh-to-truth, never a fake success.
  return { status: "gate_closed" };
}

/**
 * CAS-guarded restore after a failed send. Zero rows restored means a
 * concurrent claim superseded ours — its stamp is truth; restoring would
 * clobber a real send (the notify-submission template's unconditional
 * unclaim is NOT safe here because this flow has resends). Only an errored
 * restore on a genuinely-held claim warrants the staff-visible warning.
 */
export function unclaimOutcome(opts: {
  errored: boolean;
  restoredRows: number;
}): "restored" | "superseded" | "warn" {
  if (opts.errored) return "warn";
  return opts.restoredRows > 0 ? "restored" : "superseded";
}
