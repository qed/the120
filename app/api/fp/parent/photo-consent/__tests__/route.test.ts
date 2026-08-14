import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  fakeClient,
  type FaultPlan,
  type RecordedCall,
  type Row,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  derivePhotoConsentRateLimitKeys,
  PHOTO_CONSENT_IP_RATE_LIMIT,
  PHOTO_CONSENT_RATE_LIMIT,
  PHOTO_CONSENT_REFUSAL_BODY,
} from "../photo-consent-rules";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";
import { loadPhotoConsentOpenIds } from "@/app/lib/fp/photo-consent-read";

/**
 * Route-level coverage for POST /api/fp/parent/photo-consent — the parent's
 * GRANT / WITHDRAW door for a child's photo permission. Asserts the wiring the
 * pure rules cannot:
 *
 *   - OWNERSHIP IS THE SECURITY BOUNDARY, and the id comes from the CLIENT.
 *     Parent A cannot touch parent B's child's consent, NOTHING is written, and
 *     the core's ownership read as ISSUED carries `parent_id = <the
 *     AUTHENTICATED id>` — asserted against `dbCalls`, not merely against the
 *     response, because a response assertion alone cannot tell "scoped
 *     correctly" from "the fixture was small".
 *   - THE EVIDENCE IS SERVER-DERIVED. The row records the SESSION's email, the
 *     request's ip and user-agent, and a band derived from the CHILD'S OWN ROW —
 *     never anything the body said.
 *   - The DB EFFECT, both ways: a withdrawal really closes the gate (asserted
 *     by re-reading it through the SAME loader the roster door uses), and a
 *     grant really inserts a consent row.
 *   - The ONE non-401 answer: `stale_policy`, as a 200 with an ok:false body.
 *   - The byte-identical refusal — body AND headers — across every reason.
 *
 * The fake client runs with `perturbUnordered` ON, matching the sibling doors.
 */

type GetUserFn = Mock<() => Promise<unknown>>;

const { store, faults, tokenRef, rateRef, callLog, dbCalls } = vi.hoisted(() => ({
  store: { value: {} as Store },
  faults: { value: {} as FaultPlan },
  tokenRef: { getUser: vi.fn() as unknown as GetUserFn },
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
const PARENT_A_EMAIL = "a@example.com";

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;

const sessionUser = (id: string, email?: string) => ({
  data: { user: { id, email } },
  error: null,
});

/** The echo a client that rendered the CURRENT policy would send. */
const goodEcho = () => ({
  consentVersion: FP_CONSENT_POLICY.version,
  consentHash: currentPolicyHash(),
});

/**
 * Two families. Parent A has two children, one of them with an ALREADY OPEN
 * photo consent so the withdraw path has something to close. Parent B has ONE
 * child, also with an open consent, and every isolation assertion is against
 * that row: a leak would both read and DESTROY another family's evidence.
 */
function seed(): void {
  store.value = {
    parents: [
      { id: PARENT_A, email: PARENT_A_EMAIL, first_name: "Robin" },
      { id: PARENT_B, email: "b@example.com", first_name: "Sam" },
    ],
    children: [
      {
        id: "aaaaaaa1-0000-4000-8000-000000000001",
        parent_id: PARENT_A,
        first_name: "Alex",
        last_name: "Ng",
        fp_username: "alex",
        // grade 11 → age 16 → the band the server must derive on its own.
        grade: 11,
        photo_consent_revoked_at: null,
      },
      {
        id: "aaaaaaa1-0000-4000-8000-000000000002",
        parent_id: PARENT_A,
        first_name: "Eve",
        last_name: "Ng",
        fp_username: "eve",
        photo_consent_revoked_at: null,
      },
      // ⚠ ANOTHER FAMILY'S CHILD.
      {
        id: "bbbbbbb1-0000-4000-8000-000000000001",
        parent_id: PARENT_B,
        first_name: "Bo",
        last_name: "Diaz",
        fp_username: "bo",
        grade: 4,
        photo_consent_revoked_at: null,
      },
    ],
    fp_parental_consent: [
      {
        id: "consent-a1",
        signup_attempt_id: null,
        child_id: "aaaaaaa1-0000-4000-8000-000000000001",
        parent_id: PARENT_A,
        policy_version: FP_CONSENT_POLICY.version,
        accepted_at: new Date(Date.now() - 60_000).toISOString(),
        revoked_at: null,
        evidence: { source: "signup", echoed_version: FP_CONSENT_POLICY.version },
      },
      {
        id: "consent-b1",
        signup_attempt_id: null,
        child_id: "bbbbbbb1-0000-4000-8000-000000000001",
        parent_id: PARENT_B,
        policy_version: FP_CONSENT_POLICY.version,
        accepted_at: new Date(Date.now() - 60_000).toISOString(),
        revoked_at: null,
        evidence: { source: "signup" },
      },
    ],
  } as Store;
}

const requestFor = (opts?: {
  origin?: string;
  token?: string | null;
  body?: unknown;
  rawBody?: string;
  ua?: string;
  ip?: string;
}): Request => {
  const headers: Record<string, string> = {
    origin: opts?.origin ?? ORIGIN,
    "content-type": "application/json",
  };
  if (opts?.ua) headers["user-agent"] = opts.ua;
  if (opts?.ip) headers["x-forwarded-for"] = opts.ip;
  const token = opts?.token === undefined ? jwtFor(PARENT_A) : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/fp/parent/photo-consent", {
    method: "POST",
    headers,
    body: opts?.rawBody ?? JSON.stringify(opts?.body ?? { childId: "aaaaaaa1-0000-4000-8000-000000000001", action: "withdraw" }),
  });
};

const post = (opts?: Parameters<typeof requestFor>[0]) =>
  import("@/app/api/fp/parent/photo-consent/route").then((m) => m.POST(requestFor(opts)));

/** Status + body + the sorted header set — the unit refusal parity is asserted in. */
const snapshotOf = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).sort(),
});

