/**
 * Pure staff-access decision (plan Unit 3, Decision 8).
 * Kept free of next/supabase imports so the decision table is unit-testable
 * (`auth-guard.test.ts`); `requireStaff()` in `auth.ts` wraps this and maps
 * the verdict onto redirects.
 */

/**
 * Just the shape the decision needs from a Supabase session/user. Open
 * record because supabase-js types app_metadata as an index signature.
 */
export type SessionLike = {
  user: { app_metadata?: Record<string, unknown> | null };
} | null;

/** Just the shape the decision needs from the `staff` row. */
export type StaffRowLike = { is_active: boolean } | null;

export type StaffAccessVerdict = "ok" | "login" | "forbidden";

/**
 * Decision table (first match wins):
 * - no session                          → "login"     (go sign in)
 * - session without the admin JWT claim → "forbidden" (404 semantics)
 * - admin claim but no `staff` row      → "forbidden"
 * - `staff` row with `is_active` false  → "forbidden" (revocation bites even
 *                                          while the stale JWT says admin)
 * - admin claim + active staff row      → "ok"
 */
export function resolveStaffAccess({
  session,
  staffRow,
}: {
  session: SessionLike;
  staffRow: StaffRowLike;
}): StaffAccessVerdict {
  if (!session) return "login";
  if (session.user.app_metadata?.role !== "admin") return "forbidden";
  if (!staffRow) return "forbidden";
  if (!staffRow.is_active) return "forbidden";
  return "ok";
}
