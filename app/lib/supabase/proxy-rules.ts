/**
 * Pure proxy decisions + cookie carry-over (T1 plan Unit 1).
 *
 * `proxy.ts` gates BOTH /crm and (from Unit 6) /fp, which makes it the
 * highest-blast-radius file in the plan — and the repo has no way to build a
 * NextRequest in a test. So the decisions live here, free of next/supabase
 * imports, exactly as `app/crm/lib/access.ts` does for requireStaff().
 *
 * Two decisions belong here:
 *  1. `resolveProxyOutcome` — which gate verdict a (pathname, session) pair earns.
 *  2. `shouldCarryHeader` — which headers survive onto a redirect/rewrite. The
 *     gated branches build fresh responses, so the auth cookies and no-store
 *     headers @supabase/ssr just set have to be carried across or the session
 *     silently ends — but Next's internal `x-middleware-*` wire protocol must
 *     NOT be, or a rewrite ships contradictory routing directives.
 */

/** Just the shape the decision needs from a Supabase session. */
export type ProxySessionLike = {
  user: { app_metadata?: Record<string, unknown> | null };
} | null;

export type ProxyOutcome =
  /** Pass through, returning the cookie-carrying response untouched. */
  | "pass"
  /** No session on a guarded /crm path → redirect to the staff sign-in. */
  | "crm-login"
  /** Session without the admin claim → rewrite to 404 semantics. */
  | "crm-staff-only"
  /**
   * No session on a guarded /fp/fw route → redirect to the GUIDE sign-in
   * (FW Unit 2). The student/parent counterpart ("path-login" → /fp/sign-in)
   * went with the First Profit UI in v3 plan Unit 10: /fp/* is now nothing but
   * redirect stubs, so there is no signed-out /fp route left to send anywhere.
   * A guide whose session expired at 9:05 on a Saturday must still land on the
   * door that takes their email and password.
   */
  | "fw-login";

/**
 * Routes that must stay reachable without a session, or the gate locks the
 * door to the door: /crm/login would redirect-loop, /crm/staff-only would
 * defeat its own 404 rewrite, /crm/reset arrives session-less by design, and
 * /fp/sign-in is the Path equivalent (Unit 6).
 *
 * /fp/fw/sign-in is the guide door (FW Unit 2) — same redirect-loop reason.
 */
const UNGUARDED = new Set([
  "/crm/login",
  "/crm/staff-only",
  "/crm/reset",
  "/fp/sign-in",
  "/fp/fw/sign-in",
]);

/**
 * Prefix-unguarded: the co-parent invite landing (Unit 15) arrives session-less
 * by design — the emailed token in the path is the credential, and the page
 * only READS (acceptance is a POSTed action). The trailing slash is required:
 * a bare /fp/invite has no token and may stay behind the gate.
 *
 * /fp/apple-icon (Unit 11): the file-convention apple-touch-icon for the
 * /fp subtree. iOS fetches it during Add to Home Screen — including from the
 * session-less sign-in page — and a redirect here ships HTML as the icon. A
 * static PNG route handler; nothing to protect. The prefix requires a "." or
 * "-" delimiter (apple-icon.png / apple-icon-<hash>.png — Next's two emitted
 * shapes) so a future route that merely SHARES the prefix (/fp/apple-iconX)
 * can never silently inherit the bypass (security review).
 *
 * FW Unit 2 adds two, both session-less BY DESIGN and both with the trailing
 * slash for the same reason the parent invite has one:
 *
 *   /fp/fw/invite/  — the guide's credential link. The token in the path IS
 *     the credential; the landing page only READS (the claim is a POSTed
 *     action), so a scanner prefetch cannot burn it. A bare /fp/fw/invite
 *     carries no token and stays behind the gate.
 *   /fp/fw/board/   — the projected cohort board (Unit 6). A venue projector
 *     has no session and never will; the tokened subtree is hash-validated per
 *     request, expiring, no-store and noindex. The BARE /fp/fw/board — no
 *     token — is not a board, so it stays gated rather than 404ing anonymously.
 *
 * Both are UNAUTHENTICATED READ SURFACES on a route prefix that otherwise
 * requires a session. Anything added under either subtree inherits that, so a
 * future mutating route must not live there.
 */
const UNGUARDED_PREFIXES = [
  "/fp/invite/",
  "/fp/apple-icon.",
  "/fp/apple-icon-",
  "/fp/fw/invite/",
  "/fp/fw/board/",
];

