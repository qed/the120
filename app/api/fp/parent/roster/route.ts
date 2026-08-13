/**
 * GET /api/fp/parent/roster — the First Profit SPA's cross-origin door for an
 * authenticated PARENT to list their OWN children and each child's First Profit
 * progress, so the fpv04 parent dashboard can render per-kid progress cards.
 *
 * The PARENT analogue of ../../progress/route.ts (the STAFF cohort feed), and a
 * deliberate mirror of it: same origin gate, same bearer extraction, same
 * atomic rate-limit-strike BEFORE any DB I/O with release-on-outage, same ONE
 * byte-identical 401 for every authorization-shaped refusal, 403 only for a bad
 * Origin, no-store, force-dynamic. Read that route beside this one — where the
 * two differ, the difference is commented here. The PARENT GATE itself is
 * lifted from ../../parent-login/route.ts.
 *
 * ── CONTRACT (for the FP parent client) ──
 *   GET /api/fp/parent/roster
 *   Origin: an allowed FP origin (exact match — the child-gateway CORS list)
 *   Authorization: Bearer <parent Supabase session access token>
 *
 *   NO PARAMETERS. Not "none needed" — none ACCEPTED. See the scoping note.
 *
 *   200 {ok: true, children: [ParentRosterChild]} — the shape documented in
 *   full at ./roster-rules.ts (id, firstName, lastName, fpUsername, truncated,
 *   docUnreadable, ideas[], businesses[]). The completion maps go out RAW and
 *   UNFILTERED; the CLIENT derives n/total from its own curriculum data. The
 *   server holds no task-id domain knowledge and computes no totals.
 *
 *   401 — byte-identical for EVERY authorization-shaped refusal (missing/blank
 *   token, a bad or expired token, a NON-PARENT session, rate limit, capacity,
 *   outage). 403 only for a disallowed Origin. Never a 429, never a reasoned
 *   body, never a per-reason HEADER — the reason lives only in the server log.
 *
 * ── SCOPING IS THE SECURITY BOUNDARY ──
 * This route takes NO id of any kind. Children are resolved by
 * `.eq("parent_id", userId)` where `userId` is what `auth.getUser()` returned
 * for the presented bearer — never a query parameter, never a body field, never
 * a header. There is deliberately no code path that reads a caller-supplied id,
 * so there is no code path to forget to check one against. The reads run with
 * the SERVICE ROLE (RLS is bypassed), which makes that one `.eq` the ENTIRE
 * authorization for another family's data: it is pinned by the cross-parent
 * isolation test, which seeds a second parent's child and asserts both that it
 * never reaches the wire AND that the query as ISSUED carried the authenticated
 * id.
 *
 * ── Two gates, in this order ──
 *   1. The token is GENUINE — `auth.getUser()` on a token-bound client proves
 *      the JWT is real and unexpired. A network throw is an outage, not a guess.
 *   2. The account IS A PARENT — a service-role re-resolve of `parents` by the
 *      AUTHENTICATED id (../../parent-login/route.ts' gate, verbatim in
 *      intent). A KID's session authenticates fine against a derived `.invalid`
 *      identity that has NO parents row, so it lands here and gets the uniform
 *      401 — a child must not be able to learn this endpoint exists, let alone
 *      read a roster.
 * Skipping gate 2 and relying on "the children query returns nothing for a
 * non-parent" would be an accident waiting to happen: it answers 200 with an
 * empty roster, which is a different response shape for a non-parent than for a
 * parent, and therefore an oracle.
 *
 * ── Reads, not embeds ──
 * Three bounded id-set reads (children → fp_player_profiles → fp_player_saves),
 * never a PostgREST embedded select: the same proven pattern the staff feed
 * uses, and the one the in-memory fake-supabase harness can actually exercise.
 *
 * ── Never-log discipline (R3) ──
 * NEVER log a child's name, an `fp_username`, a row count, or the token. The
 * ONE success breadcrumb is the parent's user id and the timestamp — enough to
 * answer "who read a roster, when", and nothing about any child. Abnormal save
 * docs are named by `profile_id`, the only id that is both actionable and not
 * child data.
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
  deriveParentRosterRateLimitKeys,
  shapeParentRoster,
  shapeParentRosterRefusal,
  PARENT_ROSTER_IP_RATE_LIMIT,
  PARENT_ROSTER_MAX_CHILDREN,
  PARENT_ROSTER_MAX_RESPONSE_BYTES,
  PARENT_ROSTER_RATE_LIMIT,
  PARENT_ROSTER_READ_TIMEOUT_MS,
  PARENT_ROSTER_TOTAL_BUDGET_MS,
  type ParentRosterRefusalReason,
  type RosterChildRowLike,
  type RosterProfileRowLike,
  type RosterSaveRowLike,
  type RosterWalkNote,
} from "./roster-rules";

export const dynamic = "force-dynamic";

/**
 * The PLATFORM's invocation ceiling, pinned in code rather than left to
 * whatever the default happens to be on the day. The outermost of three nested
 * budgets, only the inner two of which are ours:
 *
 *   PARENT_ROSTER_READ_TIMEOUT_MS (8 s)   — one round trip
 *   PARENT_ROSTER_TOTAL_BUDGET_MS (30 s)  — the whole invocation, ours
 *   maxDuration                   (60 s)  — the whole invocation, the platform's
 *
 * The 30 s of headroom under `maxDuration` is what guarantees the last word is
 * OUR refusal — one voice, CORS headers intact — rather than the platform's
 * CORS-less error page.
 */
