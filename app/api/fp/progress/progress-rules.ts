/**
 * Pure decision rules for GET /api/fp/progress — the STAFF-ONLY cohort progress
 * feed behind the Watchtower dashboard (first-profit repo,
 * docs/plans/2026-08-05-001-feat-watchtower-staff-progress-plan.md, Unit 1). It
 * walks each child's fp_player_saves doc server-side and projects the per-idea /
 * per-business completion maps the staff SPA renders. No Next, no Supabase —
 * only decisions, per the house pure-module convention (../suggestions/
 * suggestions-rules.ts is the direct sibling precedent and this module is a
 * deliberate file-for-file mirror of it; the ROUTE reuses login-rules'
 * origin/IP contract and grade-rules' bearer/sub helpers rather than
 * duplicating them).
 *
 * ── The 2026-08-05 redesign (Unit 1R) ──
 * The Watchtower became an aggregate FLOW BOARD — throughput, median cycle time
 * and active/stalled WIP per unit task — rather than a per-child export. Three
 * consequences land in this module:
 *   1. `band` LEFT the wire shape: no view segments by it, so it was pure
 *      exposure. (The derivation was correct on its own terms — birth year wins
 *      over the stored grade, `resolveChildGrade` → `bandForGrade`; that is the
 *      authority to re-consult if band ever returns.)
 *   2. The child-authored idea `label` LEFT the wire shape: free text a kid
 *      typed, shipped to a staff screen, is a moderation surface and an
 *      amplification vector for zero flow value. `username` STAYS — the WIP
 *      drill-down ("who do I nudge today?") is the one surface that names a
 *      child, and the client must not render it until staff drill in.
 *   3. The completion maps are FILTERED to an explicit, caller-supplied list of
 *      task ids (`deriveRequestedTaskIds` → `filterMapsToTaskIds`). The server
 *      honours a LIST — set membership, not sequence knowledge — so it still
 *      holds zero task-id domain knowledge, and the payload is ~6 values per
 *      idea instead of the whole curriculum. See `deriveRequestedTaskIds` for
 *      why an explicit list replaced an earlier criterion-PREFIX design.
 *
 * ── The staff gate, stated once ──
 * Identical posture to the suggestions endpoint: staff ARE Supabase auth users
 * in the SHARED project, so the route verifies a Bearer token with
 * auth.getUser() and then requires BOTH halves, in this order:
 *   1. JWT claim: app_metadata.role in the allowed set (server-set by
 *      scripts/seed-staff.ts via the admin API; a client can never write
 *      app_metadata), and
 *   2. staff row: public.staff has the user's id with is_active AND a role in
 *      the allowed set (revocation = flip is_active).
 * A genuine CHILD session fails the claim half and is refused with the SAME
 * byte-identical 401 as a bad token — a child must not be able to learn that
 * this endpoint exists.
 *
 * ── Why PROGRESS_ALLOWED_STAFF_ROLES is its OWN constant (R2) ──
 * The requirement is that this endpoint's authorization is DELIBERATELY
 * RE-DERIVED rather than inherited: a future widening of the suggestions
 * triage vocabulary must not silently hand out the whole cohort's progress.
 * So the list is declared here, with its own parity test against the crm_core
 * migration's CHECK. Its MEMBERSHIP is identical to suggestions' today
 * (`['admin']` is the entire production vocabulary) and that sameness is
 * intentional too: the staff SPA reads 401 as "not staff" for the whole shell,
 * so a per-endpoint role divergence would force a per-tab "no access" state and
 * break the shared signout-on-refusal logic. Same membership, separate
 * decision — if the sets ever genuinely diverge, the client work is a per-tab
 * refusal state, deferred until real divergence.
 *
 * ── Role vocabulary ──
 * The staff table's CHECK is `role in ('admin')` (20260713110000_crm_core.sql)
 * and seed-staff.ts stamps both the claim and the row 'admin'. When tiers are
 * minted (a CHECK widening + seed changes), add them HERE and the parity test
 * against the crm_core CHECK will hold the two lists together.
 *
 * ── Refusal posture ──
 * ONE refusal (child-gateway discipline): `shapeProgressRefusal` takes a reason
 * (for logs and tests) and deliberately IGNORES it — every refusal is the same
 * 401 with a byte-identical body, minted once at module load from the login
 * surface's copy. One voice, no oracle. 403 exists only for a disallowed
 * Origin.
 *
 * ── Never-log discipline (R3) ──
 * Usernames and tokens are child data. Nothing in this module throws — and no
 * message it could ever produce embeds a value from its input. The walk below
 * is fail-CLOSED and total: hostile or half-written jsonb degrades to empty
 * structures, never an exception the route would have to describe.
 *
 * R3 EXTENDS to the requested task-id list: it is caller-supplied REQUEST
 * INPUT, so it must never reach a log line and must never be echoed in a
 * response. `deriveRequestedTaskIds` therefore returns a value-free reason code
 * and never the offending value.
 *
 * ── What bounds the RESPONSE, and what bounds the WALK ──
 * These are two different jobs, and the 2026-08-05 redesign moved the first one.
 *
 * The RESPONSE is now bounded by the TASK-ID FILTER: every requested id is
 * pattern-validated to at most 8 characters and there are at most 32 of them, so
 * no map key a child authored can reach the wire at all, however long. What is
 * left unbounded on the wire is the per-child ENTRY COUNT (ideas, businesses)
 * and the child-authored IDs — hence `PROGRESS_IDEAS_CAP`,
 * `PROGRESS_BUSINESSES_CAP` and `PROGRESS_ID_MAX_CHARS`.
 *
 * The WALK still needs its own bounds, and this is where the compression
 * argument now lives: `fp_player_saves.doc` is capped by
 * `pg_column_size(doc) <= 262144`, which measures the COMPRESSED size, so a
 * highly compressible doc — thousands of `{}` idea entries, or 500 map keys each
 * padded to kilobytes of one repeated character — fits under the DB cap while
 * expanding by orders of magnitude once walked. `PROGRESS_MAP_ENTRIES_CAP` and
 * `PROGRESS_MAP_KEY_MAX_CHARS` bound the intermediate structures and the
 * per-child CPU/memory this route spends, for every child in the cohort, on
 * every staff refresh.
 *
 * All of them TRUNCATE rather than throw — degrade-never-throw, with
 * `truncated: true` on the affected child (see `ProgressChild.truncated` for
 * what that flag does and does NOT mean). Truncation never disturbs the
 * original-index invariant below.
 *
 * ── Response contract (documented for the FP staff client in route.ts) ──
 * 200 {ok:true, children:[{
 *        username, truncated, docUnreadable,
 *        ideas:[{index, id, done, doneAt, doneByTask, doneAtByTask,
 *                lastCompletionAt, recencyClamped,
 *                hasCompletionsOutsideRequest}],
 *        businesses:[{id, ideaId, archived, doneByTask, doneAtByTask,
 *                     lastCompletionAt, recencyClamped,
 *                     hasCompletionsOutsideRequest}]
 *      }]}
 * The server sends the four per-idea maps essentially RAW (defensively
 * narrowed; keys untouched EXCEPT for the exclusions documented at
 * `isKeepableMapKey`) and the two per-business maps, then FILTERS every one of
 * them to the requested task ids; the CLIENT owns all semantics — legacy-key
 * remapping, the union rules, and every view computation. The server stays free
 * of task-id domain knowledge on purpose (plan: "Server sends raw maps, client
 * owns semantics").
 */

import { SIGN_IN_FAILED_MESSAGE } from "@/app/fp/lib/provision-rules";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/fp/lib/rate-limit-rules";

/* -------------------------------------------------------------- staff roles */

/**
 * staff.role values allowed through this endpoint. Its own constant with its
 * own parity test — see the module header for WHY it is separate from
 * SUGGESTIONS_ALLOWED_STAFF_ROLES despite being identical today.
 */
