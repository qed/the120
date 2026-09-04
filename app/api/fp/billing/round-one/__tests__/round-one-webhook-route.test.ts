import { beforeEach, describe, expect, it, vi } from "vitest";

const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORDER_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_PARENT_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_CHILD_ID = "88888888-8888-4888-8888-888888888888";

const refs = vi.hoisted(() => ({
  event: { value: {} as Record<string, unknown> },
  signatureError: { value: null as Error | null },
  applied: { value: { ok: true, outcome: "granted" } as Record<string, unknown> },
  emailed: { value: { status: "sent" } as Record<string, unknown> },
  plans: [] as Record<string, unknown>[],
  emails: [] as Record<string, unknown>[],
  phones: [] as Record<string, unknown>[],
  phoneStored: { value: true },
  paymentIntent: {
    value: { metadata: {} } as Record<string, unknown>,
  },
  paymentIntentIds: [] as string[],
  charge: { value: { payment_intent: "pi_round_one" } as Record<string, unknown> },
  chargeIds: [] as string[],
  lineItems: {
    value: {
      data: [{ quantity: 1, price: { id: "price_round_one_test" } }],
    } as Record<string, unknown>,
  },
  pendingCheckouts: {
    value: [] as Array<{ orderId: string; sessionId: string }> | "error",
  },
  cleanupProvenance: {
    values: [] as Array<Record<string, unknown> | "missing" | "error">,
  },
  provenanceEventIds: [] as string[],
  markedCleanup: [] as Record<string, unknown>[],
  markCleanupOk: { value: true },
  pendingCheckoutScopes: [] as Record<string, unknown>[],
  cancelledCheckouts: [] as Record<string, unknown>[],
  cancelCheckoutOk: { value: true },
  checkoutSession: {
    value: { id: "cs_replacement", status: "open" } as Record<string, unknown>,
  },
  expiredCheckoutSession: {
    value: { id: "cs_replacement", status: "expired" } as Record<string, unknown>,
  },
  checkoutRetrieveError: { value: null as Error | null },
  checkoutExpireError: { value: null as Error | null },
  checkoutSessionIds: [] as string[],
  expiredCheckoutSessionIds: [] as string[],
  cleanupTimeline: [] as string[],
  db: { marker: "admin-db" },
  stripeConfigs: [] as Array<Record<string, unknown> | undefined>,
}));

vi.mock("stripe", () => ({
  default: class StripeMock {
    constructor(_key: string, config?: Record<string, unknown>) {
      refs.stripeConfigs.push(config);
    }
    webhooks = {
      constructEventAsync: async () => {
        if (refs.signatureError.value) throw refs.signatureError.value;
        return refs.event.value;
      },
    };
    paymentIntents = {
      retrieve: async (id: string) => {
        refs.paymentIntentIds.push(id);
        return refs.paymentIntent.value;
      },
    };
    charges = {
      retrieve: async (id: string) => {
        refs.chargeIds.push(id);
        return refs.charge.value;
      },
    };
    checkout = {
      sessions: {
        listLineItems: async () => refs.lineItems.value,
        retrieve: async (id: string) => {
          refs.cleanupTimeline.push("stripe:retrieve");
          refs.checkoutSessionIds.push(id);
          if (refs.checkoutRetrieveError.value) throw refs.checkoutRetrieveError.value;
          return refs.checkoutSession.value;
        },
        expire: async (id: string) => {
          refs.cleanupTimeline.push("stripe:expire");
          refs.expiredCheckoutSessionIds.push(id);
          if (refs.checkoutExpireError.value) throw refs.checkoutExpireError.value;
          return refs.expiredCheckoutSession.value;
        },
      },
    };
  },
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => refs.db,
}));

