import { describe, expect, it } from "vitest";

import {
  createFwCohort,
  hashFwBoardToken,
  listFwCohortGuides,
  listFwOpsCohorts,
  loadFwOpsBoardToken,
  loadFwOpsCohort,
  mintFwBoardToken,
  recordFwOpsAudit,
  revokeFwBoardToken,
  revokeFwGuideGrant,
} from "../fw-ops-core";

/**
 * Fake Supabase client for the FW ops core (FW Unit 5) — the harness pattern
 * from `fw-guide-core.test.ts`, widened to this file's tables and operations.
 *
 * Why this file exists at all: the plan's house rule, learned the expensive way
 * in Units 2, 3 and 4, is that impure shells get tested too and the COMPOSITION
 * is where the bugs live. Every one of the sequences below has halves that are
 * individually obvious and a composition that is not — the mint that must revoke
 * before it inserts (and undo the revoke if the insert fails), the revoke that
 * must delete exactly one cohort's grant and no other, the list that must pick
 * the LATEST token per cohort rather than the active one.
 */

type Row = Record<string, unknown>;

const BOSTON = "cohort-boston";
const HAMPTONS = "cohort-hamptons";
const PATH_COHORT = "cohort-sept";
const STAFF = "user-staff";
const RAVI = "user-ravi";
const DANA = "user-dana";

/** Fri 21 Aug 2026, 09:00 → Sun 23 Aug 17:00 Eastern, as stored instants. */
const BOSTON_START = "2026-08-21T13:00:00.000Z";
const BOSTON_END = "2026-08-23T21:00:00.000Z";
const BOSTON_TOKEN_EXPIRY = "2026-08-24T03:00:00.000Z";
/** Mid-event Saturday. */
const NOW = Date.parse("2026-08-22T15:00:00Z");

type Failure = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  message: string;
  code?: string;
  /** Apply the write, THEN report an error — a committed mutation whose
   *  response was lost. This is exactly `fwWrite`'s documented "a timed-out
   *  write MAY still land" case, and the only way to reach the post-write
   *  verification paths. */
  applyAnyway?: boolean;
  /** Fail only on the Nth matching call (1-based), so a sequence can fail
   *  midway rather than from the start. */
  onCall?: number;
};

type Seed = {
  cohorts?: Row[];
  grants?: Row[];
  invites?: Row[];
  tokens?: Row[];
  members?: Row[];
  audit?: Row[];
  authUsers?: Row[];
  /** Force one table+op to error, to exercise the compensation branches. */
  failTable?: Failure | null;
  /** SEVERAL injected failures, for the sequences that must fail twice — the
   *  mint whose insert fails AND whose restore then fails is the only way to
   *  reach the "board is dark and we could not put it back" branch. */
  failTables?: Failure[];
  getUserByIdError?: string | null;
};

