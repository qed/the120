import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  fakeClient,
  type FaultPlan,
  type RecordedCall,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  deriveParentResetRateLimitKeys,
  PARENT_RESET_BODY_KEYS,
  PARENT_RESET_IP_RATE_LIMIT,
  PARENT_RESET_RATE_LIMIT,
  PARENT_RESET_REFUSAL_BODY,
} from "../reset-password-rules";
import { FP_MEMORABLE_PASSWORD_PATTERN } from "@/app/api/fp/signup/mint-rules";

/**
 * Route-level coverage for POST /api/fp/parent/reset-password — the parent
 * dashboard's one-time password reset. Asserts the wiring the pure rules
 * cannot:
 *
 *   - OWNERSHIP IS THE SECURITY BOUNDARY, and unlike the roster door the id
 *     comes from the CLIENT. Parent A cannot reset parent B's child, the auth
 *     write never happens for one, and the core's children read as ISSUED
 *     carries `parent_id = <the AUTHENTICATED id>` — asserted against `dbCalls`,
 *     not merely against the response, because a response assertion alone
 *     cannot tell "scoped correctly" from "the fixture was small".
 *   - The TWO gates in order: a genuine token, then a `parents` row. A KID's
 *     bearer (authentic, no parents row) gets the uniform 401 and never reaches
 *     the reset at all.
 *   - The MINT: a fresh memorable password per call, written to the CHILD's
 *     auth account, returned once, and never logged.
 *   - The byte-identical refusal — body AND headers — across every reason.
 *
 * The fake client runs with `perturbUnordered` ON, matching the roster door's
 * harness.
 */

type GetUserFn = Mock<() => Promise<unknown>>;

const { store, faults, tokenRef, authRef, rateRef, callLog, dbCalls, mintRef } = vi.hoisted(
  () => ({
    store: { value: {} as Store },
    faults: { value: {} as FaultPlan },
    tokenRef: { getUser: vi.fn() as unknown as GetUserFn },
    // The privileged auth write, injected so a test can prove it NEVER runs for
    // a child the caller does not own — and prove exactly what it was handed.
    authRef: {
      calls: [] as { userId: string; password: string }[],
      error: null as { message: string } | null,
    },
    // `deny` is PER BUCKET KEY, not one global verdict: the route records both
    // buckets and then ORs the two answers.
    rateRef: {
      allowed: true,
      deny: new Set<string>(),
      recorded: [] as { key: string; config: unknown }[],
      released: [] as string[],
    },
    callLog: [] as string[],
    // Every query as ISSUED — this is where the parent scoping is pinned.
    dbCalls: [] as RecordedCall[],
    // When set, the mint is forced to a known value so the name-overlap branch
    // is reachable deterministically.
    mintRef: { forced: null as string | null, queue: [] as string[] },
  })
);

type Chainable = ReturnType<ReturnType<typeof fakeClient>["from"]>;

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => {
    const client = fakeClient(store.value, faults.value, {
      perturbUnordered: true,
      recordCalls: dbCalls,
    });
    return {
      ...client,
      from: (table: string) => {
        callLog.push(`db:${table}`);
        return client.from(table) as Chainable;
      },
      auth: {
        admin: {
          updateUserById: async (userId: string, attrs: { password?: string }) => {
            callLog.push("auth:updateUserById");
            authRef.calls.push({ userId, password: attrs.password ?? "" });
            return { data: null, error: authRef.error };
          },
        },
      },
    };
  },
}));

vi.mock("@/app/lib/supabase/parent-token", () => ({
  supabaseParentToken: () => ({ auth: { getUser: () => tokenRef.getUser() } }),
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string, config: unknown) => {
    callLog.push(`rate:${key}`);
    rateRef.recorded.push({ key, config });
    return { allowed: rateRef.allowed && !rateRef.deny.has(key) };
  },
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
}));

vi.mock("@/app/api/fp/signup/mint-rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/api/fp/signup/mint-rules")>();
  return {
    ...actual,
    mintMemorablePassword: (random?: () => number) =>
      mintRef.queue.shift() ?? mintRef.forced ?? actual.mintMemorablePassword(random),
  };
});

const ORIGIN = "https://firstprofit.school";
const PARENT_A = "parent-a";
const PARENT_B = "parent-b";
const KID_USER = "kid-user-1";

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;

