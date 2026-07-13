import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Staff gate for /crm (plan Unit 3, Decision 8) — Next 16's `proxy.ts`
 * convention (the renamed middleware file; Node.js runtime by default).
 *
 * Deliberately cheap: a JWT-only check from the session cookie. The
 * authoritative gate is `requireStaff()` (app/crm/lib/auth.ts), which also
 * verifies the `staff` row's `is_active` via the service-role client.
 *
 * - no session                → redirect to /crm/login
 * - session without admin JWT → REWRITE to /crm/staff-only (404 semantics,
 *                               URL untouched — no hint that /crm matters)
 * - admin                     → pass through
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The two unguarded /crm routes — matching them would loop the redirect
  // (login) or defeat the 404 rewrite (staff-only).
  if (pathname === "/crm/login" || pathname === "/crm/staff-only") {
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
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // JWT-only by design (no auth-server round trip): a spoofed claim can't get
  // past requireStaff(), and app_metadata is server-set — never client-writable.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.redirect(new URL("/crm/login", request.url));
  }
  if (session.user.app_metadata?.role !== "admin") {
    return NextResponse.rewrite(new URL("/crm/staff-only", request.url));
  }
  return response;
}

export const config = {
  matcher: "/crm/:path*",
};
