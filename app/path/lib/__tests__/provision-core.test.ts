import { describe, expect, it } from "vitest";

import {
  ensurePathFamilyForParent,
  provisionStudent,
  resetFailureMessage,
  resetStudentPassword,
} from "../provision-core";
import { deriveStudentEmail } from "../provision-rules";

/**
 * Fake Supabase client (the WebhookFakeDb pattern) — provisionStudent /
 * resetStudentPassword are the load-bearing partial-failure logic of Unit 6 and
 * cannot be reached by the pure-rules tests. This in-memory double exercises the
 * exact call chains they use (a query builder + the auth admin API) so the
 * repair-on-email-exists, concurrent-adopt, and fail-closed branches are pinned.
 */

type Row = Record<string, unknown>;
const STRONG_PW = "orbit ladder 77";

type Seed = {
  children?: Row[];
  path_families?: Row[];
  path_program_versions?: Row[];
  path_student_profiles?: Row[];
  path_role_grants?: Row[];
  authUsers?: Row[];
  createUserError?: { code?: string; message: string } | null;
  /** When createUser returns its seeded error, ALSO insert this profile row —
   *  models a concurrent co-parent whose profile lands mid-createUser. */
  profileLandsOnConflict?: Row | null;
};

function makeFakeDb(seed: Seed) {
  const tables: Record<string, Row[]> = {
    children: [...(seed.children ?? [])],
    path_families: [...(seed.path_families ?? [])],
    path_program_versions: [...(seed.path_program_versions ?? [])],
    path_student_profiles: [...(seed.path_student_profiles ?? [])],
    path_role_grants: [...(seed.path_role_grants ?? [])],
  };
  const authUsers: Row[] = [...(seed.authUsers ?? [])];
  let idSeq = 1;
  const calls = { createUser: 0, updateUserById: 0, profileInserts: 0 };

  function query(table: string) {
    const filters: [string, unknown][] = [];
    let selectCols = "";
    const builder = {
      select(cols: string) {
        selectCols = cols;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return builder;
      },
      order() {
        return builder;
      },
      _match(): Row | undefined {
        return tables[table].find((r) => filters.every(([c, v]) => r[c] === v));
      },
      _project(row: Row): Row {
        if (selectCols.includes("children")) {
          const child = tables.children.find((c) => c.id === row.child_id);
          return child ? { ...row, children: { first_name: child.first_name } } : { ...row };
        }
        return { ...row };
      },
      async maybeSingle() {
        const row = builder._match();
        return { data: row ? builder._project(row) : null, error: null };
      },
      // The PostgREST builder is thenable — a multi-row select is awaited
      // directly (the ownership gate's grants query does exactly that).
      then(
        resolve: (v: { data: Row[]; error: null }) => unknown,
        reject?: (e: unknown) => unknown
      ) {
        const rows = tables[table]
          .filter((r) => filters.every(([c, v]) => r[c] === v))
          .map((r) => builder._project(r));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
      insert(payload: Row) {
        return {
          select() {
            return {
              async single() {
                if (table === "path_student_profiles") {
                  calls.profileInserts++;
                  if (tables[table].some((r) => r.child_id === payload.child_id)) {
                    return { data: null, error: { code: "23505", message: "duplicate key" } };
                  }
                }
                const row = { id: `id-${idSeq++}`, ...payload };
                tables[table].push(row);
                return { data: { id: row.id }, error: null };
              },
            };
          },
        };
      },
      upsert(rows: Row[]) {
        for (const r of rows) {
          const dup = tables[table].some(
            (x) =>
              x.user_id === r.user_id &&
              x.role === r.role &&
              x.scope_type === r.scope_type &&
              x.scope_id === r.scope_id
          );
          if (!dup) tables[table].push(r);
        }
        return Promise.resolve({ error: null });
      },
    };
    return builder;
  }

  const db = {
    from: (table: string) => query(table),
    auth: {
      admin: {
        async createUser(payload: { email: string; password: string; app_metadata?: Row }) {
          calls.createUser++;
          if (seed.createUserError) {
            if (seed.profileLandsOnConflict) {
              tables.path_student_profiles.push({ ...seed.profileLandsOnConflict });
            }
            return { data: { user: null }, error: seed.createUserError };
          }
          const user = {
            id: `user-${idSeq++}`,
            email: payload.email,
            app_metadata: payload.app_metadata ?? {},
          };
          authUsers.push(user);
          return { data: { user }, error: null };
        },
        async updateUserById(id: string, attrs: { password?: string }) {
          calls.updateUserById++;
          const u = authUsers.find((x) => x.id === id);
          if (!u) return { data: { user: null }, error: { message: "not found" } };
          if (attrs.password) u.password = attrs.password;
          return { data: { user: u }, error: null };
        },
        async listUsers() {
          return { data: { users: authUsers }, error: null };
        },
      },
    },
  };
  return { db: db as never, tables, authUsers, calls };
}

const PARENT_USER = "parent-user-1";
const CHILD = { id: "child-1", first_name: "Maya", grade: 4, parent_id: PARENT_USER };
const FAMILY = { id: "fam-1" };
const VERSION = { id: "2026-27", is_current: true };
/** The family's parent grant — what the ownership hard gate checks against. */
const PARENT_GRANT = {
  user_id: PARENT_USER,
  role: "parent",
  scope_type: "family",
  scope_id: "fam-1",
};

function baseSeed(over: Partial<Seed> = {}): Seed {
  return {
    children: [{ ...CHILD }],
    path_families: [{ ...FAMILY }],
    path_program_versions: [{ ...VERSION }],
    path_role_grants: [{ ...PARENT_GRANT }],
    ...over,
  };
}

describe("provisionStudent — happy path", () => {
  it("creates the auth user, the version-pinned profile, and the two grants", async () => {
    const { db, tables } = makeFakeDb(baseSeed());
    const result = await provisionStudent(db, {
      childId: "child-1",
      familyId: "fam-1",
      password: STRONG_PW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repaired).toBe(false);

    const profile = tables.path_student_profiles[0];
    expect(profile.child_id).toBe("child-1");
    expect(profile.family_id).toBe("fam-1");
    expect(profile.program_version_id).toBe("2026-27"); // D27 pin from is_current
    expect(profile.user_id).toBe(result.userId);

    // The seeded parent grant stays; provisioning ADDS exactly the two student grants.
    expect(tables.path_role_grants.filter((g) => g.role === "student")).toEqual([
      { user_id: result.userId, role: "student", scope_type: "student", scope_id: result.profileId },
      { user_id: result.userId, role: "student", scope_type: "family", scope_id: "fam-1" },
    ]);
  });
});

describe("provisionStudent — refusals", () => {
  it("refuses a nameless roster child (F4: would mint a permanently unreachable account)", async () => {
    const { db, calls } = makeFakeDb(baseSeed({ children: [{ id: "child-1", first_name: "   " }] }));
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "child_name_missing" });
    expect(calls.createUser).toBe(0); // refused BEFORE minting anything
  });

  it("refuses a missing child", async () => {
    const { db } = makeFakeDb(baseSeed({ children: [] }));
    const result = await provisionStudent(db, { childId: "nope", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "child_not_found" });
  });

  it("refuses a weak password before any write", async () => {
    const { db, calls } = makeFakeDb(baseSeed());
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: "short" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("weak_password");
    expect(calls.createUser).toBe(0);
  });

  it("refuses when no program version is current (fail-closed, never a silent default)", async () => {
    const { db } = makeFakeDb(baseSeed({ path_program_versions: [] }));
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "no_current_program_version" });
  });

  it("refuses a missing family", async () => {
    const { db } = makeFakeDb(baseSeed({ path_families: [] }));
    const result = await provisionStudent(db, { childId: "child-1", familyId: "nope", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "family_not_found" });
  });

  it("refuses a child that already has a profile", async () => {
    const { db } = makeFakeDb(
      baseSeed({
        path_student_profiles: [
          { id: "p-0", user_id: "u-0", child_id: "child-1", family_id: "fam-1", program_version_id: "2026-27" },
        ],
      })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "already_provisioned" });
  });
});

