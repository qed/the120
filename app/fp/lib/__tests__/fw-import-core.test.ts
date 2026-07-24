import { describe, expect, it } from "vitest";

import "@/app/fp/content/registry";
import { getProgram } from "@/app/fp/content/manifest";
import { buildProgramRows } from "@/app/fp/content/seed-rows";
import {
  listFwImportExceptions,
  resolveFwImportException,
  runFwImportChunk,
  type FwImportOutcome,
} from "../fw-import-core";
import type { FwImportParsedRow } from "../fw-import-rules";
import { buildNormalizedFwName } from "../fw-provision-rules";

/** PostgREST's server-side row cap, enforced by the fake on unranged reads. */
const SERVER_MAX_ROWS = 1000;

/**
 * The importer's composition, driven end-to-end through a fake Supabase client
 * (the provision-core.test.ts harness, extended for the operations the importer's
 * whole stack uses — `.in`/`.range`/`.order`/`.update`, thenable inserts, and the
 * import-exceptions table with its one-pending-per-name unique index).
 *
 * The reason this file exists is the house rule every prior FW unit paid a P1 to
 * learn: the halves — match, provision, membership, leg verify, exception park —
 * are each tested apart, and the BUGS live in the fold. So these tests run the
 * REAL `runFwImportChunk` against a stateful fake where `provisionFwStudent`'s
 * writes are visible to the next row's `loadFwMatchCandidates` — which is the only
 * way idempotence, resume, and mid-chunk dedupe can be asserted rather than
 * asserted-about-a-mock. The task catalog is the REAL pinned content, so "125
 * locked rows" is a Boston student's real count.
 */

type Row = Record<string, unknown>;

const TASK_ROWS = buildProgramRows(getProgram("2026-27"), { isCurrent: true }).tasks;
const BOSTON = "cohort-boston";
const HAMPTONS = "cohort-hamptons";
const VERSION = "2026-27";
const GUIDE = "staff-1";

type Seed = {
  cohorts?: Row[];
  profiles?: Row[];
  members?: Row[];
  progress?: Row[];
  authUsers?: Row[];
  exceptions?: Row[];
  /**
   * A write to this table fails. `applyAnyway` models the "reported failed but
   * actually LANDED" ambiguity `fwWrite` warns about — the row IS written, then
   * the error is returned — which is exactly what the post-write-verify branches
   * exist to recover (learnings + testing reviews).
   */
  failTable?: { table: string; op: "insert" | "upsert"; message: string; applyAnyway?: boolean } | null;
  /** Tables whose READ returns `{data:null,error}` — a read outage. */
  errors?: Record<string, string>;
  /** Tables whose read THROWS rather than returning `{data,error}` — a network
   *  abort. The chunk's per-row catch must turn this into one `failed` outcome. */
  throws?: string[];
  /** `createUser` THROWS (a GoTrue network abort). provisionFwStudent's Auth admin
   *  calls are NOT timeout-wrapped, so this still escapes as a throw — the importer's
   *  per-row catch must contain it as `unexpected_error` (crash-containment, G19). */
  throwCreateUser?: boolean;
};

let idSeq = 1;

