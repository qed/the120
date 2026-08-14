import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  fakeClient,
  type FaultPlan,
  type RecordedCall,
  type Row,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  deriveSiteVisibilityRateLimitKeys,
  SITE_VISIBILITY_IP_RATE_LIMIT,
  SITE_VISIBILITY_RATE_LIMIT,
  SITE_VISIBILITY_REFUSAL_BODY,
} from "../site-visibility-rules";
import { deriveSiteStatus } from "@/app/lib/fp/fp-public-site-rules";

/**
 * Route-level coverage for POST /api/fp/parent/site-visibility — the parent's
 * take-the-page-offline door. Asserts the wiring the pure rules cannot:
 *
 *   - OWNERSHIP IS THE SECURITY BOUNDARY, and the id comes from the CLIENT.
 *     Parent A cannot flip parent B's child's page, the row is untouched, and
 *     the core's children read as ISSUED carries `parent_id = <the
 *     AUTHENTICATED id>` — asserted against `dbCalls`, because a response
 *     assertion alone cannot tell "scoped correctly" from "the fixture was
 *     small".
 *   - The DB EFFECT: the `published` column really moves, `first_published_at`
 *     survives an unpublish, and an OPERATOR LOCK survives a republish.
 *   - The byte-identical refusal — body AND headers — across every reason.
 */

type GetUserFn = Mock<() => Promise<unknown>>;

