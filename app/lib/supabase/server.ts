import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server Supabase client (route handlers / server components), session from cookies. */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // The second `headers` argument (@supabase/ssr 0.10+) carries the
        // no-store cache headers for responses that set auth cookies. It is
        // deliberately unused here: `cookies()` writes into the request's
        // cookie store and there is no response object in scope, so arbitrary
        // response headers cannot be set from a Server Component or Route
        // Handler. Those headers are `proxy.ts`'s responsibility.
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware not needed
            // for our client-driven dashboard.
          }
        },
      },
    }
  );
}