export const PROGRESS_ALLOWED_STAFF_ROLES = ["admin"] as const;

export function isAllowedProgressStaffRole(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (PROGRESS_ALLOWED_STAFF_ROLES as readonly string[]).includes(value)
  );
}

/* --------------------------------------------------------- refusal shaping */

export type ProgressRefusalReason =
  | "missing_token"
  | "invalid_token"
  | "not_staff"
  | "rate_limited"
  | "outage";

// Serialized ONCE at module load: refusals are byte-identical by construction,
// not by convention. Same copy as the login/grade/suggestions surfaces (one
// voice — a child or an attacker probing this staff URL sees exactly what a bad
// login shows them, no new oracle).
const REFUSAL_BODY = JSON.stringify({ success: false, error: SIGN_IN_FAILED_MESSAGE });

export const PROGRESS_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for the
 *  tests that pin indistinguishability — the OUTPUT never varies with it. */
export function shapeProgressRefusal(
  reason: ProgressRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: PROGRESS_REFUSAL_STATUS, body: REFUSAL_BODY };
}

/**
 * Why a request was refused for a reason that is NOT about authorization.
 *
 * Two families, one rule. Both are reachable ONLY after both halves of the staff
 * gate have passed, and neither says anything about who the caller is:
 *
 *   - the `?tasks=` list was unusable (a `RequestedTaskIdsRefusal`), and
 *   - the cohort exceeded a CAPACITY bound — more rows than PROGRESS_MAX_ROWS,
 *     or a shaped body past PROGRESS_MAX_RESPONSE_BYTES.
 *
 * Capacity used to answer the byte-identical 401, and that was wrong in a way
 * only the CLIENT reveals: the staff SPA reads 401 as "not staff" for the whole
 * shell, so the day a cap is crossed staff are signed out of the entire
 * Watchtower — and since a capacity breach is DETERMINISTIC, signing back in
 * reproduces it, while the deliberate no-refund policy means ~60 attempts
 * saturate the limiter and hold the 401 for a further 15 minutes even after
 * someone raises the cap. "Your school got too big" is not "you are not staff".
 * The route already carved out exactly this reasoning for a malformed parameter;
 * capacity belongs on the same side of the line.
 */
export type ProgressBadRequestReason =
  | RequestedTaskIdsRefusal
  /**
   * A read matched more rows than PROGRESS_MAX_ROWS, or exhausted its page /
   * round-trip budget. Deliberately DISTINCT from `outage`: an outage is a blip
   * and the route REFUNDS the rate-limit strike for it, while a capacity breach
   * is deterministic and repeatable — refunding it would make the most expensive
   * path in the service free to loop.
   */
  | "too_many_rows"
  /** The shaped body exceeded PROGRESS_MAX_RESPONSE_BYTES. Deterministic like
   *  `too_many_rows`, and refunded like it: never. */
  | "too_large";

/**
 * The ONE documented exception to the byte-identical-401 rule (see
 * ProgressBadRequestReason for what reaches it and why).
 *
 * Byte-identical across reasons for the same reason the 401 is — the reason
 * parameter exists for the caller's log and for the test that pins
 * indistinguishability, and the OUTPUT never varies with it. Critically it never
 * echoes a submitted id (R3 extends to caller-supplied request input), which is
 * why this takes a value-free code rather than the offending list.
 */
const BAD_REQUEST_BODY = JSON.stringify({
  success: false,
  error: "That request could not be completed.",
});

export const PROGRESS_BAD_REQUEST_STATUS = 400;

export function shapeProgressBadRequest(
  reason: ProgressBadRequestReason
): { status: 400; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: PROGRESS_BAD_REQUEST_STATUS, body: BAD_REQUEST_BODY };
}

/* ---------------------------------------------------------- rate limiting */

/**
 * Staff dashboard budgets in this route's OWN namespace (never shared with the
 * child surfaces, and never shared with the suggestions buckets even though the
 * numbers match). Sizing rationale, from the plan: the normal daily check is
 * TWO authenticated GETs per /staff visit (suggestions + progress) plus at most
 * one retry — the suggestions-level budgets leave an order of magnitude of
 * headroom, while the per-IP aggregate still bounds a stolen-token or scripted
 * reader. The limiter doubles as this endpoint's server-side cooldown: the
 * client polls on no interval, only a manual Refresh button.
 *
 * Both constants are PINNED by the unit test so any future tightening is a
 * deliberate edit rather than a drive-by.
 */
export const PROGRESS_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 60 };
export const PROGRESS_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 120 };

/**
 * Composite keys with BOTH segments escaped before the `:` join — an IPv6 ip or
 * a `:` in a forged sub must never alias two distinct (ip,user) pairs onto one
 * bucket (see docs/solutions/security-issues/
 * composite-rate-limit-key-string-join-collides-*.md).
 *
 * `encodeRateLimitSegment` rather than a bare `encodeURIComponent`: the user
 * segment is an attacker-supplied JWT `sub`, and a LONE SURROGATE in it makes
 * encodeURIComponent THROW — which on this route would land BEFORE either
 * strike is recorded, bypassing throttling entirely. This function is total.
 */
export function deriveProgressRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-progress:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-progress-ip:${ipEnc}`,
  };
}

/* --------------------------------------------------------------------- caps */

/**
 * The doc SHAPE this walk understands, mirroring DOC_VERSION in the
 * first-profit repo's src/state/gameCore.ts. The client's `fromSaveDoc`
 * REFUSES any other version outright ("unknown-version") and boots the kid into
 * an EMPTY game — so a doc this walk cannot read is a doc the child cannot read
 * either. Reading it anyway would show staff a full progress row for a kid
 * staring at a blank factory floor, which is the precise opposite of what this
 * dashboard is for. (The save-doc guard passes such a write through untouched,
 * so a child CAN put one in the table.)
 */
export const PROGRESS_DOC_VERSION = 1;

/**
 * Per-child ENTRY bounds — the dimension the task-id filter does NOT bound (see
 * the module header). Generous against reality and tight against abuse: the FP
 * client caps a kid at MAX_IDEAS = 5 and the one-active-business invariant means
 * a handful of business records ever, so 50 of each is roughly an order of
 * magnitude of headroom for a legitimate doc.
 *
 * Unit 4: these bound BYTES, not a child's contribution to an AVERAGE. One child
 * with 50 ideas carrying crafted stamp pairs can move the cohort median and
 * inflate a task's WIP by 50 while reporting `truncated: false` and no anomaly
 * of any kind. The aggregation layer must bound per-child influence (weight,
 * exclude, or surface the concentration) — the server cannot, because it does
 * not know what an average is.
 */
export const PROGRESS_IDEAS_CAP = 50;
export const PROGRESS_BUSINESSES_CAP = 50;

/**
 * Per-map entry bound, and a bound on the WALK rather than on the response (the
 * filter bounds the response). The full path is 25 criteria of a handful of
 * tasks each — well under 200 entries for a completed kid — so 500 cannot be
 * reached honestly, while a doc packing thousands of keys into one map is
 * bounded here instead of costing per-child CPU for the whole cohort.
 *
 * Only entries that are actually COMPLETIONS count against it. A `false` is not
 * a completion anywhere in this module, and letting one consume budget was
 * exploitable: JSON preserves insertion order, so 500 junk `false` keys written
 * BEFORE the real work would exhaust the cap first and leave the child reading
 * as "never reached this criterion" while their own client shows full progress.
 *
 * That fix was only HALF of the exploit, which is the more interesting half.
 * "JSON preserves insertion order" is not true of all keys: ECMAScript
 * enumerates ARRAY-INDEX-LIKE keys FIRST, in ascending numeric order, before any
 * string key and regardless of when it was written. So
 * `{"0":true, …, "499":true, "1.2.3":true}` puts the real task id at position
 * 500 — one past the cap — no matter what order the child's client wrote them
 * in, and the `true` values sail past the `false` filter. Same outcome: an empty
 * map, `hasCompletionsOutsideRequest:false`, a child who reads as "never got
 * here" while their own screen shows full progress.
 *
 * Closed at the KEY level rather than by sorting: `isArrayIndexLikeKey` drops
 * those keys outright, so the cap's order is writer-independent by construction
 * (see `isKeepableMapKey`). Sorting the whole map before capping would also
 * work, and costs an O(n log n) sort on the very input an attacker controls the
 * size of — the wrong trade on a path that runs for every child on every
 * refresh.
 */
export const PROGRESS_MAP_ENTRIES_CAP = 500;

/**
 * The bound on the SCAN, as distinct from the bound on the output.
 *
 * PROGRESS_MAP_ENTRIES_CAP bounds what a map contributes to the response, but
 * not what walking it COSTS: `narrowTimestampMap` deliberately keeps scanning
 * past the cap so `lastCompletionAt` covers the whole map, so a doc packing a
 * million keys into one map spends a million iterations per child, per refresh,
 * before any cap fires. The doc CHECK cannot stop this — it measures the
 * COMPRESSED datum, and a million short repetitive keys compress to nothing.
 *
 * 5,000 is ten times the entry cap: a real map is under 200 entries, so nothing
 * legitimate is near it, and a map that reaches it has already told us
 * everything true it had to say. Hitting it flags the child as truncated.
 */
export const PROGRESS_MAP_SCAN_CAP = 5_000;

/**
 * Per-map KEY bound, again on the WALK. Real keys are `1.1.3` (5 chars) or the
 * legacy `1.1#0`, so 64 is roughly an order of magnitude of headroom.
 *
 * The doc CHECK measures `pg_column_size(doc)` — the COMPRESSED size — so 500
 * keys each padded to kilobytes of one repeated character sit comfortably under
 * it while expanding to megabytes of intermediate structure. Such a key can no
 * longer reach the wire (no requested id is longer than 8 chars), but walking
 * and holding it still costs, for every child, on every refresh. An over-long
 * key is SKIPPED — never truncated to a prefix, which would collide with a real
 * id and silently credit the wrong task — and flags truncation.
 */
