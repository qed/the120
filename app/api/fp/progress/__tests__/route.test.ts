import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  fakeClient,
  type FaultPlan,
  type RecordedCall,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  deriveProgressRateLimitKeys,
  PROGRESS_ID_CHUNK,
  PROGRESS_IP_RATE_LIMIT,
  PROGRESS_MAX_REQUESTED_TASK_IDS,
  PROGRESS_MAX_RESPONSE_BYTES,
  PROGRESS_MAX_ROUND_TRIPS,
  PROGRESS_MAX_ROWS,
  PROGRESS_PAGE_SIZE,
  PROGRESS_RATE_LIMIT,
  PROGRESS_READ_TIMEOUT_MS,
  PROGRESS_SAVES_PAGE_SIZE,
  PROGRESS_TOTAL_BUDGET_MS,
} from "../progress-rules";

/**
 * Route-level coverage for GET /api/fp/progress — the staff-only cohort
 * progress feed (Watchtower Unit 2). Asserts the wiring the pure rules cannot:
 * the TWO-half staff gate, the byte-identical refusal (body AND headers) across
 * EVERY refusal reason, the `?tasks=` 400-class exception, paging that refuses
 * rather than truncates, timeouts, the strike-release policy (outage refunds, a
 * deterministic cap breach does not), the aggregate byte budget, and one clock
 * for the whole response. Mirrors the suggestions route's test anatomy.
 *
 * The fake client runs with `perturbUnordered` ON: an unordered select comes
 * back in a deliberately wrong order, so the route's `.order()` calls are
 * load-bearing here rather than decorative. Without it, deleting all of them
 * left this suite green (harness-fidelity gap, closed 2026-08-05).
 */

type GetUserFn = Mock<() => Promise<unknown>>;

const {
  store,
  faults,
  tokenRef,
  rateRef,
  maxRowsRef,
  callLog,
  dbCalls,
  inSizes,
  shapeCalls,
  shapeRef,
  throwingTables,
} = vi.hoisted(() => ({
  store: { value: {} as Store },
  faults: { value: {} as FaultPlan },
  tokenRef: { getUser: vi.fn() as unknown as GetUserFn },
  // `deny` is PER BUCKET KEY, not one global verdict: the route records both
  // buckets and then ORs the two answers, and a mock with a single `allowed`
  // flag cannot tell `||` from `&&` — both mutants answered 401 for the only
  // case it could express (both buckets saturated at once).
  rateRef: {
    allowed: true,
    deny: new Set<string>(),
    released: [] as string[],
    configs: [] as unknown[],
  },
  // PostgREST's assumed production max-rows. The route's page size equals it, so
  // the paging tests below only mean anything at this exact number.
  maxRowsRef: { value: 1000 },
  callLog: [] as string[],
  // Every query as ISSUED — columns, filters, order key, page size. `callLog`
  // only says a table was touched; the fake used to discard the select list
  // entirely, which made "this route never reads birth_year" unassertable.
  dbCalls: [] as RecordedCall[],
  inSizes: [] as number[],
  // Tables whose terminal REJECTS rather than answering `{error}` — the one
  // failure shape `withFwTimeout` cannot see, because Promise.race does not
  // catch.
  throwingTables: new Set<string>(),
  shapeCalls: [] as { ids: readonly string[]; now: Date }[],
  shapeRef: { throws: false },
}));

type Chainable = ReturnType<ReturnType<typeof fakeClient>["from"]>;

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => {
    const client = fakeClient(store.value, faults.value, {
      maxRows: maxRowsRef.value,
      perturbUnordered: true,
      recordCalls: dbCalls,
    });
    return {
      ...client,
      from: (table: string) => {
        callLog.push(`db:${table}`);
        const builder: Chainable = client.from(table);
        // Chunk sizes are a FACT about the call, not an inference from the body:
        // an unchunked `.in()` still answers correctly in the fake, so only
        // watching the wire can kill a "CHUNK = 1_000_000" mutant.
        const originalIn = builder.in.bind(builder);
        builder.in = ((col: string, vals: unknown[]) => {
          inSizes.push(vals.length);
          return originalIn(col, vals);
        }) as Chainable["in"];
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

vi.mock("@/app/fp/lib/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string, config: unknown) => {
    callLog.push(`rate:${key}`);
    rateRef.configs.push(config);
    // Per-key: `deny` saturates ONE bucket, `allowed:false` saturates both.
    return { allowed: rateRef.allowed && !rateRef.deny.has(key) };
  },
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
}));

// A pass-through spy on the ONE pure entry point, so the requested task-id list
// and the clock can be asserted as facts about the call rather than inferred
// from the body — and so the outer catch-all has something to catch.
vi.mock("@/app/api/fp/progress/progress-rules", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/api/fp/progress/progress-rules")>();
  return {
    ...actual,
    shapeProgress: (...args: Parameters<typeof actual.shapeProgress>) => {
      shapeCalls.push({ ids: args[3], now: args[4] });
      if (shapeRef.throws) throw new Error("shaping blew up");
      return actual.shapeProgress(...args);
    },
  };
});

const ORIGIN = "http://localhost:5173";
const STAFF_ID = "staff-peter-1";
/** A criterion view: five tasks on screen plus the ONE predecessor id. */
const TASKS = ["1.1.5", "1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5"];

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;
const TOKEN = jwtFor(STAFF_ID);

const sessionUser = (id: string, role?: string) => ({
  data: { user: { id, app_metadata: role === undefined ? {} : { role } } },
  error: null,
});

/** A save doc this build understands (docVersion 1). */
const doc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  docVersion: 1,
  ideas: [],
  businesses: [],
  ...over,
});

const IN_REQUEST_STAMP = 1_700_000_001_000;
const OUTSIDE_STAMP = 1_700_000_002_000;

/**
 * The roster fixture. No `parent_id` and no `families` table: the test-family
 * exclusion left this route entirely (`families.is_test` is a CRM/nurture flag,
 * not an FP-enrolment flag). No `birth_year` / `grade` either — band left the
 * wire shape in the 2026-08-05 redesign.
 */
