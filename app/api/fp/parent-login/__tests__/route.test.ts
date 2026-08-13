/**
 * Route-level coverage for POST /api/fp/parent-login (fpv04 Unit 3) — the
 * wiring only the wire can prove:
 *   - FAIL-CLOSED GATE: with FP_PARENT_LOGIN_LIVE unset, VALID parent
 *     credentials are refused with the one byte-identical 401 (pinned), while
 *     the founder-allowlisted identity passes end-to-end.
 *   - THE PARENT GATE: a KID's credentials (auth succeeds, no parents row) get
 *     the same uniform refusal AND the just-minted session is revoked SCOPED
 *     ('local', never 'global') — the child door's child-gate mirror.
 *   - NO EXISTENCE ORACLE: unknown email and wrong password are one /token
 *     round-trip each and byte-identical refusals.
 *   - The 200 body is exactly FpParentSessionBody, field order pinned.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeClient,
  newStore,
  type FaultPlan,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  FP_PARENT_LOGIN_REFUSAL_BODY,
  FP_PARENT_SESSION_BODY_KEYS,
} from "../parent-login-rules";
import {
  FP_PARENT_LOGIN_IP_RATE_LIMIT,
  FP_PARENT_LOGIN_RATE_LIMIT,
} from "@/app/lib/fp/rate-limit-rules";

const { store, faults, authRef, rateRef, revokeRef } = vi.hoisted(() => ({
  store: { value: {} as Store },
  faults: { value: undefined as unknown },
  authRef: {
    // email → {id, password} the fake /token endpoint authenticates against.
    accounts: new Map<string, { id: string; password: string }>(),
    calls: [] as Array<{ email: string; password: string }>,
    outage: false,
  },
  rateRef: {
    allowed: true,
    recorded: [] as Array<{ key: string; config: unknown }>,
    released: [] as string[],
    cleared: [] as string[],
  },
  revokeRef: { calls: [] as Array<{ token: string; scope: string }> },
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    ...fakeClient(store.value, faults.value as FaultPlan | undefined),
    auth: {
      admin: {
        signOut: async (token: string, scope: string) => {
          revokeRef.calls.push({ token, scope });
          return { error: null };
        },
      },
    },
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async (args: { email: string; password: string }) => {
        authRef.calls.push(args);
        if (authRef.outage) {
          return { data: { session: null, user: null }, error: { status: 503 } };
        }
        const acct = authRef.accounts.get(args.email.trim().toLowerCase());
        if (acct && acct.password === args.password) {
          return {
            data: {
              session: { access_token: `at-${acct.id}`, refresh_token: `rt-${acct.id}` },
              user: { id: acct.id },
            },
            error: null,
          };
        }
        return {
          data: { session: null, user: null },
          error: { status: 400, code: "invalid_credentials" },
        };
      },
    },
  }),
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string, config: unknown) => {
    rateRef.recorded.push({ key, config });
    return { allowed: rateRef.allowed };
  },
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
  clearRateLimitBucket: (key: string) => rateRef.cleared.push(key),
}));

const ORIGIN = "https://firstprofit.school";

const post = (body: unknown, origin = ORIGIN) => {
  const req = new Request("http://localhost/api/fp/parent-login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return import("@/app/api/fp/parent-login/route").then((m) => m.POST(req));
};

/** Seed one PARENT (auth account + parents row) and one KID (auth account,
 *  NO parents row — the derived `.invalid` identity shape). */
function seedAccounts(): void {
  authRef.accounts.set("parent@example.com", { id: "parent-1", password: "parent pw" });
  store.value.parents = [
    { id: "parent-1", email: "parent@example.com", first_name: "Robin", last_name: "Reyes" },
  ];
  authRef.accounts.set("s-kid-1@students.the120.invalid", { id: "kid-user-1", password: "kid pw" });
}

async function expectUniformRefusal(res: Response): Promise<void> {
  expect(res.status).toBe(401);
  expect(await res.text()).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
}

