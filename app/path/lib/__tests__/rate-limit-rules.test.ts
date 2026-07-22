import { describe, expect, it } from "vitest";

import {
  evaluateRateLimit,
  pruneEvents,
  SIGN_IN_RATE_LIMIT,
  UPLOAD_SLOT_RATE_LIMIT,
  type RateLimitConfig,
} from "../rate-limit-rules";

/** Fixed epoch so every scenario is deterministic (no Date.now in pure tests). */
const NOW = 1_800_000_000_000;

const cfg: RateLimitConfig = { windowMs: 60_000, limit: 3 };

describe("evaluateRateLimit — sliding window", () => {
  it("allows when no events exist", () => {
    expect(evaluateRateLimit({ events: [], now: NOW, ...cfg })).toEqual({ allowed: true });
  });

  it("allows while the in-window count is below the limit", () => {
    const events = [NOW - 1_000, NOW - 2_000];
    expect(evaluateRateLimit({ events, now: NOW, ...cfg })).toEqual({ allowed: true });
  });

  it("denies once the in-window count reaches the limit", () => {
    const events = [NOW - 1_000, NOW - 2_000, NOW - 3_000];
    const out = evaluateRateLimit({ events, now: NOW, ...cfg });
    expect(out.allowed).toBe(false);
  });

  it("denies above the limit too", () => {
    const events = [NOW - 1_000, NOW - 2_000, NOW - 3_000, NOW - 4_000];
    expect(evaluateRateLimit({ events, now: NOW, ...cfg }).allowed).toBe(false);
  });

  it("ignores events that have left the window", () => {
    // Three old events + two fresh ones = two in-window → allowed at limit 3.
    const events = [
      NOW - cfg.windowMs - 1,
      NOW - cfg.windowMs - 5_000,
      NOW - cfg.windowMs * 2,
      NOW - 1_000,
      NOW - 2_000,
    ];
    expect(evaluateRateLimit({ events, now: NOW, ...cfg })).toEqual({ allowed: true });
  });

  it("an event EXACTLY windowMs old has expired (in-window is now - t < windowMs)", () => {
    const events = [NOW - cfg.windowMs, NOW - 1_000, NOW - 2_000];
    // Only two count → allowed.
    expect(evaluateRateLimit({ events, now: NOW, ...cfg })).toEqual({ allowed: true });
  });

  it("a FUTURE-stamped event (clock skew) still counts — never pruned into a fail-open", () => {
    const events = [NOW + 5_000, NOW - 1_000, NOW - 2_000];
    expect(evaluateRateLimit({ events, now: NOW, ...cfg }).allowed).toBe(false);
  });

  it("is order-independent", () => {
    const events = [NOW - 3_000, NOW - 1_000, NOW - 2_000];
    const shuffled = [NOW - 1_000, NOW - 3_000, NOW - 2_000];
    expect(evaluateRateLimit({ events, now: NOW, ...cfg })).toEqual(
      evaluateRateLimit({ events: shuffled, now: NOW, ...cfg })
    );
  });

  it("denial reports retryAfterMs until the OLDEST in-window event expires", () => {
    // Oldest in-window at NOW-40s → it exits the 60s window in 20s.
    const events = [NOW - 40_000, NOW - 10_000, NOW - 5_000];
    const out = evaluateRateLimit({ events, now: NOW, ...cfg });
    expect(out).toEqual({ allowed: false, retryAfterMs: 20_000 });
  });

  it("retryAfterMs ignores expired events when picking the oldest", () => {
    const events = [NOW - cfg.windowMs * 3, NOW - 30_000, NOW - 10_000, NOW - 5_000];
    const out = evaluateRateLimit({ events, now: NOW, ...cfg });
    expect(out).toEqual({ allowed: false, retryAfterMs: 30_000 });
  });

  it("retryAfterMs is clamped positive and never exceeds windowMs", () => {
    // All events right now → full window to wait.
    const events = [NOW, NOW, NOW];
    const out = evaluateRateLimit({ events, now: NOW, ...cfg });
    if (out.allowed) throw new Error("expected denial");
    expect(out.retryAfterMs).toBeGreaterThan(0);
    expect(out.retryAfterMs).toBeLessThanOrEqual(cfg.windowMs);
  });

  it("FAILS CLOSED on a non-positive limit — a zero/negative limit denies everything", () => {
    expect(evaluateRateLimit({ events: [], now: NOW, windowMs: 60_000, limit: 0 }).allowed).toBe(
      false
    );
    expect(evaluateRateLimit({ events: [], now: NOW, windowMs: 60_000, limit: -1 }).allowed).toBe(
      false
    );
  });
});

