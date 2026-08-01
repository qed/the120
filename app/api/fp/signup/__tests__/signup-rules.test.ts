import { describe, expect, it } from "vitest";
import {
  buildAllowedOrigins,
  checkOrigin,
  deriveSignupRateLimitKeys,
  deriveVerifyRateLimitKeys,
  isTestSignup,
  launchGateVerdict,
  parseSignupRequest,
  shapeSignupRefusal,
  splitParentName,
  type SignupRefusalReason,
} from "../signup-rules";

/* ------------------------------------------------------------ request parse */

const goodBody = {
  parentName: "Dana Rivera",
  parentEmail: "dana@example.com",
  parentPassword: "hunter2hunter",
  childFirstName: "Mia",
  childAgeBand: "under_13",
  jurisdiction: "US-CA",
  credentialChoice: "existing_credential",
};

describe("parseSignupRequest", () => {
  it("accepts a well-formed signup body", () => {
    const parsed = parseSignupRequest(goodBody);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.parentEmail).toBe("dana@example.com");
      expect(parsed.data.childAgeBand).toBe("under_13");
      expect(parsed.data.credentialChoice).toBe("existing_credential");
    }
  });

  it("accepts an optional childDob when ISO-shaped, rejects a malformed one", () => {
    expect(parseSignupRequest({ ...goodBody, childDob: "2016-04-01" }).ok).toBe(true);
    expect(parseSignupRequest({ ...goodBody, childDob: "04/01/2016" }).ok).toBe(false);
  });

  it("refuses a non-object body", () => {
    expect(parseSignupRequest(null).ok).toBe(false);
    expect(parseSignupRequest("dana").ok).toBe(false);
    expect(parseSignupRequest(42).ok).toBe(false);
  });

  it("refuses an email with no @ / bad shape", () => {
    expect(parseSignupRequest({ ...goodBody, parentEmail: "dana-at-example" }).ok).toBe(false);
    expect(parseSignupRequest({ ...goodBody, parentEmail: "" }).ok).toBe(false);
  });

  it("refuses a password shorter than 8", () => {
    expect(parseSignupRequest({ ...goodBody, parentPassword: "short" }).ok).toBe(false);
    expect(parseSignupRequest({ ...goodBody, parentPassword: "1234567" }).ok).toBe(false);
    expect(parseSignupRequest({ ...goodBody, parentPassword: "12345678" }).ok).toBe(true);
  });

  it("refuses an unknown age band or credential choice", () => {
    expect(parseSignupRequest({ ...goodBody, childAgeBand: "toddler" }).ok).toBe(false);
    expect(parseSignupRequest({ ...goodBody, credentialChoice: "carrier_pigeon" }).ok).toBe(false);
  });

  it("refuses a missing required field and unknown extra keys (strict)", () => {
    const { jurisdiction, ...noJurisdiction } = goodBody;
    void jurisdiction;
    expect(parseSignupRequest(noJurisdiction).ok).toBe(false);
    expect(parseSignupRequest({ ...goodBody, isTest: true }).ok).toBe(false); // is_test is server-side only
  });
});

/* ------------------------------------------------------- parent name split */

describe("splitParentName", () => {
  it("splits first name from the rest", () => {
    expect(splitParentName("Dana Rivera")).toEqual({ firstName: "Dana", lastName: "Rivera" });
    expect(splitParentName("Ana Maria De La Cruz")).toEqual({
      firstName: "Ana",
      lastName: "Maria De La Cruz",
    });
  });

  it("yields an empty last name for a single token", () => {
    expect(splitParentName("Dana")).toEqual({ firstName: "Dana", lastName: "" });
    expect(splitParentName("  Dana  ")).toEqual({ firstName: "Dana", lastName: "" });
  });
});

/* -------------------------------------------------- launch gate (Rev 3, P0) */

describe("isTestSignup (server-side only)", () => {
  it("recognizes the guarded test domain", () => {
    expect(isTestSignup("family1@test.the120.invalid", {})).toBe(true);
    expect(isTestSignup("FAMILY1@Test.The120.Invalid", {})).toBe(true);
  });

  it("recognizes an env allowlist entry (normalized, comma-separated)", () => {
    const env = { FP_SIGNUP_TEST_ALLOWLIST: "vip@gmail.com, other@x.com" };
    expect(isTestSignup("vip@gmail.com", env)).toBe(true);
    expect(isTestSignup("  VIP@gmail.com ", env)).toBe(true);
    expect(isTestSignup("stranger@gmail.com", env)).toBe(false);
  });

  it("treats an ordinary email as non-test", () => {
    expect(isTestSignup("dana@example.com", {})).toBe(false);
  });
});