function makeFakeDb(seed: Seed) {
  const tables: Record<string, Row[]> = {
    path_cohorts: [
      ...(seed.cohorts ?? [
        { id: BOSTON, kind: "fw", slug: "boston" },
        { id: HAMPTONS, kind: "fw", slug: "hamptons" },
      ]),
    ],
    path_program_versions: [{ id: VERSION, is_current: true }],
    path_student_profiles: [...(seed.profiles ?? [])],
    path_families: [],
    path_cohort_members: [...(seed.members ?? [])],
    path_fw_released_aliases: [],
    path_unit_tasks: TASK_ROWS.map((t) => ({ ...t, program_version_id: VERSION })),
    path_task_progress: [...(seed.progress ?? [])],
    path_task_events: [],
    path_fw_import_exceptions: [...(seed.exceptions ?? [])],
  };
  const authUsers: Row[] = [...(seed.authUsers ?? [])];
  const calls = { createUser: 0, deleteUser: 0 };

  function conflictKey(table: string): string[] {
    if (table === "path_task_progress") return ["student_id", "task_id"];
    if (table === "path_cohort_members") return ["student_id", "cohort_id"];
    return ["id"];
  }

  function query(table: string) {
    const eqs: [string, unknown][] = [];
    const ins: [string, unknown[]][] = [];
    const likes: [string, string][] = [];
    /** A read outage: throws for a `throws` table (a network abort the chunk's
     *  per-row catch must contain), or an error marker for an `errors` table. */
    const readErr = (): { message: string } | null => {
      if (seed.throws?.includes(table)) throw new TypeError(`fetch failed: ${table}`);
      const msg = seed.errors?.[table];
      return msg ? { message: msg } : null;
    };
    const filtered = () =>
      tables[table].filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          ins.every(([c, vs]) => vs.includes(r[c])) &&
          likes.every(([c, p]) =>
            typeof r[c] === "string" ? (r[c] as string).startsWith(p.replace(/%$/, "")) : true
          )
      );

    const insertThenable = (payload: Row | Row[]) => {
      const fail = seed.failTable?.table === table && seed.failTable.op === "insert";
      const applyAnyway = fail && seed.failTable?.applyAnyway === true;
      const list = Array.isArray(payload) ? payload : [payload];
      const write = () => {
        // Model the one-pending-per-(cohort,name,BAND) unique index the migration
        // enforces — same-name-different-band exceptions both park.
        if (table === "path_fw_import_exceptions") {
          for (const r of list) {
            const dup = tables[table].some(
              (x) =>
                x.cohort_id === r.cohort_id &&
                x.normalized_name === r.normalized_name &&
                x.band === r.band &&
                x.state === "pending"
            );
            if (dup) return { data: null, error: { code: "23505", message: "duplicate" } };
          }
        }
        const inserted = list.map((r) => ({ id: `${table}-${idSeq++}`, state: "pending", ...r }));
        tables[table].push(...inserted.map((r) => ({ ...r })));
        return { data: inserted.map((r) => ({ ...r })), error: null };
      };
      const apply = () => {
        if (fail) {
          // reported-failed-but-actually-landed: write the row, THEN return the error.
          if (applyAnyway) write();
          return { data: null, error: { code: "500", message: seed.failTable!.message } };
        }
        return write();
      };
      return {
        select() {
          return {
            single: async () => {
              const res = apply();
              return res.error ? res : { data: { id: (res.data as Row[])[0].id }, error: null };
            },
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(apply()).then(resolve, reject),
          };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(apply()).then(resolve, reject),
      };
    };

    const builder = {
      select: () => builder,
      eq(c: string, v: unknown) {
        eqs.push([c, v]);
        return builder;
      },
      in(c: string, vs: unknown[]) {
        ins.push([c, vs]);
        return builder;
      },
      like(c: string, p: string) {
        likes.push([c, p]);
        return builder;
      },
      is(c: string, v: unknown) {
        eqs.push([c, v]);
        return builder;
      },
      order: () => builder,
      range(from: number, to: number) {
        const err = readErr();
        if (err) return Promise.resolve({ data: null, error: err });
        const rows = filtered()
          .slice(from, to + 1)
          .map((r) => ({ ...r }));
        return Promise.resolve({ data: rows, error: null });
      },
      async maybeSingle() {
        const err = readErr();
        if (err) return { data: null, error: err };
        const hit = filtered()[0];
        return { data: hit ? { ...hit } : null, error: null };
      },
      then: (
        resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown,
        reject?: (e: unknown) => unknown
      ) => {
        let res: { data: Row[] | null; error: { message: string } | null };
        try {
          const err = readErr();
          // An UNRANGED read is capped at the PostgREST server max, exactly like
          // production — so a regression that drops `fetchAllRows`/`.range()` and
          // reads unranged silently truncates at 1000 and the pagination test
          // reddens (mirrors the fw-loader fake).
          res = err
            ? { data: null, error: err }
            : { data: filtered().slice(0, SERVER_MAX_ROWS).map((r) => ({ ...r })), error: null };
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
        return Promise.resolve(res).then(resolve, reject);
      },
      insert: (payload: Row | Row[]) => insertThenable(payload),
      upsert(payload: Row | Row[]) {
        const list = Array.isArray(payload) ? payload : [payload];
        const key = conflictKey(table);
        const apply = () => {
          if (seed.failTable?.table === table && seed.failTable.op === "upsert") {
            return { data: null, error: { message: seed.failTable.message } };
          }
          const inserted: Row[] = [];
          for (const r of list) {
            const dup = tables[table].some((x) => key.every((k) => x[k] === r[k]));
            if (!dup) {
              const row = { id: `${table}-${idSeq++}`, ...r };
              tables[table].push(row);
              inserted.push({ ...row });
            }
          }
          return { data: inserted, error: null };
        };
        return {
          select: () => Promise.resolve(apply()),
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(apply()).then(resolve, reject),
        };
      },
      update(payload: Row) {
        return {
          eq(c: string, v: unknown) {
            eqs.push([c, v]);
            return this;
          },
          is(c: string, v: unknown) {
            eqs.push([c, v]);
            return this;
          },
          select() {
            const matched = filtered();
            for (const r of matched) Object.assign(r, payload);
            return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
          },
        };
      },
      delete() {
        return {
          eq(c: string, v: unknown) {
            tables[table] = tables[table].filter((r) => r[c] !== v);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return builder;
  }

  const db = {
    from: (table: string) => query(table),
    auth: {
      admin: {
        async createUser(payload: { email: string; app_metadata?: Row }) {
          calls.createUser += 1;
          if (seed.throwCreateUser) throw new TypeError("fetch failed: createUser");
          if (authUsers.some((u) => u.email === payload.email)) {
            return { data: { user: null }, error: { code: "email_exists", message: "already registered" } };
          }
          const user = { id: `user-${idSeq++}`, email: payload.email, app_metadata: payload.app_metadata ?? { role: "student" } };
          authUsers.push(user);
          return { data: { user }, error: null };
        },
        async getUserById(id: string) {
          const user = authUsers.find((u) => u.id === id);
          return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "not found" } };
        },
        async deleteUser(id: string) {
          calls.deleteUser += 1;
          const i = authUsers.findIndex((u) => u.id === id);
          if (i >= 0) authUsers.splice(i, 1);
          return { error: null };
        },
        async listUsers() {
          return { data: { users: [...authUsers] }, error: null };
        },
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, tables, authUsers, calls };
}

/** A parsed row, with the normalized name derived from the name (never defaulted
 *  — a fixture whose key disagreed with its name would make matching meaningless). */
function row(
  rowNumber: number,
  firstName: string,
  lastName: string,
  band: FwImportParsedRow["band"]
): FwImportParsedRow {
  return { rowNumber, firstName, lastName, band, normalizedName: buildNormalizedFwName(firstName, lastName) };
}

/** A fully-provisioned FW student, ready to seed a returner or a completed row. */
function seedStudent(
  id: string,
  userId: string,
  first: string,
  last: string,
  band: string,
  cohortIds: string[]
) {
  const profile = {
    id,
    user_id: userId,
    child_id: null,
    first_name: first,
    last_name: last,
    band,
    normalized_name: buildNormalizedFwName(first, last),
    program_version_id: VERSION,
  };
  const authUser = { id: userId, email: `${buildNormalizedFwName(first, last).replace(/ /g, ".")}.fw@the120.school`, app_metadata: { role: "student" } };
  const members = cohortIds.map((c) => ({ id: `m-${id}-${c}`, student_id: id, cohort_id: c }));
  const progress = TASK_ROWS.map((t) => ({ student_id: id, task_id: t.task_id, criterion_id: t.criterion_id, program_version_id: VERSION, state: "locked" }));
  return { profile, authUser, members, progress };
}

const kinds = (outcomes: FwImportOutcome[]) => outcomes.map((o) => o.kind);

/* ══════════════════════════════════════════════════════════════ happy path ══ */

describe("runFwImportChunk — the happy path", () => {
  it("mints a fresh roster: account + membership + 125 locked rows each, zero events", async () => {
    const { db, tables, authUsers } = makeFakeDb({});
    const rows = [row(2, "Maya", "Chen", "g6_8"), row(3, "José", "García", "g9_12"), row(4, "Sean", "O'Brien", "g3_5")];
    const { outcomes } = await runFwImportChunk(db, { cohortId: BOSTON, actorUserId: GUIDE, rows });

    expect(kinds(outcomes)).toEqual(["minted", "minted", "minted"]);
    expect(authUsers).toHaveLength(3);
    expect(tables.path_cohort_members.filter((m) => m.cohort_id === BOSTON)).toHaveLength(3);
    expect(tables.path_task_progress).toHaveLength(3 * 125);
    expect(tables.path_task_progress.every((r) => r.state === "locked")).toBe(true);
    // The board opens at zero on Friday — materialization writes no events.
    expect(tables.path_task_events).toHaveLength(0);
  });

  it("re-running the SAME file mints zero new accounts (idempotent)", async () => {
    const { db, tables, authUsers, calls } = makeFakeDb({});
    const rows = [row(2, "Maya", "Chen", "g6_8"), row(3, "Rae", "Kim", "g9_12")];
    await runFwImportChunk(db, { cohortId: BOSTON, actorUserId: GUIDE, rows });
    const afterFirst = authUsers.length;
    const createUsersAfterFirst = calls.createUser;

    const second = await runFwImportChunk(db, { cohortId: BOSTON, actorUserId: GUIDE, rows });
    expect(kinds(second.outcomes)).toEqual(["skipped_existing", "skipped_existing"]);
    expect(authUsers).toHaveLength(afterFirst); // ZERO new accounts
    expect(calls.createUser).toBe(createUsersAfterFirst); // createUser never called again
    expect(tables.path_cohort_members.filter((m) => m.cohort_id === BOSTON)).toHaveLength(2);
    expect(tables.path_task_progress).toHaveLength(2 * 125);
  });

  it("collapses a within-CHUNK duplicate to one account (mid-chunk idempotence)", async () => {
    // Dedupe removes these before the chunk, but the core is idempotent anyway:
    // the second Maya matches the first (just minted) and skips.
    const { db, authUsers } = makeFakeDb({});
    const rows = [row(2, "Maya", "Chen", "g6_8"), row(3, "Maya", "Chen", "g6_8")];
    const { outcomes } = await runFwImportChunk(db, { cohortId: BOSTON, actorUserId: GUIDE, rows });
    expect(kinds(outcomes)).toEqual(["minted", "skipped_existing"]);
    expect(authUsers).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════ returner (PROPOSED-1 link) ══ */

describe("runFwImportChunk — the returner links, never re-provisions", () => {
  it("gives an existing FW student a SECOND membership on their ONE account", async () => {
    const rae = seedStudent("p-rae", "u-rae", "Rae", "Kim", "g9_12", [HAMPTONS]);
    const { db, tables, authUsers, calls } = makeFakeDb({
      profiles: [rae.profile],
      members: rae.members,
      progress: rae.progress,
      authUsers: [rae.authUser],
    });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Rae", "Kim", "g9_12")],
    });

    expect(kinds(outcomes)).toEqual(["linked"]);
    expect(outcomes[0].profileId).toBe("p-rae");
    expect(authUsers).toHaveLength(1); // one account, never a second
    expect(calls.createUser).toBe(0);
    // A second membership; progress NOT re-materialized (still exactly 125).
    expect(tables.path_cohort_members.map((m) => m.cohort_id).sort()).toEqual([BOSTON, HAMPTONS]);
    expect(tables.path_task_progress).toHaveLength(125);
  });
});

/* ══════════════════════════════════════════════ ambiguous → exception (G7) ══ */

describe("runFwImportChunk — ambiguous rows park, nothing minted", () => {
  it("parks a two-candidate ambiguous match and mints nothing", async () => {
    const a = seedStudent("p-a", "u-a", "Alex", "Kim", "g6_8", [HAMPTONS]);
    const b = seedStudent("p-b", "u-b", "Alex", "Kim", "g6_8", ["cohort-chicago"]);
    const { db, tables, authUsers } = makeFakeDb({
      profiles: [a.profile, b.profile],
      members: [...a.members, ...b.members],
      progress: [...a.progress, ...b.progress],
      authUsers: [a.authUser, b.authUser],
    });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Alex", "Kim", "g6_8")],
    });

    expect(kinds(outcomes)).toEqual(["exception"]);
    expect(authUsers).toHaveLength(2); // nothing minted
    const parked = tables.path_fw_import_exceptions.filter((e) => e.cohort_id === BOSTON);
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ reason: "ambiguous_match", state: "pending", band: "g6_8" });
  });

  it("does NOT stack a second exception on a re-import (idempotent park + skip)", async () => {
    const a = seedStudent("p-a", "u-a", "Alex", "Kim", "g6_8", [HAMPTONS]);
    const b = seedStudent("p-b", "u-b", "Alex", "Kim", "g6_8", ["cohort-chicago"]);
    const { db, tables } = makeFakeDb({
      profiles: [a.profile, b.profile],
      members: [...a.members, ...b.members],
      progress: [...a.progress, ...b.progress],
      authUsers: [a.authUser, b.authUser],
    });
    const rows = [row(2, "Alex", "Kim", "g6_8")];
    await runFwImportChunk(db, { cohortId: BOSTON, actorUserId: GUIDE, rows });
    const second = await runFwImportChunk(db, { cohortId: BOSTON, actorUserId: GUIDE, rows });
    // The pending exception now surfaces via loadFwMatchCandidates → skip.
    expect(kinds(second.outcomes)).toEqual(["skipped_pending_exception"]);
    expect(tables.path_fw_import_exceptions.filter((e) => e.state === "pending")).toHaveLength(1);
  });
});

/* ═════════════════════════════════════════════ reject the row, never the file ══ */

describe("runFwImportChunk — a failed row does not take the file down (G19)", () => {
  it("rejects an unkeyable row and mints the rows around it", async () => {
    const { db, authUsers } = makeFakeDb({});
    const rows = [
      row(2, "Maya", "Chen", "g6_8"),
      { rowNumber: 3, firstName: "!!!", lastName: "Nobody", band: "g6_8" as const, normalizedName: "bogus" },
      row(4, "Rae", "Kim", "g9_12"),
    ];
    const { outcomes } = await runFwImportChunk(db, { cohortId: BOSTON, actorUserId: GUIDE, rows });
    expect(kinds(outcomes)).toEqual(["minted", "failed", "minted"]);
    expect(outcomes[1].reason).toBe("invalid_name");
    expect(authUsers).toHaveLength(2);
  });

  it("compensates a mid-row provisioning failure — the created account is deleted", async () => {
    // The profile insert fails after the account + family were created;
    // provisionFwStudent's compensation best-effort deletes the account.
    const { db, tables, authUsers, calls } = makeFakeDb({
      failTable: { table: "path_student_profiles", op: "insert", message: "boom" },
    });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Maya", "Chen", "g6_8")],
    });
    expect(kinds(outcomes)).toEqual(["failed"]);
    expect(calls.deleteUser).toBe(1);
    expect(authUsers).toHaveLength(0);
    expect(tables.path_student_profiles).toHaveLength(0);
  });

  it("carries a retry handle when a mid-row failure left a resumable profile", async () => {
    const { db, tables } = makeFakeDb({
      failTable: { table: "path_cohort_members", op: "upsert", message: "boom" },
    });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Maya", "Chen", "g6_8")],
    });
    expect(outcomes[0].kind).toBe("failed");
    expect(outcomes[0].reason).toBe("membership_failed");
    expect(outcomes[0].retryProfileId).toBe(tables.path_student_profiles[0].id);
  });
});

