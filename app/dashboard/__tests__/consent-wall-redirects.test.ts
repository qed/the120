import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE CONSENT WALL's page redirects (founder, 2026-08-10), by EXECUTION.
 *
 * Each of the four `/dashboard` routes keeps its OWN gate — the segment layout
 * deliberately holds none (see app/dashboard/layout.tsx's docblock: a gate that
 * lives next to the data it protects cannot be inherited-and-forgotten by a new
 * route). Four gates means four chances to forget one, which is exactly why
 * this file drives all four rather than sampling.
 *
 * ⚠ These redirects are a ROUTING COURTESY, not the control. The control is
 * `requireConsentClear` inside the Server Actions, pinned by
 * app/lib/__tests__/consent-wall-action-gate.test.ts.
 */

const facts = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
const verdict = vi.hoisted(() => ({ value: { action: "render" } as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  redirect: (route: string) => {
    throw new Error(`NEXT_REDIRECT:${route}`);
  },
  permanentRedirect: (route: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${route}`);
  },
}));

vi.mock("@/app/lib/funnel/dashboard-gate-core", () => ({
  loadDashboardGateFactsCore: async () => facts.value,
}));

vi.mock("@/app/lib/funnel/session-rules", () => ({
  dashboardGateVerdict: () => verdict.value,
}));

vi.mock("@/app/lib/fp/fp-site-parent-core", () => ({
  loadParentSitesForRequest: async () => [],
}));

vi.mock("@/app/dashboard/ParentDashboard", () => ({ default: () => null }));
vi.mock("@/app/dashboard/kids/[id]/KidPortal", () => ({ default: () => null }));
vi.mock("@/app/dashboard/kids/[id]/account/KidAccount", () => ({ default: () => null }));

import DashboardPage from "@/app/dashboard/page";
import AccountRedirectPage from "@/app/dashboard/account/page";
import KidDashboardPage from "@/app/dashboard/kids/[id]/page";
import KidAccountPage from "@/app/dashboard/kids/[id]/account/page";
import {
  CONSENT_WALL_HREF,
  type ConsentWallChildFacts,
} from "@/app/lib/funnel/consent-wall-rules";
import { FP_CONSENT_POLICY } from "@/app/api/fp/signup/consent-rules";

const NO_PARAMS = Promise.resolve({} as Record<string, string | string[] | undefined>);
const KID_PARAMS = Promise.resolve({ id: "kid-1" });

/** Every route, invoked the way Next invokes it. */
const ROUTES: Array<{ name: string; run: () => Promise<unknown> }> = [
  { name: "/dashboard", run: () => DashboardPage({ searchParams: NO_PARAMS }) },
  { name: "/dashboard/account", run: () => AccountRedirectPage({ searchParams: NO_PARAMS }) },
  {
    name: "/dashboard/kids/[id]",
    run: () => KidDashboardPage({ params: KID_PARAMS, searchParams: NO_PARAMS }),
  },
  {
    name: "/dashboard/kids/[id]/account",
    run: () => KidAccountPage({ params: KID_PARAMS, searchParams: NO_PARAMS }),
  },
];

const baseFacts = (consentWallChildren: ConsentWallChildFacts[] | null) => ({
  hasSession: true,
  hasPassword: true,
  children: [],
  verifiedTaskCounts: null,
  photoConsentChildIds: [],
  consentWallChildren,
  remapCtx: { funnelStamped: false, passwordChosen: true, hasFpChild: true },
});

beforeEach(() => {
  verdict.value = { action: "render" };
  facts.value = baseFacts(null);
});

describe("every /dashboard route redirects a parent who owes a consent decision", () => {
  for (const route of ROUTES) {
    it(`${route.name} → ${CONSENT_WALL_HREF}`, async () => {
      facts.value = baseFacts([{ childId: "kid-1", activePolicyVersions: [] }]);
      await expect(route.run()).rejects.toThrow(`NEXT_REDIRECT:${CONSENT_WALL_HREF}`);
    });
  }
});

describe("every /dashboard route lets a consented family straight through", () => {
  for (const route of ROUTES) {
    it(`${route.name} does not bounce`, async () => {
      facts.value = baseFacts([
        { childId: "kid-1", activePolicyVersions: [FP_CONSENT_POLICY.version] },
      ]);
      if (route.name === "/dashboard/account") {
        // The retired route's own 308 to /dashboard, unchanged by this work.
        await expect(route.run()).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/dashboard");
      } else {
        await expect(route.run()).resolves.toBeTruthy();
      }
    });
  }
});

describe("the wall never pre-empts the existing session gate", () => {
  for (const route of ROUTES) {
    it(`${route.name} routes an unqualified session for the reason it actually has`, async () => {
      // The gate verdict runs FIRST, so a family who owes consent AND needs the
      // set-password step is sent to set-password, not to the wall — otherwise
      // a converted funnel parent would be walled behind a screen they cannot
      // leave without a password they do not have.
      verdict.value = { action: "redirect", route: "/set-password" };
      facts.value = baseFacts([{ childId: "kid-1", activePolicyVersions: [] }]);
      await expect(route.run()).rejects.toThrow("NEXT_REDIRECT:/set-password");
    });
  }
});

describe("FAIL OPEN: an unknown consent state never erects a wall", () => {
  for (const route of ROUTES) {
    it(`${route.name} renders when consentWallChildren is null (read failed / signed out)`, async () => {
      facts.value = baseFacts(null);
      if (route.name === "/dashboard/account") {
        await expect(route.run()).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/dashboard");
      } else {
        await expect(route.run()).resolves.toBeTruthy();
      }
    });
  }
});
