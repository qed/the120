import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitStoreForTests } from "@/app/lib/fp/rate-limit-store";

/**
 * THE CONSENT WALL on the handoff mint (founder, 2026-08-10).
 *
 * A handoff code is a BEARER CREDENTIAL for a child's session, so minting one
 * is the most consequential thing `/start` can do — and a Server Action is a
 * separately-addressable POST endpoint, so the `/dashboard` redirect is not
 * what stops a walled parent from reaching it (the page-vs-action gating
 * learning, 2026-08-05). `requireConsentClear` is.
 *
 * A separate file from ./mint-action.test.ts on purpose: that file's suite
 * deliberately mocks `supabaseAdmin` into a stub and asserts it is never
 * constructed, so the wall must be mocked out there and driven here.
 */

const wall = vi.hoisted(() => ({
  clear: true,
  /** The consent READ failed, as distinct from a successful read that says the
   *  family is clear. This action fails CLOSED on it (review P2-a). */
  errored: false,
  calls: [] as string[],
}));
const mintHandoffCode = vi.fn();
const getUser = vi.fn();
const getSession = vi.fn();

vi.mock("@/app/lib/funnel/consent-wall-core", () => ({
  requireConsentClear: async (parentId: string) => {
    wall.calls.push(parentId);
    return wall.errored ? true : wall.clear;
  },
  consentClearance: async (parentId: string) => {
    wall.calls.push(parentId);
    if (wall.errored) return "error";
    return wall.clear ? "clear" : "owes";
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({ set: () => {} }),
}));

vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { getUser, getSession } }),
}));

const supabaseAdmin = vi.fn(() => ({ from: () => ({}), auth: { admin: {} } }));
vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => supabaseAdmin() }));
vi.mock("@/app/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/app/api/fp/handoff/handoff-core", () => ({ mintHandoffCode }));

const SESSION = { data: { user: { id: "parent-1", email: "alex@example.com" } }, error: null };
const CHILD = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

async function mintAction() {
  const mod = await import("@/app/start/actions");
  return mod.v3MintHandoffAction;
}

beforeEach(() => {
  resetRateLimitStoreForTests();
  wall.clear = true;
  wall.errored = false;
  wall.calls = [];
  mintHandoffCode.mockReset();
  mintHandoffCode.mockResolvedValue({ kind: "minted", destination: "https://x/#code=y" });
  supabaseAdmin.mockClear();
  getUser.mockReset();
  getUser.mockResolvedValue(SESSION);
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
  vi.stubEnv("FP_HANDOFF_LANDING_LIVE", "1");
});

describe("v3MintHandoffAction — the consent wall", () => {
  it("mints NOTHING while the parent owes a consent decision", async () => {
    wall.clear = false;
    const mint = await mintAction();
    // `failed`, not `fallback`: there is no honest destination for a refusal.
    expect(await mint({ childId: CHILD })).toEqual({ kind: "failed" });
    // The assertion that bites — a `failed` return alone would pass even if a
    // bearer credential had already been written.
    expect(mintHandoffCode).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when the consent read ERRORS — an outage must not mint a bearer credential (review P2-a)", async () => {
    wall.errored = true;
    const mint = await mintAction();
    expect(await mint({ childId: CHILD })).toEqual({ kind: "failed" });
    expect(mintHandoffCode).not.toHaveBeenCalled();
  });

  it("⚠ a WALL REFUSAL DOES NOT EXHAUST THE SHARED ONBOARDING BUDGET (review P2-c)", async () => {
    // `onboardingBudget` is shared with `v3ProvisionAction` (adding a child).
    // Spending it on wall refusals meant a walled parent tapping "Open App" a
    // few times locked themselves out of adding a kid for fifteen minutes — the
    // wall confiscating a budget that belongs to a different action.
    wall.clear = false;
    const mint = await mintAction();
    for (let i = 0; i < 25; i++) {
      expect(await mint({ childId: CHILD })).toEqual({ kind: "failed" });
    }
    // The budget survived every one of them, so the very next legitimate mint
    // still goes through.
    wall.clear = true;
    expect(await mint({ childId: CHILD })).toEqual({
      kind: "minted",
      destination: "https://x/#code=y",
    });
  });

  it("mints normally once the parent is clear", async () => {
    const mint = await mintAction();
    expect(await mint({ childId: CHILD })).toEqual({
      kind: "minted",
      destination: "https://x/#code=y",
    });
    expect(mintHandoffCode).toHaveBeenCalledTimes(1);
  });

  it("asks about the SESSION's parent id, never anything from the argument", async () => {
    const mint = await mintAction();
    await mint({ childId: CHILD, parentId: "attacker" });
    expect(wall.calls).toEqual(["parent-1"]);
  });

  it("a caller with no session never reaches the wall check at all", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const mint = await mintAction();
    expect(await mint({ childId: CHILD })).toEqual({ kind: "failed" });
    expect(wall.calls).toEqual([]);
  });
});