describe("provisionStudent — the ownership hard gate (Unit 15, security P1)", () => {
  it("refuses a child whose CRM parent is OUTSIDE the family — the roster-squat the gate exists to stop", async () => {
    const { db, calls, tables } = makeFakeDb(
      baseSeed({
        children: [{ id: "child-1", first_name: "Maya", grade: 4, parent_id: "someone-else" }],
      })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "child_not_in_family" });
    expect(calls.createUser).toBe(0); // refused BEFORE minting anything
    expect(tables.path_student_profiles).toHaveLength(0);
  });

  it("refuses when the family has no parent grants at all (fail closed)", async () => {
    const { db, calls } = makeFakeDb(baseSeed({ path_role_grants: [] }));
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "child_not_in_family" });
    expect(calls.createUser).toBe(0);
  });

  it("refuses a child with a NULL parent_id (fail closed on a corrupt roster row)", async () => {
    const { db } = makeFakeDb(
      baseSeed({ children: [{ id: "child-1", first_name: "Maya", grade: 4, parent_id: null }] })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "child_not_in_family" });
  });

  it("a SECOND parent of the same family provisions fine — the check keys on the CHILD's parent, not the caller", async () => {
    // The invited co-parent holds a grant too, but the child's parent_id still
    // points at the primary CRM parent; ownership passes via the primary's grant.
    const { db } = makeFakeDb(
      baseSeed({
        path_role_grants: [
          { ...PARENT_GRANT },
          { user_id: "co-parent", role: "parent", scope_type: "family", scope_id: "fam-1" },
        ],
      })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result.ok).toBe(true);
  });

  it("a STUDENT family grant does not satisfy the gate (role must be parent)", async () => {
    const { db } = makeFakeDb(
      baseSeed({
        path_role_grants: [
          { user_id: PARENT_USER, role: "student", scope_type: "family", scope_id: "fam-1" },
        ],
      })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "child_not_in_family" });
  });
});

