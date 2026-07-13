import "server-only";
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
 */
export async function requireStaff(): Promise<StaffSession> {
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
}
