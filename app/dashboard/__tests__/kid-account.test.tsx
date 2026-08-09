import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KidAccount first render — the PARENT's controls for one kid, on their own
 * page at /dashboard/kids/<id>/account.
 *
 * Node-env render pin (see kid-credentials-panel.test.tsx). The store is mocked
 * so the page picks a deterministic child by id; the leaf action modules are
 * mocked exactly as the credentials-panel test mocks them, so importing the real
 * KidCredentials / KidSite does not drag server code into the browser-less test.
 *
 * This file inherits the controls coverage that used to live in
 * kid-portal.test.tsx, so the move did not cost the invariants a home.
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
vi.mock("@/app/lib/v3-signup/actions/kid-credentials", () => ({
  resetKidPasswordAction: vi.fn(),
  captureChildConsentAction: vi.fn(),
  revokeChildConsentAction: vi.fn(),
}));
vi.mock("@/app/lib/fp/actions/fp-site-parent", () => ({ setFpSitePublishedAction: vi.fn() }));

import KidAccount from "@/app/dashboard/kids/[id]/account/KidAccount";
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
    createElement(KidAccount, {
      childId,
      consentPolicy: POLICY,
      photoConsentChildIds: [],
      fpSites,
    })
  );

describe("KidAccount — one kid's parent controls", () => {
  beforeEach(() => {
    store.ready = true;
  });

  it("mounts this kid's controls: KidCredentials (login/permissions) and KidSite (public page)", () => {
    store.session = { user: {} };
    store.children = [makeChild("k1", { firstName: "Remi", fpUsername: "remi.newal" })];
    const out = render("k1", [site("k1")]);
    expect(out).toContain("Manage Remi");
    expect(out).toContain("Login &amp; permissions"); // KidCredentials disclosure
    expect(out).toContain("Public page"); // KidSite
    expect(out).toContain("remi-lemonade"); // this kid's handle
  });

  // The page is the parent's, so it carries no apps — the mirror of the pin in
  // kid-portal.test.tsx. Together they keep the two audiences separated.
  it("mounts no apps launcher, only a way back into the kid's own dashboard", () => {
    store.session = { user: {} };
    store.children = [makeChild("k1", { firstName: "Remi", fpUsername: "remi.newal" })];
    const out = render("k1", [site("k1")]);
    expect(out).not.toContain("GAUNTLET");
    expect(out).not.toContain("Math Academy");
    expect(out).toContain('href="/dashboard/kids/k1"');
  });

  it("renders a clean 'Kid not found' state for an id the parent does not own", () => {
    store.session = { user: {} };
    store.children = [makeChild("k1", { firstName: "Remi" })];
    const out = render("stranger-id", [site("k1")]);
    expect(out).toContain("Kid not found");
    // Critically: no OTHER kid's controls or handle leak into the fallback.
    expect(out).not.toContain("Login &amp; permissions");
    expect(out).not.toContain("remi-lemonade");
  });

  it("swaps to SignIn when signed out", () => {
    store.session = null;
    store.children = [];
    const out = render("k1");
    expect(out).toContain("SIGN IN MARKER");
  });

  // Same ordering trap as its siblings: a loading family is also an empty one,
  // so checking !child first would flash "Kid not found" at an owner.
  it("shows the loading state, NOT 'Kid not found', while the store is still loading", () => {
    store.ready = false;
    store.session = { user: {} };
    store.children = [];
    const out = render("k1");
    expect(out).toContain("Loading");
    expect(out).not.toContain("Kid not found");
  });
});
