import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE CONSENT WALL's two Server Actions — the wrapper layer.
 *
 * The cores' behaviour (idempotency, non-destructiveness) is tested by
 * execution in app/lib/__tests__/funnel-consent-wall-core.test.ts. What lives
 * ONLY here is the wrapper's own three decisions: session resolution,
 * rate-limit KEYING, and the deliberate ABSENCE of a `requireConsentClear`
 * gate — these are the only two endpoints a parent who owes a decision is
 * supposed to reach, and gating them would make the wall unanswerable.
 */

const rate = vi.hoisted(() => ({ checked: [] as string[], allowed: true }));
const session = vi.hoisted(() => ({ caller: null as { parentId: string; parentEmail: string } | null }));
const cores = vi.hoisted(() => ({ accept: vi.fn(), decline: vi.fn() }));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rate.checked.push(key);
    return { allowed: rate.allowed, retryAfterMs: 0 };
  },
  releaseRateLimitEvent: () => {},
}));

vi.mock("@/app/lib/funnel/consent-wall-core", () => ({
  consentWallCallerFromSession: async () => session.caller,
  realConsentWallDeps: () => ({ db: () => ({}), now: () => 0, log: () => {} }),
  recordConsentWallAcceptance: (...args: unknown[]) => cores.accept(...args),
  recordConsentWallDecline: (...args: unknown[]) => cores.decline(...args),
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => {
    throw new Error("no privileged client may be constructed in these tests");
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.7" }),
}));

import { acceptConsentWallAction, declineConsentWallAction } from "@/app/consent/actions";
import { deriveV3KidResetRateLimitKey } from "@/app/lib/v3-signup/v3-signup-rules";

const PARENT = "parent-1";
const KEY = deriveV3KidResetRateLimitKey(PARENT, "consent-wall");

beforeEach(() => {
  rate.checked = [];
  rate.allowed = true;
  session.caller = { parentId: PARENT, parentEmail: "parent@example.com" };
  cores.accept.mockReset().mockResolvedValue("recorded");
  cores.decline.mockReset().mockResolvedValue("recorded");
});

describe("acceptConsentWallAction", () => {
  it("records, on the SESSION's identity — the action takes no argument at all", async () => {
    expect(await acceptConsentWallAction()).toEqual({ ok: true });
    const [, , ctx] = cores.accept.mock.calls[0];
    expect(ctx).toMatchObject({ parentId: PARENT, parentEmail: "parent@example.com" });
    // The target is UNNAMEABLE: there is no parameter a caller could aim at
    // someone else's family.
    expect(acceptConsentWallAction.length).toBe(0);
  });

  it("`nothing_owed` answers OK — that is what a REPLAY of a success looks like", async () => {
    cores.accept.mockResolvedValue("nothing_owed");
    expect(await acceptConsentWallAction()).toEqual({ ok: true });
  });

  it("`outage` refuses, and says so in one generic sentence", async () => {
    cores.accept.mockResolvedValue("outage");
    const res = await acceptConsentWallAction();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.message).toContain("Refresh the page");
  });

  it("a caller with no session never reaches the rate limiter NOR the core", async () => {
    session.caller = null;
    expect((await acceptConsentWallAction()).ok).toBe(false);
    expect(rate.checked).toEqual([]);
    expect(cores.accept).not.toHaveBeenCalled();
  });

  it("carries its OWN rate-limit bucket, so the per-kid budget cannot lock the wall", async () => {
    await acceptConsentWallAction();
    expect(rate.checked).toEqual([KEY]);
    expect(KEY).not.toBe(deriveV3KidResetRateLimitKey(PARENT, "consent"));
  });

  it("a DENIED bucket refuses before the core runs", async () => {
    rate.allowed = false;
    expect((await acceptConsentWallAction()).ok).toBe(false);
    expect(cores.accept).not.toHaveBeenCalled();
  });

  it("a thrown core is caught — the wall must never 500 a parent into a dead end", async () => {
    cores.accept.mockRejectedValue(new Error("boom"));
    expect((await acceptConsentWallAction()).ok).toBe(false);
  });
});

describe("declineConsentWallAction", () => {
  it("records the refusal and answers OK", async () => {
    expect(await declineConsentWallAction()).toEqual({ ok: true });
    expect(cores.decline).toHaveBeenCalledTimes(1);
  });

  it("takes no argument either — nothing about it can be pointed at another family", async () => {
    expect(declineConsentWallAction.length).toBe(0);
  });

  it("a caller with no session reaches neither the limiter nor the core", async () => {
    session.caller = null;
    expect((await declineConsentWallAction()).ok).toBe(false);
    expect(rate.checked).toEqual([]);
    expect(cores.decline).not.toHaveBeenCalled();
  });

  it("`outage` refuses rather than claiming a refusal was logged", async () => {
    cores.decline.mockResolvedValue("outage");
    expect((await declineConsentWallAction()).ok).toBe(false);
  });
});

describe("⚠ neither wall action gates itself on requireConsentClear", () => {
  it("the module does not even import it — a self-gated wall is unanswerable", async () => {
    // The mocked consent-wall-core above exposes exactly four names, and
    // `requireConsentClear` is deliberately NOT one of them. If either action
    // ever started calling it, this module would throw on import.
    const mod = await import("@/app/consent/actions");
    expect(Object.keys(mod).sort()).toEqual([
      "acceptConsentWallAction",
      "declineConsentWallAction",
    ]);
    // And both still work with the parent in the owing state — which is the
    // ONLY state either of them is ever invoked in.
    expect((await mod.acceptConsentWallAction()).ok).toBe(true);
    expect((await mod.declineConsentWallAction()).ok).toBe(true);
  });
});
