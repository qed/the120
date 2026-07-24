/**
 * Pure FW authorization decisions (FW Unit 2; FW-R1–R5, FW-D3, FW-D9,
 * Decision 12) — who may act as a guide in a Founders Weekend cohort, what a
 * guide account is allowed to be, and when a guide-invite link is still alive.
 *
 * Free of Next/Supabase imports per repo convention, mirroring
 * `app/fp/lib/access-rules.ts` and `app/crm/lib/access.ts`: the decision table
 * is the defensible layer, so it lives here with exhaustive tests and the impure
 * shell (`fw-auth.ts`, `fw-guide-core.ts`, the FW actions) adds I/O only.
 *
 * ── Why FW authorization is its own module, not a widening of resolvePathAccess
 *
 * The Path's resolvers answer "may this caller READ this student's file" and
 * "is this caller a verifying adult for this transition". FW asks a different
 * question with a different blast radius: a guide's tap writes a check-in for a
 * child they met ninety seconds ago, with no gating and no verify cascade. FW-D9
 * settles it — the Path resolvers are NOT widened; FW gets a sibling. A future
 * change to Path access can therefore never silently hand out FW check-in power,
 * and vice versa.
 *
 * ── The two routes to guide, and why the bridge exists
 *
 * 1. A `guide`/`cohort` grant for THAT cohort (the explicit, revocable route
 *    staff issues per event).
 * 2. THE BRIDGE (FW-D3): an active staff member implicitly acts as a guide in
 *    `kind='fw'` cohorts, with no grant row. Staff run these weekends; making
 *    them grant themselves into every cohort they walk into would either be
 *    forgotten on a Friday morning or done pre-emptively for all cohorts, which
 *    is the same thing as the bridge with worse bookkeeping.
 *
 * Three invariants this function CANNOT defend itself, and every caller MUST
 * uphold (the same trust boundary access-rules.ts documents):
 *
 *   1. `grants` MUST already be scoped to the session user. RoleGrant carries no
 *      user_id by design; this function trusts the loader.
 *   2. `cohort` MUST come from an AUTHORITATIVE `path_cohorts` row — never a
 *      client-supplied `kind`. Trusting a submitted kind would make the bridge
 *      self-service: any staff-claim holder could declare a Path cohort "fw" and
 *      write cascade-free events into a real Path student's record.
 *   3. `bridge.staffRowActive` MUST come from a live `staff` row read, never from
 *      the JWT. That is the whole point of the stale-JWT rule below.
 */

import type { RoleGrant, SessionLike } from "./access-rules";
import { isFwStudentAddress } from "./fw-provision-rules";

/** The `path_cohorts.kind` value that makes a cohort a Founders Weekend cohort.
 *  Mirrors the migration's CHECK (`kind in ('path','fw')`); the parity test pins
 *  the two together so a renamed value cannot pass here and fail in SQL. */
export const FW_COHORT_KIND = "fw";

/** Just the shape the decision needs from a `path_cohorts` row. `kind` is
 *  deliberately a bare string, not the union: this is data crossing the
 *  service-role boundary, and a value outside the union must be REFUSED here
 *  rather than made unrepresentable and then cast into existence. */
export type FwCohortLike = { id: string; kind: string } | null;

/**
 * The bridge's two inputs, gathered by the impure shell from the same sources
 * `resolveStaffAccess` reads: the JWT's admin claim and the live `staff` row.
 * Kept as a separate object so the call site reads as "these came from staff
 * resolution", not as two loose booleans that could be transposed.
 */
export type FwBridgeInputs = {
  /** `app_metadata.role === "admin"` on the session. Necessary, never sufficient. */
  hasAdminClaim: boolean;
  /** A `staff` row exists AND `is_active`. Revocation bites here, not in the JWT. */
  staffRowActive: boolean;
};