export const PROGRESS_MAP_KEY_MAX_CHARS = 64;

/**
 * Child-authored ID bound: `ideas[].id`, `businesses[].id`, `businesses[].ideaId`.
 *
 * These are NOT map keys, so PROGRESS_MAP_KEY_MAX_CHARS misses them, and since
 * the idea `label` left the wire they are the DOMINANT payload term — the maps
 * are now at most 32 keys of at most 8 characters. Measured: 50 ideas plus 50
 * businesses carrying 400,000-character ids compress far under the 256KiB doc
 * CHECK and emit tens of megabytes.
 *
 * An over-long id is SKIPPED, never truncated, for the same reason as a map key:
 * a sliced id would collide with another and mis-link `Business.ideaId`. A UUID
 * (36) and a minted `legacy-idea-{n}` are both well inside 64.
 */
export const PROGRESS_ID_MAX_CHARS = 64;

/**
 * The largest epoch-ms value `new Date()` can represent. A stamp past it makes
 * `new Date(x).toISOString()` THROW RangeError in the client's renderer, so it
 * is DROPPED outright — the completion degrades to "done at an unknown time", a
 * state the client already models. This is the absurd-value guard; ordinary
 * future stamps are handled by the clamp below, not by this.
 */
export const PROGRESS_MAX_TIMESTAMP_MS = 8.64e15;

/**
 * How far ahead of the server's clock a stamp may sit before it is treated as
 * wrong rather than merely skewed.
 *
 * Stamps are written by the CHILD'S device, so a few minutes of drift is normal
 * and must pass through untouched. Past that the value is not a time, and it is
 * load-bearing input: `lastCompletionAt` feeds the client's 30-day active/stalled
 * split, so a stamp of `8.64e15` (which clears the absurd-value guard) would make
 * a child look freshly active FOREVER — no WIP, no stalled, invisible on a board
 * whose entire job is noticing who has stopped. A tablet with a forward-set clock
 * does this by accident.
 *
 * Such a stamp is CLAMPED to the walk's `now` rather than dropped, because
 * dropping would make a legitimately forward-clocked child read as never-active.
 *
 * ⚠️ THE CLAMP ALONE DOES NOT SOLVE THE PROBLEM ABOVE, and an earlier version of
 * this docstring claimed it did ("self-correcting as soon as the next real stamp
 * lands"). Nothing here writes to the database: the stored stamp is still in the
 * future on the NEXT request, and on the one after that, so it clamps to each
 * new `now` in turn and `lastCompletionAt` reads "just now" FOREVER. The escape
 * hatch never fires either — a device with a forward-set clock writes every
 * later stamp in the future too, and a child who has abandoned the game writes
 * none at all. That is precisely the "active forever, never in the stalled
 * column" state this constant exists to prevent.
 *
 * What actually preserves the signal is `recencyClamped`: the clamp bounds the
 * VALUE so the client's renderer cannot throw, and the flag tells the client the
 * value is synthetic so it can withhold "active" rather than credit it. Both
 * halves are required; neither is sufficient. A test that issues ONE request
 * cannot see this — it takes two, with different `now`s.
 */
export const PROGRESS_FUTURE_STAMP_TOLERANCE_MS = 5 * 60_000;

/* ------------------------------------------------------------- read bounds */

/*
 * The route's I/O bounds live HERE, with the rest of the caps, rather than in
 * route.ts: house convention, matching the sibling's SUGGESTIONS_PAGE_CAP. It
 * also keeps `route.ts` exporting only handlers and Next's own config fields,
 * which is worth something on its own — a `route.ts` export that is neither is a
 * shape Next may one day reject.
 */

/**
 * How many rows one page asks for.
 *
 * ASSUMPTION, not a measurement: PostgREST's `max-rows` on this project is taken
 * to be 1000, on the authority of docs/solutions/integration-issues/
 * postgrest-max-rows-1000-silently-truncates-unranged-select-paginate-and-refuse-
 * 2026-07-24.md, which measured it against production on 2026-07-24 for a
 * DIFFERENT table. This work measured nothing; an earlier draft of this comment
 * inherited that doc's "measured against production" wording verbatim and
 * claimed it as its own, which is the kind of borrowed certainty that makes a
 * stale number impossible to re-question.
 *
 * Nothing here DEPENDS on the assumption being right, which is why it is
 * tolerable: paging is KEYSET (`.gt(id, lastSeen).order(id).limit(N)`) and
 * terminates only on an EMPTY page, so a server cap smaller than this page size
 * costs an extra round trip and returns every row anyway. Under the old
 * offset-derived-from-page-INDEX scheme it silently truncated instead — with a
 * cap of 500 and 1200 children the route answered 200 with 500 of them.
 */
export const PROGRESS_PAGE_SIZE = 1000;

/**
 * The page size for `fp_player_saves`, which is NOT row-shaped like the others.
 *
 * A children page is ~50 bytes a row. A saves page carries `doc`, whose CHECK
 * bounds `pg_column_size(doc) <= 262144` — the COMPRESSED size — so a page of
 * 1000 docs is a quarter of a gigabyte of transfer in the worst case. That page
 * cannot land inside PROGRESS_READ_TIMEOUT_MS on transfer volume alone, and the
 * failure is worse than slow: a timeout classifies as `outage`, an outage
 * REFUNDS the rate-limit strike, and the caller retries forever at zero budget
 * cost against a database that is perfectly healthy. Row caps do not see this at
 * all, because the row count is fine.
 *
 * 200 keeps the worst-case page at ~50 MB and the realistic one at a few hundred
 * KB. Paging cost is one extra round trip per 200 children, which the deadline
 * and round-trip budgets below bound in turn.
 */
export const PROGRESS_SAVES_PAGE_SIZE = 200;

