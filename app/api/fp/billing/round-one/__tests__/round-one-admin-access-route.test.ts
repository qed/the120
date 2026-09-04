import { beforeEach, describe, expect, it, vi } from "vitest";

const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const STAFF_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

const refs = vi.hoisted(() => ({
  outcome: {
    value: {
      ok: true,
      outcome: "granted",
      orderId: "33333333-3333-4333-8333-333333333333",
      parentId: "55555555-5555-4555-8555-555555555555",
    } as Record<string, unknown>,
  },
  calls: [] as Record<string, unknown>[],
  child: {
    value: { id: "22222222-2222-4222-8222-222222222222" } as { id: string } | null,
  },
}));

vi.mock("../round-one-gateway", () => ({
  roundOneOptions: () => new Response(null, { status: 204 }),
  withRoundOneStaff: async (
    _req: Request,
    _opts: unknown,
    handler: (ctx: Record<string, unknown>) => Promise<Response>
  ) => handler({
    staffId: STAFF_ID,
    admin: {
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({ data: refs.child.value, error: null }),
        };
        return builder;
      },
    },
    headers: { "Content-Type": "application/json" },
    refuse: () => Response.json({ ok: false }, { status: 401 }),
    unavailable: () => Response.json({ ok: false }, { status: 503 }),
    releaseStrikes: vi.fn(),
  }),
}));

vi.mock("../round-one-store", () => ({
  setRoundOneComplimentaryAccess: async (_db: unknown, input: Record<string, unknown>) => {
    refs.calls.push(input);
    return refs.outcome.value;
  },
}));

function post(body: unknown): Request {
  return new Request("http://localhost/api/fp/billing/round-one/admin-access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Round One staff access route", () => {
  beforeEach(() => {
    refs.calls.length = 0;
    refs.child.value = { id: CHILD_ID };
    refs.outcome.value = {
      ok: true,
      outcome: "granted",
      orderId: "33333333-3333-4333-8333-333333333333",
      parentId: "55555555-5555-4555-8555-555555555555",
    };
  });

  it("passes only the verified staff actor and audited child action to the RPC", async () => {
    const { POST } = await import("../admin-access/route");
    const res = await POST(post({
      fpUsername: "Kai",
      action: "comped",
      note: "Emergency migration exception",
      requestId: REQUEST_ID,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      subject: { type: "child", id: CHILD_ID, fpUsername: "kai" },
      action: "comped",
      outcome: "granted",
      orderId: "33333333-3333-4333-8333-333333333333",
    });
    expect(refs.calls).toEqual([{
      childId: CHILD_ID,
      action: "comped",
      note: "Emergency migration exception",
      actorId: STAFF_ID,
      requestId: REQUEST_ID,
    }]);
  });

  it("rejects smuggled parent/payment fields before the service-role call", async () => {
    const { POST } = await import("../admin-access/route");
    const res = await POST(post({
      fpUsername: "kai",
      action: "grandfathered",
      note: "Approved legacy family",
      requestId: REQUEST_ID,
      access: true,
    }));
    expect(res.status).toBe(400);
    expect(refs.calls).toEqual([]);
  });

  it("will not turn off a paid entitlement outside the refund workflow", async () => {
    refs.outcome.value = {
      ok: true,
      outcome: "paid_requires_refund",
      orderId: "33333333-3333-4333-8333-333333333333",
      parentId: "55555555-5555-4555-8555-555555555555",
    };
    const { POST } = await import("../admin-access/route");
    const res = await POST(post({
      fpUsername: "kai",
      action: "revoke",
      note: "Access review requested",
      requestId: REQUEST_ID,
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("refund workflow");
  });

  it("will not replace or clear a dispute suspension", async () => {
    refs.outcome.value = {
      ok: true,
      outcome: "dispute_requires_review",
      orderId: "33333333-3333-4333-8333-333333333333",
      parentId: "55555555-5555-4555-8555-555555555555",
    };
    const { POST } = await import("../admin-access/route");
    const res = await POST(post({
      fpUsername: "kai",
      action: "comped",
      note: "Attempted exception while dispute is open",
      requestId: REQUEST_ID,
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("requires billing review");
  });
});