export const maxDuration = 60;

/* -------------------------------------------------------------- read plumbing */

/**
 * A read either succeeded or refused, and WHY it refused decides the strike:
 *   - `outage` — a blip (DB error, a thrown fetch, a call that never settled,
 *     or the invocation deadline running out). The caller REFUNDS the strike;
 *     the parent did nothing wrong and should not burn budget on our downtime.
 *   - `too_many_rows` — the cap was crossed. DETERMINISTIC and repeatable, so
 *     it is never refunded: refunding it would make the most expensive path
 *     free to loop.
 */
type ReadResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: "outage" | "too_many_rows" };

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * One bounded read: issued once, timed out against whatever remains of the
 * invocation deadline, guarded against a throw, and REFUSED rather than
 * truncated past the cap.
 *
 * Unlike the staff feed this does not PAGE, and the reason is in
 * PARENT_ROSTER_MAX_CHILDREN's docstring: a parent's roster is bounded by their
 * own account, the cap sits far under any plausible PostgREST `max-rows`, and
 * the query asks for `cap + 1` — so the client `.limit()` is always the binding
 * one and the silent-truncation hazard that forces keyset paging over a whole
 * cohort cannot fire here at all.
 *
 * `label` is a constant string at every call site — never interpolated with a
 * value — so the never-log rule holds by construction.
 *
 * `withFwTimeout` is `Promise.race`; it does not catch. A rejected fetch must
 * not propagate to the handler's outer catch, because that path leaves the
 * strike STANDING while the identical failure arriving in-band as `res.error`
 * refunds it — the refund policy must not depend on which way supabase-js chose
 * to report the same outage.
 */