function makeFakeDb(seed: Seed) {
  const tables: Record<string, Row[]> = {
    path_cohorts: [
      ...(seed.cohorts ?? [
        {
          id: BOSTON,
          slug: "boston-2026-08",
          kind: "fw",
          starts_at: BOSTON_START,
          ends_at: BOSTON_END,
          time_zone: "America/New_York",
          created_at: "2026-07-01T00:00:00Z",
        },
        {
          id: HAMPTONS,
          slug: "hamptons-2026-08",
          kind: "fw",
          starts_at: "2026-08-28T13:00:00.000Z",
          ends_at: "2026-08-30T21:00:00.000Z",
          time_zone: "America/New_York",
          created_at: "2026-06-01T00:00:00Z",
        },
        { id: PATH_COHORT, slug: "sept-2026", kind: "path", created_at: "2026-05-01T00:00:00Z" },
      ]),
    ],
    path_role_grants: [...(seed.grants ?? [])],
    path_fw_guide_invites: [...(seed.invites ?? [])],
    path_fw_board_tokens: [...(seed.tokens ?? [])],
    path_cohort_members: [...(seed.members ?? [])],
    path_fw_ops_audit: [...(seed.audit ?? [])],
  };
  const authUsers: Row[] = [
    ...(seed.authUsers ?? [
      { id: RAVI, email: "ravi@example.com", app_metadata: { role: "guide" } },
      { id: DANA, email: "dana@example.com", app_metadata: { role: "guide" } },
    ]),
  ];
  let idSeq = 1;
  const failCounts: Record<string, number> = {};
  const failures: Failure[] = [...(seed.failTables ?? []), ...(seed.failTable ? [seed.failTable] : [])];

  function query(table: string) {
    const eqs: [string, unknown][] = [];
    const isNulls: string[] = [];
    let inFilter: [string, unknown[]] | null = null;
    let orderBy: { col: string; ascending: boolean } | null = null;
    let limitTo: number | null = null;
    let rangeAt: [number, number] | null = null;

    /** Returns the injected error, or null. `applyAnyway` failures are reported
     *  separately so the caller can commit first and fail after. */
    const failureFor = (op: "select" | "insert" | "update" | "delete") => {
      const hit = failures.find((f) => f.table === table && f.op === op);
      if (!hit) return null;
      const key = `${table}:${op}`;
      failCounts[key] = (failCounts[key] ?? 0) + 1;
      if (hit.onCall && failCounts[key] !== hit.onCall) return null;
      return hit;
    };
    const failing = (op: "select" | "insert" | "update" | "delete") => {
      const hit = failureFor(op);
      if (!hit || hit.applyAnyway) return null;
      return { message: hit.message, code: hit.code };
    };
    /** Checked AFTER the operation has mutated the tables. */
    const failingAfter = (op: "select" | "insert" | "update" | "delete") => {
      const hit = failures.find((f) => f.table === table && f.op === op && f.applyAnyway);
      return hit ? { message: hit.message, code: hit.code } : null;
    };

    const rows = () => {
      let out = tables[table].filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          isNulls.every((c) => (r[c] ?? null) === null) &&
          (!inFilter || inFilter[1].includes(r[inFilter[0]]))
      );
      if (orderBy) {
        const { col, ascending } = orderBy;
        out = [...out].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (rangeAt) out = out.slice(rangeAt[0], rangeAt[1] + 1);
      if (limitTo !== null) out = out.slice(0, limitTo);
      return out;
    };

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
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, ascending: opts?.ascending !== false };
        return builder;
      },
      limit(n: number) {
        limitTo = n;
        return builder;
      },
      range(from: number, to: number) {
        rangeAt = [from, to];
        return builder;
      },
      async maybeSingle() {
        const fail = failing("select");
        if (fail) return { data: null, error: fail };
        const hit = rows()[0];
        return { data: hit ? { ...hit } : null, error: null };
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        const fail = failing("select");
        const result = fail
          ? { data: null, error: fail }
          : { data: rows().map((r) => ({ ...r })), error: null };
        return Promise.resolve(result).then(resolve, reject);
      },

      insert(payload: Row[]) {
        const written: Row[] = [];
        const apply = () => {
          const fail = failing("insert");
          if (fail) return { data: null, error: fail };
          for (const r of payload) {
            // The partial unique index the mint sequence depends on:
            // one live token per cohort. Modelled, because the whole
            // revoke-then-insert ordering exists BECAUSE of it.
            if (
              table === "path_fw_board_tokens" &&
              tables[table].some(
                (x) => x.cohort_id === r.cohort_id && (x.revoked_at ?? null) === null
              )
            ) {
              return {
                data: null,
                error: { code: "23505", message: "one active token per cohort" },
              };
            }
            if (
              table === "path_cohorts" &&
              tables[table].some((x) => x.slug === r.slug)
            ) {
              return { data: null, error: { code: "23505", message: "duplicate slug" } };
            }
            const row = { id: `${table}-${idSeq++}`, created_at: "2026-08-22T15:00:00Z", ...r };
            tables[table].push(row);
            written.push(row);
          }
          return { data: null, error: null };
        };
        const chain = {
          select() {
            const result = apply();
            return {
              async maybeSingle() {
                if (result.error) return { data: null, error: result.error };
                return { data: written[0] ? { ...written[0] } : null, error: null };
              },
              then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                const out = result.error
                  ? result
                  : { data: written.map((r) => ({ ...r })), error: null };
                return Promise.resolve(out).then(resolve, reject);
              },
            };
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(apply()).then(resolve, reject);
          },
        };
        return chain;
      },

      update(patch: Row) {
        const eqs2: [string, unknown][] = [];
        const isNulls2: string[] = [];
        let inFilter2: [string, unknown[]] | null = null;
        const run = () => {
          const fail = failing("update");
          if (fail) return { data: null, error: fail };
          const hits = tables[table].filter(
            (r) =>
              eqs2.every(([c, v]) => r[c] === v) &&
              isNulls2.every((c) => (r[c] ?? null) === null) &&
              (!inFilter2 || inFilter2[1].includes(r[inFilter2[0]]))
          );
          // The partial unique index again: un-revoking a token while another
          // live one exists must be REFUSED by the database, which is exactly
          // what makes the mint's compensation safe under concurrency.
          if (
            table === "path_fw_board_tokens" &&
            (patch.revoked_at ?? null) === null &&
            hits.some((h) =>
              tables[table].some(
                (x) => x !== h && x.cohort_id === h.cohort_id && (x.revoked_at ?? null) === null
              )
            )
          ) {
            return {
              data: null,
              error: { code: "23505", message: "one active token per cohort" },
            };
          }
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
          in(col: string, vals: unknown[]) {
            inFilter2 = [col, vals];
            return chain;
          },
          select() {
            return Promise.resolve(run());
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(run()).then(resolve, reject);
          },
        };
        return chain;
      },

      delete() {
        const eqs3: [string, unknown][] = [];
        const run = () => {
          const fail = failing("delete");
          if (fail) return { data: null, error: fail };
          const hits = tables[table].filter((r) => eqs3.every(([c, v]) => r[c] === v));
          tables[table] = tables[table].filter((r) => !hits.includes(r));
          const after = failingAfter("delete");
          if (after) return { data: null, error: after };
          return { data: hits.map((r) => ({ id: r.id })), error: null };
        };
        const chain = {
          eq(col: string, val: unknown) {
            eqs3.push([col, val]);
            return chain;
          },
          select() {
            return Promise.resolve(run());
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
        async getUserById(id: string) {
          if (seed.getUserByIdError) {
            return { data: { user: null }, error: { message: seed.getUserByIdError } };
          }
          const hit = authUsers.find((u) => u.id === id);
          return { data: { user: hit ? { ...hit } : null }, error: null };
        },
      },
    },
  } as unknown as Parameters<typeof loadFwOpsCohort>[0];

  return { db, tables, authUsers };
}

