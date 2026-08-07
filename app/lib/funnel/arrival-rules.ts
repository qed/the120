/**
 * The arrival moment — pure rules (funnel wrap U7; W13, W14, W16).
 *
 * `/start/arrival` is where a family lands seconds after paying, usually
 * BEFORE the webhook has finished. Everything decidable without I/O lives
 * here, because `app/start/**` sits outside the vitest include allowlist —
 * the page itself holds no testable logic, by design.
 *
 * Postures:
 *   - No paid deposit → the dashboard, server-side (mirrors next-steps:
 *     the cancelled/expired checkout return path and a refunded family
 *     both land there, never on a page that implies an account exists).
 *   - A missing claim row is the WEBHOOK RACING US, not an error: the
 *     family can outrun Stripe's delivery by seconds. Render provisioning
 *     and keep polling.
 *   - A poll timeout is STILL PENDING, never failure (the bounded-await
 *     lesson): honest copy plus a retry affordance, state intact.
 *   - A terminal answer needs CONSECUTIVE confirmation before the page
 *     commits to it (the 404-is-not-proof lesson): one read of `complete`
 *     could be a stale replica or a mid-write blip; two in a row is a
 *     verdict.
 */

import { DEPOSIT_REFUND_DEADLINE_LABEL } from "@/app/lib/site";
import {
  isTerminalState,
  type ForwardingState,
  type ProvisionState,
  PROVISION_STATES,
} from "@/app/lib/funnel/provision-rules";

/* ─────────────────── the view decision ─────────────────── */

export type ArrivalView =
  | { kind: "redirect_dashboard" }
  | { kind: "provisioning" }
  | { kind: "ready"; email: string; forwarding: ForwardingState }
  | { kind: "setting_up" };

export function arrivalView(input: {
  hasPaidDeposit: boolean;
  claim: { state: string; email: string | null; forwardingState: string } | null;
}): ArrivalView {
  if (!input.hasPaidDeposit) return { kind: "redirect_dashboard" };
  const claim = input.claim;
  // Webhook racing the family — the claim insert may be seconds behind.
  if (!claim) return { kind: "provisioning" };

  if (!(PROVISION_STATES as readonly string[]).includes(claim.state)) {
    // A state this bundle does not know (deploy skew): keep polling
    // rather than declaring anything — the poll bound converts a
    // never-resolving unknown into the still-pending copy.
    return { kind: "provisioning" };
  }
  const state = claim.state as ProvisionState;
  if (state === "complete" && claim.email) {
    return {
      kind: "ready",
      email: claim.email,
      forwarding: normalizeForwarding(claim.forwardingState),
    };
  }
  // exception / released / suspend_pending — and the structurally-odd
  // complete-without-email — all get the honest "we're setting up" copy:
  // no address shown, nothing that reads as a login or a promise.
  if (isTerminalState(state) || state === "suspend_pending") {
    return { kind: "setting_up" };
  }
  return { kind: "provisioning" };
}

const FORWARDING = ["none", "pending_verification", "active", "refused"] as const;
function normalizeForwarding(value: string): ForwardingState {
  return (FORWARDING as readonly string[]).includes(value)
    ? (value as ForwardingState)
    : "none";
}

/* ─────────────────── the client poll ─────────────────── */

export const ARRIVAL_POLL_INTERVAL_MS = 3000;
/** ~60s of polling before the still-pending copy takes over. */
export const ARRIVAL_POLL_MAX_ATTEMPTS = 20;
/** Terminal views commit only after this many CONSECUTIVE identical
 *  answers (the 404-not-proof lesson). */
export const TERMINAL_CONFIRMATIONS = 2;

export type PollStep =
  | { action: "continue"; terminalStreak: number }
  | { action: "stop_confirmed" }
  | { action: "stop_timeout" };

