// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FP_CONSENT_POLICY,
  currentPolicyHash,
  CONSENT_METHODS,
} from "../../consent-rules";

/**
 * GET /api/fp/signup/consent-policy — the read-only rendered-policy surface the
 * SPA fetches before showing the consent step. CORS-mirrors /api/fp/login: a
 * disallowed Origin is a 403 with no body; an allowed Origin echoes back the
 * version + hash the server currently records so the client binds to it.
 */

const ORIGIN = "http://localhost:5173";

afterEach(() => vi.resetModules());

const get = (origin?: string) => {
  const req = new Request("http://localhost/api/fp/signup/consent-policy", {
    method: "GET",
    headers: origin ? { origin } : {},
  });
  return import("../route").then((m) => m.GET(req));
};

const options = (origin?: string) => {
  const req = new Request("http://localhost/api/fp/signup/consent-policy", {
    method: "OPTIONS",
    headers: origin ? { origin } : {},
  });
  return import("../route").then((m) => m.OPTIONS(req));
};

describe("GET /api/fp/signup/consent-policy", () => {
  it("returns the rendered policy (version + text + current hash + method + namespace) to an allowed origin", async () => {
    const res = await get(ORIGIN);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.namespace).toBe("fp_parental_consent");
    expect(body.version).toBe(FP_CONSENT_POLICY.version);
    expect(body.text).toBe(FP_CONSENT_POLICY.text);
    // The hash the client echoes back must be exactly the server's current hash.
    expect(body.hash).toBe(currentPolicyHash());
    expect(body.method).toBe(CONSENT_METHODS[0]);
  });

  it("refuses a disallowed Origin with a 403 and no body", async () => {
    const res = await get("https://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await res.text()).toBe("");
  });

  it("answers OPTIONS preflight for an allowed origin with 204 + GET in the allowed methods", async () => {
    const res = await options(ORIGIN);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("refuses OPTIONS from a disallowed origin with 403", async () => {
    const res = await options("https://evil.example");
    expect(res.status).toBe(403);
  });
});
