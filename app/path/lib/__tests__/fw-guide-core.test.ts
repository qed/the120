import { describe, expect, it } from "vitest";

import {
  claimFwGuideInvite,
  hashGuideInviteToken,
  issueFwGuideInvite,
  listFwCohortsForActor,
  loadFwCohort,
  loadStaffRowActive,
  provisionFwGuide,
} from "../fw-guide-core";
import { FW_GUIDE_INVITE_TTL_MS } from "../fw-access-rules";

/**
 * Fake Supabase client for the FW guide core (the harness pattern from
 * fw-provision-core.test.ts, narrowed to this file's tables).
 *
 * Why this file exists: Unit 1's review found the untested orchestration was its
 * biggest gap, and this core is worse in kind. It mints accounts across the
 * Supabase Auth API and PostgREST with no transaction spanning them, and its
 * sequencing decisions ARE the security properties — whether an existing account
 * may be adopted, whether the CAS runs before or after the password write, what
 * a lost race leaves behind. None of that is reachable from the pure-rules tests.
 */

type Row = Record<string, unknown>;

const BOSTON = "cohort-boston";
const HAMPTONS = "cohort-hamptons";
const PATH_COHORT = "cohort-sept";
const STAFF = "user-staff";
const NOW = Date.parse("2026-08-10T12:00:00Z");

type CreateUserOutcome = { ok: true } | { ok: false; code?: string; message: string };

type Seed = {
  cohorts?: Row[];
  staff?: Row[];
  grants?: Row[];
  invites?: Row[];
  authUsers?: Row[];
  createUserOutcomes?: CreateUserOutcome[];
  /** Force one table+op to error, to exercise the compensation branches. */
  failTable?: { table: string; op: "upsert" | "update" | "select"; message: string } | null;
  updateUserError?: string | null;
  /** Force getUserById to report an API FAILURE rather than a clean not-found —
   *  the distinction the reliability review found conflated. */
  getUserByIdError?: string | null;
  /** Runs after the claim CAS wins, before the password write — the only way to
   *  model a concurrent re-issue landing mid-claim. */
  afterClaimCas?: (tables: Record<string, Row[]>) => void;
  /** Runs immediately BEFORE the claim CAS executes, so a genuinely interleaved
   *  second claim (or a re-issue) can be modelled — the CAS's own race-losing
   *  branch is otherwise unreachable, since every sequential test short-circuits
   *  earlier at the pure verdict (testing review). */
  beforeClaimCas?: (tables: Record<string, Row[]>) => void;
};

