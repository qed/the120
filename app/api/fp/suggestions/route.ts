/**
 * GET /api/fp/suggestions — the STAFF-ONLY listing of First Profit feedback
 * (task-level "Stuck? Tell us" reports AND app-level suggestions,
 * fp_task_feedback + migration 20260910120000_fp_feedback_kind.sql) for the
 * FP admin view at firstprofit.school/admin.
 *
 * ── CONTRACT (for the FP admin client) ──
 *   GET /api/fp/suggestions
 *   Origin: an allowed FP origin (exact match — the child-gateway CORS list)
 *   Authorization: Bearer <staff Supabase session access token>
 *
 *   200 {ok: true, suggestions: [{
 *          id:        string   // the feedback row's uuid
 *          kind:      "task" | "app"
 *          taskId:    string   // "1.2.5" — for kind "app" this is the task
 *                              // ACTIVE at submission, not the subject
 *          username:  string | null  // children.fp_username via the profile
 *                              // join; profile handle for pre-backfill rows;
 *                              // null only on a broken join (logged)
 *          body:      string   // may be "" (tap-only stuck signal)
 *          createdAt: string   // timestamptz ISO
 *        }]}
 *   newest first, capped at SUGGESTIONS_PAGE_CAP (200) rows. No pagination
 *   cursor yet — the cap IS the window (admin triage view, not an export).
 *
 *   401 — byte-identical for EVERY refusal (missing/bad token, a genuine
 *   non-staff session, rate limit, outage): same body as the FP login
 *   surface. 403 only for a disallowed Origin. Never a 429, never a reasoned
 *   error body — the reason lives only in the server log (no oracle).
 *
 * ── The staff gate (see suggestions-rules.ts for the full rationale) ──
 * Staff are Supabase auth users in the SHARED project (scripts/seed-staff.ts),
 * so the Bearer token resolves with the same auth.getUser() the child gateway
 * uses; the verdict then mirrors requireStaff (app/crm/lib/auth.ts): the
 * server-set app_metadata.role claim AND an is_active public.staff row, both
 * with a role in SUGGESTIONS_ALLOWED_STAFF_ROLES. A CHILD's genuine session
 * fails the claim half and is refused byte-identically to a forged token —
 * this surface must not exist for them.
 *
 * CORS MIRROR of /api/fp/grade (the child-gateway discipline, staff gate
 * swapped in for the fp_player_profiles gate): OPTIONS 204 with the echoed
 * origin, 403 for a bad Origin, ONE generic 401, Cache-Control no-store,
 * Vary: Origin, attested-IP extraction, an atomic rate-limit strike BEFORE
 * any DB I/O with release-on-outage, force-dynamic.
 *
 * ── Reads, not embeds ──
 * The username join runs as batched id-set lookups (feedback → profiles →
 * children), the exact pattern of scripts/read-fp-task-feedback.ts, rather
 * than a PostgREST embedded select — same proven path, and the in-memory
 * fake-supabase harness can exercise it. All reads run with the SERVICE ROLE
 * (children have no SELECT grant on fp_task_feedback by design); the staff
 * gate above is therefore the sole authorization for this data.
 *
 * NEVER log a body, a username, or the token — child data + credentials, the
 * same never-log rule as the login surface.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/fp/lib/rate-limit-store";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
} from "../login/login-rules";
import { extractBearerToken, unverifiedJwtSub } from "../grade/grade-rules";
import {
  deriveSuggestionsRateLimitKeys,
  isAllowedStaffRole,
  shapeSuggestions,
  shapeSuggestionsRefusal,
  SUGGESTIONS_IP_RATE_LIMIT,
  SUGGESTIONS_PAGE_CAP,
  SUGGESTIONS_RATE_LIMIT,
  type ChildRowLike,
  type FeedbackRowLike,
  type ProfileRowLike,
  type SuggestionsRefusalReason,
} from "./suggestions-rules";

export const dynamic = "force-dynamic";

/** Headers for responses to an allowed origin. Never `*`, never credentials. */
function corsJsonHeaders(origin: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": verdict.origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      // `authorization` — this surface takes the staff member's Bearer token.
      "Access-Control-Allow-Headers": "authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function GET(req: Request): Promise<Response> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  const headers = corsJsonHeaders(verdict.origin);
  const refuse = (reason: SuggestionsRefusalReason): Response => {
    const shaped = shapeSuggestionsRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  // Everything past the Origin gate is wrapped: an unhandled throw must
  // surface as the SAME byte-identical 401, never Next's default error page —
  // a different response SHAPE is an oracle. A throw fails closed (strikes
  // stand); each I/O site releases explicitly.
  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse("missing_token");

    // The per-user bucket segment is the token's UNVERIFIED sub — a bucket
    // key only, never an identity (grade-rules pins the rationale). A token
    // without a decodable sub can never verify, so refuse it pre-DB.
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse("invalid_token");

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveSuggestionsRateLimitKeys(ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };

    // Gate FIRST — atomically, before any DB I/O (house limiter discipline).
    // Record BOTH buckets before the verdict so the per-IP aggregate keeps
    // accumulating for a saturated user bucket. The refusal is the SAME
    // generic 401 — never a 429.
    const userCheck = checkAndRecordRateLimit(userKey, SUGGESTIONS_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, SUGGESTIONS_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    // Verify the token: getUser() proves the JWT is genuine and unexpired
    // (the helper is identity-agnostic despite its parent-signup name — it
    // just binds the Bearer header). A network throw is an outage, not a
    // guess about the account.
    let userId: string;
    let claimRole: unknown;
    try {
      const who = await supabaseParentToken(token).auth.getUser();
      if (who.error || !who.data?.user) {
        // An invalid/expired token is a real failed attempt: strike stands.
        return refuse("invalid_token");
      }
      userId = who.data.user.id;
      claimRole = (who.data.user.app_metadata as Record<string, unknown> | undefined)?.role;
    } catch (err) {
      console.error(
        `[fp/suggestions] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    // ── Staff gate, half 1: the server-set JWT claim (requireStaff's outer
    // fence). Every child/parent session fails here and is refused with the
    // byte-identical 401 — no probe can tell this from a bad password.
    if (!isAllowedStaffRole(claimRole)) return refuse("not_staff");

    const admin = supabaseAdmin();

    // ── Staff gate, half 2: the staff ROW (revocation lives here — flipping
    // is_active shuts the door without waiting out token expiry). The row's
    // role must ALSO be in the allowed set: the claim says what the token was
    // minted as, the row says what the account IS today.
    const staffQuery = await admin
      .from("staff")
      .select("id, role, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (staffQuery.error) {
      console.error(`[fp/suggestions] staff row lookup failed: ${staffQuery.error.message}`);
      releaseStrikes();
      return refuse("outage");
    }
    const staffRow = staffQuery.data as
      | { id: string; role: unknown; is_active: unknown }
      | null;
    if (!staffRow || staffRow.is_active !== true || !isAllowedStaffRole(staffRow.role)) {
      // A genuine session that is not (or no longer) active staff: refuse
      // generically; the strike stands. Logged so on-call can tell a revoked
      // colleague from an attack wave — VALUE-FREE beyond the user id.
      console.error(
        `[fp/suggestions] staff gate refused ${userId}: ` +
          (staffRow ? "row inactive or role not allowed" : "no staff row")
      );
      return refuse("not_staff");
    }

    // ── The listing: newest first, capped. Service-role reads (children have
    // no SELECT on this table by design — the gate above is the authorization).
    const feedback = await admin
      .from("fp_task_feedback")
      .select("id, profile_id, kind, task_id, body, created_at")
      .order("created_at", { ascending: false })
      .limit(SUGGESTIONS_PAGE_CAP);
    if (feedback.error) {
      console.error(`[fp/suggestions] feedback query failed: ${feedback.error.message}`);
      releaseStrikes();
      return refuse("outage");
    }
    const rows = (feedback.data ?? []) as FeedbackRowLike[];

    // Batched username join (the read-script pattern): feedback → profiles →
    // children.fp_username. Empty id-sets skip the round trip entirely.
    const profileIds = [...new Set(rows.map((r) => r.profile_id))];
    let profiles: ProfileRowLike[] = [];
    if (profileIds.length > 0) {
      const profilesQuery = await admin
        .from("fp_player_profiles")
        .select("id, handle, child_id")
        .in("id", profileIds);
      if (profilesQuery.error) {
        console.error(`[fp/suggestions] profiles query failed: ${profilesQuery.error.message}`);
        releaseStrikes();
        return refuse("outage");
      }
      profiles = (profilesQuery.data ?? []) as ProfileRowLike[];
    }

    const childIds = [...new Set(profiles.map((p) => p.child_id))];
    let children: ChildRowLike[] = [];
    if (childIds.length > 0) {
      const childrenQuery = await admin
        .from("children")
        .select("id, fp_username")
        .in("id", childIds);
      if (childrenQuery.error) {
        console.error(`[fp/suggestions] children query failed: ${childrenQuery.error.message}`);
        releaseStrikes();
        return refuse("outage");
      }
      children = (childrenQuery.data ?? []) as ChildRowLike[];
    }

    const suggestions = shapeSuggestions(rows, profiles, children);
    // Broken joins are a data fault worth a VALUE-FREE breadcrumb (the item
    // still ships with username null — the admin sees the report either way).
    const broken = suggestions.filter((s) => s.username === null).length;
    if (broken > 0) {
      console.error(`[fp/suggestions] ${broken} row(s) with an unresolvable username join`);
    }

    return new Response(JSON.stringify({ ok: true, suggestions }), {
      status: 200,
      headers,
    });
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/suggestions] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
