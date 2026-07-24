import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  runFwMatchLookup,
  runFwQuickCreate,
  verifyFwStudentLegs,
} from "../fw-student-core";
import { buildNormalizedFwName } from "../fw-provision-rules";

/**
 * Quick-create's write path (FW Unit 4, Decision 13), driven through a fake
 * Supabase client.
 *
 * The property this file exists for is the one the plan writes in bold: "a kid
 * standing at the table is never handed a tap-dead tree." That is a claim about
 * a COMPOSITION — provisioning succeeds, then all three legs are OBSERVED — and
 * it is exactly the shape of composition that has produced a P1 in each of the
 * last two units. `provisionFwStudent` is well tested on its own; what is tested
 * here is what happens after it says yes.
 */

const BOSTON = "cohort-boston";
const GUIDE = "user-guide-a";
const VERSION = "2026-27";
const TASK_IDS = ["1.1.1", "1.1.2", "1.2.4"];

type Row = Record<string, unknown>;

type Seed = {
  tables?: Record<string, Row[]>;
  errors?: Partial<Record<string, string>>;
  /** Tables whose read THROWS rather than returning `{data,error}`. supabase-js
   *  reports most failures in band, but a network abort can throw — and an
   *  escaped throw on a Server Component walks past every typed refusal branch
   *  (reliability review). */
  throws?: string[];
  /** auth.admin.getUserById behaviour, keyed by user id. */
  accounts?: Record<string, { missing?: boolean; error?: string }>;
};

function makeFakeDb(seed: Seed) {
  const tables: Record<string, Row[]> = {
    path_unit_tasks: TASK_IDS.map((task_id) => ({ task_id, program_version_id: VERSION })),
    ...Object.fromEntries(
      Object.entries(seed.tables ?? {}).map(([k, v]) => [k, v.map((r) => ({ ...r }))])
    ),
  };
  const reads: string[] = [];

  const db = {
    from(table: string) {
      const eqs: [string, unknown][] = [];
      const rows = () => {
        reads.push(table);
        if (seed.throws?.includes(table)) throw new TypeError("fetch failed");
        const err = seed.errors?.[table];
        if (err) return { data: null, error: { message: err } };
        return {
          data: (tables[table] ?? [])
            .filter((r) => eqs.every(([c, v]) => r[c] === v))
            .map((r) => ({ ...r })),
          error: null,
        };
      };
      const builder = {
        select: () => builder,
        eq: (c: string, v: unknown) => {
          eqs.push([c, v]);
          return builder;
        },
        in: () => builder,
        range: () => builder,
        maybeSingle: async () => {
          const res = rows();
          return res.error ? res : { data: res.data?.[0] ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(rows()).then(resolve, reject),
      };
      return builder;
    },
    auth: {
      admin: {
        async getUserById(id: string) {
          const spec = seed.accounts?.[id];
          if (spec?.error) return { data: null, error: { message: spec.error } };
          if (spec?.missing) return { data: { user: null }, error: null };
          return { data: { user: { id, email: `${id}@example.test` } }, error: null };
        },
      },
    },
  };
  return { db: db as never, reads, tables };
}

/** A fully-provisioned Maya: profile, membership, all three progress rows. */
const complete = (over: { progress?: string[] } = {}): Seed["tables"] => ({
  path_student_profiles: [
    {
      id: "p-maya",
      user_id: "u-maya",
      program_version_id: VERSION,
      first_name: "Maya",
      last_name: "Chen",
      band: "g6_8",
      normalized_name: buildNormalizedFwName("Maya", "Chen"),
    },
  ],
  path_cohort_members: [{ student_id: "p-maya", cohort_id: BOSTON }],
  path_task_progress: (over.progress ?? TASK_IDS).map((task_id) => ({
    student_id: "p-maya",
    task_id,
  })),
});

/* ═══════════════════════════════════════════════════════════ leg verification ══ */

describe("verifyFwStudentLegs", () => {
  const verify = (seed: Seed) =>
    verifyFwStudentLegs(makeFakeDb(seed).db, { profileId: "p-maya", cohortId: BOSTON });

  it("passes when the account, the membership, and every task row are there", async () => {
    expect(await verify({ tables: complete() })).toEqual({ ok: true });
  });

  it("catches a PARTIAL materialization that a row count would pass", async () => {
    // The exact gap this function exists for: provisionFwStudent's upsert is
    // `ignoreDuplicates`, so it reports `created: 0` on a resume whether the
    // student has every row or three of them.
    expect(await verify({ tables: complete({ progress: ["1.1.1", "1.1.2"] }) })).toEqual({
      ok: false,
      leg: "materialization",
    });
  });

  it("catches a missing membership row", async () => {
    const tables = complete();
    expect(await verify({ tables: { ...tables, path_cohort_members: [] } })).toEqual({
      ok: false,
      leg: "membership",
    });
  });

  it("catches a membership for a DIFFERENT cohort", async () => {
    const tables = complete();
    expect(
      await verify({
        tables: { ...tables, path_cohort_members: [{ student_id: "p-maya", cohort_id: "other" }] },
      })
    ).toEqual({ ok: false, leg: "membership" });
  });

  it("catches a profile with no auth account behind it", async () => {
    // A compensation that half-ran leaves a perfectly normal-looking roster row
    // that can never be signed into or converted.
    expect(await verify({ tables: complete(), accounts: { "u-maya": { missing: true } } })).toEqual({
      ok: false,
      leg: "account",
    });
  });

  it("catches a missing profile as the account leg", async () => {
    expect(await verify({ tables: { ...complete(), path_student_profiles: [] } })).toEqual({
      ok: false,
      leg: "account",
    });
  });

  it("reports leg:null — never a false failed leg — when a read fails", async () => {
    // A read outage must not send a guide into a retry loop against a leg that
    // is probably fine.
    for (const table of ["path_student_profiles", "path_cohort_members", "path_task_progress"]) {
      expect(await verify({ tables: complete(), errors: { [table]: "boom" } })).toEqual({
        ok: false,
        leg: null,
      });
    }
    expect(
      await verify({ tables: complete(), accounts: { "u-maya": { error: "auth down" } } })
    ).toEqual({ ok: false, leg: null });
  });

  it("refuses to pass vacuously when the pinned version has no content seeded", async () => {
    // "every task has a row" over zero tasks is true and would route a guide
    // into an empty tree.
    const { db } = makeFakeDb({ tables: { ...complete(), path_unit_tasks: [] } });
    expect(await verifyFwStudentLegs(db, { profileId: "p-maya", cohortId: BOSTON })).toEqual({
      ok: false,
      leg: null,
    });
  });

  it("stops at the FIRST missing leg, in write order", async () => {
    // Nothing exists at all: the answer is `account`, not `materialization`.
    expect(
      await verify({ tables: { path_student_profiles: [], path_cohort_members: [], path_task_progress: [] } })
    ).toEqual({ ok: false, leg: "account" });
  });
});

/* ═════════════════════════════════════════════════════════════ quick-create ══ */

vi.mock("../provision-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../provision-core")>();
  return { ...actual, provisionFwStudent: vi.fn() };
});
const { provisionFwStudent } = await import("../provision-core");
const provisionMock = vi.mocked(provisionFwStudent);

