/**
 * Pure provisioning + sign-in decisions (T1 Unit 6; R1, R2, R29, R32) — the
 * test-first heart of the student identity layer, free of Next/Supabase imports
 * per repo convention (only pure logic is defensible in this repo's node-only
 * test setup). The impure shell (provision-core.ts, the actions) consumes these
 * and adds I/O only.
 *
 * The account model this encodes:
 *   - An eight-year-old signs in with a NAME and a PASSWORD. The system email
 *     address is derived server-side from the child's roster id and is
 *     deliberately NON-DELIVERABLE (.invalid, RFC 2606) — it exists only
 *     because Supabase Auth requires one, and it is never displayed anywhere.
 *   - Two students in different families may share a first name. Sign-in
 *     therefore resolves a CANDIDATE SET by normalized name and lets the
 *     password disambiguate — which is exactly why R29's rate limit and
 *     strength floor live here and not in a UI affordance.
 *   - ⚠️ email_confirm: true is REQUIRED on every student createUser call. The
 *     hosted project has confirmations ON (config.toml lies about it); omit the
 *     flag and the account is created but can NEVER sign in, with no rescue
 *     email possible on a non-deliverable address. buildStudentCreateUserPayload
 *     pins it at the type level and a test asserts it. See docs/solutions/
 *     integration-issues/supabase-admin-createuser-non-deliverable-email-
 *     requires-email-confirm-2026-07-21.md.
 */

import type { RoleGrant } from "./access-rules";

/* ------------------------------------------------------------ system email */

/**
 * `.invalid` is reserved by RFC 2606 and can never resolve, so no confirmation
 * or recovery mail can ever be attempted — the Unit 2 spike verified Supabase
 * accepts such addresses without MX validation.
 */
export const STUDENT_EMAIL_DOMAIN = "students.the120.invalid";

/**
 * Derive the stable, unique, never-displayed system address for a student from
 * their roster id (public.children.id — unique per child by construction).
 * FAILS CLOSED on a malformed id: whitespace or `@` would corrupt the address
 * shape, and an empty id would collide every student onto one account.
 */
export function deriveStudentEmail(childId: string): string {
  if (!childId || /[\s@]/.test(childId)) {
    throw new Error("deriveStudentEmail: malformed child id");
  }
  return `s-${childId.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`;
}

/* ------------------------------------------------------- createUser payload */

/**
 * `email_confirm` is typed as the LITERAL `true`: omitting it (or passing
 * false) is a compile error, not a runtime lockout discovered by a child.
 */
export type StudentCreateUserPayload = {
  email: string;
  password: string;
  email_confirm: true;
  app_metadata: { role: "student" };
};

/**
 * The exact payload every student `admin.createUser` call sends — built here,
 * used verbatim by provision-core, asserted by test. `app_metadata.role` is
 * server-set (never client-writable) and is what keeps a student session on
 * the crm-staff-only rewrite path at /crm (proxy-rules checks `role !== "admin"`).
 */
export function buildStudentCreateUserPayload({
  childId,
  password,
}: {
  childId: string;
  password: string;
}): StudentCreateUserPayload {
  return {
    email: deriveStudentEmail(childId),
    password,
    email_confirm: true,
    app_metadata: { role: "student" },
  };
}

/* ------------------------------------------------------------ name matching */

/**
 * One normalization for BOTH sides of every name comparison: NFKC (composed
 * and decomposed accents compare equal), trimmed, inner whitespace collapsed,
 * lowercased. Symmetry matters — the sign-in lookup normalizes the typed name
 * AND the roster name with this same function, so there is no DB-side/JS-side
 * drift to reason about.
 */