/* ═══════════════════════════════════ mid-file failure → re-run skips the done ══ */

describe("runFwImportChunk — a re-run after a mid-file failure completes the rest", () => {
  it("skips the already-minted student and mints the one that failed before", async () => {
    // Model the aftermath of a crashed run: Maya was fully provisioned; Rae was not.
    const maya = seedStudent("p-maya", "u-maya", "Maya", "Chen", "g6_8", [BOSTON]);
    const { db, tables, authUsers } = makeFakeDb({
      profiles: [maya.profile],
      members: maya.members,
      progress: maya.progress,
      authUsers: [maya.authUser],
    });
    const rows = [row(2, "Maya", "Chen", "g6_8"), row(3, "Rae", "Kim", "g9_12")];
    const { outcomes } = await runFwImportChunk(db, { cohortId: BOSTON, actorUserId: GUIDE, rows });

    expect(kinds(outcomes)).toEqual(["skipped_existing", "minted"]);
    // Maya's account was not duplicated; Rae's was newly minted.
    expect(authUsers).toHaveLength(2);
    expect(tables.path_cohort_members.filter((m) => m.cohort_id === BOSTON)).toHaveLength(2);
  });

  it("FINISHES a stranded partial (membership landed, progress did not) in place", async () => {
    // A prior mint crashed after the membership and before the 125 rows. The row
    // matches as an existing member, but a plain skip would leave a tap-dead tree —
    // so the fold verifies and completes it.
    const maya = seedStudent("p-maya", "u-maya", "Maya", "Chen", "g6_8", [BOSTON]);
    const { db, tables } = makeFakeDb({
      profiles: [maya.profile],
      members: maya.members,
      progress: maya.progress.slice(0, 10), // only 10 of 125 landed
      authUsers: [maya.authUser],
    });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Maya", "Chen", "g6_8")],
    });
    // Completed in place — reported as `resumed` (work happened), distinct from a
    // fresh mint and from a no-op skip.
    expect(outcomes[0].kind).toBe("resumed");
    expect(tables.path_task_progress.filter((r) => r.student_id === "p-maya")).toHaveLength(125);
  });

  it("converges a crash between membership and materialization in ONE pass (link path)", async () => {
    // A prior mint's profile landed but NEITHER its membership NOR its progress
    // did. The row decides as `link` (a profile exists, not a member here); the
    // link adds the membership and the same pass finishes the 125 rows — one pass,
    // not two, and reported cleanly rather than as a bare legs_unverified failure.
    const maya = seedStudent("p-maya", "u-maya", "Maya", "Chen", "g6_8", []); // no membership
    const { db, tables } = makeFakeDb({
      profiles: [maya.profile],
      members: [],
      progress: [], // no progress either
      authUsers: [maya.authUser],
    });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Maya", "Chen", "g6_8")],
    });
    expect(outcomes[0].kind).toBe("linked");
    expect(tables.path_cohort_members.filter((m) => m.cohort_id === BOSTON)).toHaveLength(1);
    expect(tables.path_task_progress.filter((r) => r.student_id === "p-maya")).toHaveLength(125);
  });
});

