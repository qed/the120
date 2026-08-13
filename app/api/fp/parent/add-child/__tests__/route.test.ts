import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  fakeClient,
  type FaultPlan,
  type RecordedCall,
  type Row,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  deriveParentAddChildRateLimitKeys,
  PARENT_ADD_CHILD_IP_RATE_LIMIT,
  PARENT_ADD_CHILD_RATE_LIMIT,
  PARENT_ADD_CHILD_READ_TIMEOUT_MS,
  PARENT_ADD_CHILD_REFUSAL_BODY,
} from "../add-child-rules";

/**
 * Route-level coverage for POST /api/fp/parent/add-child — the door that mints
 * the FRESH `fp_signup_attempts` row an already-signed-in parent needs before
 * the existing consent + child-mint doors will make them a SECOND child.
 * Asserts the wiring the pure rules cannot:
 *
 *   - THE ROW IS SCOPED TO THE AUTHENTICATED PARENT. A forged `sub` claiming to
 *     be parent B, verified as parent A, writes parent A's row and NOTHING for
 *     parent B — asserted on the PERSISTED ROW, because the response body is a
 *     bare `{ok:true}` and could never tell the two apart.
 *   - The exact COLUMN SET, and that `is_test` is DERIVED from the parent's
 *     stored email rather than taken from anywhere the caller can reach.
 *   - The row carries NO verification secret, which is what makes it inert as a
 *     credential and sweepable by the seven-day orphan collector.
 *   - The TWO gates in order: a genuine token, then a `parents` row. A KID's
 *     bearer (authentic, no parents row) gets the uniform 401 and writes
 *     nothing at all.
 *   - The byte-identical refusal — body AND headers — across every reason.
 *
 * The fake client runs with `perturbUnordered` ON, matching both sibling
 * parent-door harnesses.
 */

type GetUserFn = Mock<() => Promise<unknown>>;

const { store, faults, tokenRef, rateRef, callLog, dbCalls } = vi.hoisted(() => ({
  store: { value: {} as Store },
  faults: { value: {} as FaultPlan },
  tokenRef: { getUser: vi.fn() as unknown as GetUserFn },
  // `deny` is PER BUCKET KEY, not one global verdict: the route records both
  // buckets and then ORs the two answers, and a mock with a single `allowed`
  // flag cannot tell `||` from `&&`.
  rateRef: {
    allowed: true,
    deny: new Set<string>(),
    recorded: [] as { key: string; config: unknown }[],
    released: [] as string[],
  },
  callLog: [] as string[],
  // Every query as ISSUED — columns, filters, order key, page size.
  dbCalls: [] as RecordedCall[],
}));

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

const ORIGIN = "https://firstprofit.school";
const PARENT_A = "parent-a";
const PARENT_B = "parent-b";
const KID_USER = "kid-user-1";
const UA = "Mozilla/5.0 (iPhone)";

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;

const sessionUser = (id: string) => ({ data: { user: { id } }, error: null });

/**
 * Two families, plus the parent A signup attempt that ALREADY MINTED A CHILD.
 * That last row is the whole reason this endpoint exists: `child-core` treats a
 * second mint on a `child_created` attempt as an idempotent replay, so the
 * add-child journey MUST get a row of its own rather than reuse this one.
 */
function seed(): void {
  store.value = {
    parents: [
      { id: PARENT_A, email: "A@Example.com ", first_name: "Robin" },
      { id: PARENT_B, email: "b@example.com", first_name: "Sam" },
    ],
    fp_signup_attempts: [
      {
        id: "attempt-a1",
        parent_email: "a@example.com",
        parent_id: PARENT_A,
        state: "child_created",
        child_id: "c-a1",
        is_test: false,
        ip: "1.2.3.4",
        ua: "old",
        code_guess_count: 0,
      },
    ],
  } as Store;
}

const requestFor = (opts?: { origin?: string; token?: string | null }): Request => {
  const headers: Record<string, string> = {
    origin: opts?.origin ?? ORIGIN,
    "user-agent": UA,
    "x-forwarded-for": "203.0.113.9",
  };
  const token = opts?.token === undefined ? jwtFor(PARENT_A) : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/fp/parent/add-child", { method: "POST", headers });
};

const post = (opts?: { origin?: string; token?: string | null }) =>
  import("@/app/api/fp/parent/add-child/route").then((m) => m.POST(requestFor(opts)));

