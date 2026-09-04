import { describe, expect, it, vi } from "vitest";
import {
  buildRoundOneCheckoutSession,
  deriveRoundOneRateLimitKeys,
  isExpectedRoundOneProduct,
  isExpectedRoundOneProductPrices,
  parseRoundOneAdminAccessRequest,
  parseRoundOneCheckoutRequest,
  parseRoundOneStatusChildId,
  planRoundOneWebhook,
  reusableCheckoutSession,
  roundOneFeatureEnabled,
  roundOneProductVersionFromEnv,
  shapeRoundOneStatus,
  webhookRpcOutcomeIsSuccess,
  ROUND_ONE_ACCESS_CODE,
  ROUND_ONE_AMOUNT_CENTS,
  ROUND_ONE_BILLING_KIND,
  ROUND_ONE_PRODUCT_KEY,
  ROUND_ONE_STRIPE_API_VERSION,
  roundOneIntegrationIdentifier,
  type RoundOneProductRow,
} from "../round-one-rules";

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";

const product = (): RoundOneProductRow => ({
  product_key: ROUND_ONE_PRODUCT_KEY,
  version: 1,
  display_name: "First Profit Round 1 — Sell",
  subject_type: "child",
  access_code: ROUND_ONE_ACCESS_CODE,
  phase_key: "sell",
  first_locked_task_id: "1.1.2",
  last_included_task_id: "1.5.5",
  amount: ROUND_ONE_AMOUNT_CENTS,
  currency: "cad",
  active: true,
});

const prices = () => ([
  { product_key: ROUND_ONE_PRODUCT_KEY, product_version: 1, amount: 35_000, currency: "cad" as const, active: true },
  { product_key: ROUND_ONE_PRODUCT_KEY, product_version: 1, amount: 25_000, currency: "usd" as const, active: true },
]);

const metadata = () => ({
  billingKind: ROUND_ONE_BILLING_KIND,
  orderId: ORDER_ID,
  parentId: PARENT_ID,
  childId: CHILD_ID,
  productKey: ROUND_ONE_PRODUCT_KEY,
  productVersion: "1",
});

