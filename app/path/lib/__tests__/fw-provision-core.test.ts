import { describe, expect, it } from "vitest";

import "@/app/path/content/registry";
import { getProgram } from "@/app/path/content/manifest";
import { buildProgramRows } from "@/app/path/content/seed-rows";
import { ensureFwStudentProgress, provisionFwStudent } from "../provision-core";

/**
 * Fake Supabase client for the FW half of provision-core (the WebhookFakeDb
 * pattern, extended from provision-core.test.ts's harness).
 *
 * Why this file exists: `provisionFwStudent` mints a real auth account for a
 * child across TWO systems (the Supabase Auth API and PostgREST) with no
 * transaction spanning them, then writes four more rows. The decisions it makes
 * — when a failed createUser is a collision versus a stranded orphan to adopt,
 * which failures compensate and which keep the profile for retry-in-place,
 * whether a caller-supplied resume id may be trusted — are sequencing logic that
 * lives in the impure shell by necessity and cannot be reached by the pure-rules
 * tests. That is exactly the rationale provision-core.test.ts states for its own
 * harness; the FW sibling has more steps, no transaction, and a live event with
 * ~90 children behind it.
 *
 * The task catalog is seeded from the REAL pinned content, so "125 locked rows"
 * is the count a Boston student actually gets, not a fixture's opinion.
 */

type Row = Record<string, unknown>;

const TASK_ROWS = buildProgramRows(getProgram("2026-27"), { isCurrent: true }).tasks;
const COHORT = "cohort-boston";
const VERSION = "2026-27";

type CreateUserOutcome =
  | { ok: true }
  /** The API reports failure. `landsAnyway: true` models the ambiguous case —
   *  Supabase committed the account, then the response was lost. */
  | { ok: false; code?: string; message: string; landsAnyway?: boolean };

type Seed = {
  cohorts?: Row[];
  versions?: Row[];
  profiles?: Row[];
  families?: Row[];
  members?: Row[];
  releasedAliases?: Row[];
  taskRows?: Row[];
  progress?: Row[];
  authUsers?: Row[];
  /** Consumed in order, one per createUser call; absent entries mean success. */
  createUserOutcomes?: CreateUserOutcome[];
  failTable?: { table: string; op: "insert" | "upsert"; message: string } | null;
  deleteUserError?: string | null;
};

