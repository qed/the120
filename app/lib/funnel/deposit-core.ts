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
import {
  DEPOSIT_AMOUNT_CENTS,
  REFUND_POLICY,
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
  | { kind: "ok"; fulfilled?: { childId: string; parentId: string; sessionId: string } }
  | { kind: "double_paid" }
  | { kind: "failed" };

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
      if (verdict === "refused_refunded" || verdict === "replay_noop") {
        return { kind: "ok" };
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
 *  acceptance record, in one insert that happens BEFORE the Stripe call. */
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
