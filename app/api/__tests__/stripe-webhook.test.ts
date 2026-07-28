import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  capacityAlarm,
  downgradeAllowed,
  fulfilVerdict,
  webhookPlan,
} from "@/app/lib/funnel/deposit-rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
import {
  applyStripeEvent,
  type DepositRow,
  type WebhookDeps,
} from "@/app/lib/funnel/deposit-core";

/** U14 (R52, R52a, R52b): the webhook over the calcom pattern — pure
 *  taxonomy exhaustively, then the db-taking core over an in-memory fake.
 *  Stripe itself is never called. */

describe("webhookPlan — the event taxonomy", () => {
  it("completed+paid fulfils; completed+unpaid records pending, never fulfils", () => {
    expect(webhookPlan({ type: "checkout.session.completed", paymentStatus: "paid" })).toEqual({
      kind: "fulfil",
    });
    expect(
      webhookPlan({ type: "checkout.session.completed", paymentStatus: "unpaid" })
    ).toEqual({ kind: "pending" });
  });

  it("the async trio routes: succeeded fulfils (same path), failed and expired downgrade", () => {
    expect(webhookPlan({ type: "checkout.session.async_payment_succeeded" })).toEqual({
      kind: "fulfil",
    });
    expect(webhookPlan({ type: "checkout.session.async_payment_failed" })).toEqual({
      kind: "payment_failed",
    });
    expect(webhookPlan({ type: "checkout.session.expired" })).toEqual({ kind: "expired" });
  });

  it("refunds route; everything else is ignored", () => {
    expect(webhookPlan({ type: "charge.refunded" })).toEqual({ kind: "refund" });
    expect(webhookPlan({ type: "payment_intent.created" })).toEqual({ kind: "ignore" });
  });
});

describe("fulfilVerdict — the refund-resurrection bug, closed", () => {
  it("a refunded row is NEVER resurrected by a redelivered completed", () => {
    expect(fulfilVerdict({ status: "refunded", refunded_at: "2026-07-01T00:00:00Z" })).toBe(
      "refused_refunded"
    );
    // The half-broken shape the old bug produced: status paid but
    // refunded_at still set — also refused.
    expect(fulfilVerdict({ status: "paid", refunded_at: "2026-07-01T00:00:00Z" })).toBe(
      "refused_refunded"
    );
  });

  it("a replayed completed over a paid row is a no-op; pending upgrades", () => {
    expect(fulfilVerdict({ status: "paid", refunded_at: null })).toBe("replay_noop");
    expect(fulfilVerdict({ status: "pending", refunded_at: null })).toBe("write");
    expect(fulfilVerdict(null)).toBe("write");
  });

  it("failed/expired never downgrade a paid or refunded row", () => {
    expect(downgradeAllowed({ status: "paid", refunded_at: null })).toBe(false);
    expect(downgradeAllowed({ status: "refunded", refunded_at: "x" })).toBe(false);
    expect(downgradeAllowed({ status: "pending", refunded_at: null })).toBe(true);
    expect(downgradeAllowed(null)).toBe(false);
  });
});

/* ─────────────────── the core over an in-memory fake ─────────────────── */

type Harness = {
  deps: WebhookDeps;
  rows: Map<string, DepositRow & { childId?: string }>;
  writes: string[];
  linked: string[];
};

function harness(seed: Record<string, DepositRow> = {}, opts: { conflict?: boolean } = {}): Harness {
  const rows = new Map(Object.entries(seed));
  const h: Harness = {
    rows: rows as Harness["rows"],
    writes: [],
    linked: [],
    deps: {
      findBySession: async (id) => rows.get(id) ?? null,
      writeDeposit: async (row) => {
        if (opts.conflict) return "conflict";
        rows.set(row.sessionId, { status: row.status, refunded_at: null });
        h.writes.push(`${row.sessionId}:${row.status}`);
        return "written";
      },
      setStatus: async (id, status) => {
        const r = rows.get(id);
        if (r) rows.set(id, { ...r, status });
        h.writes.push(`${id}:${status}`);
        return true;
      },
      markRefunded: async (pi) => {
        h.writes.push(`refund:${pi}`);
        return true;
      },
      linkAttempt: async (attemptId) => {
        h.linked.push(attemptId);
      },
    },
  };
  return h;
}

