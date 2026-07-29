/**
 * Student provisioning — the pure decision surface (funnel U15; W10–W13a).
 *
 * A paid deposit earns the child a platform identity and a real mailbox at
 * `first.last@the120.school`. Two external systems are involved (Supabase
 * auth and Google Workspace), so every decision that can be made without
 * touching either lives here, testable by execution.
 *
 * The address convention is Peter's (W11, 2026-07-28): BARE `first.last`,
 * no cohort suffix, because it is an address a child keeps for years. Its
 * consequence is already shipped — since bare addresses are
 * indistinguishable from staff addresses by shape, the auth-mail guard
 * inverted to default-deny (`app/lib/auth-mail-guard.ts`).
 */

import { buildFwLocalBase, isFwStudentAddress } from "@/app/fp/lib/fw-provision-rules";
import { STAFF_AUTH_MAIL_ALLOWLIST, STUDENT_MAIL_DOMAIN } from "@/app/lib/auth-mail-guard";
import { CONSENT_MIN_POLICY_VERSION, policyVersionAtLeast } from "@/app/lib/funnel/deposit-rules";

/* ─────────────────── the address ─────────────────── */

export function studentEmailForLocalPart(localPart: string): string {
  return `${localPart}@${STUDENT_MAIL_DOMAIN}`;
}

/** Bound on the collision search — mirrors the FW rule and its reasoning:
 *  reaching it means something is very wrong, and guessing further is worse. */
export const MAX_LOCAL_PART_ATTEMPTS = 200;

/**
 * Derivation, as a VERDICT rather than a throw.
 *
 * `buildFwLocalBase` fails closed on names that cannot be folded to a safe
 * ASCII local part — non-Latin scripts, homoglyphs, anything that would
 * silently mint an address for a different child than the one named. That
 * is right, and its rationale ("the guide is standing at the table and can
 * retype") does NOT hold here: this runs from a payment webhook with no
 * human present. A throw escaping into that path would strand a family who
 * has already paid.
 *
 * So the throw is caught and turned into `underivable`, which the caller
 * routes to a staffed exception path (W11a). The deposit is never refused
 * and the webhook never errors on this branch.
 */
export type LocalPartDerivation =
  | { ok: true; base: string }
  | { ok: false; reason: "underivable"; detail: string };