export function pollStep(input: {
  attempt: number; // 1-based, the attempt that just returned
  view: ArrivalView["kind"];
  previousView: ArrivalView["kind"] | null;
  terminalStreak: number; // consecutive terminal answers BEFORE this one
}): PollStep {
  const terminal = input.view === "ready" || input.view === "setting_up";
  if (terminal) {
    const streak = input.previousView === input.view ? input.terminalStreak + 1 : 1;
    if (streak >= TERMINAL_CONFIRMATIONS) return { action: "stop_confirmed" };
    if (input.attempt >= ARRIVAL_POLL_MAX_ATTEMPTS) {
      // The bound outranks the confirmation requirement — but a terminal
      // answer at the bound is still shown as PENDING, not committed: an
      // unconfirmed terminal is a guess, and the retry affordance re-opens
      // the poll rather than flashing a state that may be wrong.
      return { action: "stop_timeout" };
    }
    return { action: "continue", terminalStreak: streak };
  }
  if (input.attempt >= ARRIVAL_POLL_MAX_ATTEMPTS) return { action: "stop_timeout" };
  return { action: "continue", terminalStreak: 0 };
}

/* ─────────────────── the server-side resume ─────────────────── */

/**
 * A resumable claim is not re-driven more often than this, however fast
 * the poll (or a scripted curl loop) hits the route. The lease serializes
 * OVERLAPPING runs; this bounds SEQUENTIAL ones — without it, a parent
 * scripting the poll endpoint re-runs the full external pipeline (auth
 * page-walk, Google Directory calls) on every request, against quotas the
 * whole org shares (adversarial review). Ticks inside the cooldown are
 * cheap DB reads only.
 */
export const RESUME_COOLDOWN_MS = 30_000;

/**
 * The arrival page is the PRIMARY out-of-band provisioning driver (the
 * family lands seconds after paying). Resume only when the claim is
 * actionable, no live run holds it, and the last landing is older than
 * the cooldown — the lease RPC still re-checks atomically; this is the
 * cheap pre-filter that keeps page loads from hammering it.
 */
export function shouldResumeProvisioning(input: {
  state: string | null; // null = no claim row yet
  leaseExpiresAt: string | null;
  /** The claim's updated_at — every landing write refreshes it. */
  lastWriteAt: string | null;
  now: Date;
}): boolean {
  if (input.state === null) return false; // nothing to resume — heal first
  if (!(PROVISION_STATES as readonly string[]).includes(input.state)) return false;
  const state = input.state as ProvisionState;
  if (isTerminalState(state) || state === "suspend_pending") return false;
  if (state === "in_progress") {
    // Only an EXPIRED lease is takeable; a live one means a run is active.
    if (!input.leaseExpiresAt) return true; // structurally odd — let the RPC arbitrate
    return new Date(input.leaseExpiresAt).getTime() < input.now.getTime();
  }
  // pending / identity_only: honour the cooldown since the last landing.
  if (input.lastWriteAt) {
    const age = input.now.getTime() - new Date(input.lastWriteAt).getTime();
    if (age < RESUME_COOLDOWN_MS) return false;
  }
  return true;
}

/* ─────────────────── the copy ─────────────────── */

/**
 * ⚠ DRAFTED copy, Peter revises (the waitlist-screen pattern). W16 rules
 * bind every line: the student address is presented as identity, never as
 * a channel anyone monitors — no reply-promise, no sign-in promise, no
 * credentials. The forwarding lines state exactly what Google does (mails
 * the PARENT a verification link) and nothing more.
 */
