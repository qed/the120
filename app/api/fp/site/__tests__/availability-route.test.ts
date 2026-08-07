/**
 * Route-level tests for /api/fp/site/availability — the gateway proof for
 * gated:true, the malformed-JSON generic 401, the happy verdicts, and the
 * structured-200 outage contract. Harness per site-route.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeClient,
  newStore,
  type FaultPlan,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";

const { store, authUser, faults } = vi.hoisted(() => ({
  store: { value: {} as Store },
  authUser: { value: null as { id: string } | null },
  faults: { value: undefined as FaultPlan | undefined },
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => fakeClient(store.value, faults.value),
}));
vi.mock("@/app/lib/supabase/parent-token", () => ({
  supabaseParentToken: () => ({
    auth: {
      getUser: async () =>
        authUser.value
          ? { data: { user: authUser.value }, error: null }
          : { data: { user: null }, error: { message: "invalid" } },
    },
  }),
}));
vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: () => ({ allowed: true }),
  releaseRateLimitEvent: () => {},
  clearRateLimitBucket: () => {},
}));

const ORIGIN = "https://firstprofit.school";

function token(sub: string): string {
  return `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;
}

function seed(): void {
  const s = newStore();
  s.children = [{ id: "child-1", parent_id: "parent-1", first_name: "Cedric", fp_username: "cedric" }];
  s.fp_player_profiles = [
    { id: "profile-1", user_id: "user-1", child_id: "child-1", handle: "cedric", children: { fp_username: "cedric" } },
  ];
  s.fp_public_sites = [];
  store.value = s;
}

async function post(body: string): Promise<Response> {
  const mod = await import("../availability/route");
  return mod.POST(
    new Request("http://localhost/api/fp/site/availability", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        authorization: `Bearer ${token("user-1")}`,
      },
      body,
    })
  );
}

beforeEach(() => {
  seed();
  authUser.value = { id: "user-1" };
  faults.value = undefined;
  vi.stubEnv("FP_SITE_TEST_ONLY", "off");
  vi.stubEnv("FP_SITE_TEST_ALLOWLIST", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("availability route", () => {
  it("is FEATURE-GATED (gated:true): fail-closed default answers the generic 401", async () => {
    vi.stubEnv("FP_SITE_TEST_ONLY", "");
    const res = await post(JSON.stringify({ handle: "cedric" }));
    expect(res.status).toBe(401);
  });

  it("malformed JSON → the generic 401 (malformed_request), same body as every refusal", async () => {
    const bad = await post("{not json");
    expect(bad.status).toBe(401);
    const missing = await post(JSON.stringify({}));
    expect(missing.status).toBe(401);
    expect(await bad.text()).toBe(await missing.text());
  });

  it("happy verdicts ride 200: available / yours / taken-with-suggestions / invalid", async () => {
    expect(await (await post(JSON.stringify({ handle: "Cedric" }))).json()).toEqual({
      ok: true,
      verdict: "available",
      suggestions: [],
    });
    store.value.fp_public_sites.push({ profile_id: "profile-1", handle: "cedric" });
    expect(await (await post(JSON.stringify({ handle: "cedric" }))).json()).toMatchObject({
      verdict: "yours",
    });
    store.value.fp_public_sites.push({ profile_id: "other", handle: "maya" });
    const taken = await (await post(JSON.stringify({ handle: "maya" }))).json();
    expect(taken).toMatchObject({ ok: true, verdict: "taken" });
    expect((taken as { suggestions: string[] }).suggestions.length).toBeGreaterThan(0);
    expect(await (await post(JSON.stringify({ handle: "signup" }))).json()).toMatchObject({
      verdict: "invalid",
    });
  });

  it("a DB outage is the STRUCTURED 200 {ok:false, reason:'outage'} — never the generic 401 (contract item)", async () => {
    faults.value = { "select:fp_public_sites": { kind: "error", error: { message: "down" } } };
    const res = await post(JSON.stringify({ handle: "cedric" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "outage" });
  });
});