vi.mock("../round-one-store", () => ({
  applyRoundOneWebhookPlan: async (_db: unknown, plan: Record<string, unknown>) => {
    refs.cleanupTimeline.push("db:hold");
    refs.plans.push(plan);
    return refs.applied.value;
  },
  fillRoundOneParentPhone: async (_db: unknown, input: Record<string, unknown>) => {
    refs.phones.push(input);
    return refs.phoneStored.value;
  },
  readRoundOnePendingCheckouts: async (_db: unknown, input: Record<string, unknown>) => {
    refs.cleanupTimeline.push("db:list-pending");
    refs.pendingCheckoutScopes.push(input);
    return refs.pendingCheckouts.value;
  },
  cancelRoundOneExpiredCheckout: async (_db: unknown, input: Record<string, unknown>) => {
    refs.cleanupTimeline.push("db:cancel-expired");
    refs.cancelledCheckouts.push(input);
    return refs.cancelCheckoutOk.value;
  },
  readRoundOneWebhookCleanupProvenance: async (
    _db: unknown,
    eventId: string,
    eventType: string
  ) => {
    refs.cleanupTimeline.push("db:ledger-scope");
    refs.provenanceEventIds.push(`${eventId}:${eventType}`);
    return refs.cleanupProvenance.values.shift() ?? "missing";
  },
  markRoundOneWebhookCleanupComplete: async (_db: unknown, input: Record<string, unknown>) => {
    refs.cleanupTimeline.push("db:mark-clean");
    refs.markedCleanup.push(input);
    return refs.markCleanupOk.value;
  },
}));

vi.mock("../round-one-setup-email", () => ({
  sendRoundOneStripeSetupEmail: async (_db: unknown, input: Record<string, unknown>) => {
    refs.emails.push(input);
    return refs.emailed.value;
  },
}));

function paidEvent(): Record<string, unknown> {
  return {
    id: "evt_round_one_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_round_one",
        payment_status: "paid",
        payment_intent: "pi_round_one",
        amount_subtotal: 25_000,
        amount_total: 25_000,
        total_details: { amount_discount: 0, amount_tax: 0 },
        currency: "cad",
        metadata: {
          billing_kind: "fp_round_one_sell",
          order_id: ORDER_ID,
          parent_id: PARENT_ID,
          child_id: CHILD_ID,
          product_key: "round_one_sell",
          product_version: "1",
        },
      },
    },
  };
}

function disputeOpenedEvent(): Record<string, unknown> {
  return {
    id: "evt_round_one_dispute_created",
    type: "charge.dispute.created",
    data: {
      object: {
        id: "dp_round_one",
        charge: "ch_round_one",
        payment_intent: "pi_round_one",
        status: "needs_response",
        reason: "fraudulent",
        amount: 25_000,
        currency: "cad",
      },
    },
  };
}

function request(): Request {
  return new Request("http://localhost/api/fp/billing/round-one/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test-signature" },
    body: "signed raw body",
  });
}

