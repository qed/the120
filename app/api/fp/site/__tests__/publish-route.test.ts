/**
 * Route-level tests for /api/fp/site/publish — the gateway proof for
 * gated:true, the happy publish (email path exercised through the real deps
 * builder with a mocked sendEmail), the locked designed branch, and the
 * structured-200 outage contract. Harness per site-route.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeClient,
  newStore,
  type FaultPlan,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";

const { store, authUser, faults, mail } = vi.hoisted(() => ({
  store: { value: {} as Store },
  authUser: { value: null as { id: string } | null },
  faults: { value: undefined as FaultPlan | undefined },
  mail: { value: [] as { to: string; subject: string }[] },
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
vi.mock("@/app/lib/email", () => ({
  sendEmail: async (input: { to: string; subject: string }) => {
    mail.value.push({ to: input.to, subject: input.subject });
    return { ok: true };
  },
}));

const ORIGIN = "https://firstprofit.school";

function token(sub: string): string {
  return `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;
}

function seed(site: Record<string, unknown> | null): void {
  const s = newStore();
  s.parents = [{ id: "parent-1", email: "p@example.com", first_name: "Pat" }];
  s.children = [{ id: "child-1", parent_id: "parent-1", first_name: "Cedric", fp_username: "cedric" }];
  s.fp_player_profiles = [
    { id: "profile-1", user_id: "user-1", child_id: "child-1", handle: "cedric", children: { fp_username: "cedric" } },
  ];
  s.fp_player_saves = [
    {
      profile_id: "profile-1",
      revision: 1,
      doc: { docVersion: 1, siteHeadline: "Dog walking", ideas: [], activeIdea: 0 },
    },
  ];
  s.fp_public_sites = site
    ? [
        {
          profile_id: "profile-1",
          handle: "cedric",
          first_name: "Cedric",
          headline: "",
          one_liner: "",
          published: false,
          operator_locked: false,
          first_published_at: null,
          ...site,
        },
      ]
    : [];
  store.value = s;
}

async function post(): Promise<Response> {
  const mod = await import("../publish/route");
  return mod.POST(
    new Request("http://localhost/api/fp/site/publish", {
      method: "POST",
      headers: { origin: ORIGIN, authorization: `Bearer ${token("user-1")}` },
    })
  );
}

beforeEach(() => {
  seed({});
  authUser.value = { id: "user-1" };
  faults.value = undefined;
  mail.value = [];
  vi.stubEnv("FP_SITE_TEST_ONLY", "off");
  vi.stubEnv("FP_SITE_TEST_ALLOWLIST", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("publish route", () => {
  it("is FEATURE-GATED (gated:true): fail-closed default answers the generic 401", async () => {
    vi.stubEnv("FP_SITE_TEST_ONLY", "");
    expect((await post()).status).toBe(401);
    expect(mail.value).toHaveLength(0);
  });

  it("happy first publish: 200 {ok, published, firstPublish, parentNotified} + the parent email through the real deps builder", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: "published",
      firstPublish: true,
      parentNotified: true,
    });
    expect(store.value.fp_public_sites[0]).toMatchObject({ published: true, headline: "Dog walking" });
    expect(mail.value).toEqual([
      { to: "p@example.com", subject: "Cedric's First Profit page is now live" },
    ]);
  });

  it("publish while operator-locked: designed 200 branch, no write, no email", async () => {
    seed({ operator_locked: true });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "locked", status: "offline" });
    expect(store.value.fp_public_sites[0]).toMatchObject({ published: false });
    expect(mail.value).toHaveLength(0);
  });

  it("no claim → designed 200 {ok:false, reason:'no-site'}", async () => {
    seed(null);
    expect(await (await post()).json()).toEqual({ ok: false, reason: "no-site" });
  });

  it("a DB outage is the STRUCTURED 200 {ok:false, reason:'outage'} — never the generic 401 (contract item)", async () => {
    faults.value = { "select:fp_public_sites": { kind: "error", error: { message: "down" } } };
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "outage" });
    expect(mail.value).toHaveLength(0);
  });
});
