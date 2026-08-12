/**
 * Pure-rule pins for /api/fp/parent-login (fpv04 Unit 3): the fail-closed
 * launch gate + founder-scoped test path, the byte-identical refusal, the
 * FpParentSessionBody key pins (the shape the fpv04 SPA's twin test mirrors),
 * and the rate-limit key derivation's delimiter discipline.
 */

import { describe, expect, it } from "vitest";
import {
  deriveParentLoginRateLimitKeys,
  FP_PARENT_LOGIN_REFUSAL_BODY,
  FP_PARENT_SESSION_BODY_KEYS,
  FP_PARENT_SESSION_PARENT_KEYS,
  isParentLoginLive,
  parentLoginGateVerdict,
  parseParentLoginRequest,
  shapeParentLoginRefusal,
  type FpParentSessionBody,
  type ParentLoginRefusalReason,
} from "../parent-login-rules";
import { FP_SIGN_IN_REFUSAL_BODY } from "../../login/login-rules";

describe("parseParentLoginRequest", () => {
  it("accepts a bounded email+password pair", () => {
    const parsed = parseParentLoginRequest({ email: "p@example.com", password: "pw" });
    expect(parsed).toEqual({ ok: true, email: "p@example.com", password: "pw" });
  });

  it("refuses non-email identifiers, missing fields, and unknown keys (strict)", () => {
    expect(parseParentLoginRequest({ email: "not-an-email", password: "pw" })).toEqual({ ok: false });
    expect(parseParentLoginRequest({ email: "p@example.com" })).toEqual({ ok: false });
    expect(parseParentLoginRequest({ password: "pw" })).toEqual({ ok: false });
    expect(
      parseParentLoginRequest({ email: "p@example.com", password: "pw", extra: 1 })
    ).toEqual({ ok: false });
    expect(parseParentLoginRequest(null)).toEqual({ ok: false });
    expect(parseParentLoginRequest({ email: "p@example.com", password: "" })).toEqual({ ok: false });
  });
});

describe("isParentLoginLive — affirmative-only, fail-closed", () => {
  it("accepts exactly 1/true/on after trim+lowercase", () => {
    for (const v of ["1", "true", "on", " TRUE ", "On"]) {
      expect(isParentLoginLive(v)).toBe(true);
    }
  });
  it("everything else is OFF — unset, empty, 0, false, off, typos", () => {
    for (const v of [undefined, null, "", "0", "false", "off", "yes", "live", "tru e"]) {
      expect(isParentLoginLive(v)).toBe(false);
    }
  });
});

describe("parentLoginGateVerdict — fail-closed with the founder-scoped test path", () => {
  it("gate OFF (unset): a plain caller is refused even with valid identity", () => {
    const v = parentLoginGateVerdict("parent@example.com", {});
    expect(v).toEqual({ allowed: false, live: false, isTest: false });
  });

  it("gate OFF: the founder allowlist identity passes (comma-separated, normalized)", () => {
    const v = parentLoginGateVerdict("Founder@Example.com", {
      FP_SIGNUP_TEST_ALLOWLIST: " other@x.test , founder@example.com ",
    });
    expect(v).toEqual({ allowed: true, live: false, isTest: true });
  });

  it("gate OFF: the guarded @test.the120.invalid domain passes as is_test", () => {
    const v = parentLoginGateVerdict("fam@test.the120.invalid", {});
    expect(v).toEqual({ allowed: true, live: false, isTest: true });
  });

  it("gate ON: everyone passes; test identities stay tagged", () => {
    expect(parentLoginGateVerdict("parent@example.com", { FP_PARENT_LOGIN_LIVE: "1" })).toEqual({
      allowed: true,
      live: true,
      isTest: false,
    });
  });
});

describe("refusal shaping — one byte-identical body, this door's OWN bytes", () => {
  it("every reason produces the same 401 body", () => {
    const reasons: ParentLoginRefusalReason[] = [
      "malformed_request",
      "gate_refused",
      "bad_credentials",
      "not_parent",
      "rate_limited",
      "outage",
    ];
    const shaped = reasons.map((r) => shapeParentLoginRefusal(r));
    for (const s of shaped) {
      expect(s.status).toBe(401);
      expect(s.body).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
    }
  });

  it("is deliberately NOT the child door's refusal body (separate contracts)", () => {
    expect(FP_PARENT_LOGIN_REFUSAL_BODY).not.toBe(FP_SIGN_IN_REFUSAL_BODY);
    // Same DISCIPLINE though: parseable, success:false, one error string.
    const parsed = JSON.parse(FP_PARENT_LOGIN_REFUSAL_BODY);
    expect(parsed.success).toBe(false);
    expect(typeof parsed.error).toBe("string");
  });
});

describe("FpParentSessionBody — the pinned parent-session contract", () => {
  it("the key lists derive from the type and pin the shipped shape", () => {
    expect(FP_PARENT_SESSION_BODY_KEYS).toEqual(["access_token", "refresh_token", "parent"]);
    expect(FP_PARENT_SESSION_PARENT_KEYS).toEqual(["email", "firstName"]);
  });

  it("a literal body satisfies the type (compile-level pin)", () => {
    const body: FpParentSessionBody = {
      access_token: "a",
      refresh_token: "r",
      parent: { email: "p@example.com", firstName: null },
    };
    expect(Object.keys(body)).toEqual([...FP_PARENT_SESSION_BODY_KEYS]);
    expect(Object.keys(body.parent)).toEqual([...FP_PARENT_SESSION_PARENT_KEYS]);
  });
});

describe("deriveParentLoginRateLimitKeys", () => {
  it("own namespaces, both segments percent-encoded (IPv6 colons cannot alias)", () => {
    const { emailKey, ipKey } = deriveParentLoginRateLimitKeys("2001:db8::1", "P@Example.com ");
    expect(emailKey).toBe("fp-parent-login:2001%3Adb8%3A%3A1:p%40example.com");
    expect(ipKey).toBe("fp-parent-login-ip:2001%3Adb8%3A%3A1");
  });
});
