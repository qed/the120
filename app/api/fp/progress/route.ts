/**
 * GET /api/fp/progress?tasks=<id,id,…> — the STAFF-ONLY cohort progress feed
 * behind the Watchtower flow board (first-profit repo,
 * docs/plans/2026-08-05-001-feat-watchtower-staff-progress-plan.md, Unit 2).
 *
 * A deliberate file-for-file mirror of ../suggestions/route.ts: same origin
 * gate, same bearer extraction, same two-half staff gate in the same order,
 * same atomic rate-limit-before-any-DB-I/O discipline, same ONE byte-identical
 * 401. Read that route beside this one — where the two differ, the difference
 * is commented here.
 *
 * ── CONTRACT (for the FP staff client) ──
 *   GET /api/fp/progress?tasks=1.1.5,1.2.1,1.2.2,1.2.3,1.2.4,1.2.5
 *   Origin: an allowed FP origin (exact match — the child-gateway CORS list)
 *   Authorization: Bearer <staff Supabase session access token>
 *
 *   `tasks` is REQUIRED: the ~5 task ids on screen plus the ONE predecessor id,
 *   read by the client straight out of CRITERION_SEQUENCE. The server returns
 *   stamps for exactly those ids and holds no sequence knowledge of its own
 *   (honouring a list is set membership). See progress-rules'
 *   `deriveRequestedTaskIds` for why an explicit list replaced an earlier
 *   criterion-PREFIX design.
 *
 *   200 {ok: true, children: [ProgressChild]} — the shape documented in full at
 *   the top of ./progress-rules.ts (username, truncated, docUnreadable,
 *   ideas[], businesses[]). The server sends the completion maps essentially
 *   raw, filtered to the requested task ids; the CLIENT owns every semantic.
 *
 *   401 — byte-identical for EVERY AUTHORIZATION-shaped refusal (missing/bad
 *   token, a genuine non-staff session, rate limit, outage). 403 only for a
 *   disallowed Origin. Never a 429, never a reasoned body, never a per-reason
 *   HEADER — the reason lives only in the server log.
 *
 *   400 — the ONE documented exception, generic-bodied, and reachable ONLY by an
 *   ALREADY-AUTHENTICATED staff caller. Two things reach it:
 *     - an unusable `tasks` list (missing, malformed, oversized, non-list), and
 *     - a CAPACITY bound: more rows than PROGRESS_MAX_ROWS, more round trips
 *       than PROGRESS_MAX_ROUND_TRIPS, or a body past
 *       PROGRESS_MAX_RESPONSE_BYTES.
 *   Neither is an authorization signal, and the staff SPA reads 401 as "not
 *   staff" for the WHOLE shell — so answering 401 here would sign staff out of
 *   the entire Watchtower over a typo or a row count, deterministically, with
 *   the limiter then holding them out for another 15 minutes. Both are validated
 *   or reached only AFTER both halves of the staff gate (no oracle), the list
 *   before any DB read (a bad request costs nothing), and the body echoes NO
 *   submitted id.
 *
 *   Strike policy differs between them and is not arbitrary: a bad LIST is
 *   refunded (it spent no cohort read), a CAPACITY breach is not (it is
 *   deterministic, and refunding would make the most expensive path free to
 *   loop).
 *
 * ── No test-family exclusion ──
 * `families.is_test` is a CRM/NURTURE-VISIBILITY flag, not an FP-enrolment flag:
 * app/crm/lib/test-family-filter.ts calls itself "the ONE place" that rule
 * lives, and scripts/provision-fp-cohort.ts records that provisioning "NEVER
 * stamps families.is_test — these are real". An earlier draft of this route
 * joined against it, which would have meant that stamping a real beta family
 * purely to stop nurture mail SILENTLY DELETED their children from the very
 * dashboard that exists to notice children who are stuck — no error, no way to
 * see it. Two independent meanings must not share one column. If test-row skew
 * ever becomes a real problem the fix is an explicit FP-scoped marker, not a
 * re-use of this one.
 *
 * ── Reads, not embeds ──
 * Three batched id-set reads (children → fp_player_profiles → fp_player_saves),
 * never a PostgREST embedded select: the same proven pattern the suggestions
 * route uses, and the one the in-memory fake-supabase harness can actually
 * exercise. All reads run with the SERVICE ROLE; the staff gate is the sole
 * authorization for this data.
 *
 * ── Pagination is load-bearing, not defensive ──
 * PostgREST silently caps an unranged select at 1000 rows with `error: null`
 * and no truncation signal of any kind (docs/solutions/integration-issues/
 * postgrest-max-rows-1000-silently-truncates-unranged-select-paginate-and-
 * refuse-2026-07-24.md). A truncated cohort read here would not look broken —
 * it would look like a smaller school, with the missing children reading as
 * "not enrolled" rather than "not loaded". So every cross-children read pages,
 * and past PROGRESS_MAX_ROWS the route REFUSES (the same 401) rather than
 * serving a plausible-looking partial 200.
 *
 * Paging is KEYSET (`.gt(orderKey, lastSeen).order(orderKey).limit(N)`), not
 * offset. Offset paging over a LIVE table can skip a row or serve one twice when
 * a concurrent insert shifts the window between pages, and every order key here
 * is already unique (children.id and fp_player_profiles.id are PKs;
 * fp_player_saves.profile_id IS the PK), so the keyset form is free.
 *
 * ── Determinism ──
 * Every read carries an explicit `order by` on its key. Without one Postgres may
 * return rows in any order, which under keyset paging does not merely reorder
 * the output — it SKIPS rows, because `.gt(lastSeen)` is only a correct cursor
 * over a sorted scan.
 *
 * ── Never-log discipline (R3) ──
 * NEVER log a username, a row count, or the token. This extends to the
 * caller-supplied `?tasks=` list: it is untrusted REQUEST INPUT, so it must
 * never reach a log line and must never be echoed in a response body — the
 * parameter-validation refusal is generic (see progress-rules'
 * `deriveRequestedTaskIds`, which returns a value-free reason code, and
 * `shapeProgressBadRequest`, which ignores even that). The ONE success
 * breadcrumb is the staff user id and the timestamp — enough to answer "who read
 * the cohort, when", and nothing about any child.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/fp/lib/rate-limit-store";
import { withFwTimeout } from "@/app/fp/lib/fw-call";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
} from "../login/login-rules";
import { extractBearerToken, unverifiedJwtSub } from "../grade/grade-rules";
import {
  deriveProgressRateLimitKeys,
  deriveRequestedTaskIds,
  isAllowedProgressStaffRole,
  shapeProgress,
  shapeProgressBadRequest,
  shapeProgressRefusal,
  PROGRESS_ID_CHUNK,
  PROGRESS_IP_RATE_LIMIT,
  PROGRESS_MAX_RESPONSE_BYTES,
  PROGRESS_MAX_ROUND_TRIPS,
  PROGRESS_MAX_ROWS,
  PROGRESS_PAGE_SIZE,
  PROGRESS_RATE_LIMIT,
  PROGRESS_READ_TIMEOUT_MS,
  PROGRESS_SAVES_PAGE_SIZE,
  PROGRESS_TOTAL_BUDGET_MS,
  type ProgressBadRequestReason,
  type ProgressChildRowLike,
  type ProgressProfileRowLike,
  type ProgressRefusalReason,
  type ProgressSaveRowLike,
  type ProgressWalkNote,
} from "./progress-rules";

export const dynamic = "force-dynamic";

/**
 * The PLATFORM's invocation ceiling, pinned in code rather than left to whatever
 * the default happens to be on the day.
 *
 * It is the outermost of THREE nested budgets, and only the innermost two are
 * ours to enforce:
 *
 *   PROGRESS_READ_TIMEOUT_MS (8 s)   — one round trip
 *   PROGRESS_TOTAL_BUDGET_MS (45 s)  — the whole invocation, ours
 *   maxDuration              (60 s)  — the whole invocation, the platform's
 *
 * The middle one is load-bearing and its absence was a real bug: per-call
 * timeouts do NOT bound their sum, and today's cohort already makes 8 bounded
 * calls, so 8 × 8 s = 64 s could blow a 60 s ceiling with every individual call
 * inside budget. (An earlier version of this comment asserted the opposite,
 * "sized for the worst legitimate shape", against constants that said otherwise.)
 * With the deadline in place the 15 s between it and `maxDuration` is what
 * guarantees the last word is OUR refusal — one voice, CORS headers intact —
 * rather than the platform's CORS-less error page.
 */