describe("Round One request/config rules", () => {
  it("accepts exactly one UUID childId plus a supported currency and rejects smuggled keys", () => {
    expect(parseRoundOneCheckoutRequest({ childId: CHILD_ID, currency: "cad" })).toEqual({
      ok: true,
      value: { childId: CHILD_ID, currency: "cad" },
    });
    expect(parseRoundOneCheckoutRequest({ childId: "not-a-uuid", currency: "cad" })).toEqual({ ok: false });
    expect(parseRoundOneCheckoutRequest({ childId: CHILD_ID, currency: "eur" })).toEqual({ ok: false });
    expect(parseRoundOneCheckoutRequest({ childId: CHILD_ID })).toEqual({ ok: false });
    expect(parseRoundOneCheckoutRequest({ childId: CHILD_ID, currency: "cad", accessGranted: true })).toEqual({
      ok: false,
    });
    expect(parseRoundOneStatusChildId(CHILD_ID)).toBe(CHILD_ID);
    expect(parseRoundOneStatusChildId(null)).toBeNull();
  });

  it("requires a strict, auditable staff access request", () => {
    const requestId = "44444444-4444-4444-8444-444444444444";
    expect(
      parseRoundOneAdminAccessRequest({
        fpUsername: "  Kai@FirstProfit.School  ",
        action: "comped",
        note: "Emergency migration exception",
        requestId,
      })
    ).toEqual({
      ok: true,
      value: {
        fpUsername: "kai@firstprofit.school",
        action: "comped",
        note: "Emergency migration exception",
        requestId,
      },
    });
    for (const bad of [
      { fpUsername: "kai", action: "paid", note: "No", requestId },
      { fpUsername: "kai", action: "revoke", note: "x", requestId },
      { fpUsername: "kai", action: "revoke", note: "Approved", requestId: "retry" },
      {
        fpUsername: "kai",
        action: "grandfathered",
        note: "Approved",
        requestId,
        childId: CHILD_ID,
      },
    ]) {
      expect(parseRoundOneAdminAccessRequest(bad)).toEqual({ ok: false });
    }
  });

  it("fails closed on malformed product versions and feature flags", () => {
    expect(roundOneProductVersionFromEnv(undefined)).toBe(1);
    expect(roundOneProductVersionFromEnv("2")).toBe(2);
    for (const bad of ["0", "-1", "1.5", "one", "9007199254740993"]) {
      expect(roundOneProductVersionFromEnv(bad)).toBeNull();
    }
    expect(roundOneFeatureEnabled("true")).toBe(true);
    expect(roundOneFeatureEnabled("TRUE")).toBe(false);
    expect(roundOneFeatureEnabled(undefined)).toBe(false);
  });

  it("pins every access-bearing catalog field", () => {
    expect(isExpectedRoundOneProduct(product(), 1)).toBe(true);
    for (const patch of [
      { amount: 24_999 },
      { currency: "usd" },
      { access_code: "phase:build" },
      { first_locked_task_id: "1.1.1" },
      { last_included_task_id: "2.1.1" },
      { active: false },
    ]) {
      expect(isExpectedRoundOneProduct({ ...product(), ...patch } as RoundOneProductRow, 1)).toBe(
        false
      );
    }
  });

  it("requires exactly the two confirmed Round One Sell prices", () => {
    expect(isExpectedRoundOneProductPrices(prices(), 1)).toBe(true);
    expect(isExpectedRoundOneProductPrices(prices().slice(0, 1), 1)).toBe(false);
    expect(
      isExpectedRoundOneProductPrices(
        [...prices(), { ...prices()[0] }],
        1
      )
    ).toBe(false);
    expect(
      isExpectedRoundOneProductPrices(
        prices().map((row) =>
          row.currency === "usd" ? { ...row, amount: 100_000 } : row
        ),
        1
      )
    ).toBe(false);
    expect(isExpectedRoundOneProductPrices(prices(), 2)).toBe(false);
  });

  it("uses injective, endpoint-separated rate-limit keys", () => {
    const a = deriveRoundOneRateLimitKeys("checkout", "2001:db8::1", "parent:x");
    const b = deriveRoundOneRateLimitKeys("status", "2001:db8::1", "parent:x");
    expect(a.userKey).not.toBe(b.userKey);
    expect(a.userKey).toContain("2001%3Adb8%3A%3A1");
    expect(a.userKey).toContain("parent%3Ax");
  });
});

