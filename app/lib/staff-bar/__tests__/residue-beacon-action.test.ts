import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `sendFwResidueBeacon` — the Server Action the review found shipped with five exit
 * paths and zero direct coverage (Staff Front Door Unit 6).
 *
 * Same seams and same registry rule as `auth-gate-unknown.test.ts`: mocks at the
 * module boundary, everything re-imported fresh per test so React `cache()` and the
 * class-identity hazard cannot bleed between cases.
 *
 * The property that matters most here is the SECURITY one the gate was added for:
 * a role-less authenticated session (any parent or student account — the action is
 * an open HTTP endpoint) must produce NO row, because the table is one a human at a
 * desk ACTS on, and ungated inserts let any account poison the "which iPads hold
 * work" query with fabricated claims.
 */

const getUser = vi.fn();
const grantsResult = vi.fn();
const staffRowActive = vi.fn();
const insertCalls: unknown[] = [];
let insertResult: { data: unknown; error: { message: string } | null };

vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { getUser } }),
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      // the grants read (path_role_grants) and the report insert share this mock;
      // route by shape: select().eq().order() = grants, insert() = the report.
      select: () => ({
        eq: () => ({
          order: () => grantsResult(),
        }),
      }),
      insert: (row: unknown) => {
        insertCalls.push({ table, row });
        return {
          select: () => ({
            maybeSingle: async () => insertResult,
          }),
        };
      },
    }),
  }),
}));

vi.mock("@/app/lib/fp/fw-guide-core", () => ({
  loadStaffRowActive: () => staffRowActive(),
}));

const fresh = async () => {
  vi.resetModules();
  return (await import("../actions")).sendFwResidueBeacon;
};

const uuid = () => crypto.randomUUID();
const guideGrant = (id: string) => ({
  data: [{ role: "guide", scope_type: "cohort", scope_id: id }],
  error: null,
});
const payload = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  outcome: "queue_preserved",
  queueRemaining: 2,
  application: "fw",
  claimedActorUserId: uuid(),
  deviceId: uuid(),
  ...over,
});

beforeEach(() => {
  getUser.mockReset();
  grantsResult.mockReset();
  staffRowActive.mockReset();
  insertCalls.length = 0;
  insertResult = { data: { id: "r-1" }, error: null };
});

describe("sendFwResidueBeacon — gate, then write; never throw", () => {
  it("a valid FW-guide sender lands a row attributed to the SESSION, not the claim", async () => {
    const sessionId = uuid();
    const claimed = uuid();
    getUser.mockResolvedValue({
      data: { user: { id: sessionId, email: "g@x.y", app_metadata: {} } },
    });
    grantsResult.mockResolvedValue(guideGrant(uuid()));
    const send = await fresh();
    await send(payload({ claimedActorUserId: claimed }));
    expect(insertCalls).toHaveLength(1);
    const { row } = insertCalls[0] as { row: Record<string, unknown> };
    // THE ATTRIBUTION RULE: the authenticated session is the sender; the claim rides
    // alongside as data. Swapping them is the misattribution the schema exists to
    // make visible.
    expect(row.session_user_id).toBe(sessionId);
    expect(row.claimed_actor_user_id).toBe(claimed);
    expect(row.queue_remaining).toBe(2);
  });

  it("a ROLE-LESS authenticated session is refused — no row (the poisoning gate)", async () => {
    // Any parent/student account can reach this endpoint; without a role gate they
    // could insert fabricated claims a human would act on (security review, 0.68).
    getUser.mockResolvedValue({
      data: { user: { id: uuid(), email: "p@x.y", app_metadata: {} } },
    });
    grantsResult.mockResolvedValue({ data: [], error: null }); // no grants, no claim
    const send = await fresh();
    await send(payload());
    expect(insertCalls).toHaveLength(0);
  });

  it("a STAFF session (admin claim + active row) passes the gate", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: uuid(), email: "s@x.y", app_metadata: { role: "admin" } } },
    });
    grantsResult.mockResolvedValue({ data: [], error: null });
    staffRowActive.mockResolvedValue(true);
    const send = await fresh();
    await send(payload({ application: "crm" }));
    expect(insertCalls).toHaveLength(1);
  });

  it("a malformed payload is refused before any read or write", async () => {
    const send = await fresh();
    await send({ outcome: "queue_preserved" }); // missing everything else
    expect(getUser).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("no resolvable session → dropped, not attributed, not thrown", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const send = await fresh();
    await expect(send(payload())).resolves.toBeUndefined();
    expect(insertCalls).toHaveLength(0);
  });

  it("an INSERT failure is non-fatal — the action still resolves (log-line fallback)", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: uuid(), email: "g@x.y", app_metadata: {} } },
    });
    grantsResult.mockResolvedValue(guideGrant(uuid()));
    insertResult = { data: null, error: { message: "table missing" } };
    const send = await fresh();
    await expect(send(payload())).resolves.toBeUndefined();
    expect(insertCalls).toHaveLength(1); // attempted, failed, degraded to the log line
  });

  it("the per-user rate limit closes the flood — the 21st report in a window is dropped", async () => {
    const sessionId = uuid(); // one user, one bucket
    getUser.mockResolvedValue({
      data: { user: { id: sessionId, email: "g@x.y", app_metadata: {} } },
    });
    grantsResult.mockResolvedValue(guideGrant(uuid()));
    const send = await fresh();
    for (let i = 0; i < 25; i += 1) await send(payload());
    // FW_RESIDUE_REPORT_RATE_LIMIT is 20 per 10 minutes; a looping bundle must not
    // flood the table into noise. (The real in-memory store runs here — the bucket
    // key is this test's unique uuid, so no cross-test bleed.)
    expect(insertCalls.length).toBe(20);
  });
});
