import { describe, expect, it } from "vitest";

import "@/app/path/content/registry";
import { getProgram } from "@/app/path/content/manifest";
import { buildProgramRows } from "@/app/path/content/seed-rows";
import {
  listFwImportExceptions,
  parkFwImportException,
  resolveFwImportException,
  runFwImportChunk,
  type FwImportOutcome,
} from "../fw-import-core";
import type { FwImportParsedRow } from "../fw-import-rules";
import { buildNormalizedFwName } from "../fw-provision-rules";

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
  /** Insert into this table fails (a mid-row provisioning failure). */
  failTable?: { table: string; op: "insert" | "upsert"; message: string } | null;
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
      const list = Array.isArray(payload) ? payload : [payload];
      const apply = () => {
        if (fail) return { data: null, error: { code: "500", message: seed.failTable!.message } };
        // Model the one-pending-per-(cohort,name) unique index the migration adds.
        if (table === "path_fw_import_exceptions") {
          for (const r of list) {
            const dup = tables[table].some(
              (x) =>
                x.cohort_id === r.cohort_id &&
                x.normalized_name === r.normalized_name &&
                x.state === "pending"
            );
            if (dup) return { data: null, error: { code: "23505", message: "duplicate" } };
          }
        }
        const inserted = list.map((r) => ({ id: `${table}-${idSeq++}`, state: "pending", ...r }));
        tables[table].push(...inserted.map((r) => ({ ...r })));
        return { data: inserted.map((r) => ({ ...r })), error: null };
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
        const rows = filtered()
          .slice(from, to + 1)
          .map((r) => ({ ...r }));
        return Promise.resolve({ data: rows, error: null });
      },
      async maybeSingle() {
        const hit = filtered()[0];
        return { data: hit ? { ...hit } : null, error: null };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: filtered().map((r) => ({ ...r })), error: null }).then(resolve, reject),
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
    expect(outcomes[0].kind).toBe("minted"); // completed, not falsely skipped
    expect(tables.path_task_progress.filter((r) => r.student_id === "p-maya")).toHaveLength(125);
  });
});

/* ═══════════════════════════════════ the exception list + resolve (ops, G7) ══ */

describe("parkFwImportException / listFwImportExceptions / resolveFwImportException", () => {
  it("parks a row and lists it as pending", async () => {
    const { db } = makeFakeDb({});
    const parked = await parkFwImportException(db, {
      cohortId: BOSTON,
      row: row(2, "Alex", "Kim", "g6_8"),
      reason: "ambiguous_match",
      createdBy: GUIDE,
    });
    expect(parked).toEqual({ ok: true, alreadyParked: false });

    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error("unreachable");
    expect(listed.exceptions).toEqual([
      expect.objectContaining({ firstName: "Alex", lastName: "Kim", band: "g6_8", state: "pending" }),
    ]);
  });

  it("treats a second park of the same (cohort, name) as alreadyParked, not a new row", async () => {
    const { db, tables } = makeFakeDb({});
    const r = row(2, "Alex", "Kim", "g6_8");
    await parkFwImportException(db, { cohortId: BOSTON, row: r, reason: "ambiguous_match", createdBy: GUIDE });
    const again = await parkFwImportException(db, { cohortId: BOSTON, row: r, reason: "ambiguous_match", createdBy: GUIDE });
    expect(again).toEqual({ ok: true, alreadyParked: true });
    expect(tables.path_fw_import_exceptions).toHaveLength(1);
  });

  it("resolves a pending exception and removes it from the open list", async () => {
    const { db } = makeFakeDb({});
    await parkFwImportException(db, {
      cohortId: BOSTON,
      row: row(2, "Alex", "Kim", "g6_8"),
      reason: "ambiguous_match",
      createdBy: GUIDE,
    });
    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");
    const id = listed.exceptions[0].id;

    const resolved = await resolveFwImportException(db, {
      exceptionId: id,
      cohortId: BOSTON,
      actorUserId: GUIDE,
      disposition: "resolved",
      now: 1_000,
    });
    expect(resolved).toEqual({ ok: true });

    const openAfter = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!openAfter.ok) throw new Error("unreachable");
    expect(openAfter.exceptions).toHaveLength(0);
  });

  it("refuses to resolve an exception scoped to a DIFFERENT cohort", async () => {
    const { db } = makeFakeDb({});
    await parkFwImportException(db, {
      cohortId: BOSTON,
      row: row(2, "Alex", "Kim", "g6_8"),
      reason: "ambiguous_match",
      createdBy: GUIDE,
    });
    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");

    const res = await resolveFwImportException(db, {
      exceptionId: listed.exceptions[0].id,
      cohortId: HAMPTONS, // wrong cohort — the predicate is the guard, not the UI
      actorUserId: GUIDE,
      disposition: "dismissed",
      now: 1_000,
    });
    expect(res).toEqual({ ok: false, reason: "not_open" });
  });

  it("reports not_open on a double-resolve", async () => {
    const { db } = makeFakeDb({});
    await parkFwImportException(db, {
      cohortId: BOSTON,
      row: row(2, "Alex", "Kim", "g6_8"),
      reason: "ambiguous_match",
      createdBy: GUIDE,
    });
    const listed = await listFwImportExceptions(db, { cohortId: BOSTON });
    if (!listed.ok) throw new Error("unreachable");
    const id = listed.exceptions[0].id;
    await resolveFwImportException(db, { exceptionId: id, cohortId: BOSTON, actorUserId: GUIDE, disposition: "resolved", now: 1 });
    const twice = await resolveFwImportException(db, { exceptionId: id, cohortId: BOSTON, actorUserId: GUIDE, disposition: "resolved", now: 2 });
    expect(twice).toEqual({ ok: false, reason: "not_open" });
  });
});
