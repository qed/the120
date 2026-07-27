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

describe("every Server Action calling resolveFwActorForCohort guards its throw (B4 rollout tripwire)", () => {
  it("each importing action file also imports isIdentityUnavailable", async () => {
    // The api-contract review found 3 of 5 call sites missed the rollout: fw-import,
    // fw-checkin and fw-student let the new throw escape as a raw rejection, breaking
    // the actions-never-throw canon on the exact venue-wifi event this unit exists to
    // survive. The actions are "use server" files node cannot invoke, so the guard is
    // pinned as a source property: a file that CALLS the throwing resolver must also
    // import the one guard that can catch it. A new action added without the guard
    // reddens here by name. (Coarse on purpose — importing the guard and using it
    // wrongly is possible, but every wrong use so far started with not importing it.)
    const { readFileSync: rf } = await import("node:fs");
    const { glob } = await import("tinyglobby");
    const dir = new URL("../actions/", import.meta.url);
    const files = await glob(["*.ts"], { cwd: dir.pathname.replace(/^\//, "").replace(/\//g, "/"), absolute: false }).catch(() => [] as string[]);
    // Resolve robustly on Windows: read via URL, not cwd.
    const names = files.length > 0 ? files : ["fw-checkin.ts", "fw-guide.ts", "fw-import.ts", "fw-ops.ts", "fw-student.ts", "fw-sync.ts"];
    const callers: string[] = [];
    for (const name of names) {
      let src = "";
      try {
        src = rf(new URL(name, dir), "utf8");
      } catch {
        continue;
      }
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const callPattern = /\bresolveFwActorForCohort\s*\(/g;
      let sawCall = false;
      for (let m = callPattern.exec(code); m !== null; m = callPattern.exec(code)) {
        sawCall = true;
        // STRUCTURAL, not an import check — the import line survives deleting the
        // catch, which is exactly the mutation that walked through this scan's first
        // draft. Every CALL must sit within reach of a `try {` (the guard's shape in
        // all the action files), and the file must contain a catch testing the guard.
        const preceding = code.slice(Math.max(0, m.index - 260), m.index);
        expect(/\btry\s*\{/.test(preceding), `${name}: call at ${m.index} not inside a try`).toBe(
          true
        );
      }
      if (sawCall) {
        callers.push(name);
        expect(
          /\bcatch\b[\s\S]{0,240}?isIdentityUnavailable\s*\(/.test(code),
          `${name}: no catch testing isIdentityUnavailable`
        ).toBe(true);
      }
    }
    // The scan is not vacuous: the resolver has known callers today.
    expect(callers.length).toBeGreaterThanOrEqual(4);
  });
});