describe("Stripe Checkout shape", () => {
  it("uses the pinned Stripe API version and a stable per-order integration identifier", () => {
    expect(ROUND_ONE_STRIPE_API_VERSION).toBe("2026-07-29.dahlia");
    const first = roundOneIntegrationIdentifier(ORDER_ID);
    expect(first).toMatch(/^first_profit_round_one_[a-z]{8}$/);
    expect(roundOneIntegrationIdentifier(ORDER_ID)).toBe(first);
    expect(
      roundOneIntegrationIdentifier("44444444-4444-4444-8444-444444444444")
    ).not.toBe(first);
  });

  it("binds the persisted order, parent, child and version into Stripe metadata", () => {
    const input = {
      orderId: ORDER_ID,
      parentId: PARENT_ID,
      childId: CHILD_ID,
      productVersion: 1,
      priceId: "price_round_one_test",
      currency: "cad" as const,
      customerEmail: "parent@example.com",
    };
    const built = buildRoundOneCheckoutSession(input);
    expect(built.idempotencyKey).toBe(`fp-round-one-order:${ORDER_ID}:v1`);
    expect(built.params.integration_identifier).toMatch(
      /^first_profit_round_one_[a-z]{8}$/
    );
    expect(buildRoundOneCheckoutSession(input)).toEqual(built);
    expect(built.params.line_items).toEqual([{ price: "price_round_one_test", quantity: 1 }]);
    expect("payment_method_types" in built.params).toBe(false);
    expect("automatic_tax" in built.params).toBe(false);
    expect(built.params.allow_promotion_codes).toBe(true);
    expect(built.params.phone_number_collection).toEqual({ enabled: true });
    const submitCopy = built.params.custom_text?.submit;
    expect(typeof submitCopy === "string" ? submitCopy : submitCopy?.message).toMatch(
      /one-child, non-refundable CAD \$350 total today.*tax-exempt for K-12 education.*program-support calls/i
    );
    expect(built.params.metadata).toEqual({
      billing_kind: ROUND_ONE_BILLING_KIND,
      order_id: ORDER_ID,
      parent_id: PARENT_ID,
      child_id: CHILD_ID,
      product_key: ROUND_ONE_PRODUCT_KEY,
      product_version: "1",
      billing_currency: "cad",
    });
    expect(built.params.payment_intent_data?.metadata).toEqual(built.params.metadata);
    expect("expires_at" in built.params).toBe(false);
    expect(built.params.success_url).toBe(
      `https://firstprofit.school/parent?roundOne=success&child=${CHILD_ID}&session_id={CHECKOUT_SESSION_ID}`
    );
    expect(built.params.cancel_url).toBe(
      `https://firstprofit.school/parent?roundOne=cancelled&child=${CHILD_ID}`
    );
  });

  it("builds the USD $250 variant from the same locked Sell product", () => {
    const built = buildRoundOneCheckoutSession({
      orderId: ORDER_ID,
      parentId: PARENT_ID,
      childId: CHILD_ID,
      productVersion: 1,
      priceId: "price_round_one_usd_test",
      currency: "usd",
      customerEmail: "parent@example.com",
    });

    expect(built.params.line_items).toEqual([
      { price: "price_round_one_usd_test", quantity: 1 },
    ]);
    expect(built.params.metadata?.billing_currency).toBe("usd");
    const submitCopy = built.params.custom_text?.submit;
    expect(typeof submitCopy === "string" ? submitCopy : submitCopy?.message).toMatch(
      /one-child, non-refundable USD \$250 total today.*tax-exempt for K-12 education/i
    );
  });

  it("keeps every Stripe creation parameter stable when wall-clock time advances", () => {
    const input = {
      orderId: ORDER_ID,
      parentId: PARENT_ID,
      childId: CHILD_ID,
      productVersion: 1,
      priceId: "price_round_one_test",
      currency: "cad" as const,
      customerEmail: "parent@example.com",
    };
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const first = buildRoundOneCheckoutSession(input);
    clock.mockReturnValue(1_800_000_900_000);
    const retry = buildRoundOneCheckoutSession(input);
    clock.mockRestore();
    expect(retry).toEqual(first);
    expect("expires_at" in retry.params).toBe(false);
  });

  it("rotates the stable Checkout identity when the product version changes", () => {
    const base = {
      orderId: ORDER_ID,
      parentId: PARENT_ID,
      childId: CHILD_ID,
      priceId: "price_round_one_test",
      currency: "cad" as const,
      customerEmail: "parent@example.com",
    };
    const first = buildRoundOneCheckoutSession({ ...base, productVersion: 1 });
    const next = buildRoundOneCheckoutSession({ ...base, productVersion: 2 });

    expect(first.idempotencyKey).toBe(`fp-round-one-order:${ORDER_ID}:v1`);
    expect(next.idempotencyKey).toBe(`fp-round-one-order:${ORDER_ID}:v2`);
    expect(first.params.metadata?.product_version).toBe("1");
    expect(next.params.metadata?.product_version).toBe("2");
  });

  it("reuses only a live Stripe-hosted open session", () => {
    expect(
      reusableCheckoutSession({
        status: "open",
        url: "https://checkout.stripe.com/c/pay/test",
        expiresAt: 200,
        nowEpochSeconds: 100,
      })
    ).toEqual({ reuse: true, url: "https://checkout.stripe.com/c/pay/test" });
    for (const input of [
      { status: "complete", url: "https://checkout.stripe.com/x", expiresAt: 200 },
      { status: "open", url: "https://evil.example/x", expiresAt: 200 },
      { status: "open", url: "https://checkout.stripe.com/x", expiresAt: 100 },
    ]) {
      expect(reusableCheckoutSession({ ...input, nowEpochSeconds: 100 })).toEqual({ reuse: false });
    }
  });
});