describe("provisionStudent — grade refusals (Unit 15: refuse, never default)", () => {
  it("refuses a null-grade child with a SPECIFIC reason before any write", async () => {
    const { db, calls } = makeFakeDb(
      baseSeed({ children: [{ id: "child-1", first_name: "Maya", grade: null, parent_id: PARENT_USER }] })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "child_grade_missing" });
    expect(calls.createUser).toBe(0);
  });

  it("refuses an out-of-range grade distinctly (no band exists for grade 1)", async () => {
    const { db, calls } = makeFakeDb(
      baseSeed({ children: [{ id: "child-1", first_name: "Tot", grade: 1, parent_id: PARENT_USER }] })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "child_grade_out_of_range" });
    expect(calls.createUser).toBe(0);
  });

  it("an already-provisioned child reads already_provisioned even if their grade was later nulled", async () => {
    const { db } = makeFakeDb(
      baseSeed({
        children: [{ id: "child-1", first_name: "Maya", grade: null, parent_id: PARENT_USER }],
        path_student_profiles: [
          { id: "p-0", user_id: "u-0", child_id: "child-1", family_id: "fam-1", program_version_id: "2026-27" },
        ],
      })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "already_provisioned" });
  });
});

describe("provisionStudent — D27 version-pin divergence (second child mid-year)", () => {
  it("a sibling provisioned after a revision pins the NEWER version; the first child's pin and rows are untouched", async () => {
    const { db, tables } = makeFakeDb(
      baseSeed({
        children: [
          { ...CHILD },
          { id: "child-2", first_name: "Dev", grade: 7, parent_id: PARENT_USER },
        ],
      })
    );
    const first = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(first.ok).toBe(true);

    // A content revision ships between the two provisionings.
    tables.path_program_versions[0].is_current = false;
    tables.path_program_versions.push({ id: "2027-28", is_current: true });

    const firstProfileSnapshot = JSON.stringify(
      tables.path_student_profiles.find((p) => p.child_id === "child-1")
    );

    const second = await provisionStudent(db, { childId: "child-2", familyId: "fam-1", password: STRONG_PW });
    expect(second.ok).toBe(true);

    const p1 = tables.path_student_profiles.find((p) => p.child_id === "child-1");
    const p2 = tables.path_student_profiles.find((p) => p.child_id === "child-2");
    expect(p1?.program_version_id).toBe("2026-27"); // the first child keeps their pin
    expect(p2?.program_version_id).toBe("2027-28"); // the sibling pins the newer version
    expect(JSON.stringify(p1)).toBe(firstProfileSnapshot); // byte-identical — undisturbed
  });
});