function makeFakeDb(seed: Seed) {
  const tables: Record<string, Row[]> = {
    path_cohorts: [...(seed.cohorts ?? [{ id: COHORT, kind: "fw" }])],
    path_program_versions: [...(seed.versions ?? [{ id: VERSION, is_current: true }])],
    path_student_profiles: [...(seed.profiles ?? [])],
    path_families: [...(seed.families ?? [])],
    path_cohort_members: [...(seed.members ?? [])],
    path_fw_released_aliases: [...(seed.releasedAliases ?? [])],
    path_unit_tasks: [...(seed.taskRows ?? TASK_ROWS.map((t) => ({ ...t, program_version_id: VERSION })))],
    path_task_progress: [...(seed.progress ?? [])],
    path_task_events: [],
  };
  const authUsers: Row[] = [...(seed.authUsers ?? [])];
  const outcomes = [...(seed.createUserOutcomes ?? [])];
  let idSeq = 1;
  const calls = { createUser: 0, deleteUser: 0, listUsers: 0, getUserById: 0 };

  function query(table: string) {
    const eqs: [string, unknown][] = [];
    const likes: [string, string][] = [];
    const rows = () =>
      tables[table].filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          // A non-string column value passes the filter rather than being
          // screened out here: the real `like` runs in SQL over a text column,
          // so a malformed value is something the JS side RECEIVES, and the
          // narrowing under test is exactly what happens to it after that.
          likes.every(([c, p]) =>
            typeof r[c] === "string" ? (r[c] as string).startsWith(p.replace(/%$/, "")) : true
          )
      );

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        eqs.push([col, val]);
        return builder;
      },
      like(col: string, pattern: string) {
        likes.push([col, pattern]);
        return builder;
      },
      async maybeSingle() {
        const hit = rows()[0];
        return { data: hit ? { ...hit } : null, error: null };
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve({ data: rows().map((r) => ({ ...r })), error: null }).then(resolve, reject);
      },
      insert(payload: Row) {
        const fail = seed.failTable?.table === table && seed.failTable.op === "insert";
        return {
          select() {
            return {
              async single() {
                if (fail) return { data: null, error: { code: "500", message: seed.failTable!.message } };
                const row = { id: `${table}-${idSeq++}`, ...payload };
                tables[table].push(row);
                return { data: { id: row.id }, error: null };
              },
            };
          },
        };
      },
      upsert(payload: Row | Row[]) {
        const fail = seed.failTable?.table === table && seed.failTable.op === "upsert";
        const list = Array.isArray(payload) ? payload : [payload];
        const apply = () => {
          if (fail) return { data: null, error: { message: seed.failTable!.message } };
          const inserted: Row[] = [];
          for (const r of list) {
            const dup = tables[table].some((x) =>
              table === "path_task_progress"
                ? x.student_id === r.student_id && x.task_id === r.task_id
                : x.student_id === r.student_id && x.cohort_id === r.cohort_id
            );
            if (!dup) {
              tables[table].push({ ...r });
              inserted.push({ ...r });
            }
          }
          return { data: inserted, error: null };
        };
        // `.upsert(...)` is awaited directly for membership, and
        // `.upsert(...).select(...)` for the progress rows.
        return {
          select() {
            return Promise.resolve(apply());
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(apply()).then(resolve, reject);
          },
        };
      },
      delete() {
        return {
          eq(col: string, val: unknown) {
            tables[table] = tables[table].filter((r) => r[col] !== val);
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
          const outcome = outcomes[calls.createUser] ?? { ok: true as const };
          calls.createUser += 1;
          if (outcome.ok === false) {
            if (outcome.landsAnyway) {
              authUsers.push({
                id: `user-${idSeq++}`,
                email: payload.email,
                app_metadata: payload.app_metadata ?? { role: "student" },
              });
            }
            return { data: { user: null }, error: { code: outcome.code, message: outcome.message } };
          }
          if (authUsers.some((u) => u.email === payload.email)) {
            return { data: { user: null }, error: { code: "email_exists", message: "already registered" } };
          }
          const user = {
            id: `user-${idSeq++}`,
            email: payload.email,
            app_metadata: payload.app_metadata ?? { role: "student" },
          };
          authUsers.push(user);
          return { data: { user }, error: null };
        },
        async getUserById(id: string) {
          calls.getUserById += 1;
          const user = authUsers.find((u) => u.id === id);
          return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "not found" } };
        },
        async deleteUser(id: string) {
          calls.deleteUser += 1;
          if (seed.deleteUserError) return { error: { message: seed.deleteUserError } };
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, tables, authUsers, calls };
}

const MAYA = { firstName: "Maya", lastName: "Chen", band: "g6_8" as const, cohortId: COHORT };

/* ══════════════════════════════════════════════════════════════ mint path ══ */

