import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Thin-wrapper coverage for POST /api/fp/signup/child — specifically the Unit 4
 * review's FIX 4: `attemptId` is a UUID at the schema, so a malformed id is
 * refused PRE-DB and never reaches child-core (where a 22P02 would be laundered
 * into `outage` and REFUND the rate-limit strike). child-core and the rate-limit
 * store are mocked so we assert only the route's own wiring.
 */

const { createChildRef, rateRef, resolveRef, parentTokenRef } = vi.hoisted(() => ({
  createChildRef: { fn: vi.fn() },
  rateRef: {
    released: [] as string[],
    checks: [] as string[],
    allowed: true,
  },
  // (fpv04 U5a) The server-side attempt resolution seam, exercised when the
  // request omits attemptId.
  resolveRef: {
    fn: vi.fn(),
  },
  // getUser result for the parent-token client (the resolution path needs a
  // real-shaped one; every other path tolerates the throwing default).
  parentTokenRef: {
    user: null as { id: string } | null,
  },
}));

vi.mock("@/app/api/fp/signup/child-core", () => ({
  createChild: (...args: unknown[]) => createChildRef.fn(...args),
}));
vi.mock("@/app/api/fp/signup/attempt-resolve", () => ({
  resolveAttemptForParent: (...args: unknown[]) => resolveRef.fn(...args),
}));
vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rateRef.checks.push(key);
    return { allowed: rateRef.allowed };
  },
  releaseRateLimitEvent: (key: string) => {
    rateRef.released.push(key);
  },
}));
// The service-role client is never constructed on the paths under test
// (malformed id fails first; the outage path mocks createChild); stub it so
// importing the route never touches Supabase env. The parent-token client gets
// a getUser whose result the fpv04 resolution tests control.
vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/app/lib/supabase/parent-token", () => ({
  supabaseParentToken: () => ({
    auth: {
      getUser: async () =>
        parentTokenRef.user
          ? { data: { user: parentTokenRef.user }, error: null }
          : { data: { user: null }, error: { message: "no user" } },
    },
  }),
}));

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

  it("a successful mint returns the generated fp_username (U15) in the 200 body", async () => {
    createChildRef.fn = vi
      .fn()
      .mockResolvedValue({ ok: true, childId: "child1", playerProfileId: "pp1", username: "dana" });
    const res = await post(validBody(UUID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; childId: string; username: string };
    expect(body).toMatchObject({ ok: true, childId: "child1", username: "dana" });
  });

  it("an idempotent replay (no username on the result) returns an empty username, not undefined", async () => {
    createChildRef.fn = vi.fn().mockResolvedValue({ ok: true, childId: "child1" });
    const res = await post(validBody(UUID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; childId: string; username: string };
    expect(body).toEqual({
      ok: true,
      status: "child_created",
      childId: "child1",
      username: "",
      childPassword: "",
    });
  });
});

/* --------------------------------------------- fpv04 U5a route extensions */

