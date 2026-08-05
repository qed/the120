import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE SERVER ACTION WRAPPER LAYER (v3 Unit 8 review, FIX 2).
 *
 * `kid-credentials-core.test.ts` calls the cores directly, which leaves the
 * three things that exist ONLY in the wrapper untested: session resolution,
 * rate-limit KEYING, and THE REFUND RULE. That last one is the dangerous gap —
 * the actions' own docblock cites the refunded-strike-refunds-the-attacker
 * learning, and if someone refunded on `not_owned`, probing another family's
 * child ids would become free with a completely green suite.
 *
 * So this file asserts the wrapper's decisions, mostly as NEGATIVES:
 *   (a) `outage` — our fault — RELEASES the strike;
 *   (b) `not_owned` / `weak_password` / `stale_policy` / `bad_request` do NOT;
 *   (c) a caller with no session reaches NEITHER the rate limiter NOR the core;
 *   (d) the three actions carry DISTINCT rate-limit keys (review FIX 6).
 *
 * ⚠ THE ALLOWLIST IS NOT MOCKED. `refundsKidCredentialsStrike` is imported
 * through `importOriginal`, so what these tests exercise is the real predicate
 * over the real set. Only the three cores (whose outcomes we need to drive) and
 * the I/O edges are faked.
 */

const rate = vi.hoisted(() => ({
  checked: [] as string[],
  released: [] as string[],
  allowed: true,
}));
const session = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
}));
const cores = vi.hoisted(() => ({
  reset: vi.fn(),
  capture: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/app/fp/lib/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rate.checked.push(key);
    return { allowed: rate.allowed, retryAfterMs: 0 };
  },
  releaseRateLimitEvent: (key: string) => {
    rate.released.push(key);
  },
}));

vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: session.user }, error: null }) },
  }),
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => {
    throw new Error("no privileged client may be constructed in these tests");
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.7" }),
}));

vi.mock("@/app/lib/v3-signup/kid-credentials-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../kid-credentials-core")>();
  return {
    ...actual,
    resetKidPassword: cores.reset,
    captureLegacyChildConsent: cores.capture,
    revokeChildPhotoConsent: cores.revoke,
  };
});

import {
  captureChildConsentAction,
  resetKidPasswordAction,
  revokeChildConsentAction,
} from "@/app/lib/v3-signup/actions/kid-credentials";
import {
  KID_CREDENTIALS_OUTCOMES,
  KID_CREDENTIALS_REFUNDED_OUTCOMES,
  refundsKidCredentialsStrike,
} from "@/app/lib/v3-signup/kid-credentials-core";
import {
  deriveV3KidResetRateLimitKey,
  type V3KidActionScope,
} from "@/app/lib/v3-signup/v3-signup-rules";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";

const PARENT = "parent-1";

const goodConsentBody = () => ({
  childId: "kid-1",
  consentVersion: FP_CONSENT_POLICY.version,
  consentHash: currentPolicyHash(),
  childAgeBand: "under_13" as const,
});

beforeEach(() => {
  rate.checked = [];
  rate.released = [];
  rate.allowed = true;
  session.user = { id: PARENT, email: "parent@example.com" };
  cores.reset.mockReset();
  cores.capture.mockReset();
  cores.revoke.mockReset();
});

/* ───────────────────────── the refund rule, by execution ───────────────────────── */

describe("the refunded-strike allowlist (FIX 3) is the whole rule", () => {
  it("the SET is exactly ['outage'] — asserted as a set, not sampled", () => {
    expect([...KID_CREDENTIALS_REFUNDED_OUTCOMES]).toEqual(["outage"]);
  });

  it("every OTHER outcome the cores can return is non-refundable BY DEFAULT", () => {
    // The complement, swept. A new outcome added to the union without being
    // added to the allowlist keeps its strike, which is the safe direction —
    // and a new outcome added to neither list reddens the totality check below.
    for (const outcome of KID_CREDENTIALS_OUTCOMES) {
      expect(refundsKidCredentialsStrike(outcome), outcome).toBe(outcome === "outage");
    }
    expect(KID_CREDENTIALS_OUTCOMES).toContain("not_owned");
    expect(KID_CREDENTIALS_OUTCOMES).toContain("weak_password");
    expect(KID_CREDENTIALS_OUTCOMES).toContain("stale_policy");
    expect(KID_CREDENTIALS_OUTCOMES).toContain("bad_request");
  });
});