function makeFakeDb(seed: Seed) {
  const tables: Record<string, Row[]> = {
    path_cohorts: [
      ...(seed.cohorts ?? [
        { id: BOSTON, slug: "boston-2026-08", kind: "fw" },
        { id: HAMPTONS, slug: "hamptons-2026-08", kind: "fw" },
        { id: PATH_COHORT, slug: "sept-2026", kind: "path" },
      ]),
    ],
    staff: [...(seed.staff ?? [{ id: STAFF, is_active: true }])],
    path_role_grants: [...(seed.grants ?? [])],
    path_fw_guide_invites: [...(seed.invites ?? [])],
  };
  const authUsers: Row[] = [...(seed.authUsers ?? [])];
  const outcomes = [...(seed.createUserOutcomes ?? [])];
  let idSeq = 1;
  const calls = { createUser: 0, deleteUser: 0, listUsers: 0, getUserById: 0, updateUser: 0 };
  let claimCasRuns = 0;

  function query(table: string) {
    const eqs: [string, unknown][] = [];
    const isNulls: string[] = [];
    let inFilter: [string, unknown[]] | null = null;
    const rows = () =>
      tables[table].filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          isNulls.every((c) => (r[c] ?? null) === null) &&
          (!inFilter || inFilter[1].includes(r[inFilter[0]]))
      );
    const failing = (op: "upsert" | "update" | "select") =>
      seed.failTable?.table === table && seed.failTable.op === op;

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        eqs.push([col, val]);
        return builder;
      },
      is(col: string, val: unknown) {
        if (val === null) isNulls.push(col);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        inFilter = [col, vals];
        return builder;
      },
      limit() {
        return builder;
      },
      async maybeSingle() {
        if (failing("select")) return { data: null, error: { message: seed.failTable!.message } };
        const hit = rows()[0];
        return { data: hit ? { ...hit } : null, error: null };
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        const result = failing("select")
          ? { data: null, error: { message: seed.failTable!.message } }
          : { data: rows().map((r) => ({ ...r })), error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
      upsert(payload: Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        const apply = () => {
          if (failing("upsert")) return { data: null, error: { message: seed.failTable!.message } };
          const keys = (opts?.onConflict ?? "").split(",").map((k) => k.trim()).filter(Boolean);
          for (const r of payload) {
            const idx = tables[table].findIndex((x) => keys.every((k) => x[k] === r[k]));
            if (idx === -1) tables[table].push({ id: `${table}-${idSeq++}`, ...r });
            else if (!opts?.ignoreDuplicates) tables[table][idx] = { ...tables[table][idx], ...r };
          }
          return { data: null, error: null };
        };
        return {
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(apply()).then(resolve, reject);
          },
        };
      },
      update(patch: Row) {
        const eqs2: [string, unknown][] = [];
        const isNulls2: string[] = [];
        const run = () => {
          if (failing("update")) return { data: null, error: { message: seed.failTable!.message } };
          const hits = tables[table].filter(
            (r) =>
              eqs2.every(([c, v]) => r[c] === v) && isNulls2.every((c) => (r[c] ?? null) === null)
          );
          hits.forEach((r) => Object.assign(r, patch));
          return { data: hits.map((r) => ({ id: r.id })), error: null };
        };
        const chain = {
          eq(col: string, val: unknown) {
            eqs2.push([col, val]);
            return chain;
          },
          is(col: string, val: unknown) {
            if (val === null) isNulls2.push(col);
            return chain;
          },
          select() {
            // The only `.update(...).select(...)` calls are the claim CAS and
            // the "ensure"-mode invite refresh CAS.
            seed.beforeClaimCas?.(tables);
            const result = run();
            claimCasRuns += 1;
            if (!result.error && (result.data ?? []).length > 0) seed.afterClaimCas?.(tables);
            return Promise.resolve(result);
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(run()).then(resolve, reject);
          },
        };
        return chain;
      },
    };
    return builder;
  }

  const db = {
    from: (table: string) => query(table),
    auth: {
      admin: {
        async createUser(payload: { email: string; app_metadata?: Row }) {
          const outcome = outcomes[calls.createUser] ?? { ok: true as const };
          calls.createUser += 1;
          if (outcome.ok === false) {
            return { data: { user: null }, error: { code: outcome.code, message: outcome.message } };
          }
          if (authUsers.some((u) => u.email === payload.email)) {
            return {
              data: { user: null },
              error: { code: "email_exists", message: "already registered" },
            };
          }
          const user = {
            id: `user-${idSeq++}`,
            email: payload.email,
            app_metadata: payload.app_metadata ?? {},
          };
          authUsers.push(user);
          return { data: { user }, error: null };
        },
        async getUserById(id: string) {
          calls.getUserById += 1;
          // An API FAILURE and a clean not-found are DIFFERENT facts; the real
          // client can return either, and the code must not conflate them.
          if (seed.getUserByIdError) {
            return { data: { user: null }, error: { message: seed.getUserByIdError } };
          }
          const user = authUsers.find((u) => u.id === id);
          return user ? { data: { user }, error: null } : { data: { user: null }, error: null };
        },
        async updateUserById(id: string, patch: Row) {
          calls.updateUser += 1;
          if (seed.updateUserError) return { data: null, error: { message: seed.updateUserError } };
          const user = authUsers.find((u) => u.id === id);
          if (!user) return { data: null, error: { message: "not found" } };
          Object.assign(user, patch);
          return { data: { user }, error: null };
        },
        async deleteUser(id: string) {
          calls.deleteUser += 1;
          const i = authUsers.findIndex((u) => u.id === id);
          if (i >= 0) authUsers.splice(i, 1);
          return { error: null };
        },
        async listUsers() {
          calls.listUsers += 1;
          return { data: { users: [...authUsers] }, error: null };
        },
      },
    },
  };

  /** Attach failure hooks AFTER setup, so seeding a fixture doesn't trip the
   *  very hook the test is arming. The builders read `seed` lazily by property,
   *  so assigning onto it takes effect from the next call. */
  const arm = (next: Seed) => Object.assign(seed, next);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, tables, authUsers, calls, arm, casRuns: () => claimCasRuns };
}

/* ═══════════════════════════════════════════════ authorization inputs (reads) ══ */

describe("loadFwCohort", () => {
  it("returns the authoritative id + kind", async () => {
    const { db } = makeFakeDb({});
    expect(await loadFwCohort(db, BOSTON)).toEqual({ id: BOSTON, kind: "fw" });
  });

  it("returns the REAL kind for a path cohort — it never launders one into 'fw'", async () => {
    expect(await loadFwCohort(makeFakeDb({}).db, PATH_COHORT)).toEqual({
      id: PATH_COHORT,
      kind: "path",
    });
  });

  it("null for a missing cohort and null on a read error — fail closed", async () => {
    expect(await loadFwCohort(makeFakeDb({}).db, "nope")).toBeNull();
    const failing = makeFakeDb({ failTable: { table: "path_cohorts", op: "select", message: "boom" } });
    expect(await loadFwCohort(failing.db, BOSTON)).toBeNull();
  });

  it("drops a row with a malformed id/kind rather than trusting it", async () => {
    const { db } = makeFakeDb({ cohorts: [{ id: BOSTON, slug: "x", kind: 42 }] });
    expect(await loadFwCohort(db, BOSTON)).toBeNull();
  });
});

