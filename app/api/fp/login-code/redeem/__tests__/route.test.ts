import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FP_SIGN_IN_REFUSAL_BODY,
  FP_SESSION_BODY_KEYS,
  shapeRefusal as shapeLoginRefusal,
} from "@/app/api/fp/login/login-rules";
import {
  deriveCodeRedeemIpKey,
  deriveCodeRedeemRateLimitKeys,
} from "../../login-code-rules";

/**
 * EXECUTION-LEVEL coverage for POST/OPTIONS /api/fp/login-code/redeem — real
 * `Request`s through the ACTUAL exported handlers (the exchange-route.test.ts
 * convention). The core's behaviour is tested by execution in
 * ../../__tests__/login-code-core.test.ts; this file isolates the WIRE:
 *
 *   - EVERY failure is the same generic 401 (the login route's byte-identical
 *     refusal body) — never a 429, never a distinct shape that would be an
 *     oracle; 403 only for a disallowed Origin;
 *   - the per-IP strike is recorded FIRST, before the body parse, so a
 *     malformed-request flood still burns the per-IP budget (FIX 1);
 *   - only the `outage` reason hands the strikes back, on the SAME keys they
 *     were recorded on; a caller-induced `invalid_code` keeps its strike (a
 *     refunded strike refunds the guesser);
 *   - an unexpected THROW collapses to the same 401 and, deliberately, keeps
 *     the strike (fail closed).
 */

const redeemLoginCode = vi.fn();
const rate = { allowed: true, released: [] as string[], recorded: [] as string[] };

vi.mock("../../login-code-core", () => ({
  redeemLoginCode: (...args: unknown[]) => redeemLoginCode(...args),
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rate.recorded.push(key);
    return { allowed: rate.allowed };
  },
  releaseRateLimitEvent: (key: string) => rate.released.push(key),
}));

// Never construct a real privileged/auth client: neither is reached with the
// core mocked, but the route imports both at module load.
vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

const ORIGIN = "https://firstprofit.school";
const IP = "203.0.113.9";
const USERNAME = "remi";
const IP_KEY = deriveCodeRedeemIpKey(IP);
const { usernameKey: NAME_KEY } = deriveCodeRedeemRateLimitKeys(IP, USERNAME);

const SESSION_BODY = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  profile: { handle: "remi", firstName: "Remi" },
  grade: 5,
  coverStatus: "final",
  coverUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
};

type Init = { origin?: string | null; body?: string; json?: unknown };

async function post(init: Init = {}): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-vercel-forwarded-for": IP,
    "user-agent": "vitest",
  });
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  const req = new Request("http://localhost/api/fp/login-code/redeem", {
    method: "POST",
    headers,
    body: init.body ?? JSON.stringify(init.json ?? { username: USERNAME, code: "123456" }),
  });
  const mod = await import("../route");
  return mod.POST(req);
}

async function options(origin: string | null): Promise<Response> {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  const req = new Request("http://localhost/api/fp/login-code/redeem", {
    method: "OPTIONS",
    headers,
  });
  const mod = await import("../route");
  return mod.OPTIONS(req);
}

beforeEach(() => {
  redeemLoginCode.mockReset();
  redeemLoginCode.mockResolvedValue({ ok: true, body: SESSION_BODY });
  rate.allowed = true;
  rate.released = [];
  rate.recorded = [];
});

/* ------------------------------------------------------------- the grant */

describe("POST — a good origin and a claimable code", () => {
  it("returns 200 with the login-shaped body and the no-store CORS headers", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();

    const parsed = await res.json();
    expect(parsed).toEqual(SESSION_BODY);
    // Derived from the SHARED contract, not restated.
    expect(Object.keys(parsed).sort()).toEqual([...FP_SESSION_BODY_KEYS].sort());
  });

  it("records the per-IP strike FIRST then the (ip,username) strike, and hands the core the attested ctx", async () => {
    await post();

    // FIX 1: the IP bucket is recorded before the body parse; the username
    // bucket after classification. Order is observable and load-bearing.
    expect(rate.recorded).toEqual([IP_KEY, NAME_KEY]);
    const [, body, ctx] = redeemLoginCode.mock.calls[0];
    expect(body).toEqual({ username: USERNAME, code: "123456" });
    expect(ctx).toEqual({ ip: IP, ua: "vitest" });
    expect(rate.released).toEqual([]);
  });
});