beforeEach(() => {
  store.value = newStore();
  faults.value = undefined;
  authRef.accounts.clear();
  authRef.calls = [];
  authRef.outage = false;
  rateRef.allowed = true;
  rateRef.recorded = [];
  rateRef.released = [];
  rateRef.cleared = [];
  revokeRef.calls = [];
  seedAccounts();
  // FAIL-CLOSED DEFAULT: the door is dark. Tests open it explicitly.
  vi.stubEnv("FP_PARENT_LOGIN_LIVE", "");
  vi.stubEnv("FP_SIGNUP_TEST_ALLOWLIST", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the launch gate — PUBLIC-OPEN by default (fpv04 U6b-i)", () => {
  it("NO ENV SET: an ordinary parent signs in; body is exactly FpParentSessionBody, order pinned", async () => {
    // The unit's whole point: the dashboard cannot ship dark because someone
    // forgot to set a variable.
    const res = await post({ email: "Parent@Example.com", password: "parent pw" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual([...FP_PARENT_SESSION_BODY_KEYS]);
    expect(body.parent).toEqual({ email: "parent@example.com", firstName: "Robin" });
    // The proven owner's (ip,email) bucket is cleared, mirroring the child door.
    expect(rateRef.cleared.some((k) => k.startsWith("fp-parent-login:"))).toBe(true);
  });

  it("PINNED: kill-switch THROWN + fully VALID parent credentials → the uniform 401; no auth call is even made", async () => {
    vi.stubEnv("FP_PARENT_LOGIN_TEST_ONLY", "1");
    const res = await post({ email: "parent@example.com", password: "parent pw" });
    await expectUniformRefusal(res);
    expect(authRef.calls).toHaveLength(0); // refused before any /token work
    expect(rateRef.released).toEqual([]); // the strike stands
  });

  it("kill-switch THROWN: the founder-allowlisted identity still passes end-to-end", async () => {
    vi.stubEnv("FP_PARENT_LOGIN_TEST_ONLY", "1");
    vi.stubEnv("FP_SIGNUP_TEST_ALLOWLIST", "parent@example.com");
    const res = await post({ email: "parent@example.com", password: "parent pw" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      access_token: "at-parent-1",
      refresh_token: "rt-parent-1",
      parent: { email: "parent@example.com", firstName: "Robin" },
    });
  });

  it("the LEGACY FP_PARENT_LOGIN_LIVE var no longer closes the door", async () => {
    vi.stubEnv("FP_PARENT_LOGIN_LIVE", "0");
    const res = await post({ email: "parent@example.com", password: "parent pw" });
    expect(res.status).toBe(200);
  });
});

describe("the PARENT gate — a kid's credentials must never yield parent tokens", () => {
  beforeEach(() => {
    vi.stubEnv("FP_PARENT_LOGIN_LIVE", "1");
  });

  it("auth success WITHOUT a parents row → uniform 401 + SCOPED revoke of the just-minted session", async () => {
    const res = await post({
      email: "s-kid-1@students.the120.invalid",
      password: "kid pw",
    });
    await expectUniformRefusal(res);
    expect(revokeRef.calls).toEqual([{ token: "at-kid-user-1", scope: "local" }]);
    expect(rateRef.released).toEqual([]); // a non-parent probe keeps its strike
  });

  it("a parent-gate DB FAULT is an outage: uniform 401, strikes released, minted session revoked scoped", async () => {
    faults.value = {
      "select:parents": { kind: "error", error: { message: "db down" } },
    } satisfies FaultPlan;
    const res = await post({ email: "parent@example.com", password: "parent pw" });
    await expectUniformRefusal(res);
    // The password was CORRECT — a DB fault is not a guess, so both
    // provisional strikes come back…
    expect(rateRef.released).toHaveLength(2);
    // …and the session minted before the fault is revoked, scoped.
    expect(revokeRef.calls).toEqual([{ token: "at-parent-1", scope: "local" }]);
  });

  it("a first_name-less parents row still signs in, with firstName: null", async () => {
    store.value.parents = [{ id: "parent-1", email: "parent@example.com", first_name: "  " }];
    const res = await post({ email: "parent@example.com", password: "parent pw" });
    expect(res.status).toBe(200);
    expect((await res.json()).parent).toEqual({ email: "parent@example.com", firstName: null });
  });
});

describe("no oracle: refusals are byte-identical and equal-work", () => {
  beforeEach(() => {
    vi.stubEnv("FP_PARENT_LOGIN_LIVE", "1");
  });

  it("unknown email vs wrong password: one /token round-trip each, same bytes", async () => {
    const unknown = await post({ email: "nobody@example.com", password: "parent pw" });
    await expectUniformRefusal(unknown);
    const wrongPw = await post({ email: "parent@example.com", password: "wrong" });
    await expectUniformRefusal(wrongPw);
    expect(authRef.calls).toHaveLength(2); // exactly one auth call apiece
    expect(rateRef.released).toEqual([]); // both are real guesses
  });

  it("rate-limited and malformed requests collapse into the same bytes", async () => {
    rateRef.allowed = false;
    await expectUniformRefusal(await post({ email: "parent@example.com", password: "parent pw" }));
    rateRef.allowed = true;
    await expectUniformRefusal(await post({ email: "not-an-email", password: "pw" }));
    await expectUniformRefusal(await post({ email: "parent@example.com" }));
  });

  it("an auth OUTAGE releases the provisional strikes (not a guess)", async () => {
    authRef.outage = true;
    await expectUniformRefusal(await post({ email: "parent@example.com", password: "parent pw" }));
    expect(rateRef.released.length).toBe(2); // email + ip buckets handed back
  });

  it("records both parent-login budgets before the verdict", async () => {
    await post({ email: "parent@example.com", password: "parent pw" });
    const configs = rateRef.recorded.map((r) => r.config);
    expect(configs).toContainEqual(FP_PARENT_LOGIN_RATE_LIMIT);
    expect(configs).toContainEqual(FP_PARENT_LOGIN_IP_RATE_LIMIT);
  });
});

describe("origin discipline", () => {
  it("a disallowed Origin is a bodyless 403; OPTIONS preflight from an allowed origin is 204", async () => {
    const bad = await post({ email: "parent@example.com", password: "parent pw" }, "https://evil.example");
    expect(bad.status).toBe(403);
    expect(await bad.text()).toBe("");

    const mod = await import("@/app/api/fp/parent-login/route");
    const preflight = await mod.OPTIONS(
      new Request("http://localhost/api/fp/parent-login", {
        method: "OPTIONS",
        headers: { origin: ORIGIN },
      })
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});