/* ═══════════════════════════════════ reject-the-file guards: throw / read outage ══ */

describe("runFwImportChunk — read failures are contained, never crash the chunk", () => {
  it("turns a match-lookup read OUTAGE into a per-row match_unavailable, not a mint", async () => {
    // If the match lookup fails, minting anyway would create a duplicate for a
    // child whose record simply failed to load (the FW-D2 risk).
    const { db, authUsers } = makeFakeDb({ errors: { path_student_profiles: "boom" } });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Maya", "Chen", "g6_8"), row(3, "Rae", "Kim", "g9_12")],
    });
    expect(kinds(outcomes)).toEqual(["failed", "failed"]);
    expect(outcomes.every((o) => o.reason === "match_unavailable")).toBe(true);
    expect(authUsers).toHaveLength(0); // nothing minted on a failed check
  });

  it("CONTAINS a thrown provisioning read as a typed failure without crashing the chunk", async () => {
    // A network abort deep in provisioning THROWS. As of Unit 9's hardening,
    // `provisionFwStudent` routes its PostgREST reads through `fwRead`, which CATCHES
    // the throw and returns a typed error — so the version read here fails closed to
    // `unavailable` rather than propagating as an uncaught throw the chunk's per-row
    // catch would report as `unexpected_error`. Either way the chunk contains it:
    // every row accounted for, nothing minted, the chunk returns normally — but the
    // reason is now the more specific, non-crash `unavailable`.
    const { db, authUsers } = makeFakeDb({ throws: ["path_program_versions"] });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Maya", "Chen", "g6_8"), row(3, "Rae", "Kim", "g9_12")],
    });
    expect(kinds(outcomes)).toEqual(["failed", "failed"]);
    expect(outcomes.every((o) => o.reason === "unavailable")).toBe(true);
    expect(authUsers).toHaveLength(0);
  });

  it("CONTAINS a thrown Auth createUser as `unexpected_error` — the crash-containment guarantee (G19)", async () => {
    // provisionFwStudent's Auth admin calls (createUser/getUserById) are NOT timeout/throw-
    // wrapped the way its PostgREST calls now are, so a GoTrue network abort still THROWS.
    // The importer's per-row catch must contain it — every row accounted for, nothing minted,
    // the chunk returns normally. (This restores the coverage the fwRead-guard change moved
    // off the `path_program_versions` path above.)
    const { db, authUsers } = makeFakeDb({ throwCreateUser: true });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Maya", "Chen", "g6_8"), row(3, "Rae", "Kim", "g9_12")],
    });
    expect(kinds(outcomes)).toEqual(["failed", "failed"]);
    expect(outcomes.every((o) => o.reason === "unexpected_error")).toBe(true);
    expect(authUsers).toHaveLength(0);
  });

  it("surfaces a link failure as a per-row failure with a retry handle, file continues", async () => {
    // A returner whose membership insert fails: the row fails (with a retry
    // handle), and a clean mint in the same chunk still lands.
    const rae = seedStudent("p-rae", "u-rae", "Rae", "Kim", "g9_12", [HAMPTONS]);
    const { db, authUsers } = makeFakeDb({
      profiles: [rae.profile],
      members: rae.members,
      progress: rae.progress,
      authUsers: [rae.authUser],
      failTable: { table: "path_cohort_members", op: "insert", message: "boom" },
    });
    const { outcomes } = await runFwImportChunk(db, {
      cohortId: BOSTON,
      actorUserId: GUIDE,
      rows: [row(2, "Rae", "Kim", "g9_12"), row(3, "Ada", "Fresh", "g3_5")],
    });
    expect(outcomes[0].kind).toBe("failed");
    expect(outcomes[0].retryProfileId).toBe("p-rae");
    expect(outcomes[1].kind).toBe("minted"); // the clean mint (upsert) still lands
    expect(authUsers).toHaveLength(2);
  });
});

