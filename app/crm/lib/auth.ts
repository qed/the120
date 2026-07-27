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
 * REQUEST-MEMOIZED with React's `cache()`.
 *
 * NOTE the shape differs from this repo's two existing memoized loaders, and
 * the difference is deliberate rather than an oversight. `loadFwSession`
 * (`fw-auth.ts`) and `loadFamilyContextCached` (`family-loader.ts`) both
 * memoize a NON-throwing loader and leave the redirecting wrapper
 * (`requireFwSession`) uncached. This memoizes the throwing gate itself,
 * matching the DAL example in Next's own authentication guide
 * (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`), because
 * wrapping in place gives all ~40 existing call sites the benefit without
 * touching any of them — where the split would need a new exported loader and
 * a rewrite of every caller for identical savings.
 *
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
  const staffQuery = user
    ? await supabaseAdmin()
        .from("staff")
        .select("id, email, is_active")
        .eq("id", user.id)
        .maybeSingle()
    : null;

  // A failed query and a genuinely absent row both arrive here as null, and
  // both fail closed to `forbidden` → a 404. That is the right verdict, but
  // it means an active staff member hitting a transient database fault is
  // told "not found" with nothing to distinguish it after the fact. Log it,
  // matching `loadFwSession`'s handling of its own grants query, so on-call
  // can tell revocation apart from a blip (review: reliability).
  if (staffQuery?.error) {
    console.error(
      `[crm/auth] staff row lookup failed for ${user!.id}: ${staffQuery.error.message}`
    );
  }
  const staffRow = staffQuery?.data ?? null;

  const verdict = resolveStaffAccess({
    session: user ? { user: { app_metadata: user.app_metadata } } : null,
    staffRow,
  });

  if (verdict === "login") redirect("/crm/login");
  if (verdict === "forbidden") redirect("/crm/staff-only");

  return { staffId: user!.id, email: staffRow!.email };
});