describe("POST /api/fp/signup/child — fpv04 U5a additive extensions", () => {
  beforeEach(() => {
    createChildRef.fn = vi.fn();
    resolveRef.fn = vi.fn();
    parentTokenRef.user = null;
    rateRef.released = [];
    rateRef.checks = [];
    rateRef.allowed = true;
  });
  afterEach(() => vi.resetModules());

  const fpv04Body = {
    childFirstName: "Amelia",
    childLastName: "Halsey",
    coverLook: "manga-arc",
    heroVibe: "inventor",
    heroGender: "girl",
  };

  it("no attemptId → resolves server-side from the Bearer identity; body keys are the pinned FpChildMintBody", async () => {
    parentTokenRef.user = { id: "parent-1" };
    resolveRef.fn = vi.fn().mockResolvedValue({ ok: true, attemptId: UUID });
    createChildRef.fn = vi.fn().mockResolvedValue({
      ok: true,
      childId: "child1",
      playerProfileId: "pp1",
      username: "amelia.halsey@firstprofit.school",
    });
    const res = await post(fpv04Body);
    expect(res.status).toBe(200);
    // The resolver saw this parent, and the child mint rode the resolved id.
    expect(resolveRef.fn).toHaveBeenCalledWith(expect.anything(), {
      parentId: "parent-1",
      states: ["verified", "child_created"],
    });
    const [, coreInput] = createChildRef.fn.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(coreInput.attemptId).toBe(UUID);
    expect(coreInput.lastName).toBe("Halsey");
    expect(coreInput.coverLook).toBe("manga-arc");
    expect(coreInput.heroVibe).toBe("inventor");
    expect(coreInput.heroGender).toBe("girl");

    const body = (await res.json()) as Record<string, unknown>;
    // TWIN PIN: exactly the FpChildMintBody keys, in order (mint-rules).
    expect(Object.keys(body)).toEqual(["ok", "status", "childId", "username", "childPassword"]);
    // The server minted the memorable one-time password and returned it ONCE.
    expect(body.childPassword).toMatch(/^[a-z]{4,8}-[a-z]{4,8}-\d{2}$/);
    // The kid's auth password IS the returned value.
    expect(coreInput.childPassword).toBe(body.childPassword);
  });

  it("a caller-supplied childPassword is NEVER echoed back (childPassword: '')", async () => {
    createChildRef.fn = vi.fn().mockResolvedValue({
      ok: true,
      childId: "child1",
      playerProfileId: "pp1",
      username: "dana",
    });
    const res = await post(validBody(UUID));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.childPassword).toBe("");
  });

  it("server-minted password + idempotent REPLAY → childPassword '' (the suppression combo: a minted candidate never rides a replay response)", async () => {
    parentTokenRef.user = { id: "parent-1" };
    resolveRef.fn = vi.fn().mockResolvedValue({ ok: true, attemptId: UUID, state: "child_created" });
    // The core answers the replay branch: existing childId only, NO username.
    createChildRef.fn = vi.fn().mockResolvedValue({ ok: true, childId: "child1" });
    // fpv04Body omits childPassword, so the route DID mint a memorable
    // candidate before the core replied — the username-gated suppression must
    // still blank it (the one-time reveal cannot be re-fetched).
    const res = await post(fpv04Body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: "child_created",
      childId: "child1",
      username: "",
      childPassword: "",
    });
  });

  it("a bad coverLook id is refused at the schema (401, core never called)", async () => {
    parentTokenRef.user = { id: "parent-1" };
    resolveRef.fn = vi.fn().mockResolvedValue({ ok: true, attemptId: UUID });
    const res = await post({ ...fpv04Body, coverLook: "totally-made-up" });
    expect(res.status).toBe(401);
    expect(createChildRef.fn).not.toHaveBeenCalled();
  });

  it("no attempt resolvable for this parent → generic 401, strike standing", async () => {
    parentTokenRef.user = { id: "parent-1" };
    resolveRef.fn = vi.fn().mockResolvedValue({ ok: false, reason: "none" });
    const res = await post(fpv04Body);
    expect(res.status).toBe(401);
    expect(createChildRef.fn).not.toHaveBeenCalled();
    expect(rateRef.released).toEqual([]);
  });

  it("a resolution OUTAGE refunds the strike (our fault, not the caller's)", async () => {
    parentTokenRef.user = { id: "parent-1" };
    resolveRef.fn = vi.fn().mockResolvedValue({ ok: false, reason: "outage" });
    const res = await post(fpv04Body);
    expect(res.status).toBe(401);
    expect(rateRef.released.length).toBe(2);
  });

  it("an unusable Bearer (getUser fails) on the no-attemptId path is the generic 401", async () => {
    parentTokenRef.user = null;
    const res = await post(fpv04Body);
    expect(res.status).toBe(401);
    expect(resolveRef.fn).not.toHaveBeenCalled();
    expect(createChildRef.fn).not.toHaveBeenCalled();
  });

  it("the pre-fpv04 body (attemptId + parent-set password) still keys the rate limit on the attempt id", async () => {
    createChildRef.fn = vi.fn().mockResolvedValue({ ok: true, childId: "child1", username: "dana" });
    await post(validBody(UUID));
    expect(rateRef.checks.some((k) => k.includes(encodeURIComponent(UUID)))).toBe(true);
    // And the absent-attemptId path keys its segment as the literal `self`.
    rateRef.checks = [];
    parentTokenRef.user = { id: "parent-1" };
    resolveRef.fn = vi.fn().mockResolvedValue({ ok: false, reason: "none" });
    await post(fpv04Body);
    expect(rateRef.checks.some((k) => k.endsWith(":self"))).toBe(true);
  });
});
