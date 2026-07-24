import { describe, expect, it } from "vitest";

import {
  anonymizeFwStudent,
  createFwCohort,
  hashFwBoardToken,
  linkFwStudentToCohort,
  listFwCohortGuides,
  listFwOpsCohorts,
  listFwOpsStudents,
  listFwReplayRejects,
  loadFwMatchResolution,
  loadFwOpsBoardToken,
  loadFwOpsCohort,
  mintFwBoardToken,
  recordFwOpsAudit,
  resolveFwReplayReject,
  revokeFwBoardToken,
  revokeFwGuideGrant,
} from "../fw-ops-core";
import { FW_TOMBSTONE_FIRST_NAME, FW_TOMBSTONE_LAST_NAME } from "../fw-ops-rules";
import { buildFwTombstoneEmail } from "../fw-provision-rules";

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
  /** Unit 5b tables. */
  profiles?: Row[];
  rejects?: Row[];
  releasedAliases?: Row[];
  events?: Row[];
  /** Force one table+op to error, to exercise the compensation branches. */
  failTable?: Failure | null;
  /** SEVERAL injected failures, for the sequences that must fail twice — the
   *  mint whose insert fails AND whose restore then fails is the only way to
   *  reach the "board is dark and we could not put it back" branch. */
  failTables?: Failure[];
  getUserByIdError?: string | null;
  /** Make the anonymize rename (updateUserById) error. With `applyAnyway` the
   *  email change is COMMITTED first and the error reported after — the
   *  landed-but-reported-failed rename the post-write-verify path exists for. */
  updateUserByIdError?: string | null;
  updateUserByIdApplyAnyway?: boolean;
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
    path_student_profiles: [...(seed.profiles ?? [])],
    path_fw_replay_rejects: [...(seed.rejects ?? [])],
    path_fw_released_aliases: [...(seed.releasedAliases ?? [])],
    path_task_events: [...(seed.events ?? [])],
  };
  // Deep-copy each seeded row so writes (which mutate rows in place, e.g. the
  // anonymize tombstone via Object.assign) can never leak across tests that
  // share a seed constant. Rows are flat, so a per-row spread is enough.
  for (const key of Object.keys(tables)) {
    tables[key] = tables[key].map((r) => ({ ...r }));
  }
  const authUsers: Row[] = (
    seed.authUsers ?? [
      { id: RAVI, email: "ravi@example.com", app_metadata: { role: "guide" } },
      { id: DANA, email: "dana@example.com", app_metadata: { role: "guide" } },
    ]
  ).map((r) => ({ ...r }));
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
            // path_fw_released_aliases: local_part is the PK — released once, ever.
            if (
              table === "path_fw_released_aliases" &&
              tables[table].some((x) => x.local_part === r.local_part)
            ) {
              return { data: null, error: { code: "23505", message: "local part already released" } };
            }
            // path_cohort_members: unique (student_id, cohort_id).
            if (
              table === "path_cohort_members" &&
              tables[table].some(
                (x) => x.student_id === r.student_id && x.cohort_id === r.cohort_id
              )
            ) {
              return { data: null, error: { code: "23505", message: "already a member" } };
            }
            // path_fw_ops_audit: partial UNIQUE index — one 'student_anonymized'
            // per subject (20260801160000). Guide-grant rows are unconstrained.
            if (
              table === "path_fw_ops_audit" &&
              r.action === "student_anonymized" &&
              tables[table].some(
                (x) => x.subject_user_id === r.subject_user_id && x.action === "student_anonymized"
              )
            ) {
              return {
                data: null,
                error: { code: "23505", message: "one anonymize per subject" },
              };
            }
            const row = { id: `${table}-${idSeq++}`, created_at: "2026-08-22T15:00:00Z", ...r };
            tables[table].push(row);
            written.push(row);
          }
          // applyAnyway: the writes above committed; NOW report the error — a
          // landed-but-reported-failed insert (mirrors delete()).
          const after = failingAfter("insert");
          if (after) return { data: null, error: after };
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
          // applyAnyway: the patch above committed; NOW report the error — a
          // landed-but-reported-failed update (mirrors delete()/insert()).
          const after = failingAfter("update");
          if (after) return { data: null, error: after };
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
        async updateUserById(id: string, attrs: { email?: string; email_confirm?: boolean }) {
          const hit = authUsers.find((u) => u.id === id);
          // applyAnyway: commit the change, THEN report the error — a rename that
          // landed server-side but whose response was lost.
          if (seed.updateUserByIdApplyAnyway) {
            if (hit && typeof attrs.email === "string") hit.email = attrs.email;
            return {
              data: { user: null },
              error: { message: seed.updateUserByIdError ?? "update reported error" },
            };
          }
          if (seed.updateUserByIdError) {
            return { data: { user: null }, error: { message: seed.updateUserByIdError } };
          }
          if (!hit) return { data: { user: null }, error: { message: "user not found" } };
          if (typeof attrs.email === "string") hit.email = attrs.email;
          return { data: { user: { ...hit } }, error: null };
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

/* ══════════════════════════════════════ Unit 5b — the replay-reject list ══ */

const MAYA = "stu-maya";
const MAYA_AUTH = "auth-maya";
const OMAR = "stu-omar";

const PROFILES = [
  {
    id: MAYA,
    user_id: MAYA_AUTH,
    child_id: null,
    first_name: "Maya",
    last_name: "Chen",
    band: "g6_8",
    normalized_name: "maya chen",
    program_version_id: "v1",
  },
  {
    id: OMAR,
    user_id: "auth-omar",
    child_id: null,
    first_name: "Omar",
    last_name: "Diaz",
    band: "g9_12",
    normalized_name: "omar diaz",
    program_version_id: "v1",
  },
];

describe("listFwReplayRejects", () => {
  const REJECTS = [
    {
      id: "rej-1",
      student_id: MAYA,
      task_id: "1.2.4",
      cohort_id: BOSTON,
      actor: RAVI,
      action: "undo",
      reason: "cross_actor_undo",
      client_id: "c1",
      captured_at: "2026-08-22T14:00:00Z",
      created_at: "2026-08-22T14:30:00Z",
      resolved_at: null,
      resolved_by: null,
    },
    {
      id: "rej-2",
      student_id: OMAR,
      task_id: "1.1.1",
      cohort_id: BOSTON,
      actor: RAVI,
      action: "checkmark",
      reason: "reauth_failed",
      client_id: "c2",
      captured_at: "2026-08-22T14:05:00Z",
      created_at: "2026-08-22T14:40:00Z",
      resolved_at: null,
      resolved_by: null,
    },
    {
      id: "rej-3",
      student_id: MAYA,
      task_id: "1.1.2",
      cohort_id: HAMPTONS,
      actor: RAVI,
      action: "not_yet",
      reason: "reauth_failed",
      created_at: "2026-08-22T13:00:00Z",
      resolved_at: null,
      resolved_by: null,
    },
  ];

  it("lists this cohort's OPEN rejects newest-first, joined to the student name", async () => {
    const { db } = makeFakeDb({ profiles: PROFILES, rejects: REJECTS });
    const res = await listFwReplayRejects(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Only Boston's two, newest (rej-2, 14:40) before older (rej-1, 14:30).
    expect(res.rejects.map((r) => r.id)).toEqual(["rej-2", "rej-1"]);
    expect(res.rejects[0]).toMatchObject({
      id: "rej-2",
      studentId: OMAR,
      studentName: "Omar Diaz",
      taskId: "1.1.1",
      action: "checkmark",
      reason: "reauth_failed",
    });
    expect(res.rejects[1].studentName).toBe("Maya Chen");
  });

  it("hides resolved rejects by default and includes them on request", async () => {
    const resolved = { ...REJECTS[0], id: "rej-1", resolved_at: "2026-08-22T15:00:00Z", resolved_by: STAFF };
    const { db } = makeFakeDb({
      profiles: PROFILES,
      rejects: [resolved, REJECTS[1]],
    });
    const open = await listFwReplayRejects(db, { cohortId: BOSTON });
    expect(open.ok && open.rejects.map((r) => r.id)).toEqual(["rej-2"]);

    const all = await listFwReplayRejects(db, { cohortId: BOSTON, includeResolved: true });
    expect(all.ok && all.rejects.map((r) => r.id).sort()).toEqual(["rej-1", "rej-2"]);
  });

  it("still lists a reject whose student profile is unreadable, with a null name", async () => {
    // A reject nobody can name is still a reject staff must close.
    const { db } = makeFakeDb({ profiles: [], rejects: [REJECTS[0]] });
    const res = await listFwReplayRejects(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rejects).toHaveLength(1);
    expect(res.rejects[0]).toMatchObject({ id: "rej-1", studentName: null });
  });

  it("reports a read failure rather than an empty list", async () => {
    const { db } = makeFakeDb({
      failTable: { table: "path_fw_replay_rejects", op: "select", message: "boom" },
    });
    expect(await listFwReplayRejects(db, { cohortId: BOSTON })).toEqual({ ok: false });
  });
});

describe("resolveFwReplayReject", () => {
  const OPEN = {
    id: "rej-1",
    student_id: MAYA,
    task_id: "1.2.4",
    cohort_id: BOSTON,
    actor: RAVI,
    action: "undo",
    reason: "cross_actor_undo",
    created_at: "2026-08-22T14:30:00Z",
    resolved_at: null,
    resolved_by: null,
  };

  it("closes an open reject — who and when — and it leaves the open list", async () => {
    const { db, tables } = makeFakeDb({ rejects: [OPEN] });
    expect(
      await resolveFwReplayReject(db, { rejectId: "rej-1", cohortId: BOSTON, actorUserId: STAFF, now: NOW })
    ).toEqual({ ok: true });
    const row = tables.path_fw_replay_rejects[0];
    expect(row.resolved_by).toBe(STAFF);
    expect(row.resolved_at).not.toBeNull();

    const open = await listFwReplayRejects(db, { cohortId: BOSTON });
    expect(open.ok && open.rejects).toEqual([]);
    const history = await listFwReplayRejects(db, { cohortId: BOSTON, includeResolved: true });
    expect(history.ok && history.rejects.map((r) => r.id)).toEqual(["rej-1"]);
  });

  it("refuses to close a reject from ANOTHER cohort via a forged id", async () => {
    // The cohort predicate is the guard: a reject id staff were never shown, in
    // a weekend they are not on, cannot be closed from this surface.
    const hamptonsReject = { ...OPEN, id: "rej-1", cohort_id: HAMPTONS };
    const { db, tables } = makeFakeDb({ rejects: [hamptonsReject] });
    expect(
      await resolveFwReplayReject(db, { rejectId: "rej-1", cohortId: BOSTON, actorUserId: STAFF, now: NOW })
    ).toEqual({ ok: false, reason: "not_open" });
    expect(tables.path_fw_replay_rejects[0].resolved_at ?? null).toBeNull();
  });

  it("reports a double-submit honestly as not_open", async () => {
    const { db } = makeFakeDb({ rejects: [OPEN] });
    await resolveFwReplayReject(db, { rejectId: "rej-1", cohortId: BOSTON, actorUserId: STAFF, now: NOW });
    expect(
      await resolveFwReplayReject(db, { rejectId: "rej-1", cohortId: BOSTON, actorUserId: STAFF, now: NOW })
    ).toEqual({ ok: false, reason: "not_open" });
  });

  it("reports unavailable on a write failure", async () => {
    const { db } = makeFakeDb({
      rejects: [OPEN],
      failTable: { table: "path_fw_replay_rejects", op: "update", message: "boom" },
    });
    expect(
      await resolveFwReplayReject(db, { rejectId: "rej-1", cohortId: BOSTON, actorUserId: STAFF, now: NOW })
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});

/* ══════════════════════════════════════════════ Unit 5b — the ops roster ══ */

describe("listFwOpsStudents", () => {
  it("lists members with band, the anonymized marker, and the open-reject count, sorted by name", async () => {
    const { db } = makeFakeDb({
      profiles: [
        ...PROFILES,
        {
          id: "stu-gone",
          user_id: "auth-gone",
          child_id: null,
          first_name: FW_TOMBSTONE_FIRST_NAME,
          last_name: FW_TOMBSTONE_LAST_NAME,
          band: "g3_5",
          normalized_name: null,
        },
      ],
      members: [
        { student_id: MAYA, cohort_id: BOSTON },
        { student_id: OMAR, cohort_id: BOSTON },
        { student_id: "stu-gone", cohort_id: BOSTON },
      ],
      rejects: [
        { id: "r1", student_id: MAYA, cohort_id: BOSTON, actor: RAVI, action: "undo", reason: "x", resolved_at: null },
        { id: "r2", student_id: MAYA, cohort_id: BOSTON, actor: RAVI, action: "undo", reason: "x", resolved_at: null },
        { id: "r3", student_id: OMAR, cohort_id: BOSTON, actor: RAVI, action: "undo", reason: "x", resolved_at: "2026-08-22T15:00:00Z" },
      ],
      // stu-gone is tombstoned AND has its audit row → a COMPLETE removal.
      audit: [
        { id: "a1", actor: STAFF, action: "student_anonymized", subject_user_id: "auth-gone", cohort_id: BOSTON, created_at: "1" },
      ],
    });
    const res = await listFwOpsStudents(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The sort itself is asserted (last name: Chen, Diaz, student), not just the
    // individual lookups — a dropped/reversed sort would otherwise ship green.
    expect(res.students.map((s) => s.studentId)).toEqual([MAYA, OMAR, "stu-gone"]);
    const maya = res.students.find((s) => s.studentId === MAYA)!;
    expect(maya).toMatchObject({ firstName: "Maya", band: "g6_8", anonymized: false, openRejects: 2 });
    const omar = res.students.find((s) => s.studentId === OMAR)!;
    expect(omar.openRejects).toBe(0); // its only reject is resolved
    const gone = res.students.find((s) => s.studentId === "stu-gone")!;
    expect(gone).toMatchObject({ anonymized: true, anonymizeComplete: true });
  });

  it("marks a tombstoned student with NO audit row as anonymizeComplete: false (resumable)", async () => {
    // The partial-failure state: name tombstoned, but the rename or audit never
    // finished — the surface must offer to resume, not render it as done.
    const { db } = makeFakeDb({
      profiles: [
        {
          id: "stu-partial",
          user_id: "auth-partial",
          child_id: null,
          first_name: FW_TOMBSTONE_FIRST_NAME,
          last_name: FW_TOMBSTONE_LAST_NAME,
          band: "g6_8",
          normalized_name: null,
        },
      ],
      members: [{ student_id: "stu-partial", cohort_id: BOSTON }],
      audit: [], // no student_anonymized row → incomplete
    });
    const res = await listFwOpsStudents(db, { cohortId: BOSTON });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.students[0]).toMatchObject({ anonymized: true, anonymizeComplete: false });
  });

  it("fails the whole roster if the anonymize-audit read fails — never mislabels a partial removal as done", async () => {
    const { db } = makeFakeDb({
      profiles: [
        {
          id: "stu-gone",
          user_id: "auth-gone",
          child_id: null,
          first_name: FW_TOMBSTONE_FIRST_NAME,
          last_name: FW_TOMBSTONE_LAST_NAME,
          band: "g3_5",
          normalized_name: null,
        },
      ],
      members: [{ student_id: "stu-gone", cohort_id: BOSTON }],
      failTable: { table: "path_fw_ops_audit", op: "select", message: "boom" },
    });
    expect(await listFwOpsStudents(db, { cohortId: BOSTON })).toEqual({ ok: false });
  });

  it("returns an empty list for a cohort with no members", async () => {
    const { db } = makeFakeDb({ members: [] });
    expect(await listFwOpsStudents(db, { cohortId: BOSTON })).toEqual({ ok: true, students: [] });
  });

  it("reports a read failure rather than an empty roster", async () => {
    const { db } = makeFakeDb({
      members: [{ student_id: MAYA, cohort_id: BOSTON }],
      failTable: { table: "path_student_profiles", op: "select", message: "boom" },
    });
    expect(await listFwOpsStudents(db, { cohortId: BOSTON })).toEqual({ ok: false });
  });
});

/* ══════════════════════════════════════ Unit 5b — anonymize-in-place ══ */

function anonymizeSeed(overrides: Partial<Seed> = {}): Seed {
  return {
    profiles: [PROFILES[0]],
    members: [{ student_id: MAYA, cohort_id: BOSTON }],
    authUsers: [
      { id: MAYA_AUTH, email: "maya.chen.fw@the120.school", app_metadata: { role: "student" } },
    ],
    ...overrides,
  };
}

describe("anonymizeFwStudent — the happy path", () => {
  it("tombstones the name, nulls normalized_name, records the alias, renames the email, and audits", async () => {
    const { db, tables, authUsers } = makeFakeDb(anonymizeSeed());
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "Maya Chen",
    });
    expect(res).toEqual({ ok: true, alreadyAnonymized: false, audited: true, openRejects: 0 });

    const profile = tables.path_student_profiles[0];
    expect(profile).toMatchObject({
      first_name: FW_TOMBSTONE_FIRST_NAME,
      last_name: FW_TOMBSTONE_LAST_NAME,
      normalized_name: null,
    });
    // Band retained — not PII.
    expect(profile.band).toBe("g6_8");

    // The freed local part is in the ledger, keyed to the student.
    expect(tables.path_fw_released_aliases).toHaveLength(1);
    expect(tables.path_fw_released_aliases[0]).toMatchObject({
      local_part: "maya.chen",
      released_profile_id: MAYA,
    });

    // The auth email is now the tombstone, inside the .fw@ namespace.
    expect(authUsers.find((u) => u.id === MAYA_AUTH)!.email).toBe(buildFwTombstoneEmail(MAYA));

    // The liability record.
    expect(tables.path_fw_ops_audit).toHaveLength(1);
    expect(tables.path_fw_ops_audit[0]).toMatchObject({
      actor: STAFF,
      action: "student_anonymized",
      subject_user_id: MAYA_AUTH,
      cohort_id: BOSTON,
    });
  });

  it("records the EXACT suffixed local part, not the bare name", async () => {
    // A second Maya Chen holds maya.chen2; anonymizing HER must free maya.chen2,
    // or the ledger would fail to protect the address someone still holds.
    const { db, tables } = makeFakeDb(
      anonymizeSeed({
        authUsers: [
          { id: MAYA_AUTH, email: "maya.chen2.fw@the120.school", app_metadata: { role: "student" } },
        ],
      })
    );
    await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "Maya Chen",
    });
    expect(tables.path_fw_released_aliases[0].local_part).toBe("maya.chen2");
  });

  it("RETAINS the student's events — task ids are not PII, the name is nowhere in them", async () => {
    // Decision 10: events are kept on anonymize (a partial action-id group after
    // one teammate's deletion is tolerated by the board). The core must never
    // touch the event log — proven by leaving a seeded event untouched.
    const { db, tables } = makeFakeDb(
      anonymizeSeed({
        events: [
          { id: "ev-1", student_id: MAYA, task_id: "1.2.4", transition: "checkmark", action_id: "act-1" },
        ],
      })
    );
    await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "Maya Chen",
    });
    expect(tables.path_task_events).toEqual([
      { id: "ev-1", student_id: MAYA, task_id: "1.2.4", transition: "checkmark", action_id: "act-1" },
    ]);
  });

  it("surfaces the open-reject count as a warning, without blocking", async () => {
    const { db } = makeFakeDb(
      anonymizeSeed({
        rejects: [
          { id: "r1", student_id: MAYA, cohort_id: BOSTON, actor: RAVI, action: "undo", reason: "x", resolved_at: null },
          { id: "r2", student_id: MAYA, cohort_id: HAMPTONS, actor: RAVI, action: "undo", reason: "x", resolved_at: null },
        ],
      })
    );
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "Maya Chen",
    });
    // Both open rejects, across cohorts — the anonymize still succeeds.
    expect(res).toMatchObject({ ok: true, openRejects: 2 });
  });
});