export const maxDuration = 60;

/* -------------------------------------------------------------- read plumbing */

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * A read either succeeded or refused, and WHY it refused is load-bearing even
 * though the caller cannot tell from the status alone:
 *
 *   - `outage` — a blip (DB error, a thrown fetch, a call that never settled, or
 *     the whole-invocation deadline running out). The caller REFUNDS the
 *     rate-limit strike, because the staff member did nothing wrong and should
 *     not burn budget on our downtime.
 *   - `too_many_rows` — a CAPACITY bound was crossed: more rows than
 *     PROGRESS_MAX_ROWS, or more round trips than PROGRESS_MAX_ROUND_TRIPS. This
 *     is DETERMINISTIC and repeatable, so it is never refunded — refunding it
 *     would make the most expensive path in the whole service free to loop — and
 *     it answers 400-class rather than the 401, because "your school got too
 *     big" is not "you are not staff" (see ProgressBadRequestReason).
 *
 * Collapsing the two into a bare `{ok:false}` (an earlier draft) meant every
 * call site released strikes unconditionally. Three reviewers found it
 * independently.
 */
type ReadResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: "outage" | "too_many_rows" };

/**
 * The budget one LOGICAL read spends, carried across its id chunks.
 *
 * Rows and round trips are per-read; the deadline is shared by the whole
 * invocation. Both counters live here rather than as loop-local variables
 * because `readByIdSet` calls `readAllPages` once per chunk, so anything counted
 * inside one call bounds a chunk and not the read — 8 chunks × 5 pages was 40
 * round trips wearing the label of a 5-page bound.
 */
