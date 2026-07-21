import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  carryOverAuthState,
  isUnguarded,
  outcomeDestination,
  resolveProxyOutcome,
} from "@/app/lib/supabase/proxy-rules";

/**
 * Gate for /crm (staff) and /path (The Path) — Next 16's `proxy.ts` convention
 * (the renamed middleware file; Node.js runtime, not configurable).
 *
 * Deliberately cheap: a JWT-only check from the session cookie. The
 * authoritative gates are `requireStaff()` (app/crm/lib/auth.ts) and — from
 * T1 Unit 6 — `requirePathUser()`, both of which verify against the database
 * and both of which run inside every Server Function regardless of what this
 * file decides. Next's own docs warn that a proxy matcher does not reliably
 * cover Server Function calls.
 *
 * The decision table lives in `app/lib/supabase/proxy-rules.ts` so it can be
 * unit-tested without constructing a NextRequest (repo canon: pure verdict
 * module + thin wrapper, mirroring app/crm/lib/access.ts).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Unguarded routes short-circuit before any Supabase work — matching them
  // would loop the redirect (/crm/login, /path/sign-in), defeat the 404 rewrite
  // (/crm/staff-only), or strand the recovery flow (/crm/reset arrives without
  // a session; the emailed link's code becomes one client-side).
  if (isUnguarded(pathname)) {
    return NextResponse.next();
  }

  // Standard @supabase/ssr proxy pattern: mirror refreshed auth cookies onto
  // both the forwarded request and the response.
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        // The `headers` argument landed in @supabase/ssr 0.10 and carries the
        // no-store cache headers that stop a CDN or reverse proxy caching a
        // response which sets auth cookies — i.e. serving one user's session
        // token to another. Omitting it compiles fine, which is how it went
        // unnoticed here until the T1 plan's Unit 1.
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value)
          );
        },
      },
    }
  );

  // JWT-only by design (no auth-server round trip): a spoofed claim can't get
  // past requireStaff()/requirePathUser(), and app_metadata is server-set —
  // never client-writable. Nothing may run between createServerClient and the
  // session read.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const outcome = resolveProxyOutcome({ pathname, session });
  if (outcome === "pass") return response;

  // A fresh NextResponse does NOT inherit the cookies @supabase/ssr just
  // refreshed onto `response`. Dropping them desyncs browser and server and
  // can terminate a live session mid-navigation, so carry them (and the
  // no-store headers) across to whichever response actually ships.
  const destination = new URL(outcomeDestination(outcome), request.url);
  const gated =
    outcome === "crm-staff-only"
      ? NextResponse.rewrite(destination)
      : NextResponse.redirect(destination);

  carryOverAuthState(response, gated);

  return gated;
}

export const config = {
  // Must be statically analyzable — a literal array, never a computed value.
  matcher: ["/crm/:path*", "/path/:path*"],
};
