import "server-only";

/**
 * PER-KID CREDENTIALS RECOVERY + LEGACY-FAMILY CONSENT (plan Unit 8).
 *
 * `server-only`, deps-injected, deliberately NOT `"use server"` — a core with a
 * `deps` parameter may never live in a file whose every export is
 * client-callable (docs/solutions/best-practices/shared-db-taking-core-must-not-
 * live-in-a-use-server-file-server-action-boundary-2026-07-17.md). The thin
 * actions live in ./actions/kid-credentials.ts.
 *
 * Shape copied from app/lib/auth/reset-core.ts: injected deps, an internal
 * OUTCOME union for tests and telemetry, and a caller that answers one uniform
 * result. What is NOT copied is the mechanism, because it cannot be: a child's
 * address is a non-deliverable `students.the120.invalid` system address (RFC
 * 2606), so `resetPasswordForEmail` has nowhere to send anything. There is no
 * mailbox to prove control of, which is exactly why the PARENT is the
 * authority here and why every function below starts by proving the caller owns
 * the child.
 *
 * ── AUTHORIZATION, STATED ONCE AND ENFORCED THE SAME WAY EVERY TIME ──
 * 1. The action resolves `parentId` from the COOKIE SESSION (`auth.getUser()`,
 *    which verifies the JWT) and passes it in `ctx`. NOTHING here ever reads an
 *    id from the request body — a `childId` in an argument is an identifier,
 *    never a credential (the bearer-credential learning, 2026-08-05).
 * 2. Ownership is a WHERE-CLAUSE PREDICATE, never a fetched-row comparison:
 *    `.eq("id", childId).eq("parent_id", ctx.parentId)`. A child this parent
 *    does not own returns NO ROW, so there is no row to mis-compare and no
 *    branch where a wrong `if` leaks one. It also means the refusal cannot
 *    distinguish "no such child" from "not yours".
 * 3. The privileged client is a FACTORY (`deps.db()`), constructed only after
 *    the caller has been named — so "no service-role client exists before
 *    authorization" is a testable claim, not a comment.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currentPolicyHash,
  consentVerdict,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";
import { validateStudentPassword } from "@/app/fp/lib/provision-rules";
import { V3_CONSENT_JURISDICTION } from "./v3-onboarding-core";

/* ------------------------------------------------------------------- deps */

export type KidCredentialsDeps = {
  /**
   * SERVICE-ROLE client, as a FACTORY. `children.fp_username` is
   * service-role-write-only (trigger, migration 20260831120000),
   * `fp_parental_consent` is RLS-on with ZERO policies, and
   * `path_student_profiles` is a Decision-1 table — none of them is reachable
   * with a session client. Every query below carries the session-derived
   * parent id in its WHERE clause, which is the access control the absent
   * policies would be.
   */
  db: () => SupabaseClient;
  /** `auth.admin.updateUserById(userId, { password })`. Injected so a test can
   *  prove it is NEVER called for a child the caller does not own, and never
   *  with a parent's user id. */
  setUserPassword: (userId: string, password: string) => Promise<{ ok: boolean }>;
  now: () => number;
  log: (message: string) => void;
};

/** The server-attested caller. Read from the cookie session by the action. */
export type ParentCaller = { parentId: string };

/* -------------------------------------------------------- the reset outcome */

/**
 * The INTERNAL outcome (reset-core's shape). The action maps every non-`reset`
 * value onto the uniform refusal below; only tests and logs see this union.
 */
export type KidResetOutcome =
  | "reset"
  | "bad_request"
  /** No child with that id belongs to this parent — or none at all. */
  | "not_owned"
  /** The child belongs to the caller but holds no First Profit account. */
  | "no_fp_account"
  /** The password failed `validateStudentPassword`. */
  | "weak_password"
  | "outage";

export type KidResetResult =
  | { ok: true }
  | { ok: false; reason: Exclude<KidResetOutcome, "reset">; message: string };

/**
 * What the parent is told. `weak_password` is the ONE refusal that carries the
 * validator's own text — it is a correctable mistake about a value the parent
 * just typed, and hiding why would make the form unusable. Every other refusal
 * answers the same generic sentence: the caller either owns the child (in which
 * case the honest causes are all "our side" or "no account yet") or does not,
 * and a probe must not learn which.
 */
export const KID_RESET_REFUSAL =
  "We could not set a new password for that child. Refresh the page and try again.";

/* ---------------------------------------------------------------- the reset */

