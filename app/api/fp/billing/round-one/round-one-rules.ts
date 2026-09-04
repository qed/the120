/**
 * First Profit Round One billing decisions.
 *
 * Pure by construction: this module knows the product contract, parses the
 * parent request, builds Stripe Checkout parameters, classifies signed webhook
 * payloads after the route normalizes them, and shapes the status response. It
 * never reads a cookie, database, clock, or environment variable.
 *
 * Round One is the SELL phase. Task 1.1.1 stays free; an active entitlement
 * opens 1.1.2 through 1.5.5. This is intentionally unrelated to The 120's $250
 * refundable seat deposit even though the amount happens to match.
 */

import type Stripe from "stripe";
import { z } from "zod";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/lib/fp/rate-limit-rules";
import { classifyIdentifier } from "@/app/api/fp/login/login-rules";

export const ROUND_ONE_PRODUCT_KEY = "round_one_sell";
export const ROUND_ONE_PRODUCT_VERSION = 1;
export const ROUND_ONE_BILLING_KIND = "fp_round_one_sell";
export const ROUND_ONE_ACCESS_CODE = "phase:sell";
export const ROUND_ONE_FIRST_LOCKED_TASK_ID = "1.1.2";
export const ROUND_ONE_LAST_INCLUDED_TASK_ID = "1.5.5";
export const ROUND_ONE_AMOUNT_CENTS = 25_000;
export const ROUND_ONE_CURRENCY = "cad";
export const ROUND_ONE_STRIPE_API_VERSION = "2026-07-29.dahlia" as const;
/** One canonical return host keeps Stripe idempotency parameters stable even
 * when the parent starts on `www` or an allowed preview origin. */
export const ROUND_ONE_RETURN_ORIGIN = "https://firstprofit.school";

/**
 * Stripe recommends a human-readable integration label with an eight-letter
 * suffix. Derive the suffix from the durable order UUID, rather than random
 * state, so a Checkout retry with the same idempotency key also carries a
 * byte-for-byte identical request body.
 */
export function roundOneIntegrationIdentifier(orderId: string): string {
  let state = 0x811c9dc5;
  for (let index = 0; index < orderId.length; index += 1) {
    state = Math.imul(state ^ orderId.charCodeAt(index), 0x01000193) >>> 0;
  }
  let suffix = "";
  for (let index = 0; index < 8; index += 1) {
    state = Math.imul(state ^ (index + 1), 0x85ebca6b) >>> 0;
    suffix += String.fromCharCode(97 + (state % 26));
  }
  return `first_profit_round_one_${suffix}`;
}

export const ROUND_ONE_CHECKOUT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60_000,
  limit: 10,
};
export const ROUND_ONE_STATUS_RATE_LIMIT: RateLimitConfig = {
  windowMs: 5 * 60_000,
  limit: 120,
};
export const ROUND_ONE_ADMIN_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60_000,
  limit: 30,
};
export const ROUND_ONE_BILLING_IP_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60_000,
  limit: 100,
};
// Status is a read-only, fail-closed entitlement check and is intentionally
// polled again when the learner returns from the separate parent/payment tab.
// A workshop cohort can therefore make two requests per child at once behind
// one venue NAT. Keep mutation endpoints on the tighter billing IP limit, but
// leave enough shared-IP headroom that a 50-family kickoff does not lock every
// learner out on the first focus/recheck cycle.
export const ROUND_ONE_STATUS_IP_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60_000,
  limit: 600,
};

const checkoutRequestSchema = z
  .object({ childId: z.string().uuid() })
  .strict();

export type RoundOneCheckoutRequest = { childId: string };

export function parseRoundOneCheckoutRequest(body: unknown):
  | { ok: true; value: RoundOneCheckoutRequest }
  | { ok: false } {
  const parsed = checkoutRequestSchema.safeParse(body);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false };
}

export function parseRoundOneStatusChildId(value: string | null): string | null {
  return z.string().uuid().safeParse(value).success ? value : null;
}

