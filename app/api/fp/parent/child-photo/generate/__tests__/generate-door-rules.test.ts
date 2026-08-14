import { describe, expect, it } from "vitest";

import { FP_PARENT_LOGIN_REFUSAL_BODY } from "@/app/api/fp/parent-login/parent-login-rules";
import { TEST_SIGNUP_DOMAIN } from "@/app/api/fp/signup/signup-rules";
import {
  COVER_GENERATE_BODY_KEYS,
  COVER_GENERATE_IP_RATE_LIMIT,
  COVER_GENERATE_RATE_LIMIT,
  COVER_GENERATE_REFUSAL_BODY,
  COVER_SIGNED_URL_TTL_SECONDS,
  decidePlaceholderAudience,
  deriveCoverGenerateRateLimitKeys,
  FP_COVER_PROMPT,
  parseChildId,
  shapeCoverGenerateRefusal,
  type CoverGenerateRefusalReason,
} from "../generate-door-rules";

const REASONS: CoverGenerateRefusalReason[] = [
  "gate_closed",
  "missing_token",
  "invalid_token",
  "not_parent",
  "not_your_child",
  "consent_required",
  "no_photo",
  "placeholder_not_founder",
  "generation_failed",
  "rate_limited",
  "outage",
];

describe("the refusal is one answer, for every reason", () => {
  it("is byte-identical across every reason, and identical to the other parent doors", () => {
    const shaped = REASONS.map((r) => shapeCoverGenerateRefusal(r));
    for (const s of shaped) {
      expect(s.status).toBe(401);
      expect(s.body).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
    }
    expect(COVER_GENERATE_REFUSAL_BODY).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
  });

  it("carries no reason, no hint and no key names", () => {
    for (const reason of REASONS) {
      expect(shapeCoverGenerateRefusal(reason).body).not.toContain(reason);
    }
  });
});

describe("the target", () => {
  it("accepts a uuid, normalized to lowercase", () => {
    expect(parseChildId("AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA")).toBe(
      "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
    );
  });

  it.each([null, undefined, "", "  ", "not-a-uuid", "../../etc/passwd", "1;drop table"])(
    "refuses %s before it can reach a query or a key builder",
    (raw) => {
      expect(parseChildId(raw as string | null | undefined)).toBeNull();
    }
  );
});

describe("⚠⚠ the placeholder audience gate", () => {
  const env = { FP_SIGNUP_TEST_ALLOWLIST: "founder@example.com" };

  it("is a NO-OP while placeholder mode is off — every caller passes", () => {
    for (const email of ["anyone@example.com", null, undefined, ""]) {
      expect(
        decidePlaceholderAudience({ placeholderMode: false, parentEmail: email, env })
      ).toEqual({ ok: true, placeholder: false });
    }
  });

  it("⚠ LAUNCH BLOCKER: placeholder mode REFUSES an ordinary family", () => {
    // If this test ever goes green for a non-founder identity, a real parent can
    // be handed a cartoon cat as their child's cover. When the real generator is
    // wired, DELETE the placeholder rather than relaxing this gate.
    expect(
      decidePlaceholderAudience({
        placeholderMode: true,
        parentEmail: "a.real.parent@gmail.com",
        env,
      })
    ).toEqual({ ok: false, reason: "placeholder_not_founder" });
  });

  it("allows the guarded test domain and the founder allowlist, and nothing else", () => {
    expect(
      decidePlaceholderAudience({
        placeholderMode: true,
        parentEmail: `cedric${TEST_SIGNUP_DOMAIN}`,
        env,
      })
    ).toEqual({ ok: true, placeholder: true });
    expect(
      decidePlaceholderAudience({ placeholderMode: true, parentEmail: "founder@example.com", env })
    ).toEqual({ ok: true, placeholder: true });
    expect(
      decidePlaceholderAudience({
        placeholderMode: true,
        parentEmail: "founder@example.com.evil.test",
        env,
      })
    ).toEqual({ ok: false, reason: "placeholder_not_founder" });
  });

  it("FAILS CLOSED on an identity it cannot place", () => {
    for (const email of [null, undefined, "", "   "]) {
      expect(
        decidePlaceholderAudience({ placeholderMode: true, parentEmail: email, env })
      ).toEqual({ ok: false, reason: "placeholder_not_founder" });
    }
  });

  it("an EMPTY allowlist does not accidentally allow everyone", () => {
    expect(
      decidePlaceholderAudience({
        placeholderMode: true,
        parentEmail: "anyone@example.com",
        env: { FP_SIGNUP_TEST_ALLOWLIST: "" },
      })
    ).toEqual({ ok: false, reason: "placeholder_not_founder" });
  });
});

describe("the prompt", () => {
  it("⚠ carries NO PII — no name, no age, no business content placeholder", () => {
    // The likeness reaches the model as a reference image; the prompt says only
    // what kind of picture to draw. A template hole here would be the first
    // place a child's name leaked into a vendor's failure body.
    expect(FP_COVER_PROMPT).not.toMatch(/\$\{|\{\{|%s|<[a-z_]+>/);
    expect(FP_COVER_PROMPT.toLowerCase()).not.toContain("name");
  });
});

describe("the response contract", () => {
  it("pins the body keys the SPA mirrors", () => {
    expect(COVER_GENERATE_BODY_KEYS).toEqual([
      "ok",
      "coverStatus",
      "coverSequence",
      "coverUrl",
    ]);
  });

  it("hands out a SHORT-LIVED url", () => {
    expect(COVER_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
    expect(COVER_SIGNED_URL_TTL_SECONDS).toBeGreaterThan(0);
  });
});

describe("rate limiting", () => {
  it("is the TIGHTEST parent door — every allowed request can bill a vendor", () => {
    expect(COVER_GENERATE_RATE_LIMIT).toEqual({ windowMs: 60 * 60_000, limit: 3 });
    expect(COVER_GENERATE_IP_RATE_LIMIT).toEqual({ windowMs: 60 * 60_000, limit: 6 });
    expect(COVER_GENERATE_IP_RATE_LIMIT.limit).toBe(COVER_GENERATE_RATE_LIMIT.limit * 2);
  });

  it("uses its OWN namespaces, never the upload door's", () => {
    const { userKey, ipKey } = deriveCoverGenerateRateLimitKeys("1.2.3.4", "sub");
    expect(userKey.startsWith("fp-parent-cover-generate:")).toBe(true);
    expect(ipKey.startsWith("fp-parent-cover-generate-ip:")).toBe(true);
    expect(userKey).not.toContain("child-photo");
  });

  it("is TOTAL over a lone surrogate — a throw here would bypass throttling", () => {
    expect(() => deriveCoverGenerateRateLimitKeys("\uD800", "\uD800")).not.toThrow();
  });

  it("separates users on one IP, and IPs from each other", () => {
    const a = deriveCoverGenerateRateLimitKeys("1.2.3.4", "alice");
    const b = deriveCoverGenerateRateLimitKeys("1.2.3.4", "bob");
    expect(a.userKey).not.toBe(b.userKey);
    expect(a.ipKey).toBe(b.ipKey);
  });
});
