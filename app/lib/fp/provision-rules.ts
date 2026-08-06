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
import { asStoredCoverDataUrl } from "./cover-store-rules";

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

/* --------------------------------------------------------- username matching */

/**
 * Whether a child's stored `fp_username` matches the (already-normalized,
 * lowercase) identifier the child typed — the First Profit login resolution key
 * from Slice B Unit 13 onward (the /fp Path student sign-in still resolves by
 * NAME via studentNameMatches above; only the cross-origin FP child login moved
 * to usernames). CASE-INSENSITIVE, matching the U12 `lower(fp_username)` unique
 * index: the DB stores a lowercase `^[a-z0-9]+$` handle and the caller lowercases
 * the typed identifier, so both fold the same way and the namespaces cannot drift.
 *
 * FAILS CLOSED on a null / empty stored username: a child with no fp_username has
 * nothing to type, so they can NEVER be resolved by username — this is the
 * no-match that keeps a not-yet-backfilled child (or one minted by another
 * product before it got a username) from being reachable via the login lookup.
 */
export function childUsernameMatches(
  dbUsername: string | null | undefined,
  normalizedIdentifier: string
): boolean {
  if (!dbUsername || !normalizedIdentifier) return false;
  return dbUsername.toLowerCase() === normalizedIdentifier;
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

/** A sign-in candidate: one provisioned student resolved from the profiles⋈children
 *  join. `firstName` still drives the player-profile display seed; `username` is the
 *  U13 First Profit login resolution key (`children.fp_username`), NULL for a child
 *  not yet backfilled — the /fp name path ignores it, the FP login path matches on it. */
export type SignInCandidate = {
  profileId: string;
  userId: string;
  childId: string;
  familyId: string;
  firstName: string;
  username: string | null;
  /** `children.birth_year` (text; '' = unset sentinel). Only the FP login path
   *  selects it — absent narrows to '' (unset), never a dropped row. Feeds the
   *  read-time grade derivation (Unit 3); NEVER logged. */
  birthYear: string;
  /** `children.grade` (int, nullable) — the stored-roster fallback when
   *  birth_year is unset. Absent/non-int narrows to null. NEVER logged. */
  grade: number | null;
  /**
   * The child's cover TRIPLE: `children.fp_cover_status`,
   * `children.fp_cover_blob_key` and `children.fp_cover_data_url` (all text,
   * all nullable). Only the FP login path selects them; absent/non-string
   * narrows to null.
   *
   * They travel together on purpose: no one of them is the cover. The status
   * says whether the row claims a picture, the key says whether that picture
   * lives in the object store, and `coverDataUrl` is the PICTURE ITSELF — the
   * single artifact rendered during parent signup and carried here by
   * `planCoverCarry` (v3 Unit 7; migration 20260917120000). A door serves bytes
   * only when the three agree; reading the status alone would let a caller
   * conclude "there is a cover" from a word rather than from something it can
   * actually hand over.
   */
  coverStatus: string | null;
  coverBlobKey: string | null;
  coverDataUrl: string | null;
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
  // fp_username is OPTIONAL on the row: a child not yet backfilled (U12) has NULL,
  // and the /fp name-path select does not request the column at all. A missing or
  // non-string value narrows to null (an unmatchable username), NEVER a dropped
  // row — a null username is a valid, provisioned student who simply cannot be
  // resolved by the FP username login.
  const rawUsername = (child as { fp_username?: unknown }).fp_username;
  const username = typeof rawUsername === "string" ? rawUsername : null;
  // birth_year / grade (Unit 3): OPTIONAL on the row — only the FP login path
  // selects them (the /fp name path does not). Malformed values narrow to the
  // unset sentinel ('' / null), NEVER a dropped row: grade is display
  // plumbing, and a bad roster value must not make a student vanish from the
  // candidate set.
  const rawBirthYear = (child as { birth_year?: unknown }).birth_year;
  const birthYear = typeof rawBirthYear === "string" ? rawBirthYear : "";
  const rawGrade = (child as { grade?: unknown }).grade;
  const grade = typeof rawGrade === "number" && Number.isInteger(rawGrade) ? rawGrade : null;
  // fp_cover_status / fp_cover_blob_key / fp_cover_data_url (v3 Unit 7):
  // OPTIONAL on the row for exactly the same reason as birth_year/grade — only
  // the FP login path selects them, every pre-v3 child has NULL, and a
  // malformed value narrows to null rather than dropping a real student out of
  // the candidate set. A cover is DECORATION; it must never be able to cost a
  // child their login.
  const rawCoverStatus = (child as { fp_cover_status?: unknown }).fp_cover_status;
  const coverStatus = typeof rawCoverStatus === "string" ? rawCoverStatus : null;
  const rawCoverKey = (child as { fp_cover_blob_key?: unknown }).fp_cover_blob_key;
  const coverBlobKey = typeof rawCoverKey === "string" ? rawCoverKey : null;
  // The stored artifact is GATED, not merely narrowed: it becomes an `<img src>`
  // in a child's browser, and it is bounded in length so a corrupted column can
  // never inflate a sign-in response. Over the bound is refused, not truncated —
  // half a data URL is a broken image.
  const coverDataUrl = asStoredCoverDataUrl(
    (child as { fp_cover_data_url?: unknown }).fp_cover_data_url
  );
  return {
    profileId: row.id,
    userId: row.user_id,
    childId: row.child_id,
    familyId: row.family_id,
    firstName,
    username,
    birthYear,
    grade,
    coverStatus,
    coverBlobKey,
    coverDataUrl,
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