const { store, faults, tokenRef, rateRef, callLog, dbCalls } = vi.hoisted(() => ({
  store: { value: {} as Store },
  faults: { value: {} as FaultPlan },
  tokenRef: { getUser: vi.fn() as unknown as GetUserFn },
  rateRef: {
    allowed: true,
    deny: new Set<string>(),
    recorded: [] as { key: string; config: unknown }[],
    released: [] as string[],
  },
  callLog: [] as string[],
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

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;

const sessionUser = (id: string) => ({ data: { user: { id } }, error: null });

/**
 * Two families. Parent A has three children: one with a LIVE page, one with a
 * page that was CLAIMED but never published, and one with no page at all.
 * Parent B has ONE child with a live page, and every isolation assertion is
 * against that row.
 */
function seed(): void {
  store.value = {
    parents: [
      { id: PARENT_A, email: "a@example.com", first_name: "Robin" },
      { id: PARENT_B, email: "b@example.com", first_name: "Sam" },
    ],
    children: [
      { id: "aaaaaaa1-0000-4000-8000-000000000001", parent_id: PARENT_A, first_name: "Alex", last_name: "Ng", fp_username: "alex" },
      { id: "aaaaaaa1-0000-4000-8000-000000000002", parent_id: PARENT_A, first_name: "Eve", last_name: "Ng", fp_username: "eve" },
      // No profile, so no page.
      { id: "aaaaaaa1-0000-4000-8000-000000000003", parent_id: PARENT_A, first_name: "Ivy", last_name: "Ng", fp_username: "ivy" },
      // ⚠ ANOTHER FAMILY'S CHILD.
      { id: "bbbbbbb1-0000-4000-8000-000000000001", parent_id: PARENT_B, first_name: "Bo", last_name: "Diaz", fp_username: "bo" },
    ],
    fp_player_profiles: [
      { id: "p-a1", child_id: "aaaaaaa1-0000-4000-8000-000000000001", user_id: "u-a1" },
      { id: "p-a2", child_id: "aaaaaaa1-0000-4000-8000-000000000002", user_id: "u-a2" },
      { id: "p-b1", child_id: "bbbbbbb1-0000-4000-8000-000000000001", user_id: "u-b1" },
    ],
    fp_public_sites: [
      {
        profile_id: "p-a1",
        handle: "alex-treats",
        published: true,
        operator_locked: false,
        first_published_at: "2026-01-01T00:00:00.000Z",
      },
      // CLAIMED but never published — a parent RESTORES a page, they do not
      // launch one.
      {
        profile_id: "p-a2",
        handle: "eve-crafts",
        published: false,
        operator_locked: false,
        first_published_at: null,
      },
      {
        profile_id: "p-b1",
        handle: "bo-cookies",
        published: true,
        operator_locked: false,
        first_published_at: "2026-01-01T00:00:00.000Z",
      },
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
  return new Request("http://localhost/api/fp/parent/site-visibility", {
    method: "POST",
    headers,
    body: opts?.rawBody ?? JSON.stringify(opts?.body ?? { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: false }),
  });
};

const post = (opts?: Parameters<typeof requestFor>[0]) =>
  import("@/app/api/fp/parent/site-visibility/route").then((m) => m.POST(requestFor(opts)));

const snapshotOf = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).sort(),
});

const siteFor = (profileId: string): Row =>
  (store.value.fp_public_sites as Row[]).find((s) => s.profile_id === profileId)!;

/** What the PUBLIC would see — the derived ladder, not the raw column. */
const publicStatus = (profileId: string): string =>
  deriveSiteStatus(siteFor(profileId) as never);

const consoleOutput = (): string =>
  [
    ...(console.error as unknown as Mock).mock.calls,
    ...(console.log as unknown as Mock).mock.calls,
  ]
    .flat()
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join("\n");

describe("POST /api/fp/parent/site-visibility — the parent's take-offline door", () => {
  beforeEach(() => {
    seed();
    faults.value = {};
    callLog.length = 0;
    dbCalls.length = 0;
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

  // ── The happy paths, and the DB effect ──

  describe("the toggle", () => {
    it("takes a live page OFFLINE — and keeps the ever-published stamp", async () => {
      expect(publicStatus("p-a1")).toBe("published");

      const res = await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: false } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      expect(siteFor("p-a1").published).toBe(false);
      // `first_published_at` STAYS: it is the R9d discriminator that makes the
      // public page render OFFLINE rather than `unclaimed`.
      expect(siteFor("p-a1").first_published_at).toBe("2026-01-01T00:00:00.000Z");
      expect(publicStatus("p-a1")).toBe("offline");

      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    });

    it("puts an ever-published page back online, and is idempotent", async () => {
      await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: false } });
      const res = await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: true } });
      expect(res.status).toBe(200);
      expect(publicStatus("p-a1")).toBe("published");
      // Twice is the same answer, not an error.
      expect((await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: true } })).status).toBe(200);
      expect(publicStatus("p-a1")).toBe("published");
    });

    it("REFUSES to launch a never-published page — a parent restores, they do not publish", async () => {
      const res = await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000002", published: true } });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(SITE_VISIBILITY_REFUSAL_BODY);
      // Nothing was written: the claimed page stays claimed.
      expect(siteFor("p-a2").published).toBe(false);
      expect(publicStatus("p-a2")).toBe("claimed");
      // Deterministic and repeatable: the strike is NOT refunded.
      expect(rateRef.released).toEqual([]);
    });

    it("⚠ AN OPERATOR LOCK ALWAYS WINS a republish", async () => {
      siteFor("p-a1").operator_locked = true;
      siteFor("p-a1").published = false;
      const res = await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: true } });
      // The flag flips — and the page STAYS OFFLINE, because the lock is not in
      // the UPDATE payload and `deriveSiteStatus` keeps a locked page offline.
      expect(res.status).toBe(200);
      expect(siteFor("p-a1").operator_locked).toBe(true);
      expect(publicStatus("p-a1")).toBe("offline");
    });

    it("touches ONLY the named child's page", async () => {
      await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: false } });
      expect(siteFor("p-a2").published).toBe(false);
      expect(siteFor("p-b1").published).toBe(true);
    });

    it("a child with NO page is the same refusal as a foreign child", async () => {
      const noPage = await snapshotOf(await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000003", published: false } }));
      const foreign = await snapshotOf(await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", published: false } }));
      expect(noPage).toEqual(foreign);
    });

    it("NEVER logs the token or the handle", async () => {
      await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: false } });
      const output = consoleOutput();
      expect(output.includes(jwtFor(PARENT_A))).toBe(false);
      // The handle is the child's public identity; the child id already names
      // the row an operator would open.
      expect(output.includes("alex-treats")).toBe(false);
      expect(output.includes(PARENT_A)).toBe(true);
      expect(output.includes("aaaaaaa1-0000-4000-8000-000000000001")).toBe(true);
    });
  });

  // ── OWNERSHIP: the security boundary ──

  describe("cross-parent isolation — the whole point of taking a childId", () => {
    it("parent A cannot take parent B's child's page offline", async () => {
      const res = await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", published: false } });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(SITE_VISIBILITY_REFUSAL_BODY);
      // THE assertion this route exists to keep true.
      expect(siteFor("p-b1").published).toBe(true);
      expect(publicStatus("p-b1")).toBe("published");
      expect(callLog.filter((c) => c === "db:fp_public_sites")).toEqual([]);
      expect(rateRef.released).toEqual([]);
    });

    it("the core's child read as ISSUED filters on the AUTHENTICATED parent id", async () => {
      // Asserted against the QUERY: the reads run with the SERVICE ROLE, so
      // this `.eq` is the entire authorization for another family's page.
      await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", published: false } });
      const q = dbCalls.find((c) => c.table === "children" && c.op === "select")!;
      expect(q.filters).toContainEqual({ op: "eq", col: "id", value: "bbbbbbb1-0000-4000-8000-000000000001" });
      expect(q.filters).toContainEqual({ op: "eq", col: "parent_id", value: PARENT_A });
    });

    it("the scope follows the VERIFIED identity, never the token's own claim", async () => {
      const res = await post({ token: jwtFor(PARENT_B), body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", published: false } });
      expect(res.status).toBe(401);
      expect(siteFor("p-b1").published).toBe(true);
      const q = dbCalls.find((c) => c.table === "children" && c.op === "select")!;
      expect(q.filters).toContainEqual({ op: "eq", col: "parent_id", value: PARENT_A });
    });

    it("parent B, signed in as themselves, CAN take that same page offline", async () => {
      // The mirror of the refusal above — proves the isolation test is failing
      // for the right reason and not because the fixture is unflippable.
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B)) as unknown as GetUserFn;
      const res = await post({ token: jwtFor(PARENT_B), body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", published: false } });
      expect(res.status).toBe(200);
      expect(siteFor("p-b1").published).toBe(false);
    });
  });

  // ── The refusals: one voice ──

  describe("one byte-identical 401 for every authorization-shaped refusal", () => {
    it("a KID's bearer — authentic, but no parents row — is refused before any write", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(KID_USER)) as unknown as GetUserFn;
      const res = await post({ token: jwtFor(KID_USER) });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(SITE_VISIBILITY_REFUSAL_BODY);
      // A CHILD must not be able to put their own page back online, or take
      // anyone else's down.
      expect(callLog).not.toContain("db:children");
      expect(siteFor("p-a1").published).toBe(true);
      expect(rateRef.released).toEqual([]);
    });

    it("a missing, blank or unparseable bearer refuses before ANY DB I/O", async () => {
      for (const token of [null, "", "   ", "not-a-jwt"]) {
        callLog.length = 0;
        const res = await post({ token });
        expect(res.status).toBe(401);
        expect(await res.text()).toBe(SITE_VISIBILITY_REFUSAL_BODY);
        expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
      }
    });

    it("an invalid/expired token is refused with the same bytes, strike standing", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } }) as unknown as GetUserFn;
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toEqual([]);
      expect(siteFor("p-a1").published).toBe(true);
    });

    it("a malformed body is refused — including a caller-supplied handle", async () => {
      const bodies: Parameters<typeof requestFor>[0][] = [
        { rawBody: "not json at all" },
        { body: {} },
        { body: { childId: "aaaaaaa1-0000-4000-8000-000000000001" } },
        { body: { published: false } },
        { body: { childId: "", published: false } },
        { body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: "false" } },
        // The site is never addressed by a client-supplied key.
        { body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", published: false, handle: "alex-treats" } },
      ];
      for (const opts of bodies) {
        const res = await post(opts);
        expect(res.status, JSON.stringify(opts)).toBe(401);
        expect(await res.text()).toBe(SITE_VISIBILITY_REFUSAL_BODY);
        expect(siteFor("p-a1").published).toBe(true);
      }
    });

    it("a saturated bucket refuses BEFORE the body is read, with no 429", async () => {
      const { userKey } = deriveSiteVisibilityRateLimitKeys("unknown", PARENT_A);
      rateRef.deny.add(userKey);
      const res = await post();
      expect(res.status).toBe(401);
      expect(res.headers.get("retry-after")).toBeNull();
      expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
      expect(rateRef.recorded).toHaveLength(2);
    });

    it("records both budgets, in this door's OWN namespaces", async () => {
      await post();
      expect(rateRef.recorded.map((r) => r.config)).toEqual([
        SITE_VISIBILITY_RATE_LIMIT,
        SITE_VISIBILITY_IP_RATE_LIMIT,
      ]);
      expect(rateRef.recorded[0]!.key.startsWith("fp-parent-site-visibility:")).toBe(true);
      expect(rateRef.recorded[1]!.key.startsWith("fp-parent-site-visibility-ip:")).toBe(true);
    });

    it("EVERY refusal reason is byte-identical in status, body AND headers", async () => {
      const snapshots: Record<string, Awaited<ReturnType<typeof snapshotOf>>> = {};

      snapshots.missing_token = await snapshotOf(await post({ token: null }));
      snapshots.invalid_sub = await snapshotOf(await post({ token: "garbage" }));
      snapshots.malformed = await snapshotOf(await post({ body: { nope: 1 } }));
      snapshots.not_owned = await snapshotOf(
        await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", published: false } })
      );
      snapshots.no_site = await snapshotOf(
        await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000003", published: false } })
      );
      snapshots.never_published = await snapshotOf(
        await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000002", published: true } })
      );

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

      faults.value["update:fp_public_sites"] = { kind: "error", error: { message: "db down" } };
      snapshots.outage = await snapshotOf(await post());
      faults.value = {};

      const values = Object.values(snapshots);
      for (const snap of values) {
        expect(snap.status).toBe(401);
        expect(snap).toEqual(values[0]);
      }
      expect(values[0]!.body).toBe(SITE_VISIBILITY_REFUSAL_BODY);
    });
  });

  // ── Outage vs. deterministic: the strike policy ──

  describe("strike policy", () => {
    it("a write OUTAGE refunds both strikes, and the page does not move", async () => {
      faults.value["update:fp_public_sites"] = { kind: "error", error: { message: "db down" } };
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
      expect(siteFor("p-a1").published).toBe(true);
    });

    it("a child-read outage refunds too", async () => {
      faults.value["select:children"] = { kind: "error", error: { message: "db down" } };
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
      expect(siteFor("p-a1").published).toBe(true);
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
      const mod = await import("@/app/api/fp/parent/site-visibility/route");
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
      expect(siteFor("p-a1").published).toBe(true);
    });

    it("a STALLED core write is an outage too", async () => {
      faults.value["update:fp_public_sites"] = { kind: "hang" };
      const mod = await import("@/app/api/fp/parent/site-visibility/route");
      vi.useFakeTimers();
      let res: Response;
      try {
        const pending = mod.POST(requestFor());
        await vi.advanceTimersByTimeAsync(40_000);
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
      expect(siteFor("p-a1").published).toBe(true);
    });

    it("OPTIONS from an allowed origin is a 204 preflight allowing POST + the JSON body", async () => {
      const mod = await import("@/app/api/fp/parent/site-visibility/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/site-visibility", {
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
      const mod = await import("@/app/api/fp/parent/site-visibility/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/site-visibility", {
          method: "OPTIONS",
          headers: { origin: "https://evil.example" },
        })
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
});