const sessionUser = (id: string) => ({ data: { user: { id } }, error: null });

/**
 * Two families. Parent A has three children: one fully provisioned, one
 * enrolled in FP but with no auth profile row (the `no_fp_account` shape), and
 * one never provisioned into FP at all. Parent B has ONE child, and every
 * isolation assertion is against that row.
 */
function seed(): void {
  store.value = {
    parents: [
      { id: PARENT_A, email: "a@example.com", first_name: "Robin" },
      { id: PARENT_B, email: "b@example.com", first_name: "Sam" },
    ],
    children: [
      { id: "c-a1", parent_id: PARENT_A, first_name: "Alex", last_name: "Ng", fp_username: "alex" },
      // Enrolled, but no path_student_profiles row → the core's no_fp_account.
      { id: "c-a2", parent_id: PARENT_A, first_name: "Eve", last_name: "Ng", fp_username: "eve" },
      // Never provisioned into FP → invisible to the core's WHERE clause.
      { id: "c-a3", parent_id: PARENT_A, first_name: "Ivy", last_name: "Ng", fp_username: null },
      // ⚠ ANOTHER FAMILY'S CHILD. Parent A must never move this password.
      { id: "c-b1", parent_id: PARENT_B, first_name: "Bo", last_name: "Diaz", fp_username: "bo" },
    ],
    path_student_profiles: [
      { child_id: "c-a1", user_id: "u-a1" },
      { child_id: "c-b1", user_id: "u-b1" },
    ],
  } as Store;
}

const requestFor = (opts?: {
  origin?: string;
  token?: string | null;
  body?: unknown;
  rawBody?: string;
}): Request => {
  const headers: Record<string, string> = {
    origin: opts?.origin ?? ORIGIN,
    "content-type": "application/json",
  };
  const token = opts?.token === undefined ? jwtFor(PARENT_A) : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/fp/parent/reset-password", {
    method: "POST",
    headers,
    body: opts?.rawBody ?? JSON.stringify(opts?.body ?? { childId: "c-a1" }),
  });
};

const post = (opts?: Parameters<typeof requestFor>[0]) =>
  import("@/app/api/fp/parent/reset-password/route").then((m) => m.POST(requestFor(opts)));

type Body = { ok: boolean; childId: string; fpUsername: string; password: string };

/** Status + body + the sorted header set — the unit refusal parity is asserted in. */
const snapshotOf = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).sort(),
});

/** The CORE's ownership read — the one that carries the whole authorization. */
const coreChildQuery = (): RecordedCall | undefined =>
  dbCalls.find((c) => c.table === "children" && c.columns?.includes("first_name"));

/** Every string this invocation handed to console.* , flattened. */
const consoleOutput = (): string =>
  [
    ...(console.error as unknown as Mock).mock.calls,
    ...(console.log as unknown as Mock).mock.calls,
  ]
    .flat()
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join("\n");

