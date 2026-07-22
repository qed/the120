import { describe, expect, it } from "vitest";

import {
  isPathRole,
  isPathScope,
  parseRoleGrant,
  PATH_ROLES,
  PATH_SCOPES,
  resolvePathAccess,
  type AccessTarget,
  type RoleGrant,
  type SessionLike,
  type TargetKind,
} from "../access-rules";

const SESSION: SessionLike = { user: { id: "u1" } };

/** A target owned by student sA, in family fam1, cohort coh1. */
function target(kind: TargetKind, over: Partial<AccessTarget> = {}): AccessTarget {
  return { kind, studentId: "sA", familyId: "fam1", cohortId: "coh1", ...over };
}

const KINDS: TargetKind[] = ["profile", "evidence", "position"];

// The two grants a student is provisioned with (Unit 6): self + family membership.
const studentGrants = (studentId: string, familyId: string): RoleGrant[] => [
  { role: "student", scopeType: "student", scopeId: studentId },
  { role: "student", scopeType: "family", scopeId: familyId },
];

describe("resolvePathAccess — self (student)", () => {
  it("a student resolves ok for their own profile, evidence, and position", () => {
    const grants = studentGrants("sA", "fam1");
    for (const kind of KINDS) {
      expect(resolvePathAccess({ session: SESSION, grants, target: target(kind) })).toBe("ok");
    }
  });

  it("a student cannot reach a DIFFERENT student's profile or evidence", () => {
    const grants = studentGrants("sA", "fam1");
    // Same family sibling — profile/evidence are forbidden (see sibling tests for position).
    const sib = target("evidence", { studentId: "sB" });
    expect(resolvePathAccess({ session: SESSION, grants, target: sib })).toBe("forbidden");
    expect(
      resolvePathAccess({ session: SESSION, grants, target: { ...sib, kind: "profile" } })
    ).toBe("forbidden");
  });
});

describe("resolvePathAccess — parent (R4)", () => {
  const parent: RoleGrant[] = [{ role: "parent", scopeType: "family", scopeId: "fam1" }];

  it("either parent resolves ok for any student in the family, any kind", () => {
    for (const studentId of ["sA", "sB"]) {
      for (const kind of KINDS) {
        expect(
          resolvePathAccess({ session: SESSION, grants: parent, target: target(kind, { studentId }) })
        ).toBe("ok");
      }
    }
  });

  it("a parent of another family is forbidden", () => {
    const other = target("evidence", { familyId: "fam2" });
    expect(resolvePathAccess({ session: SESSION, grants: parent, target: other })).toBe("forbidden");
  });
});

describe("resolvePathAccess — Guide (D25)", () => {
  const guide: RoleGrant[] = [{ role: "guide", scopeType: "cohort", scopeId: "coh1" }];

  it("a Guide resolves ok for a cohort student's evidence at any time", () => {
    for (const kind of KINDS) {
      expect(resolvePathAccess({ session: SESSION, grants: guide, target: target(kind) })).toBe("ok");
    }
  });

  it("a Guide resolves forbidden for a student in a different cohort", () => {
    const otherCohort = target("evidence", { cohortId: "coh2" });
    expect(resolvePathAccess({ session: SESSION, grants: guide, target: otherCohort })).toBe(
      "forbidden"
    );
  });

  it("a Guide cannot reach a student with no cohort (null never matches)", () => {
    const unassigned = target("evidence", { cohortId: null });
    expect(resolvePathAccess({ session: SESSION, grants: guide, target: unassigned })).toBe(
      "forbidden"
    );
  });
});

describe("resolvePathAccess — sibling (R5 carve-out)", () => {
  // Caller is student sB, a member of fam1; the target is their sibling sA in fam1.
  const sibling = studentGrants("sB", "fam1");

  it("a sibling resolves ok for position and awards", () => {
    expect(resolvePathAccess({ session: SESSION, grants: sibling, target: target("position") })).toBe(
      "ok"
    );
  });

  it("a sibling resolves forbidden for evidence and profile", () => {
    expect(resolvePathAccess({ session: SESSION, grants: sibling, target: target("evidence") })).toBe(
      "forbidden"
    );
    expect(resolvePathAccess({ session: SESSION, grants: sibling, target: target("profile") })).toBe(
      "forbidden"
    );
  });

  it("does not grant position across families (a different family's position is forbidden)", () => {
    const otherFamily = target("position", { studentId: "sX", familyId: "fam2" });
    expect(resolvePathAccess({ session: SESSION, grants: sibling, target: otherFamily })).toBe(
      "forbidden"
    );
  });
});

