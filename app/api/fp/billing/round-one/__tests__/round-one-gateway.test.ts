import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUND_ONE_CHECKOUT_RATE_LIMIT,
  ROUND_ONE_ADMIN_RATE_LIMIT,
  ROUND_ONE_REFUSAL_BODY,
  ROUND_ONE_STATUS_IP_RATE_LIMIT,
} from "../round-one-rules";

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const CHILD_USER_ID = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://firstprofit.school";

const refs = vi.hoisted(() => ({
  user: { value: { data: { user: { id: "", email: "" } }, error: null } as unknown },
  parentExists: { value: true },
  childOwner: { value: "" as string | null },
  staff: { value: { role: "admin", is_active: true } as Record<string, unknown> | null },
  childResolution: {
    value: { ok: true, profileId: "profile-1", childId: "", fpUsername: "kid" } as unknown,
  },
  rateAllowed: { value: true },
  rateConfigs: [] as Array<{ windowMs: number; limit: number }>,
  releases: [] as string[],
}));

vi.mock("@/app/lib/supabase/parent-token", () => ({
  supabaseParentToken: () => ({ auth: { getUser: () => Promise.resolve(refs.user.value) } }),
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (_key: string, config: { windowMs: number; limit: number }) => {
    refs.rateConfigs.push(config);
    return { allowed: refs.rateAllowed.value };
  },
  releaseRateLimitEvent: (key: string) => refs.releases.push(key),
}));

vi.mock("@/app/api/fp/site/site-core", () => ({
  resolveFpChild: () => Promise.resolve(refs.childResolution.value),
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => {
            if (table === "parents") {
              return {
                data: refs.parentExists.value ? { id: value } : null,
                error: null,
              };
            }
            if (table === "children") {
              return {
                data: refs.childOwner.value ? { parent_id: refs.childOwner.value } : null,
                error: null,
              };
            }
            if (table === "staff") {
              return { data: refs.staff.value ? { id: value, ...refs.staff.value } : null, error: null };
            }
            throw new Error(`unexpected table ${table}`);
          },
        }),
      }),
    }),
  }),
}));

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;

function request(token: string | null = jwtFor(PARENT_ID), origin = ORIGIN): Request {
  const headers: Record<string, string> = { origin };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/fp/billing/round-one/status", { headers });
}