/**
 * Set a NEW password on one of the caller's own First Profit children.
 *
 * ⚠ IT CAN NEVER TOUCH A PARENT'S CREDENTIALS, AND THAT IS STRUCTURAL, NOT
 * POLICY. The user id handed to `setUserPassword` is never the caller's and
 * never anything from the request: it is read from `path_student_profiles`,
 * joined on a `children` row that the WHERE clause already proved belongs to
 * this parent AND that carries a non-null `fp_username`. A parent has no
 * `path_student_profiles` row keyed by a child id they own, so there is no
 * input — malicious or accidental — that resolves this lookup to a parent
 * account. (The beta learning: a recovery flow that resets "the account for
 * this email" once reset the wrong one.)
 */
export async function resetKidPassword(
  deps: KidCredentialsDeps,
  input: unknown,
  ctx: ParentCaller
): Promise<KidResetOutcome> {
  const parsed = parseKidPasswordInput(input);
  if (!parsed.ok) return "bad_request";

  const db = deps.db();

  // OWNERSHIP AS A PREDICATE. `fp_username IS NOT NULL` rides in the WHERE too:
  // a v2 applicant child has no First Profit account and no password to set, so
  // it must not return a row here either.
  const child = await db
    .from("children")
    .select("id, first_name, last_name, fp_username")
    .eq("id", parsed.childId)
    .eq("parent_id", ctx.parentId)
    .not("fp_username", "is", null)
    .maybeSingle();
  if (child.error) {
    deps.log(`[fp/kid-reset] child read failed: ${child.error.message}`);
    return "outage";
  }
  const row = child.data as Record<string, unknown> | null;
  // No row covers BOTH "no such child" and "not yours" — a caller must not be
  // able to tell which, and the difference is invisible by construction.
  if (!row || typeof row.id !== "string") return "not_owned";

  // The name-overlap rule needs the child's real name, and it comes from the
  // ROW we just authorized, never from the request body — otherwise a caller
  // could send a blank name and disable the check.
  const studentName = `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim();
  const verdict = validateStudentPassword(parsed.password, { studentName });
  if (!verdict.ok) return "weak_password";

  // The child's auth account. `path_student_profiles.user_id` is the ONLY link
  // between a roster row and a login, and it is created by `createChild` in the
  // same sequence that claims the username.
  const profile = await db
    .from("path_student_profiles")
    .select("user_id")
    .eq("child_id", row.id)
    .maybeSingle();
  if (profile.error) {
    deps.log(`[fp/kid-reset] profile read failed: ${profile.error.message}`);
    return "outage";
  }
  const userId = (profile.data as { user_id?: unknown } | null)?.user_id;
  if (typeof userId !== "string" || userId.length === 0) {
    deps.log(`[fp/kid-reset] child ${row.id} has an fp_username but no path_student_profiles row`);
    return "no_fp_account";
  }

  const set = await deps.setUserPassword(userId, parsed.password);
  if (!set.ok) {
    deps.log(`[fp/kid-reset] updateUserById failed for child ${row.id}`);
    return "outage";
  }
  return "reset";
}

/** The validator's message, for the one refusal that may carry it. */
export function kidPasswordProblem(
  password: unknown,
  studentName: string
): string | null {
  if (typeof password !== "string") return KID_RESET_REFUSAL;
  const verdict = validateStudentPassword(password, { studentName });
  return verdict.ok ? null : verdict.error;
}

type ParsedKidPassword = { ok: true; childId: string; password: string } | { ok: false };

function parseKidPasswordInput(input: unknown): ParsedKidPassword {
  if (!input || typeof input !== "object") return { ok: false };
  const { childId, password } = input as { childId?: unknown; password?: unknown };
  if (typeof childId !== "string" || childId.length === 0 || childId.length > 100) {
    return { ok: false };
  }
  // Length only: `validateStudentPassword` owns the real rules, and it runs
  // AFTER the child's name is known so the name-overlap check has its input.
  if (typeof password !== "string" || password.length === 0 || password.length > 200) {
    return { ok: false };
  }
  return { ok: true, childId, password };
}

/* ------------------------------------------- legacy-family consent capture */

/**
 * THE CHILD-BOUND CONSENT VARIANT (plan Unit 8, "Two consent anchors").
 *
 * `recordConsent` cannot serve this cohort, and the reason is not incidental:
 * it REFUSES an attempt that is not `verified` and owned by the caller, because
 * it exists to bind a consent to the inbox proof that just happened. A pre-v3
 * family — the beta cohort, a v2 applicant — has no such attempt and no reason
 * to manufacture one. Minting a synthetic `verified` attempt just to satisfy
 * that check would be forging the very evidence the check protects.
 *
 * So this variant writes the consent bound to the CHILD directly, with
 * `signup_attempt_id` NULL. Three consequences, all deliberate:
 *
 *  - Attempt-less rows escape the partial unique index (migration
 *    20260830120000 keys on `signup_attempt_id WHERE ... IS NOT NULL`), so a
 *    double-submit can insert two rows. That is HARMLESS BY CONSTRUCTION: the
 *    photo gate is `photoConsentVerdict`, an EXISTS over plural rows, and two
 *    identical affirmations open the same gate one does.
 *  - The bind-to-rendered rule still applies in full. The client echoes the
 *    version and hash it displayed and `consentVerdict` refuses anything but
 *    `ok`, so a stale bundle after a policy deploy cannot be recorded as
 *    consent to text nobody rendered.
 *  - The identity snapshot comes from the SERVER (the caller's session email),
 *    never from the request body — the same rule `recordConsent` follows for
 *    the same legal-evidence reason.
 */
export type LegacyConsentOutcome =
  | "recorded"
  | "bad_request"
  | "not_owned"
  | "stale_policy"
  | "outage";

export type LegacyConsentInput = {
  childId: string;
  echoedVersion: string;
  echoedHash: string;
  /** Age band, mirroring `fp_parental_consent`'s CHECK. */
  childAgeBand: "under_13" | "13_to_15" | "16_plus";
  parentEmail: string;
  ip: string;
  ua: string;
};

export async function captureLegacyChildConsent(
  deps: KidCredentialsDeps,
  input: LegacyConsentInput,
  ctx: ParentCaller
): Promise<LegacyConsentOutcome> {
  // Bind to what the client rendered, BEFORE touching the database: a refusal
  // here must cost nothing and leave nothing behind.
  const verdict = consentVerdict({
    echoedVersion: input.echoedVersion,
    echoedHash: input.echoedHash,
  });
  if (verdict !== "ok") return verdict === "missing" ? "bad_request" : "stale_policy";

  const db = deps.db();
  const child = await db
    .from("children")
    .select("id")
    .eq("id", input.childId)
    .eq("parent_id", ctx.parentId)
    .maybeSingle();
  if (child.error) {
    deps.log(`[fp/legacy-consent] child read failed: ${child.error.message}`);
    return "outage";
  }
  if (!(child.data as { id?: unknown } | null)?.id) return "not_owned";

  const inserted = await db.from("fp_parental_consent").insert({
    // NULL on purpose — this consent belongs to the CHILD, not to a signup
    // attempt (see the docblock). It is why the partial unique index does not
    // apply and why the gate must be an EXISTS.
    signup_attempt_id: null,
    parent_id: ctx.parentId,
    child_id: input.childId,
    policy_namespace: "fp_parental_consent",
    // The SERVER's current version/hash/text, never the echoed strings — the
    // echo was proof of what was rendered, not the record itself.
    policy_version: FP_CONSENT_POLICY.version,
    policy_hash: currentPolicyHash(),
    rendered_text: FP_CONSENT_POLICY.text,
    method: "email_plus_attestation",
    child_age_band: input.childAgeBand,
    jurisdiction: V3_CONSENT_JURISDICTION,
    parent_identity: { email: input.parentEmail },
    ip: input.ip,
    ua: input.ua,
    accepted_at: new Date(deps.now()).toISOString(),
    evidence: {
      echoed_version: input.echoedVersion,
      echoed_hash: input.echoedHash,
      verdict,
      // Names the path, so an audit can tell a dashboard re-consent from a
      // signup-time one without joining to a missing attempt.
      source: "dashboard_legacy_capture",
    },
  });
  if (inserted.error) {
    deps.log(`[fp/legacy-consent] insert failed: ${inserted.error.message}`);
    return "outage";
  }
  return "recorded";
}

/* --------------------------------------------------------------- revocation */

export type RevokeConsentOutcome = "revoked" | "bad_request" | "not_owned" | "outage";

/* ------------------------------------------------- the refunded-strike set */

/**
 * WHICH OUTCOMES HAND THE RATE-LIMIT STRIKE BACK — AS AN ALLOWLIST, ASSERTED AS
 * A WHOLE SET (v3 Unit 8 review, FIX 3; the same idiom as
 * `COVER_REFUNDED_REFUSALS` and `HANDOFF_REFUNDED_REFUSALS`).
 *
 * ⚠ THE DEFAULT MUST BE "NOT REFUNDABLE", AND AN `if (outcome === "outage")`
 * PER ACTION IS NOT THAT. Three actions each re-deciding the rule is three
 * places for a fourth outcome to arrive un-considered — and the outcome most
 * likely to be added is a refusal, which is exactly the kind that must NOT be
 * refunded. A refunded `not_owned` makes probing another family's child ids
 * free (the refunded-strike-refunds-the-attacker learning, 2026-08-05); a
 * refunded `weak_password` makes password guessing free.
 *
 * Only OUR faults are here. `outage` is the whole set, and the test asserts the
 * WHOLE SET, so widening it is a deliberate edit in two places rather than an
 * accident in one.
 */
export type KidCredentialsOutcome =
  | KidResetOutcome
  | LegacyConsentOutcome
  | RevokeConsentOutcome;

/** EVERY outcome the three cores can return. Listed so the test can sweep the
 *  complement of the allowlist and prove a new member defaults to "no refund". */
export const KID_CREDENTIALS_OUTCOMES: readonly KidCredentialsOutcome[] = [
  "reset",
  "recorded",
  "revoked",
  "bad_request",
  "not_owned",
  "no_fp_account",
  "weak_password",
  "stale_policy",
  "outage",
];

export const KID_CREDENTIALS_REFUNDED_OUTCOMES: readonly KidCredentialsOutcome[] = [
  "outage",
];

/** The ONE predicate the three actions call. Allowlist membership, nothing else
 *  — an outcome nobody thought about is not refundable. */
export const refundsKidCredentialsStrike = (outcome: KidCredentialsOutcome): boolean =>
  KID_CREDENTIALS_REFUNDED_OUTCOMES.includes(outcome);

/**
 * REVOCATION SWEEPS EVERYTHING AND LEAVES A TOMBSTONE.
 *
 * ── WHY A SWEEP AND NOT A SINGLE UPDATE ──
 * A child legitimately has MANY active consent rows: per-attempt uniqueness,
 * the add-another-kid loop, and this module's attempt-less legacy captures.
 * Revoking "the" consent would leave siblings unrevoked and the photo gate wide
 * open — the parent would have asked us to stop and nothing would have stopped.
 *
 * ── WHY THE TOMBSTONE IS WRITTEN FIRST ──
 * The sweep can only stamp rows it can SEE. A capture that inserts after the
 * sweep's read lands unrevoked, and `photoConsentVerdict` would then find it and
 * re-open the gate against an explicit instruction to close it. The per-child
 * tombstone (`children.photo_consent_revoked_at`) is a high-water mark the gate
 * checks with a STRICT `accepted_at > tombstone`, so stamping it BEFORE the
 * sweep means any row racing the sweep is already excluded by time — there is no
 * window in which an insert can slip under. Ordering them the other way would
 * leave exactly the race the tombstone exists to close.
 *
 * A later, deliberate re-capture post-dates the tombstone and is admitted
 * normally: revocation closes the gate, it does not brick it.
 */
export async function revokeChildPhotoConsent(
  deps: KidCredentialsDeps,
  input: unknown,
  ctx: ParentCaller
): Promise<RevokeConsentOutcome> {
  const childId =
    input && typeof input === "object"
      ? (input as { childId?: unknown }).childId
      : undefined;
  if (typeof childId !== "string" || childId.length === 0 || childId.length > 100) {
    return "bad_request";
  }

  const db = deps.db();
  const stamp = new Date(deps.now()).toISOString();

  // 1. THE TOMBSTONE, FIRST — and it doubles as the ownership predicate: the
  //    parent id is in the WHERE clause, so a foreign child updates zero rows
  //    and `not_owned` falls out of the cardinality rather than a comparison.
  const tomb = await db
    .from("children")
    .update({ photo_consent_revoked_at: stamp })
    .eq("id", childId)
    .eq("parent_id", ctx.parentId)
    .select("id");
  if (tomb.error) {
    deps.log(`[fp/consent-revoke] tombstone write failed: ${tomb.error.message}`);
    return "outage";
  }
  if (((tomb.data as unknown[] | null) ?? []).length !== 1) return "not_owned";

  // 2. THE SWEEP — every active row for this child, not one.
  const swept = await db
    .from("fp_parental_consent")
    .update({ revoked_at: stamp })
    .eq("child_id", childId)
    .eq("parent_id", ctx.parentId)
    .is("revoked_at", null)
    .select("id");
  if (swept.error) {
    // The tombstone already landed, so the GATE IS ALREADY CLOSED (every
    // surviving row predates it). Report the outage so the parent can retry and
    // the rows get their own stamps, but do not pretend the photo gate is open.
    deps.log(
      `[fp/consent-revoke] sweep failed for child ${childId} after the tombstone landed: ${swept.error.message} — the photo gate is closed by the tombstone; rows still need revoked_at`
    );
    return "outage";
  }
  return "revoked";
}