describe("resetKidPasswordAction — the wrapper's refund decisions", () => {
  it("`outage` (our fault) RELEASES the strike", async () => {
    cores.reset.mockResolvedValue("outage");
    const res = await resetKidPasswordAction({ childId: "kid-1", password: "correct horse" });
    expect(res.ok).toBe(false);
    expect(rate.released).toEqual([deriveV3KidResetRateLimitKey(PARENT, "password")]);
  });

  it("`not_owned` KEEPS the strike — refunding it would make probing free", async () => {
    // THE finding this file exists for. A foreign-child probe is a real
    // attempt; handing the strike back turns the rate limit into decoration.
    cores.reset.mockResolvedValue("not_owned");
    const res = await resetKidPasswordAction({ childId: "someone-elses-kid", password: "x".repeat(12) });
    expect(res.ok).toBe(false);
    expect(rate.released).toEqual([]);
  });

  it("`weak_password`, `bad_request` and `no_fp_account` all KEEP the strike", async () => {
    for (const outcome of ["weak_password", "bad_request", "no_fp_account"] as const) {
      rate.released = [];
      cores.reset.mockResolvedValue(outcome);
      const res = await resetKidPasswordAction({ childId: "kid-1", password: "abc" });
      expect(res.ok, outcome).toBe(false);
      expect(rate.released, outcome).toEqual([]);
    }
  });

  it("`weak_password` is the ONE refusal carrying a specific, correctable message", async () => {
    cores.reset.mockResolvedValue("weak_password");
    const res = await resetKidPasswordAction({ childId: "kid-1", password: "abc" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    // The generic refusal would be useless on a field the parent just typed.
    expect(res.message).not.toContain("Refresh the page");
  });

  it("`reset` succeeds and refunds nothing — a spent budget is the point", async () => {
    cores.reset.mockResolvedValue("reset");
    expect(await resetKidPasswordAction({ childId: "kid-1", password: "x".repeat(12) })).toEqual({
      ok: true,
    });
    expect(rate.released).toEqual([]);
  });
});

describe("captureChildConsentAction / revokeChildConsentAction — same rule", () => {
  it("`outage` releases; `stale_policy`, `not_owned` and `bad_request` do not", async () => {
    for (const [outcome, releases] of [
      ["outage", true],
      ["stale_policy", false],
      ["not_owned", false],
      ["bad_request", false],
    ] as const) {
      rate.released = [];
      cores.capture.mockResolvedValue(outcome);
      const res = await captureChildConsentAction(goodConsentBody());
      expect(res.ok, outcome).toBe(false);
      expect(rate.released.length > 0, outcome).toBe(releases);
    }
  });

  it("revocation: `outage` releases, `not_owned` and `bad_request` do not", async () => {
    for (const [outcome, releases] of [
      ["outage", true],
      ["not_owned", false],
      ["bad_request", false],
    ] as const) {
      rate.released = [];
      cores.revoke.mockResolvedValue(outcome);
      const res = await revokeChildConsentAction({ childId: "kid-1" });
      expect(res.ok, outcome).toBe(false);
      expect(rate.released.length > 0, outcome).toBe(releases);
    }
  });

  it("a malformed consent body is refused by the WRAPPER, before the core or a client", async () => {
    for (const bad of [
      {},
      { ...goodConsentBody(), childId: 7 },
      { ...goodConsentBody(), childAgeBand: "toddler" },
      { ...goodConsentBody(), consentHash: 12 },
      null,
    ]) {
      cores.capture.mockReset();
      const res = await captureChildConsentAction(bad);
      expect(res.ok).toBe(false);
      expect(cores.capture).not.toHaveBeenCalled();
    }
  });
});

/* ─────────────────────────── no session, no anything ─────────────────────────── */

describe("a caller with NO SESSION is refused before everything else", () => {
  it("reaches neither the rate limiter nor the core — asserted as negatives", async () => {
    session.user = null;
    for (const call of [
      () => resetKidPasswordAction({ childId: "kid-1", password: "x".repeat(12) }),
      () => captureChildConsentAction(goodConsentBody()),
      () => revokeChildConsentAction({ childId: "kid-1" }),
    ]) {
      const res = await call();
      expect(res.ok).toBe(false);
    }
    // No strike recorded (so an unauthenticated flood cannot exhaust a real
    // parent's budget), no strike released, and no core invoked.
    expect(rate.checked).toEqual([]);
    expect(rate.released).toEqual([]);
    expect(cores.reset).not.toHaveBeenCalled();
    expect(cores.capture).not.toHaveBeenCalled();
    expect(cores.revoke).not.toHaveBeenCalled();
  });

  it("a session with no id is the same as no session", async () => {
    session.user = { id: "" };
    expect((await revokeChildConsentAction({ childId: "kid-1" })).ok).toBe(false);
    expect(rate.checked).toEqual([]);
    expect(cores.revoke).not.toHaveBeenCalled();
  });
});

/* ───────────────────────────── the keying (FIX 6) ───────────────────────────── */

describe("rate-limit keying", () => {
  it("keys on the SESSION parent id — never anything from the request body", async () => {
    cores.reset.mockResolvedValue("reset");
    await resetKidPasswordAction({
      childId: "kid-1",
      password: "x".repeat(12),
      // A hostile body naming another parent must not move the bucket.
      parentId: "someone-else",
    });
    expect(rate.checked).toEqual([deriveV3KidResetRateLimitKey(PARENT, "password")]);
    expect(rate.checked[0]).not.toContain("someone-else");
  });

  it("the three actions use THREE DIFFERENT buckets (FIX 6)", async () => {
    // Sharing one bucket meant looping the password reset also exhausted the
    // withdraw-consent button. A parent exercising a privacy right must not be
    // refused because of unrelated activity on their own account.
    cores.reset.mockResolvedValue("reset");
    cores.capture.mockResolvedValue("recorded");
    cores.revoke.mockResolvedValue("revoked");
    await resetKidPasswordAction({ childId: "kid-1", password: "x".repeat(12) });
    await captureChildConsentAction(goodConsentBody());
    await revokeChildConsentAction({ childId: "kid-1" });
    expect(rate.checked).toEqual([
      deriveV3KidResetRateLimitKey(PARENT, "password"),
      deriveV3KidResetRateLimitKey(PARENT, "consent"),
      deriveV3KidResetRateLimitKey(PARENT, "revoke"),
    ]);
    expect(new Set(rate.checked).size).toBe(3);
  });

  it("every scope encodes the parent id (delimiter collisions cannot merge buckets)", () => {
    const scopes: V3KidActionScope[] = ["password", "consent", "revoke", "set-parent-password"];
    const keys = scopes.map((s) => deriveV3KidResetRateLimitKey("a:b c", s));
    expect(new Set(keys).size).toBe(scopes.length);
    for (const k of keys) expect(k).toContain(encodeURIComponent("a:b c"));
  });

  it("a DENIED bucket refuses before the core runs", async () => {
    rate.allowed = false;
    expect((await resetKidPasswordAction({ childId: "kid-1", password: "x".repeat(12) })).ok).toBe(
      false
    );
    expect(cores.reset).not.toHaveBeenCalled();
    expect(rate.released).toEqual([]);
  });
});

/* ────────────────────── the identity handed to the core ────────────────────── */

describe("what the wrapper hands the core", () => {
  it("passes the SESSION parent id as ctx, and the raw input untouched", async () => {
    cores.reset.mockResolvedValue("reset");
    const input = { childId: "kid-1", password: "x".repeat(12) };
    await resetKidPasswordAction(input);
    expect(cores.reset).toHaveBeenCalledTimes(1);
    expect(cores.reset.mock.calls[0][1]).toBe(input);
    expect(cores.reset.mock.calls[0][2]).toEqual({ parentId: PARENT });
  });

  it("consent capture takes its identity snapshot from the SESSION, never the body", async () => {
    cores.capture.mockResolvedValue("recorded");
    await captureChildConsentAction({
      ...goodConsentBody(),
      parentEmail: "attacker@example.com",
    });
    const passed = cores.capture.mock.calls[0][1] as { parentEmail: string; ua: string };
    expect(passed.parentEmail).toBe("parent@example.com");
    expect(passed.ua).toBe("vitest");
    expect(cores.capture.mock.calls[0][2]).toEqual({ parentId: PARENT });
  });

  it("a THROWN core is caught and answered with the uniform refusal", async () => {
    cores.revoke.mockRejectedValue(new Error("boom"));
    expect(await revokeChildConsentAction({ childId: "kid-1" })).toMatchObject({ ok: false });
  });
});