type ReadBudget = {
  rowsRead: number;
  roundTrips: number;
  /** Absolute epoch ms. Shared across every read in one invocation. */
  readonly deadlineAt: number;
};

/**
 * Read every row a query matches, in KEYSET pages, refusing rather than
 * truncating.
 *
 * `label` is a constant string at every call site — never interpolated with a
 * value — so the never-log rule holds by construction.
 *
 * ── Why the loop terminates on an EMPTY page, not a short one ──
 * A short page is only an honest end-of-data signal when the page size is
 * exactly the server's `max-rows`, and PROGRESS_PAGE_SIZE is an ASSUMPTION about
 * that number (see its docstring). If the server's cap is SMALLER, every page
 * comes back "short" and a short-page terminator ends the read after one page —
 * reproduced: a cap of 500 with 1200 children answered 200 with 500 of them,
 * both truncated and, under the old page-INDEX offsets, skipping rows as well.
 * An empty-page terminator costs one extra round trip and is correct for any
 * cap.
 *
 * ── The row bound and the trip bound ──
 * Rows are bounded so that exactly PROGRESS_MAX_ROWS is SERVED and one more
 * refuses (the empty terminating page is what distinguishes them). Trips are
 * bounded separately because a small server cap turns the same row count into
 * many more requests, and because the deadline should be the thing that runs out
 * LAST — a trip bound gives a fast deterministic refusal where the deadline
 * would give a slow one.
 *
 * ── Throws ──
 * `withFwTimeout` is `Promise.race`; it does not catch. A rejected fetch used to
 * propagate to the handler's outer catch, get logged as "unexpected error"
 * (indistinguishable from a code bug during a real incident) and leave the
 * strike STANDING — while the identical failure arriving in-band as `res.error`
 * refunded it. The refund policy must not depend on which way supabase-js chose
 * to report the same outage, so the call is wrapped here. (`fwRead` in
 * app/fp/lib/fw-call.ts does exactly this pairing, but hard-codes
 * FW_CALL_TIMEOUT_MS; this route must pass the REMAINING deadline budget, which
 * that helper has no parameter for.)
 */
