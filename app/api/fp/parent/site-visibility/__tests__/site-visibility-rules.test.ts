import { describe, expect, it } from "vitest";

import {
  deriveSiteVisibilityRateLimitKeys,
  parseSiteVisibilityRequest,
  refundsSiteVisibilityStrike,
  shapeSiteVisibilityRefusal,
  SITE_VISIBILITY_IP_RATE_LIMIT,
  SITE_VISIBILITY_OK_BODY,
  SITE_VISIBILITY_OK_KEYS,
  SITE_VISIBILITY_RATE_LIMIT,
  SITE_VISIBILITY_READ_TIMEOUT_MS,
  SITE_VISIBILITY_REFUNDED_REFUSALS,
  SITE_VISIBILITY_REFUSAL_BODY,
  SITE_VISIBILITY_REFUSALS,
  SITE_VISIBILITY_TOTAL_BUDGET_MS,
  type SiteVisibilityRefusalReason,
} from "../site-visibility-rules";
import { FP_PARENT_LOGIN_REFUSAL_BODY } from "@/app/api/fp/parent-login/parent-login-rules";

describe("parseSiteVisibilityRequest — strict, and no boolean coercion", () => {
  it("accepts exactly {childId, published}", () => {
    expect(parseSiteVisibilityRequest({ childId: "ccccccc1-0000-4000-8000-000000000001", published: false })).toEqual({
      ok: true,
      childId: "ccccccc1-0000-4000-8000-000000000001",
      published: false,
    });
    expect(parseSiteVisibilityRequest({ childId: "ccccccc1-0000-4000-8000-000000000001", published: true })).toEqual({
      ok: true,
      childId: "ccccccc1-0000-4000-8000-000000000001",
      published: true,
    });
  });

  it("REFUSES a caller-supplied handle rather than ignoring it", () => {
    // The core addresses the page by a `profile_id` DERIVED from the authorized
    // child. A caller that believes it named the page must never be told "ok"
    // while the server acted on a different one.
    expect(
      parseSiteVisibilityRequest({ childId: "ccccccc1-0000-4000-8000-000000000001", published: false, handle: "someone-else" })
    ).toEqual({ ok: false });
  });

  it("refuses a truthy non-boolean — this switch decides who can see a child's work", () => {
    for (const published of ["true", 1, 0, null, "false"]) {
      expect(parseSiteVisibilityRequest({ childId: "ccccccc1-0000-4000-8000-000000000001", published })).toEqual({ ok: false });
    }
  });

  it("refuses everything else", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "offline",
      [],
      {},
      { childId: "ccccccc1-0000-4000-8000-000000000001" },
      { published: true },
      { childId: "", published: true },
      { childId: 7, published: true },
      { childId: "x".repeat(101), published: true },
    ];
    for (const body of bad) {
      expect(parseSiteVisibilityRequest(body), JSON.stringify(body ?? null)).toEqual({
        ok: false,
      });
    }
  });
});

describe("shapeSiteVisibilityRefusal — one voice", () => {
  it("is byte-identical for EVERY reason", () => {
    const reasons: SiteVisibilityRefusalReason[] = [
      "missing_token",
      "invalid_token",
      "malformed_request",
      "not_parent",
      "rate_limited",
      "core_refused",
      "outage",
    ];
    const shaped = reasons.map((r) => shapeSiteVisibilityRefusal(r));
    for (const s of shaped) expect(s).toEqual(shaped[0]);
    expect(shaped[0]!.status).toBe(401);
  });

  it("speaks the SAME bytes as parent-login", () => {
    expect(SITE_VISIBILITY_REFUSAL_BODY).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
  });
});

describe("the wire shape — twin-pinned key list", () => {
  it("pins the 200 body exactly", () => {
    expect(SITE_VISIBILITY_OK_KEYS).toEqual(["ok"]);
    expect(JSON.parse(SITE_VISIBILITY_OK_BODY)).toEqual({ ok: true });
  });
});

describe("the refunded-strike allowlist", () => {
  it("is EXACTLY {outage} — asserted as a whole set", () => {
    expect([...SITE_VISIBILITY_REFUNDED_REFUSALS]).toEqual(["outage"]);
  });

  it("every OTHER refusal defaults to NOT refundable", () => {
    // A refunded `forbidden` would make probing another family's child ids free
    // (the refunded-strike-refunds-the-attacker learning, 2026-08-05).
    for (const reason of SITE_VISIBILITY_REFUSALS) {
      expect(refundsSiteVisibilityStrike(reason), reason).toBe(reason === "outage");
    }
  });
});

describe("rate limiting — its OWN namespaces and budgets", () => {
  it("pins both budgets, so a retune is a deliberate edit", () => {
    expect(SITE_VISIBILITY_RATE_LIMIT).toEqual({ windowMs: 900_000, limit: 20 });
    expect(SITE_VISIBILITY_IP_RATE_LIMIT).toEqual({ windowMs: 900_000, limit: 40 });
  });

  it("namespaces are this door's alone — taking a page offline must never queue behind a reset", () => {
    const { userKey, ipKey } = deriveSiteVisibilityRateLimitKeys("1.2.3.4", "sub-1");
    expect(userKey.startsWith("fp-parent-site-visibility:")).toBe(true);
    expect(ipKey).toBe("fp-parent-site-visibility-ip:1.2.3.4");
    expect(userKey).not.toContain("fp-parent-reset");
    expect(userKey).not.toContain("fp-parent-photo-consent");
  });

  it("escapes BOTH segments, so two (ip,user) pairs can never alias onto one bucket", () => {
    expect(deriveSiteVisibilityRateLimitKeys("a:b", "c").userKey).not.toBe(
      deriveSiteVisibilityRateLimitKeys("a", "b:c").userKey
    );
  });

  it("is TOTAL on a lone surrogate — a throw here would land before either strike", () => {
    expect(() => deriveSiteVisibilityRateLimitKeys("1.2.3.4", "\uD800")).not.toThrow();
  });
});

describe("time budgets", () => {
  it("nests one round trip inside the invocation budget, inside maxDuration", () => {
    expect(SITE_VISIBILITY_READ_TIMEOUT_MS).toBeLessThan(SITE_VISIBILITY_TOTAL_BUDGET_MS);
    expect(SITE_VISIBILITY_TOTAL_BUDGET_MS).toBeLessThan(60_000);
  });
});