describe("anonymizeFwStudent — the refusals", () => {
  it("refuses a typed confirm that does not match the child, and mutates nothing", async () => {
    const { db, tables, authUsers } = makeFakeDb(anonymizeSeed());
    expect(
      await anonymizeFwStudent(db, {
        studentId: MAYA,
        cohortId: BOSTON,
        actorUserId: STAFF,
        confirmName: "Wrong Name",
      })
    ).toEqual({ ok: false, reason: "confirm_mismatch" });
    expect(tables.path_student_profiles[0].first_name).toBe("Maya");
    expect(tables.path_fw_released_aliases).toHaveLength(0);
    expect(authUsers.find((u) => u.id === MAYA_AUTH)!.email).toBe("maya.chen.fw@the120.school");
    expect(tables.path_fw_ops_audit).toHaveLength(0);
  });

  it("refuses a student who is not a member of this cohort", async () => {
    const { db } = makeFakeDb(anonymizeSeed({ members: [] }));
    expect(
      await anonymizeFwStudent(db, { studentId: MAYA, cohortId: BOSTON, actorUserId: STAFF, confirmName: "Maya Chen" })
    ).toEqual({ ok: false, reason: "not_in_cohort" });
  });

  it("refuses a missing student", async () => {
    const { db } = makeFakeDb(anonymizeSeed({ profiles: [] }));
    expect(
      await anonymizeFwStudent(db, { studentId: MAYA, cohortId: BOSTON, actorUserId: STAFF, confirmName: "Maya Chen" })
    ).toEqual({ ok: false, reason: "student_not_found" });
  });

  it("refuses a Path student (child_id set) — never corrupt a real family's login", async () => {
    const { db } = makeFakeDb(
      anonymizeSeed({
        profiles: [{ ...PROFILES[0], child_id: "child-1", first_name: null, last_name: null, band: null }],
      })
    );
    expect(
      await anonymizeFwStudent(db, { studentId: MAYA, cohortId: BOSTON, actorUserId: STAFF, confirmName: "Maya Chen" })
    ).toEqual({ ok: false, reason: "not_fw_profile" });
  });

  it("refuses when the auth account is gone", async () => {
    const { db } = makeFakeDb(anonymizeSeed({ authUsers: [] }));
    expect(
      await anonymizeFwStudent(db, { studentId: MAYA, cohortId: BOSTON, actorUserId: STAFF, confirmName: "Maya Chen" })
    ).toEqual({ ok: false, reason: "account_missing" });
  });
});

