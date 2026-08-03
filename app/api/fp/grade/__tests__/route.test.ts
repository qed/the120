import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  fakeClient,
  type FaultPlan,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";

/**
 * Route-level coverage for POST /api/fp/grade — the ask-once birth-year
 * capture (Unit 3). Asserts the wiring the pure rules cannot: the roster row
 * is resolved SERVER-SIDE from the session identity only (the service-role
 * write's sole IDOR guard), the FILL-ONLY provenance guard (a set
 * birth_year/grade is roster truth — never overwritten), the targeted
 * children write lands both columns, DB faults collapse to the generic 401
 * with strikes released, and every refusal is the one byte-identical 401.
 * The service-role client is the in-memory fake-supabase (with fault
 * injection); the token client (auth.getUser) and the rate-limit store are
 * mocked so each assertion isolates the route's own behavior. Mirrors the
 * login route's test anatomy.
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

// The token-bound client: only auth.getUser is exercised by this route.
vi.mock("@/app/lib/supabase/parent-token", () => ({
  supabaseParentToken: () => ({ auth: { getUser: () => tokenRef.getUser() } }),
}));

vi.mock("@/app/fp/lib/rate-limit-store", () => ({
  checkAndRecordRateLimit: () => ({ allowed: rateRef.allowed }),
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
}));

const ORIGIN = "http://localhost:5173";
const USER_ID = "user-alex-1";
const CHILD_ID = "aaaaaaaa-1111-4111-8111-000000000001";

/** An unverified-decodable JWT whose sub feeds the rate-limit bucket segment. */
const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;
const TOKEN = jwtFor(USER_ID);

function seedChild(): void {
  store.value = {
    path_student_profiles: [{ id: "prof-1", user_id: USER_ID, child_id: CHILD_ID }],
    children: [{ id: CHILD_ID, first_name: "Alex", birth_year: "", grade: null }],
  } as Store;
}

const childRow = () => store.value.children[0];

