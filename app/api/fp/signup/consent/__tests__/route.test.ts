import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Thin-wrapper coverage for POST/OPTIONS /api/fp/signup/consent (Slice B Unit 9
 * review, FIX 1). recordConsent, the rate-limit store, and the Supabase clients
 * are mocked so we assert only the ROUTE's own wiring: origin gating, the Bearer
 * requirement, the attemptId + accept-echo parse, the recordConsent verdict
 * mapping (incl. duplicate → idempotent success), and that the echoed
 * version/hash reach recordConsent verbatim. No real DB or token is touched.
 */

const { recordConsentRef, getUserRef, rateRef } = vi.hoisted(() => ({
  recordConsentRef: { fn: vi.fn() },
  getUserRef: { fn: vi.fn() },
  rateRef: {
    released: [] as string[],
    checks: [] as string[],
    allowed: true,
  },
}));

vi.mock("@/app/api/fp/signup/consent-core", () => ({
  recordConsent: (...args: unknown[]) => recordConsentRef.fn(...args),
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
vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/app/lib/supabase/parent-token", () => ({
  supabaseParentToken: () => ({ auth: { getUser: (...a: unknown[]) => getUserRef.fn(...a) } }),
}));

const ORIGIN = "http://localhost:5173";
const BAD_ORIGIN = "https://evil.example";
const UUID = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

const validAccept = {
  echoedVersion: "2026-08-01.1",
  echoedHash: HASH,
  method: "email_plus_attestation",
  childAgeBand: "under_13",
  childDob: "2016-04-01",
  jurisdiction: "US-CA",
};

function post(body: unknown, opts: { origin?: string; bearer?: string | null } = {}) {
  const headers: Record<string, string> = {
    origin: opts.origin ?? ORIGIN,
    "content-type": "application/json",
    "user-agent": "vitest",
  };
  if (opts.bearer !== null) headers.authorization = `Bearer ${opts.bearer ?? "parent-access-token"}`;
  const req = new Request("http://localhost/api/fp/signup/consent", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return import("@/app/api/fp/signup/consent/route").then((m) => m.POST(req));
}

function options(origin: string) {
  const req = new Request("http://localhost/api/fp/signup/consent", {
    method: "OPTIONS",
    headers: { origin },
  });
  return import("@/app/api/fp/signup/consent/route").then((m) => m.OPTIONS(req));
}

describe("POST /api/fp/signup/consent (FIX 1: the consent-record seam)", () => {
  beforeEach(() => {
    recordConsentRef.fn = vi.fn().mockResolvedValue({ ok: true, consentId: "consent-1" });
    getUserRef.fn = vi.fn().mockResolvedValue({ data: { user: { id: "parent-1" } }, error: null });
    rateRef.released = [];
    rateRef.checks = [];
    rateRef.allowed = true;
  });
  afterEach(() => vi.resetModules());

  it("OPTIONS: allowed origin → 204 echoing the origin + authorization in allowed headers", async () => {
    const res = await options(ORIGIN);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("OPTIONS: a disallowed origin → 403 with no echoed origin", async () => {
    const res = await options(BAD_ORIGIN);
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("POST from a disallowed origin → 403, recordConsent never called", async () => {
    const res = await post({ attemptId: UUID, ...validAccept }, { origin: BAD_ORIGIN });
    expect(res.status).toBe(403);
    expect(recordConsentRef.fn).not.toHaveBeenCalled();
  });

  it("no Bearer token → generic 401, recordConsent never called, NO strike released", async () => {
    const res = await post({ attemptId: UUID, ...validAccept }, { bearer: null });
    expect(res.status).toBe(401);
    expect(recordConsentRef.fn).not.toHaveBeenCalled();
    expect(rateRef.released).toEqual([]);
  });

  it("a non-UUID attemptId is refused pre-DB: 401, recordConsent never called, NO strike released", async () => {
    const res = await post({ attemptId: "not-a-uuid", ...validAccept });
    expect(res.status).toBe(401);
    expect(recordConsentRef.fn).not.toHaveBeenCalled();
    expect(rateRef.released).toEqual([]);
  });

  it("an unknown extra field is rejected by the STRICT accept parse (401, no record)", async () => {
    const res = await post({ attemptId: UUID, ...validAccept, sneaky: "x" });
    expect(res.status).toBe(401);
    expect(recordConsentRef.fn).not.toHaveBeenCalled();
  });

  it("ok: 200 and the echoed version+hash + parentId reach recordConsent verbatim", async () => {
    const res = await post({ attemptId: UUID, ...validAccept });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "consent_recorded", consentId: "consent-1" });
    expect(recordConsentRef.fn).toHaveBeenCalledTimes(1);
    const arg = recordConsentRef.fn.mock.calls[0][1] as Record<string, unknown>;
    expect(arg.attemptId).toBe(UUID);
    expect(arg.parentId).toBe("parent-1");
    expect(arg.echoedVersion).toBe("2026-08-01.1");
    expect(arg.echoedHash).toBe(HASH);
    expect(arg.childAgeBand).toBe("under_13");
    expect(arg.childDob).toBe("2016-04-01");
    expect(arg.jurisdiction).toBe("US-CA");
  });

  it("duplicate → idempotent 200 success (a retried consent is fine), strike NOT released", async () => {
    recordConsentRef.fn = vi.fn().mockResolvedValue({ ok: false, reason: "duplicate" });
    const res = await post({ attemptId: UUID, ...validAccept });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "consent_recorded" });
    expect(rateRef.released).toEqual([]);
  });

  it("outage → generic 401 AND releases both rate-limit strikes", async () => {
    recordConsentRef.fn = vi.fn().mockResolvedValue({ ok: false, reason: "outage" });
    const res = await post({ attemptId: UUID, ...validAccept });
    expect(res.status).toBe(401);
    expect(rateRef.released.length).toBe(2);
  });

  it.each(["missing", "stale", "version_mismatch", "not_verified", "parent_mismatch"])(
    "%s → generic 401, strike stands (no release)",
    async (reason) => {
      recordConsentRef.fn = vi.fn().mockResolvedValue({ ok: false, reason });
      const res = await post({ attemptId: UUID, ...validAccept });
      expect(res.status).toBe(401);
      expect(rateRef.released).toEqual([]);
    }
  );

  it("a forged/expired token (getUser errors) → generic 401, recordConsent never called", async () => {
    getUserRef.fn = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    const res = await post({ attemptId: UUID, ...validAccept });
    expect(res.status).toBe(401);
    expect(recordConsentRef.fn).not.toHaveBeenCalled();
  });

  it("childDob is optional (omitted → null passed to recordConsent)", async () => {
    const { childDob: _omit, ...noDob } = validAccept;
    void _omit;
    const res = await post({ attemptId: UUID, ...noDob });
    expect(res.status).toBe(200);
    const arg = recordConsentRef.fn.mock.calls[0][1] as Record<string, unknown>;
    expect(arg.childDob).toBeNull();
  });
});