const session = (over: Partial<NonNullable<Parameters<typeof applyStripeEvent>[1]["session"]>> = {}) => ({
  id: "cs_1",
  paymentStatus: "paid",
  paymentIntent: "pi_1",
  childId: "child-1",
  parentId: "parent-1",
  attemptId: "attempt-1",
  amount: 25000,
  currency: "cad",
  ...over,
});

describe("applyStripeEvent", () => {
  it("happy path: completed records ONE paid row and links the attempt", async () => {
    const h = harness();
    const out = await applyStripeEvent(h.deps, {
      type: "checkout.session.completed",
      session: session(),
    });
    // U16: a WRITTEN fulfilment carries the ids the c3_deposit emit needs;
    // replays (below) stay bare ok so the conversion never double-counts.
    expect(out).toEqual({
      kind: "ok",
      fulfilled: { childId: "child-1", parentId: "parent-1", sessionId: "cs_1" },
    });
    expect(h.writes).toEqual(["cs_1:paid"]);
    expect(h.linked).toEqual(["attempt-1"]);
  });

  it("a replayed completed for the same session is a no-op", async () => {
    const h = harness({ cs_1: { status: "paid", refunded_at: null } });
    const out = await applyStripeEvent(h.deps, {
      type: "checkout.session.completed",
      session: session(),
    });
    expect(out).toEqual({ kind: "ok" });
    expect(h.writes).toEqual([]);
  });

  it("a refund followed by a redelivered completed does NOT resurrect paid", async () => {
    const h = harness({ cs_1: { status: "refunded", refunded_at: "2026-07-01T00:00:00Z" } });
    const out = await applyStripeEvent(h.deps, {
      type: "checkout.session.completed",
      session: session(),
    });
    expect(out).toEqual({ kind: "ok" });
    expect(h.writes).toEqual([]);
    expect(h.rows.get("cs_1")!.status).toBe("refunded");
  });

  it("payment_status unpaid records pending and does not fulfil; async_payment_succeeded later upgrades it", async () => {
    const h = harness();
    await applyStripeEvent(h.deps, {
      type: "checkout.session.completed",
      session: session({ paymentStatus: "unpaid" }),
    });
    expect(h.rows.get("cs_1")!.status).toBe("pending");
    await applyStripeEvent(h.deps, {
      type: "checkout.session.async_payment_succeeded",
      session: session(),
    });
    expect(h.rows.get("cs_1")!.status).toBe("paid");
  });

  it("a SECOND session's paid row for the same child hits the partial index: acknowledged as double_paid, loudly", async () => {
    const h = harness({}, { conflict: true });
    const out = await applyStripeEvent(h.deps, {
      type: "checkout.session.completed",
      session: session({ id: "cs_2" }),
    });
    expect(out).toEqual({ kind: "double_paid" });
  });

  it("a webhook whose write fails reports failed (the route answers non-200; Stripe retries)", async () => {
    const h = harness();
    h.deps.writeDeposit = async () => "error";
    const out = await applyStripeEvent(h.deps, {
      type: "checkout.session.completed",
      session: session(),
    });
    expect(out).toEqual({ kind: "failed" });
  });

  it("expired downgrades a pending row and never a paid one", async () => {
    const h = harness({ cs_1: { status: "pending", refunded_at: null } });
    await applyStripeEvent(h.deps, {
      type: "checkout.session.expired",
      session: session({ paymentStatus: "unpaid" }),
    });
    expect(h.rows.get("cs_1")!.status).toBe("expired");

    const paid = harness({ cs_9: { status: "paid", refunded_at: null } });
    await applyStripeEvent(paid.deps, {
      type: "checkout.session.expired",
      session: session({ id: "cs_9", paymentStatus: "unpaid" }),
    });
    expect(paid.rows.get("cs_9")!.status).toBe("paid");
  });

  it("a refund event marks by payment intent", async () => {
    const h = harness();
    const out = await applyStripeEvent(h.deps, {
      type: "charge.refunded",
      refundPaymentIntent: "pi_1",
    });
    expect(out).toEqual({ kind: "ok" });
    expect(h.writes).toEqual(["refund:pi_1"]);
  });

  it("a refund matching ZERO rows reports failed — out-of-order delivery retries until the deposit lands", async () => {
    // Stripe does not order deliveries: a refund arriving before its
    // `completed` was previously acknowledged against nothing and lost
    // forever, leaving the books counting a refunded family as a paid
    // seat (both reviewers — the unit's critical).
    const h = harness();
    h.deps.markRefunded = async () => false; // zero rows = failure
    const out = await applyStripeEvent(h.deps, {
      type: "charge.refunded",
      refundPaymentIntent: "pi_early",
    });
    expect(out).toEqual({ kind: "failed" });
  });

  it("W6a: the over-capacity alert lives INSIDE the once-per-fulfilment branch, awaited and try/caught (source pin)", () => {
    const src = readFileSync(
      path.resolve(REPO_ROOT, "app/api/stripe/webhook/route.ts"),
      "utf8"
    );
    // The capacity read + notifyOps must sit inside the outcome.fulfilled
    // branch: a replayed completed is replay_noop (no fulfilled payload),
    // so a replay can never re-alert. Awaited (serverless freeze), and
    // try/caught (an alert must never fail the fulfilment 200).
    const fulfilBranch = src.slice(src.indexOf("outcome.fulfilled"));
    expect(fulfilBranch).toContain('rpc("seats_claimed")');
    expect(fulfilBranch).toContain("capacityAlarm(");
    const alertIdx = fulfilBranch.indexOf("at capacity");
    expect(alertIdx).toBeGreaterThan(-1);
    // The alert is awaited and wrapped: a seats read failure logs, never 500s.
    expect(fulfilBranch).toMatch(/try\s*\{[\s\S]*?seats_claimed[\s\S]*?catch/);
  });

  it("W6a: capacityAlarm fires at-or-past capacity, never below, and fails closed on an unreadable count", () => {
    expect(capacityAlarm(112, 120, 7)).toBe(false); // 113 sellable, 112 claimed
    expect(capacityAlarm(113, 120, 7)).toBe(true); // exactly at capacity
    expect(capacityAlarm(114, 120, 7)).toBe(true); // past (over-allocation)
    expect(capacityAlarm(null, 120, 7)).toBe(false); // unreadable → no alert, no crash
  });

  it("the route forwards only FULL refunds — a partial refund never flips status (source pin)", async () => {
    const src = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
    expect(src).toContain("charge.refunded !== true");
    expect(src).toContain("PARTIAL refund");
  });

  it("the fulfil write is conditional IN SQL — the deposit_fulfil RPC refuses over refunded rows atomically (migration pin)", () => {
    const sql = readFileSync(
      "supabase/migrations/20260812120000_funnel_deposit_fulfil.sql",
      "utf8"
    );
    expect(sql).toContain("deposits.refunded_at is null");
    expect(sql).toContain("when unique_violation then");
    const route = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
    expect(route).toContain('rpc("deposit_fulfil"');
  });

  it("events without metadata (foreign sessions) are acknowledged without writes", async () => {
    const h = harness();
    const out = await applyStripeEvent(h.deps, {
      type: "checkout.session.completed",
      session: session({ childId: null }),
    });
    expect(out).toEqual({ kind: "ok" });
    expect(h.writes).toEqual([]);
  });
});
