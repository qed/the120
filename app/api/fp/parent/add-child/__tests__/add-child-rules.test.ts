import { describe, expect, it } from "vitest";

import { FP_PARENT_LOGIN_REFUSAL_BODY } from "@/app/api/fp/parent-login/parent-login-rules";
import { PARENT_ROSTER_RATE_LIMIT } from "../../roster/roster-rules";
import { PARENT_RESET_RATE_LIMIT } from "../../reset-password/reset-password-rules";
import {
  deriveParentAddChildRateLimitKeys,
  normalizeParentEmail,
  shapeParentAddChildRefusal,
  PARENT_ADD_CHILD_BODY,
  PARENT_ADD_CHILD_BODY_KEYS,
  PARENT_ADD_CHILD_IP_RATE_LIMIT,
  PARENT_ADD_CHILD_RATE_LIMIT,
  PARENT_ADD_CHILD_REFUSAL_BODY,
  PARENT_ADD_CHILD_READ_TIMEOUT_MS,
  PARENT_ADD_CHILD_TOTAL_BUDGET_MS,
  type ParentAddChildRefusalReason,
} from "../add-child-rules";

/** Every refusal the route can produce — kept exhaustive by the type. */
const ALL_REASONS: readonly ParentAddChildRefusalReason[] = [
  "missing_token",
  "invalid_token",
  "not_parent",
  "no_parent_email",
  "rate_limited",
  "outage",
];

describe("add-child-rules — the pure decisions behind POST /api/fp/parent/add-child", () => {
  describe("the success body", () => {
    it("is a bare acknowledgement — no attempt id, no parent, no children", () => {
      expect(JSON.parse(PARENT_ADD_CHILD_BODY)).toEqual({ ok: true });
      expect(PARENT_ADD_CHILD_BODY_KEYS).toEqual(["ok"]);
    });
  });

  describe("one refusal, byte-identical", () => {
    it("every reason produces the SAME status and the SAME bytes", () => {
      const shaped = ALL_REASONS.map((r) => shapeParentAddChildRefusal(r));
      for (const s of shaped) {
        expect(s.status).toBe(401);
        expect(s.body).toBe(shaped[0]!.body);
      }
    });

    it("reuses its siblings' bytes exactly — one voice across the parent doors", () => {
      // A different body here would let a probe distinguish this URL from
      // parent-login / roster / reset-password.
      expect(PARENT_ADD_CHILD_REFUSAL_BODY).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
    });
  });

  describe("rate limiting", () => {
    it("is PINNED — retuning either budget must be a deliberate edit", () => {
      expect(PARENT_ADD_CHILD_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 10 });
      expect(PARENT_ADD_CHILD_IP_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 20 });
      // The per-IP aggregate is DOUBLE the per-parent one: two parents on one
      // household NAT both fit, a scripted caller does not.
      expect(PARENT_ADD_CHILD_IP_RATE_LIMIT.limit).toBe(
        PARENT_ADD_CHILD_RATE_LIMIT.limit * 2
      );
    });

    it("is at the family cap, so the limiter never blocks a legitimate roster fill", () => {
      // 10 === MAX_CHILDREN_PER_FAMILY (app/api/fp/signup/child-core.ts). One
      // more call than this is refused by the mint's own cap anyway.
      expect(PARENT_ADD_CHILD_RATE_LIMIT.limit).toBe(10);
    });

    it("is tighter than the READ door and looser than nothing else it shares with", () => {
      // The roster door READS; this one WRITES A ROW on every call.
      expect(PARENT_ADD_CHILD_RATE_LIMIT.limit).toBeLessThan(PARENT_ROSTER_RATE_LIMIT.limit);
      expect(PARENT_ADD_CHILD_RATE_LIMIT.limit).toBeLessThan(PARENT_RESET_RATE_LIMIT.limit);
    });

    it("uses its OWN namespaces — never the login, roster or reset buckets", () => {
      const { userKey, ipKey } = deriveParentAddChildRateLimitKeys("1.2.3.4", "user-1");
      expect(userKey).toBe("fp-parent-add-child:1.2.3.4:user-1");
      expect(ipKey).toBe("fp-parent-add-child-ip:1.2.3.4");
    });

    it("escapes BOTH segments, so no two (ip,user) pairs can alias onto one bucket", () => {
      // (ip='2001:db8', user=':x') and (ip='2001:db8:', user='x') are distinct.
      const a = deriveParentAddChildRateLimitKeys("2001:db8", ":x").userKey;
      const b = deriveParentAddChildRateLimitKeys("2001:db8:", "x").userKey;
      expect(a).not.toBe(b);
    });

    it("is TOTAL — a lone surrogate in a forged sub must not throw before the strike lands", () => {
      // encodeURIComponent throws on one; that would land BEFORE either bucket
      // is recorded and bypass throttling entirely.
      expect(() => deriveParentAddChildRateLimitKeys("1.2.3.4", "\uD800")).not.toThrow();
    });
  });

  describe("time budgets", () => {
    it("leaves ample headroom under the platform ceiling so OUR refusal is the last word", () => {
      expect(PARENT_ADD_CHILD_READ_TIMEOUT_MS).toBe(8_000);
      expect(PARENT_ADD_CHILD_TOTAL_BUDGET_MS).toBe(30_000);
      expect(PARENT_ADD_CHILD_READ_TIMEOUT_MS).toBeLessThan(PARENT_ADD_CHILD_TOTAL_BUDGET_MS);
    });
  });

  describe("normalizeParentEmail", () => {
    it("matches signup-core's normalization exactly", () => {
      expect(normalizeParentEmail("  Robin@Example.COM ")).toBe("robin@example.com");
    });

    it("refuses anything that is not a usable address rather than writing a blank", () => {
      for (const bad of [null, undefined, 42, "", "   ", "no-at-sign"]) {
        expect(normalizeParentEmail(bad)).toBeNull();
      }
    });
  });
});
