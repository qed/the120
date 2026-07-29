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
 * The arrival page is the PRIMARY out-of-band provisioning driver (the
 * family lands seconds after paying). Resume only when the claim is
 * actionable and no live run holds it — the lease RPC re-checks
 * atomically; this is the cheap pre-filter that keeps page loads from
 * hammering the RPC for terminal claims.
 */
export function shouldResumeProvisioning(input: {
  state: string | null; // null = no claim row yet
  leaseExpiresAt: string | null;
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
  return true; // pending / identity_only
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
  },
  ready: {
    title: "Your child's 120 address",
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

/* ─────────────────── the forwarding-verification bound ─────────────────── */

/** W14: a verification the parent never clicks bounds the black-hole
 *  window — mail delivered pre-verification sits unread in the dormant
 *  mailbox, which is why the bound exists. Deferred-to-implementation
 *  choice, recorded: seven days. */
export const FORWARDING_VERIFY_ALERT_DAYS = 7;

export function forwardingOverdue(input: {
  forwardingState: string;
  requestedAt: string | null;
  alertedAt: string | null;
  now: Date;
}): boolean {
  if (input.forwardingState !== "pending_verification") return false;
  if (!input.requestedAt) return false;
  if (input.alertedAt !== null) return false; // one page per request cycle
  const ageMs = input.now.getTime() - new Date(input.requestedAt).getTime();
  return ageMs >= FORWARDING_VERIFY_ALERT_DAYS * 24 * 60 * 60 * 1000;
}
