import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE REAL CONTROL: `requireConsentClear` inside the consequential Server
 * Actions (founder, 2026-08-10).
 *
 * The four `/dashboard` redirects are a routing courtesy. A Server Action is a
 * separately-addressable POST endpoint and no page render stands in front of it
 * (the page-vs-action gating learning, 2026-08-05), so THIS is where a walled
 * parent is actually refused. Every assertion below is a NEGATIVE: the core did
 * not run.
 *
 * The deliberate omission — `revokeChildConsentAction` — is asserted just as
 * hard as the inclusions, because an exemption nobody pinned is an exemption
 * somebody will "fix" later. See that action's docblock for the reasoning.
 */

const wall = vi.hoisted(() => ({
  clear: true,
  /** The read itself failed. `requireConsentClear` reads this as clear; the two
   *  fail-CLOSED callers must not (review P2-a). */
  errored: false,
  calls: [] as string[],
}));
const rate = vi.hoisted(() => ({ checked: [] as string[], released: [] as string[] }));
const session = vi.hoisted(() => ({ user: null as { id: string; email?: string } | null }));
const cores = vi.hoisted(() => ({
  reset: vi.fn(),
  capture: vi.fn(),
  revoke: vi.fn(),
  siteToggle: vi.fn(),
}));

vi.mock("@/app/lib/funnel/consent-wall-core", () => ({
  requireConsentClear: async (parentId: string) => {
    wall.calls.push(parentId);
    // The real one fails OPEN on an error, and so does this.
    return wall.errored ? true : wall.clear;
  },
  consentClearance: async (parentId: string) => {
    wall.calls.push(parentId);
    if (wall.errored) return "error";
    return wall.clear ? "clear" : "owes";
  },
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rate.checked.push(key);
    return { allowed: true, retryAfterMs: 0 };
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
  const actual = await importOriginal<typeof import("../v3-signup/kid-credentials-core")>();
  return {
    ...actual,
    resetKidPassword: cores.reset,
    captureLegacyChildConsent: cores.capture,
    revokeChildPhotoConsent: cores.revoke,
  };
});

vi.mock("@/app/lib/fp/fp-site-parent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../fp/fp-site-parent-core")>();
  return {
    ...actual,
    parentCallerFromSession: async () =>
      session.user?.id ? { parentId: session.user.id } : null,
    realParentSiteDeps: () => ({}) as never,
    setSitePublishedForParent: cores.siteToggle,
  };
});

import {
  captureChildConsentAction,
  resetKidPasswordAction,
  revokeChildConsentAction,
} from "@/app/lib/v3-signup/actions/kid-credentials";
import { setFpSitePublishedAction } from "@/app/lib/fp/actions/fp-site-parent";
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
  wall.clear = true;
  wall.errored = false;
  wall.calls = [];
  rate.checked = [];
  rate.released = [];
  session.user = { id: PARENT, email: "parent@example.com" };
  cores.reset.mockReset().mockResolvedValue("reset");
  cores.capture.mockReset().mockResolvedValue("recorded");
  cores.revoke.mockReset().mockResolvedValue("revoked");
  cores.siteToggle.mockReset().mockResolvedValue({ ok: true, site: { id: "s1" } });
});

describe("resetKidPasswordAction", () => {
  it("REFUSES when the parent owes a consent decision, and the core never runs", async () => {
    wall.clear = false;
    const res = await resetKidPasswordAction({ childId: "kid-1", password: "x".repeat(12) });
    expect(res.ok).toBe(false);
    expect(cores.reset).not.toHaveBeenCalled();
  });

  it("proceeds when clear", async () => {
    expect(await resetKidPasswordAction({ childId: "kid-1", password: "x".repeat(12) })).toEqual({
      ok: true,
    });
    expect(cores.reset).toHaveBeenCalledTimes(1);
  });

  it("asks about the SESSION-derived parent id, never anything from the body", async () => {
    await resetKidPasswordAction({ childId: "kid-1", parentId: "someone-else", password: "x".repeat(12) });
    expect(wall.calls).toEqual([PARENT]);
  });

  it("a caller with NO session never reaches the wall check either", async () => {
    session.user = null;
    expect((await resetKidPasswordAction({ childId: "kid-1", password: "x".repeat(12) })).ok).toBe(
      false
    );
    expect(wall.calls).toEqual([]);
  });
});