/* ═══════════════════════════════════ the exception list + resolve (ops, G7) ══ */

// Every park below goes through the PUBLIC entry (`runFwImportChunk` on an
// ambiguous row), never a direct `parkFwImportException` call — the park path is
// not exported, and testing it through the fold is the point (maintainability +
// testing reviews).

/** A fake db where importing "Alex Kim" g6_8 into BOSTON parks an exception (two
 *  same-band candidates elsewhere → ambiguous, nothing minted). */
function ambiguousDb(extra: Partial<Seed> = {}) {
  const a = seedStudent("p-a", "u-a", "Alex", "Kim", "g6_8", [HAMPTONS]);
  const b = seedStudent("p-b", "u-b", "Alex", "Kim", "g6_8", ["cohort-chicago"]);
  return makeFakeDb({
    profiles: [a.profile, b.profile],
    members: [...a.members, ...b.members],
    progress: [...a.progress, ...b.progress],
    authUsers: [a.authUser, b.authUser],
    ...extra,
  });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parkAlex = (db: any) =>
  runFwImportChunk(db, { cohortId: BOSTON, actorUserId: GUIDE, rows: [row(2, "Alex", "Kim", "g6_8")] });

describe("listFwImportExceptions / resolveFwImportException (via the fold)", () => {
  it("parks a row through the fold and lists it as pending", async () => {
    const { db } = ambiguousDb();
    const { outcomes } = await parkAlex(db);
    expect(outcomes[0].kind).toBe("exception");

    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");
    expect(listed.exceptions).toEqual([
      expect.objectContaining({ firstName: "Alex", lastName: "Kim", band: "g6_8", state: "pending", reason: "ambiguous_match" }),
    ]);
  });

  it("recovers the exception park from a reported-failed-but-LANDED write (post-write verify)", async () => {
    // `fwWrite` may report a timeout on a write that actually committed. The park's
    // error branch re-reads; a pending row now present means the park is done.
    const { db, tables } = ambiguousDb({
      failTable: { table: "path_fw_import_exceptions", op: "insert", message: "timeout", applyAnyway: true },
    });
    const { outcomes } = await parkAlex(db);
    expect(outcomes[0].kind).toBe("exception"); // recovered, not reported failed
    expect(tables.path_fw_import_exceptions.filter((e) => e.state === "pending")).toHaveLength(1);
  });

  it("reports exception_park_failed when the park genuinely did not land", async () => {
    const { db, tables, authUsers } = ambiguousDb({
      failTable: { table: "path_fw_import_exceptions", op: "insert", message: "boom" },
    });
    const { outcomes } = await parkAlex(db);
    expect(outcomes[0].kind).toBe("failed");
    expect(outcomes[0].reason).toBe("exception_park_failed");
    expect(tables.path_fw_import_exceptions).toHaveLength(0);
    expect(authUsers).toHaveLength(2); // nothing minted
  });

  it("resolves a pending exception and removes it from the open list", async () => {
    const { db } = ambiguousDb();
    await parkAlex(db);
    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");
    const id = listed.exceptions[0].id;

    expect(
      await resolveFwImportException(db, { exceptionId: id, cohortId: BOSTON, actorUserId: GUIDE, disposition: "resolved", now: 1_000 })
    ).toEqual({ ok: true });

    const openAfter = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!openAfter.ok) throw new Error("unreachable");
    expect(openAfter.exceptions).toHaveLength(0);
  });

  it("dismisses a pending exception (the second disposition) and records the state", async () => {
    const { db } = ambiguousDb();
    await parkAlex(db);
    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");
    const id = listed.exceptions[0].id;

    expect(
      await resolveFwImportException(db, { exceptionId: id, cohortId: BOSTON, actorUserId: GUIDE, disposition: "dismissed", now: 5 })
    ).toEqual({ ok: true });

    const all = await listFwImportExceptions(db, { cohortId: BOSTON, includeResolved: true });
    if (!all.ok) throw new Error("unreachable");
    expect(all.exceptions).toEqual([expect.objectContaining({ id, state: "dismissed" })]);
  });

  it("includeResolved returns closed rows alongside pending; the default hides them", async () => {
    const { db } = ambiguousDb();
    await parkAlex(db);
    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");
    await resolveFwImportException(db, {
      exceptionId: listed.exceptions[0].id,
      cohortId: BOSTON,
      actorUserId: GUIDE,
      disposition: "resolved",
      now: 1,
    });
    const openOnly = await listFwImportExceptions(db, { cohortId: BOSTON });
    const withHistory = await listFwImportExceptions(db, { cohortId: BOSTON, includeResolved: true });
    if (!openOnly.ok || !withHistory.ok) throw new Error("unreachable");
    expect(openOnly.exceptions).toHaveLength(0);
    expect(withHistory.exceptions).toHaveLength(1);
  });

  it("refuses to resolve an exception scoped to a DIFFERENT cohort (predicate is the guard)", async () => {
    const { db } = ambiguousDb();
    await parkAlex(db);
    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");
    expect(
      await resolveFwImportException(db, { exceptionId: listed.exceptions[0].id, cohortId: HAMPTONS, actorUserId: GUIDE, disposition: "dismissed", now: 1 })
    ).toEqual({ ok: false, reason: "not_open" });
  });

  it("reports not_open on a double-resolve", async () => {
    const { db } = ambiguousDb();
    await parkAlex(db);
    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");
    const id = listed.exceptions[0].id;
    await resolveFwImportException(db, { exceptionId: id, cohortId: BOSTON, actorUserId: GUIDE, disposition: "resolved", now: 1 });
    expect(
      await resolveFwImportException(db, { exceptionId: id, cohortId: BOSTON, actorUserId: GUIDE, disposition: "resolved", now: 2 })
    ).toEqual({ ok: false, reason: "not_open" });
  });

  it("pages PAST the 1000-row server cap — never silently truncates the open list", async () => {
    // A season's worth of exceptions across a large event can clear the cliff; the
    // pre-event gate must see all of them. Seeded straight into the table (the
    // fold is not the subject here).
    const many = Array.from({ length: 1500 }, (_, i) => ({
      id: `exc-${i}`,
      cohort_id: BOSTON,
      first_name: `Kid${i}`,
      last_name: "Many",
      band: "g6_8",
      normalized_name: buildNormalizedFwName(`Kid${i}`, "Many"),
      reason: "ambiguous_match",
      state: "pending",
      created_at: `2026-08-0${(i % 9) + 1}`,
    }));
    const { db } = makeFakeDb({ exceptions: many });
    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");
    expect(listed.exceptions).toHaveLength(1500);
  });
});
