import { describe, expect, it } from "vitest";
import {
  deriveRateLimitKeys as deriveLoginRateLimitKeys,
  FP_SIGN_IN_REFUSAL_BODY,
} from "@/app/api/fp/login/login-rules";
import {
  FP_LOGIN_CODE_REDEEM_RATE_LIMIT,
  FP_LOGIN_CODE_REQUEST_RATE_LIMIT,
} from "@/app/lib/fp/rate-limit-rules";
import { checkAndRecordRateLimit } from "@/app/lib/fp/rate-limit-store";
import {
  deriveCodeRedeemIpKey,
  deriveCodeRedeemRateLimitKeys,
  deriveCodeRequestParentRateLimitKey,
  deriveCodeRequestRateLimitKeys,
  formatLoginCode,
  isLoginCodeInfraFailure,
  LOGIN_CODE_REFUNDED_REFUSALS,
  LOGIN_CODE_REQUEST_UNIFORM_BODY,
  LOGIN_CODE_TTL_MS,
  MAX_OUTSTANDING_LOGIN_CODES,
  normalizeLoginCode,
  parseCodeRedeem,
  parseCodeRequest,
  shapeLoginCodeRefusal,
  type LoginCodeRefusalReason,
} from "../login-code-rules";

/** The pure login-code decisions (fpv03 U3c). No DB, no Next. */

describe("code format + normalization", () => {
  it("formats the CSPRNG integer zero-padded to 6 digits", () => {
    expect(formatLoginCode(0)).toBe("000000");
    expect(formatLoginCode(7)).toBe("000007");
    expect(formatLoginCode(999999)).toBe("999999");
  });

  it("throws on an out-of-range mint rather than quietly shortening the code", () => {
    expect(() => formatLoginCode(1_000_000)).toThrow();
    expect(() => formatLoginCode(-1)).toThrow();
    expect(() => formatLoginCode(1.5)).toThrow();
  });

  it("normalizes whitespace/dash-separated and fullwidth digits; refuses everything else", () => {
    expect(normalizeLoginCode("123456")).toBe("123456");
    expect(normalizeLoginCode("123 456")).toBe("123456");
    expect(normalizeLoginCode("123-456")).toBe("123456");
    expect(normalizeLoginCode(" １２３４５６ ")).toBe("123456"); // NFKC fold
    expect(normalizeLoginCode("12345")).toBeNull();
    expect(normalizeLoginCode("1234567")).toBeNull();
    expect(normalizeLoginCode("12345a")).toBeNull();
    expect(normalizeLoginCode("")).toBeNull();
  });
});

describe("request/redeem parsing (strict shapes)", () => {
  it("accepts {username} and refuses extra keys / wrong types / out-of-bounds", () => {
    expect(parseCodeRequest({ username: "remi.newal@firstprofit.school" })).toEqual({
      ok: true,
      username: "remi.newal@firstprofit.school",
    });
    expect(parseCodeRequest({ username: "a", extra: 1 })).toEqual({ ok: false });
    expect(parseCodeRequest({ username: 42 })).toEqual({ ok: false });
    expect(parseCodeRequest({ username: "x".repeat(81) })).toEqual({ ok: false });
    expect(parseCodeRequest(null)).toEqual({ ok: false });
  });

  it("accepts {username, code} and refuses extras", () => {
    expect(parseCodeRedeem({ username: "remi", code: "123456" })).toEqual({
      ok: true,
      username: "remi",
      code: "123456",
    });
    expect(parseCodeRedeem({ username: "remi" })).toEqual({ ok: false });
    expect(parseCodeRedeem({ username: "remi", code: "123456", x: 1 })).toEqual({ ok: false });
  });
});