/**
 * The hard bound on any one read, in pages. Four pages is 4,000 rows against a
 * real roster of tens — three orders of magnitude of headroom — so reaching it
 * means something is wrong (a runaway import, a join that fanned out), and the
 * right answer to "something is wrong" on a dashboard staff use to decide who to
 * help is a refusal, not a shorter list that reads as fewer children.
 */
export const PROGRESS_MAX_PAGES = 4;

/**
 * The bound on ROUND TRIPS for one logical read, counted ACROSS its id chunks.
 *
 * A page bound alone is per-`readAllPages` call, and `readByIdSet` makes one such
 * call per chunk — so 8 chunks × 5 pages was 40 round trips for a single id-set
 * read, and the "bound" multiplied out to no bound at all. This is the same
 * mistake the row budget already fixed by carrying `rows.length` across chunks;
 * trips now carry the same way.
 *
 * Sized off the smallest page size, which is the worst case: PROGRESS_MAX_ROWS
 * at PROGRESS_SAVES_PAGE_SIZE is 20 full pages, plus one terminating empty page
 * per chunk (8 chunks at PROGRESS_ID_CHUNK) — 28, rounded up for headroom.
 */
export const PROGRESS_MAX_ROUND_TRIPS = 40;

/**
 * The whole-invocation deadline, as a duration from the first line of the
 * handler.
 *
 * Per-call timeouts do not bound their SUM, and four reviewers found the same
 * arithmetic independently: today's 17-child cohort already makes 8 bounded
 * calls, and 8 × PROGRESS_READ_TIMEOUT_MS is 64 s against a 60 s `maxDuration`.
 * Every call can sit comfortably inside its own budget while the invocation is
 * killed by the platform — which answers with a CORS-less error page, the exact
 * different-response-shape oracle this endpoint is organised around avoiding.
 *
 * So the route takes ONE deadline at entry and hands each call whatever remains,
 * refusing as `outage` when nothing does. 45 s leaves 15 s of headroom under
 * `maxDuration` for shaping, serialization and the response itself, so the LAST
 * refusal is always ours.
 */
export const PROGRESS_TOTAL_BUDGET_MS = 45_000;

/**
 * The test-pinned row cap. Rows PAST it are refused, never dropped — so exactly
 * PROGRESS_MAX_ROWS is SERVED and PROGRESS_MAX_ROWS + 1 refuses. Both read paths
 * (`readAllPages` and `readByIdSet`) apply that same boundary; they disagreed
 * before, one refusing AT the cap and the other accepting it.
 */
export const PROGRESS_MAX_ROWS = PROGRESS_PAGE_SIZE * PROGRESS_MAX_PAGES;

/**
 * How many ids go into one `.in(...)` filter. PostgREST puts the whole set in the
 * query string, so an unchunked 4,000-uuid filter is a ~150KB URL that proxies
 * reject — a failure that only appears at scale, the same shape of bug as the row
 * cap above.
 */
export const PROGRESS_ID_CHUNK = 500;

/**
 * The AGGREGATE response budget, in bytes of serialized body.
 *
 * The per-child caps bound one child; nothing bounded the cohort. The task-id
 * filter made that far less likely (a request is ~6 ids, not 125) but not
 * bounded: PROGRESS_MAX_ROWS children × PROGRESS_IDEAS_CAP ideas × 32 requested
 * ids across four maps is hundreds of megabytes, and the platform's own limit
 * for an oversized response is a 500 emitted WITHOUT this route's CORS headers —
 * a different response shape, which is exactly the oracle the byte-identical 401
 * exists to avoid. Refusing ourselves keeps every failure in one voice.
 *
 * 4 MB sits under the 4.5 MB serverless response limit with room for headers,
 * and three orders of magnitude above a real cohort's payload.
 */
export const PROGRESS_MAX_RESPONSE_BYTES = 4_000_000;

/**
 * The cap on any single Supabase round trip this route makes.
 *
 * Nothing in the Supabase client sets a fetch timeout, so an unwrapped call can
 * hang until the platform's own ceiling — app/crm/lib/auth.ts documents that
 * exact hazard on the staff front door ("a stalled round trip held the front
 * door open for the whole serverless budget"). This route makes MANY calls, so
 * the per-call budget must be well under `maxDuration` in route.ts. Deliberately
 * the same 8 s as FW_CALL_TIMEOUT_MS — a staff refresh over a hotel wifi is the
 * same waiting human — but its OWN constant, because nothing about this route
 * should change when the FW venue budget is retuned.
 */
export const PROGRESS_READ_TIMEOUT_MS = 8_000;

/* ------------------------------------------------- the requested task ids */

/**
 * How many task ids one request may name. A criterion view is ~5 tasks plus the
 * ONE predecessor id, so 32 is generous by 5x.
 *
 * What it actually buys: a bound on the PAYLOAD of a single response, and on the
 * per-request work the walk does. It is NOT an exfiltration control — it holds
 * no cross-request state, and 125 ids is four requests against a 60-per-15-min
 * budget. Cumulative exfiltration is bounded by the rate limiter
 * (PROGRESS_RATE_LIMIT / PROGRESS_IP_RATE_LIMIT) and made accountable by the
 * route's audit breadcrumb; this constant only stops any ONE response from
 * being the whole curriculum. Pinned at both boundaries by test (32 accepted,
 * 33 refused) so relaxing it is a deliberate edit.
 */
export const PROGRESS_MAX_REQUESTED_TASK_IDS = 32;

/**
 * The two id shapes the FP content pipeline actually mints, and nothing else:
 *   - a STABLE task id — `phase.criterion.task`, e.g. `1.1.3`
 *     (src/data/pathContent.generated.ts: 5 phases × 5 criteria × ~5 tasks,
 *     every segment 1-based with no leading zeros), and
 *   - a LEGACY `${criterionId}#${index}` key, e.g. `1.1#0`
 *     (src/data/taskRemap.ts LEGACY_KEY_REMAP), whose index IS 0-based.
 * Two digits per segment is deliberate headroom over today's single digits.
 *
 * Deliberately NOT lenient: no whitespace is trimmed and no case is folded.
 * The only legitimate caller reads these ids straight out of CRITERION_SEQUENCE,
 * so `"1.2.3 "` is a client bug, and silently repairing a client bug on a
 * security-relevant validator is how the validator stops being one. Note the
 * pattern bounds length to 8 chars — far inside PROGRESS_MAP_KEY_MAX_CHARS,
 * which the test pins so the two can never drift into disagreement.
 */