export function normalizeStudentName(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Whether a roster first name matches what the student typed. FAILS CLOSED on
 * empty names: public.children.first_name defaults to '' (CRM rows start as
 * drafts), and an empty-vs-empty "match" would resolve a sign-in onto an
 * unfinished roster row.
 */
export function studentNameMatches(dbFirstName: string, typedName: string): boolean {
  const a = normalizeStudentName(dbFirstName);
  const b = normalizeStudentName(typedName);
  return a.length > 0 && a === b;
}

/* -------------------------------------------------------- password strength */

export const STUDENT_PASSWORD_MIN_LENGTH = 10;

/** Strings no student password may contain (checked lowercased). Small on
 *  purpose: length is the real floor; this catches the obvious lazy picks. */
const PASSWORD_DENYLIST = [
  "password",
  "1234567890",
  "qwertyuiop",
  "letmein",
  "iloveyou",
  "thepath",
  "the120",
];

export type PasswordVerdict = { ok: true } | { ok: false; error: string };

/**
 * The R29 strength floor, applied wherever a student password is set — parent
 * provisioning, parent reset, and D26 staff recovery all call this. Length
 * over composition (passphrases beat symbol soup for an eight-year-old), plus
 * three cheap refusals: repetition, a tiny denylist, and the student's own
 * name — the single most guessable string in a cohort. Every refusal carries a
 * specific, parent-readable message (the plan's named requirement).
 */
export function validateStudentPassword(
  password: string,
  ctx: { studentName?: string }
): PasswordVerdict {
  if (password.length < STUDENT_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Use at least ${STUDENT_PASSWORD_MIN_LENGTH} characters — a few unrelated words work well.`,
    };
  }
  // bcrypt truncates beyond 72 BYTES; measure UTF-8 bytes, not `.length` (UTF-16
  // code units), or a multi-byte passphrase (accents, CJK) could pass this guard
  // and still be silently truncated at hash time — the exact outcome it exists to
  // prevent. TextEncoder keeps the module pure/portable (no Node Buffer).
  if (new TextEncoder().encode(password).length > 72) {
    return { ok: false, error: "That password is too long — keep it under 72 characters." };
  }
  if (new Set(password).size < 4) {
    return { ok: false, error: "That password repeats itself too much — mix it up a little." };
  }
  // Normalize the password the SAME way (NFKC) the name tokens are normalized
  // below, so `includes` compares like-for-like — a decomposed-unicode name
  // pasted into the password would otherwise slip past a composed-form token.
  const lowered = password.normalize("NFKC").toLowerCase();
  if (PASSWORD_DENYLIST.some((w) => lowered.includes(w))) {
    return { ok: false, error: "That password is too easy to guess — try a few unrelated words." };
  }
  if (ctx.studentName) {
    const tokens = normalizeStudentName(ctx.studentName)
      .split(" ")
      .filter((t) => t.length >= 3); // 2-char tokens ("Al") are all false positives
    if (tokens.some((t) => lowered.includes(t))) {
      return {
        ok: false,
        error: "Don't use the student's name in the password — it's the first thing anyone guesses.",
      };
    }
  }
  return { ok: true };
}

/* ---------------------------------------------------------------- grants */

/**
 * The two-grant pair every student is provisioned with (documented on
 * access-rules.RoleGrant): the SELF grant identifies them; the FAMILY grant is
 * membership — what lets a sibling see position without seeing evidence.
 * Emitted as insert-ready snake_case rows so provisioning writes exactly this.
 */
export function buildStudentGrants({
  userId,
  profileId,
  familyId,
}: {
  userId: string;
  profileId: string;
  familyId: string;
}): { user_id: string; role: "student"; scope_type: "student" | "family"; scope_id: string }[] {
  return [
    { user_id: userId, role: "student", scope_type: "student", scope_id: profileId },
    { user_id: userId, role: "student", scope_type: "family", scope_id: familyId },
  ];
}

/* ------------------------------------------------------------- authority */

/**
 * Provisioning and reset authority (R32): EITHER parent of THE family, and
 * nobody else. Deliberately STRICTER than resolvePathAccess — a Guide's D25
 * read grant is authority to review, never to mint or reset a child's
 * credentials, and a sibling's family grant is visibility, not control.
 * Mirrors canCaptureEvidence's shape (the write-authority precedent).
 */
export function isParentOfFamily(grants: readonly RoleGrant[], familyId: string): boolean {
  return grants.some(
    (g) => g.role === "parent" && g.scopeType === "family" && g.scopeId === familyId
  );
}

/* --------------------------------------------------------- sign-in lookup */

/** A sign-in candidate: one provisioned student whose roster name matched. */
export type SignInCandidate = {
  profileId: string;
  userId: string;
  childId: string;
  familyId: string;
  firstName: string;
};

/**
 * At most this many same-name candidates are password-probed per attempt —
 * bounds the work a single submit can cause while comfortably covering any
 * real cohort's name collisions.
 */
export const MAX_SIGN_IN_CANDIDATES = 5;

/**
 * Narrow ONE untyped profiles⋈children row (from the untyped service-role
 * client) into a SignInCandidate, or null — the parseRoleGrant pattern: never
 * coerce a malformed row into a trusted identity at the service-role boundary.
 * PostgREST embeds a to-one relation as an object, but the shape is
 * version-dependent enough that a single-element array is tolerated too;
 * anything else (missing, empty, ambiguous) is dropped.
 */
export function parseCandidateRow(row: {
  id?: unknown;
  user_id?: unknown;
  child_id?: unknown;
  family_id?: unknown;
  children?: unknown;
}): SignInCandidate | null {
  let child: unknown = row.children;
  if (Array.isArray(child)) {
    if (child.length !== 1) return null;
    child = child[0];
  }
  if (
    typeof row.id !== "string" ||
    typeof row.user_id !== "string" ||
    typeof row.child_id !== "string" ||
    typeof row.family_id !== "string"
  ) {
    return null;
  }
  if (child === null || typeof child !== "object") return null;
  const firstName = (child as { first_name?: unknown }).first_name;
  if (typeof firstName !== "string") return null;
  return {
    profileId: row.id,
    userId: row.user_id,
    childId: row.child_id,
    familyId: row.family_id,
    firstName,
  };
}

/* ---------------------------------------------------------------- messages */

/**
 * ONE failure message for every non-rate-limited sign-in outcome — unknown
 * name and wrong password are deliberately indistinguishable (no account
 * enumeration), and nothing ever mentions the system email exists.
 */
export const SIGN_IN_FAILED_MESSAGE =
  "That name and password don't match. Check both and try again — or ask a parent to reset it.";

export const SIGN_IN_RATE_LIMITED_MESSAGE =
  "Too many tries for now. Wait a few minutes, then try again.";