describe("anonymizeFwStudent — idempotence and self-healing audit", () => {
  it("is a no-op when the account is already at its tombstone, and ensures the audit exists", async () => {
    const { db, tables } = makeFakeDb(
      anonymizeSeed({
        authUsers: [
          { id: MAYA_AUTH, email: buildFwTombstoneEmail(MAYA), app_metadata: { role: "student" } },
        ],
        // The names may already be tombstoned; the confirm is not reached.
        profiles: [{ ...PROFILES[0], first_name: FW_TOMBSTONE_FIRST_NAME, last_name: FW_TOMBSTONE_LAST_NAME, normalized_name: null }],
      })
    );
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "anything",
    });
    expect(res).toMatchObject({ ok: true, alreadyAnonymized: true, audited: true });
    // The self-healing write: the prior run's audit was missing, so this fills it.
    expect(tables.path_fw_ops_audit).toHaveLength(1);
    expect(tables.path_fw_ops_audit[0]).toMatchObject({ action: "student_anonymized", subject_user_id: MAYA_AUTH });
  });

  it("does NOT write a second audit row when one already exists", async () => {
    const { db, tables } = makeFakeDb(
      anonymizeSeed({
        // email tombstone ⟹ name tombstone (the sequence tombstones the name
        // before renaming, so a real name here is an unreachable state).
        profiles: [{ ...PROFILES[0], first_name: FW_TOMBSTONE_FIRST_NAME, last_name: FW_TOMBSTONE_LAST_NAME, normalized_name: null }],
        authUsers: [
          { id: MAYA_AUTH, email: buildFwTombstoneEmail(MAYA), app_metadata: { role: "student" } },
        ],
        audit: [
          { id: "a1", actor: STAFF, action: "student_anonymized", subject_user_id: MAYA_AUTH, cohort_id: BOSTON, created_at: "1" },
        ],
      })
    );
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "anything",
    });
    expect(res).toMatchObject({ ok: true, alreadyAnonymized: true, audited: true });
    expect(tables.path_fw_ops_audit).toHaveLength(1);
  });
});

