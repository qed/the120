import { afterEach, describe, expect, it, vi } from "vitest";

const sendEmailMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
);
vi.mock("@/app/lib/email", () => ({ sendEmail: sendEmailMock }));

import {
  attemptRoundOneParentNotification,
  drainRoundOneParentNotifications,
  narrowRoundOneParentNotificationKind,
  type RoundOneParentNotificationRow,
} from "../round-one-parent-notifications";

type Reply = { data: unknown; error: { message: string } | null };

function fakeDb(replies: Reply[]) {
  const updates: Record<string, unknown>[] = [];
  const filters: Array<[string, unknown]> = [];
  const next = () => replies.shift() ?? { data: null, error: null };
  const db = {
    from: () => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.update = (value: Record<string, unknown>) => {
        updates.push(value);
        return builder;
      };
      builder.eq = (key: string, value: unknown) => {
        filters.push([key, value]);
        return builder;
      };
      builder.is = chain;
      builder.or = chain;
      builder.lt = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.maybeSingle = async () => next();
      builder.then = (
        resolve: (value: Reply) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(next()).then(resolve, reject);
      return builder;
    },
  };
  return { db: db as never, updates, filters };
}

const SETUP_ROW: RoundOneParentNotificationRow = {
  id: "notify-1",
  dedupeKey: "fp-round-one-stripe-setup:order-1",
  kind: "round_one_stripe_setup",
  parentId: "parent-1",
  childId: "child-1",
  recipientEmail: "parent@example.com",
  parentFirstName: "Pat",
  childFirstName: "Kai",
  attempts: 0,
  sentAt: null,
};

afterEach(() => {
  sendEmailMock.mockReset().mockResolvedValue({ ok: true });
});

describe("Round One parent notification outbox", () => {
  it("narrows only the two migration-backed kinds", () => {
    expect(narrowRoundOneParentNotificationKind("round_one_stripe_setup")).toBe(
      "round_one_stripe_setup",
    );
    expect(narrowRoundOneParentNotificationKind("offer_price_ready")).toBe(
      "offer_price_ready",
    );
    expect(narrowRoundOneParentNotificationKind("surprise")).toBeNull();
  });

  it("claims, sends with the stable semantic key, and stamps success", async () => {
    const { db, updates } = fakeDb([
      { data: [{ id: "notify-1" }], error: null },
      { data: [{ id: "notify-1" }], error: null },
    ]);
    await expect(attemptRoundOneParentNotification(db, SETUP_ROW)).resolves.toBe(
      "sent",
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "parent@example.com",
        from: "First Profit <hello@the120.school>",
        idempotencyKey: SETUP_ROW.dedupeKey,
      }),
    );
    expect(updates[0]).toEqual(
      expect.objectContaining({ attempts: 1, claimed_at: expect.any(String) }),
    );
    expect(updates[1]).toEqual(
      expect.objectContaining({ sent_at: expect.any(String), claimed_at: null }),
    );
  });

  it("unclaims a provider failure so the cron can retry the same row", async () => {
    sendEmailMock.mockResolvedValueOnce({ ok: false, error: "Resend 503" });
    const { db, updates } = fakeDb([
      { data: [{ id: "notify-1" }], error: null },
      { data: [{ id: "notify-1" }], error: null },
    ]);
    await expect(attemptRoundOneParentNotification(db, SETUP_ROW)).resolves.toBe(
      "send_failed",
    );
    expect(updates[1]).toEqual({
      claimed_at: null,
      last_error: "Resend 503",
    });
  });

  it("does not send when another worker already stamped the row", async () => {
    const { db } = fakeDb([
      { data: [], error: null },
      { data: { id: "notify-1", sent_at: "2026-09-01T00:00:00.000Z" }, error: null },
    ]);
    await expect(attemptRoundOneParentNotification(db, SETUP_ROW)).resolves.toBe(
      "already_sent",
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("drains the offer-ready email through the same claim and retry path", async () => {
    const raw = {
      id: "notify-2",
      dedupe_key: "fp-offer-price-ready:child-1:v1:parent:parent-1",
      kind: "offer_price_ready",
      parent_id: "parent-1",
      child_id: "child-1",
      recipient_email: "parent@example.com",
      parent_first_name: "Pat",
      child_first_name: "Kai",
      attempts: 0,
      sent_at: null,
    };
    const { db } = fakeDb([
      { data: [raw], error: null },
      { data: [{ id: "notify-2" }], error: null },
      { data: [{ id: "notify-2" }], error: null },
    ]);
    await expect(
      drainRoundOneParentNotifications(db, { limit: 20, paceMs: 0 }),
    ).resolves.toEqual({
      considered: 1,
      sent: 1,
      alreadySent: 0,
      failed: 0,
      raced: 0,
      errors: 0,
    });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Kai's offer and price are ready for checkout",
        idempotencyKey: raw.dedupe_key,
      }),
    );
  });
});