/* ------------------------------------------------------------ the origin */

describe("POST — the origin gate runs first and leaks nothing", () => {
  it.each([
    ["missing", null],
    ["foreign", "https://evil.example"],
    ["a suffix impostor", "https://firstprofit.school.evil.example"],
  ])("refuses a %s Origin with a bare 403 and NO allow header", async (_label, origin) => {
    const res = await post({ origin });

    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
    expect(await res.text()).toBe("");
    // BEFORE the limiter and before the core.
    expect(rate.recorded).toEqual([]);
    expect(redeemLoginCode).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------- the one refusal */

describe("POST — every failure is the same 401", () => {
  it("refuses a rate-limited caller with the generic 401, never a 429, without the core", async () => {
    rate.allowed = false;

    const res = await post();

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(FP_SIGN_IN_REFUSAL_BODY);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(redeemLoginCode).not.toHaveBeenCalled();
    // A rate-limited request IS a real attempt: the strike stands.
    expect(rate.released).toEqual([]);
  });

  it("refuses a NON-JSON body before the core — but the per-IP strike is already burned (FIX 1)", async () => {
    const res = await post({ body: "not json at all {" });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(FP_SIGN_IN_REFUSAL_BODY);
    expect(redeemLoginCode).not.toHaveBeenCalled();
    // The IP bucket was recorded BEFORE the parse threw; the username bucket
    // (which needs the classified body) was not. Neither is refunded.
    expect(rate.recorded).toEqual([IP_KEY]);
    expect(rate.released).toEqual([]);
  });

  it("refuses an unclassifiable username generically — IP strike burned, username strike never recorded", async () => {
    const res = await post({ json: { username: "  ", code: "123456" } });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(FP_SIGN_IN_REFUSAL_BODY);
    expect(redeemLoginCode).not.toHaveBeenCalled();
    expect(rate.recorded).toEqual([IP_KEY]);
    expect(rate.released).toEqual([]);
  });

  it("collapses an UNEXPECTED THROW into the same 401 and KEEPS the strike (fail closed)", async () => {
    redeemLoginCode.mockRejectedValue(new Error("kaboom"));

    const res = await post();

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(FP_SIGN_IN_REFUSAL_BODY);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Deliberately NOT released — the outer catch fails closed (unlike settle).
    expect(rate.released).toEqual([]);
  });

  it("speaks the login route's exact bytes and status for a refusal reason", async () => {
    redeemLoginCode.mockResolvedValue({ ok: false, reason: "invalid_code" });

    const res = await post();

    expect(res.status).toBe(shapeLoginRefusal("bad_credentials").status);
    expect(await res.text()).toBe(shapeLoginRefusal("bad_credentials").body);
  });
});

/* --------------------------------------------------------- the refund wiring */

describe("POST — only `outage` releases the strike", () => {
  it.each(["invalid_code", "not_child", "malformed_request", "rate_limited"] as const)(
    "keeps BOTH strikes for the caller-induced reason %s",
    async (reason) => {
      redeemLoginCode.mockResolvedValue({ ok: false, reason });

      const res = await post();

      expect(res.status).toBe(401);
      expect(await res.text()).toBe(FP_SIGN_IN_REFUSAL_BODY);
      // `invalid_code` is what a code-guessing flood produces; refunding it would
      // make guessing free (FIX 1). It — and every non-outage — keeps its strike.
      expect(rate.released).toEqual([]);
    }
  );

  it("releases BOTH strikes — on the SAME keys it recorded — for `outage`", async () => {
    redeemLoginCode.mockResolvedValue({ ok: false, reason: "outage" });

    const res = await post();

    expect(res.status).toBe(401);
    // settle() releases the username key then the ip key.
    expect(rate.released).toEqual([NAME_KEY, IP_KEY]);
    expect(new Set(rate.released)).toEqual(new Set(rate.recorded));
  });
});

/* ----------------------------------------------------------------- OPTIONS */

describe("OPTIONS — the preflight takes the same allowlist", () => {
  it("answers 204 with the POST-only method list for an allowed origin", async () => {
    const res = await options(ORIGIN);

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it.each([
    ["missing", null],
    ["foreign", "https://evil.example"],
  ])("refuses a %s Origin with 403 and no allow header", async (_label, origin) => {
    const res = await options(origin);

    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });
});
