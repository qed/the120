/**
 * Pure proxy decisions + cookie carry-over (T1 plan Unit 1).
 *
 * `proxy.ts` gates BOTH /crm and (from Unit 6) /path, which makes it the
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
  /** No session on a guarded /path route → redirect to the Path sign-in. */
  | "path-login";

/**
 * Routes that must stay reachable without a session, or the gate locks the
 * door to the door: /crm/login would redirect-loop, /crm/staff-only would
 * defeat its own 404 rewrite, /crm/reset arrives session-less by design, and
 * /path/sign-in is the Path equivalent (Unit 6).
 */
const UNGUARDED = new Set([
  "/crm/login",
  "/crm/staff-only",
  "/crm/reset",
  "/path/sign-in",
]);

export function isUnguarded(pathname: string): boolean {
  return UNGUARDED.has(pathname);
}

/**
 * Decision table (first match wins):
 * - unguarded path                      → "pass"
 * - /path/*  without a session          → "path-login"
 * - /path/*  with any session           → "pass"  (role checks are per-Server-Function)
 * - /crm/*   without a session          → "crm-login"
 * - /crm/*   without the admin claim    → "crm-staff-only"
 * - /crm/*   with the admin claim       → "pass"
 *
 * The /path branch deliberately does NOT check a role here. Path roles are
 * grants (Decision 2), not a JWT claim, so the authoritative check is
 * requirePathUser() inside every Server Function — and Next 16's own docs warn
 * that a proxy matcher does not reliably cover Server Function calls anyway.
 */
export function resolveProxyOutcome({
  pathname,
  session,
}: {
  pathname: string;
  session: ProxySessionLike;
}): ProxyOutcome {
  if (isUnguarded(pathname)) return "pass";

  if (pathname === "/path" || pathname.startsWith("/path/")) {
    return session ? "pass" : "path-login";
  }

  if (!session) return "crm-login";
  if (session.user.app_metadata?.role !== "admin") return "crm-staff-only";
  return "pass";
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
    case "path-login":
      return "/path/sign-in";
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