describe("captureChildConsentAction", () => {
  it("REFUSES when the parent owes a decision, and the core never runs", async () => {
    wall.clear = false;
    expect((await captureChildConsentAction(goodConsentBody())).ok).toBe(false);
    expect(cores.capture).not.toHaveBeenCalled();
  });

  it("proceeds when clear", async () => {
    expect(await captureChildConsentAction(goodConsentBody())).toEqual({ ok: true });
    expect(cores.capture).toHaveBeenCalledTimes(1);
  });
});

describe("setFpSitePublishedAction", () => {
  it("REFUSES when the parent owes a decision — nothing reaches the open internet", async () => {
    wall.clear = false;
    const res = await setFpSitePublishedAction({ childId: "kid-1", published: true });
    expect(res.ok).toBe(false);
    expect(cores.siteToggle).not.toHaveBeenCalled();
  });

  it("proceeds when clear", async () => {
    const res = await setFpSitePublishedAction({ childId: "kid-1", published: true });
    expect(res.ok).toBe(true);
    expect(cores.siteToggle).toHaveBeenCalledTimes(1);
  });

  it("FAILS CLOSED when the consent read ERRORS — an outage must not publish a minor's page (review P2-a)", async () => {
    // Distinct from a successful read that says "clear". Every other consumer
    // of this control fails open; this one and the handoff mint do not.
    wall.errored = true;
    const res = await setFpSitePublishedAction({ childId: "kid-1", published: true });
    expect(res.ok).toBe(false);
    expect(cores.siteToggle).not.toHaveBeenCalled();
  });

  it("⚠ UNPUBLISH IS EXEMPT — a walled parent can always take the page OFFLINE (review P2-b)", async () => {
    // Same reasoning that exempts revokeChildConsentAction: withdrawal must be
    // as easy as giving, and `published: false` can only ever make us publish
    // LESS. Asserted as a NEGATIVE too — the wall is not even asked.
    wall.clear = false;
    const res = await setFpSitePublishedAction({ childId: "kid-1", published: false });
    expect(res.ok).toBe(true);
    expect(cores.siteToggle).toHaveBeenCalledTimes(1);
    expect(wall.calls).toEqual([]);
  });

  it("unpublish survives a consent-read OUTAGE too — nothing may stand between a parent and offline", async () => {
    wall.errored = true;
    const res = await setFpSitePublishedAction({ childId: "kid-1", published: false });
    expect(res.ok).toBe(true);
    expect(wall.calls).toEqual([]);
  });

  it("a malformed body is not treated as a publish, and is refused by the core's own parser", async () => {
    // The exemption keys on `published === true`, never on "not false".
    wall.clear = false;
    cores.siteToggle.mockResolvedValue({ ok: false, reason: "bad_request" });
    expect((await setFpSitePublishedAction({ childId: "kid-1" })).ok).toBe(false);
    expect(wall.calls).toEqual([]);
    expect(cores.siteToggle).toHaveBeenCalledTimes(1);
  });
});

describe("⚠ revokeChildConsentAction is DELIBERATELY EXEMPT", () => {
  it("still WITHDRAWS while the parent owes a decision — a privacy right is not hostage to a formality", async () => {
    // Refusing a withdrawal because the parent owes a DIFFERENT consent
    // decision is user-hostile and arguably unlawful (withdrawal must be as
    // easy as giving it). The blast radius is bounded to the safe direction:
    // this endpoint can only ever make us process LESS.
    wall.clear = false;
    expect(await revokeChildConsentAction({ childId: "kid-1" })).toEqual({ ok: true });
    expect(cores.revoke).toHaveBeenCalledTimes(1);
  });

  it("does not even ASK the wall — the exemption is structural, not a branch", async () => {
    wall.clear = false;
    await revokeChildConsentAction({ childId: "kid-1" });
    expect(wall.calls).toEqual([]);
  });
});
