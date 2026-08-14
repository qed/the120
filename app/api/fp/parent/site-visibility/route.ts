/**
 * POST /api/fp/parent/site-visibility — the First Profit SPA's cross-origin
 * door for an authenticated PARENT to take ONE of their own children's public
 * pages OFFLINE, or put it back.
 *
 * The canonical sibling is ../reset-password/route.ts and this is a deliberate
 * mirror of it: same origin gate, same bearer extraction, same service-role
 * parent-row gate keyed on the AUTHENTICATED id, same atomic rate-limit strike
 * BEFORE any DB I/O with release-on-outage, same ONE byte-identical 401 for
 * every authorization-shaped refusal, 403 only for a bad Origin, no-store,
 * force-dynamic, OPTIONS 204. Read that route beside this one — where the two
 * differ, the difference is commented here.
 *
 * ── CONTRACT (for the FP parent client) ──
 *   POST /api/fp/parent/site-visibility
 *   Origin: an allowed FP origin (exact match — the child-gateway CORS list)
 *   Authorization: Bearer <parent Supabase session access token>
 *   {"childId": "<children.id>", "published": true|false}   — strict; any other
 *   key (a `handle` included) is malformed.
 *
 *   200 {ok:true} — the flip landed. The SPA re-reads the roster (whose `site`
 *   field carries the DERIVED `published`) for the new state, so this door
 *   never becomes a second answer to "is the page live".
 *
 *   401 — byte-identical for EVERY authorization-shaped refusal (missing/blank
 *   token, a bad or expired token, a NON-PARENT session, a malformed body,
 *   ANOTHER FAMILY'S CHILD, a child with no page, a never-published page, rate
 *   limit, outage). 403 only for a disallowed Origin. Never a 429, never a
 *   reasoned body, never a per-reason HEADER — the reason lives only in the
 *   server log.
 *
 * ── OWNERSHIP IS THE SECURITY BOUNDARY, AND IT LIVES IN THE CORE ──
 * The caller-supplied `childId` is an IDENTIFIER AND AUTHORIZES NOTHING: it
 * goes into `setSitePublishedForParent`'s WHERE clause beside the parent id
 * `auth.getUser()` returned, so a child this parent does not own matches NO
 * ROW. The site itself is never addressed by a client-supplied key at all —
 * `profile_id` is DERIVED from the child row the WHERE clause just authorized.
 *
 * ⚠ THAT CHECK IS NOT DUPLICATED HERE, ON PURPOSE. A second ownership gate in
 * this route would look like defense in depth and would in fact be the
 * opposite: it would keep the route green while the core's predicate rotted,
 * which is precisely the failure a cross-parent test is supposed to catch.
 *
 * ── WHY THE CORE, AND NOT THE SERVER ACTION ──
 * `setFpSitePublishedAction` reads the caller from the COOKIE session, which no
 * cross-origin bearer request has. Calling the action would mean either sending
 * cookies cross-origin or teaching it a second identity source; calling the
 * CORE keeps ONE implementation of the toggle with the caller injected, which
 * is what the core's `ctx` parameter exists for. The operator lock, the
 * never-published rule and the "published only" UPDATE payload all come along
 * unchanged — in particular a republish while operator-locked flips the flag
 * and the page STAYS OFFLINE, which is what the roster will then report.
 *
 * ── Never-log discipline (R3) ──
 * NEVER log the bearer token, the handle or a child's name. The ONE success
 * breadcrumb is the parent's user id, the child id, the direction and the
 * timestamp — enough to answer "who took whose page offline, when".
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import { withFwTimeout } from "@/app/lib/fp/fw-call";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
} from "../../login/login-rules";
import { extractBearerToken, unverifiedJwtSub } from "../../grade/grade-rules";
import {
  setSitePublishedForParent,
  type ParentSiteDeps,
  type ParentSiteToggleResult,
} from "@/app/lib/fp/fp-site-parent-core";
import {
  deriveSiteVisibilityRateLimitKeys,
  parseSiteVisibilityRequest,
  refundsSiteVisibilityStrike,
  shapeSiteVisibilityRefusal,
  SITE_VISIBILITY_IP_RATE_LIMIT,
  SITE_VISIBILITY_OK_BODY,
  SITE_VISIBILITY_RATE_LIMIT,
  SITE_VISIBILITY_READ_TIMEOUT_MS,
  SITE_VISIBILITY_TOTAL_BUDGET_MS,
  type SiteVisibilityRefusalReason,
} from "./site-visibility-rules";

export const dynamic = "force-dynamic";

/**
 * The PLATFORM's invocation ceiling, pinned in code rather than left to
 * whatever the default happens to be on the day. The outermost of three nested
 * budgets, only the inner two of which are ours:
 *
 *   SITE_VISIBILITY_READ_TIMEOUT_MS (8 s)   — one round trip
 *   SITE_VISIBILITY_TOTAL_BUDGET_MS (30 s)  — the whole invocation, ours
 *   maxDuration                     (60 s)  — the whole invocation, the platform's
 *
 * The 30 s of headroom under `maxDuration` is what guarantees the last word is
 * OUR refusal — one voice, CORS headers intact — rather than the platform's
 * CORS-less error page.
 */