export const PROGRESS_TASK_ID_PATTERN = /^[1-9][0-9]?\.[1-9][0-9]?(?:\.[1-9][0-9]?|#[0-9]{1,2})$/;

/** Why a task-id list was refused. VALUE-FREE by construction — see R3 in the
 *  module header: these codes are the ONLY thing a caller or a log may learn
 *  about a bad list, never the list itself. */
export type RequestedTaskIdsRefusal =
  | "not_a_list"
  | "empty"
  | "too_many"
  | "malformed";

/** A discriminated result rather than a throw or a bare null: the route must be
 *  able to answer 400-with-a-generic-body without inventing its own vocabulary,
 *  and a thrown Error would tempt someone into putting the input in `message`. */
export type RequestedTaskIdsResult =
  | { ok: true; ids: string[] }
  | { ok: false; reason: RequestedTaskIdsRefusal };

/**
 * Parse the caller's task-id list.
 *
 * Accepts an array of strings, or a single comma-separated string (the `?tasks=`
 * query-parameter form the route receives). Empty segments are dropped so a
 * trailing comma is not a refusal; everything else must be well-formed.
 *
 * ── Why an explicit LIST, not a criterion prefix ──
 * An earlier design had the server filter by criterion prefix and INFER each
 * idea's predecessor as "the highest-stamped key outside the criterion". That
 * inference is unsound: in the FP client `COMPLETE_TASK` → `markTaskDone` has NO
 * predecessor guard — ordering is enforced by the UI's unlock logic, not by the
 * data — and the save doc is child-writable directly via PostgREST. Out-of-order
 * stamps are therefore possible, and "highest stamp outside" would pick the
 * WRONG predecessor and produce a wrong cycle time with no symptom. With an
 * explicit list the predecessor is EXACT (the client reads it from
 * CRITERION_SEQUENCE), the server needs no prefix logic, and it holds no
 * sequence knowledge at all — honouring a list is set membership.
 *
 * ── The list is UNTRUSTED REQUEST INPUT ──
 * It is capped BEFORE de-duplication, so 32 copies of one id cannot be used to
 * inflate work past the cap, and it is de-duplicated after, so a duplicated list
 * costs one lookup per distinct id. Nothing here throws, and no refusal carries
 * an echo of the input (R3).
 */
export function deriveRequestedTaskIds(raw: unknown): RequestedTaskIdsResult {
  let entries: unknown[];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === "string") {
    // Segment-splitting only — never a trim of the segment itself (see the
    // pattern's docstring). An empty segment is a delimiter artifact, not an id.
    entries = raw.split(",").filter((part) => part.length > 0);
  } else {
    return { ok: false, reason: "not_a_list" };
  }

  if (entries.length === 0) return { ok: false, reason: "empty" };
  // Bounded BEFORE any per-entry work, and against the RAW length.
  if (entries.length > PROGRESS_MAX_REQUESTED_TASK_IDS) {
    return { ok: false, reason: "too_many" };
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") return { ok: false, reason: "malformed" };
    if (!PROGRESS_TASK_ID_PATTERN.test(entry)) return { ok: false, reason: "malformed" };
    if (seen.has(entry)) continue; // duplicates COLLAPSE — they are not a refusal
    seen.add(entry);
    ids.push(entry);
  }
  // Unreachable while the cap is checked above (a de-duplicated list can only
  // shrink), but a list that de-duplicated to nothing would be a silent
  // "everything" filter, which is the one failure mode worth being paranoid
  // about here.
  if (ids.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, ids };
}

/* ------------------------------------------------------------ wire contract */

/** The four completion maps of one idea, as narrowed off the save doc. */
export type ProgressCompletionMaps = {
  /** Legacy `${stepId}#${index}` keyed maps. */
  done: Record<string, boolean>;
  doneAt: Record<string, number>;
  /** Stable task-id keyed maps. */
  doneByTask: Record<string, boolean>;
  doneAtByTask: Record<string, number>;
};

/**
 * One idea as the WALK produces it: maps still UNFILTERED, so the recency
 * number below is computed over everything the child has ever completed.
 *
 * @internal Not the wire shape — `shapeProgress` projects this to ProgressIdea.
 */
export type WalkedIdea = ProgressCompletionMaps & {
  /**
   * The idea's ORIGINAL position in `doc.ideas` — NOT its position in this
   * array, and NOT renumbered by truncation. The original index is
   * load-bearing: the client mints `legacy-idea-{index}` for id-less ideas
   * exactly as the kid's own client did, and a COMPACTED index space would mint
   * different ids and break `Business.ideaId` links.
   */
  index: number;
  id: string | null;
  /**
   * The largest stamp anywhere in this idea's timestamp maps, computed BEFORE
   * any task-id filtering, or null when the idea carries no stamp at all.
   *
   * Load-bearing for the client's active/stalled split: the 30-day recency test
   * CANNOT run against the filtered maps, because an idea working happily in a
   * LATER criterion has no stamps inside the requested window and would read as
   * stalled. One number is also a deliberately minimal disclosure — it is the
   * only thing that leaves the unrequested part of the doc.
   *
   * NOT gated on a matching `done: true`. The field answers "when did this idea
   * last MOVE?", and a stamp is evidence the child's client wrote something at
   * that instant whether or not the paired boolean survived. Gating it would
   * make an abandoned-looking idea out of a doc mid-convergence. What defends it
   * against a forged far-future stamp is the CLAMP, not a gate — see
   * PROGRESS_FUTURE_STAMP_TOLERANCE_MS.
   *
   * Computed over every TYPE-VALID entry, including ones the entry cap dropped:
   * a doc whose newest stamps happen to sit past entry 500 in key order must not
   * report a months-old recency and vanish into the stalled column.
   */
  lastCompletionAt: number | null;
  /**
   * Did the future-stamp clamp actually fire anywhere in this idea's timestamp
   * maps? Value-free — a boolean, never the offending stamp.
   *
   * Read it as "`lastCompletionAt` here is SYNTHETIC — it is this request's
   * clock, not a moment the child did anything". The clamp regenerates on every
   * request (see PROGRESS_FUTURE_STAMP_TOLERANCE_MS), so without this flag a
   * single forward-clocked tablet makes an idea permanently "just active" and it
   * can never appear in the stalled column — on a board whose entire job is
   * noticing who has stopped. The client must EXCLUDE a flagged unit from
   * "active" rather than credit it.
   */
  recencyClamped: boolean;
};

/** The `hasCompletionsOutsideRequest` flag, shared by ideas and businesses. */
type OutsideRequestFlag = {
  /**
   * Does this record have completions OUTSIDE the requested ids? Lets the client
   * tell "hasn't reached this criterion yet" from "already moved past it" — and
   * account for flow units parked outside the visible window in the WIP
   * sum-check — WITHOUT receiving a single unrequested task id.
   */
  hasCompletionsOutsideRequest: boolean;
};

/** One idea's completion state, as the staff client receives it: maps filtered
 *  to exactly the requested task ids. */
export type ProgressIdea = WalkedIdea & OutsideRequestFlag;

/**
 * One business record as the WALK produces it. Stable-id maps only — by design
 * there are no legacy maps on a Business (the record postdates the stable-id
 * migration).
 *
 * @internal Not the wire shape — `shapeProgress` projects this to
 * ProgressBusiness.
 */
export type WalkedBusiness = {
  id: string;
  /**
   * The linked idea's id. NULL only when the doc omits it, or carries a
   * non-string / empty value. A well-formed but DANGLING id (no idea in this
   * doc has it — e.g. the idea was deleted) passes through UNRESOLVED, exactly
   * as written: the client must handle the lookup miss and render an "unlinked"
   * row. Resolving it to null here would destroy the only evidence of which
   * idea the business came from.
   */
  ideaId: string | null;
  /**
   * True only for an explicit `archived: true`. Without it the client cannot
   * tell an abandoned business from the active one, and the plan's "next task
   * from the most recent completion" rule would happily point staff at an
   * ARCHIVED record.
   */
  archived: boolean;
  doneByTask: Record<string, boolean>;
  doneAtByTask: Record<string, number>;
  /**
   * The business's OWN recency, pre-filter — and NOT a duplicate of its idea's.
   *
   * Phase 4-5 completions write ONLY here: `markTaskDone` in the FP client's
   * src/state/gameCore.ts branches on grow/scale and returns after writing the
   * BUSINESS maps, never touching the idea's. So a child completing Grow tasks
   * every day has an idea `lastCompletionAt` frozen at their last Validate
   * stamp. Reading recency off the idea alone would report the cohort's most
   * ACTIVE children as stalled and paint the whole Grow/Scale half of the board
   * 100% stalled.
   *
   * An idea-less business (dangling or absent `ideaId`) is its own flow unit,
   * and this is the only recency it has.
   */
  lastCompletionAt: number | null;
  /** As `WalkedIdea.recencyClamped`, over this business's own stamps. */
  recencyClamped: boolean;
};

/** One business record as the staff client receives it. */
export type ProgressBusiness = WalkedBusiness & OutsideRequestFlag;