async function readAllPages<T>(
  label: string,
  pageSize: number,
  keyOf: (row: T) => string,
  page: (after: string | null, limit: number) => PromiseLike<PageResult<T>>,
  budget: ReadBudget
): Promise<ReadResult<T>> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    if (budget.roundTrips >= PROGRESS_MAX_ROUND_TRIPS) {
      console.error(
        `[fp/progress] ${label} exceeded ${PROGRESS_MAX_ROUND_TRIPS} round trips — refusing to serve a truncated cohort`
      );
      return { ok: false, reason: "too_many_rows" };
    }
    // Whatever is left of the WHOLE invocation, never more than one call's own
    // budget. Per-call timeouts do not bound their sum; this is what keeps the
    // last refusal ours rather than the platform's CORS-less error page.
    const remainingMs = budget.deadlineAt - Date.now();
    if (remainingMs <= 0) {
      console.error(`[fp/progress] ${label} ran out of invocation budget`);
      return { ok: false, reason: "outage" };
    }
    budget.roundTrips += 1;
    let raced;
    try {
      raced = await withFwTimeout(
        page(after, pageSize),
        `fp/progress ${label} page`,
        Math.min(PROGRESS_READ_TIMEOUT_MS, remainingMs)
      );
    } catch (err) {
      console.error(
        `[fp/progress] ${label} page threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return { ok: false, reason: "outage" };
    }
    if (raced.timedOut) return { ok: false, reason: "outage" };
    const res = raced.value;
    if (res.error) {
      console.error(`[fp/progress] ${label} page failed: ${res.error.message}`);
      return { ok: false, reason: "outage" };
    }
    const got = res.data ?? [];
    if (got.length === 0) return { ok: true, rows };
    rows.push(...got);
    budget.rowsRead += got.length;
    if (budget.rowsRead > PROGRESS_MAX_ROWS) {
      console.error(
        `[fp/progress] ${label} exceeded ${PROGRESS_MAX_ROWS} rows — refusing to serve a truncated cohort`
      );
      return { ok: false, reason: "too_many_rows" };
    }
    // The cursor is the LAST row of the page, which is only the largest key
    // because every call site orders ascending on that same key.
    after = keyOf(got[got.length - 1]!);
  }
}

/**
 * The same read, filtered by a set of ids too large for one URL: chunked, each
 * chunk paged, and bounded IN AGGREGATE by one shared budget. An empty id set
 * skips the round trip entirely.
 */
async function readByIdSet<T>(
  label: string,
  ids: readonly string[],
  pageSize: number,
  keyOf: (row: T) => string,
  page: (
    chunk: string[],
    after: string | null,
    limit: number
  ) => PromiseLike<PageResult<T>>,
  budget: ReadBudget
): Promise<ReadResult<T>> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += PROGRESS_ID_CHUNK) {
    const chunk = ids.slice(i, i + PROGRESS_ID_CHUNK);
    const res = await readAllPages<T>(
      label,
      pageSize,
      keyOf,
      (after, limit) => page(chunk, after, limit),
      budget
    );
    if (!res.ok) return res;
    rows.push(...res.rows);
  }
  return { ok: true, rows };
}

/* -------------------------------------------------------------------- CORS */

/** Headers for responses to an allowed origin. Never `*`, never credentials.
 *  Identical for a 200, for the 400 and for EVERY 401 — headers are exactly
 *  where a per-reason oracle (a stray Retry-After) creeps back in. */
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
  // Stamped before anything else so every line this invocation emits can say how
  // long it had been running. The failure mode the deadline exists to prevent is
  // the SUM of many in-budget calls crossing the ceiling, and nothing about a
  // per-call log would ever let an operator watch the route creep toward it.
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
  /**
   * The byte-identical 401. Every reason logs a VALUE-FREE line — the reason
   * code and the elapsed time, nothing about the caller or any child.
   *
   * `rate_limited` used to be the ONE silent path, which is exactly backwards:
   * it is the refusal that fires during the incident an operator is already
   * investigating ("staff say the dashboard signs them out, and there is nothing
   * in the logs").
   */
  const refuse = (reason: ProgressRefusalReason): Response => {
    console.error(`[fp/progress] refused: ${reason} after ${elapsed()}`);
    const shaped = shapeProgressRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };
  /**
   * The 400-class refusal, for everything that is NOT an authorization signal:
   * an unusable `?tasks=` list, and a capacity bound. Same headers as the 401 by
   * construction (one `headers` object), so header parity holds across both
   * families rather than by coincidence.
   */
  const badRequest = (reason: ProgressBadRequestReason): Response => {
    console.error(`[fp/progress] bad request: ${reason} after ${elapsed()}`);
    const shaped = shapeProgressBadRequest(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  // Everything past the Origin gate is wrapped: an unhandled throw must
  // surface as the SAME byte-identical 401, never Next's default error page —
  // a different response SHAPE is an oracle. A throw fails closed (strikes
  // stand); each I/O site releases explicitly.
  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse("missing_token");

    // The per-user bucket segment is the token's UNVERIFIED sub — a bucket key
    // only, never an identity (grade-rules pins the rationale). A token without
    // a decodable sub can never verify, so refuse it pre-DB.
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse("invalid_token");

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveProgressRateLimitKeys(ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };
    /**
     * Refuse a read. The two reasons differ on BOTH axes, and neither pairing is
     * arbitrary (see ReadResult):
     *   - `outage` → the 401, strike REFUNDED (our fault, not repeatable).
     *   - `too_many_rows` → 400-class, strike KEPT (their data, fully
     *     repeatable — and a 401 here would sign the staff SPA out of the whole
     *     Watchtower over a capacity number).
     */
    const refuseRead = (reason: "outage" | "too_many_rows"): Response => {
      if (reason === "outage") {
        releaseStrikes();
        return refuse("outage");
      }
      return badRequest(reason);
    };

    // Gate FIRST — atomically, before any DB I/O (house limiter discipline).
    // Record BOTH buckets before the verdict so the per-IP aggregate keeps
    // accumulating for a saturated user bucket. The refusal is the SAME generic
    // 401 — never a 429. This route reads the WHOLE cohort per call, so the
    // limiter is also its cost fuse, not just its abuse fuse.
    const userCheck = checkAndRecordRateLimit(userKey, PROGRESS_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, PROGRESS_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    // Verify the token: getUser() proves the JWT is genuine and unexpired. A
    // network throw is an outage, not a guess about the account.
    // ONE deadline for the whole invocation, handed out as REMAINING budget at
    // every I/O site below (see PROGRESS_TOTAL_BUDGET_MS).
    const deadlineAt = t0 + PROGRESS_TOTAL_BUDGET_MS;
    const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());

    let userId: string;
    let claimRole: unknown;
    try {
      const raced = await withFwTimeout(
        supabaseParentToken(token).auth.getUser(),
        "fp/progress token verification",
        Math.min(PROGRESS_READ_TIMEOUT_MS, remainingMs() || 1)
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
      claimRole = (who.data.user.app_metadata as Record<string, unknown> | undefined)?.role;
    } catch (err) {
      console.error(
        `[fp/progress] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    // ── Staff gate, half 1: the server-set JWT claim. Every child/parent
    // session fails here and is refused with the byte-identical 401 — a child
    // must not be able to learn this endpoint exists.
    if (!isAllowedProgressStaffRole(claimRole)) return refuse("not_staff");

    const admin = supabaseAdmin();

    // ── Staff gate, half 2: the staff ROW (revocation lives here — flipping
    // is_active shuts the door without waiting out token expiry). The row's
    // role must ALSO be allowed: the claim says what the token was minted as,
    // the row says what the account IS today.
    const staffRaced = await withFwTimeout(
      admin.from("staff").select("id, role, is_active").eq("id", userId).maybeSingle(),
      "fp/progress staff row",
      Math.min(PROGRESS_READ_TIMEOUT_MS, remainingMs() || 1)
    );
    if (staffRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    const staffQuery = staffRaced.value;
    if (staffQuery.error) {
      console.error(`[fp/progress] staff row lookup failed: ${staffQuery.error.message}`);
      releaseStrikes();
      return refuse("outage");
    }
    const staffRow = staffQuery.data as
      | { id: string; role: unknown; is_active: unknown }
      | null;
    if (
      !staffRow ||
      staffRow.is_active !== true ||
      !isAllowedProgressStaffRole(staffRow.role)
    ) {
      // Logged so on-call can tell a revoked colleague from an attack wave —
      // VALUE-FREE beyond the user id.
      console.error(
        `[fp/progress] staff gate refused ${userId}: ` +
          (staffRow ? "row inactive or role not allowed" : "no staff row")
      );
      return refuse("not_staff");
    }

    // ── The requested task ids. AFTER the staff gate (an unauthenticated
    // caller must not be able to probe which ids parse — no oracle) and BEFORE
    // any cohort read (a bad request costs nothing). The refusal is 400-class
    // and generic; the submitted value reaches neither the body nor a log.
    const requested = deriveRequestedTaskIds(new URL(req.url).searchParams.get("tasks"));
    if (!requested.ok) {
      // REFUND both strikes. This request touched no cohort read at all, and a
      // client-side regression that sends a malformed list on every render would
      // otherwise saturate the limiter after 60 renders — at which point
      // `rate_limited` answers the 401 and signs the SPA out of the whole
      // Watchtower, which is the precise failure this 400 exists to prevent. The
      // caller is already past Origin and both halves of the staff gate, so
      // nothing unauthenticated can spend this budget.
      releaseStrikes();
      return badRequest(requested.reason);
    }

    // ── 1. The roster. `fp_username is not null` is the enrolled-in-FP filter
    // (the column is server-managed and only set at provisioning), and
    // shapeProgress re-checks it as the fail-closed second half. No `parent_id`
    // (the test-family exclusion is gone — see the header) and no `birth_year` /
    // `grade` (band left the wire shape in the 2026-08-05 redesign): this
    // endpoint has no business reading a child's date of birth under the service
    // role for a column nothing consumes.
    const childrenRead = await readAllPages<ProgressChildRowLike>(
      "children read",
      PROGRESS_PAGE_SIZE,
      (row) => row.id,
      (after, limit) => {
        let q = admin
          .from("children")
          .select("id, fp_username")
          .not("fp_username", "is", null);
        if (after !== null) q = q.gt("id", after);
        return q.order("id", { ascending: true }).limit(limit);
      },
      { rowsRead: 0, roundTrips: 0, deadlineAt }
    );
    if (!childrenRead.ok) return refuseRead(childrenRead.reason);

    // ── 2. Profiles by child id. A child with no profile row is KEPT by the
    // pure module with empty ideas — that is the "never signed in" signal, and
    // dropping it would hide exactly the child this board exists to notice.
    const childIds = childrenRead.rows.map((c) => c.id);
    const profilesRead = await readByIdSet<ProgressProfileRowLike>(
      "profiles read",
      childIds,
      PROGRESS_PAGE_SIZE,
      (row) => row.id,
      (chunk, after, limit) => {
        let q = admin
          .from("fp_player_profiles")
          .select("id, child_id")
          .in("child_id", chunk);
        if (after !== null) q = q.gt("id", after);
        return q.order("id", { ascending: true }).limit(limit);
      },
      { rowsRead: 0, roundTrips: 0, deadlineAt }
    );
    if (!profilesRead.ok) return refuseRead(profilesRead.reason);

    // ── 3. Saves by profile id. `profile_id` IS the primary key here, so it is
    // the stable keyset cursor. This read gets its OWN, much smaller page size:
    // it is the only one carrying `doc`, which is bounded in COMPRESSED bytes,
    // not rows (see PROGRESS_SAVES_PAGE_SIZE).
    const profileIds = profilesRead.rows.map((p) => p.id);
    const savesRead = await readByIdSet<ProgressSaveRowLike>(
      "saves read",
      profileIds,
      PROGRESS_SAVES_PAGE_SIZE,
      (row) => row.profile_id,
      (chunk, after, limit) => {
        let q = admin
          .from("fp_player_saves")
          .select("profile_id, doc")
          .in("profile_id", chunk);
        if (after !== null) q = q.gt("profile_id", after);
        return q.order("profile_id", { ascending: true }).limit(limit);
      },
      { rowsRead: 0, roundTrips: 0, deadlineAt }
    );
    if (!savesRead.ok) return refuseRead(savesRead.reason);

    // ONE clock for the whole response: it stamps the audit breadcrumb below AND
    // is the ceiling every child's future-dated stamps are clamped to. Two
    // `new Date()` calls would clamp two children against different instants,
    // and the pair that disagreed would look like a data bug, not a clock bug.
    const now = new Date();
    const walkNotes: ProgressWalkNote[] = [];
    const children = shapeProgress(
      childrenRead.rows,
      profilesRead.rows,
      savesRead.rows,
      requested.ids,
      now,
      walkNotes
    );

    // Abnormal docs, named by the only id that is BOTH actionable and not child
    // data. Never-log discipline had otherwise made this signal unusable: the
    // walk can spend real CPU on a hostile doc and flag `truncated`, and nobody
    // could tell which row to open. `profile_id` is the row an operator repairs.
    for (const note of walkNotes) {
      console.error(
        `[fp/progress] abnormal save doc for profile ${note.profileId}` +
          ` (truncated=${note.truncated}, unreadable=${note.docUnreadable})`
      );
    }

    // ── The AGGREGATE response budget. The per-child caps in progress-rules
    // bound one child; nothing bounded the cohort. Serialize child by child and
    // stop the moment the total passes the bound, so an oversized cohort becomes
    // OUR refusal — same 401, same headers — instead of the platform's
    // CORS-less 500, which is a different response shape and therefore an
    // oracle. Deterministic like the row cap, so strikes are NOT refunded.
    const parts: string[] = [];
    let bytes = 0;
    for (const child of children) {
      const part = JSON.stringify(child);
      bytes += Buffer.byteLength(part, "utf8") + 1; // +1 for the joining comma
      if (bytes > PROGRESS_MAX_RESPONSE_BYTES) {
        console.error(
          `[fp/progress] shaped body exceeded ${PROGRESS_MAX_RESPONSE_BYTES} bytes`
        );
        // 400-class and NO refund, exactly like the row cap: deterministic, and
        // not a statement about who the caller is.
        return badRequest("too_large");
      }
      parts.push(part);
    }

    // R3 audit breadcrumb: WHO read the cohort and WHEN, and nothing else. No
    // usernames, no labels, no counts — a count is a fact about the children,
    // and this line lands in a log with a far wider audience than the response.
    // The requested ids are absent too: they are untrusted request input.
    // The elapsed time is the ONE number here that is not about a child: it is
    // how close this invocation came to PROGRESS_TOTAL_BUDGET_MS, and without it
    // nobody can watch the route creep toward the ceiling.
    console.log(
      `[fp/progress] staff ${userId} read cohort progress at ${now.toISOString()} in ${elapsed()}`
    );

    return new Response(`{"ok":true,"children":[${parts.join(",")}]}`, {
      status: 200,
      headers,
    });
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/progress] unexpected error after ${elapsed()}: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