export type FwActorVerdict =
  | {
      ok: true;
      /**
       * WHICH route authorized this caller — load-bearing beyond bookkeeping.
       * Unit 5's ops surface (cohorts, guide credentialing, board tokens) is
       * visible and actionable ONLY to `bridge` actors; a pure guide sees none
       * of it. `bridge` is checked FIRST so a staff member who also holds a
       * guide grant keeps their ops power, and loses it the moment their staff
       * row is deactivated while retaining plain check-in ability.
       */
      via: "bridge" | "grant";
    }
  | {
      ok: false;
      reason:
        /** No session at all → the caller belongs at the guide door. */
        | "no_session"
        /** No such cohort (or the shell could not load it) → fail closed. */
        | "cohort_not_found"
        /** A real cohort, but a Path one. Neither route crosses this line. */
        | "cohort_not_fw"
        /** Signed in, real fw cohort, but neither a grant nor an active staff row. */
        | "not_a_guide";
    };

const hasGuideGrantFor = (grants: readonly RoleGrant[], cohortId: string): boolean =>
  grants.some((g) => g.role === "guide" && g.scopeType === "cohort" && g.scopeId === cohortId);

/**
 * Decision table (first match wins):
 * - no session                                        → no_session
 * - cohort missing                                    → cohort_not_found
 * - cohort.kind !== 'fw'                              → cohort_not_fw
 * - admin claim AND active staff row                  → ok, via "bridge"
 * - a guide/cohort grant for THIS cohort              → ok, via "grant"
 * - otherwise                                         → not_a_guide
 *
 * Notes on the ordering, each of which is a security property rather than taste:
 *
 * - **`cohort_not_fw` is checked BEFORE the grant route, not only before the
 *   bridge.** The plan states the bridge refuses `kind='path'` cohorts; this
 *   module extends the same refusal to grant-holders, deliberately. A
 *   `guide`/`cohort` grant on a PATH cohort is the Path's D25 reviewer grant —
 *   authority to READ a cohort's evidence and to countersign through the Path's
 *   verify cascade. It is NOT authority to drive `fw_move_task`, which writes
 *   verified states with no gating, no cascade, and no review. Letting a Path
 *   guide grant unlock the FW write path would hand every cohort guide a
 *   cascade-free editor for their students' records.
 *
 * - **The bridge requires BOTH inputs.** An admin claim alone is a stale JWT
 *   away from a revoked staff member still holding check-in power for a live
 *   weekend; `resolveStaffAccess` makes exactly this call for `/crm`, and FW
 *   inherits it rather than inventing a weaker one.
 *
 * - **Per-cohort, never global.** The grant route matches on `scopeId`, so a
 *   guide granted into Boston is refused in Hamptons. The bridge is genuinely
 *   global across fw cohorts — that is what "staff run these events" means, and
 *   it is bounded by `kind` and by the live staff row.
 */
export function resolveFwActor({
  session,
  grants,
  cohort,
  bridge,
}: {
  session: SessionLike;
  grants: readonly RoleGrant[];
  cohort: FwCohortLike;
  bridge: FwBridgeInputs;
}): FwActorVerdict {
  if (!session) return { ok: false, reason: "no_session" };
  if (!cohort) return { ok: false, reason: "cohort_not_found" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };

  if (bridge.hasAdminClaim && bridge.staffRowActive) return { ok: true, via: "bridge" };
  if (hasGuideGrantFor(grants, cohort.id)) return { ok: true, via: "grant" };

  return { ok: false, reason: "not_a_guide" };
}

/**
 * Whether a resolved FW actor may reach the STAFF ops surfaces (Unit 5: cohort
 * creation and dates, guide credentialing, board tokens; Unit 5b: replay-reject
 * resolution and anonymization). Expressed here, once, so no ops action has to
 * re-derive "was this the bridge?" from a boolean it carried along by hand.
 *
 * A pure guide is never staff — the whole point of the split. Note this is
 * deliberately NOT "hasAdminClaim": a session whose staff row was deactivated
 * mid-weekend resolves via `grant` (if they hold one) and loses ops on the very
 * next action.
 */
