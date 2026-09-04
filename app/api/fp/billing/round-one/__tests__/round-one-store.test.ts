import { describe, expect, it, vi } from "vitest";
import {
  readRoundOnePendingCheckouts,
  readRoundOneWebhookCleanupProvenance,
  type RoundOneWebhookCleanupScope,
} from "../round-one-store";

const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";

function query(result: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "update", "in"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function dbFor(...builders: Array<Record<string, unknown>>) {
  return {
    from: vi.fn(() => {
      const next = builders.shift();
      if (!next) throw new Error("unexpected query");
      return next;
    }),
  };
}

const scope: RoundOneWebhookCleanupScope = {
  orderId: ORDER_ID,
  parentId: PARENT_ID,
  childId: CHILD_ID,
  productKey: "round_one_sell",
  productVersion: 1,
};

describe("Round One webhook cleanup store", () => {
  it("resolves pending cleanup scope through the event ledger order FK", async () => {
    const event = query({
      data: {
        event_type: "charge.dispute.created",
        order_id: ORDER_ID,
        checkout_cleanup_completed_at: null,
      },
      error: null,
    });
    const order = query({
      data: {
        id: ORDER_ID,
        parent_id: PARENT_ID,
        child_id: CHILD_ID,
        product_key: "round_one_sell",
        product_version: 1,
      },
      error: null,
    });
    const db = dbFor(event, order);

    await expect(readRoundOneWebhookCleanupProvenance(
      db as never,
      "evt_original_dispute",
      "charge.dispute.created"
    )).resolves.toEqual({ state: "pending", scope });
    expect(db.from).toHaveBeenNthCalledWith(1, "fp_billing_webhook_events");
    expect(db.from).toHaveBeenNthCalledWith(2, "fp_billing_orders");
  });

  it("does not need mutable order scope after durable cleanup is complete", async () => {
    const event = query({
      data: {
        event_type: "charge.dispute.closed",
        order_id: null,
        checkout_cleanup_completed_at: "2026-09-04T12:00:00.000Z",
      },
      error: null,
    });
    const db = dbFor(event);

    await expect(readRoundOneWebhookCleanupProvenance(
      db as never,
      "evt_closed_dispute",
      "charge.dispute.closed"
    )).resolves.toEqual({ state: "complete" });
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a genuinely new event from a failed ledger read", async () => {
    const missingDb = dbFor(query({ data: null, error: null }));
    await expect(readRoundOneWebhookCleanupProvenance(
      missingDb as never,
      "evt_new_dispute",
      "charge.dispute.created"
    )).resolves.toBe("missing");

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failedDb = dbFor(query({ data: null, error: { message: "offline" } }));
    await expect(readRoundOneWebhookCleanupProvenance(
      failedDb as never,
      "evt_retry_dispute",
      "charge.dispute.created"
    )).resolves.toBe("error");
  });

  it("fails closed when any pending sibling row is malformed instead of dropping it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pending = query({
      data: [
        { id: ORDER_ID, stripe_checkout_session_id: "cs_test_safe" },
        { id: "not-a-uuid", stripe_checkout_session_id: "cs_test_hidden" },
      ],
      error: null,
    });

    await expect(readRoundOnePendingCheckouts(
      dbFor(pending) as never,
      scope
    )).resolves.toBe("error");
  });

  it("fails closed when the pending sibling result is not an array", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(readRoundOnePendingCheckouts(
      dbFor(query({ data: null, error: null })) as never,
      scope
    )).resolves.toBe("error");
  });
});