export const ARRIVAL_SCREEN = {
  kicker: "Seat reserved",
  provisioning: {
    title: "Setting up your child's place…",
    body: "Your deposit is in. We're creating your child's 120 identity now — this usually takes under a minute. You can stay here or come back later; nothing depends on this window staying open.",
  },
  timeout: {
    title: "Still setting things up",
    body: "This is taking a little longer than usual. Everything is saved and nothing is wrong — check back in a few minutes.",
    retry: "Check again",
    /* The line that keeps a bounded timeout from reading as a failed payment.
     * A family who has just paid $250 and then watches a spinner give up will
     * reach for their card again if nothing on the screen says not to — and a
     * second seat deposit is a refund, a support thread, and a family who
     * trusts us less. Stated as fact, not reassurance. */
    paid: "Your deposit went through. There is nothing to pay again.",
  },
  ready: {
    title: "Your child's 120 address",
    /* U10 fidelity, escalation E5 (Peter, 2026-07-29): the acceptance-letter
     * ceremony returns around these facts — stamped logo tile, the "you're
     * in." Georgia display, the YOUR KEYS card, the forwarding card, the
     * calendar note, and the red dashboard CTA. PRESENTATION only: the
     * facts below are unchanged and W16 still holds (no password exists, so
     * the spec's password row and forced-reset note render as the honest
     * no-password line instead). */
    keysLabel: "YOUR KEYS",
    // Not the prototype's row label: W16 forbids access-implying framing
    // (this whole copy block is swept for it), so the row states the fact.
    emailRowLabel: "Email",
    forwardingCardLabel: "Mail forwarding",
    calendarNote: `Your $250 seat deposit stays fully refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}.`,
    cta: "Go to my new dashboard →",
    body: "This address is your child's identity at The 120 — it belongs to them for their whole time here. It isn't an inbox anyone needs to check yet, and no password exists for it today.",
    forwardingPending:
      "We've asked Google to forward this mailbox to your email. Google has sent YOU a verification link — click it and anything sent to your child's address will reach you.",
    forwardingActive: "Mail sent to this address is forwarded to your email.",
    forwardingNone:
      "Mail forwarding to your email will be set up shortly — you'll get a verification link from Google when it is.",
  },
  settingUp: {
    title: "We're setting things up by hand",
    body: "Your seat is secure. A person is finishing your child's setup — we'll be in touch if we need anything from you.",
  },
} as const;

/**
 * E5: the ceremony heading — "{name}, you're in." in the acceptance-letter
 * register, applied to the READY state only (waiting/timeout keep their
 * honest still-pending headings). Blank names fall back to the plain form,
 * never a dangling comma.
 */
export function arrivalCeremonyTitle(firstName: string): string {
  const name = firstName.trim();
  return name ? `${name}, you're in.` : "You're in.";
}

/* ─────────────────── the forwarding-verification bound ─────────────────── */

/** W14: a verification the parent never clicks bounds the black-hole
 *  window — mail delivered pre-verification sits unread in the dormant
 *  mailbox, which is why the bound exists. Deferred-to-implementation
 *  choice, recorded: seven days per request cycle. */
export const FORWARDING_VERIFY_ALERT_DAYS = 7;

/** The TOTAL-age backstop: every email change starts a fresh cycle and
 *  resets the 7-day clock, so a target that flip-flops faster than the
 *  bound would never page (adversarial review). The first request ever is
 *  stamped once and never cleared; three weeks of no active forwarding —
 *  across any number of cycles — pages regardless. */
export const FORWARDING_TOTAL_ALERT_DAYS = 21;

export function forwardingOverdue(input: {
  forwardingState: string;
  requestedAt: string | null;
  firstRequestedAt: string | null;
  alertedAt: string | null;
  now: Date;
}): boolean {
  if (input.forwardingState !== "pending_verification") return false;
  if (input.alertedAt !== null) return false; // one page per request cycle
  const day = 24 * 60 * 60 * 1000;
  if (input.requestedAt) {
    const cycleAge = input.now.getTime() - new Date(input.requestedAt).getTime();
    if (cycleAge >= FORWARDING_VERIFY_ALERT_DAYS * day) return true;
  }
  if (input.firstRequestedAt) {
    const totalAge = input.now.getTime() - new Date(input.firstRequestedAt).getTime();
    if (totalAge >= FORWARDING_TOTAL_ALERT_DAYS * day) return true;
  }
  return false;
}