export function deriveStudentLocalBase(firstName: string, lastName: string): LocalPartDerivation {
  try {
    return { ok: true, base: buildFwLocalBase(firstName, lastName) };
  } catch (err) {
    return {
      ok: false,
      reason: "underivable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export type LocalPartPick =
  | { ok: true; localPart: string; email: string; attempt: number }
  | { ok: false; reason: "underivable"; detail: string }
  | { ok: false; reason: "exhausted"; detail: string };

/**
 * Pick the address, avoiding everything already spoken for.
 *
 * `taken` must carry, all as bare local parts:
 *   - every live claim,
 *   - every RELEASED address (never re-issued to a different child — the
 *     `path_fw_released_aliases` rule, which exists because an address is
 *     a promise someone may still hold),
 *   - the staff allowlist (seeded below, so a student can never be minted
 *     onto `peter@` and inherit its auth-mail exemption),
 *   - the FW `.fw` bases, so the two student populations cannot collide.
 *
 * This is the fast path only. The database's unique constraint is the real
 * arbiter under a race, and the caller retries on 23505.
 */
export function pickStudentLocalPart(input: {
  firstName: string;
  lastName: string;
  taken: ReadonlySet<string>;
}): LocalPartPick {
  const derived = deriveStudentLocalBase(input.firstName, input.lastName);
  if (!derived.ok) return derived;

  for (let attempt = 1; attempt <= MAX_LOCAL_PART_ATTEMPTS; attempt += 1) {
    const localPart = attempt === 1 ? derived.base : `${derived.base}${attempt}`;
    if (!input.taken.has(localPart)) {
      return { ok: true, localPart, email: studentEmailForLocalPart(localPart), attempt };
    }
  }
  return {
    ok: false,
    reason: "exhausted",
    detail: `no free local part for "${derived.base}" after ${MAX_LOCAL_PART_ATTEMPTS} attempts`,
  };
}

/** The staff local parts, as a seed for every `taken` set. Minting a
 *  student onto one of these would hand them an address the auth-mail
 *  guard deliberately permits. */
export function staffLocalParts(): string[] {
  return STAFF_AUTH_MAIL_ALLOWLIST.filter((a) => a.endsWith(`@${STUDENT_MAIL_DOMAIN}`)).map((a) =>
    a.slice(0, a.indexOf("@")).toLowerCase()
  );
}

/** True when an address is already spoken for by a NON-funnel population
 *  (staff, or the FW namespace). Shape-only, no lookup. */
export function isReservedAddress(email: string): boolean {
  const lowered = email.trim().toLowerCase();
  if (isFwStudentAddress(lowered)) return true;
  return STAFF_AUTH_MAIL_ALLOWLIST.some((a) => a.toLowerCase() === lowered);
}

/* ─────────────────── the consent gate ─────────────────── */

/**
 * W10/Education terms: Workspace for Education permits under-18 account
 * holders, but the school must hold verifiable parental consent BEFORE
 * enabling one. Unit 1 shipped the artifact — the checkout acceptance
 * record, whose version/hash/timestamp/IP persist on the attempt row.
 *
 * So minting is gated on the fulfilled deposit carrying an acceptance
 * at-or-after the consent version. Comparison is STRUCTURAL
 * (`policyVersionAtLeast`); these versions are `YYYY-MM-DD.N` and
 * `"2026-07-28.10" < "2026-07-28.2"` as strings.
 *
 * Deposits accepted before the bump fail this and park — deliberately.
 * They are a known cohort needing a re-consent touch, not an error.
 */
export type ConsentVerdict =
  | { ok: true }
  | { ok: false; reason: "consent_missing" | "consent_stale"; detail: string };

export function consentVerdict(acceptedPolicyVersion: string | null | undefined): ConsentVerdict {
  if (!acceptedPolicyVersion || acceptedPolicyVersion.trim().length === 0) {
    return {
      ok: false,
      reason: "consent_missing",
      detail: "the deposit carries no policy acceptance",
    };
  }
  if (!policyVersionAtLeast(acceptedPolicyVersion, CONSENT_MIN_POLICY_VERSION)) {
    return {
      ok: false,
      reason: "consent_stale",
      detail:
        `accepted ${acceptedPolicyVersion}, which predates the parental-consent clause ` +
        `(${CONSENT_MIN_POLICY_VERSION}) — needs a re-consent touch before minting`,
    };
  }
  return { ok: true };
}

/* ─────────────────── provisioning state ─────────────────── */

/**
 * The claim's lifecycle. Mirrored by a CHECK constraint; parity is pinned
 * by test, the same discipline REVIEW_STATUSES carries.
 */
export const PROVISION_STATES = [
  "pending", // claimed, nothing attempted yet (or waiting on consent/config)
  "in_progress", // a run holds the lease
  "identity_only", // Supabase account exists, Workspace mailbox does not
  "complete", // both legs done, mailbox deliverable
  "exception", // needs a human (underivable name, exhausted, consent stale)
  "suspend_pending", // refund/withdrawal seen; Workspace suspend not yet done
  "released", // suspended and retired; address never re-issued
] as const;
export type ProvisionState = (typeof PROVISION_STATES)[number];

/** Terminal for the arrival page's poll — nothing further will change on
 *  its own, so the page stops waiting and says something honest. */
export function isTerminalState(state: ProvisionState): boolean {
  return state === "complete" || state === "exception" || state === "released";
}

/** Forwarding is its OWN dimension, never folded into the state above: a
 *  mailbox can be perfectly deliverable while forwarding is still
 *  unverified, and conflating them would make `complete` mean two things. */
export const FORWARDING_STATES = ["none", "pending_verification", "active", "refused"] as const;
export type ForwardingState = (typeof FORWARDING_STATES)[number];

/* ─────────────────── per-leg verdicts ─────────────────── */

/**
 * Each external system is decided separately, and REUSING an existing
 * verdict rather than re-deciding is the point: the documented incident is
 * an idempotent primitive composed with an unconditional caller, which
 * rotated a live credential. `adopt` means "it already exists and we keep
 * it" — never "create it again".
 */
export type LegVerdict =
  | { action: "create" }
  | { action: "adopt"; existing: string }
  | { action: "noop"; existing: string };

export function legVerdict(input: {
  /** What the system reports. `unknown` = the read itself failed. */
  existing: string | null | "unknown";
  /** Whether OUR records already say this leg completed. */
  recorded: boolean;
}): LegVerdict | { action: "refuse"; reason: string } {
  if (input.existing === "unknown") {
    return { action: "refuse", reason: "existence read failed — refusing to guess" };
  }
  if (input.existing === null) return { action: "create" };
  return input.recorded
    ? { action: "noop", existing: input.existing }
    : { action: "adopt", existing: input.existing };
}

/**
 * Where the whole composition lands, given both legs. The plan's shape:
 * Supabase first (it arbitrates the local part via a DB claim), Workspace
 * second. A Workspace failure is compensable, not fatal.
 */
export function composeState(input: {
  identityDone: boolean;
  mailboxDone: boolean;
  workspaceConfigured: boolean;
}): ProvisionState {
  if (!input.identityDone) return "pending";
  if (input.mailboxDone) return "complete";
  // Identity exists, mailbox does not. If Workspace is not configured yet
  // that is expected and quiet (the credential lands with the admin-console
  // prework); if it IS configured, this is a real partial needing a re-drive.
  return input.workspaceConfigured ? "identity_only" : "pending";
}
