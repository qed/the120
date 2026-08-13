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
  isParentLoginTestOnly,
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

describe("isParentLoginTestOnly — affirmative-only KILL-SWITCH (open by default)", () => {
  it("accepts exactly 1/true/on after trim+lowercase", () => {
    for (const v of ["1", "true", "on", " TRUE ", "On"]) {
      expect(isParentLoginTestOnly(v)).toBe(true);
    }
  });
  it("accepts `yes` too (the signup kill-switch spelling this mirrors)", () => {
    expect(isParentLoginTestOnly("yes")).toBe(true);
  });

  it("everything else leaves the door OPEN — unset, empty, 0, false, off, typos", () => {
    // The INVERSION that matters: a mis-spelled flag must not silently lock
    // every parent out of their own dashboard.
    for (const v of [undefined, null, "", "0", "false", "off", "live", "tru e"]) {
      expect(isParentLoginTestOnly(v)).toBe(false);
    }
  });
});

describe("parentLoginGateVerdict — PUBLIC-OPEN by default (fpv04 U6b-i)", () => {
  it("NO ENV SET: an ordinary parent passes — the dashboard cannot ship dark by accident", () => {
    const v = parentLoginGateVerdict("parent@example.com", {});
    expect(v).toEqual({ allowed: true, live: true, isTest: false });
  });

  it("kill-switch THROWN: an ordinary parent is refused", () => {
    const v = parentLoginGateVerdict("parent@example.com", {
      FP_PARENT_LOGIN_TEST_ONLY: "on",
    });
    expect(v).toEqual({ allowed: false, live: false, isTest: false });
  });

  it("kill-switch THROWN: the founder allowlist identity still passes (comma-separated, normalized)", () => {
    const v = parentLoginGateVerdict("Founder@Example.com", {
      FP_PARENT_LOGIN_TEST_ONLY: "1",
      FP_SIGNUP_TEST_ALLOWLIST: " other@x.test , founder@example.com ",
    });
    expect(v).toEqual({ allowed: true, live: false, isTest: true });
  });

  it("kill-switch THROWN: the guarded @test.the120.invalid domain passes as is_test", () => {
    const v = parentLoginGateVerdict("fam@test.the120.invalid", {
      FP_PARENT_LOGIN_TEST_ONLY: "true",
    });
    expect(v).toEqual({ allowed: true, live: false, isTest: true });
  });

  it("a TYPO in the kill-switch leaves the door open, deliberately", () => {
    expect(
      parentLoginGateVerdict("parent@example.com", { FP_PARENT_LOGIN_TEST_ONLY: "tru e" }).allowed,
    ).toBe(true);
  });

  it("the legacy FP_PARENT_LOGIN_LIVE var is no longer consulted", () => {
    // Leaving it wired would mean an unset legacy env closing the door the
    // moment someone tidied the new flag away.
    const v = parentLoginGateVerdict("parent@example.com", {
      FP_PARENT_LOGIN_LIVE: "0",
    } as never);
    expect(v.allowed).toBe(true);
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
