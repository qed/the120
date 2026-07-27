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

/**
 * Just the shape the decision needs from the `staff` row.
 *
 * `"unreadable"` (Staff Front Door Unit 5, B5) is NOT a row and NOT the absence of
 * one — it is the read having failed, timed out, or thrown. It is a distinct member
 * rather than `null` because `null` already means "there is no such row", which is a
 * REVOCATION, and answering revocation from a query that never returned is the defect
 * B5 exists to remove.
 */
export type StaffRowLike = { is_active: boolean } | null | "unreadable";

/** Ditto for the session: `"unreadable"` is `getUser()` not answering. */
export type SessionRead = SessionLike | "unreadable";

export type StaffAccessVerdict = "ok" | "login" | "forbidden" | "unavailable";

/**
 * Decision table (first match wins):
 * - session unreadable                  → "unavailable" (ask again; see below)
 * - no session                          → "login"       (go sign in)
 * - session without the admin JWT claim → "forbidden"   (404 semantics)
 * - staff row unreadable                → "unavailable"
 * - admin claim but no `staff` row      → "forbidden"
 * - `staff` row with `is_active` false  → "forbidden"   (revocation bites even
 *                                          while the stale JWT says admin)
 * - admin claim + active staff row      → "ok"
 *
 * ── Why `unavailable` outranks the row checks but NOT the claim check
 *
 * The order is not cosmetic. The admin claim is read from the JWT the caller already
 * presented — no network, nothing to fail — so a caller without it is refused on
 * evidence in hand, and an unreadable `staff` row cannot rescue them. Checking the row
 * first would let a stalled query upgrade a non-staff visitor from a clean 404 to a
 * retry screen, which leaks that the query exists and hands an unauthorized caller a
 * button that re-runs it.
 *
 * With the claim present, the row is the ONLY input that can say "revoked". So an
 * unreadable row is genuinely undecidable, and `unavailable` is the honest answer.
 *
 * ⚠️ `unavailable` IS NOT AN ALLOW. `requireStaff` maps it to a throw, which renders
 * the error boundary INSTEAD of the guarded subtree — no page body, no data. It is a
 * different REFUSAL, not a weaker one: the difference is only in what the person is
 * told and whether trying again can work.
 */
export function resolveStaffAccess({
  session,
  staffRow,
}: {
  session: SessionRead;
  staffRow: StaffRowLike;
}): StaffAccessVerdict {
  if (session === "unreadable") return "unavailable";
  if (!session) return "login";
  if (session.user.app_metadata?.role !== "admin") return "forbidden";
  if (staffRow === "unreadable") return "unavailable";
  if (!staffRow) return "forbidden";
  if (!staffRow.is_active) return "forbidden";
  return "ok";
}