describe("launchGateVerdict", () => {
  it("defaults test-only ON: a non-test email is refused, a test email allowed", () => {
    expect(launchGateVerdict("dana@example.com", {})).toEqual({
      allowed: false,
      isTest: false,
      testOnly: true,
    });
    expect(launchGateVerdict("f@test.the120.invalid", {})).toEqual({
      allowed: true,
      isTest: true,
      testOnly: true,
    });
  });

  it("keeps the gate closed for a typo'd flag value (fail-closed)", () => {
    // Only an explicit off/false/0 lifts it; anything else means ON.
    expect(launchGateVerdict("dana@example.com", { FP_SIGNUP_TEST_ONLY: "yes" }).allowed).toBe(false);
    expect(launchGateVerdict("dana@example.com", { FP_SIGNUP_TEST_ONLY: "" }).allowed).toBe(false);
  });

  it("lifts the gate on off/false/0 but still tags test families", () => {
    for (const off of ["off", "false", "0", "OFF"]) {
      const v = launchGateVerdict("dana@example.com", { FP_SIGNUP_TEST_ONLY: off });
      expect(v.allowed).toBe(true);
      expect(v.isTest).toBe(false);
      const t = launchGateVerdict("f@test.the120.invalid", { FP_SIGNUP_TEST_ONLY: off });
      expect(t.allowed).toBe(true);
      expect(t.isTest).toBe(true);
    }
  });
});

/* --------------------------------------------------------- refusal shaping */

describe("shapeSignupRefusal", () => {
  const reasons: SignupRefusalReason[] = ["malformed_request", "gate_refused", "rate_limited", "outage"];

  it("produces one byte-identical 401 body for every reason (no oracle)", () => {
    const first = shapeSignupRefusal(reasons[0]);
    expect(first.status).toBe(401);
    for (const reason of reasons) {
      const shaped = shapeSignupRefusal(reason);
      expect(shaped.status).toBe(401);
      expect(shaped.body).toBe(first.body);
    }
  });

  it("never leaks the gate, rate limiting, or test-family status in the body", () => {
    const body = shapeSignupRefusal("gate_refused").body.toLowerCase();
    expect(body).not.toContain("gate");
    expect(body).not.toContain("test");
    expect(body).not.toContain("rate");
    expect(body).not.toContain("limit");
    expect(body).not.toContain("allow");
  });
});

/* ----------------------------------------------------------- origin checks */

describe("origin allowlist (reused from login-rules)", () => {
  it("allows the production, dev, and preview origins exactly", () => {
    const allowed = buildAllowedOrigins("https://fp-git-feat-team.vercel.app");
    for (const origin of [
      "https://firstprofit.school",
      "http://localhost:5173",
      "http://localhost:3000",
      "https://fp-git-feat-team.vercel.app",
    ]) {
      expect(checkOrigin(origin, allowed)).toEqual({ ok: true, origin });
    }
  });

  it("refuses disallowed and missing origins (403)", () => {
    const allowed = buildAllowedOrigins(undefined);
    for (const origin of ["https://evil.example", "http://firstprofit.school", null, ""]) {
      expect(checkOrigin(origin, allowed)).toEqual({ ok: false, status: 403 });
    }
  });
});

/* ---------------------------------------------------------- rate-limit keys */

describe("rate-limit keys", () => {
  it("derives an (ip,email) bucket plus an ip aggregate in the fp-signup namespace", () => {
    const keys = deriveSignupRateLimitKeys("203.0.113.9", "Dana@example.com");
    expect(keys.emailKey).toContain("203.0.113.9");
    expect(keys.emailKey).toContain("dana%40example.com"); // normalized + encoded
    expect(keys.ipKey).not.toContain("example.com");
    expect(keys.emailKey.startsWith("fp-signup:")).toBe(true);
    expect(keys.ipKey.startsWith("fp-signup-ip:")).toBe(true);
  });

  it("keeps start and verify buckets in separate namespaces", () => {
    const s = deriveSignupRateLimitKeys("1.2.3.4", "a@b.com");
    const v = deriveVerifyRateLimitKeys("1.2.3.4", "a@b.com");
    expect(s.emailKey).not.toBe(v.emailKey);
    expect(s.ipKey).not.toBe(v.ipKey);
    expect(v.emailKey.startsWith("fp-signup-verify:")).toBe(true);
  });

  it("is injective when ip or email contains a colon (IPv6 / delimiter safety)", () => {
    expect(deriveSignupRateLimitKeys("2001:db8", ":x@e.com").emailKey).not.toBe(
      deriveSignupRateLimitKeys("2001:db8:", "x@e.com").emailKey
    );
  });
});
