/**
 * verifyCodeCompletion — the CODE-mode, tokens-in-JSON verify core the fpv04
 * HTTP door calls (fpv04 Unit 3), driven by EXECUTION against the shared
 * signup harness: startSignup(mode:"code") writes the attempt + code, and every
 * assertion here reads back state that start actually persisted — the same
 * seam discipline as signup-e2e.
 *
 * What is pinned:
 *   - the happy path: start → typed code → tokens, password set ONLY after the
 *     redeem (no session before inbox proof);
 *   - the durable guess counter: wrong guesses count down, the cap locks the
 *     attempt and even the RIGHT code is then refused;
 *   - the email-keyed resolver: an address with no attempt answers as an
 *     ordinary wrong guess and WRITES NOTHING (no in-flight-signup oracle);
 *   - expiry: the 10-minute window closing answers `expired`;
 *   - post-redeem honesty (v3 FIX 5): a set-password failure after the redeem
 *     is `post_verify_failed`, and re-submitting the SAME code recovers via
 *     the redeem's `already` branch;
 *   - the is_test cohort: auto-confirmed at start, completes with any typed
 *     code (the guarded `already` grant) — the founder-scoped test path.
 */

import { describe, expect, it } from "vitest";
import { startSignup, verifyCodeCompletion } from "../signup-core";
import { MAX_CODE_GUESSES, VERIFICATION_CODE_TTL_MS } from "../verify-store";
import { makeHarness } from "./helpers/signup-harness";

const startInput = (over: Partial<Parameters<typeof startSignup>[1]> = {}) => ({
  parentEmail: "guardian@example.com",
  parentFirstName: "Robin",
  parentLastName: "Reyes",
  parentName: "Robin Reyes",
  parentPassword: "correct horse battery",
  isTest: false,
  ip: "203.0.113.7",
  ua: "vitest",
  originBase: "",
  mode: "code" as const,
  ...over,
});

async function startCode(h: ReturnType<typeof makeHarness>) {
  const started = await startSignup(h.signupDeps, startInput());
  expect(started.kind).toBe("started");
  const code = h.sentMail.at(-1)?.code;
  expect(code).toBeTruthy();
  return code!;
}