/* ═══════════════════════════════════════════════════════════════ the cohort ══ */

describe("createFwCohort", () => {
  it("writes kind='fw', the window, the zone, and the creator", async () => {
    const { db, tables } = makeFakeDb({ cohorts: [] });
    const res = await createFwCohort(db, {
      slug: "boston-2026-08",
      startsAt: BOSTON_START,
      endsAt: BOSTON_END,
      timeZone: "America/New_York",
      createdBy: STAFF,
    });

    expect(res).toMatchObject({ ok: true, slug: "boston-2026-08" });
    expect(tables.path_cohorts).toHaveLength(1);
    expect(tables.path_cohorts[0]).toMatchObject({
      slug: "boston-2026-08",
      kind: "fw",
      starts_at: BOSTON_START,
      ends_at: BOSTON_END,
      time_zone: "America/New_York",
      created_by: STAFF,
    });
  });

  it("reports a slug collision as its own reason, not as a generic failure", async () => {
    const { db } = makeFakeDb({});
    expect(
      await createFwCohort(db, {
        slug: "boston-2026-08",
        startsAt: BOSTON_START,
        endsAt: BOSTON_END,
        timeZone: "America/New_York",
        createdBy: STAFF,
      })
    ).toEqual({ ok: false, reason: "slug_taken" });
  });

  it("refuses an unallowlisted zone and writes NOTHING", async () => {
    const { db, tables } = makeFakeDb({ cohorts: [] });
    expect(
      await createFwCohort(db, {
        slug: "london-2026",
        startsAt: BOSTON_START,
        endsAt: BOSTON_END,
        timeZone: "Europe/London",
        createdBy: STAFF,
      })
    ).toEqual({ ok: false, reason: "invalid_time_zone" });
    expect(tables.path_cohorts).toHaveLength(0);
  });

  it("reports a genuine write failure as unavailable, not as a slug collision", async () => {
    const { db } = makeFakeDb({
      cohorts: [],
      failTable: { table: "path_cohorts", op: "insert", message: "down" },
    });
    expect(
      await createFwCohort(db, {
        slug: "boston-2026-08",
        startsAt: BOSTON_START,
        endsAt: BOSTON_END,
        timeZone: "America/New_York",
        createdBy: STAFF,
      })
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("loadFwOpsCohort", () => {
  it("narrows the window and the zone", async () => {
    const { db } = makeFakeDb({});
    expect(await loadFwOpsCohort(db, BOSTON)).toEqual({
      id: BOSTON,
      slug: "boston-2026-08",
      kind: "fw",
      startsAt: BOSTON_START,
      endsAt: BOSTON_END,
      timeZone: "America/New_York",
    });
  });

  it("drops a zone outside the allowlist rather than handing it to Intl", async () => {
    // Intl.DateTimeFormat THROWS RangeError on an unrecognised zone, from inside
    // a render. A hand-edited row must degrade to a labelled UTC reading.
    const { db } = makeFakeDb({
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw", ends_at: BOSTON_END, time_zone: "Mars/X" }],
    });
    expect((await loadFwOpsCohort(db, BOSTON))?.timeZone).toBeNull();
  });

  it("returns null on a read failure — fail closed, never a fabricated cohort", async () => {
    const { db } = makeFakeDb({
      failTable: { table: "path_cohorts", op: "select", message: "boom" },
    });
    expect(await loadFwOpsCohort(db, BOSTON)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════ board tokens ══ */

describe("mintFwBoardToken", () => {
  it("returns the raw token once and stores only its hash, with the derived expiry", async () => {
    const { db, tables } = makeFakeDb({});
    const res = await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.expiresAt).toBe(BOSTON_TOKEN_EXPIRY);
    expect(res.revokedPrior).toBe(false);
    expect(res.token).toHaveLength(43); // 32 bytes, base64url

    expect(tables.path_fw_board_tokens).toHaveLength(1);
    const stored = tables.path_fw_board_tokens[0];
    expect(stored.token_hash).toBe(hashFwBoardToken(res.token));
    // The raw value must appear NOWHERE in the row — a database read can never
    // reconstruct a live projector URL.
    expect(JSON.stringify(stored)).not.toContain(res.token);
    expect(stored).toMatchObject({ cohort_id: BOSTON, created_by: STAFF, expires_at: BOSTON_TOKEN_EXPIRY });
  });

  it("mints a DIFFERENT token every time", async () => {
    const { db } = makeFakeDb({});
    const a = await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    const b = await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    expect(a.ok && b.ok && a.token !== b.token).toBe(true);
  });

  it("re-mint revokes the prior token, names the revoker, and says it did", async () => {
    const { db, tables } = makeFakeDb({});
    const first = await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    const second = await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: DANA, now: NOW });

    expect(second).toMatchObject({ ok: true, revokedPrior: true });
    expect(tables.path_fw_board_tokens).toHaveLength(2);
    const prior = tables.path_fw_board_tokens.find(
      (t) => first.ok && t.token_hash === hashFwBoardToken(first.token)
    );
    expect(prior).toMatchObject({ revoked_by: DANA });
    expect(prior!.revoked_at).not.toBeNull();
    // Exactly one live token survives — the invariant the partial unique index
    // enforces and the ops surface depends on.
    expect(
      tables.path_fw_board_tokens.filter((t) => (t.revoked_at ?? null) === null)
    ).toHaveLength(1);
  });

  it("refuses a kind='path' cohort and writes nothing (G18)", async () => {
    const { db, tables } = makeFakeDb({});
    expect(
      await mintFwBoardToken(db, { cohortId: PATH_COHORT, actorUserId: STAFF, now: NOW })
    ).toEqual({ ok: false, reason: "cohort_not_fw" });
    expect(tables.path_fw_board_tokens).toHaveLength(0);
  });

  it("refuses a cohort with no end date", async () => {
    const { db } = makeFakeDb({
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw", ends_at: null }],
    });
    expect(await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW })).toEqual({
      ok: false,
      reason: "no_event_window",
    });
  });

  it("refuses a weekend that has already closed", async () => {
    const { db } = makeFakeDb({
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw", ends_at: "2026-08-01T21:00:00Z" }],
    });
    expect(await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW })).toEqual({
      ok: false,
      reason: "window_passed",
    });
  });

  it("refuses a missing cohort without touching the token table", async () => {
    const { db, tables } = makeFakeDb({});
    expect(await mintFwBoardToken(db, { cohortId: "nope", actorUserId: STAFF, now: NOW })).toEqual({
      ok: false,
      reason: "cohort_not_found",
    });
    expect(tables.path_fw_board_tokens).toHaveLength(0);
  });

  it("RESTORES the prior token when the replacement insert fails", async () => {
    // The compensation that keeps a live board alive. Without it, a failed
    // re-mint leaves the cohort with a revoked token and no replacement: the
    // projector goes dark and the URL that was working no longer does.
    const { db, tables } = makeFakeDb({
      tokens: [
        {
          id: "tok-1",
          cohort_id: BOSTON,
          token_hash: "old",
          expires_at: BOSTON_TOKEN_EXPIRY,
          revoked_at: null,
          created_at: "2026-08-21T10:00:00Z",
        },
      ],
      failTable: { table: "path_fw_board_tokens", op: "insert", message: "insert down" },
    });

    expect(await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(tables.path_fw_board_tokens).toHaveLength(1);
    expect(tables.path_fw_board_tokens[0]).toMatchObject({
      id: "tok-1",
      token_hash: "old",
      revoked_at: null,
      revoked_by: null,
    });
  });

  it("reports unavailable — and leaves the prior revoked — when the restore ALSO fails", async () => {
    // The loud case: the board is dark and the core cannot put it back. What it
    // must NOT do is report success, because staff would then project a URL
    // that does not work. The log line is the only recovery signal there is.
    const { db, tables } = makeFakeDb({
      tokens: [
        {
          id: "tok-1",
          cohort_id: BOSTON,
          token_hash: "old",
          expires_at: BOSTON_TOKEN_EXPIRY,
          revoked_at: null,
          created_at: "2026-08-21T10:00:00Z",
        },
      ],
      failTables: [
        { table: "path_fw_board_tokens", op: "insert", message: "insert down" },
        // The FIRST update is the deliberate revoke; the SECOND is the restore.
        { table: "path_fw_board_tokens", op: "update", message: "restore down", onCall: 2 },
      ],
    });

    expect(await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    // Honest wreckage: the prior token stays revoked, and no replacement exists.
    expect(tables.path_fw_board_tokens).toHaveLength(1);
    expect(tables.path_fw_board_tokens[0].revoked_at).not.toBeNull();
  });

  it("does not revoke anything when the cohort check refuses first", async () => {
    const { db, tables } = makeFakeDb({
      cohorts: [{ id: PATH_COHORT, slug: "s", kind: "path", ends_at: BOSTON_END }],
      tokens: [
        {
          id: "tok-1",
          cohort_id: PATH_COHORT,
          token_hash: "old",
          expires_at: BOSTON_TOKEN_EXPIRY,
          revoked_at: null,
        },
      ],
    });
    await mintFwBoardToken(db, { cohortId: PATH_COHORT, actorUserId: STAFF, now: NOW });
    expect(tables.path_fw_board_tokens[0].revoked_at).toBeNull();
  });
});

describe("revokeFwBoardToken", () => {
  it("kills the live token and names who did it", async () => {
    const { db, tables } = makeFakeDb({});
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    expect(
      await revokeFwBoardToken(db, { cohortId: BOSTON, actorUserId: DANA, now: NOW })
    ).toEqual({ ok: true });
    expect(tables.path_fw_board_tokens[0]).toMatchObject({ revoked_by: DANA });
    expect(tables.path_fw_board_tokens[0].revoked_at).not.toBeNull();
  });

  it("reports no_active_token rather than reporting success over nothing", async () => {
    const { db } = makeFakeDb({});
    expect(
      await revokeFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW })
    ).toEqual({ ok: false, reason: "no_active_token" });
  });

  it("is not idempotent-as-success: the second revoke says there was nothing live", async () => {
    const { db } = makeFakeDb({});
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    await revokeFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    expect(
      await revokeFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW })
    ).toEqual({ ok: false, reason: "no_active_token" });
  });

  it("only touches the named cohort", async () => {
    const { db, tables } = makeFakeDb({});
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    await mintFwBoardToken(db, { cohortId: HAMPTONS, actorUserId: STAFF, now: NOW });
    await revokeFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });

    const hamptons = tables.path_fw_board_tokens.find((t) => t.cohort_id === HAMPTONS);
    expect(hamptons!.revoked_at ?? null).toBeNull();
  });
});

