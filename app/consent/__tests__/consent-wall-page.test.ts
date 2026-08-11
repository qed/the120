import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/consent` — THE CONSENT WALL page's OWN gate, by execution.
 *
 * The page inherits `/set-password`'s shape and its most important sentence:
 * the page gate is a routing courtesy, not the control. What this file pins is
 * that the courtesy is correct in BOTH directions — a parent who owes nothing
 * never sees a wall they cannot answer usefully, and a signed-out visitor is
 * never shown the interstitial at all — plus the one legal invariant the screen
 * carries: the policy TEXT and VERSION it renders come from the server's own
 * constant, verbatim.
 */

const facts = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  redirect: (route: string) => {
    throw new Error(`NEXT_REDIRECT:${route}`);
  },
}));

vi.mock("@/app/lib/funnel/dashboard-gate-core", () => ({
  loadDashboardGateFactsCore: async () => facts.value,
}));

// The client half is mocked to a marker so this test can read the props the
// SERVER handed it without rendering React.
vi.mock("@/app/consent/ConsentWall", () => ({
  ConsentWall: (props: Record<string, unknown>) => ({ __wall: props }),
}));

import ConsentWallPage from "@/app/consent/page";
import { FP_CONSENT_POLICY } from "@/app/api/fp/signup/consent-rules";
import type { ConsentWallChildFacts } from "@/app/lib/funnel/consent-wall-rules";

const baseFacts = (over: {
  hasSession?: boolean;
  consentWallChildren?: ConsentWallChildFacts[] | null;
}) => ({
  hasSession: over.hasSession ?? true,
  hasPassword: true,
  children: [],
  verifiedTaskCounts: null,
  photoConsentChildIds: [],
  consentWallChildren: over.consentWallChildren ?? null,
  remapCtx: { funnelStamped: false, passwordChosen: true, hasFpChild: true },
});

beforeEach(() => {
  facts.value = baseFacts({});
});

describe("/consent — the page's own gate", () => {
  it("bounces a SIGNED-OUT visitor to /dashboard (which renders SignIn)", async () => {
    facts.value = baseFacts({ hasSession: false });
    await expect(ConsentWallPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("bounces a parent who owes NOTHING — never manufacture a decision", async () => {
    facts.value = baseFacts({
      consentWallChildren: [{ childId: "kid-1", activePolicyVersions: [FP_CONSENT_POLICY.version] }],
    });
    await expect(ConsentWallPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("bounces on the FAIL-OPEN shape too (consentWallChildren null)", async () => {
    facts.value = baseFacts({ consentWallChildren: null });
    await expect(ConsentWallPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("bounces a family with no children at all", async () => {
    facts.value = baseFacts({ consentWallChildren: [] });
    await expect(ConsentWallPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("RENDERS for a parent who owes a decision", async () => {
    facts.value = baseFacts({
      consentWallChildren: [{ childId: "kid-1", activePolicyVersions: [] }],
    });
    await expect(ConsentWallPage()).resolves.toBeTruthy();
  });

  it("renders FP_CONSENT_POLICY.text VERBATIM, with its version", async () => {
    // The legal invariant: what the parent reads and what
    // `captureLegacyChildConsent` snapshots are the same string by
    // construction, because both come from this one constant in this one
    // process. No client bundle sits in between to go stale.
    facts.value = baseFacts({
      consentWallChildren: [{ childId: "kid-1", activePolicyVersions: [] }],
    });
    const el = (await ConsentWallPage()) as {
      props: { children: { props: { policyText: string; policyVersion: string } } };
    };
    const wall = el.props.children.props;
    expect(wall.policyText).toBe(FP_CONSENT_POLICY.text);
    expect(wall.policyVersion).toBe(FP_CONSENT_POLICY.version);
  });
});