describe("Round One webhook route", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_not_live";
    process.env.FP_ROUND_ONE_STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.FP_ROUND_ONE_STRIPE_PRICE_ID = "price_round_one_test";
    refs.event.value = paidEvent();
    refs.signatureError.value = null;
    refs.applied.value = { ok: true, outcome: "granted" };
    refs.emailed.value = { status: "sent" };
    refs.plans.length = 0;
    refs.emails.length = 0;
    refs.phones.length = 0;
    refs.phoneStored.value = true;
    refs.paymentIntent.value = { metadata: {} };
    refs.paymentIntentIds.length = 0;
    refs.charge.value = { payment_intent: "pi_round_one" };
    refs.chargeIds.length = 0;
    refs.lineItems.value = {
      data: [{ quantity: 1, price: { id: "price_round_one_test" } }],
    };
    refs.pendingCheckouts.value = [];
    refs.cleanupProvenance.values = [
      "missing",
      {
        state: "pending",
        scope: {
          orderId: ORDER_ID,
          parentId: PARENT_ID,
          childId: CHILD_ID,
          productKey: "round_one_sell",
          productVersion: 1,
        },
      },
    ];
    refs.provenanceEventIds.length = 0;
    refs.markedCleanup.length = 0;
    refs.markCleanupOk.value = true;
    refs.pendingCheckoutScopes.length = 0;
    refs.cancelledCheckouts.length = 0;
    refs.cancelCheckoutOk.value = true;
    refs.checkoutSession.value = { id: "cs_replacement", status: "open" };
    refs.expiredCheckoutSession.value = { id: "cs_replacement", status: "expired" };
    refs.checkoutRetrieveError.value = null;
    refs.checkoutExpireError.value = null;
    refs.checkoutSessionIds.length = 0;
    refs.expiredCheckoutSessionIds.length = 0;
    refs.cleanupTimeline.length = 0;
    refs.stripeConfigs.length = 0;
  });

  it("pins the current Dahlia API version", async () => {
    const { POST } = await import("../webhook/route");
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(refs.stripeConfigs).toEqual([{ apiVersion: "2026-07-29.dahlia" }]);
  });

  it("emails the verified parent only after the paid entitlement is granted", async () => {
    const { POST } = await import("../webhook/route");
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(refs.plans[0]).toMatchObject({ effect: "paid", orderId: ORDER_ID });
    expect(refs.emails).toEqual([{ orderId: ORDER_ID, parentId: PARENT_ID, childId: CHILD_ID }]);
  });

  it("fills a missing parent support phone only from the signed paid session", async () => {
    const event = paidEvent();
    refs.event.value = {
      ...event,
      data: {
        object: {
          ...(event.data as { object: Record<string, unknown> }).object,
          customer_details: { phone: "+14165550123" },
        },
      },
    };
    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.phones).toEqual([{ parentId: PARENT_ID, phone: "+14165550123" }]);
  });

  it("retries a paid event when the parent support phone cannot be persisted", async () => {
    const event = paidEvent();
    refs.event.value = {
      ...event,
      data: {
        object: {
          ...(event.data as { object: Record<string, unknown> }).object,
          customer_details: { phone: "+14165550123" },
        },
      },
    };
    refs.phoneStored.value = false;
    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(refs.emails).toEqual([]);
  });

  it("does not write a phone for non-payment events", async () => {
    const event = paidEvent();
    refs.event.value = {
      ...event,
      type: "checkout.session.expired",
      data: {
        object: {
          ...(event.data as { object: Record<string, unknown> }).object,
          payment_status: "unpaid",
          customer_details: { phone: "+14165550123" },
        },
      },
    };
    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.phones).toEqual([]);
  });

  it("validates the undiscounted catalog subtotal when a promotion code lowers the total", async () => {
    refs.event.value = {
      ...paidEvent(),
      data: {
        object: {
          ...(paidEvent().data as { object: Record<string, unknown> }).object,
          payment_status: "no_payment_required",
          amount_subtotal: 25_000,
          amount_total: 0,
          total_details: { amount_discount: 25_000, amount_tax: 0 },
        },
      },
    };
    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.plans[0]).toMatchObject({
      effect: "paid",
      amount: 25_000,
      currency: "cad",
    });
  });

  it("keeps the PaymentIntent identity when Stripe expands it on a paid session", async () => {
    const event = paidEvent();
    refs.event.value = {
      ...event,
      data: {
        object: {
          ...(event.data as { object: Record<string, unknown> }).object,
          payment_intent: { id: "pi_round_one_expanded", object: "payment_intent" },
        },
      },
    };

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.plans[0]).toMatchObject({
      effect: "paid",
      paymentIntentId: "pi_round_one_expanded",
    });
  });

  it("resolves an out-of-order full refund from an expanded PaymentIntent", async () => {
    refs.event.value = {
      id: "evt_round_one_refund",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_round_one",
          refunded: true,
          currency: "cad",
          payment_intent: { id: "pi_round_one_expanded", object: "payment_intent" },
          metadata: {},
        },
      },
    };
    refs.paymentIntent.value = {
      metadata: (paidEvent().data as { object: { metadata: Record<string, string> } })
        .object.metadata,
    };
    refs.applied.value = { ok: true, outcome: "refunded" };

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.paymentIntentIds).toEqual(["pi_round_one_expanded"]);
    expect(refs.plans[0]).toMatchObject({
      effect: "refunded",
      paymentIntentId: "pi_round_one_expanded",
      orderId: ORDER_ID,
    });
  });

  it("retries a refund that cannot yet resolve its pre-existing order", async () => {
    refs.event.value = {
      id: "evt_round_one_refund_early",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_round_one",
          refunded: true,
          currency: "cad",
          payment_intent: "pi_round_one",
          metadata: {},
        },
      },
    };
    refs.paymentIntent.value = {
      metadata: (paidEvent().data as { object: { metadata: Record<string, string> } })
        .object.metadata,
    };
    // The SQL RPC uses the pre-created order id from PaymentIntent metadata.
    // If that invariant is ever broken, non-2xx keeps Stripe retrying rather
    // than acknowledging a zero-row financial update.
    refs.applied.value = { ok: true, outcome: "order_missing" };

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(refs.plans[0]).toMatchObject({
      effect: "refunded",
      orderId: ORDER_ID,
      paymentIntentId: "pi_round_one",
    });
    expect(refs.emails).toEqual([]);
  });

  it("acknowledges a verified partial refund without revoking access", async () => {
    refs.event.value = {
      id: "evt_round_one_partial_refund",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_round_one",
          refunded: false,
          amount: 25_000,
          amount_refunded: 5_000,
          currency: "cad",
          payment_intent: "pi_round_one",
          metadata: {},
        },
      },
    };
    refs.paymentIntent.value = {
      metadata: (paidEvent().data as { object: { metadata: Record<string, string> } })
        .object.metadata,
    };
    refs.applied.value = { ok: true, outcome: "partial_refund_review" };

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.paymentIntentIds).toEqual(["pi_round_one"]);
    expect(refs.plans[0]).toMatchObject({
      effect: "partial_refund",
      processorObjectId: "ch_round_one",
      processorAmount: 5_000,
    });
    expect(refs.emails).toEqual([]);
  });

  it("suspends access for a signed dispute using the Charge fallback identity", async () => {
    refs.event.value = {
      id: "evt_round_one_dispute_created",
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_round_one",
          charge: "ch_round_one",
          payment_intent: null,
          status: "needs_response",
          reason: "fraudulent",
          amount: 25_000,
          currency: "cad",
        },
      },
    };
    refs.paymentIntent.value = {
      metadata: (paidEvent().data as { object: { metadata: Record<string, string> } })
        .object.metadata,
    };
    refs.applied.value = { ok: true, outcome: "dispute_suspended" };

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.chargeIds).toEqual(["ch_round_one"]);
    expect(refs.paymentIntentIds).toEqual(["pi_round_one"]);
    expect(refs.plans[0]).toMatchObject({
      effect: "dispute_opened",
      orderId: ORDER_ID,
      paymentIntentId: "pi_round_one",
      processorObjectId: "dp_round_one",
      processorStatus: "needs_response",
      processorReason: "fraudulent",
      processorAmount: 25_000,
    });
    expect(refs.emails).toEqual([]);
  });

  it("expires a replacement Checkout that was returned before the old charge dispute committed", async () => {
    refs.event.value = disputeOpenedEvent();
    refs.paymentIntent.value = {
      metadata: (paidEvent().data as { object: { metadata: Record<string, string> } })
        .object.metadata,
    };
    refs.applied.value = { ok: true, outcome: "dispute_suspended" };
    refs.pendingCheckouts.value = [{
      orderId: "44444444-4444-4444-8444-444444444444",
      sessionId: "cs_replacement",
    }];

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.pendingCheckoutScopes).toHaveLength(1);
    expect(refs.pendingCheckoutScopes[0]).toMatchObject({
      parentId: PARENT_ID,
      childId: CHILD_ID,
      productKey: "round_one_sell",
      productVersion: 1,
    });
    expect(refs.checkoutSessionIds).toEqual(["cs_replacement"]);
    expect(refs.expiredCheckoutSessionIds).toEqual(["cs_replacement"]);
    expect(refs.cancelledCheckouts).toEqual([{
      orderId: "44444444-4444-4444-8444-444444444444",
      sessionId: "cs_replacement",
    }]);
    expect(refs.cleanupTimeline).toEqual([
      "db:ledger-scope",
      "db:hold",
      "db:ledger-scope",
      "db:list-pending",
      "stripe:retrieve",
      "stripe:expire",
      "db:cancel-expired",
      "db:mark-clean",
    ]);
  });

  it("uses original ledger provenance on replay even when PaymentIntent metadata now names another child", async () => {
    refs.event.value = disputeOpenedEvent();
    refs.paymentIntent.value = {
      metadata: {
        billing_kind: "fp_round_one_sell",
        order_id: OTHER_ORDER_ID,
        parent_id: OTHER_PARENT_ID,
        child_id: OTHER_CHILD_ID,
        product_key: "round_one_sell",
        product_version: "1",
      },
    };
    refs.applied.value = { ok: true, outcome: "replay" };
    refs.cleanupProvenance.values = [{
      state: "pending",
      scope: {
        orderId: ORDER_ID,
        parentId: PARENT_ID,
        childId: CHILD_ID,
        productKey: "round_one_sell",
        productVersion: 1,
      },
    }];
    refs.pendingCheckouts.value = [{
      orderId: "44444444-4444-4444-8444-444444444444",
      sessionId: "cs_replacement",
    }];
    refs.checkoutSession.value = { id: "cs_replacement", status: "expired" };

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.paymentIntentIds).toEqual([]);
    expect(refs.plans).toEqual([]);
    expect(refs.pendingCheckoutScopes[0]).toEqual({
      orderId: ORDER_ID,
      parentId: PARENT_ID,
      childId: CHILD_ID,
      productKey: "round_one_sell",
      productVersion: 1,
    });
    expect(refs.expiredCheckoutSessionIds).toEqual([]);
    expect(refs.cancelledCheckouts).toHaveLength(1);
    expect(refs.markedCleanup).toEqual([{ eventId: "evt_round_one_dispute_created", orderId: ORDER_ID }]);
  });

  it("retries a dispute webhook when an open sibling Session cannot be expired", async () => {
    refs.event.value = disputeOpenedEvent();
    refs.paymentIntent.value = {
      metadata: (paidEvent().data as { object: { metadata: Record<string, string> } })
        .object.metadata,
    };
    refs.applied.value = { ok: true, outcome: "dispute_suspended" };
    refs.pendingCheckouts.value = [{
      orderId: "44444444-4444-4444-8444-444444444444",
      sessionId: "cs_replacement",
    }];
    refs.checkoutExpireError.value = new Error("completion race");

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(refs.cancelledCheckouts).toEqual([]);
    expect(refs.markedCleanup).toEqual([]);
  });

  it("keeps a raced completed sibling charge held instead of cancelling financial truth", async () => {
    refs.event.value = disputeOpenedEvent();
    refs.paymentIntent.value = {
      metadata: (paidEvent().data as { object: { metadata: Record<string, string> } })
        .object.metadata,
    };
    refs.applied.value = { ok: true, outcome: "dispute_suspended" };
    refs.pendingCheckouts.value = [{
      orderId: "44444444-4444-4444-8444-444444444444",
      sessionId: "cs_replacement",
    }];
    refs.checkoutSession.value = { id: "cs_replacement", status: "complete" };

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.expiredCheckoutSessionIds).toEqual([]);
    expect(refs.cancelledCheckouts).toEqual([]);
    expect(refs.markedCleanup).toEqual([{ eventId: "evt_round_one_dispute_created", orderId: ORDER_ID }]);
  });

  it("acknowledges a dispute replay only after its original cleanup ledger is stamped complete", async () => {
    refs.event.value = disputeOpenedEvent();
    refs.paymentIntent.value = {
      metadata: (paidEvent().data as { object: { metadata: Record<string, string> } })
        .object.metadata,
    };
    refs.applied.value = { ok: true, outcome: "replay" };
    refs.cleanupProvenance.values = [{ state: "complete" }];

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.provenanceEventIds).toEqual([
      "evt_round_one_dispute_created:charge.dispute.created",
    ]);
    expect(refs.pendingCheckoutScopes).toEqual([]);
    expect(refs.markedCleanup).toEqual([]);
  });

  it("does not acknowledge a replay with cleared metadata while original cleanup may be incomplete", async () => {
    refs.event.value = disputeOpenedEvent();
    refs.paymentIntent.value = { metadata: {} };
    refs.cleanupProvenance.values = [{
      state: "pending",
      scope: {
        orderId: ORDER_ID,
        parentId: PARENT_ID,
        childId: CHILD_ID,
        productKey: "round_one_sell",
        productVersion: 1,
      },
    }];
    refs.pendingCheckouts.value = [{
      orderId: "44444444-4444-4444-8444-444444444444",
      sessionId: "cs_replacement",
    }];
    refs.checkoutExpireError.value = new Error("Stripe unavailable");

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(refs.paymentIntentIds).toEqual([]);
    expect(refs.plans).toEqual([]);
    expect(refs.pendingCheckoutScopes).toHaveLength(1);
    expect(refs.markedCleanup).toEqual([]);
  });

  it("keeps a closed won dispute suspended for explicit staff review", async () => {
    refs.event.value = {
      id: "evt_round_one_dispute_closed",
      type: "charge.dispute.closed",
      data: {
        object: {
          id: "dp_round_one",
          charge: "ch_round_one",
          payment_intent: "pi_round_one",
          status: "won",
          reason: "fraudulent",
          amount: 25_000,
          currency: "cad",
        },
      },
    };
    refs.paymentIntent.value = {
      metadata: (paidEvent().data as { object: { metadata: Record<string, string> } })
        .object.metadata,
    };
    refs.applied.value = { ok: true, outcome: "dispute_closed_review" };

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.chargeIds).toEqual([]);
    expect(refs.plans[0]).toMatchObject({
      effect: "dispute_closed",
      processorObjectId: "dp_round_one",
      processorStatus: "won",
    });
    expect(refs.emails).toEqual([]);
  });

  it("does not let a delayed paid completion resurrect a refunded order", async () => {
    refs.applied.value = { ok: true, outcome: "refund_stands" };

    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(refs.plans[0]).toMatchObject({ effect: "paid", orderId: ORDER_ID });
    expect(refs.emails).toEqual([]);
  });

  it("rejects a signed completion whose Stripe line item is not the configured Round One Price", async () => {
    refs.lineItems.value = {
      data: [{ quantity: 1, price: { id: "price_another_product" } }],
    };
    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(refs.plans).toEqual([]);
    expect(refs.emails).toEqual([]);
  });

  it("rejects a coupon total that does not reconcile to the exact subtotal", async () => {
    const event = paidEvent();
    refs.event.value = {
      ...event,
      data: {
        object: {
          ...(event.data as { object: Record<string, unknown> }).object,
          amount_subtotal: 25_000,
          amount_total: 10_000,
          total_details: { amount_discount: 10_000, amount_tax: 0 },
        },
      },
    };
    const { POST } = await import("../webhook/route");
    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(refs.plans).toEqual([]);
    expect(refs.emails).toEqual([]);
  });

  it("keeps a granted payment successful when the best-effort email fails", async () => {
    refs.emailed.value = { status: "send_failed", error: "resend 503" };
    const { POST } = await import("../webhook/route");
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(refs.emails).toHaveLength(1);
  });

  it("does not email when fulfilment fails and leaves Stripe retrying", async () => {
    refs.applied.value = { ok: false };
    const { POST } = await import("../webhook/route");
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(refs.emails).toEqual([]);
  });

  it("does not email an idempotent paid-event replay", async () => {
    refs.applied.value = { ok: true, outcome: "replay" };
    const { POST } = await import("../webhook/route");
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(refs.emails).toEqual([]);
  });

  it("rejects before any database or email work when signature verification fails", async () => {
    refs.signatureError.value = new Error("bad signature");
    const { POST } = await import("../webhook/route");
    const res = await POST(request());
    expect(res.status).toBe(400);
    expect(refs.plans).toEqual([]);
    expect(refs.emails).toEqual([]);
  });
});