export type ProgressChild = {
  /**
   * children.fp_username. NEVER logged, and never rendered by the client until
   * staff DRILL IN to a WIP bucket — the main flow board is aggregate-only. It
   * is on the wire from the first load precisely so the drill-down needs no
   * second request; the rendering discipline is the client's to keep.
   */
  username: string;
  /**
   * A walk bound fired somewhere in THIS CHILD'S DOC — it exceeded an entry cap,
   * a map-key length, or an id length (see the module header).
   *
   * Read it as "this doc is abnormal", NOT as "your view is incomplete". The
   * losses it reports happen BEFORE the task-id filter, so a child can be
   * flagged while every id the caller actually requested was delivered intact —
   * and equally, a normal-looking row is not a promise that nothing was lost
   * somewhere the caller did not ask about.
   *
   * The aggregate view must DECIDE what to do with a flagged child. Today they
   * are folded silently into throughput, the median and WIP like anyone else; if
   * that is not what Unit 4 wants, this flag is the hook.
   */
  truncated: boolean;
  /**
   * A save row EXISTS but its doc could not be read — not an object, or a
   * docVersion this build does not understand. Distinguishes "doc not loadable"
   * (the kid also sees an empty game) from "never started" (no save row at
   * all), which would otherwise be indistinguishable empty rows.
   */
  docUnreadable: boolean;
  ideas: ProgressIdea[];
  businesses: ProgressBusiness[];
};

/* -------------------------------------------------------------- row inputs */

/** Only the two columns the shape actually reads. `birth_year` / `grade` left
 *  with band in the 2026-08-05 redesign. */
export type ProgressChildRowLike = {
  id: string;
  fp_username?: unknown;
};

export type ProgressProfileRowLike = { id: string; child_id: string };

/** fp_player_saves: `doc` is jsonb — `unknown` until the walk narrows it. */
export type ProgressSaveRowLike = { profile_id: string; doc?: unknown };

/* ------------------------------------------------------------- doc walking */

/** JSON-object check matching jsonb_typeof(x) = 'object' (arrays excluded) —
 *  the same narrowing primitive fp-save-doc-guard-rules.ts uses at every step. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * State threaded through one child's walk: the truncation flag, and the ceiling
 * every stamp is clamped against.
 *
 * `nowMs` lives here rather than being read from the clock inside the walk so
 * the module stays pure and the whole cohort is clamped against ONE instant —
 * two children clamped against different `new Date()` calls would disagree by
 * milliseconds for no reason a reader could ever explain.
 */
type WalkBudget = { truncated: boolean; nowMs: number };

/**
 * Keys that would SHADOW something on `Object.prototype` if written into a
 * plain object literal.
 *
 * This is not paranoia about a hypothetical: a doc carrying
 * `doneByTask: {"hasOwnProperty": true}` survives every value-type filter, and
 * the first consumer that calls `map.hasOwnProperty(taskId)` gets a TypeError —
 * which in React blanks the entire cohort table, not just that child's row.
 * `__proto__` is worse still: assigning it into an object literal mutates the
 * prototype instead of adding a key.
 *
 * `Object.create(null)` is NOT the fix — it makes those methods missing for
 * EVERY key, breaking the same consumer unconditionally. Skipping the dangerous
 * keys is. This is JS object hygiene, not task-id domain knowledge, so it does
 * not breach the server's stay-out-of-the-content-domain rule: no real task id
 * or legacy `${stepId}#${index}` key can collide with it.
 */
function isUnsafeMapKey(key: string): boolean {
  return key === "__proto__" || key in Object.prototype;
}

/**
 * Keys JavaScript enumerates BEFORE every string key, in ascending numeric
 * order, whatever order they were written in — the canonical decimal spellings
 * of 0 … 2³²−2, which the spec calls array indices.
 *
 * They are the second half of the entry-cap exploit documented at
 * PROGRESS_MAP_ENTRIES_CAP: they let a hostile doc push a real task id past the
 * cap without depending on insertion order at all. Dropping them is exact rather
 * than heuristic — no stable task id (`1.2.3`, always three dot-joined segments)
 * and no legacy `${stepId}#${index}` key (always contains `#`) can be one, so
 * this excludes nothing a real client writes. `"01"`, `"1.0"` and `"-1"` are NOT
 * array indices (their canonical spellings differ), so they stay ordinary string
 * keys and are handled by the pattern-free rules around them.
 */
function isArrayIndexLikeKey(key: string): boolean {
  const asNumber = Number(key);
  return (
    Number.isInteger(asNumber) &&
    asNumber >= 0 &&
    asNumber < 2 ** 32 - 1 &&
    String(asNumber) === key
  );
}

/**
 * Is this key usable at all? Shadowing keys, ARRAY-INDEX-LIKE keys and over-long
 * keys are the three reasons to skip one; all three are hostile-writer hygiene
 * rather than task-id domain knowledge (no real task id or legacy
 * `${stepId}#${index}` key can be any of them). An over-long key flags the child
 * as truncated so the loss is visible; the other two do not, because neither was
 * ever a completion.
 */
function isKeepableMapKey(key: string, budget: WalkBudget): boolean {
  if (isUnsafeMapKey(key)) return false;
  if (isArrayIndexLikeKey(key)) return false;
  if (key.length > PROGRESS_MAP_KEY_MAX_CHARS) {
    budget.truncated = true;
    return false;
  }
  return true;
}

/**
 * A boolean completion map, filtered to actual `true` entries.
 *
 * A string "true", a 1, or a null is a writer we do not recognise — dropped
 * rather than coerced, so the client never counts a completion the kid's own
 * client would not. An explicit `false` is dropped too: it is not a completion
 * (absent and false are the same thing to every consumer), and keeping it let a
 * doc spend the entry cap on non-completions — see PROGRESS_MAP_ENTRIES_CAP.
 * Keys are otherwise passed through untouched (no remapping, no normalisation)
 * apart from the `isKeepableMapKey` exclusions.
 */
function narrowBooleanMap(value: unknown, budget: WalkBudget): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isJsonObject(value)) return out;
  let kept = 0;
  let scanned = 0;
  // `for…in` + hasOwn rather than Object.entries: entries EAGERLY materialises
  // an array of every [key, value] pair before the loop body runs even once, so
  // the scan cap below could not bound a hostile map's cost at all.
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (++scanned > PROGRESS_MAP_SCAN_CAP) {
      budget.truncated = true;
      break;
    }
    if (value[key] !== true) continue;
    if (!isKeepableMapKey(key, budget)) continue;
    if (kept >= PROGRESS_MAP_ENTRIES_CAP) {
      budget.truncated = true;
      break;
    }
    out[key] = true;
    kept++;
  }
  return out;
}

/**
 * A narrowed timestamp map, the largest stamp seen while narrowing it (including
 * entries the entry cap then dropped), and whether the future-stamp CLAMP
 * actually fired on any of them.
 */
type NarrowedStamps = {
  map: Record<string, number>;
  max: number | null;
  clamped: boolean;
};

/**
 * A timestamp map (epoch ms), filtered to FINITE numbers in
 * [0, PROGRESS_MAX_TIMESTAMP_MS] and clamped to the walk's `now`.
 *
 * String stamps, NaN, Infinity, negatives, and out-of-Date-range values are
 * dropped: every one of them would poison the client's recency math, and a
 * dropped stamp degrades to "completion with unknown time" — a state the client
 * already models — where a poisoned one would silently mis-sort or crash the
 * whole cohort view. A merely FUTURE stamp is clamped rather than dropped (see
 * PROGRESS_FUTURE_STAMP_TOLERANCE_MS).
 *
 * `max` is tracked over every type-valid entry BEFORE the entry cap can
 * short-circuit the map — the cap bounds what goes on the wire, and must not
 * silently bound the child's recency as well.
 */
