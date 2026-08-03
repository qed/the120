/**
 * Route-level tests for the /api/fp/site/* gateway discipline, driven through
 * the CLAIM route (the highest-stakes wrapper) plus the self-read: CORS
 * mirror, byte-identical generic 401s, the FP-child gate, the fail-closed
 * feature gate, and the R24 smuggled-identity case end-to-end. Harness per
 * the grade/login route tests: vi.hoisted refs, module-boundary mocks, real
 * Request objects, dynamic route import.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeClient,
  newStore,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";

const { store, authUser, rate } = vi.hoisted(() => ({
  store: { value: {} as Store },
  authUser: { value: null as { id: string } | null },
  rate: { value: { allowed: true } },
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => fakeClient(store.value),
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
vi.mock("@/app/fp/lib/rate-limit-store", () => ({
  checkAndRecordRateLimit: () => ({ allowed: rate.value.allowed }),
  releaseRateLimitEvent: () => {},
  clearRateLimitBucket: () => {},
}));
vi.mock("@/app/lib/email", () => ({
  sendEmail: async () => ({ ok: true }),
}));

const ORIGIN = "https://firstprofit.school";
const PROFILE = "profile-1";
const CHILD = "child-1";

function token(sub: string): string {
  return `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;
}

function seed(): void {
  const s = newStore();
  s.parents = [{ id: "parent-1", email: "p@example.com", first_name: "Pat" }];
  s.children = [{ id: CHILD, parent_id: "parent-1", first_name: "Cedric", fp_username: "cedric" }];
  s.fp_player_profiles = [
    { id: PROFILE, user_id: "user-1", child_id: CHILD, handle: "cedric", children: { fp_username: "cedric" } },
  ];
  s.fp_player_saves = [{ profile_id: PROFILE, revision: 1, doc: { docVersion: 1 } }];
  s.fp_public_sites = [];
  store.value = s;
}

function claimRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/fp/site/claim", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      authorization: `Bearer ${token("user-1")}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function postClaim(body: unknown, headers?: Record<string, string>): Promise<Response> {
  const mod = await import("../claim/route");
  return mod.POST(claimRequest(body, headers));
}

beforeEach(() => {
  seed();
  authUser.value = { id: "user-1" };
  rate.value = { allowed: true };
  vi.stubEnv("FP_SITE_TEST_ONLY", "off");
  vi.stubEnv("FP_SITE_TEST_ALLOWLIST", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("claim route — gateway discipline", () => {
  it("disallowed/missing Origin → bare 403, no CORS allow header", async () => {
    const mod = await import("../claim/route");
    const res = await mod.POST(
      new Request("http://localhost/api/fp/site/claim", { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("missing token, unknown session, non-FP-child, rate-limited, and gated-off all answer the BYTE-IDENTICAL 401", async () => {
    const bodies = new Set<string>();
    const statuses: number[] = [];
    const capture = async (res: Response) => {
      statuses.push(res.status);
      bodies.add(await res.text());
    };

    await capture(await postClaim({ handle: "cedric" }, { authorization: "" }));

    authUser.value = null; // token does not verify
    await capture(await postClaim({ handle: "cedric" }));

    authUser.value = { id: "not-an-fp-child" }; // verifies, no profile row
    await capture(await postClaim({ handle: "cedric" }));

    authUser.value = { id: "user-1" };
    rate.value = { allowed: false };
    await capture(await postClaim({ handle: "cedric" }));

    rate.value = { allowed: true };
    vi.stubEnv("FP_SITE_TEST_ONLY", ""); // fail-closed default: gated
    await capture(await postClaim({ handle: "cedric" }));

    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    expect(bodies.size).toBe(1);
    expect(store.value.fp_public_sites).toHaveLength(0);
  });

  it("the fail-closed gate opens for an allowlisted fp_username while FP_SITE_TEST_ONLY is unset", async () => {
    vi.stubEnv("FP_SITE_TEST_ONLY", "");
    vi.stubEnv("FP_SITE_TEST_ALLOWLIST", "cedric");
    const res = await postClaim({ handle: "cedric" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, handle: "cedric", status: "claimed" });
  });

  it("success: CORS headers + no-store, and the claim binds to the SESSION's profile even when the body smuggles another id (R24)", async () => {
    const res = await postClaim({
      handle: "cedric",
      profile_id: "attacker-profile",
      profileId: "attacker-profile",
      childId: "attacker-child",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(await res.json()).toMatchObject({ ok: true, handle: "cedric" });
    expect(store.value.fp_public_sites[0]).toMatchObject({ profile_id: PROFILE });
  });

  it("designed branches ride 200: taken (with suggestions) and invalid", async () => {
    store.value.fp_public_sites.push({ profile_id: "other", handle: "cedric" });
    const taken = await (await postClaim({ handle: "cedric" })).json();
    expect(taken).toMatchObject({ ok: false, reason: "taken" });
    const invalid = await (await postClaim({ handle: "signup" })).json();
    expect(invalid).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("self-read route — ungated read-back", () => {
  it("answers none while the feature is dark (gate applies to claim/availability/publish only)", async () => {
    vi.stubEnv("FP_SITE_TEST_ONLY", ""); // gated for everyone
    const mod = await import("../route");
    const res = await mod.GET(
      new Request("http://localhost/api/fp/site", {
        method: "GET",
        headers: { origin: ORIGIN, authorization: `Bearer ${token("user-1")}` },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handle: null, status: "none", projected: null });
  });

  it("OPTIONS preflight: 204 with echoed origin and authorization allowed", async () => {
    const mod = await import("../route");
    const res = await mod.OPTIONS(
      new Request("http://localhost/api/fp/site", { method: "OPTIONS", headers: { origin: ORIGIN } })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });
});
