import { beforeEach, describe, expect, it, vi } from "vitest";

const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";

const refs = vi.hoisted(() => ({
  event: { value: {} as Record<string, unknown> },
  signatureError: { value: null as Error | null },
  applied: { value: { ok: true, outcome: "granted" } as Record<string, unknown> },
  emailed: { value: { status: "sent" } as Record<string, unknown> },
  plans: [] as Record<string, unknown>[],
  emails: [] as Record<string, unknown>[],
  phones: [] as Record<string, unknown>[],
  phoneStored: { value: true },
  lineItems: {
    value: {
      data: [{ quantity: 1, price: { id: "price_round_one_test" } }],
    } as Record<string, unknown>,
  },
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
    paymentIntents = { retrieve: vi.fn() };
    checkout = {
      sessions: {
        listLineItems: async () => refs.lineItems.value,
      },
    };
  },
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => refs.db,
}));

vi.mock("../round-one-store", () => ({
  applyRoundOneWebhookPlan: async (_db: unknown, plan: Record<string, unknown>) => {
    refs.plans.push(plan);
    return refs.applied.value;
  },
  fillRoundOneParentPhone: async (_db: unknown, input: Record<string, unknown>) => {
    refs.phones.push(input);
    return refs.phoneStored.value;
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
    refs.lineItems.value = {
      data: [{ quantity: 1, price: { id: "price_round_one_test" } }],
    };
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
