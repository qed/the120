import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FP_SESSION_BODY_KEYS,
  FP_SIGN_IN_REFUSAL_BODY,
  shapeRefusal as shapeLoginRefusal,
} from "@/app/api/fp/login/login-rules";
import { deriveHandoffRateLimitKey } from "../handoff-rules";

/**
 * EXECUTION-LEVEL coverage for POST/OPTIONS /api/fp/handoff/exchange — real
 * `Request`s driven through the ACTUAL exported handlers, asserting real
 * `Response` status, headers and bytes (review FIX 4).
 *
 * ── WHY THIS FILE EXISTS ──
 * ./handoff-rules.test.ts pins the route's ordering by searching its SOURCE for
 * the character positions of `checkOrigin(` and `checkAndRecordRateLimit(`.
 * Those pins are documentation of an intent that no runtime assertion can
 * express — but they are not the guarantee, and they would not have caught:
 *
 *   - `settle()` called with the wrong key variable (the release would land in
 *     a bucket nobody is limiting);
 *   - a non-JSON body taking some path other than the generic refusal;
 *   - a 403 that leaks an `Access-Control-Allow-Origin` header;
 *   - an unexpected throw escaping as Next's error page instead of the one 401;
 *   - the refund allowlist inverted at the CALL SITE while the pure predicate
 *     stays correct.
 *
 * The core and the rate-limit store are mocked the way ./mint-action.test.ts
 * mocks its collaborators, so every assertion here isolates the WIRE. The core's
 * own behaviour is tested by execution in ./handoff-core.test.ts.
 */

const exchangeHandoffCode = vi.fn();
const rate = { allowed: true, released: [] as string[], recorded: [] as string[] };

vi.mock("@/app/api/fp/handoff/handoff-core", () => ({
  exchangeHandoffCode: (...args: unknown[]) => exchangeHandoffCode(...args),
}));

vi.mock("@/app/fp/lib/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rate.recorded.push(key);
    return { allowed: rate.allowed };
  },
  releaseRateLimitEvent: (key: string) => rate.released.push(key),
}));

// Never construct a real privileged client or a real auth client: neither is
// reached with the core mocked, but the route imports both at module load.
vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

const ORIGIN = "https://firstprofit.school";
const IP = "203.0.113.9";
const KEY = deriveHandoffRateLimitKey(IP);

const SESSION_BODY = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  profile: { handle: "remi", firstName: "Remi" },
  grade: 5,
  // The v3 Unit 7 cover fields ride the SAME body. Present here so the wire is
  // pinned against the FULL contract (a route that dropped an optional field
  // while re-serializing would pass a required-keys-only assertion).
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
  const req = new Request("http://localhost/api/fp/handoff/exchange", {
    method: "POST",
    headers,
    body: init.body ?? JSON.stringify(init.json ?? { code: "x".repeat(43) }),
  });
  const mod = await import("../exchange/route");
  return mod.POST(req);
}

async function options(origin: string | null): Promise<Response> {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  const req = new Request("http://localhost/api/fp/handoff/exchange", { method: "OPTIONS", headers });
  const mod = await import("../exchange/route");
  return mod.OPTIONS(req);
}

beforeEach(() => {
  exchangeHandoffCode.mockReset();
  exchangeHandoffCode.mockResolvedValue({ ok: true, body: SESSION_BODY });
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
    // Never `*`, never credentials — session tokens ride this body.
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();

    const parsed = await res.json();
    expect(parsed).toEqual(SESSION_BODY);
    // Derived from the SHARED contract, not restated (review FIX 5).
    expect(Object.keys(parsed).sort()).toEqual([...FP_SESSION_BODY_KEYS].sort());
  });

  it("hands the core the ATTESTED ip and the user-agent as evidence context", async () => {
    await post();

    const [, body, ctx] = exchangeHandoffCode.mock.calls[0];
    expect(body).toEqual({ code: "x".repeat(43) });
    expect(ctx).toEqual({ ip: IP, ua: "vitest" });
    // The limiter was recorded on the SAME derived key — the one `settle` later
    // releases. A mismatch here is the "wrong key variable" defect.
    expect(rate.recorded).toEqual([KEY]);
  });

  it("does not release a strike on success", async () => {
    await post();
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
    // BEFORE the limiter and before the core: an unallowed origin costs nothing
    // and learns nothing.
    expect(rate.recorded).toEqual([]);
    expect(exchangeHandoffCode).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------- the one refusal */

describe("POST — every failure is the same 401", () => {
  it("refuses a rate-limited caller with the generic 401, never a 429, without touching the core", async () => {
    rate.allowed = false;

    const res = await post();

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(FP_SIGN_IN_REFUSAL_BODY);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(exchangeHandoffCode).not.toHaveBeenCalled();
    // A rate-limited request IS a real attempt: the strike stands.
    expect(rate.released).toEqual([]);
  });

  it("refuses a NON-JSON body before the core, and keeps the strike", async () => {
    const res = await post({ body: "not json at all {" });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(FP_SIGN_IN_REFUSAL_BODY);
    // The malformed-request path is reached by the json() throw, not by the
    // core — a source pin could not tell these apart.
    expect(exchangeHandoffCode).not.toHaveBeenCalled();
    expect(rate.released).toEqual([]);
  });

  it("collapses an UNEXPECTED THROW into the same 401 (a different shape is an oracle)", async () => {
    exchangeHandoffCode.mockRejectedValue(new Error("kaboom"));

    const res = await post();

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(FP_SIGN_IN_REFUSAL_BODY);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // An unhandled throw is OUR fault → `outage` → the strike is handed back.
    expect(rate.released).toEqual([KEY]);
  });

  it("speaks the login route's exact bytes and status", async () => {
    exchangeHandoffCode.mockResolvedValue({ ok: false, reason: "invalid_code" });

    const res = await post();

    expect(res.status).toBe(shapeLoginRefusal("bad_credentials").status);
    expect(await res.text()).toBe(shapeLoginRefusal("bad_credentials").body);
  });
});

/* --------------------------------------------------------- the refund wiring */

describe("POST — only `outage` releases the strike", () => {
  it.each(["invalid_code", "not_child", "malformed_request", "rate_limited", "bad_origin"] as const)(
    "keeps the strike for the CALLER-INDUCED reason %s",
    async (reason) => {
      exchangeHandoffCode.mockResolvedValue({ ok: false, reason });

      const res = await post();

      expect(res.status).toBe(401);
      expect(await res.text()).toBe(FP_SIGN_IN_REFUSAL_BODY);
      // The one that matters: `invalid_code` is what a code-guessing flood
      // produces. Refunding it would make guessing free.
      expect(rate.released).toEqual([]);
    }
  );

  it("releases the strike — on the SAME key it recorded — for `outage`", async () => {
    exchangeHandoffCode.mockResolvedValue({ ok: false, reason: "outage" });

    const res = await post();

    expect(res.status).toBe(401);
    expect(rate.released).toEqual([KEY]);
    expect(rate.released).toEqual(rate.recorded);
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