describe("status shaping", () => {
  it("says what is free and grants nothing without an active entitlement", () => {
    const body = shapeRoundOneStatus({
      childId: CHILD_ID,
      product: product(),
      prices: prices(),
      entitlement: null,
      latestOrder: null,
    });
    expect(body.state).toBe("not_started");
    expect(body.access).toEqual({ granted: false, code: null, reason: null });
    expect(body.product.freeThroughTaskId).toBe("1.1.1");
    expect(body.product.unlocksFromTaskId).toBe("1.1.2");
    expect(body.product.unlocksThroughTaskId).toBe("1.5.5");
    expect(body.canStartCheckout).toBe(true);
  });

  it("surfaces pending/cancelled/failed/refunded without treating them as access", () => {
    for (const state of ["pending", "cancelled", "failed", "refunded"] as const) {
      const body = shapeRoundOneStatus({
        childId: CHILD_ID,
        product: product(),
        prices: prices(),
        entitlement: null,
        latestOrder: {
          status: state,
          amount: 35_000,
          currency: "cad",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      });
      expect(body.state).toBe(state);
      expect(body.access.granted).toBe(false);
      expect(body.canStartCheckout).toBe(true);
    }
  });

  it("makes a terminal failed payment retryable without granting access", () => {
    const body = shapeRoundOneStatus({
      childId: CHILD_ID,
      product: product(),
      prices: prices(),
      entitlement: null,
      latestOrder: {
        status: "failed",
        amount: 35_000,
        currency: "cad",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:01:00Z",
      },
    });
    expect(body).toMatchObject({
      state: "failed",
      access: { granted: false, code: null, reason: null },
      canStartCheckout: true,
    });
  });

  it("supports paid, comped and grandfathered grants", () => {
    for (const grant of ["paid", "comped", "grandfathered"] as const) {
      const body = shapeRoundOneStatus({
        childId: CHILD_ID,
        product: product(),
        prices: prices(),
        entitlement: {
          status: "active",
          grant_kind: grant,
          access_code: ROUND_ONE_ACCESS_CODE,
          granted_at: "2026-01-01T00:00:00Z",
          suspended_at: null,
          suspension_reason: null,
          revoked_at: null,
        },
        latestOrder: null,
      });
      expect(body.state).toBe(grant);
      expect(body.access).toEqual({
        granted: true,
        code: ROUND_ONE_ACCESS_CODE,
        reason: grant,
      });
      expect(body.canStartCheckout).toBe(false);
    }
  });

  it("never presents a revoked complimentary entitlement as active", () => {
    const body = shapeRoundOneStatus({
      childId: CHILD_ID,
      product: product(),
      prices: prices(),
      entitlement: {
        status: "revoked",
        grant_kind: "comped",
        access_code: ROUND_ONE_ACCESS_CODE,
        granted_at: "2026-01-01T00:00:00Z",
        suspended_at: null,
        suspension_reason: null,
        revoked_at: "2026-01-02T00:00:00Z",
      },
      latestOrder: {
        status: "comped",
        amount: 35_000,
        currency: "cad",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    });
    expect(body.state).toBe("cancelled");
    expect(body.access).toEqual({ granted: false, code: null, reason: null });
    expect(body.canStartCheckout).toBe(true);
  });

  it("fails access closed for a revoked or wrong-code entitlement", () => {
    for (const entitlement of [
      {
        status: "revoked" as const,
        grant_kind: "paid" as const,
        access_code: ROUND_ONE_ACCESS_CODE,
        granted_at: "x",
        suspended_at: null,
        suspension_reason: null,
        revoked_at: "y",
      },
      {
        status: "active" as const,
        grant_kind: "paid" as const,
        access_code: "phase:build",
        granted_at: "x",
        suspended_at: null,
        suspension_reason: null,
        revoked_at: null,
      },
    ]) {
      expect(
        shapeRoundOneStatus({ childId: CHILD_ID, product: product(), prices: prices(), entitlement, latestOrder: null })
          .access.granted
      ).toBe(false);
    }
  });

  it("fails a Stripe-disputed entitlement closed without offering another checkout", () => {
    const body = shapeRoundOneStatus({
      childId: CHILD_ID,
      product: product(),
      prices: prices(),
      entitlement: {
        status: "suspended",
        grant_kind: "paid",
        access_code: ROUND_ONE_ACCESS_CODE,
        granted_at: "2026-01-01T00:00:00Z",
        suspended_at: "2026-01-02T00:00:00Z",
        suspension_reason: "stripe_dispute",
        revoked_at: null,
      },
      latestOrder: {
        status: "paid",
        amount: 35_000,
        currency: "cad",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    });
    expect(body).toMatchObject({
      state: "suspended",
      access: { granted: false, code: null, reason: null },
      canStartCheckout: false,
    });
  });

  it("does not expose a stale pending checkout once a dispute overrides its state", () => {
    const body = shapeRoundOneStatus({
      childId: CHILD_ID,
      product: product(),
      prices: prices(),
      entitlement: null,
      latestOrder: {
        status: "pending",
        amount: 25_000,
        currency: "usd",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      disputeHeld: true,
    });

    expect(body.state).toBe("suspended");
    expect(body.canStartCheckout).toBe(false);
    expect(body.pendingCheckout).toBeNull();
  });

  it("lets a product-wide hold override missing, revoked, or accidentally active entitlement state", () => {
    for (const entitlement of [
      null,
      {
        status: "revoked" as const,
        grant_kind: "paid" as const,
        access_code: ROUND_ONE_ACCESS_CODE,
        granted_at: "2026-01-01T00:00:00Z",
        suspended_at: null,
        suspension_reason: null,
        revoked_at: "2026-01-02T00:00:00Z",
      },
      {
        status: "active" as const,
        grant_kind: "paid" as const,
        access_code: ROUND_ONE_ACCESS_CODE,
        granted_at: "2026-01-01T00:00:00Z",
        suspended_at: null,
        suspension_reason: null,
        revoked_at: null,
      },
    ]) {
      expect(shapeRoundOneStatus({
        childId: CHILD_ID,
        product: product(),
        prices: prices(),
        entitlement,
        latestOrder: {
          status: "refunded",
          amount: 35_000,
          currency: "cad",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
        disputeHeld: true,
      })).toMatchObject({
        state: "suspended",
        access: { granted: false },
        canStartCheckout: false,
      });
    }
  });
});

describe("signed webhook planning", () => {
  const input = () => ({
    eventId: "evt_1",
    eventType: "checkout.session.completed",
    paymentStatus: "paid",
    metadata: metadata(),
    sessionId: "cs_1",
    paymentIntentId: "pi_1",
    catalogPriceMatches: true,
    amountSubtotal: ROUND_ONE_AMOUNT_CENTS,
    amountTotal: ROUND_ONE_AMOUNT_CENTS,
    amountDiscount: 0,
    amountTax: 0,
    currency: "CAD",
  });

  it("ignores events that do not name this billing product", () => {
    expect(
      planRoundOneWebhook({
        ...input(),
        metadata: { ...metadata(), billingKind: "the120_seat_deposit" },
      })
    ).toEqual({ kind: "ignore", reason: "foreign" });
  });

  it("refuses malformed metadata on an event that claims to be Round One", () => {
    expect(
      planRoundOneWebhook({
        ...input(),
        metadata: { ...metadata(), childId: "not-a-uuid" },
      })
    ).toEqual({ kind: "invalid" });
  });

  it.each([
    ["checkout.session.completed", "paid", "paid"],
    ["checkout.session.completed", "no_payment_required", "paid"],
    ["checkout.session.completed", "unpaid", "pending"],
    ["checkout.session.async_payment_succeeded", null, "paid"],
    ["checkout.session.async_payment_failed", null, "failed"],
    ["checkout.session.expired", null, "cancelled"],
  ])("maps %s/%s to %s", (eventType, paymentStatus, effect) => {
    const plan = planRoundOneWebhook({ ...input(), eventType, paymentStatus });
    expect(plan.kind).toBe("apply");
    if (plan.kind === "apply") {
      expect(plan.effect).toBe(effect);
      expect(plan.currency).toBe("cad");
      expect(plan.orderId).toBe(ORDER_ID);
    }
  });

  it("preserves access while making a partial refund a durable review effect", () => {
    const partial = planRoundOneWebhook({
      ...input(),
      eventType: "charge.refunded",
      fullRefund: false,
      processorObjectId: "ch_1",
      processorAmount: 5_000,
      processorTotalAmount: ROUND_ONE_AMOUNT_CENTS,
    });
    expect(partial).toMatchObject({
      kind: "apply",
      effect: "partial_refund",
      processorObjectId: "ch_1",
      processorAmount: 5_000,
    });
    const full = planRoundOneWebhook({
      ...input(),
      eventType: "charge.refunded",
      fullRefund: true,
      processorObjectId: "ch_1",
    });
    expect(full.kind === "apply" && full.effect).toBe("refunded");
  });

  it.each([
    ["charge.dispute.created", "needs_response", "dispute_opened"],
    ["charge.dispute.closed", "won", "dispute_closed"],
    ["charge.dispute.closed", "lost", "dispute_closed"],
    ["charge.dispute.closed", "warning_closed", "dispute_closed"],
  ])("maps %s/%s to the sticky suspension effect %s", (eventType, status, effect) => {
    const plan = planRoundOneWebhook({
      ...input(),
      eventType,
      processorObjectId: "dp_1",
      processorStatus: status,
      processorReason: "fraudulent",
      processorAmount: ROUND_ONE_AMOUNT_CENTS,
    });
    expect(plan).toMatchObject({
      kind: "apply",
      effect,
      processorObjectId: "dp_1",
      processorStatus: status,
      processorReason: "fraudulent",
    });
  });

  it("fails closed on malformed dispute evidence and non-terminal closure status", () => {
    for (const patch of [
      { processorObjectId: null },
      { processorStatus: "" },
      { processorReason: "" },
      { processorAmount: 0 },
      { processorStatus: "needs_response" },
    ]) {
      expect(planRoundOneWebhook({
        ...input(),
        eventType: "charge.dispute.closed",
        processorObjectId: "dp_1",
        processorStatus: "won",
        processorReason: "fraudulent",
        processorAmount: ROUND_ONE_AMOUNT_CENTS,
        ...patch,
      })).toEqual({ kind: "invalid" });
    }
  });

  it("accepts a reconciled promotion discount, including a zero-total checkout", () => {
    for (const [amountTotal, amountDiscount] of [
      [30_000, 5_000],
      [0, ROUND_ONE_AMOUNT_CENTS],
    ]) {
      const plan = planRoundOneWebhook({
        ...input(),
        amountTotal,
        amountDiscount,
      });
      expect(plan.kind).toBe("apply");
      if (plan.kind === "apply") expect(plan.amount).toBe(ROUND_ONE_AMOUNT_CENTS);
    }
  });

  it("rejects wrong Price proof, unreconciled discounts, and tax", () => {
    for (const patch of [
      { catalogPriceMatches: false },
      { amountTotal: 20_000, amountDiscount: 4_000 },
      { amountTax: 1 },
    ]) {
      const plan = planRoundOneWebhook({ ...input(), ...patch });
      expect(plan).toEqual({ kind: "invalid" });
    }
  });

  it("carries a reconciled changed subtotal to the financial RPC for rejection against the stored order", () => {
    const plan = planRoundOneWebhook({
      ...input(),
      amountSubtotal: 24_999,
      amountTotal: 24_999,
    });
    expect(plan.kind).toBe("apply");
    if (plan.kind === "apply") expect(plan.amount).toBe(24_999);
  });

  it("only acknowledges the SQL outcomes that preserve money/access truth", () => {
    for (const good of [
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
    ]) {
      expect(webhookRpcOutcomeIsSuccess(good)).toBe(true);
    }
    for (const bad of [
      "amount_mismatch",
      "metadata_mismatch",
      "processor_identity_mismatch",
      "order_missing",
      null,
    ]) {
      expect(webhookRpcOutcomeIsSuccess(bad)).toBe(false);
    }
  });
});
