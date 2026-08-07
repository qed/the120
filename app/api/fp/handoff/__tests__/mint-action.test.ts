import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitStoreForTests } from "@/app/fp/lib/rate-limit-store";

/**
 * THE MINT IS A SERVER ACTION, WHICH IS A SEPARATELY-ADDRESSABLE POST ENDPOINT
 * (docs/solutions/security-issues/a-flag-that-gates-the-page-does-not-gate-its-
 * server-actions-...-2026-08-05.md). Its id ships in the client bundle and no
 * page render stands in front of it, so "you can only reach it from the
 * account-ready screen" is not an access-control property.
 *
 * These tests import the ACTION MODULE and assert the negative the learning
 * demands: an unauthenticated caller gets the well-formed generic refusal, the
 * CORE IS NEVER REACHED, and the service-role client is never even constructed.
 * `{ kind: "failed" }` alone would pass if the guard were deleted and the work
 * merely failed downstream — the second and third assertions are what bite.
 *
 * Supabase, mail and the core are mocked so this file can never touch a real
 * project; the action's own gating is the only production code under test.
 * (The core's own behaviour is tested by execution in ./handoff-core.test.ts.)
 */

const getUser = vi.fn();
const getSession = vi.fn();
const mintHandoffCode = vi.fn();

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

const NO_SESSION = { data: { user: null }, error: null };
const SESSION = { data: { user: { id: "parent-1", email: "alex@example.com" } }, error: null };

async function action() {
  const mod = await import("@/app/start/actions");
  return mod.v3MintHandoffAction;
}

beforeEach(() => {
  resetRateLimitStoreForTests();
  mintHandoffCode.mockReset();
  supabaseAdmin.mockClear();
  getUser.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
  // The far-side interlock (review FIX 2). Default the SUITE to "on" so the
  // pre-existing authorization tests keep testing authorization; its own
  // describe block below drives it off explicitly.
  vi.stubEnv("FP_HANDOFF_LANDING_LIVE", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("v3MintHandoffAction — no session, no code", () => {
  it("refuses an unauthenticated caller, never reaching the core or the service-role client", async () => {
    getUser.mockResolvedValue(NO_SESSION);
    const mint = await action();

    const result = await mint({ childId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });

    expect(result).toEqual({ kind: "failed" });
    expect(mintHandoffCode).not.toHaveBeenCalled();
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });

  it("refuses when the session has a user but no access token (a half-read session is not a session)", async () => {
    getUser.mockResolvedValue(SESSION);
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const mint = await action();

    expect(await mint({ childId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" })).toEqual({
      kind: "failed",
    });
    expect(mintHandoffCode).not.toHaveBeenCalled();
  });

  it("passes the SESSION's parent id to the core — never anything from the argument", async () => {
    getUser.mockResolvedValue(SESSION);
    mintHandoffCode.mockResolvedValue({ kind: "minted", destination: "https://x/#code=y" });
    const mint = await action();

    const result = await mint({ childId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", parentId: "attacker" });

    expect(result).toEqual({ kind: "minted", destination: "https://x/#code=y" });
    const [, input, ctx] = mintHandoffCode.mock.calls[0];
    expect(ctx).toEqual({ parentId: "parent-1" });
    // The argument is forwarded verbatim for the core to parse (and its strict
    // schema refuses the smuggled field) — but the parent id the core scopes by
    // came from the session, not from here.
    expect(input).toEqual({ childId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", parentId: "attacker" });
  });
});

/**
 * ── NEVER MINT A CODE THAT CANNOT BE REDEEMED (review FIX 2) ──
 * `FIRST_PROFIT_ENTER_URL` points at a page that ships in the OTHER repo, in
 * plan Unit 6. Between this unit's deploy and that one, a real family CAN reach
 * the account-ready screen — `/start` is open to everyone the moment The120
 * deploys — and clicking would mint a real code, burn it, and land them on a
 * 404 holding a password they see exactly once.
 *
 * The interlock is checked HERE, in the action, not where the button renders: a
 * Server Action is a separately-addressable POST endpoint (the page-vs-action
 * gating learning). The assertion that bites is that the CORE IS NEVER REACHED
 * and NO PRIVILEGED CLIENT IS BUILT — a `fallback` return alone would pass even
 * if a row had been written first.
 */
describe("the FP_HANDOFF_LANDING_LIVE interlock", () => {
  const CHILD = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("mints NOTHING when the flag is off, and answers with the plain sign-in page", async () => {
    vi.stubEnv("FP_HANDOFF_LANDING_LIVE", "");
    getUser.mockResolvedValue(SESSION);
    const mint = await action();

    const result = await mint({ childId: CHILD });

    expect(result).toEqual({ kind: "fallback", destination: "https://firstprofit.school/" });
    // THE NEGATIVE: no code could have come into existence.
    expect(mintHandoffCode).not.toHaveBeenCalled();
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });

  it("is FAIL-CLOSED for an unset flag and for anything that is not an affirmative", async () => {
    getUser.mockResolvedValue(SESSION);
    const mint = await action();

    for (const value of [undefined, "", "0", "false", "off", "yes", "TRUE-ish"]) {
      mintHandoffCode.mockClear();
      if (value === undefined) vi.stubEnv("FP_HANDOFF_LANDING_LIVE", "");
      else vi.stubEnv("FP_HANDOFF_LANDING_LIVE", value);
      const result = await mint({ childId: CHILD });
      expect(result, String(value)).toEqual({
        kind: "fallback",
        destination: "https://firstprofit.school/",
      });
      expect(mintHandoffCode, String(value)).not.toHaveBeenCalled();
    }
  });

  it("mints once the flag is affirmatively on (each accepted spelling)", async () => {
    getUser.mockResolvedValue(SESSION);
    const mint = await action();

    for (const value of ["1", "true", "on", " ON "]) {
      mintHandoffCode.mockClear();
      mintHandoffCode.mockResolvedValue({ kind: "minted", destination: "https://x/#code=y" });
      vi.stubEnv("FP_HANDOFF_LANDING_LIVE", value);
      expect(await mint({ childId: CHILD }), value).toEqual({
        kind: "minted",
        destination: "https://x/#code=y",
      });
      expect(mintHandoffCode, value).toHaveBeenCalledTimes(1);
    }
  });

  it("checks the SESSION before the flag — an anonymous caller learns nothing about it", async () => {
    vi.stubEnv("FP_HANDOFF_LANDING_LIVE", "");
    getUser.mockResolvedValue(NO_SESSION);
    const mint = await action();

    // `failed`, not `fallback`: the flag's state is not an oracle for the
    // unauthenticated, and the authorization refusal is unchanged by it.
    expect(await mint({ childId: CHILD })).toEqual({ kind: "failed" });
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });
});
