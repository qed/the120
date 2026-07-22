import { afterEach, describe, expect, it } from "vitest";

import {
  checkRateLimit,
  clearRateLimitBucket,
  MAX_RATE_LIMIT_BUCKETS,
  recordRateLimitEvent,
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

  it("evicts the oldest-inserted bucket beyond the cap — bounded memory, fails OPEN for the evicted key", () => {
    // Deny k-first, then flood with distinct keys until the cap forces eviction.
    for (let i = 0; i < cfg.limit; i++) recordRateLimitEvent("k-first", cfg, NOW);
    expect(checkRateLimit("k-first", cfg, NOW).allowed).toBe(false);
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i++) {
      recordRateLimitEvent(`flood-${i}`, cfg, NOW);
    }
    // k-first was the oldest bucket, so it was evicted → its history is gone.
    expect(checkRateLimit("k-first", cfg, NOW)).toEqual({ allowed: true });
  });
});
