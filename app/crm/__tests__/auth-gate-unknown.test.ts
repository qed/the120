import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B5's impure half: `requireStaff` itself, under the failures the pure decision
 * table cannot see (Staff Front Door Unit 5).
 *
 * `auth-guard.test.ts` exhaustively covers `resolveStaffAccess`; this file is the
 * `fw-auth-unknown.test.ts` sibling for the CRM gate — the review found the wrapper
 * with the timeouts, the throw, and the redirect mapping had zero coverage of its
 * own. Same seams, same precedent (`fw-student-core.test.ts`), same fake-timer
 * caveat: the import is awaited BEFORE the clock advances, because
 * `advanceTimersByTimeAsync` only fires timers that already exist.
 */

const getUser = vi.fn();
const staffRowResult = vi.fn();
const redirected = vi.fn();

vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { getUser } }),
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => staffRowResult(),
        }),
      }),
    }),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected(to);
    // Mirror Next: redirect() throws a control-flow error.
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

/**
 * Re-import BOTH the gate and the guard from one fresh registry. `vi.resetModules()`
 * gives the re-imported auth module its own copy of `IdentityUnavailableError`, and
 * `instanceof` against a class from the OLD registry is always false — a test-only
 * hazard (production has one module graph), but one that made the first draft's
 * assertions pass-shaped-wrong.
 */
const fresh = async () => {
  vi.resetModules();
  const [{ requireStaff }, { isIdentityUnavailable }] = await Promise.all([
    import("../lib/auth"),
    import("@/app/lib/identity-unavailable"),
  ]);
  return { requireStaff, isIdentityUnavailable };
};

const ADMIN = { id: "s-1", app_metadata: { role: "admin" } };
const never = () => new Promise(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  getUser.mockReset();
  staffRowResult.mockReset();
  redirected.mockReset();
});

describe("requireStaff — the unavailable path throws, and only that path (B5)", () => {
  it("a hung getUser() throws IdentityUnavailableError after the budget — never a redirect", async () => {
    // The old behaviour was worse than a hang: a non-answer fell through to
    // `forbidden` → redirect("/crm/staff-only") → a 404 telling an active staff
    // member their account does not exist.
    getUser.mockImplementation(never);
    const { requireStaff, isIdentityUnavailable } = await fresh();
    const pending = requireStaff().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(8_000);
    const thrown = await pending;
    expect(isIdentityUnavailable(thrown)).toBe(true);
    expect(redirected).not.toHaveBeenCalled();
  });

  it("an unreadable STAFF ROW throws too — unread is not revoked", async () => {
    getUser.mockResolvedValue({ data: { user: ADMIN } });
    staffRowResult.mockResolvedValue({ data: null, error: { message: "read blip" } });
    const { requireStaff, isIdentityUnavailable } = await fresh();
    const thrown = await requireStaff().catch((e: unknown) => e);
    expect(isIdentityUnavailable(thrown)).toBe(true);
    expect(redirected).not.toHaveBeenCalled();
  });

  it("a genuinely ABSENT row still redirects to /crm/staff-only — revocation survives", async () => {
    // The change is worthless if it also stopped real revocations from biting.
    getUser.mockResolvedValue({ data: { user: ADMIN } });
    staffRowResult.mockResolvedValue({ data: null, error: null });
    const { requireStaff } = await fresh();
    await expect(requireStaff()).rejects.toThrow("NEXT_REDIRECT:/crm/staff-only");
    expect(redirected).toHaveBeenCalledWith("/crm/staff-only");
  });

  it("no session still redirects to /crm/login", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { requireStaff } = await fresh();
    await expect(requireStaff()).rejects.toThrow("NEXT_REDIRECT:/crm/login");
  });

  it("an unreadable row does NOT rescue a non-admin — forbidden, not a retry screen", async () => {
    // The ordering property, exercised through the WRAPPER rather than only the pure
    // table: the claim check needs no network, so a stalled row query must not
    // upgrade an unauthorized caller from a clean 404 to a retry button.
    getUser.mockResolvedValue({ data: { user: { id: "p-1", app_metadata: { role: "parent" } } } });
    staffRowResult.mockResolvedValue({ data: null, error: { message: "read blip" } });
    const { requireStaff } = await fresh();
    await expect(requireStaff()).rejects.toThrow("NEXT_REDIRECT:/crm/staff-only");
  });

  it("the happy path returns the staff identity with the row's email, no casts needed", async () => {
    getUser.mockResolvedValue({ data: { user: ADMIN } });
    staffRowResult.mockResolvedValue({
      data: { id: "s-1", email: "staff@the120.school", is_active: true },
      error: null,
    });
    const { requireStaff } = await fresh();
    await expect(requireStaff()).resolves.toEqual({
      staffId: "s-1",
      email: "staff@the120.school",
    });
  });
});
