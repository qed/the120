import { afterEach, describe, expect, it } from "vitest";

import {
  checkAndRecordRateLimit,
  checkRateLimit,
  clearRateLimitBucket,
  MAX_RATE_LIMIT_BUCKETS,
  recordRateLimitEvent,
  releaseRateLimitEvent,
  resetRateLimitStoreForTests,
} from "../rate-limit-store";
import { SIGN_IN_RATE_LIMIT, type RateLimitConfig } from "../rate-limit-rules";

const NOW = 1_800_000_000_000;
const cfg: RateLimitConfig = { windowMs: 60_000, limit: 3 };

afterEach(() => {
  resetRateLimitStoreForTests();
});

describe("rate-limit store (in-memory, per warm instance)", () => {
  it("allows on an empty bucket", () => {
    expect(checkRateLimit("k1", cfg, NOW)).toEqual({ allowed: true });
  });

  it("denies once the recorded events reach the limit — and other keys stay independent", () => {
    for (let i = 0; i < cfg.limit; i++) recordRateLimitEvent("k1", cfg, NOW - i * 1_000);
    expect(checkRateLimit("k1", cfg, NOW).allowed).toBe(false);
    expect(checkRateLimit("k2", cfg, NOW)).toEqual({ allowed: true });
  });

  it("frees again once the events age out of the window", () => {
    for (let i = 0; i < cfg.limit; i++) recordRateLimitEvent("k1", cfg, NOW);
    expect(checkRateLimit("k1", cfg, NOW).allowed).toBe(false);
    expect(checkRateLimit("k1", cfg, NOW + cfg.windowMs + 1)).toEqual({ allowed: true });
  });

  it("clearRateLimitBucket forgets a key (the on-success reset)", () => {
    for (let i = 0; i < cfg.limit; i++) recordRateLimitEvent("k1", cfg, NOW);
    clearRateLimitBucket("k1");
    expect(checkRateLimit("k1", cfg, NOW)).toEqual({ allowed: true });
  });

  it("works with the sign-in config end to end (5 failures lock the 6th attempt)", () => {
    for (let i = 0; i < 5; i++) recordRateLimitEvent("signin:maya", SIGN_IN_RATE_LIMIT, NOW - i * 1_000);
    const out = checkRateLimit("signin:maya", SIGN_IN_RATE_LIMIT, NOW);
    expect(out.allowed).toBe(false);
  });

  it("an ACTIVE lockout survives a distinct-key flood — eviction takes the fewest-event bucket, not the oldest (F2 fix)", () => {
    // Lock a victim, then flood with single-event throwaway keys past the cap.
    for (let i = 0; i < cfg.limit; i++) recordRateLimitEvent("victim", cfg, NOW);
    expect(checkRateLimit("victim", cfg, NOW).allowed).toBe(false);
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i++) {
      recordRateLimitEvent(`flood-${i}`, cfg, NOW);
    }
    // The victim's 3-event bucket is NOT the fewest-event bucket, so it is never
    // the eviction target while 1-event throwaways exist — the lockout holds.
    expect(checkRateLimit("victim", cfg, NOW).allowed).toBe(false);
  });
});

describe("checkAndRecordRateLimit — the atomic gate (F1 fix)", () => {
  it("records the event when it allows, so a follow-up check reflects it", () => {
    for (let i = 0; i < cfg.limit; i++) {
      expect(checkAndRecordRateLimit("k", cfg, NOW).allowed).toBe(true);
    }
    // limit events now recorded → the next gate refuses.
    const out = checkAndRecordRateLimit("k", cfg, NOW);
    expect(out.allowed).toBe(false);
  });

  it("does NOT record when it refuses (no runaway growth on a locked key)", () => {
    for (let i = 0; i < cfg.limit; i++) recordRateLimitEvent("k", cfg, NOW);
    checkAndRecordRateLimit("k", cfg, NOW); // refused
    checkAndRecordRateLimit("k", cfg, NOW); // refused
    // Still exactly `limit` events: clearing frees it in exactly one window step.
    expect(checkRateLimit("k", cfg, NOW + cfg.windowMs + 1)).toEqual({ allowed: true });
  });

  it("N atomic gates for one key admit exactly `limit`, refuse the rest — the race is closed", () => {
    let allowed = 0;
    for (let i = 0; i < cfg.limit * 3; i++) {
      if (checkAndRecordRateLimit("k", cfg, NOW).allowed) allowed++;
    }
    expect(allowed).toBe(cfg.limit);
  });
});

describe("releaseRateLimitEvent — undo a provisional strike on an outage", () => {
  it("removes exactly one (most-recent) event, re-opening a just-closed gate", () => {
    for (let i = 0; i < cfg.limit; i++) checkAndRecordRateLimit("k", cfg, NOW);
    expect(checkRateLimit("k", cfg, NOW).allowed).toBe(false);
    releaseRateLimitEvent("k");
    expect(checkRateLimit("k", cfg, NOW).allowed).toBe(true);
  });

  it("is a no-op on an unknown / empty key", () => {
    expect(() => releaseRateLimitEvent("nope")).not.toThrow();
    expect(checkRateLimit("nope", cfg, NOW)).toEqual({ allowed: true });
  });

  it("deletes the bucket when the last event is released", () => {
    checkAndRecordRateLimit("k", cfg, NOW);
    releaseRateLimitEvent("k");
    // A subsequent full window's worth is available again from scratch.
    for (let i = 0; i < cfg.limit; i++) {
      expect(checkAndRecordRateLimit("k", cfg, NOW).allowed).toBe(true);
    }
  });
});
