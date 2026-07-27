import { describe, expect, it } from "vitest";
import {
  resolveStaffAccess,
  type SessionRead,
  type StaffRowLike,
} from "@/app/crm/lib/access";

/**
 * Decision table for the requireStaff() core (plan Unit 3, Decision 8).
 * `requireStaff()` itself is a thin wrapper that maps these verdicts onto
 * redirect('/crm/login') / redirect('/crm/staff-only') — the decision logic
 * lives in the pure `resolveStaffAccess()` so it can be tested exhaustively
 * without mocking next/navigation or Supabase.
 */

const adminSession: SessionRead = {
  user: { app_metadata: { role: "admin" } },
};
const activeStaff: StaffRowLike = { is_active: true };

const verdict = (session: SessionRead, staffRow: StaffRowLike) =>
  resolveStaffAccess({ session, staffRow });

describe("resolveStaffAccess", () => {
  it("no session → login (regardless of any staff row)", () => {
    expect(verdict(null, null)).toBe("login");
    // A staff row without a session must never grant access — session first.
    expect(verdict(null, activeStaff)).toBe("login");
  });

  it("session without the admin claim → forbidden", () => {
    // Typical parent session: no role in app_metadata.
    expect(verdict({ user: { app_metadata: {} } }, null)).toBe("forbidden");
    expect(verdict({ user: {} }, null)).toBe("forbidden");
    expect(verdict({ user: { app_metadata: null } }, null)).toBe("forbidden");
  });

  it("session with a non-admin role claim → forbidden", () => {
    expect(verdict({ user: { app_metadata: { role: "parent" } } }, null)).toBe(
      "forbidden"
    );
    // An active staff row cannot rescue a session missing the JWT claim —
    // both fences must agree (defense in depth).
    expect(
      verdict({ user: { app_metadata: { role: "parent" } } }, activeStaff)
    ).toBe("forbidden");
  });

  it("admin claim but no staff row → forbidden", () => {
    expect(verdict(adminSession, null)).toBe("forbidden");
  });

  it("admin claim + is_active=false → forbidden (revocation beats stale JWT)", () => {
    expect(verdict(adminSession, { is_active: false })).toBe("forbidden");
  });

  it("admin claim + active staff row → ok", () => {
    expect(verdict(adminSession, activeStaff)).toBe("ok");
  });

  it("role comparison is exact — near-miss values stay forbidden", () => {
    for (const role of ["Admin", "ADMIN", "admin ", "administrator", ""]) {
      expect(
        verdict({ user: { app_metadata: { role } } }, activeStaff)
      ).toBe("forbidden");
    }
  });
});

/**
 * B5 (Staff Front Door Unit 5): the THIRD verdict.
 *
 * Before this, `requireStaff()` made both of its Supabase calls unbounded and mapped
 * every non-answer onto `forbidden` → a redirect to `/crm/staff-only`, which renders
 * as a 404. An active staff member whose `staff` row lookup blipped on venue wifi was
 * therefore told their account does not exist, with nothing afterwards to distinguish
 * that from a genuine revocation.
 *
 * ⚠️ READ THE ORDERING TESTS AS SECURITY TESTS. `unavailable` is a different refusal,
 * not a weaker one — `requireStaff` throws on it and the error boundary renders
 * INSTEAD of the guarded subtree. The property that makes that safe is that an
 * unreadable row can never upgrade a caller who failed a check decided WITHOUT the
 * network.
 */
describe("resolveStaffAccess — the unreadable verdict (B5)", () => {
  it("an unreadable SESSION is unavailable, never login", () => {
    // `login` would bounce a signed-in staff member to /crm/login mid-shift on a
    // stalled getUser(), where signing in again does nothing they have not already
    // done. It is an answer about the account; this path has no answer.
    expect(verdict("unreadable", null)).toBe("unavailable");
    expect(verdict("unreadable", activeStaff)).toBe("unavailable");
    expect(verdict("unreadable", { is_active: false })).toBe("unavailable");
    expect(verdict("unreadable", "unreadable")).toBe("unavailable");
  });

  it("an unreadable STAFF ROW under an admin claim is unavailable, never forbidden", () => {
    // The row is the ONLY input that can say "revoked", so an unread one is genuinely
    // undecidable. This is the exact case that told an on-shift staff member 404.
    expect(verdict(adminSession, "unreadable")).toBe("unavailable");
  });

  it("an unreadable row does NOT rescue a caller with no admin claim", () => {
    // THE ORDERING TEST. The claim comes off the JWT the caller already presented —
    // no network, nothing to fail — so a caller without it is refused on evidence in
    // hand. Checking the row first would let a stalled query upgrade an unauthorized
    // visitor from a clean 404 to a retry screen that re-runs the query for them.
    //
    // MUTATION GUARD: moving the `staffRow === "unreadable"` line above the
    // `app_metadata?.role !== "admin"` line in `resolveStaffAccess` reddens here and
    // nowhere else.
    expect(verdict({ user: { app_metadata: {} } }, "unreadable")).toBe("forbidden");
    expect(verdict({ user: { app_metadata: { role: "parent" } } }, "unreadable")).toBe(
      "forbidden"
    );
  });

  it("no session with an unreadable row is still login — a real answer outranks a non-answer", () => {
    // `getUser()` RETURNED and said nobody is signed in. That is a fact, and the right
    // response to it is the sign-in door, not a retry button.
    expect(verdict(null, "unreadable")).toBe("login");
  });

  it("unavailable is never reachable when both reads answered", () => {
    // The completeness claim: `unavailable` cannot appear from any combination of
    // genuine values, so seeing it always means a read failed.
    const sessions: SessionRead[] = [
      null,
      { user: { app_metadata: {} } },
      { user: { app_metadata: { role: "parent" } } },
      adminSession,
    ];
    const rows: StaffRowLike[] = [null, { is_active: true }, { is_active: false }];
    for (const session of sessions) {
      for (const staffRow of rows) {
        expect(verdict(session, staffRow)).not.toBe("unavailable");
      }
    }
  });
});