describe("resolvePathAccess — dual role resolves per scope, never global", () => {
  const dual: RoleGrant[] = [
    { role: "parent", scopeType: "family", scopeId: "fam1" },
    { role: "guide", scopeType: "cohort", scopeId: "coh1" },
  ];

  it("ok as parent within their own family — isolated so ONLY the parent branch can fire", () => {
    // cohortId deliberately does NOT match the dual grant's guide/cohort scope, so
    // this proves "ok via the parent/family scope" specifically (not merely "ok
    // because the guide grant also happens to cover this target").
    expect(
      resolvePathAccess({
        session: SESSION,
        grants: dual,
        target: target("evidence", { familyId: "fam1", cohortId: "coh-other" }),
      })
    ).toBe("ok");
  });

  it("ok as Guide within their own cohort even in another family", () => {
    const cohortStudentElsewhere = target("evidence", { familyId: "fam2", cohortId: "coh1" });
    expect(resolvePathAccess({ session: SESSION, grants: dual, target: cohortStudentElsewhere })).toBe(
      "ok"
    );
  });

  it("forbidden where neither scope applies — NOT treated as a global parent or Guide", () => {
    const elsewhere = target("evidence", { familyId: "fam2", cohortId: "coh2" });
    expect(resolvePathAccess({ session: SESSION, grants: dual, target: elsewhere })).toBe("forbidden");
  });
});