describe("anonymizeFwStudent — partial-failure compensation", () => {
  it("does NOT rename before the released alias is recorded", async () => {
    // The freed local part must reach the ledger BEFORE the address is freed, or
    // the original (possibly suffixed) local part is unrecoverable.
    const { db, tables, authUsers } = makeFakeDb(
      anonymizeSeed({
        failTable: { table: "path_fw_released_aliases", op: "insert", message: "ledger down" },
      })
    );
    expect(
      await anonymizeFwStudent(db, { studentId: MAYA, cohortId: BOSTON, actorUserId: STAFF, confirmName: "Maya Chen" })
    ).toEqual({ ok: false, reason: "unavailable" });
    // Nothing freed: email unchanged, names unchanged, no audit.
    expect(authUsers.find((u) => u.id === MAYA_AUTH)!.email).toBe("maya.chen.fw@the120.school");
    expect(tables.path_student_profiles[0].first_name).toBe("Maya");
    expect(tables.path_fw_ops_audit).toHaveLength(0);
  });

  it("treats an already-released alias as success (idempotent)", async () => {
    const { db, tables } = makeFakeDb(
      anonymizeSeed({
        releasedAliases: [{ local_part: "maya.chen", released_profile_id: MAYA, released_at: "1" }],
      })
    );
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "Maya Chen",
    });
    expect(res).toMatchObject({ ok: true, alreadyAnonymized: false, audited: true });
    // Still exactly one ledger row (the pre-existing one).
    expect(tables.path_fw_released_aliases).toHaveLength(1);
  });

  it("leaves a resumable state when the rename genuinely fails", async () => {
    const { db, tables, authUsers } = makeFakeDb(
      anonymizeSeed({ updateUserByIdError: "auth down" })
    );
    expect(
      await anonymizeFwStudent(db, { studentId: MAYA, cohortId: BOSTON, actorUserId: STAFF, confirmName: "Maya Chen" })
    ).toEqual({ ok: false, reason: "unavailable" });
    // Alias recorded and names tombstoned — a resume re-renames; email still original.
    expect(tables.path_fw_released_aliases).toHaveLength(1);
    expect(tables.path_student_profiles[0].first_name).toBe(FW_TOMBSTONE_FIRST_NAME);
    expect(authUsers.find((u) => u.id === MAYA_AUTH)!.email).toBe("maya.chen.fw@the120.school");
    expect(tables.path_fw_ops_audit).toHaveLength(0);
  });

  it("a resume after a failed rename completes without re-asking for the confirm", async () => {
    // Names already tombstoned by the prior partial run; the confirm can no
    // longer match the (gone) name, so the resume path must skip it.
    const { db, tables, authUsers } = makeFakeDb(
      anonymizeSeed({
        profiles: [{ ...PROFILES[0], first_name: FW_TOMBSTONE_FIRST_NAME, last_name: FW_TOMBSTONE_LAST_NAME, normalized_name: null }],
        releasedAliases: [{ local_part: "maya.chen", released_profile_id: MAYA, released_at: "1" }],
      })
    );
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      // A garbage confirm — the resume must not require it.
      confirmName: "zzz",
    });
    expect(res).toMatchObject({ ok: true, alreadyAnonymized: false, audited: true });
    expect(authUsers.find((u) => u.id === MAYA_AUTH)!.email).toBe(buildFwTombstoneEmail(MAYA));
    expect(tables.path_fw_ops_audit).toHaveLength(1);
  });

  it("audits a rename that LANDED but reported an error (post-write verify)", async () => {
    const { db, tables, authUsers } = makeFakeDb(
      anonymizeSeed({ updateUserByIdApplyAnyway: true, updateUserByIdError: "connection reset" })
    );
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "Maya Chen",
    });
    expect(res).toMatchObject({ ok: true, alreadyAnonymized: false, audited: true });
    // The rename committed despite the reported error, and the audit followed it.
    expect(authUsers.find((u) => u.id === MAYA_AUTH)!.email).toBe(buildFwTombstoneEmail(MAYA));
    expect(tables.path_fw_ops_audit).toHaveLength(1);
    expect(
      (tables.path_fw_ops_audit[0].metadata as Record<string, unknown>).recoveredFromReportedFailure
    ).toBe(true);
  });

  it("still reports success when only the audit write fails — audited: false", async () => {
    const { db, authUsers } = makeFakeDb(
      anonymizeSeed({ failTable: { table: "path_fw_ops_audit", op: "insert", message: "audit down" } })
    );
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "Maya Chen",
    });
    expect(res).toMatchObject({ ok: true, audited: false });
    // The anonymization still happened — the audit failing does not undo it.
    expect(authUsers.find((u) => u.id === MAYA_AUTH)!.email).toBe(buildFwTombstoneEmail(MAYA));
  });
});