function narrowTimestampMap(value: unknown, budget: WalkBudget): NarrowedStamps {
  const map: Record<string, number> = {};
  let max: number | null = null;
  let clamped = false;
  if (!isJsonObject(value)) return { map, max, clamped };
  const ceiling = budget.nowMs + PROGRESS_FUTURE_STAMP_TOLERANCE_MS;
  let kept = 0;
  let scanned = 0;
  // See narrowBooleanMap for why this is `for…in` and not Object.entries.
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (++scanned > PROGRESS_MAP_SCAN_CAP) {
      budget.truncated = true;
      break;
    }
    const entry = value[key];
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
    if (entry < 0 || entry > PROGRESS_MAX_TIMESTAMP_MS) continue;
    if (!isKeepableMapKey(key, budget)) continue;
    let stamp = entry;
    if (entry > ceiling) {
      stamp = budget.nowMs;
      clamped = true;
    }
    if (max === null || stamp > max) max = stamp;
    // `continue`, not `break`: the cap stops the map growing, but the scan runs
    // on so `max` covers the whole map (up to the scan cap).
    if (kept >= PROGRESS_MAP_ENTRIES_CAP) {
      budget.truncated = true;
      continue;
    }
    map[key] = stamp;
    kept++;
  }
  return { map, max, clamped };
}

/** The larger of two recencies, either of which may be absent. */
function laterOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * A child-authored id, or null. Skipped whole past PROGRESS_ID_MAX_CHARS —
 * never truncated, because a sliced id collides and mis-links Business.ideaId.
 */
function narrowAuthoredId(value: unknown, budget: WalkBudget): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length > PROGRESS_ID_MAX_CHARS) {
    budget.truncated = true;
    return null;
  }
  return value;
}

/** The walked entry for an idea slot the walk could not read as an object. */
function placeholderIdea(index: number): WalkedIdea {
  return {
    index,
    id: null,
    done: {},
    doneAt: {},
    doneByTask: {},
    doneAtByTask: {},
    lastCompletionAt: null,
    recencyClamped: false,
  };
}

/**
 * The ideas walk.
 *
 * A malformed entry becomes a PLACEHOLDER rather than a hole: the FP client's
 * `fromSaveDoc` runs `.map(coerceIdea)`, which COERCES a non-object into a real
 * empty idea and mints `legacy-idea-{index}` for it. Dropping it here would
 * leave the server and the kid's own client disagreeing about which indices
 * exist, and a business linking to that minted id would dangle for staff while
 * resolving fine for the child. Array HOLES (only reachable from a sparse JS
 * array — jsonb has none) are skipped, matching `.map`'s own hole semantics.
 *
 * Every surviving entry carries its ORIGINAL array index. The ideas cap takes
 * the first N entries the walk emits and stops; it never renumbers what it
 * keeps.
 */
function walkIdeas(rawIdeas: unknown, budget: WalkBudget): WalkedIdea[] {
  if (!Array.isArray(rawIdeas)) return [];
  const out: WalkedIdea[] = [];
  for (let index = 0; index < rawIdeas.length; index++) {
    if (out.length >= PROGRESS_IDEAS_CAP) {
      budget.truncated = true;
      break;
    }
    if (!Object.hasOwn(rawIdeas, index)) continue; // sparse hole
    const raw = rawIdeas[index];
    if (!isJsonObject(raw)) {
      out.push(placeholderIdea(index));
      continue;
    }
    const doneAt = narrowTimestampMap(raw.doneAt, budget);
    const doneAtByTask = narrowTimestampMap(raw.doneAtByTask, budget);
    out.push({
      index,
      id: narrowAuthoredId(raw.id, budget),
      done: narrowBooleanMap(raw.done, budget),
      doneAt: doneAt.map,
      doneByTask: narrowBooleanMap(raw.doneByTask, budget),
      doneAtByTask: doneAtByTask.map,
      lastCompletionAt: laterOf(doneAt.max, doneAtByTask.max),
      recencyClamped: doneAt.clamped || doneAtByTask.clamped,
    });
  }
  return out;
}

/**
 * The businesses walk. A business is IDENTIFIED by its id — there is no second
 * key (ideas have `index`; businesses do not) — so an entry without a usable
 * string id is dropped, and a DUPLICATE id keeps the FIRST occurrence only.
 * First-wins matters: a client keying rows by id would otherwise keep the LAST
 * entry, so a doc carrying `[{id:"b1", <full maps>}, {id:"b1"}]` would zero out
 * the child's own Phase 4/5 progress in the staff view. Everything else about
 * an entry degrades rather than disqualifies.
 */
function walkBusinesses(rawBusinesses: unknown, budget: WalkBudget): WalkedBusiness[] {
  if (!Array.isArray(rawBusinesses)) return [];
  const out: WalkedBusiness[] = [];
  const seen = new Set<string>();
  for (const raw of rawBusinesses) {
    if (out.length >= PROGRESS_BUSINESSES_CAP) {
      budget.truncated = true;
      break;
    }
    if (!isJsonObject(raw)) continue;
    const id = narrowAuthoredId(raw.id, budget);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    const doneAtByTask = narrowTimestampMap(raw.doneAtByTask, budget);
    out.push({
      id,
      ideaId: narrowAuthoredId(raw.ideaId, budget),
      archived: raw.archived === true,
      doneByTask: narrowBooleanMap(raw.doneByTask, budget),
      doneAtByTask: doneAtByTask.map,
      lastCompletionAt: doneAtByTask.max,
      recencyClamped: doneAtByTask.clamped,
    });
  }
  return out;
}

export type WalkedSaveDoc = {
  ideas: WalkedIdea[];
  businesses: WalkedBusiness[];
  truncated: boolean;
  docUnreadable: boolean;
};

/**
 * One save doc → the per-child progress payload. Total and fail-closed: a doc
 * that is not an object, or whose `docVersion` this build does not understand,
 * yields empty structures with `docUnreadable: true`; a doc whose `ideas` is
 * not an array simply yields no ideas. Never throws.
 *
 * `deletedIdeaIds` (the tombstone set) is deliberately IGNORED, and that
 * matches the client: the FP client's `fromSaveDoc` does not filter tombstoned
 * ideas out of the doc either, so honoring them here would show staff FEWER
 * ideas than the child sees. Do not "fix" this without changing both.
 *
 * `now` is the clamp ceiling for every stamp in the doc (see
 * PROGRESS_FUTURE_STAMP_TOLERANCE_MS). It is a parameter, not a `new Date()`
 * inside, so the module stays pure and the whole cohort is clamped against one
 * instant.
 *
 * @internal Exported as a test seam, not part of the route contract.
 */
export function walkSaveDoc(doc: unknown, now: Date): WalkedSaveDoc {
  if (!isJsonObject(doc) || doc.docVersion !== PROGRESS_DOC_VERSION) {
    return { ideas: [], businesses: [], truncated: false, docUnreadable: true };
  }
  const budget: WalkBudget = { truncated: false, nowMs: now.getTime() };
  const ideas = walkIdeas(doc.ideas, budget);
  const businesses = walkBusinesses(doc.businesses, budget);
  return { ideas, businesses, truncated: budget.truncated, docUnreadable: false };
}

/* ------------------------------------------------------- task-id filtering */

/** One map, keys restricted to the requested set. */
function keepRequestedKeys<V>(
  map: Record<string, V>,
  taskIds: ReadonlySet<string>
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(map)) {
    if (taskIds.has(key)) out[key] = value;
  }
  return out;
}

/**
 * The completion maps, filtered to exactly the requested task ids.
 *
 * PURE SET MEMBERSHIP and nothing else: no criteria, no prefixes, no ordering,
 * no notion of a "predecessor". The client already put the predecessor id in the
 * list, so the server cannot get it wrong — which is precisely why this design
 * replaced prefix filtering (see `deriveRequestedTaskIds`). A legacy
 * `${stepId}#${index}` key matches by exact string like any other; the client
 * sends whichever form it wants.
 *
 * Applied AFTER `lastCompletionAt` is computed — the order is load-bearing and
 * is structurally guaranteed by `walkSaveDoc` producing that number and this
 * function never seeing it.
 *
 * @internal Exported as a test seam, not part of the route contract.
 */