/**
 * Whether a pathname is inside the Founders Weekend subtree — the bare /fp/fw
 * index or anything below it.
 *
 * Exact-or-slash, never a bare `startsWith("/fp/fw")`: a future /fp/fwiw
 * (or /fp/fw-archive) must not silently inherit the guide door's redirect,
 * the same trap `/fpology` sets for the /fp branch below.
 */
function isFwPath(pathname: string): boolean {
  return pathname === "/fp/fw" || pathname.startsWith("/fp/fw/");
}

/**
 * Whether a pathname is the staff hub — the bare /staff or anything below it
 * (Staff Front Door Unit 2, R6).
 *
 * Exact-or-slash, never a bare `startsWith("/staff")`: a future /staffing or
 * /staff-handbook must not silently inherit the hub's gate, the same trap
 * /fpology sets for the /fp branch and /fp/fwiw for the FW one.
 *
 * EXPORTED, unlike `isFwPath`, for one reason: /staff and /crm resolve to the
 * same three outcomes today (R6 holds the hub to the CRM's standard), so a
 * prefix leak into the hub branch is invisible at the outcome level —
 * /staffing earns `crm-login` either way. This predicate is the only thing
 * that can witness it, and only while the two branches happen to agree.
 */
export function isStaffPath(pathname: string): boolean {
  return pathname === "/staff" || pathname.startsWith("/staff/");
}