/* ══════════════════════════════════ Unit 5b — PROPOSED-1 match resolution ══ */

describe("loadFwMatchResolution", () => {
  it("returns the full detail the guide's minimal signal withheld", async () => {
    const { db } = makeFakeDb({
      profiles: PROFILES,
      cohorts: [
        { id: BOSTON, slug: "boston-2026-08", kind: "fw" },
        { id: HAMPTONS, slug: "hamptons-2026-08", kind: "fw" },
      ],
      members: [
        { student_id: MAYA, cohort_id: HAMPTONS },
        { student_id: OMAR, cohort_id: BOSTON },
      ],
    });
    // A Boston staffer resolving "Maya Chen" — she is a Hamptons member.
    const res = await loadFwMatchResolution(db, { cohortId: BOSTON, firstName: "Maya", lastName: "Chen" });
    expect(res.ok && res.kind).toBe("matches");
    if (!res.ok || res.kind !== "matches") return;
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({
      profileId: MAYA,
      firstName: "Maya",
      band: "g6_8",
      inActiveCohort: false,
    });
    expect(res.entries[0].memberships).toEqual([{ cohortId: HAMPTONS, slug: "hamptons-2026-08" }]);
  });

  it("flags a candidate already in the active cohort", async () => {
    const { db } = makeFakeDb({
      profiles: PROFILES,
      cohorts: [{ id: BOSTON, slug: "boston-2026-08", kind: "fw" }],
      members: [{ student_id: OMAR, cohort_id: BOSTON }],
    });
    const res = await loadFwMatchResolution(db, { cohortId: BOSTON, firstName: "Omar", lastName: "Diaz" });
    expect(res.ok && res.kind === "matches" && res.entries[0].inActiveCohort).toBe(true);
  });

  it("returns invalid_name for a name that cannot be keyed", async () => {
    const { db } = makeFakeDb({});
    expect(await loadFwMatchResolution(db, { cohortId: BOSTON, firstName: "Maya", lastName: "" })).toEqual({
      ok: true,
      kind: "invalid_name",
    });
  });

  it("returns no entries for a name nobody has — 'new student' is the path", async () => {
    const { db } = makeFakeDb({ profiles: PROFILES });
    const res = await loadFwMatchResolution(db, { cohortId: BOSTON, firstName: "Nobody", lastName: "Here" });
    expect(res).toEqual({ ok: true, kind: "matches", entries: [] });
  });

  it("never surfaces an anonymized student — their normalized_name is null", async () => {
    const { db } = makeFakeDb({
      profiles: [{ ...PROFILES[0], first_name: FW_TOMBSTONE_FIRST_NAME, last_name: FW_TOMBSTONE_LAST_NAME, normalized_name: null }],
    });
    const res = await loadFwMatchResolution(db, { cohortId: BOSTON, firstName: "Maya", lastName: "Chen" });
    expect(res).toEqual({ ok: true, kind: "matches", entries: [] });
  });

  it("fails the whole lookup on a malformed candidate, never dropping one", async () => {
    const { db } = makeFakeDb({
      profiles: [{ id: MAYA, normalized_name: "maya chen", band: null }],
    });
    expect(await loadFwMatchResolution(db, { cohortId: BOSTON, firstName: "Maya", lastName: "Chen" })).toEqual({
      ok: false,
    });
  });
});