describe("Round One parent/child gateway", () => {
  beforeEach(() => {
    refs.user.value = {
      data: { user: { id: PARENT_ID, email: "parent@example.com" } },
      error: null,
    };
    refs.parentExists.value = true;
    refs.childOwner.value = PARENT_ID;
    refs.staff.value = { role: "admin", is_active: true };
    refs.childResolution.value = {
      ok: true,
      profileId: "profile-1",
      childId: CHILD_ID,
      fpUsername: "kid",
    };
    refs.rateAllowed.value = true;
    refs.rateConfigs.length = 0;
    refs.releases.length = 0;
  });

  it("answers a strict CORS preflight and refuses foreign origins", async () => {
    const { roundOneOptions } = await import("../round-one-gateway");
    const ok = roundOneOptions(request(null), "GET, OPTIONS");
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-allow-headers")).toBe(
      "authorization, content-type"
    );
    const bad = roundOneOptions(request(null, "https://evil.example"), "GET, OPTIONS");
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("requires a genuine parent row after token verification", async () => {
    const { withRoundOneParent } = await import("../round-one-gateway");
    const handler = vi.fn(async () => Response.json({ ok: true }));
    expect(
      (
        await withRoundOneParent(
          request(null),
          { endpoint: "checkout", limit: ROUND_ONE_CHECKOUT_RATE_LIMIT },
          handler
        )
      ).status
    ).toBe(401);
    refs.parentExists.value = false;
    const res = await withRoundOneParent(
      request(),
      { endpoint: "checkout", limit: ROUND_ONE_CHECKOUT_RATE_LIMIT },
      handler
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(ROUND_ONE_REFUSAL_BODY);
    expect(handler).not.toHaveBeenCalled();
  });

  it("hands the verified parent identity and email to the checkout handler", async () => {
    const { withRoundOneParent } = await import("../round-one-gateway");
    const res = await withRoundOneParent(
      request(),
      { endpoint: "checkout", limit: ROUND_ONE_CHECKOUT_RATE_LIMIT },
      async (ctx) => {
        expect(ctx.parentId).toBe(PARENT_ID);
        expect(ctx.parentEmail).toBe("parent@example.com");
        expect(ctx.origin).toBe(ORIGIN);
        return new Response(JSON.stringify({ ok: true }), { headers: ctx.headers });
      }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("derives child and parent ids from a verified child session, not request input", async () => {
    const { withRoundOneChild } = await import("../round-one-gateway");
    refs.user.value = {
      data: { user: { id: CHILD_USER_ID, email: "kid@firstprofit.school" } },
      error: null,
    };
    const handler = vi.fn(async (ctx: { childId: string; parentId: string }) => {
      expect(ctx.childId).toBe(CHILD_ID);
      expect(ctx.parentId).toBe(PARENT_ID);
      return Response.json({ ok: true });
    });
    const res = await withRoundOneChild(request(jwtFor(CHILD_USER_ID)), handler as never);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("refuses an authenticated principal with no FP child profile", async () => {
    const { withRoundOneChild } = await import("../round-one-gateway");
    refs.user.value = {
      data: { user: { id: CHILD_USER_ID, email: "x@example.com" } },
      error: null,
    };
    refs.childResolution.value = { ok: false, reason: "not_child" };
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const res = await withRoundOneChild(request(jwtFor(CHILD_USER_ID)), handler);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rate-limits before token/database work using the same generic refusal", async () => {
    const { withRoundOneParent } = await import("../round-one-gateway");
    refs.rateAllowed.value = false;
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const res = await withRoundOneParent(
      request(),
      { endpoint: "checkout", limit: ROUND_ONE_CHECKOUT_RATE_LIMIT },
      handler
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(ROUND_ONE_REFUSAL_BODY);
    expect(handler).not.toHaveBeenCalled();
  });

  it("gives read-only status checks shared venue headroom without loosening checkout", async () => {
    const { withRoundOneChild, withRoundOneParent } = await import("../round-one-gateway");
    await withRoundOneParent(
      request(),
      { endpoint: "checkout", limit: ROUND_ONE_CHECKOUT_RATE_LIMIT },
      async () => Response.json({ ok: true })
    );
    expect(refs.rateConfigs.at(-1)).not.toEqual(ROUND_ONE_STATUS_IP_RATE_LIMIT);

    refs.rateConfigs.length = 0;
    await withRoundOneParent(
      request(),
      { endpoint: "status", limit: ROUND_ONE_STATUS_IP_RATE_LIMIT },
      async () => Response.json({ ok: true })
    );
    expect(refs.rateConfigs.at(-1)).toEqual(ROUND_ONE_STATUS_IP_RATE_LIMIT);

    refs.rateConfigs.length = 0;
    refs.user.value = {
      data: { user: { id: CHILD_USER_ID, email: "kid@firstprofit.school" } },
      error: null,
    };
    await withRoundOneChild(
      request(jwtFor(CHILD_USER_ID)),
      async () => Response.json({ ok: true })
    );
    expect(refs.rateConfigs.at(-1)).toEqual(ROUND_ONE_STATUS_IP_RATE_LIMIT);
  });

  it("requires both the admin claim and a current active admin staff row", async () => {
    const { withRoundOneStaff } = await import("../round-one-gateway");
    const handler = vi.fn(async (ctx: { staffId: string }) => {
      expect(ctx.staffId).toBe(PARENT_ID);
      return Response.json({ ok: true });
    });
    refs.user.value = {
      data: {
        user: {
          id: PARENT_ID,
          email: "staff@example.com",
          app_metadata: { role: "admin" },
        },
      },
      error: null,
    };
    expect(
      (
        await withRoundOneStaff(
          request(),
          { limit: ROUND_ONE_ADMIN_RATE_LIMIT },
          handler as never
        )
      ).status
    ).toBe(200);
    expect(handler).toHaveBeenCalledOnce();

    handler.mockClear();
    refs.staff.value = { role: "admin", is_active: false };
    expect(
      (
        await withRoundOneStaff(
          request(),
          { limit: ROUND_ONE_ADMIN_RATE_LIMIT },
          handler as never
        )
      ).status
    ).toBe(401);
    expect(handler).not.toHaveBeenCalled();

    refs.staff.value = { role: "admin", is_active: true };
    refs.user.value = {
      data: { user: { id: PARENT_ID, app_metadata: { role: "parent" } } },
      error: null,
    };
    expect(
      (
        await withRoundOneStaff(
          request(),
          { limit: ROUND_ONE_ADMIN_RATE_LIMIT },
          handler as never
        )
      ).status
    ).toBe(401);
  });
});
