import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A per-request Supabase client whose PostgREST calls execute AS the
 * authenticated PARENT identified by `accessToken` (Slice B, Plan Revision 1).
 *
 * ── Why this exists ──
 * The reused funnel child-row insert (`app/lib/funnel/children-core.ts`
 * `insertChild`) is authorized entirely by RLS: `public.children` is
 * `for all using (auth.uid() = parent_id) with check (auth.uid() = parent_id)`,
 * and the funnel supplies that `auth.uid()` through a COOKIE-bound
 * `supabaseServer()` session. The First Profit SPA is CROSS-ORIGIN: it never
 * sends The120's session cookie, so `supabaseServer()` sees an anonymous
 * request and the RLS insert would fail. Instead the SPA holds the parent
 * session tokens returned by `/api/fp/signup/verify` (Rev 1) and sends the
 * access token as a Bearer credential; this helper turns that token into a
 * client whose every PostgREST call carries it, so `auth.uid()` inside Postgres
 * resolves to the parent and the SAME RLS policy authorizes the write.
 *
 * ── Not the service-role client ──
 * This is deliberately NOT `supabaseAdmin()`: the child-row insert MUST be
 * subject to the parent's RLS (a parent can only insert a child under their own
 * `parent_id`), and `auth.getUser()` on this client is what verifies the token
 * is a genuine, unexpired parent JWT before anything is written. The
 * service-role client is used only for the consent/auth-account/profile writes
 * that are legitimately privileged.
 *
 * The anon key is the PostgREST `apikey`; the `Authorization: Bearer` header is
 * the per-request identity PostgREST evaluates RLS against. `persistSession`
 * is off — nothing about this client is stored between requests.
 *
 * ── Identity-agnostic despite the name ──
 * Nothing here is parent-specific: the helper just binds the given Bearer
 * access token to a per-request client. /api/fp/grade reuses it with the
 * CHILD's session token purely for `auth.getUser()` verification (no
 * PostgREST calls on that path). If you change this helper's semantics,
 * audit those token-verification callers too.
 */
export function supabaseParentToken(accessToken: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
}