describe("loadStaffRowActive — the bridge's revocable half", () => {
  it("true only for a live active row", async () => {
    expect(await loadStaffRowActive(makeFakeDb({}).db, STAFF)).toBe(true);
  });

  it("false for a deactivated row, a missing row, and a read error", async () => {
    expect(
      await loadStaffRowActive(makeFakeDb({ staff: [{ id: STAFF, is_active: false }] }).db, STAFF)
    ).toBe(false);
    expect(await loadStaffRowActive(makeFakeDb({ staff: [] }).db, STAFF)).toBe(false);
    const failing = makeFakeDb({ failTable: { table: "staff", op: "select", message: "boom" } });
    // An outage must never promote anyone to staff.
    expect(await loadStaffRowActive(failing.db, STAFF)).toBe(false);
  });
});

describe("listFwCohortsForActor", () => {
  it("staff see every fw cohort and no path cohort", async () => {
    const { db } = makeFakeDb({});
    const list = await listFwCohortsForActor(db, { grantedCohortIds: [], isStaff: true });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.cohorts.map((c) => c.id).sort()).toEqual([BOSTON, HAMPTONS]);
  });

  it("a guide sees only their granted fw cohorts", async () => {
    const { db } = makeFakeDb({});
    const list = await listFwCohortsForActor(db, { grantedCohortIds: [BOSTON], isStaff: false });
    expect(list).toEqual({ ok: true, cohorts: [{ id: BOSTON, slug: "boston-2026-08" }] });
  });

  it("a guide grant naming a PATH cohort surfaces nothing — kind is re-read, not trusted", async () => {
    const { db } = makeFakeDb({});
    expect(
      await listFwCohortsForActor(db, { grantedCohortIds: [PATH_COHORT], isStaff: false })
    ).toEqual({ ok: true, cohorts: [] });
  });

  it("a grant-less non-staff session short-circuits to empty without a query", async () => {
    const { db } = makeFakeDb({});
    expect(await listFwCohortsForActor(db, { grantedCohortIds: [], isStaff: false })).toEqual({
      ok: true,
      cohorts: [],
    });
  });

  it("a read error reports FAILURE, never an empty list", async () => {
    // The distinction the reliability review caught: this runs AFTER the caller
    // is authorized, so collapsing an outage to [] buys no safety and costs a
    // lie — the landing page renders "you aren't a guide on any cohort" for it,
    // sending a real guide to find staff over something a refresh fixes.
    const failing = makeFakeDb({
      failTable: { table: "path_cohorts", op: "select", message: "boom" },
    });
    expect(
      await listFwCohortsForActor(failing.db, { grantedCohortIds: [], isStaff: true })
    ).toEqual({ ok: false });
  });
});

/* ═══════════════════════════════════════════════════════ guide provisioning ══ */

const RAVI = { email: "Ravi@Example.com", cohortId: BOSTON, createdBy: STAFF };

