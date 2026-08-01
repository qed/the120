import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Thin-wrapper coverage for POST /api/fp/signup/child — specifically the Unit 4
 * review's FIX 4: `attemptId` is a UUID at the schema, so a malformed id is
 * refused PRE-DB and never reaches child-core (where a 22P02 would be laundered
 * into `outage` and REFUND the rate-limit strike). child-core and the rate-limit
 * store are mocked so we assert only the route's own wiring.
 */

const { createChildRef, rateRef } = vi.hoisted(() => ({
  createChildRef: { fn: vi.fn() },
  rateRef: {
    released: [] as string[],
    checks: [] as string[],
    allowed: true,
  },
}));

vi.mock("@/app/api/fp/signup/child-core", () => ({
  createChild: (...args: unknown[]) => createChildRef.fn(...args),
}));
vi.mock("@/app/fp/lib/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rateRef.checks.push(key);
    return { allowed: rateRef.allowed };
  },
  releaseRateLimitEvent: (key: string) => {
    rateRef.released.push(key);
  },
}));
// The service-role / parent-token clients are never constructed on the paths
// under test (malformed id fails first; the outage path mocks createChild), but
// stub them so importing the route never touches Supabase env.
vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/app/lib/supabase/parent-token", () => ({ supabaseParentToken: () => ({}) }));

const ORIGIN = "http://localhost:5173";
const UUID = "11111111-1111-4111-8111-111111111111";

const post = (body: unknown) => {
  const req = new Request("http://localhost/api/fp/signup/child", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: "Bearer parent-access-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return import("@/app/api/fp/signup/child/route").then((m) => m.POST(req));
};

const validBody = (attemptId: string) => ({
  attemptId,
  childFirstName: "Dana",
  childPassword: "orangeledgerkite",
});

describe("POST /api/fp/signup/child — FIX 4: attemptId must be a UUID", () => {
  beforeEach(() => {
    createChildRef.fn = vi.fn();
    rateRef.released = [];
    rateRef.checks = [];
    rateRef.allowed = true;
  });
  afterEach(() => vi.resetModules());

  it("a NON-UUID attemptId is refused pre-DB: 401, child-core never called, NO strike released", async () => {
    const res = await post(validBody("not-a-uuid"));
    expect(res.status).toBe(401);
    // Never reached the DB layer ...
    expect(createChildRef.fn).not.toHaveBeenCalled();
    // ... so no strike was handed back (the loophole the fix closes).
    expect(rateRef.released).toEqual([]);
  });

  it("a well-formed UUID passes the schema and reaches child-core; a genuine outage DOES release the strike", async () => {
    createChildRef.fn = vi.fn().mockResolvedValue({ ok: false, reason: "outage" });
    const res = await post(validBody(UUID));
    expect(res.status).toBe(401);
    expect(createChildRef.fn).toHaveBeenCalledTimes(1);
    // Both the (ip,attempt) and ip-aggregate strikes are refunded on a real outage.
    expect(rateRef.released.length).toBe(2);
  });
});
