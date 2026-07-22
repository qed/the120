/**
 * Pure Path-access decision (T1 Unit 5, Decision 1) — the enforcement of R5's
 * access graph and R6's "no self-verification" boundary, and the ONLY part of
 * this authorization the repo's node-only test setup can defend. Mirrors
 * `app/crm/lib/access.ts` (`resolveStaffAccess`): kept free of next/supabase
 * imports so the decision table is unit-testable. `auth.ts`'s `requirePathUser`
 * loads the caller's grants; a per-target call site (a later unit, with its own
 * tests) maps this verdict onto redirect/not-found.
 *
 * The single service-role boundary (Decision 1) means this verdict — not RLS —
 * is what stands between a caller and another family's Founder File, so every
 * branch is tested. Two invariants this function CANNOT defend itself, and every
 * caller MUST uphold:
 *
 *   1. `grants` MUST already be scoped to the session user. RoleGrant carries no
 *      user_id (by design), and this function never reads `session.user.id` — it
 *      trusts that the grants it is handed belong to the caller. requirePathUser
 *      enforces that with `.eq("user_id", user.id)`; a future loader that batched
 *      or cached grants across users would silently authorize on someone else's
 *      grants. A test documents this trust boundary so a refactor can't break it
 *      unnoticed.
 *
 *   2. `target`'s ids MUST come from the AUTHORITATIVE resource row (a
 *      path_student_profiles lookup), never a client-supplied route or form
 *      param. This function compares ids; it cannot detect a forged or
 *      mismatched target. This is exactly where an IDOR would live.
 */

/** A Path authorization role. NOT a column on the user (Decision 2): a human
 *  holds grants, and can be a `parent` in one family and a `guide` of a cohort
 *  at the same time. */
export type PathRole = "student" | "parent" | "guide";

/** What a grant is scoped to. `scope_id` is polymorphic against this. */
export type PathScope = "student" | "family" | "cohort";

/**
 * One `path_role_grants` row, reduced to what the decision needs. A student is
 * provisioned TWO grants (Unit 6):
 *   { role: "student", scopeType: "student", scopeId: <their studentId> }  — self
 *   { role: "student", scopeType: "family",  scopeId: <their familyId>  }  — membership
 * The self grant identifies them; the family grant is what lets a sibling see
 * position without seeing evidence. A parent holds { "parent", "family", … };
 * a Guide holds { "guide", "cohort", … }.
 */
export type RoleGrant = {
  role: PathRole;
  scopeType: PathScope;
  scopeId: string;
};

/**
 * What is being accessed. `position` = a student's place on the path and their
 * awards (siblings may see this); `profile`/`evidence` are the private surfaces
 * (siblings may not). `cohortId` is null when the student is not yet in a
 * cohort — a null never matches a Guide grant, so an unassigned student is
 * simply invisible to Guides rather than visible to all of them.
 */
export type TargetKind = "profile" | "evidence" | "position";

export type AccessTarget = {
  kind: TargetKind;
  studentId: string;
  familyId: string;
  cohortId: string | null;
};

/** Just the shape the decision needs from a Supabase session. Presence is all
 *  that distinguishes `login` from `forbidden`; the caller's identity is carried
 *  entirely by `grants`, which `auth.ts` loads by the session user's id. */
export type SessionLike = { user: { id: string } } | null;

/** Same union as `StaffAccessVerdict`: `login` drives a redirect, `forbidden`
 *  a not-found rewrite — the distinction matters, so they are never merged. */
export type PathAccessVerdict = "ok" | "login" | "forbidden";

const has = (
  grants: readonly RoleGrant[],
  role: PathRole,
  scopeType: PathScope,
  scopeId: string
): boolean =>
  grants.some(
    (g) => g.role === role && g.scopeType === scopeType && g.scopeId === scopeId
  );

/**
 * Decision table (first match wins):
 * - no session                                   → "login"
 * - a `student`/`student` grant for THIS student → "ok"        (self, any kind)
 * - a `parent`/`family` grant for the family     → "ok"        (either parent, any student, any kind — R4)
 * - a `guide`/`cohort` grant for the cohort       → "ok"       (D25 — cohort evidence at any time; null cohort never matches)
 * - target is `position` AND a `student`/`family`
 *   grant for the family                          → "ok"       (a SIBLING sees position + awards only)
 * - otherwise                                     → "forbidden"
 *
 * Notes:
 * - Per-scope, never global: a human with a `parent`/`family` grant and a
 *   `guide`/`cohort` grant is authorized only for THAT family and THAT cohort,
 *   never "a parent" or "a Guide" everywhere. This falls out of matching on
 *   scopeId and is asserted by the dual-role test.
 * - A grant referencing a since-deleted family/cohort simply fails to match a
 *   live target's ids → `forbidden`, never a throw (the ids are compared, not
 *   dereferenced).
 * - R6's teeth are elsewhere (the transition clamp, Unit 7); this governs READ
 *   access. But the sibling carve-out here is where R5's "siblings see position
 *   but not evidence" is actually enforced.
 */
export function resolvePathAccess({
  session,
  grants,
  target,
}: {
  session: SessionLike;
  grants: readonly RoleGrant[];
  target: AccessTarget;
}): PathAccessVerdict {
  if (!session) return "login";

  // Self — a student reaching their own profile, evidence, or position.
  if (has(grants, "student", "student", target.studentId)) return "ok";

  // Either parent of the family — full access to any student in it (R4).
  if (has(grants, "parent", "family", target.familyId)) return "ok";

  // A Guide of the student's cohort — cohort evidence at any time (D25). A null
  // cohortId cannot match, so an unassigned student is not exposed to any Guide.
  if (target.cohortId !== null && has(grants, "guide", "cohort", target.cohortId)) {
    return "ok";
  }

  // A sibling — a student member of the same family who is NOT this student
  // (self was handled above). Position and awards only; never profile/evidence.
  if (target.kind === "position" && has(grants, "student", "family", target.familyId)) {
    return "ok";
  }

  return "forbidden";
}