describe("provisionStudent — repair path (F16 / F10)", () => {
  it("completes a STRANDED run: user exists, no profile → resets password and lands the profile", async () => {
    const email = deriveStudentEmail("child-1");
    const { db, calls } = makeFakeDb(
      baseSeed({
        authUsers: [{ id: "stranded-user", email, app_metadata: { role: "student" } }],
        createUserError: { code: "email_exists", message: "already registered" },
      })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repaired).toBe(true);
    expect(result.userId).toBe("stranded-user");
    expect(calls.updateUserById).toBe(1); // password re-set to current intent
  });

  it("a CONCURRENT co-parent whose profile lands mid-createUser is refused, NOT clobbered", async () => {
    const email = deriveStudentEmail("child-1");
    const { db, calls } = makeFakeDb(
      baseSeed({
        authUsers: [{ id: "winner-user", email, app_metadata: { role: "student" } }],
        createUserError: { code: "email_exists", message: "already registered" },
        // The winner's profile appears exactly when our createUser hits email_exists,
        // so our step-2 probe was empty but the repair RE-PROBE finds it.
        profileLandsOnConflict: {
          id: "p-win",
          user_id: "winner-user",
          child_id: "child-1",
          family_id: "fam-1",
          program_version_id: "2026-27",
        },
      })
    );
    const result = await provisionStudent(db, {
      childId: "child-1",
      familyId: "fam-1",
      password: "different pw 999",
    });
    expect(result).toEqual({ ok: false, reason: "already_provisioned" });
    expect(calls.updateUserById).toBe(0); // the winner's password is NEVER overwritten
  });

  it("refuses to adopt a non-student account on the repair path (F10 defense in depth)", async () => {
    const email = deriveStudentEmail("child-1");
    const { db, calls } = makeFakeDb(
      baseSeed({
        authUsers: [{ id: "someone", email, app_metadata: { role: "admin" } }],
        createUserError: { code: "email_exists", message: "already registered" },
      })
    );
    const result = await provisionStudent(db, { childId: "child-1", familyId: "fam-1", password: STRONG_PW });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(calls.updateUserById).toBe(0);
  });
});

describe("ensurePathFamilyForParent (the R31 linkage helper)", () => {
  it("ADOPTS the family an existing parent grant points at — never mints a second", async () => {
    const { db, tables } = makeFakeDb(baseSeed());
    const before = tables.path_families.length;
    const result = await ensurePathFamilyForParent(db, { userId: PARENT_USER });
    expect(result).toEqual({ ok: true, familyId: "fam-1", created: false });
    expect(tables.path_families).toHaveLength(before); // no new family row
  });

  it("creates a family + grant for a parent with no grant yet", async () => {
    const { db, tables } = makeFakeDb(baseSeed({ path_role_grants: [] }));
    const result = await ensurePathFamilyForParent(db, { userId: "new-parent" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(
      tables.path_role_grants.some(
        (g) =>
          g.user_id === "new-parent" &&
          g.role === "parent" &&
          g.scope_type === "family" &&
          g.scope_id === result.familyId
      )
    ).toBe(true);
  });

  it("is idempotent: a re-run adopts the family the first run created", async () => {
    const { db, tables } = makeFakeDb(baseSeed({ path_role_grants: [] }));
    const first = await ensurePathFamilyForParent(db, { userId: "new-parent" });
    expect(first.ok).toBe(true);
    const familiesAfterFirst = tables.path_families.length;
    const second = await ensurePathFamilyForParent(db, { userId: "new-parent" });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.familyId).toBe(first.familyId);
    expect(second.created).toBe(false);
    expect(tables.path_families).toHaveLength(familiesAfterFirst); // still one
  });
});

describe("resetStudentPassword", () => {
  it("re-validates the floor and refuses a weak password without touching auth", async () => {
    const { db, calls } = makeFakeDb(baseSeed({ authUsers: [{ id: "u-1", email: "x" }] }));
    const result = await resetStudentPassword(db, { userId: "u-1", newPassword: "short", studentName: "Maya" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("weak_password");
    expect(calls.updateUserById).toBe(0);
  });

  it("sets a strong password with no email round-trip", async () => {
    const { db, authUsers } = makeFakeDb(baseSeed({ authUsers: [{ id: "u-1", email: "x" }] }));
    const result = await resetStudentPassword(db, { userId: "u-1", newPassword: STRONG_PW, studentName: "Maya" });
    expect(result).toEqual({ ok: true });
    expect(authUsers[0].password).toBe(STRONG_PW);
  });
});

describe("resetFailureMessage", () => {
  it("surfaces the specific floor message for weak_password, generic otherwise", () => {
    expect(resetFailureMessage({ ok: false, reason: "weak_password", message: "too short!" })).toBe(
      "too short!"
    );
    expect(resetFailureMessage({ ok: false, reason: "unavailable" })).toMatch(/reset failed/i);
  });
});
