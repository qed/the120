import "server-only";

import type Stripe from "stripe";
import {
  buildRoundOneCheckoutSession,
  isExpectedRoundOneProduct,
  isExpectedRoundOneStripePrice,
  reusableCheckoutSession,
  shapeRoundOneStatus,
  type RoundOneEntitlementRow,
  type RoundOneOrderSummaryRow,
  type RoundOneProductRow,
  type RoundOneStripePrice,
  type RoundOneStatusBody,
} from "./round-one-rules";

export type RoundOneBeginRow = {
  outcome: "checkout" | "already_entitled" | "product_unavailable" | "not_owned";
  order_id: string | null;
  stripe_session_id: string | null;
  stripe_session_expires_at: string | null;
  grant_kind: "paid" | "comped" | "grandfathered" | null;
};

export type RoundOneCoreDeps = {
  ownsChild: (parentId: string, childId: string) => Promise<"owned" | "not_owned" | "error">;
  readProduct: (
    productKey: string,
    version: number
  ) => Promise<RoundOneProductRow | null | "error">;
  readEntitlement: (
    parentId: string,
    childId: string,
    productKey: string,
    version: number
  ) => Promise<RoundOneEntitlementRow | null | "error">;
  readLatestOrder: (
    parentId: string,
    childId: string,
    productKey: string,
    version: number
  ) => Promise<RoundOneOrderSummaryRow | null | "error">;
  beginOrder: (
    parentId: string,
    childId: string,
    productKey: string,
    version: number
  ) => Promise<RoundOneBeginRow | "error">;
  attachCheckout: (
    orderId: string,
    sessionId: string,
    expiresAtIso: string
  ) => Promise<boolean>;
  cancelPendingOrder: (orderId: string) => Promise<boolean>;
};

export type RoundOneStripeDeps = {
  retrievePrice: (priceId: string) => Promise<RoundOneStripePrice>;
  createSession: (
    params: Stripe.Checkout.SessionCreateParams,
    opts: Stripe.RequestOptions
  ) => Promise<Pick<Stripe.Checkout.Session, "id" | "url" | "expires_at" | "status">>;
  retrieveSession: (
    sessionId: string
  ) => Promise<Pick<Stripe.Checkout.Session, "id" | "url" | "expires_at" | "status">>;
  expireSession: (
    sessionId: string
  ) => Promise<Pick<Stripe.Checkout.Session, "id" | "status">>;
};

export type ReadRoundOneStatusResult =
  | { kind: "ok"; body: RoundOneStatusBody }
  | { kind: "refused" }
  | { kind: "unavailable" };

export async function readRoundOneStatus(
  deps: RoundOneCoreDeps,
  input: {
    parentId: string;
    childId: string;
    productKey: string;
    productVersion: number;
  }
): Promise<ReadRoundOneStatusResult> {
  const owned = await deps.ownsChild(input.parentId, input.childId);
  if (owned === "error") return { kind: "unavailable" };
  if (owned === "not_owned") return { kind: "refused" };

  const product = await deps.readProduct(input.productKey, input.productVersion);
  if (product === "error" || !isExpectedRoundOneProduct(product, input.productVersion)) {
    return { kind: "unavailable" };
  }
  const [entitlement, latestOrder] = await Promise.all([
    deps.readEntitlement(
      input.parentId,
      input.childId,
      input.productKey,
      input.productVersion
    ),
    deps.readLatestOrder(
      input.parentId,
      input.childId,
      input.productKey,
      input.productVersion
    ),
  ]);
  if (entitlement === "error" || latestOrder === "error") {
    return { kind: "unavailable" };
  }
  return {
    kind: "ok",
    body: shapeRoundOneStatus({ childId: input.childId, product, entitlement, latestOrder }),
  };
}

export type StartRoundOneCheckoutResult =
  | { kind: "checkout"; url: string; reused: boolean }
  | { kind: "already_granted"; grantKind: "paid" | "comped" | "grandfathered" }
  | { kind: "awaiting_webhook" }
  | { kind: "refused" }
  | { kind: "unavailable" };

/**
 * Start or reuse ONE payable session. No branch grants access: only the
 * signature-verified webhook's SQL transaction writes an entitlement.
 */