export function isUnguarded(pathname: string): boolean {
  return UNGUARDED.has(pathname) || UNGUARDED_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * The admin-claim gate, shared by /crm and /staff.
 *
 * R6 asks for the hub to be "held to the same standard as /crm" — a SAMENESS
 * requirement, so it is one function with two call sites rather than two
 * copies that must be kept in step by hand. Unit 1 of this same plan shipped
 * to fix precisely that shape: a check and an act that were supposed to agree,
 * written twice, and drifted.
 *
 * The outcome names stay CRM-flavoured on purpose. The staff sign-in IS
 * /crm/login (scope boundary: the hub does not get a door of its own) and the
 * hub's 404 rewrite target IS /crm/staff-only — a rewrite, so the URL bar
 * keeps reading /staff and the CRM-branded path is never visible.
 *
 * The return type is the three-member SUBSET this can actually produce, not
 * the whole union. proxy.ts carries auth cookies across on every non-"pass"
 * outcome, so a fourth value returned from here would be a new gated branch
 * that skips that copy — and a dropped cookie ends a live session silently.
 * Narrowing makes that a compile error rather than something a test has to
 * notice.
 */
type AdminClaimOutcome = Extract<
  ProxyOutcome,
  "pass" | "crm-login" | "crm-staff-only"
>;

function resolveAdminClaimOutcome(session: ProxySessionLike): AdminClaimOutcome {
  if (!session) return "crm-login";
  if (session.user.app_metadata?.role !== "admin") return "crm-staff-only";
  return "pass";
}

/**
 * Decision table (first match wins):
 * - unguarded path                       → "pass"
 * - /fp/fw/* without a session         → "fw-login"   (the GUIDE door)
 * - /fp/fw/* with any session          → "pass"
 * - /fp/*   (the retired UI redirect stubs) → "pass", session or not
 * - /staff/*  → the admin-claim gate, identical to /crm (R6)
 * - /crm/*    without a session          → "crm-login"
 * - /crm/*    without the admin claim    → "crm-staff-only"
 * - /crm/*    with the admin claim       → "pass"
 *
 * The /fp/fw branch must come BEFORE the /fp branch — /fp/fw/* also matches
 * /fp/*, and the /fp branch now passes everything, so losing the ordering would
 * silently unguard the whole guide app. This ordering is asserted directly in
 * the proxy tests.
 *
 * The FW branch checks no role here. FW roles are grants (FW-D9), not a JWT
 * claim, so the authoritative check is resolveFwActor() inside every
 * Server Function and page — and Next 16's own docs warn that a proxy matcher
 * does not reliably cover Server Function calls anyway. A signed-in student
 * therefore PASSES the proxy at /fp/fw and is refused by the surface itself,
 * which is the correct division: the proxy answers signed-in-or-not, the pure
 * resolver answers who.
 */
export function resolveProxyOutcome({
  pathname,
  session,
}: {
  pathname: string;
  session: ProxySessionLike;
}): ProxyOutcome {
  if (isUnguarded(pathname)) return "pass";

  if (isFwPath(pathname)) {
    return session ? "pass" : "fw-login";
  }

  // Everything else under /fp is a RETIRED First Profit UI route — a page whose
  // whole body is a redirect to firstprofit.school or the dashboard (v3 plan
  // Unit 10, `app/lib/fp/retired-ui-routes.ts`). There is nothing left behind
  // this prefix to guard: no data read, no session used, no render. Gating it
  // would be actively wrong rather than merely useless — a signed-out PARENT
  // holding `/fp/family` or `/fp/review` would be bounced to the kid's sign-in
  // door instead of to their own dashboard, which is the one thing the
  // redirects exist to prevent.
  if (pathname === "/fp" || pathname.startsWith("/fp/")) return "pass";

  // The staff hub (Staff Front Door Unit 2, R6). This branch and the catch-all
  // below return the SAME thing today, deliberately — it is a tripwire, not a
  // second policy. Left to the catch-all, /staff would be gated only by the
  // accident of matching nothing above it; the day someone adds a prefix
  // branch, or relaxes the catch-all for an unknown route, the front door to
  // every staff tool would inherit that change silently. Naming it here means
  // the hub keeps the gate R6 chose for it, and a reader adding a route can
  // see that /staff is gated on purpose.
  if (isStaffPath(pathname)) return resolveAdminClaimOutcome(session);

  // /crm, plus anything else the matcher routes in without matching a branch
  // above (/fpology — pinned in the tests, and gated rather than passed).
  return resolveAdminClaimOutcome(session);
}

/** Where each non-pass outcome sends the request. */
export function outcomeDestination(
  outcome: Exclude<ProxyOutcome, "pass">
): string {
  switch (outcome) {
    case "crm-login":
      return "/crm/login";
    case "crm-staff-only":
      return "/crm/staff-only";
    case "fw-login":
      return "/fp/fw/sign-in";
  }
}

/**
 * Whether a header on the pass-through response should be copied onto a
 * redirect/rewrite response.
 *
 * Carry: the no-store cache headers @supabase/ssr sets alongside auth cookies
 * (`Cache-Control`, `Pragma`, `Expires`) — dropping them lets a CDN cache a
 * response that carries a session token.
 *
 * Never carry:
 *  - `set-cookie`, because cookies are copied separately via the typed
 *    `cookies` API; copying the raw header too would double-write them.
 *  - `x-middleware-*`, Next's internal proxy wire protocol. `NextResponse.next()`
 *    stamps `x-middleware-next: 1` on itself; copying that onto a
 *    `NextResponse.rewrite()` ships two contradictory routing directives on one
 *    response and makes the outcome depend on undocumented precedence inside
 *    Next's router rather than on this file.
 */
export function shouldCarryHeader(key: string): boolean {
  const k = key.toLowerCase();
  return k !== "set-cookie" && !k.startsWith("x-middleware-");
}

/* ── carry-over ────────────────────────────────────────────────────────────
 * The redirect/rewrite branches in proxy.ts build a fresh response, which does
 * NOT inherit the cookies or no-store headers @supabase/ssr set on the
 * pass-through one. Dropping them ends a live session mid-navigation — the bug
 * this whole unit exists to fix.
 *
 * The copy is pulled out here, duck-typed, so it can be tested with plain
 * objects. The wrapper in proxy.ts is otherwise untestable in this repo (no way
 * to construct the real Next cookie/header objects), which is exactly how a
 * regression to this loop would ship green.
 */

export type CookieCarrier = {
  getAll(): readonly { name: string; value: string }[];
};
export type CookieSink = {
  set(cookie: { name: string; value: string }): void;
};
export type HeaderCarrier = {
  forEach(cb: (value: string, key: string) => void): void;
};
export type HeaderSink = {
  set(key: string, value: string): void;
};

/**
 * Copy every cookie, and every carry-eligible header, from a pass-through
 * response onto a gated (redirect/rewrite) response.
 */
export function carryOverAuthState(
  from: { cookies: CookieCarrier; headers: HeaderCarrier },
  to: { cookies: CookieSink; headers: HeaderSink }
): void {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  from.headers.forEach((value, key) => {
    if (shouldCarryHeader(key)) to.headers.set(key, value);
  });
}