export const maxDuration = 60;

/* -------------------------------------------------------------------- CORS */

/** Headers for responses to an allowed origin. Never `*`, never credentials.
 *  Identical for the 200 and for EVERY 401 — headers are exactly where a
 *  per-reason oracle (a stray Retry-After) creeps back in. */
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
      // `authorization` — the parent's Bearer token. `content-type` — the JSON
      // body, which is what makes this a non-simple request needing a preflight
      // at all.
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  // Stamped before anything else so every line this invocation emits can say
  // how long it had been running, and so the deadline is measured from the
  // handler's first instruction rather than from the first I/O call.
  const t0 = Date.now();
  const elapsed = (): string => `${Date.now() - t0}ms`;
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    // No CORS echo on a rejected origin — the browser must not be told the
    // request was acceptable in any respect.
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  const headers = corsJsonHeaders(verdict.origin);
  /** The byte-identical 401. Every reason logs a VALUE-FREE line — the reason
   *  code and the elapsed time, nothing about the caller or the child. */
  const refuse = (reason: SiteVisibilityRefusalReason): Response => {
    console.error(`[fp/parent/site-visibility] refused: ${reason} after ${elapsed()}`);
    const shaped = shapeSiteVisibilityRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  // Everything past the Origin gate is wrapped: an unhandled throw must surface
  // as the SAME byte-identical 401, never Next's default error page — a
  // different response SHAPE is an oracle. A throw fails closed (strikes
  // stand); each I/O site releases explicitly.
  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse("missing_token");

    // The per-user bucket segment is the token's UNVERIFIED sub — a bucket key
    // only, NEVER an identity (grade-rules pins the rationale; the identity
    // used for scoping below comes from auth.getUser() and nowhere else). A
    // token without a decodable sub can never verify, so refuse it pre-DB.
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse("invalid_token");

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveSiteVisibilityRateLimitKeys(ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };

    // Gate FIRST — atomically, before the body is even read and before any DB
    // I/O (house limiter discipline). Record BOTH buckets before the verdict so
    // the per-IP aggregate keeps accumulating for a saturated user bucket. The
    // refusal is the SAME generic 401 — never a 429.
    const userCheck = checkAndRecordRateLimit(userKey, SITE_VISIBILITY_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, SITE_VISIBILITY_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse("malformed_request");
    }
    const parsed = parseSiteVisibilityRequest(body);
    // A malformed body is a real failed attempt, not our fault: strike stands.
    if (!parsed.ok) return refuse("malformed_request");

    // ONE deadline for the whole invocation, handed out as REMAINING budget at
    // every I/O site below (see SITE_VISIBILITY_TOTAL_BUDGET_MS).
    const deadlineAt = t0 + SITE_VISIBILITY_TOTAL_BUDGET_MS;
    const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());
    const budgetFor = (): number =>
      Math.min(SITE_VISIBILITY_READ_TIMEOUT_MS, remainingMs() || 1);

    // ── Gate 1: the token is genuine. getUser() proves the JWT is real and
    // unexpired. A network throw is an outage, not a guess about the account.
    let userId: string;
    try {
      const raced = await withFwTimeout(
        supabaseParentToken(token).auth.getUser(),
        "fp/parent/site-visibility token verification",
        budgetFor()
      );
      if (raced.timedOut) {
        releaseStrikes();
        return refuse("outage");
      }
      const who = raced.value;
      if (who.error || !who.data?.user) {
        // An invalid/expired token is a real failed attempt: strike stands.
        return refuse("invalid_token");
      }
      userId = who.data.user.id;
    } catch (err) {
      console.error(
        `[fp/parent/site-visibility] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    const admin = supabaseAdmin();

    // ── Gate 2: the account IS A PARENT — service-role re-resolve by the
    // AUTHENTICATED id (the parent-login door's gate). A kid's `.invalid` auth
    // account has no parents row and lands here, so a CHILD can never take
    // their own page offline through this door — or anyone else's.
    const gateRaced = await withFwTimeout(
      admin.from("parents").select("id").eq("id", userId).maybeSingle(),
      "fp/parent/site-visibility parent gate",
      budgetFor()
    );
    if (gateRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    const gateQuery = gateRaced.value;
    if (gateQuery.error) {
      console.error(
        `[fp/parent/site-visibility] parent gate query failed: ${gateQuery.error.message}`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const parentRow = gateQuery.data as { id?: unknown } | null;
    if (!parentRow || typeof parentRow.id !== "string") {
      // Logged so on-call can tell a stale session from a probe wave —
      // VALUE-FREE beyond the user id.
      console.error(
        `[fp/parent/site-visibility] parent gate refused ${userId}: no parents row`
      );
      return refuse("not_parent");
    }

    // The core's deps. `db` is a FACTORY, so nothing privileged is constructed
    // for the core until it has a well-formed request — and `log` is
    // `console.error`, which the core only ever hands VALUE-FREE strings.
    const deps: ParentSiteDeps = {
      db: () => admin,
      now: () => Date.now(),
      log: (m) => console.error(m),
    };

    // ── THE TOGGLE. The core is the ONLY authorization for this child (module
    // header) and the only writer.
    let result: ParentSiteToggleResult;
    try {
      const raced = await withFwTimeout(
        setSitePublishedForParent(
          deps,
          { childId: parsed.childId, published: parsed.published },
          { parentId: userId }
        ),
        "fp/parent/site-visibility toggle",
        // The core makes up to four round trips of its own, so it gets a budget
        // proportional to that rather than one round trip's.
        Math.min(SITE_VISIBILITY_READ_TIMEOUT_MS * 4, remainingMs() || 1)
      );
      result = raced.timedOut ? { ok: false, reason: "outage" } : raced.value;
    } catch (err) {
      // `withFwTimeout` is `Promise.race`; it does not catch. A REJECTED round
      // trip inside the core must not reach the outer catch, because that path
      // leaves the strike STANDING while the identical failure arriving in-band
      // as `res.error` (the core's `outage`) refunds it — the refund policy
      // must not depend on which way supabase-js chose to report the same
      // outage.
      console.error(
        `[fp/parent/site-visibility] toggle threw: ${err instanceof Error ? err.message : String(err)}`
      );
      result = { ok: false, reason: "outage" };
    }

    if (!result.ok) {
      // ONE strike decision, through an ALLOWLIST predicate — `outage` and
      // nothing else. Never named inline here: a refusal added to the core
      // later must be non-refundable by default rather than by whoever
      // remembers to check (the refunded-strike-refunds-the-attacker learning,
      // 2026-08-05).
      if (refundsSiteVisibilityStrike(result.reason)) releaseStrikes();
      // `forbidden`, `no-site`, `never-published` and `bad_request` are ONE
      // reason on the wire and in the log — the caller must not be able to tell
      // another family's child from their own pageless one.
      return refuse(result.reason === "outage" ? "outage" : "core_refused");
    }

    // R3 audit breadcrumb: WHO changed WHOSE page's visibility, WHICH WAY, and
    // WHEN. Taking a child's work off the public internet is exactly the event
    // an audit must be able to reconstruct. The HANDLE is deliberately absent —
    // it is the child's public identity, and the child id already names the row.
    console.log(
      `[fp/parent/site-visibility] parent ${userId} set child ${parsed.childId}'s page` +
        ` published=${parsed.published} at ${new Date().toISOString()} in ${elapsed()}`
    );

    return new Response(SITE_VISIBILITY_OK_BODY, { status: 200, headers });
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/parent/site-visibility] unexpected error after ${elapsed()}: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
