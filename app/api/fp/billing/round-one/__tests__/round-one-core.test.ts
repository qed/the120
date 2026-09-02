import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readRoundOneStatus,
  startRoundOneCheckout,
  type RoundOneBeginRow,
  type RoundOneCoreDeps,
  type RoundOneStripeDeps,
} from "../round-one-core";
import {
  ROUND_ONE_ACCESS_CODE,
  ROUND_ONE_AMOUNT_CENTS,
  ROUND_ONE_PRODUCT_KEY,
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

const newOrder = (patch?: Partial<RoundOneBeginRow>): RoundOneBeginRow => ({
  outcome: "checkout",
  order_id: ORDER_ID,
  stripe_session_id: null,
  stripe_session_expires_at: null,
  grant_kind: null,
  ...patch,
});

let deps: RoundOneCoreDeps;
let stripe: RoundOneStripeDeps;

beforeEach(() => {
  deps = {
    ownsChild: vi.fn().mockResolvedValue("owned"),
    readProduct: vi.fn().mockResolvedValue(product()),
    readEntitlement: vi.fn().mockResolvedValue(null),
    readLatestOrder: vi.fn().mockResolvedValue(null),
    beginOrder: vi.fn().mockResolvedValue(newOrder()),
    attachCheckout: vi.fn().mockResolvedValue(true),
    cancelPendingOrder: vi.fn().mockResolvedValue(true),
  };
  stripe = {
    retrievePrice: vi.fn().mockResolvedValue({
      id: "price_round_one_test",
      active: true,
      currency: "cad",
      unit_amount: 25_000,
      type: "one_time",
    }),
    createSession: vi.fn().mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      expires_at: 1_800_001_800,
      status: "open",
    }),
    retrieveSession: vi.fn(),
  };
});

const statusInput = () => ({
  parentId: PARENT_ID,
  childId: CHILD_ID,
  productKey: ROUND_ONE_PRODUCT_KEY,
  productVersion: 1,
});

const checkoutInput = () => ({
  ...statusInput(),
  customerEmail: "parent@example.com",
  priceId: "price_round_one_test",
  nowEpochSeconds: 1_800_000_000,
});

describe("readRoundOneStatus", () => {
  it("checks parent/child ownership before any billing read", async () => {
    vi.mocked(deps.ownsChild).mockResolvedValue("not_owned");
    expect(await readRoundOneStatus(deps, statusInput())).toEqual({ kind: "refused" });
    expect(deps.readProduct).not.toHaveBeenCalled();
    expect(deps.readEntitlement).not.toHaveBeenCalled();
  });

  it("fails unavailable, never open, on database/catalog drift", async () => {
    vi.mocked(deps.readProduct).mockResolvedValue({ ...product(), amount: 1 });
    expect(await readRoundOneStatus(deps, statusInput())).toEqual({ kind: "unavailable" });
    expect(deps.readEntitlement).not.toHaveBeenCalled();
  });

  it("returns the same durable grant for a returning device", async () => {
    vi.mocked(deps.readEntitlement).mockResolvedValue({
      status: "active",
      grant_kind: "comped",
      access_code: ROUND_ONE_ACCESS_CODE,
      granted_at: "2026-01-01T00:00:00Z",
      revoked_at: null,
    });
    const result = await readRoundOneStatus(deps, statusInput());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.body.state).toBe("comped");
      expect(result.body.access.granted).toBe(true);
    }
    expect(deps.readEntitlement).toHaveBeenCalledWith(
      PARENT_ID,
      CHILD_ID,
      ROUND_ONE_PRODUCT_KEY,
      1
    );
  });

  it("does not let a paid-looking order substitute for an entitlement", async () => {
    vi.mocked(deps.readLatestOrder).mockResolvedValue({
      status: "paid",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    const result = await readRoundOneStatus(deps, statusInput());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.body.state).toBe("paid");
      expect(result.body.access.granted).toBe(false);
    }
  });
});