export async function startRoundOneCheckout(
  deps: RoundOneCoreDeps,
  stripe: RoundOneStripeDeps,
  input: {
    parentId: string;
    childId: string;
    customerEmail: string | null | undefined;
    productKey: string;
    productVersion: number;
    priceId: string;
    nowEpochSeconds: number;
  }
): Promise<StartRoundOneCheckoutResult> {
  const owned = await deps.ownsChild(input.parentId, input.childId);
  if (owned === "error") return { kind: "unavailable" };
  if (owned === "not_owned") return { kind: "refused" };

  const product = await deps.readProduct(input.productKey, input.productVersion);
  if (product === "error" || !isExpectedRoundOneProduct(product, input.productVersion)) {
    return { kind: "unavailable" };
  }
  if (!input.priceId.trim()) return { kind: "unavailable" };

  // Validate the Stripe-side price before creating OR reusing a session. The
  // webhook also checks amount/currency, but that is deliberately too late to
  // protect a parent from paying a misconfigured Price and receiving no access.
  let stripePrice: RoundOneStripePrice;
  try {
    stripePrice = await stripe.retrievePrice(input.priceId);
  } catch {
    return { kind: "unavailable" };
  }
  if (!isExpectedRoundOneStripePrice(stripePrice, input.priceId)) {
    return { kind: "unavailable" };
  }

  // Two passes only: the second exists solely for a pending DB order whose
  // Stripe session has already expired. The first pass cancels it; beginOrder
  // then atomically mints the replacement.
  for (let pass = 0; pass < 2; pass += 1) {
    const begun = await deps.beginOrder(
      input.parentId,
      input.childId,
      input.productKey,
      input.productVersion
    );
    if (begun === "error" || begun.outcome === "product_unavailable") {
      return { kind: "unavailable" };
    }
    if (begun.outcome === "not_owned") return { kind: "refused" };
    if (begun.outcome === "already_entitled") {
      return begun.grant_kind
        ? { kind: "already_granted", grantKind: begun.grant_kind }
        : { kind: "unavailable" };
    }
    if (!begun.order_id) return { kind: "unavailable" };

    if (begun.stripe_session_id) {
      let existing;
      try {
        existing = await stripe.retrieveSession(begun.stripe_session_id);
      } catch {
        return { kind: "unavailable" };
      }
      if (existing.id !== begun.stripe_session_id) return { kind: "unavailable" };
      const reusable = reusableCheckoutSession({
        status: existing.status,
        url: existing.url,
        expiresAt: existing.expires_at,
        nowEpochSeconds: input.nowEpochSeconds,
      });
      if (reusable.reuse) return { kind: "checkout", url: reusable.url, reused: true };

      // A completed session is money-in-flight to the webhook. Never create a
      // second chance to pay and never trust the browser return as fulfilment.
      if (existing.status === "complete") return { kind: "awaiting_webhook" };

      // A session can still be OPEN at Stripe even when its local expiry has
      // passed or its redirect URL is unusable. Canceling only the database
      // order would let that old URL keep accepting payment beside its
      // replacement. Expire it at Stripe first, and fail closed if Stripe
      // cannot prove that it is no longer payable (including a completion race).
      if (existing.status === "open") {
        let expired;
        try {
          expired = await stripe.expireSession(existing.id);
        } catch {
          return { kind: "unavailable" };
        }
        if (expired.id !== existing.id || expired.status !== "expired") {
          return { kind: "unavailable" };
        }
      } else if (existing.status !== "expired") {
        return { kind: "unavailable" };
      }

      if (!(await deps.cancelPendingOrder(begun.order_id))) {
        return { kind: "unavailable" };
      }
      continue;
    }

    const built = buildRoundOneCheckoutSession({
      orderId: begun.order_id,
      parentId: input.parentId,
      childId: input.childId,
      productVersion: input.productVersion,
      priceId: input.priceId,
      customerEmail: input.customerEmail,
    });
    let session;
    try {
      session = await stripe.createSession(built.params, {
        idempotencyKey: built.idempotencyKey,
      });
    } catch {
      return { kind: "unavailable" };
    }
    if (
      !session.id
      || !session.url
      || !session.url.startsWith("https://checkout.stripe.com/")
      || !session.expires_at
      || session.expires_at <= input.nowEpochSeconds
      || session.status !== "open"
    ) {
      return { kind: "unavailable" };
    }
    const attached = await deps.attachCheckout(
      begun.order_id,
      session.id,
      new Date(session.expires_at * 1000).toISOString()
    );
    if (!attached) return { kind: "unavailable" };
    return { kind: "checkout", url: session.url, reused: false };
  }
  return { kind: "unavailable" };
}
