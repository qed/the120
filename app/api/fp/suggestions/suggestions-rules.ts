/**
 * Pure decision rules for GET /api/fp/suggestions — the STAFF-ONLY listing of
 * fp_task_feedback rows (task-level stuck reports AND app-level suggestions,
 * migration 20260910120000_fp_feedback_kind.sql) that feeds the FP admin view
 * at firstprofit.school/admin. No Next, no Supabase — only decisions, per the
 * house pure-module convention (../grade/grade-rules.ts is the sibling
 * precedent; this module reuses login-rules' origin/IP contract and
 * grade-rules' bearer/sub helpers via the route rather than duplicating them).
 *
 * ── The staff gate, stated once ──
 * Staff ARE Supabase auth users in the SHARED project (scripts/seed-staff.ts
 * creates them against the same NEXT_PUBLIC_SUPABASE_URL the FP children use),
 * so a staff member signed in from the firstprofit.school origin presents a
 * Bearer token this endpoint can verify with auth.getUser() exactly like the
 * child gateway does. The verdict then mirrors requireStaff (app/crm/lib/
 * auth.ts) — BOTH halves must pass, in this order:
 *   1. JWT claim: app_metadata.role must be in the allowed set (server-set by
 *    seed-staff via the admin API; a client can never write app_metadata), and
 *   2. staff row: public.staff has the user's id with is_active AND a role in
 *      the allowed set (revocation = flip is_active, no token invalidation
 *      needed).
 * A genuine CHILD session fails the claim half — refused with the SAME
 * byte-identical 401 as a bad token (a child must not be able to learn this
 * endpoint exists any more than an attacker can).
 *
 * ── Role vocabulary ──
 * The staff table's CHECK is `role in ('admin')` (20260713110000_crm_core.sql)
 * and seed-staff.ts stamps both the claim and the row 'admin' — 'admin' is the
 * ENTIRE production vocabulary today. The requested super-admin/admin/staff
 * tiers do not exist as values anywhere; when they are minted (a staff-table
 * CHECK widening + seed changes), add them HERE and the parity test against
 * the crm_core CHECK will hold the two lists together.
 *
 * ── Refusal posture ──
 * ONE refusal (child-gateway discipline): `shapeSuggestionsRefusal` takes a
 * reason (for logs and tests) and deliberately ignores it — every refusal is
 * the same 401 with a byte-identical body (same copy as the login/grade
 * surfaces: one voice, no oracle). 403 exists only for a disallowed Origin.
 *
 * ── Response contract (documented for the FP admin client in route.ts) ──
 * 200 {ok:true, suggestions:[{id, kind, taskId, username, body, createdAt}]}
 * newest first, capped at SUGGESTIONS_PAGE_CAP.
 */

import { SIGN_IN_FAILED_MESSAGE } from "@/app/fp/lib/provision-rules";
import type { RateLimitConfig } from "@/app/fp/lib/rate-limit-rules";
import {
  normalizeFeedbackKind,
  type FeedbackKind,
} from "@/app/fp/lib/fp-task-feedback-rules";

/* -------------------------------------------------------------- staff roles */

/**
 * staff.role values allowed through this endpoint. Today this is the ENTIRE
 * role vocabulary (see the module header); the parity test pins this list to
 * the crm_core migration's CHECK so a DB widening cannot silently diverge.
 */
export const SUGGESTIONS_ALLOWED_STAFF_ROLES = ["admin"] as const;

export function isAllowedStaffRole(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (SUGGESTIONS_ALLOWED_STAFF_ROLES as readonly string[]).includes(value)
  );
}

/* ----------------------------------------------------------------- page cap */

/** Upper bound on rows per response — an admin triage view, not an export
 *  (mirrors scripts/read-fp-task-feedback.ts's MAX_ROWS posture). */
export const SUGGESTIONS_PAGE_CAP = 200;

/* --------------------------------------------------------- refusal shaping */

export type SuggestionsRefusalReason =
  | "missing_token"
  | "invalid_token"
  | "not_staff"
  | "rate_limited"
  | "outage";

// Serialized ONCE at module load: refusals are byte-identical by construction,
// not by convention. Same copy as the login/grade surfaces (one voice — a
// child or an attacker probing this staff URL sees exactly what a bad login
// shows them, no new oracle).
const REFUSAL_BODY = JSON.stringify({ success: false, error: SIGN_IN_FAILED_MESSAGE });

export const SUGGESTIONS_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for
 *  the tests that pin indistinguishability — the OUTPUT never varies with it. */
export function shapeSuggestionsRefusal(
  reason: SuggestionsRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: SUGGESTIONS_REFUSAL_STATUS, body: REFUSAL_BODY };
}

/* ---------------------------------------------------------- rate limiting */

/**
 * Staff triage budgets in this route's OWN namespace (never shared with the
 * child surfaces): a staff member refreshing an admin list is bursty but low
 * volume; the per-IP aggregate bounds a stolen-token or scripted reader. Same
 * window shape as the sibling FP routes by design.
 */
export const SUGGESTIONS_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 60 };
export const SUGGESTIONS_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 120 };

/**
 * Composite keys with BOTH segments `encodeURIComponent`-escaped before the
 * `:` join — an IPv6 ip or a `:` in a forged sub must never alias two distinct
 * (ip,user) pairs onto one bucket (see docs/solutions/security-issues/
 * composite-rate-limit-key-string-join-collides-*.md).
 */
export function deriveSuggestionsRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeURIComponent(ip);
  return {
    userKey: `fp-suggestions:${ipEnc}:${encodeURIComponent(userSegment)}`,
    ipKey: `fp-suggestions-ip:${ipEnc}`,
  };
}

/* ------------------------------------------------------------ row shaping */

/** One item of the response contract. */
export type SuggestionItem = {
  id: string;
  kind: FeedbackKind;
  taskId: string;
  /** children.fp_username via the profile join; falls back to the profile's
   *  public handle for pre-backfill rows whose fp_username is still null, and
   *  to null only when even the join is broken (profile/child row missing —
   *  logged by the route, never hidden). */
  username: string | null;
  body: string;
  createdAt: string;
};

export type FeedbackRowLike = {
  id: string;
  profile_id: string;
  kind?: unknown;
  task_id: string;
  body: string;
  created_at: string;
};

export type ProfileRowLike = { id: string; handle: string; child_id: string };
export type ChildRowLike = { id: string; fp_username?: unknown };

/**
 * Pure join + projection: DB rows (already newest-first and capped by the
 * query) → the response contract. `kind` is normalized through the shared
 * rules-module normalizer so a row read before the kind migration applied
 * (no column) reads as 'task' — the same meaning the column default encodes.
 */
export function shapeSuggestions(
  rows: readonly FeedbackRowLike[],
  profiles: readonly ProfileRowLike[],
  children: readonly ChildRowLike[]
): SuggestionItem[] {
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const childById = new Map(children.map((c) => [c.id, c]));
  return rows.map((r) => {
    const profile = profileById.get(r.profile_id);
    const child = profile ? childById.get(profile.child_id) : undefined;
    const fpUsername =
      child && typeof child.fp_username === "string" && child.fp_username.length > 0
        ? child.fp_username
        : null;
    return {
      id: r.id,
      kind: normalizeFeedbackKind(r.kind),
      taskId: r.task_id,
      username: fpUsername ?? profile?.handle ?? null,
      body: r.body,
      createdAt: r.created_at,
    };
  });
}
