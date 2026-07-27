import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B4: `loadFwSessionRead` answers THREE ways, and a non-answer is never "no session"
 * (Staff Front Door Unit 5).
 *
 * ── Why this file mocks, when almost nothing else in this repo does
 *
 * The repo's canon is that decisions live in pure functions and the impure shell adds
 * I/O only, so tests almost never need a double. This is the exception the canon
 * predicts: the thing under test IS the mapping from an I/O outcome onto a verdict.
 * There is no pure function to extract here — a `mapReadToVerdict(timedOut, user)`
 * helper would be the `if` it replaced, tested against itself, and it would leave the
 * question that actually matters ("is the call WRAPPED?") unasked.
 *
 * So the seams are faked at the module boundary (the precedent is
 * `fw-student-core.test.ts`) and the assertions are about behaviour: a `getUser()` that
 * never settles must produce `unknown`, and it must produce it WITHOUT waiting for the
 * whole serverless budget.
 *
 * ⚠️ THE FAILING TEST TO KEEP IN MIND. Before this unit, a hung `getUser()` hung the
 * request; a bounded one that reported `null` would have been worse than the hang,
 * because `requireFwSession` redirects on `null` — evicting a guide to the sign-in door
 * mid-shift, with un-landed captures on the device. "Not null" is the assertion that
 * matters; `unknown` is how it is spelled.
 */

const getUser = vi.fn();
const grantsResult = vi.fn();

vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { getUser } }),
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => grantsResult(),
        }),
      }),
    }),
  }),
}));

// `cache()` memoizes per request; in a bare node test there is no request scope, so
// React returns the same value for every call within a module instance. Each test
// therefore re-imports the module fresh rather than fighting the memo.
//
// ⚠️ THE IMPORT IS AWAITED SEPARATELY FROM THE CALL, and that is not tidiness. Under
// fake timers, `advanceTimersByTimeAsync` only fires timers that have already been
// SCHEDULED — so a test that advances the clock while the dynamic import is still
// resolving advances past a `setTimeout` that does not exist yet, and then waits
// forever for a promise nothing will settle. The first draft of this file did exactly
// that and hung at 5s while its siblings passed, which is a confusing failure to
// inherit: it looks like the timeout under test not working.
const freshAuth = async () => {
  vi.resetModules();
  return import("../fw-auth");
};

const USER = { id: "u-1", email: "guide@the120.school", app_metadata: {} };
/** A promise that never settles — the venue failure this whole unit is built around.
 *  NOT a rejection: a captive portal that silently drops a request produces a fetch
 *  that hangs, and a test that used a rejection would exercise the throw guard while
 *  claiming to exercise the timeout. */
const never = () => new Promise(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  getUser.mockReset();
  grantsResult.mockReset();
});

describe("loadFwSessionRead — a non-answer is `unknown`, never `none` (B4)", () => {
  it("a hung getUser() resolves to unknown once the budget elapses", async () => {
    getUser.mockImplementation(never);
    const { loadFwSessionRead } = await freshAuth();
    const pending = loadFwSessionRead();
    await vi.advanceTimersByTimeAsync(8_000);
    const read = await pending;
    expect(read.kind).toBe("unknown");
    // The distinction the type exists to enforce, asserted as behaviour: this is NOT
    // the value `requireFwSession` redirects on.
    expect(read.kind).not.toBe("none");
  });

  it("a hung getUser() does NOT resolve early — the budget is real, not zero", async () => {
    // Guards the opposite mutation from the one above. A wrapper with a 0ms budget
    // would pass the previous test and abandon every legitimate slow-but-fine read on
    // venue wifi, which is a worse outage than the one being fixed.
    getUser.mockImplementation(never);
    const { loadFwSessionRead } = await freshAuth();
    let settled = false;
    const pending = loadFwSessionRead().then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(settled).toBe(true);
  });

  it("a THROWN getUser() is unknown too — a throw and a timeout are the same fact", async () => {
    // supabase-js reports most failures in-band, but a network abort throws. Both mean
    // no answer arrived, and neither is evidence about the account.
    getUser.mockRejectedValue(new Error("network abort"));
    expect((await (await freshAuth()).loadFwSessionRead()).kind).toBe("unknown");
  });

  it("a genuine signed-out session is still `none` — the terminal answer survives", async () => {
    // The whole change is worthless if it also stopped real sign-outs from redirecting.
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await (await freshAuth()).loadFwSessionRead()).kind).toBe("none");
  });

  it("an unreadable GRANTS query is unknown, not an account with zero grants", async () => {
    // The subtle half. This query used to log its error and continue with `grants: []`,
    // which looks conservative and is not: `grantedCohortIds` becomes the bar's
    // `isFwGuide`, which is the SERVER-KNOWN half of the sign-out evidence gate (B1).
    // An understated grant list reads as "not an FW guide", which makes the bar skip
    // the device's own queue check and sign out over un-landed captures, silently.
    getUser.mockResolvedValue({ data: { user: USER } });
    grantsResult.mockResolvedValue({ data: null, error: { message: "read blip" } });
    expect((await (await freshAuth()).loadFwSessionRead()).kind).toBe("unknown");
  });

  it("a hung GRANTS query is bounded and unknown", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    grantsResult.mockImplementation(never);
    const { loadFwSessionRead } = await freshAuth();
    const pending = loadFwSessionRead();
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await pending).kind).toBe("unknown");
  });

  it("the happy path still carries userId, email and grants", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    grantsResult.mockResolvedValue({
      data: [{ role: "guide", scope_type: "cohort", scope_id: "11111111-1111-4111-8111-111111111111" }],
      error: null,
    });
    const read = await (await freshAuth()).loadFwSessionRead();
    expect(read.kind).toBe("identity");
    if (read.kind !== "identity") throw new Error("unreachable");
    expect(read.identity.userId).toBe("u-1");
    expect(read.identity.email).toBe("guide@the120.school");
    expect(read.identity.grants).toHaveLength(1);
  });

  it("a MALFORMED grant row is still dropped-and-logged, not escalated to unknown", async () => {
    // The deliberate asymmetry, pinned so it is not "tidied" into consistency. Not
    // receiving an answer and receiving a bad row are different questions: the first is
    // undecidable, the second is data we DID receive and can judge. Escalating a single
    // junk row to `unknown` would take down the whole FW subtree over one bad record.
    getUser.mockResolvedValue({ data: { user: USER } });
    grantsResult.mockResolvedValue({
      data: [{ role: "wizard", scope_type: "cohort", scope_id: "nope" }],
      error: null,
    });
    const read = await (await freshAuth()).loadFwSessionRead();
    expect(read.kind).toBe("identity");
    if (read.kind !== "identity") throw new Error("unreachable");
    expect(read.identity.grants).toEqual([]);
  });
});
