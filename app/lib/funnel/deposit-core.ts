import "server-only";

/**
 * Deposit integrity — the db-taking side (funnel U14). Deps-injected like
 * every funnel core; the two Stripe routes are thin shells over these.
 * Service-role writes are CORRECT here (webhook fulfilment and attempt
 * records are staff-side truth parents must never write) — the
 * no-supabaseAdmin rule binds the parent-session cores, not the payment
 * routes, which have used the service role since S3.
 */

import { createHash } from "node:crypto";
import type Stripe from "stripe";
import {
  DEPOSIT_AMOUNT_CENTS,
  REFUND_POLICY,
  capacityAlarm,
  downgradeAllowed,
  fulfilVerdict,
  webhookPlan,
  type WebhookPlan,
} from "@/app/lib/funnel/deposit-rules";

export const policyHash = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/* ─────────────────────────────── deps ─────────────────────────────── */

export type DepositRow = {
  status: string;
  refunded_at: string | null;
};

export type WebhookDeps = {
  findBySession: (sessionId: string) => Promise<DepositRow | null | "error">;
  /** Upsert on stripe_session_id with the given status. Returns "conflict"
   *  for 23505 on the one-live-paid partial index (a SECOND session's paid
   *  row for a child who already holds one). */
  writeDeposit: (row: {
    sessionId: string;
    paymentIntent: string | null;
    parentId: string;
    childId: string;
    amount: number;
    currency: string;
    status: string;
  }) => Promise<"written" | "conflict" | "error">;
  /** Status-only update by session id (failed/expired downgrades). */
  setStatus: (sessionId: string, status: string) => Promise<boolean>;
  markRefunded: (paymentIntent: string) => Promise<boolean>;
  linkAttempt: (attemptId: string, sessionId: string) => Promise<void>;
};

export type WebhookOutcome =
  | {
      kind: "ok";
      fulfilled?: { childId: string; parentId: string; sessionId: string };
      /** A replayed `completed` over an already-paid, non-refunded row
       *  (U15): no write happened and no event may re-emit, but the ids
       *  still flow so the route can HEAL a lost provisioning claim — a
       *  claim-insert failure answers non-200, Stripe redelivers, and the
       *  redelivery is exactly this arm. Never set alongside `fulfilled`. */
      replayedPaid?: { childId: string; parentId: string; sessionId: string };
    }
  | { kind: "double_paid" }
  | { kind: "failed" };

/* ─────────────────── W6a: the over-capacity page ─────────────────── */

export type CapacityAlertDeps = {
  /** seats_claimed() read AFTER the fulfilment write. null = unreadable. */
  readSeatsClaimed: () => Promise<number | null>;
  notify: (subject: string, body: string) => Promise<void>;
};

export type CapacityAlertResult = "alerted" | "below" | "not_fulfilled" | "skipped";

/**
 * A cleared bank debit is honoured even past capacity (W6a) — so the
 * over-allocation must be VISIBLE. Takes the whole outcome, not just the
 * payload, so the replay suppression is a BEHAVIOUR of this function and
 * testable without the route: a replayed `completed` is `replay_noop`,
 * which carries no `fulfilled`, so it never reads seats and never pages.
 *
 * Best-effort by construction: any failure returns "skipped" and is
 * swallowed. An alert must never take down the thing it alerts about, and
 * a seats read must never turn a good fulfilment into a 500 Stripe retries.
 *
 * KNOWN, and deliberate (the DOUBLE PAID precedent in this file's route):
 * once claimed is past capacity EVERY later fulfilment pages again. That
 * repetition is not noise to suppress — it is the fast path for the case
 * where this call is lost to a serverless timeout between the write and
 * the 200 (the retry is a replay_noop and can never re-alert). The
 * DURABLE healing is the retention cron's standing capacity
 * reconciliation (U8), independent of any single webhook invocation.
 */
export async function alertIfAtCapacity(
  deps: CapacityAlertDeps,
  outcome: WebhookOutcome,
  seatsTotal: number,
  foundingCommitments: number
): Promise<CapacityAlertResult> {
  if (outcome.kind !== "ok" || !outcome.fulfilled) return "not_fulfilled";
  try {
    const claimed = await deps.readSeatsClaimed();
    if (!capacityAlarm(claimed, seatsTotal, foundingCommitments)) return "below";
    const sellable = Math.max(0, seatsTotal - foundingCommitments);
    await deps.notify(
      "Deposit fulfilled at capacity — seats over-allocated",
      `child=${outcome.fulfilled.childId ?? "?"}\nsession=${outcome.fulfilled.sessionId}\n` +
        `seats_claimed=${claimed} of ${sellable} sellable\n` +
        `The payment stands (W6a). Review the offer queue and waitlist before offering again.`
    );
    return "alerted";
  } catch (err) {
    console.error("[deposit] capacity alert skipped:", err);
    return "skipped";
  }
}