describe("loadFwOpsBoardToken", () => {
  it("reports never_minted for a cohort with no token", async () => {
    const { db } = makeFakeDb({});
    expect(await loadFwOpsBoardToken(db, { cohortId: BOSTON, now: NOW })).toEqual({
      ok: true,
      token: {
        status: "never_minted",
        tokenId: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: null,
      },
    });
  });

  it("reports a READ FAILURE distinctly from never_minted", async () => {
    // "Nobody ever minted one" is the answer that invites staff to mint, and
    // minting on top of a token that is actually live kills a projector.
    const { db } = makeFakeDb({
      failTable: { table: "path_fw_board_tokens", op: "select", message: "boom" },
    });
    expect(await loadFwOpsBoardToken(db, { cohortId: BOSTON, now: NOW })).toEqual({ ok: false });
  });

  it("reports live for a fresh token", async () => {
    const { db } = makeFakeDb({});
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    const res = await loadFwOpsBoardToken(db, { cohortId: BOSTON, now: NOW });
    expect(res.ok && res.token).toMatchObject({
      status: "live",
      expiresAt: BOSTON_TOKEN_EXPIRY,
    });
  });

  it("reports REVOKED, not never_minted, after a revoke", async () => {
    // The reason this reads the latest row rather than the active one. With an
    // active-only filter, "I killed the board" and "nobody ever minted one"
    // are the same empty answer, and staff cannot confirm their own revoke.
    const { db } = makeFakeDb({});
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    await revokeFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    const status = await loadFwOpsBoardToken(db, { cohortId: BOSTON, now: NOW });
    expect(status.ok && status.token.status).toBe("revoked");
    expect(status.ok && status.token.revokedAt).not.toBeNull();
  });

  it("reports expired once the grace has run out", async () => {
    const { db } = makeFakeDb({});
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    const afterwards = Date.parse("2026-08-25T00:00:00Z");
    const res = await loadFwOpsBoardToken(db, { cohortId: BOSTON, now: afterwards });
    expect(res.ok && res.token.status).toBe("expired");
  });

  it("reports the LATEST token after a re-mint, not the revoked one", async () => {
    const { db } = makeFakeDb({});
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW + 1000 });
    const res = await loadFwOpsBoardToken(db, { cohortId: BOSTON, now: NOW });
    // Both rows carry the SAME created_at here, on purpose: an `order by
    // created_at desc limit 1` would be free to return either, so this test is
    // exactly the tie that made the ordering rule explicit and pure.
    expect(res.ok && res.token.status).toBe("live");
  });
});

