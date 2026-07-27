import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveStaffAccess } from "./access";

/** The signed-in staff identity every CRM page/action works with. */
export type StaffSession = { staffId: string; email: string };

/**
 * Authoritative staff gate (plan Decision 8) — called by every `/crm` server
 * component and action. The proxy's JWT check is only the cheap outer fence;
 * this verifies the session user AND the `staff` row (`is_active`) via the
 * service-role client, so its verdict never depends on RLS policy shape.
 *
 * Unauthenticated → redirect to /crm/login.
 * Non-staff / inactive → redirect to /crm/staff-only (renders as a 404 —
 * rewrite semantics aren't available inside a server component).
 *
 * REQUEST-MEMOIZED with React's `cache()`, following the precedent
 * `loadFamilyContextCached` set in `family-loader.ts` and `loadFwSession`
 * followed in `fw-auth.ts` ("one set of queries per request instead of two").
 * Layouts and the pages inside them both gate — deliberately, because Next 16
 * layouts do not re-render on soft navigation, so a page leaning on its layout
 * alone would be gated only on the render that mounted it. That doubles a
 * `getUser()` round trip plus a `staff` PK lookup on every full render, and
 * Staff Front Door Units 3 and 4 mount staff-dependent chrome across three
 * more layouts — four gates deep on venue wifi (plan Unit 2, trap 12).
 *
 * Zero arguments, so the memo key is the empty argument list: one verdict per
 * request, full stop. Memoizing a gate that THROWS is intentional too — the
 * `redirect()` digest is replayed to every later caller in the request, which
 * is the same answer they would have paid a round trip to be told. Nothing in
 * app code writes the `staff` table (only `scripts/seed-staff.ts`, out of
 * request scope), so no mutation can make the memoized verdict stale.
 */
export const requireStaff = cache(async function requireStaff(): Promise<StaffSession> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // One indexed PK lookup; skipped entirely when there's no session.
  const staffRow = user
    ? (
        await supabaseAdmin()
          .from("staff")
          .select("id, email, is_active")
          .eq("id", user.id)
          .maybeSingle()
      ).data
    : null;

  const verdict = resolveStaffAccess({
    session: user ? { user: { app_metadata: user.app_metadata } } : null,
    staffRow,
  });

  if (verdict === "login") redirect("/crm/login");
  if (verdict === "forbidden") redirect("/crm/staff-only");

  return { staffId: user!.id, email: staffRow!.email };
});