describe("uniform answers — no oracle in bytes", () => {
  it("the request success body is ONE pre-serialized string with the promised copy", () => {
    expect(LOGIN_CODE_REQUEST_UNIFORM_BODY).toBe(
      JSON.stringify({ ok: true, message: "If this account exists, we emailed the parent a code." })
    );
  });

  it("every redeem refusal is the login route's byte-identical 401", () => {
    const reasons: LoginCodeRefusalReason[] = [
      "malformed_request",
      "invalid_code",
      "not_child",
      "rate_limited",
      "outage",
    ];
    for (const reason of reasons) {
      const shaped = shapeLoginCodeRefusal(reason);
      expect(shaped.status).toBe(401);
      // THE SAME string object, not an equal-looking copy.
      expect(shaped.body).toBe(FP_SIGN_IN_REFUSAL_BODY);
    }
  });

  it("the refund allowlist is EXACTLY {outage} (whole set, never an || chain)", () => {
    expect([...LOGIN_CODE_REFUNDED_REFUSALS]).toEqual(["outage"]);
    expect(isLoginCodeInfraFailure("outage")).toBe(true);
    expect(isLoginCodeInfraFailure("invalid_code")).toBe(false);
    expect(isLoginCodeInfraFailure("rate_limited")).toBe(false);
    expect(isLoginCodeInfraFailure("malformed_request")).toBe(false);
    expect(isLoginCodeInfraFailure("not_child")).toBe(false);
  });
});

describe("bounds", () => {
  it("TTL is ten minutes — the email copy's promise", () => {
    expect(LOGIN_CODE_TTL_MS).toBe(10 * 60_000);
  });

  it("outstanding cap is small (no durable guess cap exists — FIX 1)", () => {
    expect(MAX_OUTSTANDING_LOGIN_CODES).toBe(3);
  });

  it("the redeem limiter is the load-bearing brute-force bound: tight per (ip,username)", () => {
    // FIX 1: with NO durable per-code guess counter, the limiter is what bounds
    // brute force of the 10^6-entropy code. 5 tries / 15 min per (ip,username)
    // is negligible against 1e6 while leaving a fat-fingering kid corrections.
    expect(FP_LOGIN_CODE_REDEEM_RATE_LIMIT.limit).toBe(5);
    expect(FP_LOGIN_CODE_REDEEM_RATE_LIMIT.limit).toBeLessThan(6);
    expect(FP_LOGIN_CODE_REDEEM_RATE_LIMIT.windowMs).toBe(15 * 60_000);
  });
});

describe("rate-limit keys — distinct namespaces, injective segments", () => {
  it("request keys: per-USERNAME (no ip in the bucket) + per-IP aggregate", () => {
    const { usernameKey, ipKey } = deriveCodeRequestRateLimitKeys("1.2.3.4", "remi@firstprofit.school");
    expect(usernameKey).toBe("fp-login-code-req:remi%40firstprofit.school");
    expect(ipKey).toBe("fp-login-code-req-ip:1.2.3.4");
    // Varying the IP must NOT vary the username bucket (mail-bomb bound).
    expect(deriveCodeRequestRateLimitKeys("5.6.7.8", "remi@firstprofit.school").usernameKey).toBe(
      usernameKey
    );
  });

  it("redeem keys: (ip, username) + per-IP, with IPv6-safe encoding", () => {
    const { usernameKey, ipKey } = deriveCodeRedeemRateLimitKeys("2001:db8::1", "remi");
    expect(usernameKey).toBe("fp-login-code-redeem:2001%3Adb8%3A%3A1:remi");
    expect(ipKey).toBe("fp-login-code-redeem-ip:2001%3Adb8%3A%3A1");
  });

  it("the redeem IP-only key (recorded before parse) equals the pair's ipKey", () => {
    // FIX 1: the route records the per-IP strike before the body parse, so the
    // standalone helper must derive the SAME bucket the pair does.
    for (const ip of ["1.2.3.4", "2001:db8::1"]) {
      expect(deriveCodeRedeemIpKey(ip)).toBe(deriveCodeRedeemRateLimitKeys(ip, "x").ipKey);
    }
  });

  it("the per-parent-inbox request key is parent-id keyed, IP-independent, total-encoded (FIX 2)", () => {
    expect(deriveCodeRequestParentRateLimitKey("parent-uuid-1")).toBe(
      "fp-login-code-req-parent:parent-uuid-1"
    );
    // A lone surrogate in the keyed id must NOT throw (encodeuricomponent-is-not-
    // total): it is replaced, never a 500 oracle.
    expect(() => deriveCodeRequestParentRateLimitKey("\uD800")).not.toThrow();
    // Distinct from every other login-code bucket namespace.
    expect(deriveCodeRequestParentRateLimitKey("p").startsWith("fp-login-code-req-parent:")).toBe(
      true
    );
  });

  it("no login-code key can collide with the password login's buckets", () => {
    const req = deriveCodeRequestRateLimitKeys("1.2.3.4", "remi");
    const red = deriveCodeRedeemRateLimitKeys("1.2.3.4", "remi");
    for (const key of [req.usernameKey, req.ipKey, red.usernameKey, red.ipKey]) {
      expect(key.startsWith("fp-login:")).toBe(false);
      expect(key.startsWith("fp-login-ip:")).toBe(false);
    }
    // And the four are pairwise distinct.
    expect(new Set([req.usernameKey, req.ipKey, red.usernameKey, red.ipKey]).size).toBe(4);
  });
});