/**
 * Apply one verified Stripe event. The dedupe story: fulfilment is
 * idempotent BY the unique stripe_session_id (the write IS the dedupe
 * record — nothing to claim before it), and there are no non-idempotent
 * effects in this webhook (provisioning and mail arrive in U15, which
 * brings claim-then-send). A failed write returns "failed" → the route
 * answers non-200 → Stripe retries into the idempotent path.
 */
export async function applyStripeEvent(
  deps: WebhookDeps,
  event: {
    type: string;
    session?: {
      id: string;
      paymentStatus: string | null;
      paymentIntent: string | null;
      childId: string | null;
      parentId: string | null;
      attemptId: string | null;
      amount: number | null;
      currency: string | null;
    };
    refundPaymentIntent?: string | null;
  }
): Promise<WebhookOutcome> {
  const plan: WebhookPlan = webhookPlan({
    type: event.type,
    paymentStatus: event.session?.paymentStatus ?? null,
  });

  if (plan.kind === "ignore") return { kind: "ok" };

  if (plan.kind === "refund") {
    if (!event.refundPaymentIntent) return { kind: "ok" };
    const ok = await deps.markRefunded(event.refundPaymentIntent);
    return ok ? { kind: "ok" } : { kind: "failed" };
  }

  const s = event.session;
  if (!s || !s.childId || !s.parentId) {
    if (plan.kind === "fulfil" && s) {
      // A PAID session with no child/parent metadata is real money with no
      // ledger row — acknowledged (retries cannot fix metadata) but LOUD.
      console.error(
        `[stripe/webhook] paid session ${s.id} has no child/parent metadata — money without a ledger row`
      );
    }
    return { kind: "ok" };
  }

  if (plan.kind === "fulfil" || plan.kind === "pending") {
    const existing = await deps.findBySession(s.id);
    if (existing === "error") return { kind: "failed" };

    const status = plan.kind === "fulfil" ? "paid" : "pending";
    if (plan.kind === "fulfil") {
      const verdict = fulfilVerdict(existing);
      // The refund is newer truth than any replayed fulfilment: a
      // redelivered `completed` must never resurrect `paid` over a
      // refunded row (the carried refunded_at bug).
      if (verdict === "refused_refunded") {
        // The refund stands — and no provisioning claim may be healed off
        // a refunded family either.
        return { kind: "ok" };
      }
      if (verdict === "replay_noop") {
        return {
          kind: "ok",
          replayedPaid: { childId: s.childId, parentId: s.parentId, sessionId: s.id },
        };
      }
    } else if (existing) {
      // A pending record never downgrades an existing row.
      return { kind: "ok" };
    }

    const wrote = await deps.writeDeposit({
      sessionId: s.id,
      paymentIntent: s.paymentIntent,
      parentId: s.parentId,
      childId: s.childId,
      amount: s.amount ?? DEPOSIT_AMOUNT_CENTS,
      currency: s.currency ?? "cad",
      status,
    });
    if (wrote === "conflict") {
      // 23505 on deposits_one_live_paid_per_child: a SECOND session paid
      // for a child already holding a live deposit (two tabs, two
      // sessions). Acknowledge — Stripe retrying cannot fix it — and
      // surface loudly for a staff refund. (The carried U6 decision:
      // "Leave to U14, document" — discharged here.)
      console.error(
        `[stripe/webhook] DOUBLE PAID DEPOSIT child=${s.childId} session=${s.id} — refund required`
      );
      return { kind: "double_paid" };
    }
    if (wrote === "error") return { kind: "failed" };

    if (s.attemptId) await deps.linkAttempt(s.attemptId, s.id);
    // The caller emits c3_deposit ONLY for a fulfil that actually wrote —
    // replays and pending records must not double-count the conversion.
    return plan.kind === "fulfil"
      ? { kind: "ok", fulfilled: { childId: s.childId, parentId: s.parentId, sessionId: s.id } }
      : { kind: "ok" };
  }

  // payment_failed / expired: terminal downgrades, only over a row that
  // never reached paid/refunded.
  const existing = await deps.findBySession(s.id);
  if (existing === "error") return { kind: "failed" };
  if (!downgradeAllowed(existing)) return { kind: "ok" };
  const ok = await deps.setStatus(s.id, plan.kind === "expired" ? "expired" : "failed");
  return ok ? { kind: "ok" } : { kind: "failed" };
}