describe("linkFwStudentToCohort", () => {
  it("adds a membership and nothing else", async () => {
    const { db, tables } = makeFakeDb({
      profiles: PROFILES,
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw" }],
      members: [],
    });
    expect(await linkFwStudentToCohort(db, { studentId: MAYA, cohortId: BOSTON })).toEqual({
      ok: true,
      alreadyMember: false,
    });
    expect(tables.path_cohort_members).toHaveLength(1);
    expect(tables.path_cohort_members[0]).toMatchObject({ student_id: MAYA, cohort_id: BOSTON });
    // No audit — linking is not a liability action.
    expect(tables.path_fw_ops_audit).toHaveLength(0);
  });

  it("reports alreadyMember without a duplicate row", async () => {
    const { db, tables } = makeFakeDb({
      profiles: PROFILES,
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw" }],
      members: [{ student_id: MAYA, cohort_id: BOSTON }],
    });
    expect(await linkFwStudentToCohort(db, { studentId: MAYA, cohortId: BOSTON })).toEqual({
      ok: true,
      alreadyMember: true,
    });
    expect(tables.path_cohort_members).toHaveLength(1);
  });

  it("refuses a Path cohort", async () => {
    const { db } = makeFakeDb({
      profiles: PROFILES,
      cohorts: [{ id: PATH_COHORT, slug: "s", kind: "path" }],
    });
    expect(await linkFwStudentToCohort(db, { studentId: MAYA, cohortId: PATH_COHORT })).toEqual({
      ok: false,
      reason: "cohort_not_fw",
    });
  });

  it("refuses a Path student", async () => {
    const { db } = makeFakeDb({
      profiles: [{ id: MAYA, child_id: "child-1", band: null }],
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw" }],
    });
    expect(await linkFwStudentToCohort(db, { studentId: MAYA, cohortId: BOSTON })).toEqual({
      ok: false,
      reason: "not_fw_profile",
    });
  });

  it("refuses a missing student", async () => {
    const { db } = makeFakeDb({
      profiles: [],
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw" }],
    });
    expect(await linkFwStudentToCohort(db, { studentId: "nope", cohortId: BOSTON })).toEqual({
      ok: false,
      reason: "student_not_found",
    });
  });

  it("REFUSES an anonymized student — never resurrect a retired identity onto a roster", async () => {
    // Adversarial P1: loadFwMatchResolution hides anonymized students, but a
    // stale match entry (looked up before a concurrent anonymize) could still be
    // clicked. A tombstoned profile keeps its band/child_id, so the FW-shape gate
    // passes — this guard is what stops a "Removed student" becoming a live,
    // checkin-able membership row.
    const { db, tables } = makeFakeDb({
      profiles: [
        {
          id: MAYA,
          user_id: MAYA_AUTH,
          child_id: null,
          first_name: FW_TOMBSTONE_FIRST_NAME,
          last_name: FW_TOMBSTONE_LAST_NAME,
          band: "g6_8",
          normalized_name: null,
        },
      ],
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw" }],
      members: [],
    });
    expect(await linkFwStudentToCohort(db, { studentId: MAYA, cohortId: BOSTON })).toEqual({
      ok: false,
      reason: "student_anonymized",
    });
    expect(tables.path_cohort_members).toHaveLength(0);
  });

  it("recovers a membership insert that LANDED but reported an error", async () => {
    const { db, tables } = makeFakeDb({
      profiles: PROFILES,
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw" }],
      members: [],
      failTables: [{ table: "path_cohort_members", op: "insert", message: "reset", applyAnyway: true }],
    });
    // The insert commits then errors; the post-write-verify finds the row present.
    expect(await linkFwStudentToCohort(db, { studentId: MAYA, cohortId: BOSTON })).toEqual({
      ok: true,
      alreadyMember: false,
    });
    expect(tables.path_cohort_members).toHaveLength(1);
  });

  it("reports unavailable when the membership insert genuinely fails", async () => {
    const { db, tables } = makeFakeDb({
      profiles: PROFILES,
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw" }],
      members: [],
      failTable: { table: "path_cohort_members", op: "insert", message: "down" },
    });
    expect(await linkFwStudentToCohort(db, { studentId: MAYA, cohortId: BOSTON })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(tables.path_cohort_members).toHaveLength(0);
  });
});

/* ══════════════════════ Unit 5b — review-driven partial-failure coverage ══ */

describe("anonymizeFwStudent — the remaining failure branches", () => {
  it("leaves alias recorded and email unchanged when the NAME TOMBSTONE update fails", async () => {
    // Step 6's own error path — every other write in the sequence had a failure
    // test; this one did not. Alias landed (step 5), name unchanged, email
    // unchanged, no audit.
    const { db, tables, authUsers } = makeFakeDb(
      anonymizeSeed({ failTable: { table: "path_student_profiles", op: "update", message: "tombstone down" } })
    );
    expect(
      await anonymizeFwStudent(db, { studentId: MAYA, cohortId: BOSTON, actorUserId: STAFF, confirmName: "Maya Chen" })
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(tables.path_fw_released_aliases).toHaveLength(1); // step 5 landed
    expect(tables.path_student_profiles[0].first_name).toBe("Maya"); // step 6 did not
    expect(authUsers.find((u) => u.id === MAYA_AUTH)!.email).toBe("maya.chen.fw@the120.school");
    expect(tables.path_fw_ops_audit).toHaveLength(0);
  });

  it("CONTINUES when the alias insert reports an error but actually landed (post-write verify)", async () => {
    // The insert-side landed-but-reported-failed path — untestable until the
    // harness honored applyAnyway on insert(). The sequence must NOT return
    // unavailable: the post-write verify finds the alias row and carries on.
    const { db, tables, authUsers } = makeFakeDb(
      anonymizeSeed({
        failTables: [{ table: "path_fw_released_aliases", op: "insert", message: "reset", applyAnyway: true }],
      })
    );
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "Maya Chen",
    });
    expect(res).toMatchObject({ ok: true, alreadyAnonymized: false, audited: true });
    expect(tables.path_fw_released_aliases).toHaveLength(1);
    expect(authUsers.find((u) => u.id === MAYA_AUTH)!.email).toBe(buildFwTombstoneEmail(MAYA));
  });

  it("reports unavailable — NOT account_missing — when the account read errors transiently", async () => {
    // Reliability: a timed-out getUserById must read as 'try again', not 'their
    // record is gone — tell an engineer'. Distinct from the genuinely-missing
    // case (authUsers: []), which stays account_missing.
    const { db } = makeFakeDb(anonymizeSeed({ getUserByIdError: "auth down" }));
    expect(
      await anonymizeFwStudent(db, { studentId: MAYA, cohortId: BOSTON, actorUserId: STAFF, confirmName: "Maya Chen" })
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("writes exactly ONE audit row when one already exists for the subject (concurrency-safe)", async () => {
    // The idempotent audit: a prior anonymize already recorded the subject, and a
    // fresh run (email still real) must NOT write a second immutable liability row
    // — the probe finds the existing one. Backstopped by the partial unique index
    // the harness models.
    const { db, tables } = makeFakeDb(
      anonymizeSeed({
        audit: [
          { id: "a1", actor: STAFF, action: "student_anonymized", subject_user_id: MAYA_AUTH, cohort_id: BOSTON, created_at: "1" },
        ],
      })
    );
    const res = await anonymizeFwStudent(db, {
      studentId: MAYA,
      cohortId: BOSTON,
      actorUserId: STAFF,
      confirmName: "Maya Chen",
    });
    expect(res).toMatchObject({ ok: true, audited: true });
    expect(tables.path_fw_ops_audit).toHaveLength(1);
  });
});

describe("loadFwMatchResolution — the read-failure paths", () => {
  it("fails the lookup on a malformed membership row, never silently omitting it", async () => {
    const { db } = makeFakeDb({
      profiles: PROFILES,
      cohorts: [{ id: BOSTON, slug: "b", kind: "fw" }],
      // student_id matches the candidate (so the .in() filter keeps it) but
      // cohort_id is malformed — the narrow guard must fail the whole read.
      members: [{ student_id: MAYA, cohort_id: 12345 }],
    });
    expect(await loadFwMatchResolution(db, { cohortId: BOSTON, firstName: "Maya", lastName: "Chen" })).toEqual({
      ok: false,
    });
  });

  it("reports a read failure when the membership read fails", async () => {
    const { db } = makeFakeDb({
      profiles: PROFILES,
      failTable: { table: "path_cohort_members", op: "select", message: "boom" },
    });
    expect(await loadFwMatchResolution(db, { cohortId: BOSTON, firstName: "Maya", lastName: "Chen" })).toEqual({
      ok: false,
    });
  });

  it("reports a read failure when the cohort-slug read fails", async () => {
    const { db } = makeFakeDb({
      profiles: PROFILES,
      members: [{ student_id: MAYA, cohort_id: HAMPTONS }],
      failTable: { table: "path_cohorts", op: "select", message: "boom" },
    });
    expect(await loadFwMatchResolution(db, { cohortId: BOSTON, firstName: "Maya", lastName: "Chen" })).toEqual({
      ok: false,
    });
  });
});
