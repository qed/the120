import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  fakeClient,
  type FaultPlan,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";

/**
 * Route-level coverage for GET /api/fp/suggestions — the staff-only feedback
 * listing (Change #9). Asserts the wiring the pure rules cannot: the TWO-half
 * staff gate (JWT claim AND active staff row, requireStaff's shape), the
 * byte-identical refusal for a genuine NON-STAFF authenticated principal (a
 * child session must not learn this endpoint exists), the newest-first capped
 * listing with the fp_username join, and outage handling with strike release.
 * Mirrors the grade route's test anatomy: fake-supabase for the service-role
 * client, mocked token client + rate-limit store.
 */

type GetUserFn = Mock<() => Promise<unknown>>;

const { store, faults, tokenRef, rateRef } = vi.hoisted(() => ({
  store: { value: {} as Store },
  faults: { value: {} as FaultPlan },
  tokenRef: { getUser: vi.fn() as unknown as GetUserFn },
  rateRef: { allowed: true, released: [] as string[] },
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => fakeClient(store.value, faults.value),
}));

vi.mock("@/app/lib/supabase/parent-token", () => ({
  supabaseParentToken: () => ({ auth: { getUser: () => tokenRef.getUser() } }),
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: () => ({ allowed: rateRef.allowed }),
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
}));

const ORIGIN = "http://localhost:5173";
const STAFF_ID = "staff-peter-1";

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;
const TOKEN = jwtFor(STAFF_ID);

/** A verified session with a given app_metadata.role (or none). */
const sessionUser = (id: string, role?: string) => ({
  data: { user: { id, app_metadata: role === undefined ? {} : { role } } },
  error: null,
});

function seed(): void {
  store.value = {
    staff: [{ id: STAFF_ID, email: "peter@the120.school", role: "admin", is_active: true }],
    fp_task_feedback: [
      {
        id: "f-old",
        profile_id: "p-1",
        kind: "task",
        task_id: "1.1.1",
        band: "g3_5",
        body: "older stuck report",
        created_at: "2026-08-01T10:00:00Z",
      },
      {
        id: "f-new",
        profile_id: "p-2",
        kind: "app",
        task_id: "2.3.4",
        band: "g6_8",
        body: "I wish the game had pets",
        created_at: "2026-08-03T10:00:00Z",
      },
    ],
    fp_player_profiles: [
      { id: "p-1", handle: "alexh", child_id: "c-1", user_id: "u-1" },
      { id: "p-2", handle: "brih", child_id: "c-2", user_id: "u-2" },
    ],
    children: [
      { id: "c-1", fp_username: "alex.fp" },
      { id: "c-2", fp_username: null }, // pre-backfill → handle fallback
    ],
  } as Store;
}

const get = (opts?: { origin?: string; token?: string | null }) => {
  const headers: Record<string, string> = { origin: opts?.origin ?? ORIGIN };
  const token = opts?.token === undefined ? TOKEN : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const req = new Request("http://localhost/api/fp/suggestions", { method: "GET", headers });
  return import("@/app/api/fp/suggestions/route").then((m) => m.GET(req));
};