/* ─────────────────────────────── checkout attempt (R51a, R52b) ─────────────────────────────── */

export type AttemptDeps = {
  insertAttempt: (row: {
    parentId: string;
    childId: string;
    policyVersion: string;
    policyHash: string;
    acceptedIp: string;
  }) => Promise<string | null>;
};

/** The persisted attempt: the idempotency key's anchor AND the R51a
 *  PRESENTATION record, in one insert that happens BEFORE the Stripe call.
 *
 *  Semantics since 2026-07-30 (the consent-collection P0): the row records
 *  what checkout WILL render — version, hash of the exact text, timestamp
 *  (row default), IP — not that anyone accepted it. The affirmative
 *  acceptance evidence is Stripe's own consent record on the Checkout
 *  session (`session.consent.terms_of_service === "accepted"`), reachable
 *  through this row's `stripe_session_id`. The version echo in the route
 *  still binds the record to what the client's bundle will present. */
export async function recordCheckoutAttempt(
  deps: AttemptDeps,
  input: { parentId: string; childId: string; acceptedIp: string }
): Promise<{ attemptId: string; idempotencyKey: string } | null> {
  const attemptId = await deps.insertAttempt({
    parentId: input.parentId,
    childId: input.childId,
    policyVersion: REFUND_POLICY.version,
    policyHash: policyHash(REFUND_POLICY.text),
    acceptedIp: input.acceptedIp,
  });
  if (!attemptId) return null;
  return { attemptId, idempotencyKey: `deposit-attempt:${attemptId}` };
}

/* ─────────────── consent at checkout (P0 2026-07-30) ─────────────── */

/**
 * Commit 6fa1f8f removed the dashboard's inline policy+checkbox but left
 * the client POSTing a hardcoded `policyAccepted: true` — a fabricated
 * acceptance with NO surface rendering the policy. Peter's ruling: the
 * policy renders and is accepted ON the Stripe-hosted checkout page.
 *
 * Two modes, built here so tests can pin the exact session params without
 * a Stripe call:
 *
 * - "consent_tick" (the intended shape): `consent_collection.
 *   terms_of_service: "required"` puts a REQUIRED tick on the hosted page
 *   that gates payment, and `custom_text.terms_of_service_acceptance.
 *   message` replaces Stripe's default agreement line with OUR full policy
 *   text VERBATIM (671 chars, under Stripe's 1200-char limit — pinned by
 *   test; the acceptance must bind to the rendered text, so a text that
 *   outgrows the limit must fail the pin, never be silently condensed).
 *
 * - "text_only" (the degraded shape): `terms_of_service: "required"`
 *   fails session creation when the Stripe account has no Terms-of-Service
 *   URL configured (Dashboard → Settings → Business → Public details) — a
 *   setting we cannot verify from code. Checkout must never brick on it:
 *   the policy still renders in full via `custom_text.submit.message`
 *   (rendering survives; only the dedicated tick degrades — paying is
 *   still the affirmative act, with the policy on screen above the button).
 *
 * The two modes use DIFFERENT idempotency keys (`:notos` suffix): Stripe
 * stores the first result — including the error — under a key and refuses
 * the same key with different params, so the degraded retry must not reuse
 * the consent-mode key. Both keys stay child-scoped, so the double-click /
 * second-device dedupe (the R52b lesson) holds within each mode.
 */
export type CheckoutSessionInput = {
  childId: string;
  parentId: string;
  customerEmail: string | null | undefined;
  childFirstName: string;
  priceId: string;
  /** Already validated by resolveOrigin — never the raw Origin header. */
  origin: string;
};

export type CheckoutConsentMode = "consent_tick" | "text_only";

