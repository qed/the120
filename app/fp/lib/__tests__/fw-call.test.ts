import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FW_ACTION_TIMEOUT_MS,
  FW_CALL_TIMEOUT_MS,
  withFwTimeout,
} from "@/app/fp/lib/fw-call";

/**
 * The FW wall clock.
 *
 * These exist because `withFwTimeout` stopped being only a server-side helper: the
 * client's await of the `drainFwQueue` Server Action now runs through it, and that
 * await happens while `fw-offline-drain` is HELD. Web Locks are origin-scoped and
 * cross-document, so an unbounded wait there wedges every later drain and every
 * future sign-out in every tab of a shared guide iPad. The budget is the only thing
 * standing between a captive portal and that state, so it is tested rather than
 * assumed (reliability / adversarial / frontend-races review all landed on this).
 */
describe("withFwTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the value when the call lands inside the budget", async () => {
    const promise = withFwTimeout(Promise.resolve("landed"), "test call");
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ timedOut: false, value: "landed" });
  });

  it("reports timedOut when the call outlasts the budget", async () => {
    const never = new Promise<string>(() => {});
    const promise = withFwTimeout(never, "test call");
    await vi.advanceTimersByTimeAsync(FW_CALL_TIMEOUT_MS + 1);
    await expect(promise).resolves.toEqual({ timedOut: true });
  });

  it("a promise that NEVER settles still resolves — the captive-portal shape", async () => {
    // This is the exact failure the drain fix exists for: not a rejection, not a
    // slow response, but a fetch the network silently drops so it never settles at
    // all. If this ever hangs, the lock is held forever and the iPad is wedged.
    const dropped = new Promise<string>(() => {});
    const promise = withFwTimeout(dropped, "drain action", FW_ACTION_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(FW_ACTION_TIMEOUT_MS + 1);
    await expect(promise).resolves.toEqual({ timedOut: true });
  });

  it("honours a custom budget instead of the default", async () => {
    const never = new Promise<string>(() => {});
    const promise = withFwTimeout(never, "drain action", FW_ACTION_TIMEOUT_MS);
    // Past the DEFAULT budget but inside the action budget — must still be waiting.
    await vi.advanceTimersByTimeAsync(FW_CALL_TIMEOUT_MS + 1);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(FW_ACTION_TIMEOUT_MS);
    await expect(promise).resolves.toEqual({ timedOut: true });
  });

  it("propagates a rejection rather than swallowing it as a timeout", async () => {
    // A rejected action must reach the caller's catch (where `isNextRedirect` lives);
    // turning it into `timedOut` would silently eat an auth redirect.
    // Rejected AFTER the call is in flight, which is both the real shape of a
    // network failure and free of the unhandled-rejection window an eagerly
    // rejected promise would open before the race attaches its handler.
    let fail!: (e: Error) => void;
    const failing = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });
    const promise = withFwTimeout(failing, "test call");
    fail(new Error("boom"));
    await expect(promise).rejects.toThrow("boom");
  });

  it("the action budget is larger than the single-call budget", () => {
    // One Server Action wraps several Supabase round trips plus the fold. Reusing the
    // per-call budget out here would abort legitimate drains of a weekend's backlog.
    expect(FW_ACTION_TIMEOUT_MS).toBeGreaterThan(FW_CALL_TIMEOUT_MS);
  });
});