function seed(): void {
  store.value = {
    staff: [{ id: STAFF_ID, email: "peter@the120.school", role: "admin", is_active: true }],
    children: [
      { id: "c-1", fp_username: "alex" },
      { id: "c-3", fp_username: "cy" },
      // never signed in: roster row, no profile, no save
      { id: "c-5", fp_username: "eve" },
      // not provisioned into FP at all → never in the query
      { id: "c-6", fp_username: null },
    ],
    fp_player_profiles: [
      { id: "p-1", handle: "alex", child_id: "c-1", user_id: "u-1" },
      { id: "p-3", handle: "cy", child_id: "c-3", user_id: "u-3" },
    ],
    fp_player_saves: [
      {
        profile_id: "p-1",
        doc: doc({
          ideas: [
            {
              id: "idea-a",
              fields: { productName: "Dog Treats" },
              // Legacy keys, NOT in the requested list.
              done: { "1.1#0": true },
              doneAt: { "1.1#0": 1_700_000_000_000 },
              // One requested id, one from a criterion the caller did not ask
              // about — the filter must keep exactly the first.
              doneByTask: { "1.2.1": true, "3.1.1": true },
              doneAtByTask: { "1.2.1": IN_REQUEST_STAMP, "3.1.1": OUTSIDE_STAMP },
            },
          ],
          businesses: [{ id: "b-1", ideaId: "idea-a", archived: false, doneByTask: {} }],
        }),
      },
      { profile_id: "p-3", doc: doc() },
    ],
  } as Store;
}

const urlFor = (tasks: string | null): string =>
  tasks === null
    ? "http://localhost/api/fp/progress"
    : `http://localhost/api/fp/progress?tasks=${encodeURIComponent(tasks)}`;

const requestFor = (opts?: {
  origin?: string;
  token?: string | null;
  tasks?: string | null;
}): Request => {
  const headers: Record<string, string> = { origin: opts?.origin ?? ORIGIN };
  const token = opts?.token === undefined ? TOKEN : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const tasks = opts?.tasks === undefined ? TASKS.join(",") : opts.tasks;
  return new Request(urlFor(tasks), { method: "GET", headers });
};

const get = (opts?: { origin?: string; token?: string | null; tasks?: string | null }) =>
  import("@/app/api/fp/progress/route").then((m) => m.GET(requestFor(opts)));

type Body = {
  ok: boolean;
  children: { username: string; ideas: unknown[]; businesses: unknown[] }[];
};

const usernames = async (res: Response): Promise<string[]> =>
  ((await res.json()) as Body).children.map((c) => c.username).sort();

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

/** Status + body + the sorted header set, the unit refusal parity is asserted in. */
const snapshotOf = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).sort(),
});

/**
 * Drive one request with the clock under our control, far enough for every
 * timeout to fire. The route module is imported BEFORE the timers are faked —
 * module resolution is real I/O and would not complete otherwise.
 */