export function isFwStaffActor(verdict: FwActorVerdict): boolean {
  return verdict.ok && verdict.via === "bridge";
}

/* ────────────────────────────────────────── the guide account's own shape ──── */

/**
 * The `app_metadata.role` every FW guide account carries. NOT `"admin"` — that
 * is the entire point of FW-R5. `proxy-rules.resolveProxyOutcome` gates `/crm`
 * on `role !== "admin"`, so a guide session reaching `/crm` earns the
 * `crm-staff-only` 404 rewrite by construction rather than by a check somebody
 * remembered to write.
 */
export const FW_GUIDE_ROLE = "guide";

/**
 * The exact payload every FW guide `admin.createUser` call sends.
 *
 * Two things are pinned at the TYPE level, both because a runtime check can be
 * skipped by the next call site and a type cannot:
 *
 *   - `email_confirm: true` — the hosted project has signup confirmations ON
 *     (config.toml lies about it; see docs/solutions/integration-issues/
 *     supabase-admin-createuser-non-deliverable-email-requires-email-confirm-
 *     2026-07-21.md). Omitting it mails the guide a Supabase confirmation that
 *     competes with the invite link we are about to send them, and leaves the
 *     account unable to sign in until they find the right one.
 *   - `app_metadata.role: "guide"` as a LITERAL — a payload carrying `"admin"`
 *     is a compile error, not a guide with CRM access.
 *
 * There is NO `password` key, and its absence is the design: the account is
 * dormant until the guide claims their invite and sets one. A staff-chosen
 * placeholder password would be a working credential sitting in staff's hands
 * (and in whatever channel it was communicated over) for the whole build window.
 */
export type FwGuideCreateUserPayload = {
  email: string;
  email_confirm: true;
  app_metadata: { role: typeof FW_GUIDE_ROLE };
};

/**
 * Build the guide createUser payload, refusing the one address class that must
 * never carry a password: the FW STUDENT namespace.
 *
 * `maya.chen.fw@the120.school` is a dormant minor's account by construction
 * (fw-provision-rules.ts). Minting a *guide* there — a typo away during a
 * ninety-student import week — would put a password-carrying, sign-in-able
 * account inside the namespace whose whole safety story is "password-less and
 * dormant", and would hand the next collision probe a live account it must step
 * around. Refuse at the door.
 *
 * The refusal is a throw, not a typed reason: the callers that could hit it are
 * staff-gated forms, and a silent typed refusal here would be indistinguishable
 * from "that email is taken" in the ops copy.
 */
export function buildFwGuideCreateUserPayload({
  email,
}: {
  email: string;
}): FwGuideCreateUserPayload {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("buildFwGuideCreateUserPayload: blank guide email");
  }
  if (isFwStudentAddress(normalized)) {
    throw new Error(
      `buildFwGuideCreateUserPayload: refusing to mint a guide account inside the FW student namespace (${normalized})`
    );
  }
  return { email: normalized, email_confirm: true, app_metadata: { role: FW_GUIDE_ROLE } };
}

/**
 * Whether an auth account is one this system minted as an FW guide.
 *
 * THE SAME PREDICATE GUARDS ALL THREE CREDENTIAL OPERATIONS, and the reason is
 * escalation rather than tidiness — each of them can hand someone control of the
 * account it names:
 *
 *   1. provisioning's `email_exists` branch — may this existing account be
 *      ADOPTED as the guide for a new grant?
 *   2. invite issue/re-issue — may this account be mailed a link that SETS ITS
 *      PASSWORD?
 *   3. the claim itself — may this password write land on this account?
 *
 * Adopting or crediting a parent's, a student's, or — worst — a staff member's
 * account would turn "add a guide" into "mail a working credential for that
 * person's account to whoever staff typed in the address field". All three call
 * sites check independently, so no one of them is load-bearing alone.
 */
export function isGuideAccount(account: {
  app_metadata?: Record<string, unknown> | null;
} | null): boolean {
  return account?.app_metadata?.role === FW_GUIDE_ROLE;
}