export function buildCheckoutSessionParams(
  input: CheckoutSessionInput,
  mode: CheckoutConsentMode
): { params: Stripe.Checkout.SessionCreateParams; idempotencyKey: string } {
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: 1 }],
    customer_email: input.customerEmail ?? undefined,
    metadata: { child_id: input.childId, parent_id: input.parentId },
    payment_intent_data: {
      description: `The 120 — refundable seat deposit (${input.childFirstName || "child"})`,
      metadata: { child_id: input.childId, parent_id: input.parentId },
    },
    // U7 (W13): success lands on the ARRIVAL page — without this the
    // acceptance moment is unreachable. Cancel keeps the dashboard.
    success_url: `${input.origin}/start/arrival?child=${encodeURIComponent(input.childId)}`,
    cancel_url: `${input.origin}/dashboard?deposit=cancelled`,
    // expires_at shortens the double-payment window from Stripe's 24h
    // default to the minimum 30 minutes (R52b adversarial review).
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    ...(mode === "consent_tick"
      ? {
          consent_collection: { terms_of_service: "required" as const },
          custom_text: { terms_of_service_acceptance: { message: REFUND_POLICY.text } },
        }
      : {
          custom_text: { submit: { message: REFUND_POLICY.text } },
        }),
  };
  return {
    params,
    // CHILD-scoped with STABLE params (no attempt id in metadata — the
    // attempt links to the session afterwards): a double-click replays the
    // SAME open session instead of minting a second payable one.
    idempotencyKey:
      mode === "consent_tick" ? `deposit:${input.childId}` : `deposit:${input.childId}:notos`,
  };
}

/**
 * The specific failure that means "the Stripe account has no ToS URL
 * configured" — pure shape-check so it is testable without the SDK's
 * error classes. Stripe raises an invalid_request_error naming
 * `consent_collection[terms_of_service]` / the missing terms-of-service
 * URL. Anything else (auth, network, bad price id) must RETHROW — the
 * degrade is only for the one setting we cannot verify from here.
 */
export function isMissingTosUrlError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { type?: unknown; message?: unknown; param?: unknown };
  if (e.type !== "StripeInvalidRequestError") return false;
  const msg = typeof e.message === "string" ? e.message : "";
  const param = typeof e.param === "string" ? e.param : "";
  return (
    param.includes("consent_collection") ||
    msg.includes("consent_collection") ||
    (/terms of service/i.test(msg) && /url|dashboard|settings/i.test(msg))
  );
}

/** Once-per-process latch: after the first missing-ToS-URL failure, later
 *  checkouts in this process go straight to text_only instead of paying a
 *  doomed round-trip per request. Resets on deploy/cold start — which is
 *  exactly when Peter may have fixed the dashboard setting. */
let tosTickDegradedThisProcess = false;

/** Test-only reset for the process-level latch. */
export function resetTosTickDegradeForTests(): void {
  tosTickDegradedThisProcess = false;
}

export type CreateSessionDeps = {
  createSession: (
    params: Stripe.Checkout.SessionCreateParams,
    opts: { idempotencyKey: string }
  ) => Promise<{ id: string; url: string | null }>;
};

/**
 * Create the Checkout session with the required consent tick, degrading
 * ONCE per process to rendered-text-only if the Stripe account's ToS URL
 * is missing. `consentTick: false` tells the caller the session carries no
 * Stripe consent record (the webhook logs the same from `session.consent`).
 *
 * FOLLOW-UP for Peter (pending Stripe-login item): set the Terms-of-Service
 * URL in the Stripe Dashboard (Settings → Business → Public details) so
 * the required tick stops degrading. The loud log below is the signal.
 */
export async function createCheckoutSessionWithConsent(
  deps: CreateSessionDeps,
  input: CheckoutSessionInput
): Promise<{ session: { id: string; url: string | null }; consentTick: boolean }> {
  if (!tosTickDegradedThisProcess) {
    const { params, idempotencyKey } = buildCheckoutSessionParams(input, "consent_tick");
    try {
      const session = await deps.createSession(params, { idempotencyKey });
      return { session, consentTick: true };
    } catch (err) {
      if (!isMissingTosUrlError(err)) throw err;
      tosTickDegradedThisProcess = true;
      console.error(
        "STRIPE TOS URL NOT CONFIGURED — consent tick degraded to rendered-text-only. " +
          "The policy still renders on the hosted page (custom_text.submit) but Stripe " +
          "records no terms_of_service consent. Peter: set the Terms-of-Service URL in " +
          "the Stripe Dashboard (Settings → Business → Public details)."
      );
    }
  }
  const { params, idempotencyKey } = buildCheckoutSessionParams(input, "text_only");
  const session = await deps.createSession(params, { idempotencyKey });
  return { session, consentTick: false };
}