export function filterMapsToTaskIds(
  maps: ProgressCompletionMaps,
  taskIds: ReadonlySet<string>
): ProgressCompletionMaps {
  return {
    done: keepRequestedKeys(maps.done, taskIds),
    doneAt: keepRequestedKeys(maps.doneAt, taskIds),
    doneByTask: keepRequestedKeys(maps.doneByTask, taskIds),
    doneAtByTask: keepRequestedKeys(maps.doneAtByTask, taskIds),
  };
}

/**
 * Does this record carry any COMPLETION the caller did not ask about? Must be
 * given the UNFILTERED maps (post-filter it is trivially false).
 *
 * A completion is a `true` in a BOOLEAN map, and only that. The client's union
 * rule is explicit that a timestamp without its `done: true` never mints a
 * completion, so a bare stamp must not answer this question either — otherwise
 * `{done:{"1.2#4":false}, doneAt:{"1.2#4":10}}` would report the idea as having
 * moved past a criterion it never completed. (The two timestamp maps are
 * therefore not read here at all: any stamp that IS a completion has its `true`
 * in the boolean map beside it.)
 *
 * Why a `false` is untrusted rather than merely uninteresting: the save doc is
 * child-WRITABLE via PostgREST, so a `false` is attacker-supplied input, not a
 * record of anything the game did. (The FP client itself has no un-complete
 * action — `GameAction` is `COMPLETE_TASK` and `RESET_SESSION`, and
 * `markTaskDone` only ever writes `true` — so a `false` never comes from normal
 * play at all.) The walk already drops them; this is the second half of the same
 * rule, kept explicit so removing one does not silently disarm the other.
 *
 * It is deliberately SEPARATE from `filterMapsToTaskIds` rather than fused into
 * one projection helper: they answer different questions (what to send vs. what
 * was left behind), and fusing them would couple the flag to the projection.
 *
 * @internal Exported as a test seam, not part of the route contract.
 */
export function hasCompletionsOutsideRequest(
  maps: Readonly<{ done: Record<string, boolean>; doneByTask: Record<string, boolean> }>,
  taskIds: ReadonlySet<string>
): boolean {
  for (const [key, value] of Object.entries(maps.done)) {
    if (value && !taskIds.has(key)) return true;
  }
  for (const [key, value] of Object.entries(maps.doneByTask)) {
    if (value && !taskIds.has(key)) return true;
  }
  return false;
}

/** Walked idea → wire idea: filter the maps, keep the pre-filter recency, and
 *  record whether anything was left behind. */
function projectIdea(idea: WalkedIdea, taskIds: ReadonlySet<string>): ProgressIdea {
  return {
    ...idea,
    ...filterMapsToTaskIds(idea, taskIds),
    hasCompletionsOutsideRequest: hasCompletionsOutsideRequest(idea, taskIds),
  };
}

/** Walked business → wire business. Same two steps as an idea, over the two
 *  stable maps a Business has. */
function projectBusiness(
  business: WalkedBusiness,
  taskIds: ReadonlySet<string>
): ProgressBusiness {
  return {
    ...business,
    doneByTask: keepRequestedKeys(business.doneByTask, taskIds),
    doneAtByTask: keepRequestedKeys(business.doneAtByTask, taskIds),
    hasCompletionsOutsideRequest: hasCompletionsOutsideRequest(
      { done: {}, doneByTask: business.doneByTask },
      taskIds
    ),
  };
}

/* ------------------------------------------------------------ row shaping */

/**
 * Pure Map-join + projection (the suggestions id-set style): roster rows →
 * profiles by child_id → saves by profile_id → the wire contract, with every
 * completion map filtered to `requestedTaskIds`.
 *
 * `requestedTaskIds` MUST be the `ids` of a successful `deriveRequestedTaskIds`
 * result. Nothing in the type system links the two, so enforcing the cap and the
 * id pattern is the ROUTE'S job — this function trusts the list it is handed.
 * It is REQUIRED and has no "unfiltered" spelling on purpose: a caller that
 * forgets it must fail to compile, not quietly ship the whole curriculum.
 *
 * An EMPTY list yields NO CHILDREN AT ALL, deliberately. It is tempting to let
 * it mean "empty maps", but the result would be actively misleading rather than
 * merely empty: `hasCompletionsOutsideRequest` is computed against that same
 * empty set, so it reads TRUE for every child who has ever completed anything,
 * each with a real `lastCompletionAt`. A client applying the documented
 * semantics would draw a confident board saying every child has moved past every
 * requested criterion and all of them are active. A visibly empty board is an
 * honest one. (`deriveRequestedTaskIds` never returns an empty list, so this is
 * the guard for a caller that bypassed it.)
 *
 * `now` is the clamp ceiling for every stamp in every doc, threaded from a
 * single `new Date()` at the route boundary — one clock for the whole cohort.
 *
 * A child with no fp_username is skipped (the route's query already excludes
 * them; this is the fail-closed second half). A child with no profile row or no
 * save row is PRESENT in the output with empty ideas/businesses and
 * `docUnreadable: false` — that is the "never started" signal, and dropping the
 * row would make a stalled kid invisible, which is the exact failure this
 * dashboard exists to prevent.
 */
/**
 * An operator-facing note about ONE walked doc, keyed by `profile_id`.
 *
 * Why `profile_id` and not the username: the username is child data and R3
 * forbids it in a log line, while `profile_id` is an opaque uuid that names the
 * ROW an operator would have to open to repair the doc. Without it, "some child
 * has a doc that trips the caps" is a fact nobody can act on — never-log
 * discipline had accidentally made the abnormal-doc signal unusable.
 */
export type ProgressWalkNote = {
  profileId: string;
  truncated: boolean;
  docUnreadable: boolean;
};

export function shapeProgress(
  children: readonly ProgressChildRowLike[],
  profiles: readonly ProgressProfileRowLike[],
  saves: readonly ProgressSaveRowLike[],
  requestedTaskIds: readonly string[],
  now: Date,
  /**
   * Optional collector for the notes above. APPENDED to, never read — the module
   * still logs nothing and decides nothing from it, so the function stays pure
   * in the sense this file cares about (no clock, no I/O, same output for the
   * same input). The route owns whether any of it is worth a log line.
   */
  walkNotes?: ProgressWalkNote[]
): ProgressChild[] {
  const taskIds = new Set(requestedTaskIds);
  if (taskIds.size === 0) return [];
  // First row wins on duplicates: the schema is one profile per child
  // (child_id unique) and one save per profile (profile_id PK), so this is
  // unreachable — and inventing a merge rule here would hide a data bug behind
  // a plausible-looking number.
  const profileByChildId = new Map<string, ProgressProfileRowLike>();
  for (const p of profiles) if (!profileByChildId.has(p.child_id)) profileByChildId.set(p.child_id, p);

  const saveByProfileId = new Map<string, ProgressSaveRowLike>();
  for (const s of saves) if (!saveByProfileId.has(s.profile_id)) saveByProfileId.set(s.profile_id, s);

  const out: ProgressChild[] = [];
  for (const child of children) {
    // Not trimmed: the username is an IDENTITY value the client matches
    // against, so it passes through exactly as stored — only absent/empty
    // disqualifies.
    if (typeof child.fp_username !== "string" || child.fp_username.length === 0) continue;
    const profile = profileByChildId.get(child.id);
    const save = profile ? saveByProfileId.get(profile.id) : undefined;
    const walked: WalkedSaveDoc = save
      ? walkSaveDoc(save.doc, now)
      : { ideas: [], businesses: [], truncated: false, docUnreadable: false };
    if (walkNotes && save && (walked.truncated || walked.docUnreadable)) {
      walkNotes.push({
        profileId: save.profile_id,
        truncated: walked.truncated,
        docUnreadable: walked.docUnreadable,
      });
    }
    out.push({
      username: child.fp_username,
      truncated: walked.truncated,
      docUnreadable: walked.docUnreadable,
      ideas: walked.ideas.map((idea) => projectIdea(idea, taskIds)),
      businesses: walked.businesses.map((business) => projectBusiness(business, taskIds)),
    });
  }
  return out;
}
