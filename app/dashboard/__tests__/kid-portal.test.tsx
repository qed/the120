import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KidPortal first render (parent-dashboard restructure).
 *
 * Node-env render pin (see kid-credentials-panel.test.tsx). The store is mocked
 * so the portal picks a deterministic child by id; the leaf action modules are
 * mocked exactly as the credentials-panel test mocks them, so importing the real
 * KidCredentials / KidSite / FirstProfitCard does not drag server code into the
 * browser-less test.
 */

const { store } = vi.hoisted(() => ({
  store: {
    ready: true,
    session: { user: {} } as unknown,
    parent: null as unknown,
    children: [] as ReturnType<typeof makeChild>[],
    signOut: () => {},
  },
}));

vi.mock("@/app/dashboard/store", () => ({
  useDashboard: () => store,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/dashboard/ui", () => ({
  AppHeader: () => null,
  ACCOUNT_MENU: [{ label: "My Kids", href: "/dashboard" }],
}));
vi.mock("@/app/dashboard/SignIn", () => ({
  default: () => createElement("p", null, "SIGN IN MARKER"),
}));
vi.mock("@/app/start/actions", () => ({ v3MintHandoffAction: vi.fn() }));
vi.mock("@/app/lib/v3-signup/actions/kid-credentials", () => ({
  resetKidPasswordAction: vi.fn(),
  captureChildConsentAction: vi.fn(),
  revokeChildConsentAction: vi.fn(),
}));
vi.mock("@/app/lib/fp/actions/fp-site-parent", () => ({ setFpSitePublishedAction: vi.fn() }));

import KidPortal from "@/app/dashboard/kids/[id]/KidPortal";
import { emptyChild, type Child } from "@/app/dashboard/data";
import type { ParentSiteRow } from "@/app/lib/fp/fp-public-site-rules";

function makeChild(id: string, over: Partial<Child> = {}): Child {
  return { ...emptyChild(id), ...over };
}

const POLICY = { version: "2026-08-05.1", hash: "abc123", text: "I confirm I am the parent." };

const site = (childId: string): ParentSiteRow => ({
  childId,
  firstName: "Remi",
  handle: "remi-lemonade",
  status: "published",
  operatorLocked: false,
});

const render = (childId: string, fpSites: ParentSiteRow[] | null = null) =>
  renderToStaticMarkup(
    createElement(KidPortal, {
      childId,
      consentPolicy: POLICY,
      photoConsentChildIds: [],
      fpSites,
    })
  );

describe("KidPortal — the per-kid apps launcher + controls", () => {
  // The store fixture is module-scoped and mutated per test; `ready` in
  // particular is flipped by the loading-state test below, so reset it here or
  // that test silently poisons every test declared after it.
  beforeEach(() => {
    store.ready = true;
  });

  it("renders the FP login card, the Gauntlet + Math rows, and the kid heading", () => {
    store.session = { user: {} };
    store.children = [makeChild("k1", { firstName: "Remi", fpUsername: "remi.newal" })];
    const out = render("k1", [site("k1")]);
    expect(out).toMatch(/Remi’s Dashboard/);
    expect(out).toContain("First Profit");
    expect(out).toContain("Login"); // the FP handoff button (kid has an account)
    expect(out).toContain("GAUNTLET");
    expect(out).toContain("Math Academy");
    expect(out).toContain("Coming soon");
  });

  it("mounts this kid's controls: KidCredentials (login/permissions) and KidSite (public page)", () => {
    store.session = { user: {} };
    store.children = [makeChild("k1", { firstName: "Remi", fpUsername: "remi.newal" })];
    const out = render("k1", [site("k1")]);
    expect(out).toContain("Login &amp; permissions"); // KidCredentials disclosure
    expect(out).toContain("Public page"); // KidSite
    expect(out).toContain("remi-lemonade"); // this kid's handle
  });

  it("renders a clean 'Kid not found' state for an id the parent does not own", () => {
    store.session = { user: {} };
    store.children = [makeChild("k1", { firstName: "Remi" })];
    const out = render("stranger-id");
    expect(out).toContain("Kid not found");
    // None of this kid's apps or controls render for a non-match.
    expect(out).not.toContain("GAUNTLET");
    expect(out).not.toContain("Login &amp; permissions");
  });

  it("swaps to SignIn when signed out", () => {
    store.session = null;
    store.children = [];
    const out = render("k1");
    expect(out).toContain("SIGN IN MARKER");
  });

  // THE ORDER OF THE TERNARY IS THE POINT. While the family is still loading,
  // `children` is [] — so a portal that checked `!child` before `!ready` would
  // flash "Kid not found" at a parent who owns the kid perfectly well. This pins
  // that the loading branch wins until the store says otherwise.
  it("shows the loading state, NOT 'Kid not found', while the store is still loading", () => {
    store.ready = false;
    store.session = { user: {} };
    store.children = [];
    const out = render("k1");
    expect(out).toContain("Loading");
    expect(out).not.toContain("Kid not found");
    expect(out).not.toContain("GAUNTLET");
  });
});