/* ═════════════════════════════════════════════════════════════ the ops lists ══ */

describe("listFwOpsCohorts", () => {
  it("lists only fw cohorts, with student and guide counts and token status", async () => {
    const { db } = makeFakeDb({
      members: [
        { student_id: "s1", cohort_id: BOSTON },
        { student_id: "s2", cohort_id: BOSTON },
        { student_id: "s3", cohort_id: HAMPTONS },
        { student_id: "s4", cohort_id: PATH_COHORT },
      ],
      grants: [
        { id: "g1", user_id: RAVI, role: "guide", scope_type: "cohort", scope_id: BOSTON },
        { id: "g2", user_id: DANA, role: "guide", scope_type: "cohort", scope_id: BOSTON },
        { id: "g3", user_id: RAVI, role: "parent", scope_type: "family", scope_id: BOSTON },
      ],
    });
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });

    const res = await listFwOpsCohorts(db, { now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cohorts.map((c) => c.id).sort()).toEqual([BOSTON, HAMPTONS].sort());

    const boston = res.cohorts.find((c) => c.id === BOSTON)!;
    expect(boston.studentCount).toBe(2);
    // The `parent`/`family` grant must NOT be counted as a guide.
    expect(boston.guideCount).toBe(2);
    expect(boston.boardTokenStatus).toBe("live");

    const hamptons = res.cohorts.find((c) => c.id === HAMPTONS)!;
    expect(hamptons.studentCount).toBe(1);
    expect(hamptons.guideCount).toBe(0);
    expect(hamptons.boardTokenStatus).toBe("never_minted");
  });

  it("returns an empty list, not a failure, when there are no fw cohorts", async () => {
    const { db } = makeFakeDb({ cohorts: [{ id: PATH_COHORT, slug: "s", kind: "path" }] });
    expect(await listFwOpsCohorts(db, { now: NOW })).toEqual({ ok: true, cohorts: [] });
  });

  it("reports a read failure rather than an empty roster", async () => {
    const { db } = makeFakeDb({
      failTable: { table: "path_cohort_members", op: "select", message: "boom" },
    });
    expect(await listFwOpsCohorts(db, { now: NOW })).toEqual({ ok: false });
  });
});