describe("provisionFwGuide — the mint path", () => {
  it("mints a dormant, admin-less guide account and grants it into the cohort", async () => {
    const { db, tables, authUsers } = makeFakeDb({});
    const res = await provisionFwGuide(db, RAVI);

    expect(res).toEqual({ ok: true, userId: authUsers[0].id, email: "ravi@example.com", created: true });
    expect(authUsers[0].app_metadata).toEqual({ role: "guide" });
    // FW-R5: never the admin claim, so /crm yields crm-staff-only at the proxy.
    expect((authUsers[0].app_metadata as Row).role).not.toBe("admin");
    // Dormant until the invite is claimed — no password was ever set.
    expect(authUsers[0].password).toBeUndefined();
    expect(tables.path_role_grants).toHaveLength(1);
    expect(tables.path_role_grants[0]).toMatchObject({
      user_id: authUsers[0].id,
      role: "guide",
      scope_type: "cohort",
      scope_id: BOSTON,
    });
  });

  it("refuses a path cohort and a missing cohort", async () => {
    const { db, authUsers } = makeFakeDb({});
    expect(await provisionFwGuide(db, { ...RAVI, cohortId: PATH_COHORT })).toEqual({
      ok: false,
      reason: "cohort_not_fw",
    });
    expect(await provisionFwGuide(db, { ...RAVI, cohortId: "nope" })).toEqual({
      ok: false,
      reason: "cohort_not_found",
    });
    // Refused BEFORE any account exists.
    expect(authUsers).toHaveLength(0);
  });

  it("refuses an address in the FW student namespace, minting nothing", async () => {
    const { db, authUsers } = makeFakeDb({});
    expect(await provisionFwGuide(db, { ...RAVI, email: "maya.chen.fw@the120.school" })).toEqual({
      ok: false,
      reason: "invalid_email",
    });
    expect(authUsers).toHaveLength(0);
  });

  it("refuses a malformed address", async () => {
    const { db } = makeFakeDb({});
    for (const email of ["", "   ", "not-an-address"]) {
      expect(await provisionFwGuide(db, { ...RAVI, email }), email).toEqual({
        ok: false,
        reason: "invalid_email",
      });
    }
  });

  it("reports unavailable on a non-collision createUser failure", async () => {
    const { db } = makeFakeDb({
      createUserOutcomes: [{ ok: false, code: "500", message: "auth is down" }],
    });
    expect(await provisionFwGuide(db, RAVI)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("detects a collision reported ONLY by message, with no email_exists code", async () => {
    // The regex fallback exists precisely because the Admin API does not always
    // set the code — but the fake used to always set it, so only the code branch
    // was ever exercised and a broken regex would have shipped green (testing
    // review). Without this branch the adoption path is missed entirely and a
    // real collision reports "unavailable".
    const { db, authUsers } = makeFakeDb({
      authUsers: [{ id: "user-ravi", email: "ravi@example.com", app_metadata: { role: "guide" } }],
      createUserOutcomes: [{ ok: false, message: "Email address already registered" }],
    });
    expect(await provisionFwGuide(db, RAVI)).toEqual({
      ok: true,
      userId: "user-ravi",
      email: "ravi@example.com",
      created: false,
    });
    expect(authUsers).toHaveLength(1);
  });
});

describe("provisionFwGuide — adoption and idempotency", () => {
  it("adopts an existing GUIDE account and adds the second cohort's grant", async () => {
    // "A guide works Boston and Hamptons" is just calling this twice.
    const { db, tables, authUsers } = makeFakeDb({});
    const first = await provisionFwGuide(db, RAVI);
    expect(first.ok).toBe(true);
    const second = await provisionFwGuide(db, { ...RAVI, cohortId: HAMPTONS });

    expect(second).toEqual({
      ok: true,
      userId: authUsers[0].id,
      email: "ravi@example.com",
      created: false,
    });
    expect(authUsers).toHaveLength(1);
    expect(tables.path_role_grants.map((g) => g.scope_id).sort()).toEqual(
      [BOSTON, HAMPTONS].sort()
    );
  });

  it("re-running the SAME cohort is a no-op, not a duplicate grant", async () => {
    const { db, tables } = makeFakeDb({});
    await provisionFwGuide(db, RAVI);
    await provisionFwGuide(db, RAVI);
    expect(tables.path_role_grants).toHaveLength(1);
  });

  it("REFUSES to adopt a staff account — the escalation guard", async () => {
    // The invite this issues can set the account's password. Adopting a staff
    // account would mail a credential for it to whoever staff typed in the form.
    const { db, tables } = makeFakeDb({
      authUsers: [{ id: "user-admin", email: "ravi@example.com", app_metadata: { role: "admin" } }],
    });
    expect(await provisionFwGuide(db, RAVI)).toEqual({ ok: false, reason: "address_in_use" });
    expect(tables.path_role_grants).toEqual([]);
  });

  it("REFUSES to adopt a parent or student account", async () => {
    for (const role of ["parent", "student"]) {
      const { db, tables } = makeFakeDb({
        authUsers: [{ id: `user-${role}`, email: "ravi@example.com", app_metadata: { role } }],
      });
      expect(await provisionFwGuide(db, RAVI), role).toEqual({
        ok: false,
        reason: "address_in_use",
      });
      expect(tables.path_role_grants).toEqual([]);
    }
  });

  it("compensates a grant failure by deleting the account IT minted", async () => {
    const { db, authUsers, calls } = makeFakeDb({
      failTable: { table: "path_role_grants", op: "upsert", message: "grants are down" },
    });
    expect(await provisionFwGuide(db, RAVI)).toEqual({ ok: false, reason: "unavailable" });
    // No orphan account holding the address hostage for the retry.
    expect(authUsers).toHaveLength(0);
    expect(calls.deleteUser).toBe(1);
  });

  it("NEVER deletes an ADOPTED account when the grant fails", async () => {
    // The account predates this call and may hold other cohorts' grants; deleting
    // it would revoke a working guide because a second cohort's write failed.
    const { db, authUsers, calls } = makeFakeDb({
      authUsers: [{ id: "user-ravi", email: "ravi@example.com", app_metadata: { role: "guide" } }],
      failTable: { table: "path_role_grants", op: "upsert", message: "grants are down" },
    });
    expect(await provisionFwGuide(db, RAVI)).toEqual({ ok: false, reason: "unavailable" });
    expect(authUsers).toHaveLength(1);
    expect(calls.deleteUser).toBe(0);
  });

  it("SKIPS the compensation delete when a concurrent caller already granted the account", async () => {
    // Adversarial review: two staff double-submit the same NEW guide into two
    // cohorts. The loser adopts the winner's account. If the winner's own grant
    // write then fails, deleting "the account I minted" would yank it out from
    // under the loser's in-flight grant, failing BOTH staff for what looked like
    // one successful mint. `created` is necessary but not sufficient — the probe
    // is what makes it safe.
    const { db, authUsers, calls } = makeFakeDb({
      grants: [
        { id: "g-concurrent", user_id: "user-1", role: "guide", scope_type: "cohort", scope_id: HAMPTONS },
      ],
      failTable: { table: "path_role_grants", op: "upsert", message: "grants are down" },
    });
    expect(await provisionFwGuide(db, RAVI)).toEqual({ ok: false, reason: "unavailable" });
    expect(calls.deleteUser).toBe(0);
    expect(authUsers).toHaveLength(1);
  });
});

/* ═════════════════════════════════════════════════════ invite issue/re-issue ══ */

const seedGuide = (over: Row = {}) => ({
  id: "user-ravi",
  email: "ravi@example.com",
  app_metadata: { role: "guide" },
  ...over,
});

describe("issueFwGuideInvite", () => {
  it("mints a token, stores ONLY its hash, and stamps a 14-day expiry", async () => {
    const { db, tables } = makeFakeDb({ authUsers: [seedGuide()] });
    const res = await issueFwGuideInvite(db, { userId: "user-ravi", createdBy: STAFF, now: NOW });

    expect(res.ok && res.issued).toBe(true);
    if (!res.ok || !res.issued) return;
    const row = tables.path_fw_guide_invites[0];
    expect(row.token_hash).toBe(hashGuideInviteToken(res.token));
    // A database read must never reconstruct a live link.
    expect(JSON.stringify(row)).not.toContain(res.token);
    expect(Date.parse(row.expires_at as string) - NOW).toBe(FW_GUIDE_INVITE_TTL_MS);
    expect(row.claimed_at).toBeNull();
    expect(row.created_by).toBe(STAFF);
    expect(row.email).toBe("ravi@example.com");
  });

  it("a re-issue ROTATES the one row — the old hash is dead and the claim re-opens", async () => {
    // Decision 12's Friday-morning recovery. One row per account is what makes
    // "kills the old hash" structural rather than a discipline.
    const { db, tables } = makeFakeDb({ authUsers: [seedGuide()] });
    const first = await issueFwGuideInvite(db, { userId: "user-ravi", createdBy: STAFF, now: NOW });
    expect(first.ok && first.issued).toBe(true);
    if (!first.ok || !first.issued) return;
    // Simulate the guide having claimed it already (the forgot-password case).
    tables.path_fw_guide_invites[0].claimed_at = "2026-08-11T09:00:00Z";

    const second = await issueFwGuideInvite(db, {
      userId: "user-ravi",
      createdBy: STAFF,
      now: NOW + 86_400_000,
      mode: "reissue",
    });
    expect(second.ok && second.issued).toBe(true);
    if (!second.ok || !second.issued) return;

    expect(tables.path_fw_guide_invites).toHaveLength(1);
    expect(second.token).not.toBe(first.token);
    expect(tables.path_fw_guide_invites[0].token_hash).toBe(hashGuideInviteToken(second.token));
    expect(tables.path_fw_guide_invites[0].claimed_at).toBeNull();
  });

  it("REFUSES a non-guide account — no password-setting link for staff or parents", async () => {
    const { db, tables } = makeFakeDb({
      authUsers: [seedGuide({ app_metadata: { role: "admin" } })],
    });
    expect(await issueFwGuideInvite(db, { userId: "user-ravi", createdBy: STAFF, now: NOW })).toEqual(
      { ok: false, reason: "not_a_guide_account" }
    );
    expect(tables.path_fw_guide_invites).toEqual([]);
  });

  it("refuses a missing account and an account with no email", async () => {
    const { db } = makeFakeDb({ authUsers: [] });
    expect(await issueFwGuideInvite(db, { userId: "nope", createdBy: STAFF, now: NOW })).toEqual({
      ok: false,
      reason: "guide_not_found",
    });
    const noEmail = makeFakeDb({ authUsers: [seedGuide({ email: "" })] });
    expect(
      await issueFwGuideInvite(noEmail.db, { userId: "user-ravi", createdBy: STAFF, now: NOW })
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("distinguishes an Admin API FAILURE from a genuinely absent account", async () => {
    // Reliability review: collapsing these told staff "that guide account can't
    // be sent a link — check the guide list" (sending them to investigate the
    // roster) when the truthful answer was "the lookup call failed, retry".
    const { db } = makeFakeDb({
      authUsers: [seedGuide()],
      getUserByIdError: "auth API is down",
    });
    expect(
      await issueFwGuideInvite(db, { userId: "user-ravi", createdBy: STAFF, now: NOW })
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("issueFwGuideInvite — 'ensure' mode (the merged P1 fix)", () => {
  it("mints for a guide who has no invite row yet", async () => {
    const { db, tables } = makeFakeDb({ authUsers: [seedGuide()] });
    const res = await issueFwGuideInvite(db, {
      userId: "user-ravi",
      createdBy: STAFF,
      now: NOW,
      mode: "ensure",
    });
    expect(res.ok && res.issued).toBe(true);
    expect(tables.path_fw_guide_invites).toHaveLength(1);
  });

  it("REFUSES to touch an already-CLAIMED invite — the whole point of the fix", async () => {
    // Provisioning is idempotent so "a guide works Boston AND Hamptons" is just
    // calling it again. Under the old unconditional re-issue, that flow un-marked
    // an actively working guide as unclaimed (corrupting the pre-event "all
    // guides claimed" checklist) and mailed them a live password-setting link
    // they never asked for — which, clicked mid-event on a shared iPad, would
    // silently overwrite the password they were working with.
    const { db, tables } = await seedIssued();
    const before = { ...tables.path_fw_guide_invites[0] };
    tables.path_fw_guide_invites[0].claimed_at = "2026-08-21T09:00:00Z";

    const res = await issueFwGuideInvite(db, {
      userId: "user-ravi",
      createdBy: STAFF,
      now: NOW + 86_400_000,
      mode: "ensure",
    });

    expect(res).toEqual({ ok: true, issued: false, email: "ravi@example.com" });
    // Token untouched, claim untouched, expiry untouched.
    expect(tables.path_fw_guide_invites[0].token_hash).toBe(before.token_hash);
    expect(tables.path_fw_guide_invites[0].claimed_at).toBe("2026-08-21T09:00:00Z");
    expect(tables.path_fw_guide_invites[0].expires_at).toBe(before.expires_at);
  });

  it("LEAVES a live unclaimed invite alone — a link in the inbox IS a credential", async () => {
    // Round-2 adversarial: rotating a still-valid unclaimed link reproduces a
    // narrower form of the original bug. The guide may be opening that link right
    // now; rotating it makes their claim CAS miss the old hash, hands them the
    // dead-link message, CHARGES them a strike for a legitimate attempt, and
    // mails a replacement they have no reason to look for.
    const { db, tables, token } = await seedIssued();
    const before = { ...tables.path_fw_guide_invites[0] };

    const res = await issueFwGuideInvite(db, {
      userId: "user-ravi",
      createdBy: STAFF,
      now: NOW + 86_400_000, // still inside the 14-day window
      mode: "ensure",
    });

    expect(res).toEqual({ ok: true, issued: false, email: "ravi@example.com" });
    expect(tables.path_fw_guide_invites[0].token_hash).toBe(before.token_hash);
    // …and the original link still claims cleanly.
    expect((await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 86_400_001 })).ok)
      .toBe(true);
  });

  it("REFRESHES an EXPIRED invite — then the guide genuinely has no credential", async () => {
    const { db, tables, token } = await seedIssued();
    const res = await issueFwGuideInvite(db, {
      userId: "user-ravi",
      createdBy: STAFF,
      now: NOW + FW_GUIDE_INVITE_TTL_MS + 1000,
      mode: "ensure",
    });
    expect(res.ok && res.issued).toBe(true);
    if (!res.ok || !res.issued) return;
    expect(res.token).not.toBe(token);
    expect(tables.path_fw_guide_invites[0].token_hash).toBe(hashGuideInviteToken(res.token));
  });

  it("REFRESHES a row with a malformed expiry rather than leaving a guide stranded", async () => {
    const { db, tables } = await seedIssued();
    tables.path_fw_guide_invites[0].expires_at = "not-a-date";
    const res = await issueFwGuideInvite(db, {
      userId: "user-ravi",
      createdBy: STAFF,
      now: NOW + 1000,
      mode: "ensure",
    });
    expect(res.ok && res.issued).toBe(true);
  });

  it("reports unavailable when the ensure-mode PROBE fails", async () => {
    // The probe decides whether a credential already exists. Failing it open —
    // falling through to the upsert — would rotate a claimed guide's token on a
    // read blip, which is the exact bug "ensure" mode exists to prevent.
    const { db, arm } = await seedIssued();
    arm({ failTable: { table: "path_fw_guide_invites", op: "select", message: "down" } });
    expect(
      await issueFwGuideInvite(db, {
        userId: "user-ravi",
        createdBy: STAFF,
        now: NOW + 1000,
        mode: "ensure",
      })
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports unavailable when the ensure-mode REFRESH write fails", async () => {
    // An EXPIRED invite, so the refresh branch is actually reached (a live one
    // now returns early, untouched).
    const { db, arm, tables } = await seedIssued();
    const before = { ...tables.path_fw_guide_invites[0] };
    arm({ failTable: { table: "path_fw_guide_invites", op: "update", message: "down" } });
    expect(
      await issueFwGuideInvite(db, {
        userId: "user-ravi",
        createdBy: STAFF,
        now: NOW + FW_GUIDE_INVITE_TTL_MS + 1000,
        mode: "ensure",
      })
    ).toEqual({ ok: false, reason: "unavailable" });
    // A failed refresh leaves the existing row intact rather than half-rotated.
    expect(tables.path_fw_guide_invites[0].token_hash).toBe(before.token_hash);
  });

  it("does NOT rotate on top of a claim that lands between the probe and the write", async () => {
    // The CAS on `claimed_at is null` closes the probe→write window: a guide who
    // credentials themselves in that gap must not be silently un-claimed. Uses an
    // EXPIRED invite so the refresh branch (and therefore the CAS) is reached.
    const { db, tables } = await seedIssued({
      beforeClaimCas: (t) => {
        t.path_fw_guide_invites[0].claimed_at = "2026-08-21T09:00:00Z";
      },
    });
    const res = await issueFwGuideInvite(db, {
      userId: "user-ravi",
      createdBy: STAFF,
      now: NOW + FW_GUIDE_INVITE_TTL_MS + 1000,
      mode: "ensure",
    });
    expect(res).toEqual({ ok: true, issued: false, email: "ravi@example.com" });
    expect(tables.path_fw_guide_invites[0].claimed_at).toBe("2026-08-21T09:00:00Z");
  });

  it("reports unavailable when the row write fails", async () => {
    const { db } = makeFakeDb({
      authUsers: [seedGuide()],
      failTable: { table: "path_fw_guide_invites", op: "upsert", message: "down" },
    });
    expect(await issueFwGuideInvite(db, { userId: "user-ravi", createdBy: STAFF, now: NOW })).toEqual(
      { ok: false, reason: "unavailable" }
    );
  });
});

/* ═════════════════════════════════════════════════════════════ invite claim ══ */

const PASSWORD = "harbour lantern quilt";

async function seedIssued(seed: Seed = {}) {
  // Seed the row WITHOUT the hooks/errors under test, then attach them — a
  // beforeClaimCas hook (or a forced getUserById failure) must not fire during
  // setup, or the fixture the test needs never gets written.
  const fake = makeFakeDb({
    authUsers: [seedGuide()],
    ...seed,
    beforeClaimCas: undefined,
    getUserByIdError: null,
  });
  const issued = await issueFwGuideInvite(fake.db, {
    userId: "user-ravi",
    createdBy: STAFF,
    now: NOW,
  });
  if (!issued.ok || !issued.issued) throw new Error("seed failed");
  fake.arm(seed);
  return { ...fake, token: issued.token };
}

describe("claimFwGuideInvite", () => {
  it("sets the password, burns the token, and returns the guide", async () => {
    const { db, tables, authUsers, token } = await seedIssued();
    const res = await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 1000 });

    expect(res).toEqual({ ok: true, userId: "user-ravi", email: "ravi@example.com" });
    expect(authUsers[0].password).toBe(PASSWORD);
    expect(tables.path_fw_guide_invites[0].claimed_at).toBe(new Date(NOW + 1000).toISOString());
  });

  it("a SECOND claim on the same token is a dead link", async () => {
    const { db, token } = await seedIssued();
    expect((await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 1 })).ok).toBe(true);
    expect(await claimFwGuideInvite(db, { token, password: "other words here", now: NOW + 2 })).toEqual(
      { ok: false, reason: "dead_link" }
    );
  });

  it("an unknown token is a dead link — one message, no enumeration", async () => {
    const { db } = await seedIssued();
    expect(
      await claimFwGuideInvite(db, { token: "not-a-real-token", password: PASSWORD, now: NOW })
    ).toEqual({ ok: false, reason: "dead_link" });
  });

  it("an expired token is a dead link", async () => {
    const { db, authUsers, token } = await seedIssued();
    expect(
      await claimFwGuideInvite(db, {
        token,
        password: PASSWORD,
        now: NOW + FW_GUIDE_INVITE_TTL_MS + 1,
      })
    ).toEqual({ ok: false, reason: "dead_link" });
    expect(authUsers[0].password).toBeUndefined();
  });

  it("a re-issue kills a claim in flight — the old token affects zero rows", async () => {
    const { db, tables, authUsers, token } = await seedIssued();
    // Staff re-issues before the guide submits the old link.
    const reissued = await issueFwGuideInvite(db, {
      userId: "user-ravi",
      createdBy: STAFF,
      now: NOW + 60_000,
    });
    expect(reissued.ok).toBe(true);

    expect(await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 61_000 })).toEqual({
      ok: false,
      reason: "dead_link",
    });
    expect(authUsers[0].password).toBeUndefined();
    expect(tables.path_fw_guide_invites[0].claimed_at).toBeNull();
  });

  it("REJECTS a weak password BEFORE burning the token — a bad try must not cost the link", async () => {
    const { db, tables, authUsers, token, casRuns } = await seedIssued();
    const res = await claimFwGuideInvite(db, { token, password: "aaa", now: NOW + 1 });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("weak_password");
    expect(res.message).toBeTruthy();
    expect(casRuns()).toBe(0);
    expect(tables.path_fw_guide_invites[0].claimed_at).toBeNull();
    expect(authUsers[0].password).toBeUndefined();

    // …and the same link still works with a good password.
    expect((await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 2 })).ok).toBe(true);
  });

  it("RELEASES the claim when the password write fails — the guide's link keeps working", async () => {
    const { db, tables, token } = await seedIssued({ updateUserError: "auth is down" });
    expect(await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 1 })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    // Compensated: claimed_at is back to null, so the link in the guide's inbox
    // is still live rather than burned for nothing.
    expect(tables.path_fw_guide_invites[0].claimed_at).toBeNull();
  });

  it("does NOT release a claim whose token was rotated between the CAS and the failure", async () => {
    // A concurrent staff re-issue landing mid-claim owns the row now; un-claiming
    // it on the old hash would corrupt the fresh invite's state.
    const { db, tables, token } = await seedIssued({
      updateUserError: "auth is down",
      afterClaimCas: (tables) => {
        tables.path_fw_guide_invites[0].token_hash = "rotated-by-a-concurrent-reissue";
        tables.path_fw_guide_invites[0].claimed_at = "2026-08-11T09:00:00Z";
      },
    });
    expect(await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 1 })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(tables.path_fw_guide_invites[0].claimed_at).toBe("2026-08-11T09:00:00Z");
  });

  it("REFUSES to claim onto an account that is no longer a guide", async () => {
    const { db, authUsers, tables, token } = await seedIssued();
    authUsers[0].app_metadata = { role: "admin" };
    expect(await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 1 })).toEqual({
      ok: false,
      reason: "dead_link",
    });
    expect(authUsers[0].password).toBeUndefined();
    expect(tables.path_fw_guide_invites[0].claimed_at).toBeNull();
  });

  it("REFUSES when the account is gone", async () => {
    const { db, authUsers, token } = await seedIssued();
    authUsers.length = 0;
    expect(await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 1 })).toEqual({
      ok: false,
      reason: "dead_link",
    });
  });

  it("reports UNAVAILABLE (not dead_link) when the account lookup itself fails", async () => {
    // The reliability P1. `user_id ... on delete restrict` makes a live invite
    // pointing at a deleted account near-impossible, so an error here is almost
    // always a venue-wifi blip. Reporting dead_link told the guide their fresh
    // link was dead AND kept their rate-limit strike (only unavailable and
    // weak_password release one) — eating a shared per-IP attempt.
    const { db, authUsers, token } = await seedIssued({ getUserByIdError: "auth API is down" });
    expect(await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 1 })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(authUsers[0].password).toBeUndefined();
  });

  it("loses the CAS to a genuinely interleaved claim — exactly one winner", async () => {
    // Every other dead_link test short-circuits at the pure verdict; this is the
    // only one that reaches `(claimed.data ?? []).length === 0`, the line whose
    // own comment calls it the property that "cardinality picks the winner of
    // two simultaneous claims" (testing review).
    const { db, tables, authUsers, token } = await seedIssued({
      beforeClaimCas: (t) => {
        // A rival claim commits between our SELECT/verdict and our CAS.
        t.path_fw_guide_invites[0].claimed_at = "2026-08-21T09:00:00Z";
      },
    });
    expect(await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 1 })).toEqual({
      ok: false,
      reason: "dead_link",
    });
    // The rival's claim stands; we neither stole it nor set a password.
    expect(tables.path_fw_guide_invites[0].claimed_at).toBe("2026-08-21T09:00:00Z");
    expect(authUsers[0].password).toBeUndefined();
  });

  it("reports unavailable (not dead link) on a read outage, so the caller can retry", async () => {
    const { db } = makeFakeDb({
      authUsers: [seedGuide()],
      failTable: { table: "path_fw_guide_invites", op: "select", message: "down" },
    });
    expect(
      await claimFwGuideInvite(db, { token: "anything-at-all", password: PASSWORD, now: NOW })
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});