async function readBounded<T>(
  label: string,
  deadlineAt: number,
  query: () => PromiseLike<PageResult<T>>
): Promise<ReadResult<T>> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    console.error(`[fp/parent/roster] ${label} ran out of invocation budget`);
    return { ok: false, reason: "outage" };
  }
  let raced;
  try {
    raced = await withFwTimeout(
      query(),
      `fp/parent/roster ${label}`,
      Math.min(PARENT_ROSTER_READ_TIMEOUT_MS, remainingMs)
    );
  } catch (err) {
    console.error(
      `[fp/parent/roster] ${label} threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return { ok: false, reason: "outage" };
  }
  if (raced.timedOut) return { ok: false, reason: "outage" };
  const res = raced.value;
  if (res.error) {
    console.error(`[fp/parent/roster] ${label} failed: ${res.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const rows = res.data ?? [];
  if (rows.length > PARENT_ROSTER_MAX_CHILDREN) {
    // Exactly PARENT_ROSTER_MAX_CHILDREN is SERVED and one more refuses — the
    // `cap + 1` limit at the call site is what distinguishes them.
    console.error(
      `[fp/parent/roster] ${label} exceeded ${PARENT_ROSTER_MAX_CHILDREN} rows — refusing to serve a truncated roster`
    );
    return { ok: false, reason: "too_many_rows" };
  }
  return { ok: true, rows };
}

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
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      // `authorization` — this surface takes the parent's Bearer token.
      "Access-Control-Allow-Headers": "authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function GET(req: Request): Promise<Response> {
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
   *  code and the elapsed time, nothing about the caller or any child. */
  const refuse = (reason: ParentRosterRefusalReason): Response => {
    console.error(`[fp/parent/roster] refused: ${reason} after ${elapsed()}`);
    const shaped = shapeParentRosterRefusal(reason);
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
    const { userKey, ipKey } = deriveParentRosterRateLimitKeys(ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };
    /** Refuse a read. Both reasons answer the same 401; they differ only on the
     *  strike (see ReadResult). */
    const refuseRead = (reason: "outage" | "too_many_rows"): Response => {
      if (reason === "outage") releaseStrikes();
      return refuse(reason);
    };

    // Gate FIRST — atomically, before any DB I/O (house limiter discipline).
    // Record BOTH buckets before the verdict so the per-IP aggregate keeps
    // accumulating for a saturated user bucket. The refusal is the SAME generic
    // 401 — never a 429.
    const userCheck = checkAndRecordRateLimit(userKey, PARENT_ROSTER_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, PARENT_ROSTER_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    // ONE deadline for the whole invocation, handed out as REMAINING budget at
    // every I/O site below (see PARENT_ROSTER_TOTAL_BUDGET_MS).
    const deadlineAt = t0 + PARENT_ROSTER_TOTAL_BUDGET_MS;
    const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());

    // ── Gate 1: the token is genuine. getUser() proves the JWT is real and
    // unexpired. A network throw is an outage, not a guess about the account.
    let userId: string;
    try {
      const raced = await withFwTimeout(
        supabaseParentToken(token).auth.getUser(),
        "fp/parent/roster token verification",
        Math.min(PARENT_ROSTER_READ_TIMEOUT_MS, remainingMs() || 1)
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
        `[fp/parent/roster] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    const admin = supabaseAdmin();

    // ── Gate 2: the account IS A PARENT — service-role re-resolve by the
    // AUTHENTICATED id (the parent-login door's gate). A kid's `.invalid` auth
    // account has no parents row and lands here.
    const gateRaced = await withFwTimeout(
      admin.from("parents").select("id").eq("id", userId).maybeSingle(),
      "fp/parent/roster parent gate",
      Math.min(PARENT_ROSTER_READ_TIMEOUT_MS, remainingMs() || 1)
    );
    if (gateRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    const gateQuery = gateRaced.value;
    if (gateQuery.error) {
      console.error(`[fp/parent/roster] parent gate query failed: ${gateQuery.error.message}`);
      releaseStrikes();
      return refuse("outage");
    }
    const parentRow = gateQuery.data as { id?: unknown } | null;
    if (!parentRow || typeof parentRow.id !== "string") {
      // Logged so on-call can tell a stale session from a probe wave —
      // VALUE-FREE beyond the user id.
      console.error(`[fp/parent/roster] parent gate refused ${userId}: no parents row`);
      return refuse("not_parent");
    }

    // ── 1. THE ROSTER, AND THE WHOLE SECURITY BOUNDARY. `parent_id` is the id
    // auth.getUser() returned, never anything the client sent — this route
    // accepts no id at all. `fp_username is not null` is the enrolled-in-FP
    // filter (server-managed, only set at provisioning), and shapeParentRoster
    // re-checks it as the fail-closed second half. `.limit(cap + 1)` is what
    // makes "exactly the cap is served, one more refuses" true.
    const childrenRead = await readBounded<RosterChildRowLike>(
      "children read",
      deadlineAt,
      () =>
        admin
          .from("children")
          .select("id, first_name, last_name, fp_username")
          .eq("parent_id", userId)
          .not("fp_username", "is", null)
          .order("id", { ascending: true })
          .limit(PARENT_ROSTER_MAX_CHILDREN + 1)
    );
    if (!childrenRead.ok) return refuseRead(childrenRead.reason);

    // ── 2. Profiles by child id. A child with no profile row is KEPT with
    // empty ideas — that is the "never signed in" signal, and dropping it would
    // delete a kid from their own parent's dashboard. An empty roster skips the
    // remaining round trips entirely.
    const childIds = childrenRead.rows.map((c) => c.id);
    const profilesRead = childIds.length
      ? await readBounded<RosterProfileRowLike>("profiles read", deadlineAt, () =>
          admin
            .from("fp_player_profiles")
            .select("id, child_id")
            .in("child_id", childIds)
            .order("id", { ascending: true })
            .limit(PARENT_ROSTER_MAX_CHILDREN + 1)
        )
      : ({ ok: true, rows: [] } as ReadResult<RosterProfileRowLike>);
    if (!profilesRead.ok) return refuseRead(profilesRead.reason);

    // ── 3. Saves by profile id. `profile_id` IS the primary key here.
    const profileIds = profilesRead.rows.map((p) => p.id);
    const savesRead = profileIds.length
      ? await readBounded<RosterSaveRowLike>("saves read", deadlineAt, () =>
          admin
            .from("fp_player_saves")
            .select("profile_id, doc")
            .in("profile_id", profileIds)
            .order("profile_id", { ascending: true })
            .limit(PARENT_ROSTER_MAX_CHILDREN + 1)
        )
      : ({ ok: true, rows: [] } as ReadResult<RosterSaveRowLike>);
    if (!savesRead.ok) return refuseRead(savesRead.reason);

    // ONE clock for the whole response: it stamps the audit breadcrumb below
    // AND is the ceiling every child's future-dated stamps are clamped to. Two
    // `new Date()` calls would clamp two siblings against different instants,
    // and the pair that disagreed would look like a data bug, not a clock bug.
    const now = new Date();
    const walkNotes: RosterWalkNote[] = [];
    const children = shapeParentRoster(
      childrenRead.rows,
      profilesRead.rows,
      savesRead.rows,
      now,
      walkNotes
    );

    // Abnormal docs, named by the only id that is BOTH actionable and not child
    // data: `profile_id` is the row an operator opens to repair the doc.
    for (const note of walkNotes) {
      console.error(
        `[fp/parent/roster] abnormal save doc for profile ${note.profileId}` +
          ` (truncated=${note.truncated}, unreadable=${note.docUnreadable})`
      );
    }

    // ── The AGGREGATE response budget. The walk's per-child caps bound one
    // child; nothing bounds the roster. Serialize child by child and stop the
    // moment the total passes the bound, so an oversized roster becomes OUR
    // refusal — same 401, same headers — instead of the platform's CORS-less
    // 500, which is a different response shape and therefore an oracle.
    // Deterministic like the row cap, so strikes are NOT refunded.
    const parts: string[] = [];
    let bytes = 0;
    for (const child of children) {
      const part = JSON.stringify(child);
      bytes += Buffer.byteLength(part, "utf8") + 1; // +1 for the joining comma
      if (bytes > PARENT_ROSTER_MAX_RESPONSE_BYTES) {
        console.error(
          `[fp/parent/roster] shaped body exceeded ${PARENT_ROSTER_MAX_RESPONSE_BYTES} bytes`
        );
        return refuse("too_many_rows");
      }
      parts.push(part);
    }

    // R3 audit breadcrumb: WHO read a roster and WHEN, and nothing else. No
    // names, no usernames, no counts — a count is a fact about the children, and
    // this line lands in a log with a far wider audience than the response. The
    // elapsed time is the one number here that is not about a child: it is how
    // close this invocation came to PARENT_ROSTER_TOTAL_BUDGET_MS.
    console.log(
      `[fp/parent/roster] parent ${userId} read their roster at ${now.toISOString()} in ${elapsed()}`
    );

    return new Response(`{"ok":true,"children":[${parts.join(",")}]}`, {
      status: 200,
      headers,
    });
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/parent/roster] unexpected error after ${elapsed()}: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