describe("listFwCohortGuides", () => {
  const GRANTS = [
    { id: "g1", user_id: RAVI, role: "guide", scope_type: "cohort", scope_id: BOSTON, created_at: "1" },
    { id: "g2", user_id: DANA, role: "guide", scope_type: "cohort", scope_id: BOSTON, created_at: "2" },
  ];

  it("reads each guide's credential state through the SAME verdict the claim page uses", async () => {
    const { db } = makeFakeDb({
      grants: GRANTS,
      invites: [
        {
          user_id: RAVI,
          email: "ravi@example.com",
          expires_at: "2026-09-01T00:00:00Z",
          claimed_at: "2026-08-15T00:00:00Z",
          issued_at: "2026-08-10T00:00:00Z",
        },
        {
          user_id: DANA,
          email: "dana@example.com",
          expires_at: "2026-09-01T00:00:00Z",
          claimed_at: null,
          issued_at: "2026-08-10T00:00:00Z",
        },
      ],
    });
    const res = await listFwCohortGuides(db, { cohortId: BOSTON, now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.guides).toEqual([
      {
        userId: RAVI,
        email: "ravi@example.com",
        credential: "claimed",
        invitedAt: "2026-08-10T00:00:00Z",
        claimedAt: "2026-08-15T00:00:00Z",
      },
      {
        userId: DANA,
        email: "dana@example.com",
        credential: "invited",
        invitedAt: "2026-08-10T00:00:00Z",
        claimedAt: null,
      },
    ]);
  });

  it("flags an expired link — the Friday-morning re-issue case", async () => {
    const { db } = makeFakeDb({
      grants: [GRANTS[0]],
      invites: [
        {
          user_id: RAVI,
          email: "ravi@example.com",
          expires_at: "2026-08-01T00:00:00Z",
          claimed_at: null,
          issued_at: "2026-07-18T00:00:00Z",
        },
      ],
    });
    const res = await listFwCohortGuides(db, { cohortId: BOSTON, now: NOW });
    expect(res.ok && res.guides[0].credential).toBe("expired");
  });

  it("names a guide who has a grant but no invite row, via the Admin API fallback", async () => {
    const { db } = makeFakeDb({ grants: [GRANTS[0]], invites: [] });
    const res = await listFwCohortGuides(db, { cohortId: BOSTON, now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.guides[0]).toMatchObject({
      userId: RAVI,
      email: "ravi@example.com",
      credential: "no_invite",
    });
  });

  it("still lists an unnameable guide rather than dropping them", async () => {
    // A guide staff cannot see is a guide staff cannot revoke.
    const { db } = makeFakeDb({
      grants: [GRANTS[0]],
      invites: [],
      getUserByIdError: "auth down",
    });
    const res = await listFwCohortGuides(db, { cohortId: BOSTON, now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.guides).toHaveLength(1);
    expect(res.guides[0]).toMatchObject({ userId: RAVI, email: null });
  });

  it("lists only THIS cohort's guides", async () => {
    const { db } = makeFakeDb({
      grants: [
        ...GRANTS,
        { id: "g9", user_id: "user-other", role: "guide", scope_type: "cohort", scope_id: HAMPTONS, created_at: "3" },
      ],
      invites: [],
    });
    const res = await listFwCohortGuides(db, { cohortId: BOSTON, now: NOW });
    expect(res.ok && res.guides.map((g) => g.userId).sort()).toEqual([DANA, RAVI].sort());
  });

  it("reports a failure rather than an empty guide list", async () => {
    const { db } = makeFakeDb({
      grants: GRANTS,
      failTable: { table: "path_role_grants", op: "select", message: "boom" },
    });
    expect(await listFwCohortGuides(db, { cohortId: BOSTON, now: NOW })).toEqual({ ok: false });
  });
});

/* ══════════════════════════════════════════════════════════ grant revocation ══ */

describe("revokeFwGuideGrant", () => {
  const GRANTS = [
    { id: "g1", user_id: RAVI, role: "guide", scope_type: "cohort", scope_id: BOSTON },
    { id: "g2", user_id: RAVI, role: "guide", scope_type: "cohort", scope_id: HAMPTONS },
    { id: "g3", user_id: DANA, role: "guide", scope_type: "cohort", scope_id: BOSTON },
  ];

  it("removes exactly one guide's grant on exactly one cohort, and audits it", async () => {
    const { db, tables } = makeFakeDb({ grants: GRANTS });
    expect(
      await revokeFwGuideGrant(db, { cohortId: BOSTON, userId: RAVI, actorUserId: STAFF })
    ).toEqual({ ok: true, audited: true });

    // Ravi keeps Hamptons — a scope change, not an offboarding. Dana is
    // untouched. Both halves matter: the delete has four predicates and
    // dropping any one of them silently widens it.
    expect(tables.path_role_grants.map((g) => g.id).sort()).toEqual(["g2", "g3"]);
    expect(tables.path_fw_ops_audit).toHaveLength(1);
    expect(tables.path_fw_ops_audit[0]).toMatchObject({
      actor: STAFF,
      action: "guide_grant_revoked",
      subject_user_id: RAVI,
      cohort_id: BOSTON,
    });
  });

  it("leaves the account and its invite alone", async () => {
    const { db, tables, authUsers } = makeFakeDb({
      grants: GRANTS,
      invites: [{ user_id: RAVI, email: "ravi@example.com", expires_at: "2026-09-01T00:00:00Z", claimed_at: "2026-08-15T00:00:00Z" }],
    });
    await revokeFwGuideGrant(db, { cohortId: BOSTON, userId: RAVI, actorUserId: STAFF });
    expect(authUsers.find((u) => u.id === RAVI)).toBeDefined();
    expect(tables.path_fw_guide_invites).toHaveLength(1);
  });

  it("reports grant_not_found rather than success over nothing", async () => {
    const { db, tables } = makeFakeDb({ grants: GRANTS });
    expect(
      await revokeFwGuideGrant(db, { cohortId: BOSTON, userId: "user-nobody", actorUserId: STAFF })
    ).toEqual({ ok: false, reason: "grant_not_found" });
    // And writes NO audit row — an audit log that records revocations that
    // never happened is a log nobody can reason from.
    expect(tables.path_fw_ops_audit).toHaveLength(0);
  });

  it("a double-submit reports the second attempt honestly", async () => {
    const { db } = makeFakeDb({ grants: GRANTS });
    await revokeFwGuideGrant(db, { cohortId: BOSTON, userId: RAVI, actorUserId: STAFF });
    expect(
      await revokeFwGuideGrant(db, { cohortId: BOSTON, userId: RAVI, actorUserId: STAFF })
    ).toEqual({ ok: false, reason: "grant_not_found" });
  });

  it("still revokes — and says so — when the audit write fails", async () => {
    const { db, tables } = makeFakeDb({
      grants: GRANTS,
      failTable: { table: "path_fw_ops_audit", op: "insert", message: "audit down" },
    });
    expect(
      await revokeFwGuideGrant(db, { cohortId: BOSTON, userId: RAVI, actorUserId: STAFF })
    ).toEqual({ ok: true, audited: false });
    expect(tables.path_role_grants.map((g) => g.id).sort()).toEqual(["g2", "g3"]);
  });

  it("writes no audit row when the delete itself fails", async () => {
    const { db, tables } = makeFakeDb({
      grants: GRANTS,
      failTable: { table: "path_role_grants", op: "delete", message: "boom" },
    });
    expect(
      await revokeFwGuideGrant(db, { cohortId: BOSTON, userId: RAVI, actorUserId: STAFF })
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(tables.path_fw_ops_audit).toHaveLength(0);
    expect(tables.path_role_grants).toHaveLength(3);
  });
});

describe("recordFwOpsAudit", () => {
  it("returns false rather than throwing when the write fails", async () => {
    const { db } = makeFakeDb({
      failTable: { table: "path_fw_ops_audit", op: "insert", message: "down" },
    });
    expect(
      await recordFwOpsAudit(db, {
        actor: STAFF,
        action: "guide_grant_added",
        subjectUserId: RAVI,
        cohortId: BOSTON,
      })
    ).toBe(false);
  });
});

/* ══════════════════════════ landed-but-reported-failed (the audit invariant) ══ */

describe("revokeFwGuideGrant — a delete that LANDED but reported an error", () => {
  const GRANTS = [
    { id: "g1", user_id: RAVI, role: "guide", scope_type: "cohort", scope_id: BOSTON },
    { id: "g2", user_id: RAVI, role: "guide", scope_type: "cohort", scope_id: HAMPTONS },
  ];

  it("still writes the audit row, and reports success", async () => {
    // `fwWrite`'s own contract: a timed-out write may already have committed.
    // Returning `unavailable` here would leave the grant genuinely gone with NO
    // `guide_grant_revoked` row — and the retry then reports `grant_not_found`,
    // which is truthful about access and permanently silent about who removed
    // it. That is the exact invariant the audit table exists to hold.
    const { db, tables } = makeFakeDb({
      grants: GRANTS,
      failTables: [
        { table: "path_role_grants", op: "delete", message: "connection reset", applyAnyway: true },
      ],
    });

    const res = await revokeFwGuideGrant(db, {
      cohortId: BOSTON,
      userId: RAVI,
      actorUserId: STAFF,
    });

    expect(res).toEqual({ ok: true, audited: true });
    expect(tables.path_role_grants.map((g) => g.id)).toEqual(["g2"]);
    expect(tables.path_fw_ops_audit).toHaveLength(1);
    expect(tables.path_fw_ops_audit[0]).toMatchObject({
      action: "guide_grant_revoked",
      subject_user_id: RAVI,
      cohort_id: BOSTON,
    });
    // Marked, so the row is legible as a recovery rather than a normal write.
    expect(
      (tables.path_fw_ops_audit[0].metadata as Record<string, unknown>).recoveredFromReportedFailure
    ).toBe(true);
  });

  it("reports unavailable — and audits NOTHING — when the grant is genuinely still there", async () => {
    const { db, tables } = makeFakeDb({
      grants: GRANTS,
      failTable: { table: "path_role_grants", op: "delete", message: "boom" },
    });
    expect(
      await revokeFwGuideGrant(db, { cohortId: BOSTON, userId: RAVI, actorUserId: STAFF })
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(tables.path_fw_ops_audit).toHaveLength(0);
    expect(tables.path_role_grants).toHaveLength(2);
  });
});

/* ═══════════════════════════════════ the branches the review found untested ══ */

describe("mintFwBoardToken — the FIRST step failing", () => {
  it("aborts before minting anything when the prior-token revoke fails", async () => {
    const { db, tables } = makeFakeDb({
      tokens: [
        {
          id: "tok-1",
          cohort_id: BOSTON,
          token_hash: "old",
          expires_at: BOSTON_TOKEN_EXPIRY,
          revoked_at: null,
          created_at: "2026-08-21T10:00:00Z",
        },
      ],
      failTable: { table: "path_fw_board_tokens", op: "update", message: "revoke down" },
    });
    expect(await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    // Untouched: no new token, and the prior one is still live.
    expect(tables.path_fw_board_tokens).toHaveLength(1);
    expect(tables.path_fw_board_tokens[0].revoked_at ?? null).toBeNull();
  });
});

describe("revokeFwBoardToken — the write failing", () => {
  it("reports unavailable rather than no_active_token", async () => {
    // The two are different answers to "does the projector URL still work?".
    const { db } = makeFakeDb({
      tokens: [
        {
          id: "tok-1",
          cohort_id: BOSTON,
          token_hash: "h",
          expires_at: BOSTON_TOKEN_EXPIRY,
          revoked_at: null,
          created_at: "2026-08-21T10:00:00Z",
        },
      ],
      failTable: { table: "path_fw_board_tokens", op: "update", message: "boom" },
    });
    expect(
      await revokeFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW })
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("revokeFwBoardToken — the stale-view CAS", () => {
  it("refuses to kill a token the caller was not looking at", async () => {
    // Staff B is looking at T0. Staff A re-mints, killing T0 and making TA live.
    // B's revoke must NOT take down TA — the token A may already have typed
    // into the projector.
    const { db, tables } = makeFakeDb({});
    const first = await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    expect(first.ok).toBe(true);
    const seen = await loadFwOpsBoardToken(db, { cohortId: BOSTON, now: NOW });
    expect(seen.ok && seen.token.status).toBe("live");
    const staleTokenId = seen.ok ? seen.token.tokenId : null;
    expect(staleTokenId).not.toBeNull();

    // A re-mints.
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: DANA, now: NOW + 1000 });

    // B's revoke, carrying the token id from their stale page.
    expect(
      await revokeFwBoardToken(db, {
        cohortId: BOSTON,
        actorUserId: STAFF,
        now: NOW + 2000,
        expectedTokenId: staleTokenId!,
      })
    ).toEqual({ ok: false, reason: "stale_view" });

    // A's token survives — the whole point.
    expect(
      tables.path_fw_board_tokens.filter((t) => (t.revoked_at ?? null) === null)
    ).toHaveLength(1);
  });

  it("still revokes when the caller's view is current", async () => {
    const { db } = makeFakeDb({});
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    const seen = await loadFwOpsBoardToken(db, { cohortId: BOSTON, now: NOW });
    const tokenId = seen.ok ? seen.token.tokenId : null;
    expect(
      await revokeFwBoardToken(db, {
        cohortId: BOSTON,
        actorUserId: STAFF,
        now: NOW,
        expectedTokenId: tokenId!,
      })
    ).toEqual({ ok: true });
  });

  it("reports no_active_token — not stale_view — when nothing is live at all", async () => {
    const { db } = makeFakeDb({});
    await mintFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    const seen = await loadFwOpsBoardToken(db, { cohortId: BOSTON, now: NOW });
    const tokenId = seen.ok ? seen.token.tokenId : null;
    await revokeFwBoardToken(db, { cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    expect(
      await revokeFwBoardToken(db, {
        cohortId: BOSTON,
        actorUserId: STAFF,
        now: NOW,
        expectedTokenId: tokenId!,
      })
    ).toEqual({ ok: false, reason: "no_active_token" });
  });
});

describe("listFwCohortGuides — the Admin fallback's other half", () => {
  it("survives a clean not-found (no error, no user) without throwing", async () => {
    // The `!account.data?.user` half of the guard. Dropping it would reach
    // `.email` on null — an unhandled throw inside Promise.all, which the ops
    // page has no branch for.
    const { db } = makeFakeDb({
      grants: [
        {
          id: "g1",
          user_id: "user-ghost",
          role: "guide",
          scope_type: "cohort",
          scope_id: BOSTON,
        },
      ],
      invites: [],
      authUsers: [],
    });
    const res = await listFwCohortGuides(db, { cohortId: BOSTON, now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.guides).toEqual([
      {
        userId: "user-ghost",
        email: null,
        credential: "no_invite",
        invitedAt: null,
        claimedAt: null,
      },
    ]);
  });
});