describe("POST /api/fp/parent/reset-password — the parent's one-time kid reset", () => {
  beforeEach(() => {
    seed();
    faults.value = {};
    callLog.length = 0;
    dbCalls.length = 0;
    authRef.calls = [];
    authRef.error = null;
    mintRef.forced = null;
    mintRef.queue = [];
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue(sessionUser(PARENT_A)) as unknown as GetUserFn;
    rateRef.allowed = true;
    rateRef.deny.clear();
    rateRef.recorded = [];
    rateRef.released = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  // ── The happy path ──

  describe("the mint", () => {
    it("mints a memorable password, writes it to the CHILD's auth account, and returns it once", async () => {
      const res = await post();
      expect(res.status).toBe(200);
      const body = (await res.json()) as Body;

      expect(Object.keys(body)).toEqual([...PARENT_RESET_BODY_KEYS]);
      expect(body.ok).toBe(true);
      expect(body.childId).toBe("c-a1");
      expect(body.fpUsername).toBe("alex");
      expect(FP_MEMORABLE_PASSWORD_PATTERN.test(body.password)).toBe(true);

      // The password CHANGED, on the child's auth user — never the parent's.
      // The id comes from path_student_profiles, joined off a row the core's
      // WHERE clause already proved belongs to this parent.
      expect(authRef.calls).toEqual([{ userId: "u-a1", password: body.password }]);

      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("vary")).toBe("Origin");
      expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    });

    it("mints a DIFFERENT password each time — a reset is not idempotent", async () => {
      const seen = new Set<string>();
      for (let i = 0; i < 8; i += 1) {
        seen.add(((await (await post()).json()) as Body).password);
      }
      // 40 words × 40 × 100 — eight identical draws would mean a stuck minter.
      expect(seen.size).toBeGreaterThan(1);
    });

    it("NEVER logs the minted password, and never logs the token or the username", async () => {
      const body = (await (await post()).json()) as Body;
      const output = consoleOutput();
      expect(output.includes(body.password)).toBe(false);
      for (const word of body.password.split("-")) {
        // Not even a fragment of it.
        if (word.length >= 4) expect(output.includes(word), word).toBe(false);
      }
      expect(output.includes("alex")).toBe(false);
      expect(output.includes(jwtFor(PARENT_A))).toBe(false);
      // The audit breadcrumb IS there: who reset whose password.
      expect(output.includes(PARENT_A)).toBe(true);
      expect(output.includes("c-a1")).toBe(true);
    });

    it("re-rolls when the mint collides with the child's own name", async () => {
      // The name-overlap rule lives in the CORE and fires on the child's real
      // name, read from the row it just authorized. A forced colliding mint
      // must exhaust the bounded re-roll rather than set a guessable password.
      store.value.children = [
        { id: "c-a1", parent_id: PARENT_A, first_name: "Maple", last_name: "Ng", fp_username: "alex" },
      ];
      mintRef.forced = "maple-lantern-42";
      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_RESET_REFUSAL_BODY);
      // Not one write happened — the core refused every candidate.
      expect(authRef.calls).toEqual([]);
      // Deterministic and repeatable: the strike is NOT refunded.
      expect(rateRef.released).toEqual([]);
    });

    it("a TRANSIENT collision re-rolls and SUCCEEDS, invisibly to the caller", async () => {
      // The exhausted case above proves the bound; this proves the loop
      // actually recovers. Attempt 1 collides with the child's name, attempt 2
      // does not — the parent must simply get a working password, with no hint
      // that anything was re-rolled.
      store.value.children = [
        { id: "c-a1", parent_id: PARENT_A, first_name: "Maple", last_name: "Ng", fp_username: "alex" },
      ];
      mintRef.queue = ["maple-lantern-42", "brave-otter-42"];
      const res = await post();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.password).toBe("brave-otter-42");
      // Exactly ONE credential write: the colliding candidate never reached it.
      expect(authRef.calls).toHaveLength(1);
    });
  });

  // ── OWNERSHIP: the security boundary ──

  describe("cross-parent isolation — the whole point of taking a childId", () => {
    it("parent A cannot reset parent B's child, and NOTHING is written", async () => {
      const res = await post({ body: { childId: "c-b1" } });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_RESET_REFUSAL_BODY);
      // THE assertion this route exists to keep true: the other family's auth
      // account is never touched.
      expect(authRef.calls).toEqual([]);
      expect(callLog).not.toContain("auth:updateUserById");
      // A foreign-child probe keeps its strike — refunding it would make
      // enumerating another family's child ids free.
      expect(rateRef.released).toEqual([]);
    });

    it("the core's child read as ISSUED filters on the AUTHENTICATED parent id", async () => {
      // Asserted against the QUERY, not the response: the reads run with the
      // SERVICE ROLE, so this `.eq` is the entire authorization for another
      // family's data, and a response assertion cannot see it.
      await post({ body: { childId: "c-b1" } });
      const q = coreChildQuery()!;
      expect(q.filters).toContainEqual({ op: "eq", col: "id", value: "c-b1" });
      expect(q.filters).toContainEqual({ op: "eq", col: "parent_id", value: PARENT_A });
    });

    it("the scope follows the VERIFIED identity, never the token's own claim", async () => {
      // A forged/stale `sub` claiming to be parent B while getUser() resolves
      // parent A must still be scoped to parent A: the sub is a rate-limit
      // bucket segment only.
      const res = await post({ token: jwtFor(PARENT_B), body: { childId: "c-b1" } });
      expect(res.status).toBe(401);
      expect(coreChildQuery()!.filters).toContainEqual({
        op: "eq",
        col: "parent_id",
        value: PARENT_A,
      });
      expect(authRef.calls).toEqual([]);
    });

    it("parent B, signed in as themselves, CAN reset that same child", async () => {
      // The mirror of the refusal above — proves the isolation test is failing
      // for the right reason and not because the fixture is unresettable.
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B)) as unknown as GetUserFn;
      const res = await post({ token: jwtFor(PARENT_B), body: { childId: "c-b1" } });
      expect(res.status).toBe(200);
      expect(((await res.json()) as Body).fpUsername).toBe("bo");
      expect(authRef.calls.map((c) => c.userId)).toEqual(["u-b1"]);
    });

    it("a child with no FP account is the SAME refusal as a foreign child", async () => {
      const res = await post({ body: { childId: "c-a2" } });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_RESET_REFUSAL_BODY);
      expect(authRef.calls).toEqual([]);
    });

    it("a child never provisioned into FP is refused too", async () => {
      const res = await post({ body: { childId: "c-a3" } });
      expect(res.status).toBe(401);
      expect(authRef.calls).toEqual([]);
    });
  });

  // ── The refusals: one voice ──

  describe("one byte-identical 401 for every authorization-shaped refusal", () => {
    it("a KID's bearer — authentic, but no parents row — is refused before any reset", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(KID_USER)) as unknown as GetUserFn;
      const res = await post({ token: jwtFor(KID_USER) });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_RESET_REFUSAL_BODY);
      // The gate is BEFORE the core — a non-parent must not make this endpoint
      // touch the children table, let alone an auth account.
      expect(callLog).not.toContain("db:children");
      expect(authRef.calls).toEqual([]);
      expect(rateRef.released).toEqual([]); // a non-parent probe keeps its strike
    });

    it("a missing, blank or unparseable bearer refuses before ANY DB I/O", async () => {
      for (const token of [null, "", "   ", "not-a-jwt"]) {
        callLog.length = 0;
        const res = await post({ token });
        expect(res.status).toBe(401);
        expect(await res.text()).toBe(PARENT_RESET_REFUSAL_BODY);
        expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
        expect(authRef.calls).toEqual([]);
      }
    });

    it("an invalid/expired token is refused with the same bytes, strike standing", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } }) as unknown as GetUserFn;
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toEqual([]);
      expect(authRef.calls).toEqual([]);
    });

    it("a malformed body is refused — including one that tries to SET a password", async () => {
      const bodies: Parameters<typeof requestFor>[0][] = [
        { rawBody: "not json at all" },
        { body: {} },
        { body: { childId: "" } },
        { body: { childId: 7 } },
        // ⚠ This door MINTS. A caller-supplied password is a malformed request,
        // never a silently ignored field.
        { body: { childId: "c-a1", password: "chosen-by-the-parent" } },
      ];
      for (const opts of bodies) {
        authRef.calls = [];
        const res = await post(opts);
        expect(res.status, JSON.stringify(opts)).toBe(401);
        expect(await res.text()).toBe(PARENT_RESET_REFUSAL_BODY);
        expect(authRef.calls).toEqual([]);
      }
    });

    it("a saturated bucket refuses BEFORE the body is read, with no 429", async () => {
      // No forwarded-for header on the fixture request, so the attested IP is
      // `extractClientIp`'s "unknown" sentinel.
      const { userKey } = deriveParentResetRateLimitKeys("unknown", PARENT_A);
      rateRef.deny.add(userKey);
      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_RESET_REFUSAL_BODY);
      expect(res.headers.get("retry-after")).toBeNull();
      expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
      expect(authRef.calls).toEqual([]);
      // BOTH buckets record before either verdict.
      expect(rateRef.recorded).toHaveLength(2);
    });

    it("records both reset budgets, in this route's OWN namespaces", async () => {
      await post();
      expect(rateRef.recorded.map((r) => r.config)).toEqual([
        PARENT_RESET_RATE_LIMIT,
        PARENT_RESET_IP_RATE_LIMIT,
      ]);
      expect(rateRef.recorded[0]!.key.startsWith("fp-parent-reset:")).toBe(true);
      expect(rateRef.recorded[1]!.key.startsWith("fp-parent-reset-ip:")).toBe(true);
    });

    it("EVERY refusal reason is byte-identical in status, body AND headers", async () => {
      // Headers are exactly where a per-reason oracle creeps back in, so the
      // whole response — not just the body — is snapshotted per reason.
      const snapshots: Record<string, Awaited<ReturnType<typeof snapshotOf>>> = {};

      snapshots.missing_token = await snapshotOf(await post({ token: null }));
      snapshots.invalid_sub = await snapshotOf(await post({ token: "garbage" }));
      snapshots.malformed = await snapshotOf(await post({ body: { nope: 1 } }));
      snapshots.not_owned = await snapshotOf(await post({ body: { childId: "c-b1" } }));
      snapshots.no_fp_account = await snapshotOf(await post({ body: { childId: "c-a2" } }));

      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue({ data: { user: null }, error: { message: "bad" } }) as unknown as GetUserFn;
      snapshots.bad_token = await snapshotOf(await post());

      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(KID_USER)) as unknown as GetUserFn;
      snapshots.not_parent = await snapshotOf(await post({ token: jwtFor(KID_USER) }));

      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_A)) as unknown as GetUserFn;
      rateRef.allowed = false;
      snapshots.rate_limited = await snapshotOf(await post());
      rateRef.allowed = true;

      faults.value["select:children"] = { kind: "error", error: { message: "db down" } };
      snapshots.outage = await snapshotOf(await post());
      faults.value = {};

      authRef.error = { message: "auth service down" };
      snapshots.auth_write_failed = await snapshotOf(await post());

      const values = Object.values(snapshots);
      for (const snap of values) {
        expect(snap.status).toBe(401);
        expect(snap).toEqual(values[0]);
      }
      expect(values[0]!.body).toBe(PARENT_RESET_REFUSAL_BODY);
    });
  });

  // ── Outage vs. deterministic: the strike policy ──

  describe("strike policy", () => {
    it("a core read OUTAGE refunds both strikes — our downtime is not their budget", async () => {
      faults.value["select:children"] = { kind: "error", error: { message: "db down" } };
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
    });

    it("a failed auth write is an outage too: refunded, and no 200", async () => {
      authRef.error = { message: "auth service down" };
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
    });

    it("a parent-gate outage refunds, and never reaches the core", async () => {
      faults.value["select:parents"] = { kind: "error", error: { message: "db down" } };
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
      expect(callLog).not.toContain("db:children");
    });

    it("a STALLED parent gate is an outage — the round trip is bounded", async () => {
      faults.value["select:parents"] = { kind: "hang" };
      const mod = await import("@/app/api/fp/parent/reset-password/route");
      vi.useFakeTimers();
      let res: Response;
      try {
        const pending = mod.POST(requestFor());
        await vi.advanceTimersByTimeAsync(30_000);
        res = await pending;
      } finally {
        vi.useRealTimers();
      }
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
      expect(authRef.calls).toEqual([]);
    });
  });

  // ── After the write ──

  it("refuses rather than answering a HALF credential card if the username read fails", async () => {
    // Reaching this point means the password HAS changed, so this is the one
    // refusal that costs the parent something — but a 200 with a blank username
    // would leave them worse off, and the strike is refunded so the retry (which
    // mints a fresh password) is free.
    faults.value["select:children"] = [
      { kind: "error", error: { message: "db down" }, onCalls: [2] },
    ];
    const res = await post();
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(PARENT_RESET_REFUSAL_BODY);
    expect(authRef.calls).toHaveLength(1); // the write DID happen
    expect(rateRef.released).toHaveLength(2);
  });

  // ── Origin ──

  describe("origin discipline", () => {
    it("a disallowed Origin is a bodyless 403 with NO CORS echo, and no work at all", async () => {
      const res = await post({ origin: "https://evil.example" });
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(callLog).toEqual([]);
      expect(authRef.calls).toEqual([]);
    });

    it("OPTIONS from an allowed origin is a 204 preflight allowing POST + the JSON body", async () => {
      const mod = await import("@/app/api/fp/parent/reset-password/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/reset-password", {
          method: "OPTIONS",
          headers: { origin: ORIGIN },
        })
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe("authorization, content-type");
    });

    it("OPTIONS from a disallowed origin is a bodyless 403", async () => {
      const mod = await import("@/app/api/fp/parent/reset-password/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/reset-password", {
          method: "OPTIONS",
          headers: { origin: "https://evil.example" },
        })
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
});