export function roundOneProductVersionFromEnv(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return ROUND_ONE_PRODUCT_VERSION;
  if (!/^\d+$/.test(value.trim())) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

export function roundOneFeatureEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function deriveRoundOneRateLimitKeys(
  endpoint: "checkout" | "status" | "child-status" | "admin-access",
  ip: string,
  unverifiedSub: string
): { userKey: string; ipKey: string } {
  const ipPart = encodeRateLimitSegment(ip);
  const userPart = encodeRateLimitSegment(unverifiedSub);
  return {
    userKey: `fp-round-one-${endpoint}:${ipPart}:${userPart}`,
    ipKey: `fp-round-one-${endpoint}-ip:${ipPart}`,
  };
}

const adminAccessRequestSchema = z
  .object({
    fpUsername: z.string().min(1).max(80),
    action: z.enum(["comped", "grandfathered", "revoke"]),
    note: z.string().trim().min(3).max(1_000),
    requestId: z.string().uuid(),
  })
  .strict();

export type RoundOneAdminAccessRequest = {
  fpUsername: string;
  action: "comped" | "grandfathered" | "revoke";
  note: string;
  requestId: string;
};

export function parseRoundOneAdminAccessRequest(body: unknown):
  | { ok: true; value: RoundOneAdminAccessRequest }
  | { ok: false } {
  const parsed = adminAccessRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  const username = classifyIdentifier(parsed.data.fpUsername);
  if (username.kind !== "username") return { ok: false };
  return {
    ok: true,
    value: { ...parsed.data, fpUsername: username.normalized },
  };
}

export type RoundOneProductRow = {
  product_key: string;
  version: number;
  display_name: string;
  subject_type: "child";
  access_code: string;
  phase_key: string;
  first_locked_task_id: string;
  last_included_task_id: string;
  amount: number;
  currency: string;
  active: boolean;
};

/**
 * Fail closed when catalog truth drifts from the server contract. A mismatched
 * Stripe price can still collect money; granting access on a catalog mismatch
 * would make that deployment mistake invisible.
 */
export function isExpectedRoundOneProduct(
  row: RoundOneProductRow | null,
  version: number
): row is RoundOneProductRow {
  return !!row
    && row.product_key === ROUND_ONE_PRODUCT_KEY
    && row.version === version
    && row.subject_type === "child"
    && row.access_code === ROUND_ONE_ACCESS_CODE
    && row.phase_key === "sell"
    && row.first_locked_task_id === ROUND_ONE_FIRST_LOCKED_TASK_ID
    && row.last_included_task_id === ROUND_ONE_LAST_INCLUDED_TASK_ID
    && row.amount === ROUND_ONE_AMOUNT_CENTS
    && row.currency === ROUND_ONE_CURRENCY
    && row.active === true;
}

export type RoundOneStripePrice = {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  type: "one_time" | "recurring";
};

/**
 * Validate the processor-side price before a parent can be sent to Checkout.
 * The webhook's amount check is the final fulfilment guard, but it runs only
 * after money may already have been collected. A mistyped Price id must fail
 * before payment, not turn into a paid parent with no access.
 */
export function isExpectedRoundOneStripePrice(
  price: RoundOneStripePrice | null,
  expectedPriceId: string
): price is RoundOneStripePrice {
  return !!price
    && price.id === expectedPriceId
    && price.active === true
    && price.currency.toLowerCase() === ROUND_ONE_CURRENCY
    && price.unit_amount === ROUND_ONE_AMOUNT_CENTS
    && price.type === "one_time";
}

export type BuildRoundOneCheckoutInput = {
  orderId: string;
  parentId: string;
  childId: string;
  productVersion: number;
  priceId: string;
  customerEmail: string | null | undefined;
};

export function buildRoundOneCheckoutSession(
  input: BuildRoundOneCheckoutInput
): {
  params: Stripe.Checkout.SessionCreateParams;
  idempotencyKey: string;
} {
  const metadata: Record<string, string> = {
    billing_kind: ROUND_ONE_BILLING_KIND,
    order_id: input.orderId,
    parent_id: input.parentId,
    child_id: input.childId,
    product_key: ROUND_ONE_PRODUCT_KEY,
    product_version: String(input.productVersion),
  };
  const child = encodeURIComponent(input.childId);
  return {
    params: {
      mode: "payment",
      integration_identifier: roundOneIntegrationIdentifier(input.orderId),
      line_items: [{ price: input.priceId, quantity: 1 }],
      // Beta/test families use Stripe-managed Promotion Codes rather than a
      // second, staff-created access path. The webhook verifies the original
      // CAD $250 subtotal, while Stripe remains authoritative for the discount
      // and final amount collected.
      allow_promotion_codes: true,
      // The staff follow-up workflow needs a reliable parent phone number.
      // Stripe collects it in the parent-owned payment step; the signed
      // completion webhook fills an otherwise-blank parent record only after
      // the catalog/payment checks below have succeeded.
      phone_number_collection: { enabled: true },
      customer_email: input.customerEmail ?? undefined,
      client_reference_id: input.orderId,
      metadata,
      payment_intent_data: {
        description: "First Profit Round 1 — Sell",
        metadata,
      },
      success_url:
        `${ROUND_ONE_RETURN_ORIGIN}/parent?roundOne=success&child=${child}`
        + "&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: `${ROUND_ONE_RETURN_ORIGIN}/parent?roundOne=cancelled&child=${child}`,
      custom_text: {
        submit: {
          message:
            "First Profit Round 1 is a one-child, non-refundable CAD $250 total today. Your phone number is used for First Profit program-support calls about this child.",
        },
      },
      // Deliberately omit `expires_at` and accept Stripe's assigned expiry.
      // The persisted order is the idempotency anchor: if Stripe creates the
      // Session but our response is lost before the DB attachment commits, a
      // retry must send byte-for-byte identical parameters under the same key.
      // A request-time expiry would drift and Stripe would reject the retry.
    },
    // The persisted order id anchors retries. A network failure after Stripe
    // creates the session returns that same session on the next request.
    idempotencyKey: `fp-round-one-order:${input.orderId}:v${input.productVersion}`,
  };
}

export function reusableCheckoutSession(input: {
  status: string | null;
  url: string | null;
  expiresAt: number | null;
  nowEpochSeconds: number;
}): { reuse: true; url: string } | { reuse: false } {
  return input.status === "open"
    && typeof input.url === "string"
    && input.url.startsWith("https://checkout.stripe.com/")
    && typeof input.expiresAt === "number"
    && input.expiresAt > input.nowEpochSeconds
    ? { reuse: true, url: input.url }
    : { reuse: false };
}

export type RoundOneAccessState =
  | "not_started"
  | "pending"
  | "paid"
  | "suspended"
  | "cancelled"
  | "failed"
  | "refunded"
  | "comped"
  | "grandfathered";

export type RoundOneOrderStatus = Exclude<
  RoundOneAccessState,
  "not_started" | "suspended"
>;

export type RoundOneEntitlementRow = {
  status: "active" | "suspended" | "revoked";
  grant_kind: "paid" | "comped" | "grandfathered";
  access_code: string;
  granted_at: string;
  suspended_at: string | null;
  suspension_reason: "stripe_dispute" | null;
  revoked_at: string | null;
};

export type RoundOneOrderSummaryRow = {
  status: RoundOneOrderStatus;
  created_at: string;
  updated_at: string;
};

export type RoundOneStatusBody = {
  ok: true;
  subject: { type: "child"; id: string };
  product: {
    key: string;
    version: number;
    name: string;
    phase: "sell";
    amount: number;
    currency: string;
    freeThroughTaskId: "1.1.1";
    unlocksFromTaskId: string;
    unlocksThroughTaskId: string;
  };
  state: RoundOneAccessState;
  access: {
    granted: boolean;
    code: string | null;
    reason: "paid" | "comped" | "grandfathered" | null;
  };
  canStartCheckout: boolean;
};

export function shapeRoundOneStatus(input: {
  childId: string;
  product: RoundOneProductRow;
  entitlement: RoundOneEntitlementRow | null;
  latestOrder: RoundOneOrderSummaryRow | null;
  disputeHeld?: boolean;
}): RoundOneStatusBody {
  // The order marker is product-wide and sticky. It must override even an
  // absent/revoked entitlement (for example, refund before a delayed dispute)
  // and an accidentally active grant until an audited restoration exists.
  const suspended = input.disputeHeld === true || (
    input.entitlement?.status === "suspended"
    && input.entitlement.access_code === input.product.access_code
    && input.entitlement.suspension_reason === "stripe_dispute"
  );
  const active = !suspended
    && input.entitlement?.status === "active"
    && input.entitlement.access_code === input.product.access_code;
  const latestState = input.latestOrder?.status ?? "not_started";
  // A revoked complimentary order remains comped/grandfathered in the audit
  // ledger, but it must not present as an active complimentary state to the
  // parent or child. `access.granted` is authoritative either way.
  const state: RoundOneAccessState = suspended
    ? "suspended"
    : active
      ? input.entitlement!.grant_kind
      : input.entitlement?.status === "revoked"
        && (latestState === "comped" || latestState === "grandfathered")
        ? "cancelled"
        : latestState;
  return {
    ok: true,
    subject: { type: "child", id: input.childId },
    product: {
      key: input.product.product_key,
      version: input.product.version,
      name: input.product.display_name,
      phase: "sell",
      amount: input.product.amount,
      currency: input.product.currency,
      freeThroughTaskId: "1.1.1",
      unlocksFromTaskId: input.product.first_locked_task_id,
      unlocksThroughTaskId: input.product.last_included_task_id,
    },
    state,
    access: {
      granted: active,
      code: active ? input.entitlement!.access_code : null,
      reason: active ? input.entitlement!.grant_kind : null,
    },
    // A pending order can be either an open Checkout the parent cancelled away
    // from or a completed Checkout whose webhook is still in flight. The
    // checkout core safely distinguishes those cases: it reuses the same open
    // session or returns awaiting_webhook, never creates a second charge path.
    // A dispute suspension is also not a fresh chance to pay: staff must review
    // the existing payment instead of sending the family through Checkout again.
    canStartCheckout: !active && !suspended,
  };
}

export const ROUND_ONE_REFUSAL_BODY = JSON.stringify({
  ok: false,
  error: "We could not verify this Round 1 request.",
});

export const ROUND_ONE_UNAVAILABLE_BODY = JSON.stringify({
  ok: false,
  error: "Round 1 checkout is unavailable right now. Please try again.",
});

export type RoundOneWebhookMetadata = {
  billingKind: string | null;
  orderId: string | null;
  parentId: string | null;
  childId: string | null;
  productKey: string | null;
  productVersion: string | null;
};

export type RoundOneWebhookInput = {
  eventId: string;
  eventType: string;
  paymentStatus?: string | null;
  fullRefund?: boolean;
  processorObjectId?: string | null;
  processorStatus?: string | null;
  processorReason?: string | null;
  processorAmount?: number | null;
  processorTotalAmount?: number | null;
  metadata: RoundOneWebhookMetadata;
  sessionId: string | null;
  paymentIntentId: string | null;
  catalogPriceMatches?: boolean;
  amountSubtotal: number | null;
  amountTotal: number | null;
  amountDiscount: number | null;
  amountTax: number | null;
  currency: string | null;
};

export type RoundOneWebhookPlan =
  | { kind: "ignore"; reason: "foreign" | "unsupported" }
  | { kind: "invalid" }
  | {
      kind: "apply";
      effect:
        | "pending"
        | "paid"
        | "cancelled"
        | "failed"
        | "refunded"
        | "partial_refund"
        | "dispute_opened"
        | "dispute_closed";
      eventId: string;
      eventType: string;
      orderId: string;
      parentId: string;
      childId: string;
      productKey: string;
      productVersion: number;
      sessionId: string | null;
      paymentIntentId: string | null;
      amount: number | null;
      currency: string | null;
      processorObjectId: string | null;
      processorStatus: string | null;
      processorReason: string | null;
      processorAmount: number | null;
    };

const uuid = z.string().uuid();

/**
 * This runs only AFTER the route verifies Stripe's signature. Metadata is
 * treated as a pointer back to a pre-existing authenticated order; the SQL RPC
 * must still compare every field with that order before changing access.
 */
export function planRoundOneWebhook(input: RoundOneWebhookInput): RoundOneWebhookPlan {
  if (input.metadata.billingKind !== ROUND_ONE_BILLING_KIND) {
    return { kind: "ignore", reason: "foreign" };
  }
  const version = Number(input.metadata.productVersion);
  if (
    !input.eventId
    || !uuid.safeParse(input.metadata.orderId).success
    || !uuid.safeParse(input.metadata.parentId).success
    || !uuid.safeParse(input.metadata.childId).success
    || input.metadata.productKey !== ROUND_ONE_PRODUCT_KEY
    || !Number.isSafeInteger(version)
    || version < 1
  ) {
    return { kind: "invalid" };
  }

  let effect: Extract<RoundOneWebhookPlan, { kind: "apply" }>["effect"];
  switch (input.eventType) {
    case "checkout.session.completed":
      // Stripe reports a legitimate 100%-discount Checkout as
      // `no_payment_required`. The catalog/line-item/discount proof below must
      // still pass before it can take the same entitlement transition as paid.
      effect = input.paymentStatus === "paid"
        || input.paymentStatus === "no_payment_required"
        ? "paid"
        : "pending";
      break;
    case "checkout.session.async_payment_succeeded":
      effect = "paid";
      break;
    case "checkout.session.async_payment_failed":
      effect = "failed";
      break;
    case "checkout.session.expired":
      effect = "cancelled";
      break;
    case "charge.refunded":
      effect = input.fullRefund ? "refunded" : "partial_refund";
      break;
    case "charge.dispute.created":
      effect = "dispute_opened";
      break;
    case "charge.dispute.closed":
      effect = "dispute_closed";
      break;
    default:
      return { kind: "ignore", reason: "unsupported" };
  }

  if (effect === "pending" || effect === "paid") {
    const amounts = [
      input.amountSubtotal,
      input.amountTotal,
      input.amountDiscount,
      input.amountTax,
    ];
    if (
      input.catalogPriceMatches !== true
      || amounts.some(
        (amount) =>
          typeof amount !== "number"
          || !Number.isSafeInteger(amount)
          || amount < 0,
      )
      || input.amountTax !== 0
      || input.amountTotal! + input.amountDiscount! !== input.amountSubtotal!
      || input.amountTotal! > input.amountSubtotal!
    ) {
      return { kind: "invalid" };
    }
  }

  const isProcessorReview = effect === "partial_refund"
    || effect === "dispute_opened"
    || effect === "dispute_closed";
  if (effect === "refunded" || isProcessorReview) {
    const processorId = input.processorObjectId?.trim() ?? "";
    if (
      !input.paymentIntentId
      || processorId.length === 0
      || processorId.length > 255
      || !input.currency
      || !/^[a-z]{3}$/i.test(input.currency)
    ) {
      return { kind: "invalid" };
    }
  }

  if (effect === "partial_refund") {
    if (
      !Number.isSafeInteger(input.processorAmount)
      || !Number.isSafeInteger(input.processorTotalAmount)
      || input.processorAmount! <= 0
      || input.processorTotalAmount! <= 0
      || input.processorAmount! >= input.processorTotalAmount!
    ) {
      return { kind: "invalid" };
    }
  }

  if (effect === "dispute_opened" || effect === "dispute_closed") {
    const status = input.processorStatus?.trim() ?? "";
    const reason = input.processorReason?.trim() ?? "";
    if (
      status.length === 0
      || status.length > 80
      || reason.length === 0
      || reason.length > 80
      || !Number.isSafeInteger(input.processorAmount)
      || input.processorAmount! <= 0
      || (
        effect === "dispute_closed"
        && !["lost", "warning_closed", "won"].includes(status)
      )
    ) {
      return { kind: "invalid" };
    }
  }

  return {
    kind: "apply",
    effect,
    eventId: input.eventId,
    eventType: input.eventType,
    orderId: input.metadata.orderId!,
    parentId: input.metadata.parentId!,
    childId: input.metadata.childId!,
    productKey: input.metadata.productKey!,
    productVersion: version,
    sessionId: input.sessionId,
    paymentIntentId: input.paymentIntentId,
    // The financial RPC pins this to the catalog/order amount. The discounted
    // total remains Stripe's ledger truth; this value is intentionally the
    // original subtotal, never the post-coupon amount.
    amount: input.amountSubtotal,
    currency: input.currency?.toLowerCase() ?? null,
    processorObjectId: input.processorObjectId?.trim() || null,
    processorStatus: input.processorStatus?.trim() || null,
    processorReason: input.processorReason?.trim() || null,
    processorAmount: input.processorAmount ?? null,
  };
}

export function webhookRpcOutcomeIsSuccess(outcome: unknown): boolean {
  return typeof outcome === "string" && [
    "replay",
    "pending",
    "granted",
    "duplicate_paid",
    "dispute_stands",
    "dispute_suspended",
    "dispute_closed_review",
    "partial_refund_review",
    "partial_refund_stale",
    "refund_stands",
    "cancelled",
    "failed",
    "terminal_stands",
    "refunded",
  ].includes(outcome);
}
