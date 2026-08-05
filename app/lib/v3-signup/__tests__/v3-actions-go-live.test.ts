import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitStoreForTests } from "@/app/fp/lib/rate-limit-store";

/**
 * THE GO-LIVE FLAG IS ENFORCED AT THE ACTION BOUNDARY, NOT ONLY ON THE PAGE
 * (review FIX 1).
 *
 * `V3_START_LIVE` was referenced in exactly ONE place — app/start/v3/page.tsx,
 * choosing between <HoldingPage/> and <V3Flow/>. But a Server Action is a
 * SEPARATELY-ADDRESSABLE POST endpoint: its id ships in the client bundle and no
 * page render stands in front of it. So with the flag off, an unauthenticated
 * caller could still POST `v3StartAction` / `v3VerifyCodeAction` /
 * `v3ResendCodeAction` / `v3EditEmailAction` and drive real parent-account
 * creation, real verification mail and a real cookie session.
 *
 * These tests import the ACTION MODULE and assert two things per action: the
 * caller gets the one well-formed generic refusal, AND the core was never
 * reached. The second half is what makes this bite — a gate that returns
 * `failed` after doing the work would pass the first assertion alone.
 *
 * The cores are mocked so this file can never touch Supabase, Resend or a real
 * account; the go-live gate is the only production code under test.
 */

const getUser = vi.fn();
const getSession = vi.fn();

const v3StartSignup = vi.fn();
const v3VerifyCode = vi.fn();
const v3ResendCode = vi.fn();
const v3EditEmail = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({ set: () => {} }),
}));

vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { getUser, getSession } }),
}));

const supabaseAdmin = vi.fn(() => ({ from: () => ({}) , auth: { admin: {} } }));
vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => supabaseAdmin() }));

vi.mock("@/app/lib/email", () => ({ sendEmail: vi.fn() }));

vi.mock("@/app/lib/v3-signup/v3-signup-core", () => ({
  v3StartSignup,
  v3VerifyCode,
  v3ResendCode,
  v3EditEmail,
}));

const cores = [v3StartSignup, v3VerifyCode, v3ResendCode, v3EditEmail];

/** The four unauthenticated-reachable actions, with a body each would accept. */
async function actions() {
  const mod = await import("@/app/start/v3/actions");
  const start = {
    parentName: "Alex Newal",
    parentEmail: "alex@example.com",
    parentPassword: "a-good-password",
    consentAccepted: true as const,
  };
  return [
    { name: "v3StartAction", call: () => mod.v3StartAction(start), core: v3StartSignup },
    {
      name: "v3VerifyCodeAction",
      call: () =>
        mod.v3VerifyCodeAction({
          email: start.parentEmail,
          password: start.parentPassword,
          code: "123456",
        }),
      core: v3VerifyCode,
    },
    {
      name: "v3ResendCodeAction",
      call: () => mod.v3ResendCodeAction({ email: start.parentEmail }),
      core: v3ResendCode,
    },
    {
      name: "v3EditEmailAction",
      call: () => mod.v3EditEmailAction({ ...start, previousEmail: "typo@example.com" }),
      core: v3EditEmail,
    },
  ];
}

const NO_SESSION = { data: { user: null }, error: null };
const SESSION = {
  data: { user: { id: "parent-1", email: "alex@example.com" } },
  error: null,
};

beforeEach(() => {
  resetRateLimitStoreForTests();
  for (const core of cores) core.mockReset();
  supabaseAdmin.mockClear();
  getUser.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
  delete process.env.V3_START_LIVE;
});

afterEach(() => {
  delete process.env.V3_START_LIVE;
});

describe("V3_START_LIVE unset + no session — every unauthenticated-reachable action refuses", () => {
  it.each([
    "v3StartAction",
    "v3VerifyCodeAction",
    "v3ResendCodeAction",
    "v3EditEmailAction",
  ])("%s returns the well-formed generic refusal and never reaches its core", async (name) => {
    getUser.mockResolvedValue(NO_SESSION);
    const action = (await actions()).find((a) => a.name === name)!;

    const result = await action.call();

    // WELL-FORMED: one object, one discriminator — the same shape every other
    // branch of the union returns, so the refusal is not itself a signal.
    expect(result).toEqual({ kind: "failed" });
    // AND THE WORK NEVER HAPPENED. No attempt row, no auth user, no mail —
    // the service-role client is not even constructed.
    expect(action.core).not.toHaveBeenCalled();
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });

  it("an explicitly falsy flag value is still off (never a default-on, never an inverse)", async () => {
    getUser.mockResolvedValue(NO_SESSION);
    for (const raw of ["", "0", "false", "off", "yes", "TRUE ", "1 "]) {
      process.env.V3_START_LIVE = raw;
      const [start] = await actions();
      // "TRUE " and "1 " are trimmed+lowercased, so those two ARE on; the rest
      // are off. Assert per value rather than lumping them together.
      const expectedOn = raw.trim().toLowerCase() === "true" || raw.trim() === "1";
      v3StartSignup.mockReset();
      v3StartSignup.mockResolvedValue({ kind: "code_sent" });
      resetRateLimitStoreForTests();
      await start.call();
      expect(v3StartSignup.mock.calls.length > 0, `V3_START_LIVE=${JSON.stringify(raw)}`).toBe(
        expectedOn
      );
    }
  });

  it("an unreadable session fails CLOSED (a session probe that throws is not a session)", async () => {
    getUser.mockRejectedValue(new Error("auth server down"));
    const [start] = await actions();
    expect(await start.call()).toEqual({ kind: "failed" });
    expect(v3StartSignup).not.toHaveBeenCalled();
  });
});

describe("the gate opens exactly where the plan says it should", () => {
  it("flag ON + no session — the public front door works", async () => {
    process.env.V3_START_LIVE = "1";
    getUser.mockResolvedValue(NO_SESSION);
    v3StartSignup.mockResolvedValue({ kind: "code_sent" });

    const [start] = await actions();
    expect(await start.call()).toEqual({ kind: "code_sent" });
    expect(v3StartSignup).toHaveBeenCalledTimes(1);
  });

  it("flag OFF + a live SESSION — the signed-in resume paths stay live", async () => {
    // The lever gates unauthenticated NEW-SIGNUP entry only. Unit 8's dashboard
    // retarget and Unit 9's v2 remap deploy BEFORE the flip, and gating a
    // signed-in family too would strand them on a holding page while v2 is
    // already archived.
    getUser.mockResolvedValue(SESSION);
    v3ResendCode.mockResolvedValue({ kind: "sent" });

    const resend = (await actions()).find((a) => a.name === "v3ResendCodeAction")!;
    expect(await resend.call()).toEqual({ kind: "sent" });
    expect(v3ResendCode).toHaveBeenCalledTimes(1);
  });
});