const post = (body: unknown, opts?: { origin?: string; token?: string | null }) => {
  const headers: Record<string, string> = {
    origin: opts?.origin ?? ORIGIN,
    "content-type": "application/json",
  };
  const token = opts?.token === undefined ? TOKEN : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const req = new Request("http://localhost/api/fp/grade", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return import("@/app/api/fp/grade/route").then((m) => m.POST(req));
};

describe("POST /api/fp/grade — ask-once birth-year capture (Unit 3)", () => {
  beforeEach(() => {
    seedChild();
    faults.value = {};
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) as unknown as GetUserFn;
    rateRef.allowed = true;
    rateRef.released = [];
    // Pin the clock inside school year 2026-27 so the derived grades are
    // deterministic: birth year 2013 → grade 8, plausible window 2018..2009.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, 12, 0, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("accepts a plausible birth year: writes birth_year (string form) + derived grade, returns {ok, grade}", async () => {
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, grade: 8 });
    // The roster write is the string-form column format plus the derived int.
    expect(childRow().birth_year).toBe("2013");
    expect(childRow().grade).toBe(8);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("resolves the roster row from the SESSION identity only — childId/child_id keys in the body are inert", async () => {
    // A second child the session does NOT own; spoofed childId / child_id keys
    // are stripped by the schema and can never redirect the write.
    const OTHER = "bbbbbbbb-2222-4222-8222-000000000002";
    store.value.children.push({ id: OTHER, first_name: "Mallory", birth_year: "", grade: null });
    const res = await post({ birthYear: 2013, childId: OTHER, child_id: OTHER });
    expect(res.status).toBe(200);
    expect(childRow().birth_year).toBe("2013"); // the session's own child
    expect(childRow().grade).toBe(8);
    expect(store.value.children[1].birth_year).toBe(""); // the other child untouched
    expect(store.value.children[1].grade).toBeNull();
  });

  it("refuses an implausible birth year (derived grade <3 or >12) generically — nothing written", async () => {
    for (const birthYear of [2019 /* grade 2 */, 2008 /* grade 13 */, 1990, 2025]) {
      const res = await post({ birthYear });
      expect(res.status).toBe(401);
    }
    expect(childRow().birth_year).toBe("");
    expect(childRow().grade).toBeNull();
    // Pre-DB pure refusal: the token is never even verified.
    expect(tokenRef.getUser).not.toHaveBeenCalled();
  });

  it("missing auth, malformed body, and implausible year all collapse to ONE byte-identical 401", async () => {
    const missingAuth = await post({ birthYear: 2013 }, { token: null });
    const malformed = await post({ birthYear: "2013" });
    const notJson = await post("{nope");
    const implausible = await post({ birthYear: 2019 });
    const bodies = await Promise.all(
      [missingAuth, malformed, notJson, implausible].map((r) => r.text())
    );
    for (const res of [missingAuth, malformed, notJson, implausible]) expect(res.status).toBe(401);
    for (const b of bodies) expect(b).toBe(bodies[0]);
    expect(childRow().birth_year).toBe("");
  });

  it("an undecodable token refuses pre-DB (it can never verify) — same generic 401", async () => {
    const res = await post({ birthYear: 2013 }, { token: "not-a-jwt" });
    expect(res.status).toBe(401);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
    expect(childRow().birth_year).toBe("");
  });

  it("an invalid/expired token refuses generically; the strike stands (a real failed attempt)", async () => {
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: { status: 401 } }) as unknown as GetUserFn;
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(401);
    expect(rateRef.released).toEqual([]);
    expect(childRow().birth_year).toBe("");
  });

  it("a token-verification network throw is an outage — strikes released, generic 401", async () => {
    tokenRef.getUser = vi
      .fn()
      .mockRejectedValue(new Error("fetch failed")) as unknown as GetUserFn;
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(401);
    expect(rateRef.released.length).toBeGreaterThan(0);
    expect(childRow().birth_year).toBe("");
  });

  it("a genuine session that maps to NO child row refuses generically — nothing written", async () => {
    store.value.path_student_profiles = [];
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(401);
    expect(childRow().birth_year).toBe("");
    // Not-child is a refusal, not an outage: the strike stands.
    expect(rateRef.released).toEqual([]);
  });

  it("a parent-session token (genuine, but no path_student_profiles row) refuses generically", async () => {
    // The parent's JWT verifies fine — but the child gate finds no mapping,
    // so this surface refuses: it is for children only. Strike stands.
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: "parent-user-9" } }, error: null }) as unknown as GetUserFn;
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(401);
    expect(childRow().birth_year).toBe("");
    expect(childRow().grade).toBeNull();
    expect(rateRef.released).toEqual([]);
  });

  it("a roster-gate select error is an outage — generic 401, strikes released", async () => {
    faults.value["select:path_student_profiles"] = {
      kind: "error",
      error: { message: "connection reset" },
    };
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(401);
    expect(rateRef.released.length).toBeGreaterThan(0);
    expect(childRow().birth_year).toBe("");
  });

  it("a children update error is an outage — generic 401, strikes released, nothing stored", async () => {
    faults.value["update:children"] = { kind: "error", error: { message: "deadlock detected" } };
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(401);
    expect(rateRef.released.length).toBeGreaterThan(0);
    expect(childRow().birth_year).toBe("");
    expect(childRow().grade).toBeNull();
  });

  it("an update that returns no row (row vanished mid-request) is a data fault — generic 401", async () => {
    faults.value["update:children"] = { kind: "no-rows" };
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(401);
    expect(childRow().birth_year).toBe("");
  });

  it("an echo mismatch (a trigger coerced the write) still returns ok — with a VALUE-FREE warn", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    faults.value["update:children"] = { kind: "coerce", values: { birth_year: "2014", grade: 7 } };
    const res = await post({ birthYear: 2013 });
    // Coerce-not-raise: the statement landed, the roster keeps its authority,
    // the client's band is display-only — still 200 ok.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, grade: 8 });
    const logged = logSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).toMatch(/coerced/);
    // VALUE-FREE: neither the requested nor the stored birth year / grade leaks.
    for (const secret of ["2013", "2014", "grade 8", "grade 7", ": 8", ": 7"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("FILL-ONLY: a pre-set grade is roster truth — no write, the EXISTING derived grade returns", async () => {
    childRow().grade = 4;
    // If the route attempted any children update, this fault would 401 it —
    // the 200 below proves the write path never ran.
    faults.value["update:children"] = { kind: "error", error: { message: "must not run" } };
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, grade: 4 }); // stored grade, not the requested 8
    expect(childRow().birth_year).toBe("");
    expect(childRow().grade).toBe(4);
  });

  it("FILL-ONLY: a pre-set birth_year is roster truth — no write, derived from the EXISTING year", async () => {
    childRow().birth_year = "2015"; // derives grade 6 in school year 2026-27
    faults.value["update:children"] = { kind: "error", error: { message: "must not run" } };
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, grade: 6 }); // derived from 2015, not 2013
    expect(childRow().birth_year).toBe("2015");
    expect(childRow().grade).toBeNull(); // grade stays untouched too — NO write at all
  });

  it("FILL-ONLY: only when BOTH columns are unset does the write proceed", async () => {
    // The seeded row has birth_year '' and grade null — the accept test's
    // write path re-asserted here against the guard explicitly.
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, grade: 8 });
    expect(childRow().birth_year).toBe("2013");
    expect(childRow().grade).toBe(8);
  });

  it("a saturated bucket refuses generically BEFORE any DB I/O", async () => {
    rateRef.allowed = false;
    const res = await post({ birthYear: 2013 });
    expect(res.status).toBe(401);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
    expect(childRow().birth_year).toBe("");
  });

  it("a disallowed Origin is 403 (the one non-401 refusal), before anything runs", async () => {
    const res = await post({ birthYear: 2013 }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
  });

  it("OPTIONS preflight: 204 for an allowed origin, with authorization in the allowed headers", async () => {
    const req = new Request("http://localhost/api/fp/grade", {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    });
    const res = await import("@/app/api/fp/grade/route").then((m) => m.OPTIONS(req));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type, authorization");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = new Request("http://localhost/api/fp/grade", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect((await import("@/app/api/fp/grade/route").then((m) => m.OPTIONS(bad))).status).toBe(403);
  });

  it("the school-year boundary governs the write gate: birth year 2018 flips at Sep 1", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 31, 12, 0, 0))); // Aug 31 → grade 2
    expect((await post({ birthYear: 2018 })).status).toBe(401);
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 1, 0, 0, 0))); // Sep 1 → grade 3
    const res = await post({ birthYear: 2018 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, grade: 3 });
    expect(childRow().grade).toBe(3);
  });
});
