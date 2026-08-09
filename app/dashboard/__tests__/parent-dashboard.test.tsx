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

const html = (verifiedTaskCounts: Record<string, number> | null = null) =>
  renderToStaticMarkup(createElement(ParentDashboard, { verifiedTaskCounts }));

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
    // Each card links to that kid's portal.
    expect(out).toContain('href="/dashboard/kids/aaa"');
    expect(out).toContain('href="/dashboard/kids/bbb"');
    // The kid's name shows, and an "Open" affordance.
    expect(out).toContain("Ada");
    expect(out).toContain("Ben");
    expect(out).toContain("Open");
    // No eyebrow label above the name (founder: drop the "Dashboard" kicker).
    expect(out).not.toContain(">Dashboard<");
  });

  // The card carries TWO destinations, and they must be SIBLING anchors: a link
  // nested inside a link is invalid HTML and the browser silently closes the
  // outer anchor early, so the DOM a screen reader walks is not the one written.
  it("gives each card a second, separate link to that kid's account details", () => {
    store.session = { user: {} };
    store.children = [makeChild("aaa", { firstName: "Ada" })];
    const out = html();
    expect(out).toContain('href="/dashboard/kids/aaa/account"');
    expect(out).toContain("Account details");
    // No anchor opens before a previous one closes.
    expect(out).not.toMatch(/<a[^>]*>(?:(?!<\/a>)[\s\S])*<a/);
  });

  it("renders each kid's REAL verified Path count and a bar sized to it", () => {
    store.session = { user: {} };
    store.children = [
      makeChild("aaa", { firstName: "Ada", grade: 6, fpUsername: "ada.lovelace" }),
      makeChild("bbb", { firstName: "Ben", fpUsername: "ben.franklin" }),
    ];
    const out = html({ aaa: 25 });
    expect(out).toContain("The Path");
    expect(out).toContain("25 / ");
    expect(out).toContain("Grade 6");
    // Ben has an fp account but no counted rows: absent from the map is an
    // honest 0, not a missing bar — the card must never quietly lose the row.
    expect(out).toContain("0 / ");
    expect(out).toContain("Grade not set");
  });

  // A failed counts read arrives as null. An fp kid's bar then shows its 0
  // floor; the dashboard still renders.
  it("falls back to the honest 0 floor when the counts read failed (null)", () => {
    store.session = { user: {} };
    store.children = [makeChild("aaa", { firstName: "Ada", fpUsername: "ada.lovelace" })];
    const out = html(null);
    expect(out).toContain("0 / ");
    expect(out).toContain("The Path");
  });

  // THE FALSE-STAT GUARD. A legacy family (a `member` child, or any pre-First-
  // Profit account) still reaches /dashboard, but the gate never loads counts
  // for them — so a bar defaulting to 0 would tell a parent their kid has done
  // "0 / 125" of a curriculum they never joined. A missing stat is fine; a
  // fabricated one is not.
  it("renders NO Path bar for a kid with no First Profit account", () => {
    store.session = { user: {} };
    store.children = [makeChild("legacy", { firstName: "Cass", fpUsername: null })];
    const out = html(null);
    expect(out).toContain("Cass");
    expect(out).not.toContain("The Path");
    expect(out).not.toContain("verified");
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