describe("provisionFwStudent — the mint path", () => {
  it("mints account + private family + profile + membership + 125 locked rows", async () => {
    const { db, tables, authUsers } = makeFakeDb({});
    const res = await provisionFwStudent(db, MAYA);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.email).toBe("maya.chen.fw@the120.school");
    expect(res.adopted).toBe(false);

    expect(authUsers).toHaveLength(1);
    expect(authUsers[0].email).toBe("maya.chen.fw@the120.school");
    expect(tables.path_families).toHaveLength(1);

    const profile = tables.path_student_profiles[0];
    expect(profile.child_id).toBeNull();
    expect(profile.first_name).toBe("Maya");
    expect(profile.band).toBe("g6_8");
    expect(profile.normalized_name).toBe("maya chen");
    // FW membership lives in path_cohort_members, never the Path's own column.
    expect(profile.cohort_id).toBeNull();

    expect(tables.path_cohort_members).toEqual([{ student_id: profile.id, cohort_id: COHORT }]);
    expect(tables.path_task_progress).toHaveLength(125);
    expect(tables.path_task_progress.every((r) => r.state === "locked")).toBe(true);
    // The board must open at zero on Friday: materialization writes NO events.
    expect(tables.path_task_events).toHaveLength(0);
  });

  it("records the consent attestation when an attesting adult is supplied", async () => {
    const { db, tables } = makeFakeDb({});
    await provisionFwStudent(db, { ...MAYA, noticeAttestedBy: "guide-1" });
    const profile = tables.path_student_profiles[0];
    expect(profile.notice_attested_by).toBe("guide-1");
    expect(typeof profile.notice_attested_at).toBe("string");
  });

  it("leaves the attestation null when nobody attested", async () => {
    const { db, tables } = makeFakeDb({});
    await provisionFwStudent(db, MAYA);
    expect(tables.path_student_profiles[0].notice_attested_at).toBeNull();
  });

  it("suffixes past an address a fully-provisioned student already holds", async () => {
    const { db, tables } = makeFakeDb({
      authUsers: [
        { id: "user-existing", email: "maya.chen.fw@the120.school", app_metadata: { role: "student" } },
      ],
      profiles: [{ id: "profile-existing", user_id: "user-existing", band: "g3_5" }],
    });
    const res = await provisionFwStudent(db, MAYA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.email).toBe("maya.chen2.fw@the120.school");
    expect(tables.path_student_profiles).toHaveLength(2);
  });

  it("SKIPS an address the released-alias ledger has retired, even though it is free", async () => {
    // Decision 10: the first Maya Chen was anonymized. `maya.chen` is free in
    // auth.users and permanently off the table — a family may still hold that
    // address as a contact channel.
    const { db } = makeFakeDb({ releasedAliases: [{ local_part: "maya.chen" }] });
    const res = await provisionFwStudent(db, MAYA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.email).toBe("maya.chen2.fw@the120.school");
  });

  it("fails CLOSED on a malformed released-alias row rather than re-minting a retired address", async () => {
    const { db, authUsers } = makeFakeDb({ releasedAliases: [{ local_part: 42 }] });
    const res = await provisionFwStudent(db, MAYA);
    expect(res).toEqual({ ok: false, reason: "unavailable" });
    expect(authUsers).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════ the stranded-orphan recovery ══ */

describe("provisionFwStudent — ambiguous createUser failures never burn the clean address", () => {
  it("ADOPTS an orphan account (no profile behind it) instead of suffixing past it", async () => {
    // The scenario: a prior attempt's createUser committed server-side and then
    // the response was lost, so the account exists with nothing behind it.
    // Stepping to maya.chen2 would permanently move the real Maya off her own
    // address for a reason nobody could later reconstruct.
    const { db, tables, authUsers } = makeFakeDb({
      authUsers: [
        { id: "user-orphan", email: "maya.chen.fw@the120.school", app_metadata: { role: "student" } },
      ],
    });
    const res = await provisionFwStudent(db, MAYA);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.email).toBe("maya.chen.fw@the120.school");
    expect(res.userId).toBe("user-orphan");
    expect(authUsers).toHaveLength(1); // adopted, not duplicated
    expect(tables.path_task_progress).toHaveLength(125);
  });

  it("adopts when createUser TIMES OUT but the account actually landed", async () => {
    const { db, authUsers } = makeFakeDb({
      createUserOutcomes: [{ ok: false, message: "fetch failed: timeout", landsAnyway: true }],
    });
    const res = await provisionFwStudent(db, MAYA);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The clean address survives an outage mid-mint — the whole point.
    expect(res.email).toBe("maya.chen.fw@the120.school");
    expect(authUsers).toHaveLength(1);
  });

  it("reports a genuine failure rather than minting a suffix nobody asked for", async () => {
    const { db, tables, authUsers } = makeFakeDb({
      createUserOutcomes: [{ ok: false, message: "service unavailable" }],
    });
    const res = await provisionFwStudent(db, MAYA);
    expect(res).toEqual({ ok: false, reason: "unavailable" });
    expect(authUsers).toHaveLength(0);
    expect(tables.path_student_profiles).toHaveLength(0);
  });

  it("refuses to adopt an account that is not an FW student account", async () => {
    // Defense in depth, mirroring the Path repair path: never take over an
    // account this system did not mint as an FW student.
    const { db } = makeFakeDb({
      authUsers: [
        { id: "user-staff", email: "maya.chen.fw@the120.school", app_metadata: { role: "admin" } },
      ],
    });
    const res = await provisionFwStudent(db, MAYA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.email).toBe("maya.chen2.fw@the120.school");
  });
});

/* ═══════════════════════════════════════════════════ refusals before write ══ */

describe("provisionFwStudent — refusals that must happen before anything is created", () => {
  it("refuses an unknown cohort", async () => {
    const { db, authUsers } = makeFakeDb({ cohorts: [] });
    expect(await provisionFwStudent(db, MAYA)).toEqual({ ok: false, reason: "cohort_not_found" });
    expect(authUsers).toHaveLength(0);
  });

  it("refuses a Path cohort — an FW-shaped student must never land in one", async () => {
    const { db, authUsers } = makeFakeDb({ cohorts: [{ id: COHORT, kind: "path" }] });
    expect(await provisionFwStudent(db, MAYA)).toEqual({ ok: false, reason: "cohort_not_fw" });
    expect(authUsers).toHaveLength(0);
  });

  it("refuses when no program version is current (never a silent fallback)", async () => {
    const { db, authUsers } = makeFakeDb({ versions: [] });
    expect(await provisionFwStudent(db, MAYA)).toEqual({
      ok: false,
      reason: "no_current_program_version",
    });
    expect(authUsers).toHaveLength(0);
  });

  it("refuses an unnameable name", async () => {
    const { db, authUsers } = makeFakeDb({});
    expect(await provisionFwStudent(db, { ...MAYA, firstName: "   " })).toEqual({
      ok: false,
      reason: "invalid_name",
    });
    expect(authUsers).toHaveLength(0);
  });

  it("refuses a homoglyph name rather than minting a near-miss address", async () => {
    // Cyrillic а in "Mаya" — visually identical to Maya in most fonts. Minting
    // m-ya.chen@… for a child the roster shows as "Maya Chen" is unrecoverable.
    const { db, authUsers } = makeFakeDb({});
    expect(await provisionFwStudent(db, { ...MAYA, firstName: "Mаya" })).toEqual({
      ok: false,
      reason: "invalid_name",
    });
    expect(authUsers).toHaveLength(0);
  });
});

/* ════════════════════════════════════════════════ compensation boundaries ══ */

describe("provisionFwStudent — what each failure leaves behind", () => {
  it("family-insert failure deletes the just-minted account (nothing half-formed survives)", async () => {
    const { db, tables, authUsers, calls } = makeFakeDb({
      failTable: { table: "path_families", op: "insert", message: "boom" },
    });
    const res = await provisionFwStudent(db, MAYA);
    expect(res).toEqual({ ok: false, reason: "unavailable" });
    expect(calls.deleteUser).toBe(1);
    expect(authUsers).toHaveLength(0);
    expect(tables.path_student_profiles).toHaveLength(0);
  });

  it("profile-insert failure deletes BOTH the account and the private family", async () => {
    const { db, tables, authUsers } = makeFakeDb({
      failTable: { table: "path_student_profiles", op: "insert", message: "boom" },
    });
    const res = await provisionFwStudent(db, MAYA);
    expect(res).toEqual({ ok: false, reason: "unavailable" });
    expect(authUsers).toHaveLength(0);
    expect(tables.path_families).toHaveLength(0);
  });

  it("membership failure KEEPS the profile and returns its id for retry-in-place", async () => {
    // Decision 13: a kid standing at the table is never handed a tree that
    // cannot accept taps — and never has a good account thrown away either.
    const { db, tables, authUsers } = makeFakeDb({
      failTable: { table: "path_cohort_members", op: "upsert", message: "boom" },
    });
    const res = await provisionFwStudent(db, MAYA);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("membership_failed");
    expect(res.profileId).toBe(tables.path_student_profiles[0].id);
    expect(authUsers).toHaveLength(1);
  });

  it("materialization failure KEEPS the profile and returns its id", async () => {
    const { db, tables } = makeFakeDb({
      failTable: { table: "path_task_progress", op: "upsert", message: "boom" },
    });
    const res = await provisionFwStudent(db, MAYA);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("materialization_failed");
    expect(res.profileId).toBe(tables.path_student_profiles[0].id);
  });

  it("a compensation that itself fails is swallowed, not thrown — the caller still gets its reason", async () => {
    const { db } = makeFakeDb({
      failTable: { table: "path_families", op: "insert", message: "boom" },
      deleteUserError: "auth api down",
    });
    await expect(provisionFwStudent(db, MAYA)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

/* ═════════════════════════════════════════════════════════ the resume path ══ */

describe("provisionFwStudent — the resume path trusts the row, not the caller", () => {
  function seedFwStudent() {
    return makeFakeDb({
      authUsers: [
        { id: "user-maya", email: "maya.chen.fw@the120.school", app_metadata: { role: "student" } },
      ],
      profiles: [
        {
          id: "profile-maya",
          user_id: "user-maya",
          child_id: null,
          first_name: "Maya",
          last_name: "Chen",
          band: "g6_8",
          program_version_id: VERSION,
        },
      ],
    });
  }

  it("completes the remaining legs without minting a second account", async () => {
    const { db, tables, calls } = seedFwStudent();
    const res = await provisionFwStudent(db, { ...MAYA, existingProfileId: "profile-maya" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.adopted).toBe(true);
    expect(res.profileId).toBe("profile-maya");
    // The REAL address, not a placeholder that would read as "cleared to send".
    expect(res.email).toBe("maya.chen.fw@the120.school");
    expect(calls.createUser).toBe(0);
    expect(tables.path_cohort_members).toHaveLength(1);
    expect(tables.path_task_progress).toHaveLength(125);
  });

  it("is idempotent — a second resume adds no duplicate membership or progress rows", async () => {
    const { db, tables } = seedFwStudent();
    await provisionFwStudent(db, { ...MAYA, existingProfileId: "profile-maya" });
    await provisionFwStudent(db, { ...MAYA, existingProfileId: "profile-maya" });
    expect(tables.path_cohort_members).toHaveLength(1);
    expect(tables.path_task_progress).toHaveLength(125);
  });

  it("REFUSES a Path student's profile id — and writes no membership row", async () => {
    // Without the shape gate this enrolls a real Path child in a weekend they
    // are not attending, and the membership row is never compensated.
    const { db, tables } = makeFakeDb({
      authUsers: [{ id: "user-path", email: "s-abc@students.the120.invalid", app_metadata: { role: "student" } }],
      profiles: [{ id: "profile-path", user_id: "user-path", child_id: "child-1", band: null }],
    });
    const res = await provisionFwStudent(db, { ...MAYA, existingProfileId: "profile-path" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_fw_profile");
    expect(tables.path_cohort_members).toHaveLength(0);
    expect(tables.path_task_progress).toHaveLength(0);
  });

  it("REFUSES a different FW student — the case the shape gate cannot see", async () => {
    // profile-maya is FW-shaped and banded, so only a name comparison catches
    // that the caller resolved the wrong child. Without it this returns ok:true
    // naming Liam while the guide believes they just resumed Maya.
    const { db, tables } = seedFwStudent();
    const res = await provisionFwStudent(db, {
      ...MAYA,
      firstName: "Liam",
      lastName: "Rodriguez",
      existingProfileId: "profile-maya",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("identity_mismatch");
    expect(tables.path_cohort_members).toHaveLength(0);
  });

  it("accepts an accent/separator variant of the same name (guide-typing variance)", async () => {
    const { db } = makeFakeDb({
      authUsers: [{ id: "u", email: "jose.pena.fw@the120.school", app_metadata: { role: "student" } }],
      profiles: [
        {
          id: "p",
          user_id: "u",
          child_id: null,
          first_name: "José",
          last_name: "Peña",
          band: "g6_8",
          program_version_id: VERSION,
        },
      ],
    });
    const res = await provisionFwStudent(db, {
      firstName: "Jose",
      lastName: "Pena",
      band: "g6_8",
      cohortId: COHORT,
      existingProfileId: "p",
    });
    expect(res.ok).toBe(true);
  });

  it("refuses when the resume target's auth account is gone", async () => {
    const { db, tables } = makeFakeDb({
      authUsers: [],
      profiles: [
        {
          id: "profile-maya",
          user_id: "user-vanished",
          child_id: null,
          first_name: "Maya",
          last_name: "Chen",
          band: "g6_8",
          program_version_id: VERSION,
        },
      ],
    });
    const res = await provisionFwStudent(db, { ...MAYA, existingProfileId: "profile-maya" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("account_missing");
    expect(tables.path_cohort_members).toHaveLength(0);
  });

  it("refuses an unknown profile id", async () => {
    const { db } = makeFakeDb({});
    expect(await provisionFwStudent(db, { ...MAYA, existingProfileId: "nope" })).toEqual({
      ok: false,
      reason: "profile_not_found",
    });
  });
});

/* ═══════════════════════════════════════════════ ensureFwStudentProgress ══ */

describe("ensureFwStudentProgress", () => {
  const fwProfile = {
    id: "profile-maya",
    user_id: "user-maya",
    child_id: null,
    band: "g6_8",
    program_version_id: VERSION,
  };

  it("materializes exactly 125 locked rows and writes ZERO events", async () => {
    const { db, tables } = makeFakeDb({ profiles: [fwProfile] });
    const res = await ensureFwStudentProgress(db, { profileId: "profile-maya" });
    expect(res).toEqual({ ok: true, created: 125 });
    expect(tables.path_task_progress).toHaveLength(125);
    expect(tables.path_task_progress.every((r) => r.state === "locked")).toBe(true);
    expect(tables.path_task_progress.every((r) => r.snapshot_band === null)).toBe(true);
    // The Path materializer writes ~25 `unlock` events here. FW promotes
    // nothing, so the log the projected board reads stays empty until the first
    // guide tap.
    expect(tables.path_task_events).toHaveLength(0);
  });

  it("is idempotent — a re-run creates nothing and never resets a student", async () => {
    const { db, tables } = makeFakeDb({ profiles: [fwProfile] });
    await ensureFwStudentProgress(db, { profileId: "profile-maya" });
    const second = await ensureFwStudentProgress(db, { profileId: "profile-maya" });
    expect(second).toEqual({ ok: true, created: 0 });
    expect(tables.path_task_progress).toHaveLength(125);
  });

  it("fails CLOSED on a profile with no band — a Path student is not FW-shaped", async () => {
    // This is the guard that stops a Path student mid-journey from being
    // overwritten with 125 locked rows.
    const { db, tables } = makeFakeDb({
      profiles: [{ id: "p", child_id: "child-1", band: null, program_version_id: VERSION }],
    });
    expect(await ensureFwStudentProgress(db, { profileId: "p" })).toEqual({
      ok: false,
      reason: "no_band",
    });
    expect(tables.path_task_progress).toHaveLength(0);
  });

  it("refuses an unknown profile", async () => {
    const { db } = makeFakeDb({});
    expect(await ensureFwStudentProgress(db, { profileId: "nope" })).toEqual({
      ok: false,
      reason: "profile_not_found",
    });
  });

  it("refuses when the content seed has not run", async () => {
    const { db } = makeFakeDb({ profiles: [fwProfile], taskRows: [] });
    expect(await ensureFwStudentProgress(db, { profileId: "profile-maya" })).toEqual({
      ok: false,
      reason: "no_content",
    });
  });

  it("carries each task's TRUE criterion onto its progress row", async () => {
    const { db, tables } = makeFakeDb({ profiles: [fwProfile] });
    await ensureFwStudentProgress(db, { profileId: "profile-maya" });
    const byTask = new Map(TASK_ROWS.map((t) => [t.task_id, t.criterion_id]));
    expect(tables.path_task_progress.every((r) => byTask.get(r.task_id as string) === r.criterion_id)).toBe(true);
  });
});