describe("fpv04 U3: the D7 alias collapses onto ONE rate-limit budget", () => {
  const A = "remi.newal@firstprofit.school";
  const B = "remi.newal@the120.school";

  it("request keys: both spellings derive the SAME username bucket", () => {
    expect(deriveCodeRequestRateLimitKeys("1.2.3.4", B).usernameKey).toBe(
      deriveCodeRequestRateLimitKeys("1.2.3.4", A).usernameKey
    );
  });

  it("redeem keys: both spellings derive the SAME (ip,username) bucket — the redeem limiter is the ONLY brute-force control there", () => {
    expect(deriveCodeRedeemRateLimitKeys("1.2.3.4", B).usernameKey).toBe(
      deriveCodeRedeemRateLimitKeys("1.2.3.4", A).usernameKey
    );
  });

  it("password-login keys collapse the same way", () => {
    expect(deriveLoginRateLimitKeys("1.2.3.4", B).nameKey).toBe(
      deriveLoginRateLimitKeys("1.2.3.4", A).nameKey
    );
  });

  it("non-alias identifiers are byte-identical to the pre-fpv04 keys (no bucket migration)", () => {
    expect(deriveCodeRequestRateLimitKeys("1.2.3.4", "remi").usernameKey).toBe(
      "fp-login-code-req:remi"
    );
    // A gmail-shaped name keeps its own bucket — no generic domain folding.
    expect(deriveCodeRequestRateLimitKeys("1.2.3.4", "kid@gmail.com").usernameKey).toBe(
      "fp-login-code-req:kid%40gmail.com"
    );
  });

  it("BEHAVIORAL: exhausting the budget under one spelling leaves the OTHER spelling rate-limited too", () => {
    // The real in-memory store, on a per-run-unique STEM (the request bucket
    // is keyed on the username alone) so no other strikes share it. Spend the
    // whole request budget under the firstprofit spelling…
    const stem = `alias-collapse-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const keyA = deriveCodeRequestRateLimitKeys("1.2.3.4", `${stem}@firstprofit.school`)
      .usernameKey;
    for (let i = 0; i < FP_LOGIN_CODE_REQUEST_RATE_LIMIT.limit; i++) {
      expect(checkAndRecordRateLimit(keyA, FP_LOGIN_CODE_REQUEST_RATE_LIMIT).allowed).toBe(true);
    }
    // …and the the120 spelling is refused: one child, ONE combined budget.
    const keyB = deriveCodeRequestRateLimitKeys("1.2.3.4", `${stem}@the120.school`).usernameKey;
    expect(keyB).toBe(keyA);
    expect(checkAndRecordRateLimit(keyB, FP_LOGIN_CODE_REQUEST_RATE_LIMIT).allowed).toBe(false);
  });
});
