import { describe, expect, it } from "vitest";

import {
  deriveParentResetRateLimitKeys,
  parseParentResetRequest,
  shapeParentResetRefusal,
  PARENT_RESET_BODY_KEYS,
  PARENT_RESET_IP_RATE_LIMIT,
  PARENT_RESET_MAX_MINT_ATTEMPTS,
  PARENT_RESET_RATE_LIMIT,
  PARENT_RESET_REFUSAL_BODY,
  type ParentResetRefusalReason,
} from "../reset-password-rules";
import { FP_PARENT_LOGIN_REFUSAL_BODY } from "../../../parent-login/parent-login-rules";
import { PARENT_ROSTER_RATE_LIMIT } from "../../roster/roster-rules";
import { V3_KID_RESET_RATE_LIMIT } from "@/app/lib/fp/rate-limit-rules";
import {
  FP_MEMORABLE_PASSWORD_PATTERN,
  mintMemorablePassword,
} from "../../../signup/mint-rules";
import { validateStudentPassword } from "@/app/lib/fp/provision-rules";

/**
 * Pure coverage for the reset door's decision rules. The route test proves the
 * wiring; this file proves the DECISIONS — the refusal that cannot vary, the
 * strict body, the budget sizing, and the mint's fitness for the core's floor.
 */

describe("shapeParentResetRefusal — one voice", () => {
  it("is byte-identical for EVERY reason", () => {
    const reasons: ParentResetRefusalReason[] = [
      "missing_token",
      "invalid_token",
      "malformed_request",
      "not_parent",
      "rate_limited",
      "core_refused",
      "outage",
    ];
    for (const reason of reasons) {
      expect(shapeParentResetRefusal(reason)).toEqual({
        status: 401,
        body: PARENT_RESET_REFUSAL_BODY,
      });
    }
  });

  it("speaks the SAME bytes as the parent login and roster doors", () => {
    expect(PARENT_RESET_REFUSAL_BODY).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
  });

  it("carries no reason, no code and no field name in the body", () => {
    const body = JSON.parse(PARENT_RESET_REFUSAL_BODY) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["error", "success"]);
    expect(body.success).toBe(false);
    const text = String(body.error).toLowerCase();
    for (const leak of ["child", "parent", "password", "rate", "owner", "token"]) {
      expect(text.includes(leak), leak).toBe(false);
    }
  });
});

describe("parseParentResetRequest — childId, and nothing else", () => {
  it("accepts exactly {childId}", () => {
    expect(parseParentResetRequest({ childId: "c-1" })).toEqual({ ok: true, childId: "c-1" });
  });

  it("REFUSES a caller-supplied password rather than ignoring it", () => {
    // The strictness is the point: this door MINTS. A caller that believes it
    // set a password must never be told "ok" while the server used its own.
    expect(parseParentResetRequest({ childId: "c-1", password: "hunter2-hunter2" })).toEqual({
      ok: false,
    });
  });

  it("refuses a missing, blank, non-string or over-long childId", () => {
    for (const body of [
      {},
      null,
      "c-1",
      { childId: "" },
      { childId: 7 },
      { childId: "x".repeat(101) },
    ]) {
      expect(parseParentResetRequest(body), JSON.stringify(body)).toEqual({ ok: false });
    }
  });

  it("accepts the longest childId the CORE accepts — the two bounds agree", () => {
    // A body this schema takes must never be one the core then calls
    // bad_request on for length.
    expect(parseParentResetRequest({ childId: "x".repeat(100) }).ok).toBe(true);
  });
});

describe("the wire contract", () => {
  it("pins the four response keys", () => {
    expect(PARENT_RESET_BODY_KEYS).toEqual(["ok", "childId", "fpUsername", "password"]);
  });
});

describe("rate-limit budgets and namespaces", () => {
  it("matches the dashboard action's budget — the same journey, a different door", () => {
    expect(PARENT_RESET_RATE_LIMIT).toEqual(V3_KID_RESET_RATE_LIMIT);
  });

  it("is far TIGHTER than the roster read door: this one mutates a credential", () => {
    expect(PARENT_RESET_RATE_LIMIT.limit).toBeLessThan(PARENT_ROSTER_RATE_LIMIT.limit);
  });

  it("gives the per-IP aggregate double the per-parent budget", () => {
    expect(PARENT_RESET_IP_RATE_LIMIT.limit).toBe(PARENT_RESET_RATE_LIMIT.limit * 2);
    expect(PARENT_RESET_IP_RATE_LIMIT.windowMs).toBe(PARENT_RESET_RATE_LIMIT.windowMs);
  });

  it("uses its OWN namespaces, shared with no other door", () => {
    const { userKey, ipKey } = deriveParentResetRateLimitKeys("1.2.3.4", "sub-1");
    expect(userKey).toBe("fp-parent-reset:1.2.3.4:sub-1");
    expect(ipKey).toBe("fp-parent-reset-ip:1.2.3.4");
    for (const key of [userKey, ipKey]) {
      expect(key.startsWith("fp-parent-roster")).toBe(false);
      expect(key.startsWith("fp-parent-login")).toBe(false);
      expect(key.startsWith("fp-v3-kid-reset")).toBe(false);
    }
  });

  it("escapes BOTH segments, so no two (ip,user) pairs alias onto one bucket", () => {
    const a = deriveParentResetRateLimitKeys("::1", "x:y").userKey;
    const b = deriveParentResetRateLimitKeys("::1:x", "y").userKey;
    expect(a).not.toBe(b);
  });

  it("is TOTAL against a lone surrogate — a throw here would bypass throttling", () => {
    expect(() => deriveParentResetRateLimitKeys("1.2.3.4", "\uD800")).not.toThrow();
  });
});

describe("the mint is fit for the core's floor", () => {
  it("every minted candidate clears validateStudentPassword for an unrelated name", () => {
    // If this were false the route's bounded re-roll would be load-bearing for
    // ordinary families rather than for the rare name collision.
    for (let i = 0; i < 500; i += 1) {
      const password = mintMemorablePassword();
      expect(FP_MEMORABLE_PASSWORD_PATTERN.test(password), password).toBe(true);
      expect(
        validateStudentPassword(password, { studentName: "Zzyzx Qqqq" }).ok,
        password
      ).toBe(true);
    }
  });

  it("bounds the re-roll", () => {
    expect(PARENT_RESET_MAX_MINT_ATTEMPTS).toBeGreaterThan(1);
    expect(PARENT_RESET_MAX_MINT_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
