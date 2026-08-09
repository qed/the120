import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KidPortal first render — the KID's page (apps only).
 *
 * Node-env render pin (see kid-credentials-panel.test.tsx). The store is mocked
 * so the portal picks a deterministic child by id; the action modules behind
 * FirstProfitCard are mocked so importing the real component does not drag
 * server code into the browser-less test.
 *
 * The parent controls live at /dashboard/kids/<id>/account and are covered by
 * kid-account.test.tsx — this file pins that they are NOT here.
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

import KidPortal from "@/app/dashboard/kids/[id]/KidPortal";
import { emptyChild, type Child } from "@/app/dashboard/data";

function makeChild(id: string, over: Partial<Child> = {}): Child {
  return { ...emptyChild(id), ...over };
}

const render = (childId: string) =>
  renderToStaticMarkup(createElement(KidPortal, { childId }));

describe("KidPortal — the per-kid apps launcher (controls moved to /account)", () => {
  // The store fixture is module-scoped and mutated per test; `ready` in
  // particular is flipped by the loading-state test below, so reset it here or
  // that test silently poisons every test declared after it.
  beforeEach(() => {
    store.ready = true;
  });

  it("renders the FP login card, the Gauntlet + Math rows, and the kid heading", () => {
    store.session = { user: {} };
    store.children = [makeChild("k1", { firstName: "Remi", fpUsername: "remi.newal" })];
    const out = render("k1");
    expect(out).toMatch(/Remi’s Dashboard/);
    expect(out).toContain("First Profit");
    expect(out).toContain("Login"); // the FP handoff button (kid has an account)
    expect(out).toContain("GAUNTLET");
    expect(out).toContain("Math Academy");
    expect(out).toContain("Coming soon");
  });

  // THE KID'S PAGE IS THE KID'S. The parent's controls moved to their own route;
  // this pins that they did not quietly come back, and that the one way across
  // is a link rather than a mounted panel.
  it("mounts NO parent controls, only a link to this kid's account details", () => {
    store.session = { user: {} };
    store.children = [makeChild("k1", { firstName: "Remi", fpUsername: "remi.newal" })];
    const out = render("k1");
    expect(out).not.toContain("Login &amp; permissions"); // KidCredentials disclosure
    expect(out).not.toContain("Public page"); // KidSite
    expect(out).toContain('href="/dashboard/kids/k1/account"');
  });

  it("renders a clean 'Kid not found' state for an id the parent does not own", () => {
    store.session = { user: {} };
    store.children = [makeChild("k1", { firstName: "Remi" })];
    const out = render("stranger-id");
    expect(out).toContain("Kid not found");
    expect(out).not.toContain("GAUNTLET");
    // The OWNED kid in the store must not bleed into the render for a
    // different id. Asserting on k1's own href (rather than the bare string
    // "/account", which lives in the same branch as GAUNTLET and so could
    // never fail independently) is what makes this a real ownership check.
    expect(out).not.toContain("/dashboard/kids/k1/account");
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