/* ─────────────────────────────────────────────── guide invites (Decision 12) ── */

/**
 * Guide invites live FOURTEEN days — their own constant, deliberately not the
 * parent invite's seven (PARENT_INVITE_TTL_MS).
 *
 * The plan's arithmetic (Decision 12): a single build-complete issuance would
 * die before or during Hamptons, so invites are issued PER EVENT — the Boston
 * batch at build-complete, the Hamptons batch during patch week — and 14 days
 * covers the gap between issuing a batch and the doors opening without leaving a
 * standing credential alive for a month. The pre-event checklist's "all guides
 * claimed" line is what surfaces a dead link before Friday rather than at it.
 */
export const FW_GUIDE_INVITE_TTL_MS = 14 * 24 * 60 * 60_000;

/** One `path_fw_guide_invites` row, reduced to what the verdict needs. */
export type FwGuideInviteRecord = {
  expiresAt: string;
  claimedAt: string | null;
};

export type FwGuideInviteVerdict =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_claimed" | "expired" };

/**
 * The claim-page decision — the `inviteVerdict` sibling for guide credentials.
 *
 * Order matters and mirrors its template: existence, then single-use, then
 * expiry. A malformed expiry parses to NaN and `NaN > now` is false → expired,
 * which is fail-CLOSED; the inverse (`<= now` → dead) would read a garbage
 * timestamp as a live invite.
 *
 * Deliberately WITHOUT the parent invite's session-email match. A guide invite
 * is bound to a specific pre-created account and its claim sets THAT account's
 * password, then signs the claimer in as that guide — so whoever holds the link
 * is the guide, and an existing session on the (shared, rotating) event iPad is
 * replaced rather than treated as a conflict. That is the intended event-day
 * behaviour, and it is why the token is treated as the credential it is: 256
 * bits, hash-only at rest, single-use, per-IP rate-limited at claim.
 *
 * All three refusals render ONE dead-link message. Distinguishing them would
 * tell an unauthenticated caller whether a token ever existed.
 */
export function fwGuideInviteVerdict({
  invite,
  now,
}: {
  invite: FwGuideInviteRecord | null;
  now: number;
}): FwGuideInviteVerdict {
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.claimedAt !== null) return { ok: false, reason: "already_claimed" };
  const expiresMs = Date.parse(invite.expiresAt);
  if (!(expiresMs > now)) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** The expiry stamp a freshly issued (or re-issued) guide invite carries. */
export function fwGuideInviteExpiry(now: number): string {
  return new Date(now + FW_GUIDE_INVITE_TTL_MS).toISOString();
}

/**
 * Whether a failed claim attempt should KEEP its per-IP rate-limit strike or
 * RELEASE it — pure so the policy is testable, because the action layer that
 * applies it has no test harness in this repo (next/headers).
 *
 * The distinction is the one the rate-limiter learning states: a strike exists
 * to bound TOKEN GUESSING, so only an attempt that was actually a guess may cost
 * one.
 *
 *   dead_link      → KEEP. This is the guess. It is also the only outcome an
 *                    attacker with a wrong token can provoke.
 *   weak_password  → RELEASE. The token was already verified live; the guide
 *                    simply chose a password below the floor. Charging for it
 *                    would let a guide lock themselves out by typing "12345"
 *                    ten times at the check-in table.
 *   unavailable    → RELEASE. An outage is not an attempt (the sign-in action's
 *                    documented store contract). This one is load-bearing after
 *                    the reliability review: an Auth API blip during the
 *                    Friday-morning claim rush must not silently consume the
 *                    venue's shared per-IP budget.
 *
 * An inverted condition here is invisible until an event morning, which is
 * exactly why it is pinned by test rather than left inline in the action.
 */
export function fwClaimStrikeDisposition(
  reason: "dead_link" | "weak_password" | "unavailable"
): "keep" | "release" {
  return reason === "dead_link" ? "keep" : "release";
}
