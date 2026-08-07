import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE SET-PASSWORD SERVER ACTION WRAPPER (v3 Unit 8 review, FIX 2).
 *
 * The core's decisions are covered in set-password-core.test.ts. What lives
 * ONLY here — and was untested — is the wrapper: session resolution, rate-limit
 * keying, the refund rule, and which outcomes are allowed to say anything
 * specific to the caller.
 *
 * ⚠ The refund predicate is NOT mocked (`importOriginal`), so these assertions
 * run against the real allowlist.
 */

const rate = vi.hoisted(() => ({
  checked: [] as string[],
  released: [] as string[],
  allowed: true,
}));
const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
const core = vi.hoisted(() => ({ setParentPassword: vi.fn() }));

vi.mock("@/app/fp/lib/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rate.checked.push(key);
    return { allowed: rate.allowed, retryAfterMs: 0 };
  },
  releaseRateLimitEvent: (key: string) => {
    rate.released.push(key);
  },
}));

vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: session.user ? { ...session.user, app_metadata: { funnel: true } } : null },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => {
    throw new Error("no privileged client may be constructed in these tests");
  },
}));

vi.mock("@/app/lib/v3-signup/set-password-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../set-password-core")>();
  return { ...actual, setParentPassword: core.setParentPassword };
});

import { setParentPasswordAction } from "@/app/lib/v3-signup/actions/set-password";
import { MIN_PARENT_PASSWORD } from "@/app/lib/v3-signup/set-password-core";
import { deriveV3KidResetRateLimitKey } from "@/app/lib/v3-signup/v3-signup-rules";

const PARENT = "parent-1";
const KEY = deriveV3KidResetRateLimitKey(PARENT, "set-parent-password");

beforeEach(() => {
  rate.checked = [];
  rate.released = [];
  rate.allowed = true;
  session.user = { id: PARENT };
  core.setParentPassword.mockReset();
});

describe("setParentPasswordAction", () => {
  it("no session: no strike, no core, no privileged client", async () => {
    session.user = null;
    expect(await setParentPasswordAction({ password: "x".repeat(12) })).toMatchObject({
      ok: false,
    });
    expect(rate.checked).toEqual([]);
    expect(rate.released).toEqual([]);
    expect(core.setParentPassword).not.toHaveBeenCalled();
  });

  it("`outage` RELEASES the strike — our fault is not an attempt", async () => {
    core.setParentPassword.mockResolvedValue("outage");
    expect(await setParentPasswordAction({ password: "x".repeat(12) })).toMatchObject({
      ok: false,
    });
    expect(rate.released).toEqual([KEY]);
  });

  it("`weak_password` and `not_eligible` KEEP the strike", async () => {
    for (const outcome of ["weak_password", "not_eligible"] as const) {
      rate.released = [];
      core.setParentPassword.mockResolvedValue(outcome);
      expect((await setParentPasswordAction({ password: "abc" })).ok, outcome).toBe(false);
      expect(rate.released, outcome).toEqual([]);
    }
  });

  it("`not_eligible` answers the GENERIC refusal — it confirms nothing about the account", async () => {
    core.setParentPassword.mockResolvedValue("not_eligible");
    const res = await setParentPasswordAction({ password: "x".repeat(12) });
    if (res.ok) throw new Error("unreachable");
    expect(res.message).toContain("Refresh the page");
    expect(res.message).not.toContain("already");
  });

  it("`weak_password` is the one refusal that names the fixable problem", async () => {
    core.setParentPassword.mockResolvedValue("weak_password");
    const res = await setParentPasswordAction({ password: "abc" });
    if (res.ok) throw new Error("unreachable");
    expect(res.message).toContain(String(MIN_PARENT_PASSWORD));
  });

  it("`set` succeeds and refunds nothing", async () => {
    core.setParentPassword.mockResolvedValue("set");
    expect(await setParentPasswordAction({ password: "x".repeat(12) })).toEqual({ ok: true });
    expect(rate.released).toEqual([]);
  });

  it("keys on the session id in its OWN scope (FIX 6) and passes the session identity down", async () => {
    core.setParentPassword.mockResolvedValue("set");
    await setParentPasswordAction({ password: "x".repeat(12), userId: "victim" });
    expect(rate.checked).toEqual([KEY]);
    // The scope is distinct from the per-kid buckets: a parent looping the kid
    // reset must not lock themselves out of this one-time step.
    expect(KEY).not.toBe(deriveV3KidResetRateLimitKey(PARENT, "password"));
    expect(core.setParentPassword.mock.calls[0][2]).toEqual({
      userId: PARENT,
      appMetadata: { funnel: true },
    });
  });

  it("a denied bucket refuses before the core runs", async () => {
    rate.allowed = false;
    expect((await setParentPasswordAction({ password: "x".repeat(12) })).ok).toBe(false);
    expect(core.setParentPassword).not.toHaveBeenCalled();
  });

  it("a THROWN core is caught and answered with the uniform refusal", async () => {
    core.setParentPassword.mockRejectedValue(new Error("boom"));
    expect(await setParentPasswordAction({ password: "x".repeat(12) })).toMatchObject({
      ok: false,
    });
  });
});
