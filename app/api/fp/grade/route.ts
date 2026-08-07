/**
 * POST /api/fp/grade — the First Profit SPA's ask-once BIRTH-YEAR capture
 * (full-path cohort readiness plan, Unit 3; R9, R10). An authenticated
 * cross-origin POST carrying the CHILD's Bearer session token (minted by
 * /api/fp/login) and `{birthYear}`; on acceptance — and only when BOTH roster
 * columns are still unset (the fill-only provenance guard below) — it writes
 * `children.birth_year` (text, matching the column's existing string format)
 * plus the derived `children.grade` (keeps roster tooling working) via the
 * service role, and returns `{ok:true, grade}` so the client can adopt the
 * band without a re-login.
 *
 * ── FILL-ONLY: the provenance guard ──
 * `children.grade` is PARENT/STAFF-AUTHORITATIVE roster truth across The120
 * (progress-core derives the band from children.grade, AddFounder and
 * provision-core's bandVerdictForGrade write it from staff/parent input, the
 * CRM dossier and the sibling-adoption conflict logic read it as truth). A
 * child-typed value must never REPLACE that truth: this route only fills a
 * blank, never overwrites. After resolving the child row it reads the current
 * birth_year + grade; if EITHER is already set (birth_year a non-empty
 * string, or grade non-null) it performs NO write and returns 200 {ok:true,
 * grade} carrying the same derived-at-read value the login route would
 * produce for that row (resolveChildGrade) — idempotent, no oracle (it is the
 * caller's own row), and the client adopts the authoritative value. Only when
 * BOTH are unset does the write proceed. The SPA's ask-once flow only fires
 * on a null grade anyway — this guard closes the direct-call path.
 *
 * Thin impure wrapper over ./grade-rules (pure, tested). CORS MIRROR of
 * /api/fp/login and /api/fp/signup/child: OPTIONS 204 with the echoed origin,
 * 403 for a bad Origin, ONE generic 401 for every refusal (byte-identical
 * body; the reason lives only in the server log — no oracle), Cache-Control
 * no-store, Vary: Origin, attested-IP extraction, an atomic rate-limit strike
 * BEFORE any DB I/O with release-on-outage, force-dynamic.
 *
 * ── The IDOR guard ──
 * The write runs with the SERVICE ROLE, so this route is the only guard: the
 * target roster row is ALWAYS resolved server-side from the session identity
 * (auth.getUser → path_student_profiles.child_id, the same gate the login
 * route runs) and NEVER from the request body. A child id in the body does
 * not exist as a concept here.
 *
 * ── No new timing oracle ──
 * The session token IS the identity — no code path branches on whether some
 * OTHER account exists, so the constant-response-is-not-constant-timing
 * learning requires no equalization here. Pre-DB refusals (malformed body,
 * implausible birth year, undecodable token) reflect only the caller's own
 * input, mirroring the login route's scoped-honesty posture.
 *
 * ── Coerce-not-raise posture ──
 * The write is a TARGETED update of only the two columns this feature owns
 * (birth_year, grade) — never a full-row upsert — so the children_status_guard
 * trigger (BEFORE UPDATE OF status) does not even fire, and the service role
 * bypasses it regardless. If some future roster trigger coerces the payload,
 * the statement still lands (stale-status-echo learning): the route verifies
 * the echo, logs a VALUE-FREE warning on a mismatch, and still returns ok —
 * the roster keeps its authority, the client's band is display-only, and the
 * next login re-derives from whatever the roster actually stored.
 *
 * NEVER log the birth year, the derived grade, or the token — the same rule
 * as the login route's never-log-credentials convention.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
} from "../login/login-rules";
import {
  birthYearVerdict,
  deriveGradeRateLimitKeys,
  extractBearerToken,
  GRADE_IP_RATE_LIMIT,
  GRADE_RATE_LIMIT,
  parseGradeRequest,
  resolveChildGrade,
  shapeGradeRefusal,
  unverifiedJwtSub,
  type GradeRefusalReason,
} from "./grade-rules";

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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      // `authorization` — this surface takes the child's Bearer session token.
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
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
  const refuse = (reason: GradeRefusalReason): Response => {
    const shaped = shapeGradeRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  // Everything past the Origin gate is wrapped: an unhandled throw must
  // surface as the SAME byte-identical 401, never Next's default error page —
  // a different response SHAPE is an oracle. A throw fails closed (strikes
  // stand), which is the safe direction; each I/O site releases explicitly.
  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse("missing_token");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse("malformed_request");
    }
    const parsed = parseGradeRequest(body);
    if (!parsed.ok) return refuse("malformed_request");

    // Pure write gate BEFORE any I/O: an implausible birth year (derived
    // grade outside the 3-12 gradeVerdict discipline — refuse, never clamp)
    // reflects only the caller's own input. NOTE the read/write asymmetry
    // documented in grade-rules: the login READ returns whatever derives.
    const gradeCheck = birthYearVerdict(parsed.birthYear, new Date());
    if (!gradeCheck.ok) return refuse(gradeCheck.reason);

    // The per-user bucket segment is the token's UNVERIFIED sub — a bucket
    // key only, never an identity (grade-rules pins the rationale). A token
    // without a decodable sub can never verify, so refuse it pre-DB.
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse("invalid_token");

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveGradeRateLimitKeys(ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };

    // Gate FIRST — atomically, before any DB I/O (house limiter discipline).
    // Record BOTH buckets before the verdict so the per-IP aggregate keeps
    // accumulating for a saturated user bucket. The refusal is the SAME
    // generic 401 — never a 429. No on-success clear: this is a WRITE
    // endpoint, so every accepted write deliberately consumes budget.
    const userCheck = checkAndRecordRateLimit(userKey, GRADE_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, GRADE_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    // Verify the token: a per-request anon client whose every call carries it
    // (the helper is identity-agnostic despite its parent-signup name — it
    // just binds the Bearer header). getUser() is what proves the JWT is
    // genuine and unexpired; a network throw is an outage, not a guess.
    let userId: string;
    try {
      const who = await supabaseParentToken(token).auth.getUser();
      if (who.error || !who.data?.user) {
        // An invalid/expired token is a real failed attempt: strike stands.
        return refuse("invalid_token");
      }
      userId = who.data.user.id;
    } catch (err) {
      console.error(
        `[fp/grade] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    const admin = supabaseAdmin();

    // Resolve the roster row SERVER-SIDE from the session identity ONLY —
    // the same user_id → child_id gate the login route runs. This is the
    // service-role write's sole IDOR guard; no child id is ever accepted
    // from the body.
    const gate = await admin
      .from("path_student_profiles")
      .select("child_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (gate.error) {
      console.error(`[fp/grade] child gate query failed: ${gate.error.message}`);
      releaseStrikes();
      return refuse("outage");
    }
    if (!gate.data || typeof gate.data.child_id !== "string") {
      // A genuine session that is not a child session: refuse generically;
      // the strike stands (this surface is for children only).
      return refuse("not_child");
    }

    // ── FILL-ONLY provenance guard ── children.grade is parent/staff-
    // authoritative roster truth (see the header): this route only fills a
    // blank, never overwrites. Read the caller's own row first; when either
    // column is already set, skip the write entirely and answer with the same
    // derived-at-read value the login route would produce — idempotent, and
    // no oracle (the row is the session's own child).
    const current = await admin
      .from("children")
      .select("birth_year, grade")
      .eq("id", gate.data.child_id)
      .maybeSingle();
    if (current.error) {
      console.error(`[fp/grade] roster read failed: ${current.error.message}`);
      releaseStrikes();
      return refuse("outage");
    }
    if (!current.data) {
      // A mapped child whose children row is gone is a data fault, not a
      // guess — release and refuse generically.
      console.error(`[fp/grade] roster row missing for mapped child`);
      releaseStrikes();
      return refuse("outage");
    }
    const rosterBirthYear =
      typeof current.data.birth_year === "string" ? current.data.birth_year : "";
    const rosterGrade =
      typeof current.data.grade === "number" && Number.isInteger(current.data.grade)
        ? current.data.grade
        : null;
    if (rosterBirthYear !== "" || current.data.grade != null) {
      // Already filled: the roster keeps its authority. Same normalization as
      // the login route's candidate parse, same derivation. Never logged.
      return new Response(
        JSON.stringify({
          ok: true,
          grade: resolveChildGrade(
            { birthYear: rosterBirthYear, storedGrade: rosterGrade },
            new Date()
          ),
        }),
        { status: 200, headers }
      );
    }

    // Targeted update of ONLY the columns this feature owns — birth_year in
    // the column's existing string form, grade as the derived int (keeps
    // roster tooling working). Echoed back for the coerce-not-raise check.
    const written = await admin
      .from("children")
      .update({ birth_year: String(parsed.birthYear), grade: gradeCheck.grade })
      .eq("id", gate.data.child_id)
      .select("birth_year, grade")
      .maybeSingle();
    if (written.error) {
      console.error(`[fp/grade] roster write failed: ${written.error.message}`);
      releaseStrikes();
      return refuse("outage");
    }
    if (!written.data) {
      // A mapped child whose children row is gone is a data fault, not a
      // guess — release and refuse generically.
      console.error(`[fp/grade] roster row missing for mapped child`);
      releaseStrikes();
      return refuse("outage");
    }
    if (
      written.data.birth_year !== String(parsed.birthYear) ||
      written.data.grade !== gradeCheck.grade
    ) {
      // A roster trigger coerced the payload (stale-status-echo learning:
      // coerce-not-raise means acceptance ≠ the row is what we asked for).
      // The roster keeps its authority; the client's band is display-only and
      // the next login re-derives from what actually stored. VALUE-FREE log.
      console.error(`[fp/grade] roster write coerced by a trigger; stored values differ`);
    }

    // The derived grade rides back so the client adopts the band without a
    // re-login. Never logged.
    return new Response(JSON.stringify({ ok: true, grade: gradeCheck.grade }), {
      status: 200,
      headers,
    });
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/grade] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