describe("runFwQuickCreate", () => {
  beforeEach(() => provisionMock.mockReset());

  const base = {
    firstName: "Maya",
    lastName: "Chen",
    band: "g6_8" as const,
    cohortId: BOSTON,
    actorUserId: GUIDE,
    noticeAttested: true,
  };

  it("refuses an unattested submission BEFORE it writes anything (Decision 13)", async () => {
    const { db } = makeFakeDb({ tables: complete() });
    expect(await runFwQuickCreate(db, { ...base, noticeAttested: false })).toEqual({
      ok: false,
      reason: "notice_not_attested",
    });
    // The checkbox is a client-side fact; the column it writes is the record.
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it("stamps the attesting adult from the caller, never from the form", async () => {
    provisionMock.mockResolvedValue({
      ok: true,
      profileId: "p-maya",
      userId: "u-maya",
      email: "maya.chen.fw@the120.school",
      adopted: false,
    });
    const { db } = makeFakeDb({ tables: complete() });
    await runFwQuickCreate(db, base);
    expect(provisionMock.mock.calls[0][1]).toMatchObject({ noticeAttestedBy: GUIDE });
  });

  it("reports success only after all three legs verify", async () => {
    provisionMock.mockResolvedValue({
      ok: true,
      profileId: "p-maya",
      userId: "u-maya",
      email: "maya.chen.fw@the120.school",
      adopted: false,
    });
    const { db } = makeFakeDb({ tables: complete() });
    expect(await runFwQuickCreate(db, base)).toEqual({
      ok: true,
      studentId: "p-maya",
      adopted: false,
    });
  });

  it("REFUSES a provisioning success whose legs do not verify, and hands back the retry handle", async () => {
    // The whole point. provisionFwStudent said yes; the tree would be tap-dead.
    provisionMock.mockResolvedValue({
      ok: true,
      profileId: "p-maya",
      userId: "u-maya",
      email: "maya.chen.fw@the120.school",
      adopted: false,
    });
    const { db } = makeFakeDb({ tables: complete({ progress: ["1.1.1"] }) });
    expect(await runFwQuickCreate(db, base)).toEqual({
      ok: false,
      reason: "legs_unverified",
      leg: "materialization",
      retryProfileId: "p-maya",
    });
  });

  it("carries provisioning's own retry handle through unchanged", async () => {
    // Retry-in-place depends on this id surviving. Losing it is how a guide ends
    // up with two Maya Chens and two permanent name-derived addresses.
    provisionMock.mockResolvedValue({
      ok: false,
      reason: "membership_failed",
      profileId: "p-maya",
    });
    const { db } = makeFakeDb({ tables: complete() });
    expect(await runFwQuickCreate(db, base)).toEqual({
      ok: false,
      reason: "membership_failed",
      retryProfileId: "p-maya",
    });
  });

  it("omits the retry handle for failures that left nothing behind", async () => {
    provisionMock.mockResolvedValue({ ok: false, reason: "invalid_name" });
    const { db } = makeFakeDb({ tables: complete() });
    expect(await runFwQuickCreate(db, base)).toEqual({ ok: false, reason: "invalid_name" });
  });

  it("passes the retry handle down so a resume finishes the SAME child", async () => {
    provisionMock.mockResolvedValue({
      ok: true,
      profileId: "p-maya",
      userId: "u-maya",
      email: "maya.chen.fw@the120.school",
      adopted: true,
    });
    const { db } = makeFakeDb({ tables: complete() });
    await runFwQuickCreate(db, { ...base, existingProfileId: "p-maya" });
    expect(provisionMock.mock.calls[0][1]).toMatchObject({ existingProfileId: "p-maya" });
  });

  it("does not report success when the verification itself could not run", async () => {
    provisionMock.mockResolvedValue({
      ok: true,
      profileId: "p-maya",
      userId: "u-maya",
      email: "maya.chen.fw@the120.school",
      adopted: false,
    });
    const { db } = makeFakeDb({ tables: complete(), errors: { path_task_progress: "boom" } });
    expect(await runFwQuickCreate(db, base)).toEqual({
      ok: false,
      reason: "legs_unverified",
      retryProfileId: "p-maya",
    });
  });
});

/* ═════════════════════════════════════════════ PROPOSED-1: the lookup, composed ══ */

describe("runFwMatchLookup", () => {
  const lookup = (seed: Seed, name: [string, string] = ["Maya", "Chen"]) =>
    runFwMatchLookup(makeFakeDb(seed).db, {
      firstName: name[0],
      lastName: name[1],
      cohortId: BOSTON,
    });

  it("finds a same-cohort student and returns their band for the confirm card", async () => {
    expect(await lookup({ tables: complete() })).toEqual({
      ok: true,
      verdict: {
        kind: "same_cohort",
        matches: [{ profileId: "p-maya", band: "g6_8", source: "profile" }],
      },
    });
  });

  it("returns the minimal signal for a student who is only at another weekend", async () => {
    const tables = complete();
    expect(
      await lookup({
        tables: { ...tables, path_cohort_members: [{ student_id: "p-maya", cohort_id: "elsewhere" }] },
      })
    ).toEqual({ ok: true, verdict: { kind: "cross_cohort", count: 1 } });
  });

  it("returns `none` for a name nobody has", async () => {
    expect(await lookup({ tables: complete() }, ["Nobody", "Here"])).toEqual({
      ok: true,
      verdict: { kind: "none" },
    });
  });

  it("never sends an unkeyable name to the database", async () => {
    // `normalized_name = ''` would select every un-normalized row in the table.
    const { db, reads } = makeFakeDb({ tables: complete() });
    expect(
      await runFwMatchLookup(db, { firstName: "  ", lastName: "Chen", cohortId: BOSTON })
    ).toEqual({ ok: true, verdict: { kind: "invalid_name" } });
    expect(reads).toEqual([]);
  });

  it("says the check did not run, rather than `none`, when the lookup fails", async () => {
    // `none` would send the guide straight to "New student" and mint a second
    // account for a child who already has one.
    expect(await lookup({ tables: complete(), errors: { path_student_profiles: "boom" } })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