describe("verifyCodeCompletion — CODE-mode verify for the fpv04 HTTP door", () => {
  it("start → typed code → parent tokens; the password is set only after the redeem", async () => {
    const h = makeHarness();
    const code = await startCode(h);

    // Before verify: the account exists on a RANDOM password (null in the
    // harness model) — the chosen password must not be set yet.
    expect(h.authByEmail.get("guardian@example.com")?.password).toBeNull();

    const res = await verifyCodeCompletion(h.signupDeps, {
      email: "guardian@example.com",
      password: "correct horse battery",
      code,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("verify failed");
    expect(res.accessToken).toMatch(/^ptok:/);
    expect(res.refreshToken).toMatch(/^rtok:/);
    expect(h.authByEmail.get("guardian@example.com")?.password).toBe("correct horse battery");
    expect(h.store.fp_signup_attempts[0].state).toBe("verified");
  });

  it("normalizes the typed code (spaces/dashes) before comparing", async () => {
    const h = makeHarness(undefined, { codes: ["123456"] });
    await startCode(h);
    const res = await verifyCodeCompletion(h.signupDeps, {
      email: "guardian@example.com",
      password: "correct horse battery",
      code: " 123-456 ",
    });
    expect(res.ok).toBe(true);
  });

  it("a wrong guess is durably counted; the cap locks the attempt; the RIGHT code is then refused too", async () => {
    const h = makeHarness();
    const code = await startCode(h);
    const wrong = code === "999999" ? "999998" : "999999";

    for (let i = 1; i < MAX_CODE_GUESSES; i++) {
      const res = await verifyCodeCompletion(h.signupDeps, {
        email: "guardian@example.com",
        password: "correct horse battery",
        code: wrong,
      });
      expect(res).toEqual({
        ok: false,
        reason: "invalid_code",
        guessesRemaining: MAX_CODE_GUESSES - i,
      });
    }
    // The MAX-th wrong guess reports locked (remaining hits zero)…
    const capped = await verifyCodeCompletion(h.signupDeps, {
      email: "guardian@example.com",
      password: "correct horse battery",
      code: wrong,
    });
    expect(capped).toEqual({ ok: false, reason: "locked" });
    // …and the durable counter now refuses even the correct code (the redeem
    // CAS carries `code_guess_count < MAX_CODE_GUESSES`).
    const right = await verifyCodeCompletion(h.signupDeps, {
      email: "guardian@example.com",
      password: "correct horse battery",
      code,
    });
    expect(right).toEqual({ ok: false, reason: "locked" });
    // The password was never set.
    expect(h.authByEmail.get("guardian@example.com")?.password).toBeNull();
  });

  it("an address with NO attempt answers as an ordinary wrong guess and writes nothing", async () => {
    const h = makeHarness();
    const res = await verifyCodeCompletion(h.signupDeps, {
      email: "nobody@example.com",
      password: "correct horse battery",
      code: "123456",
    });
    expect(res).toEqual({
      ok: false,
      reason: "invalid_code",
      guessesRemaining: MAX_CODE_GUESSES - 1,
    });
    expect(h.store.fp_signup_attempts).toHaveLength(0);
  });

  it("the 10-minute window closing answers `expired`", async () => {
    const h = makeHarness();
    const code = await startCode(h);
    h.advanceClock(VERIFICATION_CODE_TTL_MS + 1);
    const res = await verifyCodeCompletion(h.signupDeps, {
      email: "guardian@example.com",
      password: "correct horse battery",
      code,
    });
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("post-redeem set-password failure is `post_verify_failed`, and re-submitting the SAME code recovers", async () => {
    const h = makeHarness();
    const code = await startCode(h);

    h.setPasswordFails(true);
    const first = await verifyCodeCompletion(h.signupDeps, {
      email: "guardian@example.com",
      password: "correct horse battery",
      code,
    });
    expect(first).toEqual({ ok: false, reason: "post_verify_failed" });

    // The single-use code is SPENT (verified_at stamped) — but the recovery
    // path is the redeem's `already` branch, which still costs the code.
    h.setPasswordFails(false);
    const retry = await verifyCodeCompletion(h.signupDeps, {
      email: "guardian@example.com",
      password: "correct horse battery",
      code,
    });
    expect(retry.ok).toBe(true);
  });

  it("is_test cohort: auto-confirmed at start, completes with ANY typed code, no mail ever sent", async () => {
    const h = makeHarness();
    const started = await startSignup(
      h.signupDeps,
      startInput({ parentEmail: "founder@test.the120.invalid", isTest: true })
    );
    expect(started.kind).toBe("started");
    expect(h.sentMail).toHaveLength(0); // the guarded inbox is never mailed
    const res = await verifyCodeCompletion(h.signupDeps, {
      email: "founder@test.the120.invalid",
      password: "correct horse battery",
      code: "000000", // any code: the `already` grant is scoped to is_test
    });
    expect(res.ok).toBe(true);
  });

  it("a REAL family's already-verified attempt does NOT grant `already` to a wrong code", async () => {
    const h = makeHarness();
    const code = await startCode(h);
    const first = await verifyCodeCompletion(h.signupDeps, {
      email: "guardian@example.com",
      password: "correct horse battery",
      code,
    });
    expect(first.ok).toBe(true);
    // Re-verify with a WRONG code: must be a wrong guess, not `already`.
    const wrong = await verifyCodeCompletion(h.signupDeps, {
      email: "guardian@example.com",
      password: "correct horse battery",
      code: code === "999999" ? "999998" : "999999",
    });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) throw new Error("unreachable");
    expect(wrong.reason).toBe("invalid_code");
  });
});