describe("resolvePathAccess — no session and defensive cases", () => {
  it("no session resolves login, never forbidden", () => {
    for (const kind of KINDS) {
      expect(resolvePathAccess({ session: null, grants: [], target: target(kind) })).toBe("login");
    }
    // Even with grants present but no session, it is login (drives redirect, not 404).
    expect(
      resolvePathAccess({ session: null, grants: studentGrants("sA", "fam1"), target: target("evidence") })
    ).toBe("login");
  });

  it("a grant referencing a deleted cohort resolves forbidden, not a throw", () => {
    const staleGuide: RoleGrant[] = [{ role: "guide", scopeType: "cohort", scopeId: "coh-deleted" }];
    // Target sits in a live, different cohort — the stale id simply fails to match.
    expect(() =>
      resolvePathAccess({ session: SESSION, grants: staleGuide, target: target("evidence") })
    ).not.toThrow();
    expect(resolvePathAccess({ session: SESSION, grants: staleGuide, target: target("evidence") })).toBe(
      "forbidden"
    );
    // And against a now-null cohort target, still forbidden, still no throw.
    expect(
      resolvePathAccess({ session: SESSION, grants: staleGuide, target: target("evidence", { cohortId: null }) })
    ).toBe("forbidden");
  });

  it("an empty grant set resolves forbidden (a session with no Path grants is not a member)", () => {
    expect(resolvePathAccess({ session: SESSION, grants: [], target: target("evidence") })).toBe(
      "forbidden"
    );
  });

  it("a scope-id match under the WRONG role does not grant access", () => {
    // A guide grant whose scopeId happens to equal the family id must not act as a parent,
    // and a parent grant must not satisfy a cohort match — role is part of the key.
    const crossed: RoleGrant[] = [
      { role: "guide", scopeType: "family", scopeId: "fam1" }, // wrong scopeType for a guide
      { role: "parent", scopeType: "cohort", scopeId: "coh1" }, // wrong scopeType for a parent
    ];
    expect(resolvePathAccess({ session: SESSION, grants: crossed, target: target("evidence") })).toBe(
      "forbidden"
    );
  });

  it("a shared id across roles — a Guide grant reads cohortId, never familyId", () => {
    // Proves the Guide branch keys on the COHORT id (not the family id) even when
    // the same value appears as both: a guide grant is authorized where cohortId
    // matches, and forbidden for a position target that shares only the familyId.
    // (This catches a field-selection bug; scopeType disambiguation is proven by
    // the SAME-ROLE test below, which a role change here would mask.)
    const SHARED = "shared-id";
    const guideOnly: RoleGrant[] = [{ role: "guide", scopeType: "cohort", scopeId: SHARED }];
    expect(
      resolvePathAccess({ session: SESSION, grants: guideOnly, target: target("evidence", { cohortId: SHARED }) })
    ).toBe("ok");
    expect(
      resolvePathAccess({
        session: SESSION,
        grants: guideOnly,
        target: target("position", { familyId: SHARED, cohortId: "coh-x" }),
      })
    ).toBe("forbidden");
  });

  it("scopeType disambiguates a SAME-role shared id (self grant is not a family grant)", () => {
    // The precise invariant test: a student's SELF grant {student,student,X} must
    // NOT satisfy the sibling branch, which needs {student,family,target.familyId}.
    // Role is identical (student) and scopeId collides (X), so ONLY the scopeType
    // check in has() forbids it — drop that check and this position target leaks.
    const selfGrant: RoleGrant[] = [{ role: "student", scopeType: "student", scopeId: "shared" }];
    const siblingPosition = target("position", { studentId: "someone-else", familyId: "shared" });
    expect(resolvePathAccess({ session: SESSION, grants: selfGrant, target: siblingPosition })).toBe(
      "forbidden"
    );
  });

  it("an empty-string scope id is an exact value, not a wildcard", () => {
    const emptyParent: RoleGrant[] = [{ role: "parent", scopeType: "family", scopeId: "" }];
    // A real target is not matched by an empty-string grant...
    expect(resolvePathAccess({ session: SESSION, grants: emptyParent, target: target("evidence") })).toBe(
      "forbidden"
    );
    // ...and it matches only a target whose familyId is literally "" (=== equality).
    expect(
      resolvePathAccess({ session: SESSION, grants: emptyParent, target: target("evidence", { familyId: "" }) })
    ).toBe("ok");
  });

  it("does NOT filter by the session user — it trusts grants are pre-scoped to the caller", () => {
    // Documents the load-bearing trust boundary (see the module header):
    // resolvePathAccess never reads session.user.id. Grants that authorize student
    // sZ resolve "ok" for sZ EVEN THOUGH the session user is someone else — because
    // auth.ts is solely responsible for only ever passing the caller's OWN grants
    // (via `.eq("user_id", user.id)`). If this expectation ever needs to change,
    // that grant-loading query's scoping is the thing that must be re-verified.
    const foreignGrants = studentGrants("sZ", "famZ");
    const sessionForSomeoneElse: SessionLike = { user: { id: "a-different-user" } };
    expect(
      resolvePathAccess({
        session: sessionForSomeoneElse,
        grants: foreignGrants,
        target: target("evidence", { studentId: "sZ", familyId: "famZ" }),
      })
    ).toBe("ok");
  });
});

describe("parseRoleGrant + guards — fail-closed narrowing of untyped rows", () => {
  it("isPathRole / isPathScope accept only their closed set", () => {
    for (const r of PATH_ROLES) expect(isPathRole(r)).toBe(true);
    for (const s of PATH_SCOPES) expect(isPathScope(s)).toBe(true);
    for (const bad of ["admin", "", "GUIDE", "families", null, undefined, 3, {}]) {
      expect(isPathRole(bad)).toBe(false);
      expect(isPathScope(bad)).toBe(false);
    }
  });

  it("parses a well-formed row into a RoleGrant, renaming snake_case → camelCase", () => {
    expect(parseRoleGrant({ role: "parent", scope_type: "family", scope_id: "fam1" })).toEqual({
      role: "parent",
      scopeType: "family",
      scopeId: "fam1",
    });
  });

  it("DROPS (returns null) a row with an out-of-union role or scope_type — fail closed", () => {
    expect(parseRoleGrant({ role: "admin", scope_type: "family", scope_id: "x" })).toBeNull();
    expect(parseRoleGrant({ role: "parent", scope_type: "org", scope_id: "x" })).toBeNull();
  });

  it("DROPS a row whose scope_id is not a string (null / number / absent)", () => {
    expect(parseRoleGrant({ role: "parent", scope_type: "family", scope_id: null })).toBeNull();
    expect(parseRoleGrant({ role: "parent", scope_type: "family", scope_id: 123 })).toBeNull();
    expect(parseRoleGrant({ role: "parent", scope_type: "family" })).toBeNull();
  });
});