describe("pruneEvents", () => {
  it("keeps only in-window events (future-stamped included), preserving values", () => {
    const events = [NOW - cfg.windowMs - 1, NOW - 59_999, NOW - 1, NOW + 2_000];
    expect(pruneEvents(events, NOW, cfg.windowMs)).toEqual([NOW - 59_999, NOW - 1, NOW + 2_000]);
  });

  it("returns an empty array when everything expired", () => {
    expect(pruneEvents([NOW - 120_000, NOW - 61_000], NOW, cfg.windowMs)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const events = [NOW - 120_000, NOW - 1_000];
    pruneEvents(events, NOW, cfg.windowMs);
    expect(events).toEqual([NOW - 120_000, NOW - 1_000]);
  });
});

describe("sign-in configuration (R29)", () => {
  it("allows the attempt while fewer than 5 failures sit in the window", () => {
    const fourFailures = [1, 2, 3, 4].map((i) => NOW - i * 1_000);
    expect(
      evaluateRateLimit({ events: fourFailures, now: NOW, ...SIGN_IN_RATE_LIMIT })
    ).toEqual({ allowed: true });
  });

  it("REJECTS the 6th attempt after 5 in-window failures — even a correct password never runs", () => {
    // The plan's named scenario: the decision layer refuses BEFORE verification,
    // so a correct password on the 6th attempt is still rejected.
    const fiveFailures = [1, 2, 3, 4, 5].map((i) => NOW - i * 1_000);
    const out = evaluateRateLimit({ events: fiveFailures, now: NOW, ...SIGN_IN_RATE_LIMIT });
    expect(out.allowed).toBe(false);
  });

  it("frees again once the failures age out of the window", () => {
    const staleFailures = [1, 2, 3, 4, 5].map(
      (i) => NOW - SIGN_IN_RATE_LIMIT.windowMs - i * 1_000
    );
    expect(
      evaluateRateLimit({ events: staleFailures, now: NOW, ...SIGN_IN_RATE_LIMIT })
    ).toEqual({ allowed: true });
  });
});

describe("upload-slot configuration (Unit 9 carry-forward → bounds never-finalized uploads)", () => {
  it("publishes a usable config the slot action can evaluate against", () => {
    expect(UPLOAD_SLOT_RATE_LIMIT.windowMs).toBeGreaterThan(0);
    expect(UPLOAD_SLOT_RATE_LIMIT.limit).toBeGreaterThan(0);
    // Same evaluator, different config — the module is generic by construction.
    const mints = Array.from(
      { length: UPLOAD_SLOT_RATE_LIMIT.limit },
      (_, i) => NOW - (i + 1) * 1_000
    );
    expect(
      evaluateRateLimit({ events: mints, now: NOW, ...UPLOAD_SLOT_RATE_LIMIT }).allowed
    ).toBe(false);
    expect(
      evaluateRateLimit({ events: mints.slice(1), now: NOW, ...UPLOAD_SLOT_RATE_LIMIT }).allowed
    ).toBe(true);
  });

  it("is generous enough for an honest capture session (several evidence items + retries)", () => {
    // A student attaching five items with a couple of retries each must never hit it.
    const honestSession = Array.from({ length: 12 }, (_, i) => NOW - i * 20_000);
    expect(
      evaluateRateLimit({ events: honestSession, now: NOW, ...UPLOAD_SLOT_RATE_LIMIT }).allowed
    ).toBe(true);
  });
});