const getUnderFakeClock = async (opts?: {
  origin?: string;
  token?: string | null;
  tasks?: string | null;
}): Promise<Response> => {
  const mod = await import("@/app/api/fp/progress/route");
  vi.useFakeTimers();
  try {
    const pending = mod.GET(requestFor(opts));
    await vi.advanceTimersByTimeAsync(PROGRESS_READ_TIMEOUT_MS + 50);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
};

/** A roster of `n` children with no profiles and no saves. */
function seedRoster(n: number): void {
  store.value.children = Array.from({ length: n }, (_, i) => ({
    id: `kid-${String(i).padStart(6, "0")}`,
    fp_username: `kid${i}`,
  }));
  store.value.fp_player_profiles = [];
  store.value.fp_player_saves = [];
}

/**
 * A cohort whose PROFILES read (an id-set read) totals `totalProfiles` rows
 * while no single id CHUNK is anywhere near the cap.
 *
 * 2000 children keeps the roster read comfortably inside PROGRESS_MAX_ROWS, and
 * the profile rows are dealt round-robin so each PROGRESS_ID_CHUNK of 500
 * children carries ~`totalProfiles / 4` rows. Only the budget CARRIED across
 * chunks can refuse here — which is the point: every other chunking fixture in
 * this file is 600 rows, so the aggregate bound was never reached from an id-set
 * read and "bound each chunk independently" was a green mutation.
 */
function seedIdSetRows(totalProfiles: number): void {
  const children = 2000;
  const pad = (i: number): string => String(i).padStart(6, "0");
  store.value.children = Array.from({ length: children }, (_, i) => ({
    id: `kid-${pad(i)}`,
    fp_username: `kid${i}`,
  }));
  store.value.fp_player_profiles = Array.from({ length: totalProfiles }, (_, i) => ({
    id: `prof-${pad(i)}`,
    child_id: `kid-${pad(i % children)}`,
  }));
  store.value.fp_player_saves = [];
}

/**
 * Seed a cohort whose SHAPED body blows PROGRESS_MAX_RESPONSE_BYTES, and return
 * the `tasks` list it needs. Every per-child cap is respected — the point is
 * that they bound one child and never the cohort.
 */
function oversizedCohort(): string {
  const ids = Array.from({ length: 32 }, (_, i) => `${(i % 8) + 1}.${Math.floor(i / 8) + 1}.1`);
  const stamps = Object.fromEntries(ids.map((id) => [id, 1_700_000_000_000]));
  const flags = Object.fromEntries(ids.map((id) => [id, true]));
  const bigDoc = doc({
    ideas: Array.from({ length: 50 }, (_, i) => ({
      id: `idea-${String(i).padStart(58, "0")}`,
      done: flags,
      doneAt: stamps,
      doneByTask: flags,
      doneAtByTask: stamps,
    })),
  });
  const n = 60;
  store.value.children = Array.from({ length: n }, (_, i) => ({
    id: `kid-${String(i).padStart(6, "0")}`,
    fp_username: `kid${i}`,
  }));
  store.value.fp_player_profiles = Array.from({ length: n }, (_, i) => ({
    id: `prof-${String(i).padStart(6, "0")}`,
    child_id: `kid-${String(i).padStart(6, "0")}`,
  }));
  store.value.fp_player_saves = Array.from({ length: n }, (_, i) => ({
    profile_id: `prof-${String(i).padStart(6, "0")}`,
    doc: bigDoc,
  }));
  return ids.join(",");
}

describe("GET /api/fp/progress — staff cohort progress (Watchtower Unit 2)", () => {
  beforeEach(() => {
    seed();
    faults.value = {};
    maxRowsRef.value = 1000;
    callLog.length = 0;
    dbCalls.length = 0;
    inSizes.length = 0;
    throwingTables.clear();
    shapeCalls.length = 0;
    shapeRef.throws = false;
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue(sessionUser(STAFF_ID, "admin")) as unknown as GetUserFn;
    rateRef.allowed = true;
    rateRef.deny.clear();
    rateRef.released = [];
    rateRef.configs = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  // ── The happy path ──

  it("answers 200 with the shaped per-child body, including a never-signed-in child", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.ok).toBe(true);

    const alex = body.children.find((c) => c.username === "alex")!;
    expect(alex).toEqual({
      username: "alex",
      truncated: false,
      docUnreadable: false,
      ideas: [
        {
          index: 0,
          id: "idea-a",
          // The legacy keys were not requested; `3.1.1` was not requested.
          done: {},
          doneAt: {},
          doneByTask: { "1.2.1": true },
          doneAtByTask: { "1.2.1": IN_REQUEST_STAMP },
          // Computed BEFORE the filter, so the LATER out-of-window stamp wins —
          // this is what stops an idea working in a later criterion from
          // reading as stalled.
          lastCompletionAt: OUTSIDE_STAMP,
          recencyClamped: false,
          hasCompletionsOutsideRequest: true,
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
          recencyClamped: false,
          hasCompletionsOutsideRequest: false,
        },
      ],
    });

    // The drill-down is built from exactly this row: present, empty, and NOT
    // flagged unreadable (no save row is different from an unreadable one).
    const eve = body.children.find((c) => c.username === "eve")!;
    expect(eve).toEqual({
      username: "eve",
      truncated: false,
      docUnreadable: false,
      ideas: [],
      businesses: [],
    });

    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("carries NO band, NO label and no task id the caller did not request, at any depth", async () => {
    const parsed = await (await get()).json();
    const keys = new Set<string>();
    const leaves = new Set<string>();
    walkJson(parsed, keys, leaves);
    expect(keys.has("band")).toBe(false);
    expect(keys.has("label")).toBe(false);
    // Map keys are keys, so an unrequested task id would show up in `keys`.
    for (const unrequested of ["3.1.1", "1.1#0"]) {
      expect(keys.has(unrequested), unrequested).toBe(false);
    }
    // …and the child-authored product name never left the server either.
    expect(leaves.has("Dog Treats")).toBe(false);
  });

  it("reads NO parent_id and NO families table — the test-family exclusion is gone", async () => {
    // `families.is_test` is a CRM/nurture-visibility flag: stamping a REAL beta
    // family to stop nurture mail must never delete their children from this
    // board. The read simply does not exist any more.
    await get();
    expect(callLog).not.toContain("db:families");
    expect(new Set(callLog.filter((c) => c.startsWith("db:")))).toEqual(
      new Set(["db:staff", "db:children", "db:fp_player_profiles", "db:fp_player_saves"])
    );
  });

  it("excludes a child with no fp_username — the roster filter is the FP-enrolment filter", async () => {
    expect(await usernames(await get())).toEqual(["alex", "cy", "eve"]);
  });

  it("an empty roster answers {ok, children: []} without downstream round trips", async () => {
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

  // ── The requested task-id list ──

  it("shapes the whole response in ONE call, with exactly the ids the caller asked for", async () => {
    await get();
    expect(shapeCalls).toHaveLength(1);
    expect(shapeCalls[0]!.ids).toEqual(TASKS);
  });

  it("honours a LEGACY `1.1#0` key when it is explicitly requested", async () => {
    const res = await get({ tasks: "1.1#0,1.2.1" });
    const alex = ((await res.json()) as Body).children.find((c) => c.username === "alex")!;
    expect(alex.ideas[0]).toMatchObject({
      done: { "1.1#0": true },
      doneAt: { "1.1#0": 1_700_000_000_000 },
      doneByTask: { "1.2.1": true },
    });
  });

  it("uses ONE clock: the wall clock is read EXACTLY once, and both consumers get that instant", async () => {
    // Why this is not simply "assert the two agree": under a real (or a frozen)
    // clock two `new Date()` calls land in the same millisecond, so BOTH
    // one-clock mutants — a second `new Date()` in the audit line, and a second
    // one in the shapeProgress argument — produced identical values and
    // survived. Time has to ADVANCE between the two reads for the assertion to
    // mean anything, so every no-arg `new Date()` here reads 5 s later than the
    // one before it. A second clock then disagrees by 5 s, loudly.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mod = await import("@/app/api/fp/progress/route");
    const T0 = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const FakedDate = globalThis.Date;
    const reads: number[] = [];
    class TickingDate extends FakedDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          const at = T0 + (reads.length + 1) * 5_000;
          reads.push(at);
          super(at);
          return;
        }
        super(...(args as [number]));
      }
    }
    globalThis.Date = TickingDate as unknown as DateConstructor;
    try {
      expect((await mod.GET(requestFor())).status).toBe(200);
    } finally {
      globalThis.Date = FakedDate;
      vi.useRealTimers();
    }

    // ONE clock: the whole response reads the wall clock exactly once…
    expect(reads).toHaveLength(1);
    // …that read is the clamp ceiling every child is measured against…
    expect(shapeCalls).toHaveLength(1);
    expect(shapeCalls[0]!.now.getTime()).toBe(reads[0]);
    // …and the audit breadcrumb stamps THAT instant, not a fresh one.
    expect(log.mock.calls[0]![0] as string).toContain(
      new FakedDate(reads[0]!).toISOString()
    );
  });

  // ── The 400-class parameter exception ──

  it("an authenticated staff caller with an unusable `tasks` list gets a 400 and ZERO cohort reads", async () => {
    const cases: (string | null)[] = [
      null, // absent
      "", // empty
      "1.2.3 ", // trailing whitespace is a client bug, not something to repair
      "not-a-task-id",
      "__proto__",
      "1.2.3%00",
      Array.from({ length: PROGRESS_MAX_REQUESTED_TASK_IDS + 1 }, (_, i) => `1.1.${(i % 9) + 1}`)
        .join(","),
    ];
    for (const tasks of cases) {
      callLog.length = 0;
      const res = await get({ tasks });
      expect(res.status, String(tasks)).toBe(400);
      // The gate ran (so this is not an unauthenticated oracle) but nothing of
      // the cohort was read — a bad request costs nothing.
      expect(callLog.filter((c) => c.startsWith("db:")), String(tasks)).toEqual(["db:staff"]);
      expect(shapeCalls).toHaveLength(0);
      // REFUNDED: this request spent no cohort read, and a client regression
      // sending a bad list every render must not saturate the limiter into a
      // 401 that signs the SPA out — the very thing this 400 exists to prevent.
      const { userKey, ipKey } = deriveProgressRateLimitKeys("unknown", STAFF_ID);
      expect(rateRef.released, String(tasks)).toEqual([userKey, ipKey]);
      rateRef.released = [];
    }
  });

  it("EXFILTRATION GUARD: the id cap boundary is pinned — 32 accepted, 33 refused", async () => {
    const at = Array.from(
      { length: PROGRESS_MAX_REQUESTED_TASK_IDS },
      (_, i) => `${Math.floor(i / 9) + 1}.1.${(i % 9) + 1}`
    );
    expect(new Set(at).size).toBe(PROGRESS_MAX_REQUESTED_TASK_IDS);
    expect((await get({ tasks: at.join(",") })).status).toBe(200);
    expect((await get({ tasks: [...at, "9.9.9"].join(",") })).status).toBe(400);
  });

  it("the 400 body echoes NO submitted id, and no log line contains one either", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const secret = "7.7.7";
    const res = await get({ tasks: `${secret},not-an-id` });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).not.toContain(secret);
    expect(body).not.toContain("not-an-id");
    const lines = [...errorSpy.mock.calls, ...logSpy.mock.calls]
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(lines).not.toContain(secret);
    expect(lines).not.toContain("not-an-id");
  });

  it("an UNAUTHENTICATED caller with a bad list gets the 401, never the 400 — no oracle", async () => {
    const anon = await get({ token: null, tasks: "garbage" });
    const refusal = await get({ token: null });
    expect(anon.status).toBe(401);
    expect(await anon.text()).toBe(await refusal.text());
    // …and the same holds for a genuine non-staff session.
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue(sessionUser("child-user-7")) as unknown as GetUserFn;
    expect((await get({ tasks: "garbage" })).status).toBe(401);
  });

  it("flags a future-dated stamp as recencyClamped, ACROSS successive requests", async () => {
    // The bug a single-request test cannot see: the clamp rewrites the RESPONSE,
    // never the stored row, so the same forward stamp clamps to each new `now`
    // in turn and `lastCompletionAt` reads "just now" forever — permanently
    // "active", never stalled, on a board whose job is noticing who stopped.
    // The clamp bounds the value; `recencyClamped` is what preserves the signal.
    store.value.fp_player_saves = [
      {
        profile_id: "p-1",
        doc: doc({
          ideas: [
            {
              id: "idea-a",
              doneByTask: { "1.2.1": true },
              // Far past any tolerance, and inside the absurd-value guard.
              doneAtByTask: { "1.2.1": 4_000_000_000_000 },
            },
          ],
        }),
      },
    ];

    const readAlex = async (): Promise<Record<string, unknown>> => {
      const body = (await (await get()).json()) as Body;
      return body.children.find((c) => c.username === "alex")!.ideas[0] as Record<
        string,
        unknown
      >;
    };

    const first = await readAlex();
    expect(first.recencyClamped).toBe(true);
    const firstAt = first.lastCompletionAt as number;

    // A later request, a later clock. The stored stamp has not changed.
    vi.setSystemTime(new Date(Date.now() + 7 * 24 * 60 * 60_000));
    const second = await readAlex();
    const secondAt = second.lastCompletionAt as number;

    // The value really does regenerate — this is the defect, pinned so nobody
    // "fixes" the flag away believing the clamp handles it.
    expect(secondAt).toBeGreaterThan(firstAt);
    // …and BOTH responses say the number is synthetic, so a client applying the
    // documented semantics never credits it as activity.
    expect(second.recencyClamped).toBe(true);
    vi.useRealTimers();
  });

  it("an ordinary stamp is NOT flagged — the signal has to mean something", async () => {
    const body = (await (await get()).json()) as Body;
    const alex = body.children.find((c) => c.username === "alex")!;
    expect((alex.ideas[0] as Record<string, unknown>).recencyClamped).toBe(false);
  });

  // ── The staff gate ──

  it("a GENUINE authenticated NON-STAFF principal (a child session) is refused byte-identically to a forged token", async () => {
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
    expect(rateRef.released).toEqual([]);
  });

  it("refuses when the CLAIM half passes but the ROW half fails (no staff row)", async () => {
    store.value.staff = [];
    const res = await get();
    expect(res.status).toBe(401);
    expect(rateRef.released).toEqual([]);
    // …and the row read really ran — a gate with no callers is not a gate.
    expect(callLog).toContain("db:staff");
    expect(callLog).not.toContain("db:children");
  });

  it("refuses when the ROW half would pass but the CLAIM half fails — the claim is read, not assumed", async () => {
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue(sessionUser(STAFF_ID)) as unknown as GetUserFn; // no role claim
    const res = await get();
    expect(res.status).toBe(401);
    // The staff row for STAFF_ID is present and active; only the claim is
    // missing, and nothing reached the database.
    expect(store.value.staff[0]!.is_active).toBe(true);
    expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
  });

  it("a revoked (is_active=false) staff row is refused — revocation needs no token expiry", async () => {
    store.value.staff[0]!.is_active = false;
    expect((await get()).status).toBe(401);
  });

  it("a staff row whose role is outside the allowed set is refused", async () => {
    store.value.staff[0]!.role = "intern";
    expect((await get()).status).toBe(401);
  });

  it("a non-allowed claim role value is refused at the claim half", async () => {
    for (const role of ["", "guide", "parent", "ADMIN", "super_admin", "staff"]) {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(STAFF_ID, role)) as unknown as GetUserFn;
      expect((await get()).status, role).toBe(401);
    }
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
    expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
  });

  it("pins the EXACT rate-limit bucket keys and the budget IDENTITY of each one", async () => {
    await get();
    // `unknown` is extractClientIp's answer when no attested header is present.
    const { userKey, ipKey } = deriveProgressRateLimitKeys("unknown", STAFF_ID);
    expect(callLog.filter((c) => c.startsWith("rate:"))).toEqual([
      `rate:${userKey}`,
      `rate:${ipKey}`,
    ]);
    expect(userKey.startsWith("fp-progress:")).toBe(true);
    expect(ipKey.startsWith("fp-progress-ip:")).toBe(true);
    // IDENTITY, not equality: the two budgets are structurally different today,
    // but swapping them (or substituting the suggestions configs) must fail even
    // if some future edit makes the numbers match.
    expect(rateRef.configs).toHaveLength(2);
    expect(rateRef.configs[0]).toBe(PROGRESS_RATE_LIMIT);
    expect(rateRef.configs[1]).toBe(PROGRESS_IP_RATE_LIMIT);
  });

  it("a saturated USER bucket refuses even though the IP bucket is free", async () => {
    // EITHER bucket saturating is a refusal. A mock with one global verdict can
    // only express "both at once", which is why `||` → `&&` survived: the two
    // read the same under the only case the old mock could produce.
    const { userKey, ipKey } = deriveProgressRateLimitKeys("unknown", STAFF_ID);
    rateRef.deny.add(userKey);
    const res = await get();
    expect(res.status).toBe(401);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
    expect(callLog.filter((c) => c.startsWith("db:"))).toEqual([]);
    // …and BOTH buckets were still recorded, in order: the per-IP aggregate has
    // to keep accumulating for a saturated user bucket, or one exhausted staff
    // account becomes a free pass for the whole address (the route's own
    // comment — "Record BOTH buckets before the verdict").
    expect(callLog.filter((c) => c.startsWith("rate:"))).toEqual([
      `rate:${userKey}`,
      `rate:${ipKey}`,
    ]);
  });

  it("a saturated IP bucket refuses even though the user bucket is free", async () => {
    const { userKey, ipKey } = deriveProgressRateLimitKeys("unknown", STAFF_ID);
    rateRef.deny.add(ipKey);
    const res = await get();
    expect(res.status).toBe(401);
    expect(tokenRef.getUser).not.toHaveBeenCalled();
    expect(callLog.filter((c) => c.startsWith("rate:"))).toEqual([
      `rate:${userKey}`,
      `rate:${ipKey}`,
    ]);
  });

  it("a saturated bucket refuses byte-identically to every other 401, either way round", async () => {
    const baseline = await snapshotOf(await get({ token: null }));
    const { userKey, ipKey } = deriveProgressRateLimitKeys("unknown", STAFF_ID);
    for (const [name, key] of [
      ["user bucket", userKey],
      ["ip bucket", ipKey],
    ] as const) {
      rateRef.deny.clear();
      rateRef.deny.add(key);
      expect(await snapshotOf(await get()), name).toEqual(baseline);
    }
  });

  it("records the rate-limit strike BEFORE any admin read on the not-staff path", async () => {
    store.value.staff = [];
    await get();
    const firstDb = callLog.findIndex((c) => c.startsWith("db:"));
    const lastRate = callLog.map((c) => c.startsWith("rate:")).lastIndexOf(true);
    expect(firstDb).toBeGreaterThan(-1);
    expect(lastRate).toBeLessThan(firstDb);
    // Both buckets, not just the user one.
    expect(callLog.filter((c) => c.startsWith("rate:"))).toHaveLength(2);
  });

  it("a token-verification network throw is an outage — strikes released, generic 401", async () => {
    tokenRef.getUser = vi.fn().mockRejectedValue(new Error("fetch failed")) as unknown as GetUserFn;
    const res = await get();
    expect(res.status).toBe(401);
    const { userKey, ipKey } = deriveProgressRateLimitKeys("unknown", STAFF_ID);
    expect(rateRef.released).toEqual([userKey, ipKey]);
  });

  it("a DB outage at EACH read site releases BOTH buckets — not one, not neither", async () => {
    const { userKey, ipKey } = deriveProgressRateLimitKeys("unknown", STAFF_ID);
    for (const table of ["staff", "children", "fp_player_profiles", "fp_player_saves"]) {
      rateRef.released = [];
      faults.value = { [`select:${table}`]: { kind: "error", error: { message: "boom" } } };
      const res = await get();
      expect(res.status, table).toBe(401);
      // The exact pair, in order: releasing only the user bucket used to pass.
      expect(rateRef.released, table).toEqual([userKey, ipKey]);
    }
  });

  it("a cohort read that THROWS refunds exactly like one that errors in-band", async () => {
    // `withFwTimeout` is Promise.race — it does not catch. A rejected fetch used
    // to escape to the outer catch, log as "unexpected error" and leave the
    // strike STANDING, while the identical outage arriving as `res.error`
    // refunded it. The refund policy must not depend on which way supabase-js
    // chose to report the same failure.
    const { userKey, ipKey } = deriveProgressRateLimitKeys("unknown", STAFF_ID);
    for (const table of ["children", "fp_player_profiles", "fp_player_saves"]) {
      rateRef.released = [];
      throwingTables.clear();
      throwingTables.add(table);
      const res = await get();
      expect(res.status, table).toBe(401);
      expect(rateRef.released, table).toEqual([userKey, ipKey]);
    }
    throwingTables.clear();
  });

  it("a genuine refusal does NOT release strikes, while an outage does", async () => {
    store.value.staff = [];
    await get();
    expect(rateRef.released).toEqual([]);
    faults.value["select:staff"] = { kind: "error", error: { message: "connection reset" } };
    await get();
    expect(rateRef.released.length).toBeGreaterThan(0);
  });

  it("the outer catch-all turns an unexpected throw into the SAME byte-identical 401", async () => {
    shapeRef.throws = true;
    const res = await get();
    const refusal = await get({ token: null });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(await refusal.text());
    // Fail closed: an unexplained throw does not refund the strike.
    expect(rateRef.released).toEqual([]);
  });

  // ── Timeouts ──

  it("a read that never settles TIMES OUT and refuses — it does not hold the invocation open", async () => {
    faults.value["select:children"] = { kind: "hang" };
    const mod = await import("@/app/api/fp/progress/route");
    vi.useFakeTimers();
    const pending = mod.GET(requestFor());
    await vi.advanceTimersByTimeAsync(PROGRESS_READ_TIMEOUT_MS + 50);
    const res = await pending;
    expect(res.status).toBe(401);
    // A stall is indistinguishable from an outage to the caller, and is treated
    // as one — the strike is refunded.
    expect(rateRef.released.length).toBeGreaterThan(0);
  });

  it("pins maxDuration so the invocation ceiling is a deliberate number, not a platform default", async () => {
    const mod = await import("@/app/api/fp/progress/route");
    expect(mod.maxDuration).toBe(60);
    // The per-call budget must stay well inside the whole-request budget.
    expect(PROGRESS_READ_TIMEOUT_MS).toBeLessThan(mod.maxDuration * 1000);
  });

  // ── Pagination ──

  it("pages past ONE page and returns EVERY child (the silent-truncation guard)", async () => {
    seedRoster(1500);
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    // 1500, not 1000 — the second page is real, and the keyset cursor advanced.
    expect(body.children).toHaveLength(1500);
    expect(new Set(body.children.map((c) => c.username)).size).toBe(1500);
  });

  it("a server max-rows SMALLER than the page size still returns every row", async () => {
    // The reproduced bug: with max-rows 500 and 1200 children the route answered
    // 200 with 500 of them — truncated AND skipping rows, because the offset
    // came from the page INDEX. Keyset paging plus an EMPTY-page terminator is
    // correct for any cap; what must never happen is a plausible short cohort.
    maxRowsRef.value = 500;
    seedRoster(1200);
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.children).toHaveLength(1200);
    expect(new Set(body.children.map((c) => c.username)).size).toBe(1200);
  });

  it("the row cap boundary agrees with its docstring: MAX_ROWS is served, MAX_ROWS+1 refuses", async () => {
    seedRoster(PROGRESS_MAX_ROWS - 1);
    expect((await get()).status).toBe(200);

    seedRoster(PROGRESS_MAX_ROWS);
    const atCap = await get();
    expect(atCap.status).toBe(200);
    expect(((await atCap.json()) as Body).children).toHaveLength(PROGRESS_MAX_ROWS);

    rateRef.released = [];
    seedRoster(PROGRESS_MAX_ROWS + 1);
    const over = await get();
    // 400-class, NOT the 401: "your school got too big" is not "you are not
    // staff", and the SPA reads 401 as a whole-shell signout.
    expect(over.status).toBe(400);
    const badList = await get({ tasks: "garbage" });
    expect(await over.text()).toBe(await badList.text());
  });

  it("REFUSES when the round-trip budget runs out, rather than serving what it got", async () => {
    // The page bound used to be per-`readAllPages` CALL and the loop's exit
    // returned a refusal that nothing exercised: replacing it with
    // `{ok:true, rows}` was green across the whole suite. A server cap far under
    // the page size is what turns a legal row count into a trip-budget breach.
    maxRowsRef.value = 100;
    seedRoster(PROGRESS_MAX_ROUND_TRIPS * 100 + 100);
    const res = await get();
    expect(res.status).toBe(400);
    // Deterministic capacity, so no refund — same policy as the row cap.
    expect(rateRef.released).toEqual([]);
  });

  it("bounds the TOTAL round trips of a legal large cohort", async () => {
    // The budget is per LOGICAL read and carried across chunks; the old
    // per-chunk bound multiplied out to 8 × 5 = 40 trips for one id-set read
    // while calling itself a 5-page bound.
    const n = PROGRESS_ID_CHUNK + 100;
    store.value.children = Array.from({ length: n }, (_, i) => ({
      id: `kid-${String(i).padStart(6, "0")}`,
      fp_username: `kid${i}`,
    }));
    store.value.fp_player_profiles = Array.from({ length: n }, (_, i) => ({
      id: `prof-${String(i).padStart(6, "0")}`,
      child_id: `kid-${String(i).padStart(6, "0")}`,
    }));
    store.value.fp_player_saves = [];
    expect((await get()).status).toBe(200);
    const dbCalls = callLog.filter((c) => c.startsWith("db:")).length;
    // 1 staff + children (1 page + terminator) + profiles (2 chunks × 2) +
    // saves (2 chunks × 1 empty) — comfortably inside three read budgets.
    expect(dbCalls).toBeLessThanOrEqual(1 + 3 * PROGRESS_MAX_ROUND_TRIPS);
    expect(dbCalls).toBeLessThan(20);
  });

  it("advances the keyset cursor from the LAST row of a page, not the first", async () => {
    // A `got[0]` cursor re-reads the same window forever with `.gt()`, which
    // here shows up as a trip-budget refusal instead of a 200. Two full pages
    // are the minimum that can tell the two apart.
    seedRoster(PROGRESS_PAGE_SIZE + 25);
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.children).toHaveLength(PROGRESS_PAGE_SIZE + 25);
    // The very last id in key order must be present — a first-row cursor never
    // reaches it.
    expect(body.children.map((c) => c.username)).toContain(`kid${PROGRESS_PAGE_SIZE + 24}`);
  });

  it("gives the saves read its OWN smaller page size — doc bytes are not row counts", async () => {
    // `doc` is bounded in COMPRESSED bytes, so a 1000-row saves page is a
    // quarter-gigabyte transfer that blows the per-call timeout, classifies as
    // an outage, REFUNDS the strike and retries forever against a healthy DB.
    expect(PROGRESS_SAVES_PAGE_SIZE).toBe(200);
    expect(PROGRESS_SAVES_PAGE_SIZE).toBeLessThan(PROGRESS_PAGE_SIZE);
    const n = PROGRESS_SAVES_PAGE_SIZE + 50;
    store.value.children = Array.from({ length: n }, (_, i) => ({
      id: `kid-${String(i).padStart(6, "0")}`,
      fp_username: `kid${i}`,
    }));
    store.value.fp_player_profiles = Array.from({ length: n }, (_, i) => ({
      id: `prof-${String(i).padStart(6, "0")}`,
      child_id: `kid-${String(i).padStart(6, "0")}`,
    }));
    store.value.fp_player_saves = Array.from({ length: n }, (_, i) => ({
      profile_id: `prof-${String(i).padStart(6, "0")}`,
      doc: doc({ ideas: [{ id: `idea-${i}`, doneByTask: { "1.2.1": true } }] }),
    }));
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    // Paging across the SMALLER page size still returns every save.
    expect(body.children).toHaveLength(n);
    expect(body.children.every((c) => c.ideas.length === 1)).toBe(true);
    // …and it really did take more than one saves page.
    expect(callLog.filter((c) => c === "db:fp_player_saves").length).toBeGreaterThan(2);
  });

  it("pins the deadline budget under maxDuration, with room for shaping", async () => {
    const mod = await import("@/app/api/fp/progress/route");
    expect(PROGRESS_TOTAL_BUDGET_MS).toBeLessThan(mod.maxDuration * 1000);
    // Per-call budget must be a small fraction of the invocation budget, or the
    // deadline cannot bound their sum in any useful way.
    expect(PROGRESS_READ_TIMEOUT_MS * 2).toBeLessThan(PROGRESS_TOTAL_BUDGET_MS);
  });

  it("a row-cap refusal does NOT release strikes — it is deterministic, not an outage", async () => {
    // Refunding it would make the single most expensive path in the service free
    // to loop: the request refuses identically every time, so the caller could
    // replay it forever at zero budget cost.
    seedRoster(PROGRESS_MAX_ROWS + 1);
    const res = await get();
    expect(res.status).toBe(400);
    expect(rateRef.released).toEqual([]);
  });

  // ── Id-set chunking ──

  it("chunks id-set reads AND keeps every row: >CHUNK children with real profiles and saves", async () => {
    const n = PROGRESS_ID_CHUNK + 100;
    store.value.children = Array.from({ length: n }, (_, i) => ({
      id: `kid-${String(i).padStart(6, "0")}`,
      fp_username: `kid${i}`,
    }));
    store.value.fp_player_profiles = Array.from({ length: n }, (_, i) => ({
      id: `prof-${String(i).padStart(6, "0")}`,
      child_id: `kid-${String(i).padStart(6, "0")}`,
    }));
    store.value.fp_player_saves = Array.from({ length: n }, (_, i) => ({
      profile_id: `prof-${String(i).padStart(6, "0")}`,
      doc: doc({
        ideas: [{ id: `idea-${i}`, doneByTask: { "1.2.1": true } }],
      }),
    }));

    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.children).toHaveLength(n);
    // EVERY child keeps its data — an `ids.slice(0, CHUNK)` mutant strands the
    // tail with empty ideas while still answering 200.
    for (const child of body.children) {
      expect(child.ideas, child.username).toHaveLength(1);
      expect(child.ideas[0]).toMatchObject({ doneByTask: { "1.2.1": true } });
    }
    // …and the chunking really happened: no `.in()` ever carried more than the
    // chunk size, and more than one chunk was issued per id-set read.
    expect(inSizes.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(PROGRESS_ID_CHUNK);
    // Both id-set reads really split: a single fat `.in()` would show up as one
    // filter of `n` ids, which the max assertion above catches, and a dropped
    // tail chunk shows up in the per-child assertions above.
    expect(inSizes.filter((size) => size === PROGRESS_ID_CHUNK).length).toBeGreaterThanOrEqual(2);
  });

  it("bounds an id-set read's rows IN AGGREGATE, not per chunk — same boundary as a plain read", async () => {
    // "A per-chunk bound multiplies into no bound at all" is the route's own
    // claim about this budget, and it was untested: every chunking fixture here
    // is 600 rows, so a per-chunk row budget behaved identically. These two
    // cases sit either side of the SAME PROGRESS_MAX_ROWS boundary the direct
    // readAllPages path is pinned to above, reached only by carrying the count
    // across four chunks.
    seedIdSetRows(PROGRESS_MAX_ROWS);
    expect((await get()).status).toBe(200);

    rateRef.released = [];
    seedIdSetRows(PROGRESS_MAX_ROWS + 1);
    const over = await get();
    expect(over.status).toBe(400);
    // Deterministic capacity, so no refund — identical policy to the row cap on
    // the roster read.
    expect(rateRef.released).toEqual([]);
    // …and it really is the aggregate that refused: no chunk came close.
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(PROGRESS_ID_CHUNK);
  });

  // ── The queries as ISSUED, not merely their rows ──

  it("asks the roster for EXACTLY `id, fp_username`, filtered to FP-enrolled children", async () => {
    // Asserted against the QUERY, not the body: the fake used to discard the
    // select list, so re-adding `birth_year, grade, parent_id` changed no
    // response anywhere and survived the suite. Reading a child's date of birth
    // under the service role for a column nothing consumes is precisely what
    // this route's header promises it does not do — a claim the body cannot
    // check. Dropping the not-null filter is invisible the same way, because
    // shapeProgress re-checks `fp_username` as the fail-closed second half.
    await get();
    const roster = dbCalls.filter((c) => c.table === "children");
    expect(roster.length).toBeGreaterThan(0);
    for (const call of roster) {
      expect(call.columns).toBe("id, fp_username");
      expect(call.filters).toContainEqual({
        op: "not.is",
        col: "fp_username",
        value: null,
      });
      expect(call.order).toEqual({ col: "id", ascending: true });
    }
    // The other two reads carry only what the shaper needs, too.
    for (const [table, columns] of [
      ["fp_player_profiles", "id, child_id"],
      ["fp_player_saves", "profile_id, doc"],
    ] as const) {
      const reads = dbCalls.filter((c) => c.table === table);
      expect(reads.length, table).toBeGreaterThan(0);
      for (const call of reads) expect(call.columns, table).toBe(columns);
    }
    // No column anywhere in the whole invocation names a child's identity or
    // family beyond the FP username the board displays.
    const asked = dbCalls.flatMap((c) => (c.columns ?? "").split(",").map((s) => s.trim()));
    for (const forbidden of ["birth_year", "grade", "parent_id", "*"]) {
      expect(asked, forbidden).not.toContain(forbidden);
    }
  });

  it("asks each read for its OWN page size — the server cap must not be doing the bounding", async () => {
    // `.limit()` was deletable with the suite green because the harness's
    // `maxRows` truncated to the same number: the page size was enforced by the
    // FAKE, not by the route. In production nothing truncates a saves page to
    // 200, and a 1000-row `doc` page is the quarter-gigabyte transfer
    // PROGRESS_SAVES_PAGE_SIZE exists to prevent.
    const n = PROGRESS_SAVES_PAGE_SIZE + 50;
    const pad = (i: number): string => String(i).padStart(6, "0");
    store.value.children = Array.from({ length: n }, (_, i) => ({
      id: `kid-${pad(i)}`,
      fp_username: `kid${i}`,
    }));
    store.value.fp_player_profiles = Array.from({ length: n }, (_, i) => ({
      id: `prof-${pad(i)}`,
      child_id: `kid-${pad(i)}`,
    }));
    store.value.fp_player_saves = Array.from({ length: n }, (_, i) => ({
      profile_id: `prof-${pad(i)}`,
      doc: doc(),
    }));
    expect((await get()).status).toBe(200);

    for (const [table, size] of [
      ["children", PROGRESS_PAGE_SIZE],
      ["fp_player_profiles", PROGRESS_PAGE_SIZE],
      ["fp_player_saves", PROGRESS_SAVES_PAGE_SIZE],
    ] as const) {
      const reads = dbCalls.filter((c) => c.table === table);
      expect(reads.length, table).toBeGreaterThan(0);
      for (const call of reads) expect(call.limit, table).toBe(size);
    }
    // The staff-gate read is a single row and asks for no page at all.
    for (const call of dbCalls.filter((c) => c.table === "staff")) {
      expect(call.limit).toBeNull();
      expect(call.terminal).toBe("maybeSingle");
    }
  });

  // ── The aggregate response budget ──

  it("refuses a cohort whose shaped body exceeds the byte budget, rather than serving it", async () => {
    const tasks = oversizedCohort();
    const res = await get({ tasks });
    // 400-class like the row cap, and for the same reason.
    expect(res.status).toBe(400);
    // The platform's own oversize answer is a CORS-less 500 — a DIFFERENT
    // response shape, and therefore an oracle. Ours is the one voice.
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const badList = await get({ tasks: "garbage" });
    expect(await res.text()).toBe(await badList.text());
  });

  it("the byte-budget refusal does NOT release strikes — deterministic, like the row cap", async () => {
    // Pinned separately from `too_many_rows`: they are two `badRequest` call
    // sites with two different refund answers around them, and only one of them
    // had a test.
    const tasks = oversizedCohort();
    rateRef.released = [];
    expect((await get({ tasks })).status).toBe(400);
    expect(rateRef.released).toEqual([]);
  });

  it("pins the byte budget under the platform's response limit", async () => {
    expect(PROGRESS_MAX_RESPONSE_BYTES).toBe(4_000_000);
    expect(PROGRESS_MAX_RESPONSE_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(PROGRESS_PAGE_SIZE).toBe(1000);
    expect(PROGRESS_MAX_ROWS).toBe(4000);
    expect(PROGRESS_ID_CHUNK).toBe(500);
  });

  // ── Indistinguishability, headers included ──

  it("EVERY refusal reason produces identical status, body AND header sets", async () => {
    // One table, every reason — the previous version omitted the row cap, the
    // not-staff-BY-ROW half and the undecodable token, each of which is a
    // separate `refuse(...)` call site that could drift on its own.
    const reasons: [string, () => void | Promise<void>][] = [
      ["missing token", () => {}],
      ["undecodable token", () => {}],
      ["forged token", () => {
        tokenRef.getUser = vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: { status: 401 } }) as unknown as GetUserFn;
      }],
      ["genuine child session (claim half)", () => {
        tokenRef.getUser = vi
          .fn()
          .mockResolvedValue(sessionUser("child-user-7")) as unknown as GetUserFn;
      }],
      ["not staff BY ROW", () => {
        store.value.staff = [];
      }],
      ["revoked staff row", () => {
        store.value.staff[0]!.is_active = false;
      }],
      ["rate limited", () => {
        rateRef.allowed = false;
      }],
      ["outage", () => {
        faults.value["select:children"] = { kind: "error", error: { message: "boom" } };
      }],
      ["unexpected throw", () => {
        shapeRef.throws = true;
      }],
    ];

    const snapshots: { name: string; snap: Awaited<ReturnType<typeof snapshotOf>> }[] = [];
    for (const [name, setup] of reasons) {
      seed();
      faults.value = {};
      rateRef.allowed = true;
      shapeRef.throws = false;
      maxRowsRef.value = 1000;
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(STAFF_ID, "admin")) as unknown as GetUserFn;
      await setup();
      const token =
        name === "missing token" ? null : name === "undecodable token" ? "garbage" : undefined;
      snapshots.push({ name, snap: await snapshotOf(await get({ token })) });
    }

    const first = snapshots[0]!;
    expect(first.snap.status).toBe(401);
    for (const { name, snap } of snapshots) {
      expect(snap, name).toEqual(first.snap);
    }
    // …and that shared shape carries no per-reason channel at all.
    expect(first.snap.headers.some((h) => h.startsWith("retry-after"))).toBe(false);
  });

  it("every TIMEOUT site refuses identically to every other 401 — all five of them", async () => {
    // Timeouts live in the 401 family (a stall is an outage), and each site is a
    // separate `withFwTimeout` call that could drift on its own. Driven under
    // fake timers because the whole point is that nothing ever settles.
    const baseline = await snapshotOf(await get({ token: null }));
    const sites: [string, () => void][] = [
      ["token verification", () => {
        tokenRef.getUser = (() => new Promise(() => {})) as unknown as GetUserFn;
      }],
      ["staff row", () => {
        faults.value["select:staff"] = { kind: "hang" };
      }],
      ["children read", () => {
        faults.value["select:children"] = { kind: "hang" };
      }],
      ["profiles read", () => {
        faults.value["select:fp_player_profiles"] = { kind: "hang" };
      }],
      ["saves read", () => {
        faults.value["select:fp_player_saves"] = { kind: "hang" };
      }],
    ];
    for (const [name, setup] of sites) {
      seed();
      faults.value = {};
      rateRef.released = [];
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(STAFF_ID, "admin")) as unknown as GetUserFn;
      setup();
      const snap = await snapshotOf(await getUnderFakeClock());
      expect(snap, name).toEqual(baseline);
      // A stall is an outage, so it refunds — at every site, not just the first.
      expect(rateRef.released.length, name).toBeGreaterThan(0);
    }
  });

  it("the 400 family is internally identical AND shares the 401's header set", async () => {
    // Header parity across the two families is true today only because they
    // share one `headers` object; pinned so splitting them cannot silently mint
    // a per-family channel.
    const four01 = await snapshotOf(await get({ token: null }));

    const badList = await snapshotOf(await get({ tasks: "garbage" }));

    seedRoster(PROGRESS_MAX_ROWS + 1);
    const rowCap = await snapshotOf(await get());

    seed();
    const tooLarge = await snapshotOf(await get({ tasks: oversizedCohort() }));

    for (const [name, snap] of [
      ["row cap", rowCap],
      ["too large", tooLarge],
    ] as const) {
      expect(snap, name).toEqual(badList);
    }
    expect(badList.status).toBe(400);
    // STATUS is the only permitted difference between the families: same CORS
    // echo, same no-store, same Vary, and no per-family channel of any kind.
    // Dropping the headers here would turn a readable 400 into a CORS failure in
    // the SPA — a different response shape, which is the oracle this whole route
    // is organised against.
    expect(badList.headers).toEqual(four01.headers);
    expect(badList.headers).toContain(`access-control-allow-origin: ${ORIGIN}`);
    expect(badList.headers).toContain("cache-control: no-store");
    expect(badList.headers).toContain("vary: Origin");
    expect(badList.headers.some((h) => h.startsWith("retry-after"))).toBe(false);
    expect(badList.body).not.toBe(four01.body);
  });

  // ── CORS ──

  it("a disallowed Origin is 403 with NO CORS echo, before anything runs", async () => {
    const res = await get({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(tokenRef.getUser).not.toHaveBeenCalled();
    expect(callLog).toEqual([]);
  });

  it("OPTIONS preflight: 204 for an allowed origin, 403 otherwise", async () => {
    const mod = await import("@/app/api/fp/progress/route");
    const res = await mod.OPTIONS(
      new Request("http://localhost/api/fp/progress", {
        method: "OPTIONS",
        headers: { origin: ORIGIN },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = await mod.OPTIONS(
      new Request("http://localhost/api/fp/progress", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      })
    );
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  // ── The audit breadcrumb (R3) ──

  it("logs exactly ONE value-free success line: the staff id and an ISO timestamp", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await get();
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]![0] as string;
    expect(line).toContain(STAFF_ID);
    expect(line).toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
    // No child data of any kind — not a username, not a label, not a count —
    // and no caller-supplied task id, which is untrusted request input.
    for (const leak of ["alex", "cy", "eve", "Dog Treats", TOKEN, ...TASKS]) {
      expect(line, leak).not.toContain(leak);
    }
  });
});