describe("startRoundOneCheckout", () => {
  it("creates and durably attaches a server-bound Checkout session", async () => {
    const result = await startRoundOneCheckout(deps, stripe, checkoutInput());
    expect(result).toEqual({
      kind: "checkout",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      reused: false,
    });
    expect(stripe.createSession).toHaveBeenCalledOnce();
    const [params, options] = vi.mocked(stripe.createSession).mock.calls[0];
    expect(params.metadata).toMatchObject({
      order_id: ORDER_ID,
      parent_id: PARENT_ID,
      child_id: CHILD_ID,
      product_key: ROUND_ONE_PRODUCT_KEY,
    });
    expect(options.idempotencyKey).toBe(`fp-round-one-order:${ORDER_ID}:v1`);
    expect(deps.attachCheckout).toHaveBeenCalledWith(
      ORDER_ID,
      "cs_test_1",
      new Date(1_800_001_800 * 1000).toISOString()
    );
  });

  it("refuses another family's child before Stripe or order creation", async () => {
    vi.mocked(deps.ownsChild).mockResolvedValue("not_owned");
    expect(await startRoundOneCheckout(deps, stripe, checkoutInput())).toEqual({
      kind: "refused",
    });
    expect(deps.beginOrder).not.toHaveBeenCalled();
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it("does not open Stripe when access is already paid/comped/grandfathered", async () => {
    for (const grantKind of ["paid", "comped", "grandfathered"] as const) {
      vi.mocked(deps.beginOrder).mockResolvedValue(
        newOrder({ outcome: "already_entitled", grant_kind: grantKind })
      );
      expect(await startRoundOneCheckout(deps, stripe, checkoutInput())).toEqual({
        kind: "already_granted",
        grantKind,
      });
    }
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it("reuses an existing live session rather than risking a second charge", async () => {
    vi.mocked(deps.beginOrder).mockResolvedValue(
      newOrder({ stripe_session_id: "cs_existing" })
    );
    vi.mocked(stripe.retrieveSession).mockResolvedValue({
      id: "cs_existing",
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_existing",
      expires_at: 1_800_000_100,
    });
    expect(await startRoundOneCheckout(deps, stripe, checkoutInput())).toEqual({
      kind: "checkout",
      url: "https://checkout.stripe.com/c/pay/cs_existing",
      reused: true,
    });
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it("waits for the webhook when the existing Stripe session is complete", async () => {
    vi.mocked(deps.beginOrder).mockResolvedValue(
      newOrder({ stripe_session_id: "cs_complete" })
    );
    vi.mocked(stripe.retrieveSession).mockResolvedValue({
      id: "cs_complete",
      status: "complete",
      url: null,
      expires_at: 1_800_000_100,
    });
    expect(await startRoundOneCheckout(deps, stripe, checkoutInput())).toEqual({
      kind: "awaiting_webhook",
    });
    expect(deps.cancelPendingOrder).not.toHaveBeenCalled();
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it("cancels an expired pending order and creates exactly one replacement", async () => {
    vi.mocked(deps.beginOrder)
      .mockResolvedValueOnce(newOrder({ order_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", stripe_session_id: "cs_expired" }))
      .mockResolvedValueOnce(newOrder({ order_id: ORDER_ID, stripe_session_id: null }));
    vi.mocked(stripe.retrieveSession).mockResolvedValue({
      id: "cs_expired",
      status: "expired",
      url: null,
      expires_at: 1_799_999_999,
    });
    const result = await startRoundOneCheckout(deps, stripe, checkoutInput());
    expect(result.kind).toBe("checkout");
    expect(deps.cancelPendingOrder).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );
    expect(deps.beginOrder).toHaveBeenCalledTimes(2);
    expect(stripe.createSession).toHaveBeenCalledOnce();
  });

  it("fails closed when Stripe creation or DB attachment fails", async () => {
    vi.mocked(stripe.createSession).mockRejectedValueOnce(new Error("network"));
    expect(await startRoundOneCheckout(deps, stripe, checkoutInput())).toEqual({
      kind: "unavailable",
    });

    vi.mocked(stripe.createSession).mockResolvedValueOnce({
      id: "cs_test_2",
      url: "https://checkout.stripe.com/c/pay/cs_test_2",
      expires_at: 1_800_001_800,
      status: "open",
    });
    vi.mocked(deps.attachCheckout).mockResolvedValueOnce(false);
    expect(await startRoundOneCheckout(deps, stripe, checkoutInput())).toEqual({
      kind: "unavailable",
    });
  });

  it("replays identical Stripe creation after a lost attachment response", async () => {
    const created = {
      id: "cs_lost_response",
      url: "https://checkout.stripe.com/c/pay/cs_lost_response",
      expires_at: 1_800_086_400,
      status: "open" as const,
    };
    vi.mocked(stripe.createSession).mockResolvedValue(created);
    vi.mocked(deps.attachCheckout)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    expect(await startRoundOneCheckout(deps, stripe, checkoutInput())).toEqual({
      kind: "unavailable",
    });
    expect(
      await startRoundOneCheckout(deps, stripe, {
        ...checkoutInput(),
        nowEpochSeconds: 1_800_000_900,
      }),
    ).toEqual({
      kind: "checkout",
      url: created.url,
      reused: false,
    });

    expect(stripe.createSession).toHaveBeenCalledTimes(2);
    expect(vi.mocked(stripe.createSession).mock.calls[1]).toEqual(
      vi.mocked(stripe.createSession).mock.calls[0],
    );
  });

  it("refuses a mismatched Stripe Price before creating an order or collecting money", async () => {
    vi.mocked(stripe.retrievePrice).mockResolvedValue({
      id: "price_round_one_test",
      active: true,
      currency: "cad",
      unit_amount: 99_00,
      type: "one_time",
    });

    await expect(startRoundOneCheckout(deps, stripe, checkoutInput())).resolves.toEqual({
      kind: "unavailable",
    });
    expect(deps.beginOrder).not.toHaveBeenCalled();
    expect(stripe.createSession).not.toHaveBeenCalled();
  });
});
