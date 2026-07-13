import { describe, expect, it } from "vitest";
import {
  resolveStaffAccess,
  type SessionLike,
  type StaffRowLike,
} from "@/app/crm/lib/access";

/**
 * Decision table for the requireStaff() core (plan Unit 3, Decision 8).
 * `requireStaff()` itself is a thin wrapper that maps these verdicts onto
 * redirect('/crm/login') / redirect('/crm/staff-only') — the decision logic
 * lives in the pure `resolveStaffAccess()` so it can be tested exhaustively
 * without mocking next/navigation or Supabase.
 */

const adminSession: SessionLike = {
  user: { app_metadata: { role: "admin" } },
};
const activeStaff: StaffRowLike = { is_active: true };

const verdict = (session: SessionLike, staffRow: StaffRowLike) =>
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