describe("GET /api/fp/suggestions — staff-only feedback listing (Change #9)", () => {
  beforeEach(() => {
    seed();
    faults.value = {};
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue(sessionUser(STAFF_ID, "admin")) as unknown as GetUserFn;
    rateRef.allowed = true;
    rateRef.released = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("lists suggestions newest first with the contract shape and the fp_username join", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      suggestions: [
        {
          id: "f-new",
          kind: "app",
          taskId: "2.3.4",
          username: "brih", // fp_username null → handle fallback
          body: "I wish the game had pets",
          createdAt: "2026-08-03T10:00:00Z",
        },
        {
          id: "f-old",
          kind: "task",
          taskId: "1.1.1",
          username: "alex.fp",
          body: "older stuck report",
          createdAt: "2026-08-01T10:00:00Z",
        },
      ],
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("a pre-migration row without a kind column reads as 'task'", async () => {
    delete (store.value.fp_task_feedback[0] as Record<string, unknown>).kind;
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: { id: string; kind: string }[] };
    expect(body.suggestions.find((s) => s.id === "f-old")!.kind).toBe("task");
  });

  it("caps the listing at 200 rows, newest first", async () => {
    store.value.fp_task_feedback = Array.from({ length: 250 }, (_, i) => ({
      id: `f-${i}`,
      profile_id: "p-1",
      kind: "task",
      task_id: "1.1.1",
      band: "g3_5",
      body: "",
      // Lexicographically ordered ISO stamps: higher i = newer.
      created_at: `2026-07-01T00:00:00.${String(i).padStart(3, "0")}Z`,
    }));
    const res = await get();
    const body = (await res.json()) as { suggestions: { id: string }[] };
    expect(body.suggestions).toHaveLength(200);
    expect(body.suggestions[0]!.id).toBe("f-249"); // newest survives the cap
    expect(body.suggestions.at(-1)!.id).toBe("f-50"); // oldest 50 trimmed
  });

  it("an empty table answers {ok, suggestions: []} without profile/children round trips", async () => {
    store.value.fp_task_feedback = [];
    faults.value["select:fp_player_profiles"] = { kind: "error", error: { message: "must not run" } };
    faults.value["select:children"] = { kind: "error", error: { message: "must not run" } };
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, suggestions: [] });
  });

  // ── The staff gate ──

  it("a GENUINE authenticated NON-STAFF principal (a child session: no admin claim) is refused byte-identically to a forged token", async () => {
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue(sessionUser("child-user-7")) as unknown as GetUserFn;
    const asChild = await get();
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: { status: 401 } }) as unknown as GetUserFn;
    const asForged = await get();
    expect(asChild.status).toBe(401);
    expect(asForged.status).toBe(401);
    expect(await asChild.text()).toBe(await asForged.text());
    // Strikes stand for both — a real refusal, not an outage.
    expect(rateRef.released).toEqual([]);
  });

  it("a non-allowed claim role value is refused (role vocabulary enforced at the claim half)", async () => {
    for (const role of ["", "guide", "parent", "ADMIN", "super_admin", "staff"]) {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(STAFF_ID, role)) as unknown as GetUserFn;
      const res = await get();
      expect(res.status, role).toBe(401);
    }
  });

  it("an admin claim WITHOUT a staff row is refused — the row half is load-bearing", async () => {
    store.value.staff = [];
    const res = await get();
    expect(res.status).toBe(401);
    expect(rateRef.released).toEqual([]);
  });

  it("a revoked (is_active=false) staff row is refused — revocation needs no token expiry", async () => {
    store.value.staff[0]!.is_active = false;
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("a staff row whose role is outside the allowed set is refused (vocabulary enforced at the row half)", async () => {
    store.value.staff[0]!.role = "intern";
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("all refusal flavors produce ONE byte-identical 401 body", async () => {
    const responses: Response[] = [];
    responses.push(await get({ token: null })); // missing token
    responses.push(await get({ token: "not-a-jwt" })); // undecodable
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue(sessionUser("someone-else")) as unknown as GetUserFn;
    responses.push(await get()); // authenticated non-staff
    rateRef.allowed = false;
    responses.push(await get()); // rate limited
    const bodies = await Promise.all(responses.map((r) => r.text()));
    for (const r of responses) expect(r.status).toBe(401);
    for (const b of bodies) expect(b).toBe(bodies[0]);
  });

  // ── Refusal plumbing ──

  it("missing and undecodable tokens refuse pre-DB — the token is never verified", async () => {
    expect((await get({ token: null })).status).toBe(401);
    expect((await get({ token: "garbage" })).status).toBe(401);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
  });

  it("a saturated bucket refuses generically BEFORE any DB I/O", async () => {
    rateRef.allowed = false;
    const res = await get();
    expect(res.status).toBe(401);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
  });

  it("a token-verification network throw is an outage — strikes released, generic 401", async () => {
    tokenRef.getUser = vi.fn().mockRejectedValue(new Error("fetch failed")) as unknown as GetUserFn;
    const res = await get();
    expect(res.status).toBe(401);
    expect(rateRef.released.length).toBeGreaterThan(0);
  });

  it("a staff-row lookup error is an outage — generic 401, strikes released", async () => {
    faults.value["select:staff"] = { kind: "error", error: { message: "connection reset" } };
    const res = await get();
    expect(res.status).toBe(401);
    expect(rateRef.released.length).toBeGreaterThan(0);
  });

  it("a feedback query error is an outage — generic 401, strikes released", async () => {
    faults.value["select:fp_task_feedback"] = { kind: "error", error: { message: "timeout" } };
    const res = await get();
    expect(res.status).toBe(401);
    expect(rateRef.released.length).toBeGreaterThan(0);
  });

  it("a join-lookup error (profiles or children) is an outage — never a partial answer", async () => {
    faults.value["select:fp_player_profiles"] = { kind: "error", error: { message: "boom" } };
    expect((await get()).status).toBe(401);
    faults.value = { "select:children": { kind: "error", error: { message: "boom" } } };
    expect((await get()).status).toBe(401);
  });

  it("a broken join (orphaned profile) still ships the row with username null", async () => {
    store.value.fp_player_profiles = store.value.fp_player_profiles.filter((p) => p.id !== "p-2");
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: { id: string; username: string | null }[] };
    expect(body.suggestions.find((s) => s.id === "f-new")!.username).toBeNull();
    expect(body.suggestions.find((s) => s.id === "f-old")!.username).toBe("alex.fp");
  });

  // ── CORS ──

  it("a disallowed Origin is 403 (the one non-401 refusal), before anything runs", async () => {
    const res = await get({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
  });

  it("OPTIONS preflight: 204 for an allowed origin, GET + authorization allowed; 403 otherwise", async () => {
    const req = new Request("http://localhost/api/fp/suggestions", {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    });
    const res = await import("@/app/api/fp/suggestions/route").then((m) => m.OPTIONS(req));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = new Request("http://localhost/api/fp/suggestions", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect(
      (await import("@/app/api/fp/suggestions/route").then((m) => m.OPTIONS(bad))).status
    ).toBe(403);
  });
});
