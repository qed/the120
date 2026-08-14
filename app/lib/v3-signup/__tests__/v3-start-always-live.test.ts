import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/start` IS UNCONDITIONALLY LIVE. THIS IS THE TEST THAT SAYS SO.
 *
 * There used to be a go-live env lever that chose between a holding page and
 * the flow, and re-asserted itself at the top of the four
 * unauthenticated-reachable Server Actions. The owner removed it: the v3 signup
 * flow is on the moment it deploys, exactly as the v2 front door was, with
 * nothing to set in Vercel.
 *
 * ── WHY THIS TEST IS SHAPED THE WAY IT IS ──
 * The property is "no configuration is required", so the test EMPTIES
 * `process.env` entirely — not just the flag we removed, and not just the variables
 * we happen to remember. A gate reintroduced under ANY name (the old flag's,
 * `START_ENABLED`, `NEXT_PUBLIC_*`, a default-on read that a deploy could turn
 * off) reads an unset value in here, so it takes its off branch, and these
 * assertions go red. Pinning the old name would only catch the old name.
 *
 * And it asserts BEHAVIOR, not source text: it invokes the real page component
 * and the real action module, and inspects what actually came back. A grep for
 * "no gate here" in a source file would pass over a gate spelled differently.
 *
 * Supabase, mail and the cores are mocked, so nothing here can touch a real
 * account. The page's own decision logic is the only production code under test.
 */

const getUser = vi.fn();
const getSession = vi.fn();

const v3StartSignup = vi.fn();
const v3VerifyCode = vi.fn();
const v3ResendCode = vi.fn();
const v3EditEmail = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({ set: () => {}, getAll: () => [] }),
}));

vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { getUser, getSession } }),
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ from: () => ({}), auth: { admin: {} } }),
}));

vi.mock("@/app/lib/email", () => ({ sendEmail: vi.fn() }));

/** `redirect()` throws by design; the mock keeps that contract so the page's
 *  control flow is the real one, and records the destination. */
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

// The page fires this for analytics; it is not the subject here and it must not
// reach a real table.
vi.mock("@/app/lib/funnel/events", () => ({ emitFunnelEvent: vi.fn() }));

vi.mock("@/app/lib/v3-signup/v3-signup-core", () => ({
  v3StartSignup,
  v3VerifyCode,
  v3ResendCode,
  v3EditEmail,
}));

/**
 * The signed-in branch of the page issues real Supabase reads for the parent's
 * draft and kids. Only THAT read is stubbed (the rest of the onboarding module
 * is the real thing), because what is under test is which component the page
 * returns, not what the DB holds.
 */
const EMPTY_STATE = {
  draft: null,
  existingKids: [],
  // fpv03 U3: coverSettled/storyStarted left V3FlowFacts with the cover/story
  // steps' retirement from signup.
  facts: {
    parentVerified: true,
    hasDraft: false,
    kidNamed: false,
    childCreated: false,
  },
};
vi.mock("@/app/lib/v3-signup/v3-onboarding-core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadV3OnboardingState: vi.fn(async () => EMPTY_STATE),
}));

const NO_SESSION = { data: { user: null }, error: null };

/** The environment as the process actually has it, restored after each test. */
const REAL_ENV = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  getUser.mockResolvedValue(NO_SESSION);
  // NOTHING configured. Not one variable.
  process.env = {} as NodeJS.ProcessEnv;
});

afterEach(() => {
  process.env = REAL_ENV;
});

describe("/start renders the signup flow with NO env configured at all", () => {
  it("an anonymous visitor is REDIRECTED to First Profit's signup (fpv04 U8)", async () => {
    const { default: RetiredStartPage } = await import("@/app/start/page");
    const { FP_SIGNUP_URL } = await import("@/app/lib/fp/retired-parent-surfaces");

    // `redirect()` throws NEXT_REDIRECT by design; the destination is what
    // matters, and it must not depend on configuration any more than the flow
    // it replaced did — the env is emptied above.
    await expect(RetiredStartPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      /NEXT_REDIRECT/
    );
    expect(redirectMock).toHaveBeenCalledWith(FP_SIGNUP_URL);
  });

  it("carries the ADD-A-KID intent across the retirement, rather than dropping a parent at step 1", async () => {
    const { default: RetiredStartPage } = await import("@/app/start/page");
    const { FP_ADD_KID_URL } = await import("@/app/lib/fp/retired-parent-surfaces");

    // `/start?step=kid` is the old dashboard's add-another-kid CTA
    // (V3_ADD_KID_HREF). First Profit has that flow at `/signup?add=1`.
    await expect(
      RetiredStartPage({ searchParams: Promise.resolve({ step: "kid" }) })
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(FP_ADD_KID_URL);
  });

  it("still counts the landing — measurement survives the retirement", async () => {
    const { default: RetiredStartPage } = await import("@/app/start/page");
    await expect(
      RetiredStartPage({ searchParams: Promise.resolve({ src: "ig" }) })
    ).rejects.toThrow(/NEXT_REDIRECT/);
    // Conversion measurement must not fall to zero on the day the door moves.
    const { emitFunnelEvent } = await import("@/app/lib/funnel/events");
    expect(emitFunnelEvent).toHaveBeenCalledWith("start_view", expect.anything());
  });
});

describe("the four unauthenticated-reachable actions run with NO env configured at all", () => {
  const start = {
    parentName: "Alex Newal",
    parentEmail: "alex@example.com",
    parentPassword: "a-good-password",
    consentAccepted: true as const,
  };

  it("each action reaches its core for an anonymous caller", async () => {
    const mod = await import("@/app/start/actions");
    v3StartSignup.mockResolvedValue({ kind: "code_sent" });
    v3VerifyCode.mockResolvedValue({ kind: "verified" });
    v3ResendCode.mockResolvedValue({ kind: "sent" });
    v3EditEmail.mockResolvedValue({ kind: "code_sent" });

    // The page being live is worth nothing if the endpoints behind it refuse.
    // A gate reintroduced at the action boundary (which is where the last one
    // had to live) returns the generic `failed` WITHOUT calling the core —
    // exactly what these `toHaveBeenCalledTimes(1)` assertions catch.
    await expect(mod.v3StartAction(start)).resolves.toEqual({ kind: "code_sent" });
    expect(v3StartSignup).toHaveBeenCalledTimes(1);

    await expect(
      mod.v3VerifyCodeAction({
        email: start.parentEmail,
        password: start.parentPassword,
        code: "123456",
      })
    ).resolves.toEqual({ kind: "verified" });
    expect(v3VerifyCode).toHaveBeenCalledTimes(1);

    await expect(mod.v3ResendCodeAction({ email: start.parentEmail })).resolves.toEqual({
      kind: "sent",
    });
    expect(v3ResendCode).toHaveBeenCalledTimes(1);

    await expect(
      mod.v3EditEmailAction({ ...start, previousEmail: "typo@example.com" })
    ).resolves.toEqual({ kind: "code_sent" });
    expect(v3EditEmail).toHaveBeenCalledTimes(1);
  });

  it("removing the gate did not remove the rate limit — the budget still bites", async () => {
    // The counterpart assertion to the one above, and the reason this file can
    // be trusted as evidence that "always live" did not mean "unguarded": the
    // per-(ip,email) budget is untouched, so a loop still gets refused.
    const { resetRateLimitStoreForTests } = await import("@/app/lib/fp/rate-limit-store");
    resetRateLimitStoreForTests();
    const mod = await import("@/app/start/actions");
    v3StartSignup.mockResolvedValue({ kind: "code_sent" });

    let refused = false;
    for (let i = 0; i < 50 && !refused; i += 1) {
      const result = await mod.v3StartAction(start);
      refused = result.kind === "failed";
    }
    expect(refused, "the start budget never refused a hammering caller").toBe(true);
  });
});
