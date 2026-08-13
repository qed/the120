import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  fakeClient,
  type FaultPlan,
  type RecordedCall,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  deriveParentRosterRateLimitKeys,
  PARENT_ROSTER_IP_RATE_LIMIT,
  PARENT_ROSTER_MAX_CHILDREN,
  PARENT_ROSTER_RATE_LIMIT,
  PARENT_ROSTER_READ_TIMEOUT_MS,
  PARENT_ROSTER_REFUSAL_BODY,
} from "../roster-rules";

/**
 * Route-level coverage for GET /api/fp/parent/roster — the parent dashboard's
 * roster + progress feed. Asserts the wiring the pure rules cannot:
 *
 *   - THE SCOPE IS THE SECURITY BOUNDARY. Parent A never sees parent B's child,
 *     and the children query as ISSUED carries `parent_id = <the AUTHENTICATED
 *     id>` — asserted against `dbCalls`, not merely against the body, because a
 *     body assertion alone cannot tell "filtered correctly" from "the fixture
 *     happened to only have one family".
 *   - The TWO gates in order: a genuine token, then a `parents` row. A KID's
 *     bearer (authentic, no parents row) gets the uniform 401.
 *   - The byte-identical refusal — body AND headers — across every reason.
 *   - Degrade-never-throw: an unreadable or absent save doc yields a card, not
 *     a 500.
 *
 * The fake client runs with `perturbUnordered` ON: an unordered select comes
 * back in a deliberately wrong order, so the route's `.order()` calls are
 * load-bearing here rather than decorative.
 */

type GetUserFn = Mock<() => Promise<unknown>>;

const { store, faults, tokenRef, rateRef, callLog, dbCalls, throwingTables } = vi.hoisted(
  () => ({
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
    // Every query as ISSUED — columns, filters, order key, page size. This is
    // where the parent scoping is pinned.
    dbCalls: [] as RecordedCall[],
    // Tables whose terminal REJECTS rather than answering `{error}` — the one
    // failure shape `withFwTimeout` cannot see, because Promise.race does not
    // catch.
    throwingTables: new Set<string>(),
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
        const builder: Chainable = client.from(table);
        if (throwingTables.has(table)) {
          builder.then = ((onFulfilled: unknown, onRejected: unknown) =>
            Promise.reject(new Error("socket hang up")).then(
              onFulfilled as never,
              onRejected as never
            )) as Chainable["then"];
        }
        return builder;
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

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;

const sessionUser = (id: string) => ({ data: { user: { id } }, error: null });

/** A save doc this build understands (docVersion 1). */
const doc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  docVersion: 1,
  ideas: [],
  businesses: [],
  ...over,
});

const STAMP_EARLY = 1_700_000_000_000;
const STAMP_LATE = 1_700_000_002_000;

/**
 * Two families. Parent A has three children: one deep into the path, one who
 * has never signed in (roster row, no profile, no save), and one never
 * provisioned into FP (no fp_username). Parent B has ONE child, and every
 * assertion about isolation is against that row.
 */
function seed(): void {
  store.value = {
    parents: [
      { id: PARENT_A, email: "a@example.com", first_name: "Robin" },
      { id: PARENT_B, email: "b@example.com", first_name: "Sam" },
    ],
    children: [
      { id: "c-a1", parent_id: PARENT_A, first_name: "Alex", last_name: "Ng", fp_username: "alex" },
      { id: "c-a2", parent_id: PARENT_A, first_name: "Eve", last_name: "Ng", fp_username: "eve" },
      // Not provisioned into FP at all → never in the query.
      { id: "c-a3", parent_id: PARENT_A, first_name: "Ivy", last_name: "Ng", fp_username: null },
      // ⚠ ANOTHER FAMILY'S CHILD. Must never appear on parent A's wire.
      { id: "c-b1", parent_id: PARENT_B, first_name: "Bo", last_name: "Diaz", fp_username: "bo" },
    ],
    fp_player_profiles: [
      { id: "p-a1", child_id: "c-a1", user_id: "u-a1" },
      { id: "p-b1", child_id: "c-b1", user_id: "u-b1" },
    ],
    fp_player_saves: [
      {
        profile_id: "p-a1",
        doc: doc({
          ideas: [
            {
              id: "idea-a",
              fields: { productName: "Dog Treats" },
              done: { "1.1#0": true },
              doneAt: { "1.1#0": STAMP_EARLY },
              doneByTask: { "1.2.1": true, "3.1.1": true },
              doneAtByTask: { "1.2.1": STAMP_EARLY, "3.1.1": STAMP_LATE },
            },
          ],
          businesses: [{ id: "b-1", ideaId: "idea-a", archived: false, doneByTask: {} }],
        }),
      },
      { profile_id: "p-b1", doc: doc({ ideas: [{ id: "idea-b", doneByTask: { "1.1.1": true } }] }) },
    ],
  } as Store;
}

const requestFor = (opts?: { origin?: string; token?: string | null }): Request => {
  const headers: Record<string, string> = { origin: opts?.origin ?? ORIGIN };
  const token = opts?.token === undefined ? jwtFor(PARENT_A) : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/fp/parent/roster", { method: "GET", headers });
};

const get = (opts?: { origin?: string; token?: string | null }) =>
  import("@/app/api/fp/parent/roster/route").then((m) => m.GET(requestFor(opts)));

type RosterChild = {
  id: string;
  firstName: string;
  lastName: string;
  fpUsername: string;
  truncated: boolean;
  docUnreadable: boolean;
  ideas: Record<string, unknown>[];
  businesses: Record<string, unknown>[];
};
type Body = { ok: boolean; children: RosterChild[] };

const usernames = async (res: Response): Promise<string[]> =>
  ((await res.json()) as Body).children.map((c) => c.fpUsername).sort();

/** Every key AND every string leaf anywhere in a JSON value. */
function walkJson(value: unknown, keys: Set<string>, leaves: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) walkJson(v, keys, leaves);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      walkJson(v, keys, leaves);
    }
    return;
  }
  if (typeof value === "string") leaves.add(value);
}

