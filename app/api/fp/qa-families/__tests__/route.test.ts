import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  fakeClient,
  type FaultPlan,
  type RecordedCall,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";

type GetUser = Mock<() => Promise<unknown>>;
const { store, faults, tokenRef, rateRef, calls } = vi.hoisted(() => ({
  store: { value: {} as Store },
  faults: { value: {} as FaultPlan },
  tokenRef: { getUser: vi.fn() as unknown as GetUser },
  rateRef: { allowed: true, released: [] as string[], keys: [] as string[] },
  calls: [] as RecordedCall[],
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => fakeClient(store.value, faults.value, { recordCalls: calls }),
}));
vi.mock("@/app/lib/supabase/parent-token", () => ({
  supabaseParentToken: () => ({ auth: { getUser: () => tokenRef.getUser() } }),
}));
vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rateRef.keys.push(key);
    return { allowed: rateRef.allowed };
  },
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
}));

const ORIGIN = "http://localhost:5173";
const STAFF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARENT_A = "11111111-1111-4111-8111-111111111111";
const PARENT_B = "22222222-2222-4222-8222-222222222222";
const REV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const REV_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const WHEN_A = "2026-09-01T12:00:00.000Z";
const WHEN_B = "2026-09-02T12:00:00.000Z";
const TOKEN = `${Buffer.from("{}").toString("base64url")}.${Buffer.from(
  JSON.stringify({ sub: STAFF_ID })
).toString("base64url")}.sig`;

function seed(): void {
  store.value = {
    staff: [{ id: STAFF_ID, role: "admin", is_active: true }],
    parents: [
      { id: PARENT_A, first_name: "Test", last_name: "Parent 1234", email: "secret-a" },
      { id: PARENT_B, first_name: "Real", last_name: "Family", phone: "secret-b" },
    ],
    children: [
      {
        id: "kid-a",
        parent_id: PARENT_A,
        first_name: "Test",
        last_name: "Kid",
        fp_username: "qa-kid",
      },
      {
        id: "kid-b",
        parent_id: PARENT_B,
        first_name: "Real",
        last_name: "Kid",
        fp_username: "real-kid",
      },
      { id: "not-enrolled", parent_id: PARENT_A, fp_username: null },
    ],
    fp_watchtower_family_scope: [
      {
        parent_id: PARENT_A,
        excluded_from_analytics: false,
        created_by: STAFF_ID,
        updated_by: STAFF_ID,
        revision: REV_A,
        updated_at: WHEN_A,
      },
      {
        parent_id: PARENT_B,
        excluded_from_analytics: true,
        created_by: STAFF_ID,
        updated_by: STAFF_ID,
        revision: REV_B,
        updated_at: WHEN_B,
      },
    ],
  };
}

const user = (role = "admin") => ({
  data: { user: { id: STAFF_ID, app_metadata: { role } } },
  error: null,
});

