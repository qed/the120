import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ParentDashboard first render (parent-dashboard restructure).
 *
 * Convention note (see kid-credentials-panel.test.tsx): this repo's vitest runs
 * node-env with no jsdom and cannot click, so this pins the FIRST render via
 * renderToStaticMarkup. The store is mocked so the render is deterministic; the
 * heavy leaf imports (SignIn, AppHeader) are stubbed so this stays a focused
 * render of the kid grid the restructure introduced.
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

import ParentDashboard from "@/app/dashboard/ParentDashboard";
import { emptyChild, type Child } from "@/app/dashboard/data";

function makeChild(id: string, over: Partial<Child> = {}): Child {
  return { ...emptyChild(id), ...over };
}

const html = () => renderToStaticMarkup(createElement(ParentDashboard));

describe("ParentDashboard — the kid grid", () => {
  // `ready` is module-scoped and flipped by the loading-state test below; reset
  // it so that test cannot poison the ones declared after it.
  beforeEach(() => {
    store.ready = true;
  });

  it("renders a two-column grid of clickable kid cards, each linking to its portal", () => {
    store.session = { user: {} };
    store.children = [
      makeChild("aaa", { firstName: "Ada" }),
      makeChild("bbb", { firstName: "Ben" }),
    ];
    const out = html();
    // The 2-up grid (1 col on mobile, 2 from sm up).
    expect(out).toContain("sm:grid-cols-2");
    // Whole card is a link to that kid's portal.
    expect(out).toContain('href="/dashboard/kids/aaa"');
    expect(out).toContain('href="/dashboard/kids/bbb"');
    // The kid's name shows, and an "Open" affordance.
    expect(out).toContain("Ada");
    expect(out).toContain("Ben");
    expect(out).toContain("Open");
  });

  it("puts an add-a-kid icon in the section header, linking to /start?step=kid", () => {
    store.session = { user: {} };
    store.children = [makeChild("aaa", { firstName: "Ada" })];
    const out = html();
    expect(out).toContain('aria-label="Add a kid"');
    expect(out).toContain('href="/start?step=kid"');
  });

  it("keeps a zero-kid empty state", () => {
    store.session = { user: {} };
    store.children = [];
    const out = html();
    expect(out).toContain("Add your first kid");
    // No grid rendered for zero kids.
    expect(out).not.toContain("/dashboard/kids/");
  });

  it("swaps to SignIn when signed out", () => {
    store.session = null;
    store.children = [];
    const out = html();
    expect(out).toContain("SIGN IN MARKER");
  });

  // A loading family also has `children === []`, so a dashboard that checked the
  // zero-kid branch before `!ready` would tell an existing parent to "Add your
  // first kid" every time the store was still fetching. Pin the order.
  it("shows the loading state, NOT the zero-kid empty state, while still loading", () => {
    store.ready = false;
    store.session = { user: {} };
    store.children = [];
    const out = html();
    expect(out).toContain("Loading your dashboard");
    expect(out).not.toContain("Add your first kid");
  });
});