/** Status + body + the sorted header set — the unit refusal parity is asserted in. */
const snapshotOf = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).sort(),
});

const childrenQuery = (): RecordedCall | undefined =>
  dbCalls.find((c) => c.table === "children");

describe("GET /api/fp/parent/roster — the parent dashboard roster feed", () => {
  beforeEach(() => {
    seed();
    faults.value = {};
    callLog.length = 0;
    dbCalls.length = 0;
    throwingTables.clear();
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

  it("answers 200 with the RAW, unfiltered completion maps, including a never-signed-in child", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.ok).toBe(true);

    const alex = body.children.find((c) => c.fpUsername === "alex")!;
    expect(alex).toEqual({
      id: "c-a1",
      firstName: "Alex",
      lastName: "Ng",
      fpUsername: "alex",
      truncated: false,
      docUnreadable: false,
      ideas: [
        {
          index: 0,
          id: "idea-a",
          // ⚠ UNFILTERED, and that is the contract: the staff feed keeps only
          // the requested task ids, this door sends everything the child has,
          // because the FP client derives n/total from its OWN curriculum data.
          done: { "1.1#0": true },
          doneAt: { "1.1#0": STAMP_EARLY },
          doneByTask: { "1.2.1": true, "3.1.1": true },
          doneAtByTask: { "1.2.1": STAMP_EARLY, "3.1.1": STAMP_LATE },
          lastCompletionAt: STAMP_LATE,
          lastCorroboratedCompletionAt: STAMP_LATE,
          recencyClamped: false,
        },
      ],
      businesses: [
        {
          id: "b-1",
          ideaId: "idea-a",
          archived: false,
          doneByTask: {},
          doneAtByTask: {},
          lastCompletionAt: null,
          lastCorroboratedCompletionAt: null,
          recencyClamped: false,
        },
      ],
    });

    // Present, empty, and NOT flagged unreadable — "never signed in" is a card,
    // not an omission. Dropping the row would delete a kid from their own
    // parent's dashboard.
    expect(body.children.find((c) => c.fpUsername === "eve")).toEqual({
      id: "c-a2",
      firstName: "Eve",
      lastName: "Ng",
      fpUsername: "eve",
      truncated: false,
      docUnreadable: false,
      ideas: [],
      businesses: [],
    });

    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("excludes a child with no fp_username — the roster filter is the FP-enrolment filter", async () => {
    expect(await usernames(await get())).toEqual(["alex", "eve"]);
  });

  it("reads NO birth_year, grade or photo, and no table beyond the four it needs", async () => {
    await get();
    expect(childrenQuery()!.columns).toBe("id, first_name, last_name, fp_username");
    expect(new Set(callLog.filter((c) => c.startsWith("db:")))).toEqual(
      new Set(["db:parents", "db:children", "db:fp_player_profiles", "db:fp_player_saves"])
    );
  });

  it("an FP-less roster answers {ok, children: []} without downstream round trips", async () => {
    store.value.children = [];
    faults.value["select:fp_player_profiles"] = {
      kind: "error",
      error: { message: "must not run" },
    };
    faults.value["select:fp_player_saves"] = { kind: "error", error: { message: "must not run" } };
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, children: [] });
  });

  // ── SCOPING: the security boundary ──

  describe("cross-parent isolation — the whole point of this route", () => {
    it("parent A never sees parent B's child, in the BODY or at any depth", async () => {
      const res = await get();
      const parsed = await res.json();
      const keys = new Set<string>();
      const leaves = new Set<string>();
      walkJson(parsed, keys, leaves);
      // The other family's child id, name and username are all absent.
      for (const secret of ["c-b1", "Bo", "Diaz", "bo", "idea-b"]) {
        expect(leaves.has(secret), secret).toBe(false);
      }
      expect((parsed as Body).children.map((c) => c.id).sort()).toEqual(["c-a1", "c-a2"]);
    });

    it("the children query as ISSUED filters on the AUTHENTICATED parent id", async () => {
      // Asserted against the QUERY, not the body: a body assertion alone cannot
      // tell "filtered correctly" from "the fixture happened to be small", and
      // these reads run with the SERVICE ROLE, so this `.eq` is the entire
      // authorization for another family's data.
      await get();
      expect(childrenQuery()!.filters).toContainEqual({
        op: "eq",
        col: "parent_id",
        value: PARENT_A,
      });
    });

    it("the scope follows the VERIFIED identity, never the token's own claim", async () => {
      // A forged/stale `sub` claiming to be parent B while getUser() resolves
      // parent A must still read parent A's roster: the sub is a rate-limit
      // bucket segment only.
      const res = await get({ token: jwtFor(PARENT_B) });
      expect(res.status).toBe(200);
      expect(childrenQuery()!.filters).toContainEqual({
        op: "eq",
        col: "parent_id",
        value: PARENT_A,
      });
      expect(await usernames(res)).toEqual(["alex", "eve"]);
    });

    it("parent B, signed in as themselves, sees exactly their own child", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B)) as unknown as GetUserFn;
      const res = await get({ token: jwtFor(PARENT_B) });
      expect(res.status).toBe(200);
      expect(await usernames(res)).toEqual(["bo"]);
    });
  });

  // ── The refusals: one voice ──

  describe("one byte-identical 401 for every authorization-shaped refusal", () => {
    it("a KID's bearer — authentic, but no parents row — is refused, and reads NO roster", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(KID_USER)) as unknown as GetUserFn;
      const res = await get({ token: jwtFor(KID_USER) });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_ROSTER_REFUSAL_BODY);
      // The gate is BEFORE the roster read — a non-parent must not be able to
      // make this endpoint touch the children table at all.
      expect(callLog).not.toContain("db:children");
      expect(rateRef.released).toEqual([]); // a non-parent probe keeps its strike
    });

    it("a missing bearer, a blank bearer and an unparseable one refuse before ANY DB I/O", async () => {
      for (const token of [null, "", "   ", "not-a-jwt"]) {
        callLog.length = 0;
        const res = await get({ token });
        expect(res.status).toBe(401);
        expect(await res.text()).toBe(PARENT_ROSTER_REFUSAL_BODY);
        expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
      }
    });

    it("an invalid/expired token is refused with the same bytes, strike standing", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } }) as unknown as GetUserFn;
      const res = await get();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_ROSTER_REFUSAL_BODY);
      expect(rateRef.released).toEqual([]);
    });

    it("a saturated bucket refuses BEFORE any DB I/O, with the same bytes and no 429", async () => {
      // No forwarded-for header on the fixture request, so the attested IP is
      // `extractClientIp`'s "unknown" sentinel.
      const { userKey } = deriveParentRosterRateLimitKeys("unknown", PARENT_A);
      rateRef.deny.add(userKey);
      const res = await get();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PARENT_ROSTER_REFUSAL_BODY);
      expect(res.headers.get("retry-after")).toBeNull();
      // The limiter is recorded before the gate and before any read: nothing
      // authorization-shaped is free to hammer.
      expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
      // BOTH buckets record before either verdict, so the per-IP aggregate keeps
      // accumulating for a saturated user bucket.
      expect(rateRef.recorded).toHaveLength(2);
    });

    it("records both roster budgets, in this route's OWN namespaces", async () => {
      await get();
      expect(rateRef.recorded.map((r) => r.config)).toEqual([
        PARENT_ROSTER_RATE_LIMIT,
        PARENT_ROSTER_IP_RATE_LIMIT,
      ]);
      expect(rateRef.recorded[0]!.key.startsWith("fp-parent-roster:")).toBe(true);
      expect(rateRef.recorded[1]!.key.startsWith("fp-parent-roster-ip:")).toBe(true);
    });

    it("EVERY refusal reason is byte-identical in status, body AND headers", async () => {
      // Headers are exactly where a per-reason oracle creeps back in, so the
      // whole response — not just the body — is snapshotted per reason.
      const snapshots: Record<string, Awaited<ReturnType<typeof snapshotOf>>> = {};

      snapshots.missing_token = await snapshotOf(await get({ token: null }));

      snapshots.invalid_sub = await snapshotOf(await get({ token: "garbage" }));

      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue({ data: { user: null }, error: { message: "bad" } }) as unknown as GetUserFn;
      snapshots.bad_token = await snapshotOf(await get());

      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(KID_USER)) as unknown as GetUserFn;
      snapshots.not_parent = await snapshotOf(await get({ token: jwtFor(KID_USER) }));

      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_A)) as unknown as GetUserFn;
      rateRef.allowed = false;
      snapshots.rate_limited = await snapshotOf(await get());
      rateRef.allowed = true;

      faults.value["select:children"] = { kind: "error", error: { message: "db down" } };
      snapshots.outage = await snapshotOf(await get());

      const values = Object.values(snapshots);
      for (const snap of values) {
        expect(snap.status).toBe(401);
        expect(snap).toEqual(values[0]);
      }
      expect(values[0]!.body).toBe(PARENT_ROSTER_REFUSAL_BODY);
    });
  });

  // ── Outage vs. deterministic: the strike policy ──

  describe("strike policy", () => {
    it("a roster read OUTAGE refunds both strikes — our downtime is not their budget", async () => {
      faults.value["select:children"] = { kind: "error", error: { message: "db down" } };
      const res = await get();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
    });

    it("a REJECTED read (not an in-band error) is the same outage, with the same refund", async () => {
      // `withFwTimeout` is Promise.race and does not catch, so an unwrapped
      // throw would reach the outer catch — which leaves the strike standing,
      // while the identical failure arriving as `res.error` refunds it.
      throwingTables.add("fp_player_profiles");
      const res = await get();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
    });

    it("a STALLED read is an outage too — the round trip is bounded", async () => {
      faults.value["select:children"] = { kind: "hang" };
      const mod = await import("@/app/api/fp/parent/roster/route");
      vi.useFakeTimers();
      let res: Response;
      try {
        const pending = mod.GET(requestFor());
        await vi.advanceTimersByTimeAsync(PARENT_ROSTER_READ_TIMEOUT_MS + 50);
        res = await pending;
      } finally {
        vi.useRealTimers();
      }
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
    });

    it("a capacity breach is DETERMINISTIC: refused, and NOT refunded", async () => {
      // Refunding a repeatable refusal would make the most expensive path in
      // the route free to loop.
      store.value.children = Array.from({ length: PARENT_ROSTER_MAX_CHILDREN + 1 }, (_, i) => ({
        id: `kid-${String(i).padStart(4, "0")}`,
        parent_id: PARENT_A,
        first_name: `Kid${i}`,
        last_name: "Ng",
        fp_username: `kid${i}`,
      }));
      const res = await get();
      expect(res.status).toBe(401);
      expect(rateRef.released).toEqual([]);
    });

    it("exactly the cap is SERVED", async () => {
      store.value.children = Array.from({ length: PARENT_ROSTER_MAX_CHILDREN }, (_, i) => ({
        id: `kid-${String(i).padStart(4, "0")}`,
        parent_id: PARENT_A,
        first_name: `Kid${i}`,
        last_name: "Ng",
        fp_username: `kid${i}`,
      }));
      store.value.fp_player_profiles = [];
      store.value.fp_player_saves = [];
      const res = await get();
      expect(res.status).toBe(200);
      expect(((await res.json()) as Body).children).toHaveLength(PARENT_ROSTER_MAX_CHILDREN);
    });
  });

  // ── Degrade, never throw ──

  describe("abnormal save docs degrade into a card rather than a 500", () => {
    it("a doc this build cannot read is flagged docUnreadable, not dropped", async () => {
      store.value.fp_player_saves = [{ profile_id: "p-a1", doc: { docVersion: 99, ideas: [] } }];
      const res = await get();
      expect(res.status).toBe(200);
      const alex = ((await res.json()) as Body).children.find((c) => c.fpUsername === "alex")!;
      expect(alex).toMatchObject({ docUnreadable: true, ideas: [], businesses: [] });
    });

    it("a null / non-object doc is the same degradation", async () => {
      store.value.fp_player_saves = [{ profile_id: "p-a1", doc: null }];
      const res = await get();
      expect(res.status).toBe(200);
      const alex = ((await res.json()) as Body).children.find((c) => c.fpUsername === "alex")!;
      expect(alex.docUnreadable).toBe(true);
    });

    it("an ABSENT save row is 'never started', which is NOT the same as unreadable", async () => {
      // Two empty rows that mean different things must not collapse into one:
      // absent = never signed in, unreadable = the kid sees a blank game too.
      store.value.fp_player_saves = [];
      const res = await get();
      const alex = ((await res.json()) as Body).children.find((c) => c.fpUsername === "alex")!;
      expect(alex).toMatchObject({ docUnreadable: false, ideas: [], businesses: [] });
    });

    it("a hostile doc TRUNCATES and flags rather than throwing", async () => {
      store.value.fp_player_saves = [
        {
          profile_id: "p-a1",
          doc: doc({
            ideas: [
              {
                id: "idea-a",
                // An over-long map key is SKIPPED (never sliced to a prefix,
                // which would collide with a real task id) and flags the child.
                doneByTask: { ["x".repeat(200)]: true, "1.1.1": true },
              },
            ],
          }),
        },
      ];
      const res = await get();
      expect(res.status).toBe(200);
      const alex = ((await res.json()) as Body).children.find((c) => c.fpUsername === "alex")!;
      expect(alex.truncated).toBe(true);
      expect(alex.ideas[0]!.doneByTask).toEqual({ "1.1.1": true });
    });
  });

  // ── Origin ──

  describe("origin discipline", () => {
    it("a disallowed Origin is a bodyless 403 with NO CORS echo, and no work at all", async () => {
      const res = await get({ origin: "https://evil.example" });
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(callLog).toEqual([]);
    });

    it("OPTIONS from an allowed origin is a 204 preflight echoing it and allowing authorization", async () => {
      const mod = await import("@/app/api/fp/parent/roster/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/roster", {
          method: "OPTIONS",
          headers: { origin: ORIGIN },
        })
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe("authorization");
    });

    it("OPTIONS from a disallowed origin is a bodyless 403", async () => {
      const mod = await import("@/app/api/fp/parent/roster/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/roster", {
          method: "OPTIONS",
          headers: { origin: "https://evil.example" },
        })
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
});