const attempts = (): Row[] => (store.value.fp_signup_attempts ?? []) as Row[];
/** Every attempt row this call CREATED — the seeded one is excluded by id. */
const newAttempts = (): Row[] => attempts().filter((r) => r.id !== "attempt-a1");

/** Status + body + the sorted header set — the unit refusal parity is asserted in. */
const snapshotOf = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).sort(),
});

describe("POST /api/fp/parent/add-child — the second-child attempt door", () => {
  beforeEach(() => {
    seed();
    faults.value = {};
    callLog.length = 0;
    dbCalls.length = 0;
    delete process.env.FP_SIGNUP_TEST_ALLOWLIST;
    delete process.env.FP_SIGNUP_TEST_ONLY;
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

  describe("the fresh attempt row", () => {
    it("answers a bare {ok:true} — and NEVER the attempt id", async () => {
      const res = await post();
      expect(res.status).toBe(200);
      // The id must not cross the wire: the whole email-keyed design exists so
      // the client never holds one.
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ ok: true });
      expect(text).not.toContain(String(newAttempts()[0]!.id));

      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("vary")).toBe("Origin");
      expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    });

    it("writes exactly the columns the signup doors write, all server-derived", async () => {
      await post();
      const rows = newAttempts();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toMatchObject({
        // Normalized like signup-core's — the seeded parents row is
        // "A@Example.com " with case and a trailing space.
        parent_email: "a@example.com",
        parent_id: PARENT_A,
        state: "verified",
        is_test: false,
        ip: "203.0.113.9",
        ua: UA,
        // EXPLICIT, never left to the column default: a control that only
        // exists when a DEFAULT fires is one an absent column silently
        // disables.
        code_guess_count: 0,
      });
      expect(typeof row.verified_at).toBe("string");
      // The exact column set — an added column is a deliberate edit, not a
      // drive-by. `id` is the fake's surrogate primary key.
      expect(Object.keys(row).sort()).toEqual(
        [
          "code_guess_count",
          "id",
          "ip",
          "is_test",
          "parent_email",
          "parent_id",
          "state",
          "ua",
          "verified_at",
        ].sort()
      );
    });

    it("carries NO verification secret — it is not a redeemable credential", async () => {
      // This is also exactly what makes the row sweepable by the seven-day
      // orphan collector (draft-reaper `sweepOrphanAttempts` skips any attempt
      // that carries one) and invisible to every code/link resolver.
      await post();
      const row = newAttempts()[0]!;
      expect(row.verification_code_hash).toBeUndefined();
      expect(row.verification_token_hash).toBeUndefined();
      expect(row.code_expires_at).toBeUndefined();
      expect(row.verification_expires_at).toBeUndefined();
      // No child bound: the sweep's `child_id IS NULL` proof, and the reason
      // the mint has something to do.
      expect(row.child_id ?? null).toBeNull();
    });

    it("leaves the parent's ALREADY-MINTED attempt untouched — the replay row still says child_created", async () => {
      // If this door mutated or reused it, the child door's idempotent-replay
      // branch would hand the parent their FIRST child back instead of minting.
      await post();
      expect(attempts().find((r) => r.id === "attempt-a1")).toMatchObject({
        state: "child_created",
        child_id: "c-a1",
      });
    });

    it("touches only `parents` and `fp_signup_attempts`, and reads no child data", async () => {
      await post();
      expect(new Set(callLog.filter((c) => c.startsWith("db:")))).toEqual(
        new Set(["db:parents", "db:fp_signup_attempts"])
      );
      const gate = dbCalls.find((c) => c.table === "parents")!;
      expect(gate.columns).toBe("id, email");
      expect(gate.filters).toContainEqual({ op: "eq", col: "id", value: PARENT_A });
    });

    it("a second call makes a SECOND row — a fresh journey never reuses a stale one", async () => {
      // Deliberate: reusing an attempt would let consent captured for one kid
      // (age band, DOB) gate a different kid's mint. The newest row wins at
      // both downstream doors; the orphan sweep collects the loser.
      await post();
      await post();
      expect(newAttempts()).toHaveLength(2);
      expect(newAttempts().every((r) => r.state === "verified")).toBe(true);
    });
  });

  // ── is_test: server-derived, never client-supplied ──

  describe("is_test is derived exactly the way the signup doors derive it", () => {
    it("the guarded @test.the120.invalid domain tags the row", async () => {
      store.value.parents = [{ id: PARENT_A, email: "robin@test.the120.invalid" }];
      await post();
      expect(newAttempts()[0]!.is_test).toBe(true);
    });

    it("the FP_SIGNUP_TEST_ALLOWLIST env tags the row", async () => {
      process.env.FP_SIGNUP_TEST_ALLOWLIST = "someone@else.com, a@example.com";
      await post();
      expect(newAttempts()[0]!.is_test).toBe(true);
    });

    it("an ordinary family is not tagged, and no request header can change that", async () => {
      // The route reads no body and no is_test header; the ONLY input is the
      // stored address.
      await post();
      expect(newAttempts()[0]!.is_test).toBe(false);
    });
  });

  // ── SCOPING: the security boundary ──

  describe("the row is scoped to the AUTHENTICATED parent", () => {
    it("a forged `sub` cannot create an attempt for someone else", async () => {
      // The token claims parent B; getUser() says parent A. The `sub` is a
      // rate-limit bucket segment ONLY, never an identity — so the row must be
      // parent A's, and parent B must gain nothing.
      const res = await post({ token: jwtFor(PARENT_B) });
      expect(res.status).toBe(200);
      const rows = newAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.parent_id).toBe(PARENT_A);
      expect(rows[0]!.parent_email).toBe("a@example.com");
      // Nothing anywhere in the table now belongs to parent B.
      expect(attempts().some((r) => r.parent_id === PARENT_B)).toBe(false);
      // And the gate that produced the email was itself keyed on the verified
      // id, not on the claim.
      expect(dbCalls.find((c) => c.table === "parents")!.filters).toContainEqual({
        op: "eq",
        col: "id",
        value: PARENT_A,
      });
    });

    it("parent B, signed in as themselves, gets a row that is theirs", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B)) as unknown as GetUserFn;
      const res = await post({ token: jwtFor(PARENT_B) });
      expect(res.status).toBe(200);
      expect(newAttempts()[0]).toMatchObject({
        parent_id: PARENT_B,
        parent_email: "b@example.com",
      });
    });
  });

  // ── The refusals: one voice ──

  describe("one byte-identical 401 for every authorization-shaped refusal", () => {
    it("a KID's bearer — authentic, but no parents row — is refused and writes NOTHING", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(KID_USER)) as unknown as GetUserFn;
      const res = await post({ token: jwtFor(KID_USER) });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_ADD_CHILD_REFUSAL_BODY);
      // The gate is BEFORE the write — a non-parent must not be able to make
      // this endpoint touch the attempts table at all.
      expect(callLog).not.toContain("db:fp_signup_attempts");
      expect(newAttempts()).toEqual([]);
      expect(rateRef.released).toEqual([]); // a non-parent probe keeps its strike
    });

    it("a missing, blank or unparseable bearer refuses before ANY DB I/O", async () => {
      for (const token of [null, "", "   ", "not-a-jwt"]) {
        callLog.length = 0;
        const res = await post({ token });
        expect(res.status).toBe(401);
        expect(await res.text()).toBe(PARENT_ADD_CHILD_REFUSAL_BODY);
        expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
      }
      expect(newAttempts()).toEqual([]);
    });

    it("an invalid/expired token is refused with the same bytes, strike standing", async () => {
      tokenRef.getUser = vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "bad jwt" },
      }) as unknown as GetUserFn;
      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_ADD_CHILD_REFUSAL_BODY);
      expect(rateRef.released).toEqual([]);
      expect(newAttempts()).toEqual([]);
    });

    it("a parents row with no usable email refuses rather than writing a blank one", async () => {
      // `parent_email` is NOT NULL and the is_test determination reads it — a
      // blank would be an unresolvable row AND a test family tagged as real.
      store.value.parents = [{ id: PARENT_A, email: null }];
      const res = await post();
      expect(res.status).toBe(401);
      expect(newAttempts()).toEqual([]);
    });

    it("a saturated bucket refuses BEFORE any DB I/O, with the same bytes and no 429", async () => {
      const { userKey } = deriveParentAddChildRateLimitKeys("203.0.113.9", PARENT_A);
      rateRef.deny.add(userKey);
      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_ADD_CHILD_REFUSAL_BODY);
      expect(res.headers.get("retry-after")).toBeNull();
      expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
      expect(newAttempts()).toEqual([]);
      // BOTH buckets record before either verdict, so the per-IP aggregate
      // keeps accumulating for a saturated user bucket.
      expect(rateRef.recorded).toHaveLength(2);
    });

    it("the per-IP bucket alone can refuse — the two verdicts are ORed, not ANDed", async () => {
      const { ipKey } = deriveParentAddChildRateLimitKeys("203.0.113.9", PARENT_A);
      rateRef.deny.add(ipKey);
      expect((await post()).status).toBe(401);
      expect(newAttempts()).toEqual([]);
    });

    it("records both add-child budgets, in this route's OWN namespaces", async () => {
      await post();
      expect(rateRef.recorded.map((r) => r.config)).toEqual([
        PARENT_ADD_CHILD_RATE_LIMIT,
        PARENT_ADD_CHILD_IP_RATE_LIMIT,
      ]);
      expect(rateRef.recorded[0]!.key.startsWith("fp-parent-add-child:")).toBe(true);
      expect(rateRef.recorded[1]!.key.startsWith("fp-parent-add-child-ip:")).toBe(true);
    });

    it("EVERY refusal reason is byte-identical in status, body AND headers", async () => {
      // Headers are exactly where a per-reason oracle creeps back in, so the
      // whole response — not just the body — is snapshotted per reason.
      const snapshots: Record<string, Awaited<ReturnType<typeof snapshotOf>>> = {};

      snapshots.missing_token = await snapshotOf(await post({ token: null }));
      snapshots.invalid_sub = await snapshotOf(await post({ token: "garbage" }));

      tokenRef.getUser = vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "bad" },
      }) as unknown as GetUserFn;
      snapshots.bad_token = await snapshotOf(await post());

      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(KID_USER)) as unknown as GetUserFn;
      snapshots.not_parent = await snapshotOf(await post({ token: jwtFor(KID_USER) }));

      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_A)) as unknown as GetUserFn;
      store.value.parents = [{ id: PARENT_A, email: "" }];
      snapshots.no_parent_email = await snapshotOf(await post());
      seed();

      rateRef.allowed = false;
      snapshots.rate_limited = await snapshotOf(await post());
      rateRef.allowed = true;

      faults.value["insert:fp_signup_attempts"] = {
        kind: "error",
        error: { message: "db down" },
      };
      snapshots.outage = await snapshotOf(await post());

      const values = Object.values(snapshots);
      for (const snap of values) {
        expect(snap.status).toBe(401);
        expect(snap).toEqual(values[0]);
      }
      expect(values[0]!.body).toBe(PARENT_ADD_CHILD_REFUSAL_BODY);
    });
  });

  // ── Outage: the strike policy ──

  describe("strike policy", () => {
    it("a failed insert refunds both strikes — our downtime is not their budget", async () => {
      faults.value["insert:fp_signup_attempts"] = {
        kind: "error",
        error: { message: "db down" },
      };
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
    });

    it("a failed parent gate READ is an outage too, and refunds", async () => {
      faults.value["select:parents"] = { kind: "error", error: { message: "db down" } };
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
      expect(newAttempts()).toEqual([]);
    });

    it("a STALLED insert is an outage — the round trip is bounded", async () => {
      faults.value["insert:fp_signup_attempts"] = { kind: "hang" };
      const mod = await import("@/app/api/fp/parent/add-child/route");
      vi.useFakeTimers();
      let res: Response;
      try {
        const pending = mod.POST(requestFor());
        await vi.advanceTimersByTimeAsync(PARENT_ADD_CHILD_READ_TIMEOUT_MS + 50);
        res = await pending;
      } finally {
        vi.useRealTimers();
      }
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
    });
  });

  // ── Origin ──

  describe("origin discipline", () => {
    it("a disallowed Origin is a bodyless 403 with NO CORS echo, and no work at all", async () => {
      const res = await post({ origin: "https://evil.example" });
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(callLog).toEqual([]);
      expect(newAttempts()).toEqual([]);
    });

    it("OPTIONS from an allowed origin is a 204 preflight allowing authorization ONLY", async () => {
      const mod = await import("@/app/api/fp/parent/add-child/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/add-child", {
          method: "OPTIONS",
          headers: { origin: ORIGIN },
        })
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
      // No `content-type`: this door reads no body.
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe("authorization");
    });

    it("OPTIONS from a disallowed origin is a bodyless 403", async () => {
      const mod = await import("@/app/api/fp/parent/add-child/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/add-child", {
          method: "OPTIONS",
          headers: { origin: "https://evil.example" },
        })
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
});
