import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deriveCodeRequestRateLimitKeys,
  LOGIN_CODE_REQUEST_UNIFORM_BODY,
} from "../../login-code-rules";

/**
 * EXECUTION-LEVEL coverage for POST/OPTIONS /api/fp/login-code/request — real
 * `Request`s driven through the ACTUAL exported handlers, asserting real
 * `Response` status, headers and bytes (the exchange-route.test.ts convention).
 *
 * ── WHY THIS FILE EXISTS ──
 * The core's behaviour is tested by execution in ../../__tests__/login-code-
 * core.test.ts. This file isolates the WIRE: that EVERY outcome answers the ONE
 * uniform 200 (no username-enumeration oracle), that the Origin gate and the
 * limiter run before the core, and — the one that bites — that only an `outage`
 * outcome hands the provisional strikes BACK, on the SAME keys they were
 * recorded on (a release into a bucket nobody is limiting is the classic
 * "wrong key variable" defect).
 *
 * The core, the rate-limit store, the privileged client and the parent-email
 * send are mocked so nothing here reaches a real collaborator.
 */

const requestLoginCode = vi.fn();
const rate = { allowed: true, released: [] as string[], recorded: [] as string[] };

vi.mock("../../login-code-core", () => ({
  requestLoginCode: (...args: unknown[]) => requestLoginCode(...args),
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rate.recorded.push(key);
    return { allowed: rate.allowed };
  },
  releaseRateLimitEvent: (key: string) => rate.released.push(key),
}));

// The route imports both at module load; neither is reached with the core mocked.
vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/app/lib/fp/parent-email/send", () => ({
  sendLoginCodeEmail: async () => ({ status: "sent" }),
}));

const ORIGIN = "https://firstprofit.school";
const IP = "203.0.113.9";
const USERNAME = "remi";
const { usernameKey, ipKey } = deriveCodeRequestRateLimitKeys(IP, USERNAME);

type Init = { origin?: string | null; body?: string; json?: unknown };

async function post(init: Init = {}): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-vercel-forwarded-for": IP,
    "user-agent": "vitest",
  });
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  const req = new Request("http://localhost/api/fp/login-code/request", {
    method: "POST",
    headers,
    body: init.body ?? JSON.stringify(init.json ?? { username: USERNAME }),
  });
  const mod = await import("../route");
  return mod.POST(req);
}

async function options(origin: string | null): Promise<Response> {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  const req = new Request("http://localhost/api/fp/login-code/request", {
    method: "OPTIONS",
    headers,
  });
  const mod = await import("../route");
  return mod.OPTIONS(req);
}

beforeEach(() => {
  requestLoginCode.mockReset();
  requestLoginCode.mockResolvedValue("sent");
  rate.allowed = true;
  rate.released = [];
  rate.recorded = [];
});

/* ------------------------------------------------------ the uniform answer */

describe("POST — every outcome is the same uniform 200", () => {
  it("answers the one uniform body with no-store CORS headers on a good origin", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(LOGIN_CODE_REQUEST_UNIFORM_BODY);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("records BOTH buckets before the core and hands the core the raw body", async () => {
    await post();
    expect(rate.recorded).toEqual([usernameKey, ipKey]);
    const [, body] = requestLoginCode.mock.calls[0];
    expect(body).toEqual({ username: USERNAME });
    expect(rate.released).toEqual([]);
  });

  it.each(["sent", "suppressed", "no_child", "capped", "parent_throttled"] as const)(
    "answers the SAME uniform 200 for the internal outcome %s, and keeps the strike",
    async (outcome) => {
      requestLoginCode.mockResolvedValue(outcome);
      const res = await post();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(LOGIN_CODE_REQUEST_UNIFORM_BODY);
      // None of these are OUR fault — the strike stands.
      expect(rate.released).toEqual([]);
    }
  );
});

/* --------------------------------------------------------------- the origin */

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
    // BEFORE the limiter and before the core: costs nothing, learns nothing.
    expect(rate.recorded).toEqual([]);
    expect(requestLoginCode).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------ free uniform short-circuits */

describe("POST — the FREE uniform answers (no work, still no oracle)", () => {
  it("a rate-limited caller gets the uniform 200 WITHOUT touching the core", async () => {
    rate.allowed = false;
    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(LOGIN_CODE_REQUEST_UNIFORM_BODY);
    expect(requestLoginCode).not.toHaveBeenCalled();
    // A rate-limited request IS a real attempt: the strike stands.
    expect(rate.released).toEqual([]);
  });

  it("a NON-JSON body gets the uniform 200 before any key is recorded", async () => {
    const res = await post({ body: "not json at all {" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(LOGIN_CODE_REQUEST_UNIFORM_BODY);
    expect(rate.recorded).toEqual([]);
    expect(requestLoginCode).not.toHaveBeenCalled();
  });

  it("an unclassifiable username gets the uniform 200 before the limiter or the core", async () => {
    const res = await post({ json: { username: "  " } });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(LOGIN_CODE_REQUEST_UNIFORM_BODY);
    expect(rate.recorded).toEqual([]);
    expect(requestLoginCode).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------- the refund wiring */

describe("POST — only `outage` releases the strike, on the SAME keys it recorded", () => {
  it("releases BOTH provisional strikes for the `outage` outcome", async () => {
    requestLoginCode.mockResolvedValue("outage");
    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(LOGIN_CODE_REQUEST_UNIFORM_BODY);
    // The release lands in the buckets that were recorded — never a stray key.
    expect(rate.released).toEqual([usernameKey, ipKey]);
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