function request(method: "GET" | "POST", body?: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://localhost/api/fp/qa-families", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/fp/qa-families", () => {
  beforeEach(() => {
    vi.resetModules();
    seed();
    faults.value = {};
    calls.length = 0;
    rateRef.allowed = true;
    rateRef.released = [];
    rateRef.keys = [];
    tokenRef.getUser.mockReset();
    tokenRef.getUser.mockResolvedValue(user());
  });

  it("GET returns the exact privacy-minimal family/scope contract", async () => {
    const { GET } = await import("../route");
    const res = await GET(request("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      families: [
        {
          parentId: PARENT_A,
          parentName: "Test Parent 1234",
          childUsernames: ["qa-kid"],
          heuristicSuggested: true,
          excludedFromAnalytics: false,
          updatedAt: WHEN_A,
        },
        {
          parentId: PARENT_B,
          parentName: "Real Family",
          childUsernames: ["real-kid"],
          heuristicSuggested: false,
          excludedFromAnalytics: true,
          updatedAt: WHEN_B,
        },
      ],
      scope: {
        revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        includedFamilies: 1,
        excludedFamilies: 1,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/secret-a|secret-b|email|phone/i);
    expect(calls.find((call) => call.table === "parents")?.columns).toBe(
      "id, first_name, last_name"
    );
    expect(calls.find((call) => call.table === "children")?.columns).toBe(
      "id, parent_id, first_name, last_name, fp_username"
    );
    expect(calls.some((call) => call.op !== "select")).toBe(false);
  });

  it("POST is the only write path and returns the updated exact contract", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      request("POST", { parentId: PARENT_A, excludedFromAnalytics: true })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.family).toMatchObject({
      parentId: PARENT_A,
      excludedFromAnalytics: true,
      heuristicSuggested: true,
    });
    expect(body.scope).toMatchObject({ includedFamilies: 0, excludedFamilies: 2 });
    expect(store.value.fp_watchtower_family_scope?.find((row) => row.parent_id === PARENT_A)).toMatchObject({
      excluded_from_analytics: true,
      created_by: STAFF_ID,
      updated_by: STAFF_ID,
    });
    expect(calls.filter((call) => call.table === "fp_watchtower_family_scope" && call.op === "upsert")).toHaveLength(1);
  });

  it("rejects malformed/extra-key POSTs after auth without writing", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      request("POST", {
        parentId: PARENT_A,
        excludedFromAnalytics: true,
        email: "must-not-be-accepted",
      })
    );
    expect(res.status).toBe(400);
    expect(calls.some((call) => call.op === "upsert")).toBe(false);
    expect(rateRef.released).toHaveLength(2);
  });

  it("refuses a valid-looking but unenrolled parent id", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      request("POST", {
        parentId: "33333333-3333-4333-8333-333333333333",
        excludedFromAnalytics: true,
      })
    );
    expect(res.status).toBe(400);
    expect(calls.some((call) => call.op === "upsert")).toBe(false);
  });

  it("uses the same two-half staff refusal posture", async () => {
    const { GET } = await import("../route");
    const missing = await GET(request("GET", undefined, null));
    tokenRef.getUser.mockResolvedValue(user("parent"));
    const wrongClaim = await GET(request("GET"));
    tokenRef.getUser.mockResolvedValue(user());
    store.value.staff = [{ id: STAFF_ID, role: "admin", is_active: false }];
    const inactiveRow = await GET(request("GET"));
    expect([missing.status, wrongClaim.status, inactiveRow.status]).toEqual([401, 401, 401]);
    const bodies = await Promise.all([missing.text(), wrongClaim.text(), inactiveRow.text()]);
    expect(new Set(bodies).size).toBe(1);
  });

  it("checks both rate buckets before token/database I/O", async () => {
    rateRef.allowed = false;
    const { GET } = await import("../route");
    const res = await GET(request("GET"));
    expect(res.status).toBe(401);
    expect(rateRef.keys).toHaveLength(2);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("refunds strikes on a database outage", async () => {
    faults.value["select:fp_watchtower_family_scope"] = {
      kind: "error",
      error: { message: "offline" },
    };
    const { GET } = await import("../route");
    expect((await GET(request("GET"))).status).toBe(401);
    expect(rateRef.released).toHaveLength(2);
  });

  it("rejects bad origins before auth and has a strict preflight", async () => {
    const { GET, OPTIONS } = await import("../route");
    const bad = await GET(
      new Request("http://localhost/api/fp/qa-families", {
        headers: { origin: "https://evil.example", authorization: `Bearer ${TOKEN}` },
      })
    );
    expect(bad.status).toBe(403);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
    const preflight = await OPTIONS(
      new Request("http://localhost/api/fp/qa-families", {
        method: "OPTIONS",
        headers: { origin: ORIGIN },
      })
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, OPTIONS"
    );
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "authorization, content-type"
    );
  });
});