const childRow = (id: string): Row =>
  (store.value.children as Row[]).find((c) => c.id === id)!;

const consentRows = (childId: string): Row[] =>
  ((store.value.fp_parental_consent as Row[] | undefined) ?? []).filter(
    (r) => r.child_id === childId
  );

/** Is the photo gate OPEN for this child, read through the SAME loader the
 *  roster door and the120's own dashboard use? */
const gateOpen = async (childId: string): Promise<boolean> => {
  const open = await loadPhotoConsentOpenIds(
    fakeClient(store.value, {}) as never,
    [childId]
  );
  return open !== null && open.has(childId);
};

/** Every string this invocation handed to console.*, flattened. */
const consoleOutput = (): string =>
  [
    ...(console.error as unknown as Mock).mock.calls,
    ...(console.log as unknown as Mock).mock.calls,
  ]
    .flat()
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join("\n");

describe("POST /api/fp/parent/photo-consent — the parent's grant/withdraw door", () => {
  beforeEach(() => {
    seed();
    faults.value = {};
    callLog.length = 0;
    dbCalls.length = 0;
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue(sessionUser(PARENT_A, PARENT_A_EMAIL)) as unknown as GetUserFn;
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

  // ── WITHDRAW ──

  describe("withdraw — the DB effect, and reading it back", () => {
    it("stamps the per-child tombstone, marks the evidence, and CLOSES the gate", async () => {
      // The gate is open before, which is what makes the after-assertion mean
      // something.
      expect(await gateOpen("aaaaaaa1-0000-4000-8000-000000000001")).toBe(true);

      const res = await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", action: "withdraw" } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // 1. THE TOMBSTONE — the purpose-scoped instrument.
      expect(typeof childRow("aaaaaaa1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBe("string");
      // 2. THE SECOND, INDEPENDENT MARK on the evidence blob, MERGED rather
      //    than clobbered: the legal blob accretes.
      const evidence = consentRows("aaaaaaa1-0000-4000-8000-000000000001")[0]!.evidence as Record<string, unknown>;
      expect(evidence.photo_declined).toBe(true);
      expect(evidence.source).toBe("signup"); // the pre-existing key survived
      // 3. ⚠ THE ROW IS NOT REVOKED. A parent who withdraws photo permission
      //    has not asked us to un-create their child's account.
      expect(consentRows("aaaaaaa1-0000-4000-8000-000000000001")[0]!.revoked_at).toBeNull();

      // ── WITHDRAW-THEN-READ: the gate the roster door reports is now closed.
      expect(await gateOpen("aaaaaaa1-0000-4000-8000-000000000001")).toBe(false);

      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    });

    it("touches ONLY the named child — a sibling's permission is untouched", async () => {
      await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", action: "withdraw" } });
      expect(childRow("aaaaaaa1-0000-4000-8000-000000000002").photo_consent_revoked_at).toBeNull();
    });

    it("NEVER logs the token, the parent's email or a child's name", async () => {
      await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", action: "withdraw" } });
      const output = consoleOutput();
      expect(output.includes(jwtFor(PARENT_A))).toBe(false);
      expect(output.includes(PARENT_A_EMAIL)).toBe(false);
      expect(output.includes("Alex")).toBe(false);
      // The audit breadcrumb IS there: who changed whose permission, which way.
      expect(output.includes(PARENT_A)).toBe(true);
      expect(output.includes("aaaaaaa1-0000-4000-8000-000000000001")).toBe(true);
      expect(output.includes("withdrew")).toBe(true);
    });
  });

  // ── GRANT ──

  describe("grant — a legal evidence record, derived by the SERVER", () => {
    it("inserts a consent row whose identity fields come from the server, not the body", async () => {
      // Close the gate first so the grant has visible work to do.
      store.value.fp_parental_consent = [];
      expect(await gateOpen("aaaaaaa1-0000-4000-8000-000000000001")).toBe(false);

      const res = await post({
        body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", action: "grant", ...goodEcho() },
        ua: "Mozilla/5.0 (test)",
        ip: "203.0.113.7",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const row = consentRows("aaaaaaa1-0000-4000-8000-000000000001")[0]!;
      // ⚠ EVERY LEGALLY LOAD-BEARING FIELD IS SERVER-DERIVED.
      expect(row.parent_identity).toEqual({ email: PARENT_A_EMAIL });
      expect(row.ip).toBe("203.0.113.7");
      expect(row.ua).toBe("Mozilla/5.0 (test)");
      // The band comes from the CHILD'S OWN ROW (grade 11 → age 16), never
      // from the request — which cannot even carry one.
      expect(row.child_age_band).toBe("16_plus");
      // The SERVER's current version/hash/text, not the echoed strings.
      expect(row.policy_version).toBe(FP_CONSENT_POLICY.version);
      expect(row.policy_hash).toBe(currentPolicyHash());
      expect(row.parent_id).toBe(PARENT_A);
      // Child-bound, attempt-less — the legacy-capture shape.
      expect(row.signup_attempt_id).toBeNull();
      expect((row.evidence as Record<string, unknown>).source).toBe(
        "dashboard_legacy_capture"
      );

      // …and the gate the roster door reports is now OPEN.
      expect(await gateOpen("aaaaaaa1-0000-4000-8000-000000000001")).toBe(true);
    });

    it("falls back to the MOST PROTECTIVE band when the child row carries no age", async () => {
      store.value.fp_parental_consent = [];
      const res = await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000002", action: "grant", ...goodEcho() } });
      expect(res.status).toBe(200);
      // Over-protecting a 16-year-old costs nothing; under-protecting a
      // 10-year-old is a compliance failure.
      expect(consentRows("aaaaaaa1-0000-4000-8000-000000000002")[0]!.child_age_band).toBe("under_13");
    });

    it("a STALE echo is 200 {ok:false, reason:'stale_policy'} — and writes NOTHING", async () => {
      store.value.fp_parental_consent = [];
      const res = await post({
        body: {
          childId: "aaaaaaa1-0000-4000-8000-000000000001",
          action: "grant",
          consentVersion: "2020-01-01.1",
          consentHash: "0".repeat(64),
        },
      });
      // ⚠ A 200, NOT A STATUS CODE. The SPA must re-present the current text
      // rather than tell a parent to try again forever.
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, reason: "stale_policy" });
      expect(consentRows("aaaaaaa1-0000-4000-8000-000000000001")).toEqual([]);
      // A real failed attempt against text the caller could have re-fetched:
      // the strike is NOT refunded.
      expect(rateRef.released).toEqual([]);
      // Same headers as every other answer — no oracle in the header set.
      expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("a MISMATCHED hash for the current version is stale too — bind-to-rendered", async () => {
      store.value.fp_parental_consent = [];
      const res = await post({
        body: {
          childId: "aaaaaaa1-0000-4000-8000-000000000001",
          action: "grant",
          consentVersion: FP_CONSENT_POLICY.version,
          consentHash: "f".repeat(64),
        },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, reason: "stale_policy" });
      expect(consentRows("aaaaaaa1-0000-4000-8000-000000000001")).toEqual([]);
    });
  });

  // ── OWNERSHIP: the security boundary ──

  describe("cross-parent isolation — the whole point of taking a childId", () => {
    it("parent A cannot WITHDRAW parent B's child's permission, and nothing changes", async () => {
      const res = await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", action: "withdraw" } });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PHOTO_CONSENT_REFUSAL_BODY);
      // THE assertion this route exists to keep true: the other family's
      // evidence is neither destroyed nor marked.
      expect(childRow("bbbbbbb1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBeNull();
      expect((consentRows("bbbbbbb1-0000-4000-8000-000000000001")[0]!.evidence as Record<string, unknown>).photo_declined).toBe(
        undefined
      );
      expect(await gateOpen("bbbbbbb1-0000-4000-8000-000000000001")).toBe(true);
      // A foreign-child probe keeps its strike — refunding it would make
      // enumerating another family's child ids free.
      expect(rateRef.released).toEqual([]);
    });

    it("parent A cannot GRANT for parent B's child — no row is inserted", async () => {
      const before = consentRows("bbbbbbb1-0000-4000-8000-000000000001").length;
      const res = await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", action: "grant", ...goodEcho() } });
      expect(res.status).toBe(401);
      expect(consentRows("bbbbbbb1-0000-4000-8000-000000000001")).toHaveLength(before);
      expect(rateRef.released).toEqual([]);
    });

    it("the core's ownership predicates as ISSUED carry the AUTHENTICATED parent id", async () => {
      // Asserted against the QUERY, not the response: the writes run with the
      // SERVICE ROLE, so these `.eq`s are the entire authorization for another
      // family's data, and a response assertion cannot see them.
      await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", action: "withdraw" } });
      const tombstone = dbCalls.find((c) => c.table === "children" && c.op === "update")!;
      expect(tombstone.filters).toContainEqual({ op: "eq", col: "id", value: "bbbbbbb1-0000-4000-8000-000000000001" });
      expect(tombstone.filters).toContainEqual({
        op: "eq",
        col: "parent_id",
        value: PARENT_A,
      });

      dbCalls.length = 0;
      await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", action: "grant", ...goodEcho() } });
      const ownership = dbCalls.filter((c) => c.table === "children" && c.op === "select");
      // EVERY children read this door makes is parent-scoped — the age-band
      // read included, so we never touch another family's row even to look.
      expect(ownership.length).toBeGreaterThan(0);
      for (const q of ownership) {
        expect(q.filters).toContainEqual({ op: "eq", col: "parent_id", value: PARENT_A });
      }
    });

    it("the scope follows the VERIFIED identity, never the token's own claim", async () => {
      // A forged/stale `sub` claiming to be parent B while getUser() resolves
      // parent A must still be scoped to parent A: the sub is a rate-limit
      // bucket segment only.
      const res = await post({
        token: jwtFor(PARENT_B),
        body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", action: "withdraw" },
      });
      expect(res.status).toBe(401);
      expect(childRow("bbbbbbb1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBeNull();
      const tombstone = dbCalls.find((c) => c.table === "children" && c.op === "update")!;
      expect(tombstone.filters).toContainEqual({
        op: "eq",
        col: "parent_id",
        value: PARENT_A,
      });
    });

    it("parent B, signed in as themselves, CAN withdraw for that same child", async () => {
      // The mirror of the refusal above — proves the isolation test is failing
      // for the right reason and not because the fixture is unwithdrawable.
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B, "b@example.com")) as unknown as GetUserFn;
      const res = await post({
        token: jwtFor(PARENT_B),
        body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", action: "withdraw" },
      });
      expect(res.status).toBe(200);
      expect(typeof childRow("bbbbbbb1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBe("string");
      expect(await gateOpen("bbbbbbb1-0000-4000-8000-000000000001")).toBe(false);
    });

    it("a nonexistent child is the SAME refusal as a foreign one — no existence oracle", async () => {
      const foreign = await snapshotOf(
        await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", action: "withdraw" } })
      );
      const missing = await snapshotOf(
        await post({ body: { childId: "no-such-child", action: "withdraw" } })
      );
      expect(missing).toEqual(foreign);
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
      expect(await res.text()).toBe(PHOTO_CONSENT_REFUSAL_BODY);
      // The gate is BEFORE the core — a non-parent must not make this endpoint
      // touch the children table at all.
      expect(callLog).not.toContain("db:children");
      expect(childRow("aaaaaaa1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBeNull();
      expect(rateRef.released).toEqual([]); // a non-parent probe keeps its strike
    });

    it("a missing, blank or unparseable bearer refuses before ANY DB I/O", async () => {
      for (const token of [null, "", "   ", "not-a-jwt"]) {
        callLog.length = 0;
        const res = await post({ token });
        expect(res.status).toBe(401);
        expect(await res.text()).toBe(PHOTO_CONSENT_REFUSAL_BODY);
        // Still before any DB I/O. (The body IS read first now, so the door can
      // tell the two directions apart and bill them separately — see the
      // route's own comment; parsing is bounded, allocation-only work.)
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
      expect(childRow("aaaaaaa1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBeNull();
    });

    it("a malformed body is refused — INCLUDING one that tries to set the age band", async () => {
      const bodies: Parameters<typeof requestFor>[0][] = [
        { rawBody: "not json at all" },
        { body: {} },
        { body: { childId: "aaaaaaa1-0000-4000-8000-000000000001" } },
        { body: { childId: "", action: "withdraw" } },
        { body: { childId: 7, action: "withdraw" } },
        { body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", action: "revoke" } },
        { body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", action: "grant" } },
        // ⚠ The band is SERVER-DERIVED. A caller-supplied one is refused, never
        // silently overruled — this is a legal evidence record.
        {
          body: {
            childId: "aaaaaaa1-0000-4000-8000-000000000001",
            action: "grant",
            ...goodEcho(),
            childAgeBand: "16_plus",
          },
        },
      ];
      for (const opts of bodies) {
        const res = await post(opts);
        expect(res.status, JSON.stringify(opts)).toBe(401);
        expect(await res.text()).toBe(PHOTO_CONSENT_REFUSAL_BODY);
        expect(childRow("aaaaaaa1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBeNull();
      }
    });

    it("a saturated bucket refuses BEFORE the body is read, with no 429", async () => {
      // No forwarded-for header on the fixture request, so the attested IP is
      // `extractClientIp`'s "unknown" sentinel.
      // The fixture posts a WITHDRAW, so that is the bucket it bills.
      const { userKey } = derivePhotoConsentRateLimitKeys("unknown", PARENT_A, "withdraw");
      rateRef.deny.add(userKey);
      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(PHOTO_CONSENT_REFUSAL_BODY);
      expect(res.headers.get("retry-after")).toBeNull();
      expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
      // BOTH buckets record before either verdict.
      expect(rateRef.recorded).toHaveLength(2);
    });

    it("records both budgets, in this door's OWN namespaces", async () => {
      await post();
      expect(rateRef.recorded.map((r) => r.config)).toEqual([
        PHOTO_CONSENT_RATE_LIMIT,
        PHOTO_CONSENT_IP_RATE_LIMIT,
      ]);
      expect(rateRef.recorded[0]!.key.startsWith("fp-parent-photo-consent-withdraw:")).toBe(true);
      expect(rateRef.recorded[1]!.key.startsWith("fp-parent-photo-consent-withdraw-ip:")).toBe(
        true
      );
    });

    it("EVERY refusal reason is byte-identical in status, body AND headers", async () => {
      // Headers are exactly where a per-reason oracle creeps back in, so the
      // whole response — not just the body — is snapshotted per reason.
      const snapshots: Record<string, Awaited<ReturnType<typeof snapshotOf>>> = {};

      snapshots.missing_token = await snapshotOf(await post({ token: null }));
      snapshots.invalid_sub = await snapshotOf(await post({ token: "garbage" }));
      snapshots.malformed = await snapshotOf(await post({ body: { nope: 1 } }));
      snapshots.not_owned = await snapshotOf(
        await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", action: "withdraw" } })
      );
      snapshots.not_owned_grant = await snapshotOf(
        await post({ body: { childId: "bbbbbbb1-0000-4000-8000-000000000001", action: "grant", ...goodEcho() } })
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
        .mockResolvedValue(sessionUser(PARENT_A, PARENT_A_EMAIL)) as unknown as GetUserFn;
      rateRef.allowed = false;
      snapshots.rate_limited = await snapshotOf(await post());
      rateRef.allowed = true;

      faults.value["update:children"] = { kind: "error", error: { message: "db down" } };
      snapshots.outage = await snapshotOf(await post());
      faults.value = {};

      const values = Object.values(snapshots);
      for (const snap of values) {
        expect(snap.status).toBe(401);
        expect(snap).toEqual(values[0]);
      }
      expect(values[0]!.body).toBe(PHOTO_CONSENT_REFUSAL_BODY);
    });
  });

  // ── Outage vs. deterministic: the strike policy ──

  describe("strike policy", () => {
    it("a tombstone-write OUTAGE refunds both strikes and closes nothing", async () => {
      faults.value["update:children"] = { kind: "error", error: { message: "db down" } };
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
      expect(childRow("aaaaaaa1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBeNull();
    });

    it("a GRANT insert outage refunds, and inserts nothing", async () => {
      store.value.fp_parental_consent = [];
      faults.value["insert:fp_parental_consent"] = {
        kind: "error",
        error: { message: "db down" },
      };
      const res = await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", action: "grant", ...goodEcho() } });
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
      expect(consentRows("aaaaaaa1-0000-4000-8000-000000000001")).toEqual([]);
    });

    it("a parent-gate outage refunds, and never reaches the core", async () => {
      faults.value["select:parents"] = { kind: "error", error: { message: "db down" } };
      const res = await post();
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
      expect(callLog).not.toContain("db:children");
    });

    it("an AGE-BAND read outage refuses rather than guessing onto the record", async () => {
      // Guessing a band onto a legal evidence record is worse than asking the
      // parent again in a minute, so this refuses — and refunds, because it is
      // our downtime.
      store.value.fp_parental_consent = [];
      faults.value["select:children"] = { kind: "error", error: { message: "db down" } };
      const res = await post({ body: { childId: "aaaaaaa1-0000-4000-8000-000000000001", action: "grant", ...goodEcho() } });
      expect(res.status).toBe(401);
      expect(rateRef.released).toHaveLength(2);
      expect(consentRows("aaaaaaa1-0000-4000-8000-000000000001")).toEqual([]);
    });

    it("a STALLED parent gate is an outage — the round trip is bounded", async () => {
      faults.value["select:parents"] = { kind: "hang" };
      const mod = await import("@/app/api/fp/parent/photo-consent/route");
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
      expect(childRow("aaaaaaa1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBeNull();
    });

    it("a STALLED core write is an outage too", async () => {
      faults.value["update:children"] = { kind: "hang" };
      const mod = await import("@/app/api/fp/parent/photo-consent/route");
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
      expect(childRow("aaaaaaa1-0000-4000-8000-000000000001").photo_consent_revoked_at).toBeNull();
    });

    it("OPTIONS from an allowed origin is a 204 preflight allowing POST + the JSON body", async () => {
      const mod = await import("@/app/api/fp/parent/photo-consent/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/photo-consent", {
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
      const mod = await import("@/app/api/fp/parent/photo-consent/route");
      const res = await mod.OPTIONS(
        new Request("http://localhost/api/fp/parent/photo-consent", {
          method: "OPTIONS",
          headers: { origin: "https://evil.example" },
        })
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
});
