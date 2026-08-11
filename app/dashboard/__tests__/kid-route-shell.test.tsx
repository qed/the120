import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KidRouteShell — the ONE per-kid ownership path.
 *
 * Node-env render pin (see kid-credentials-panel.test.tsx). The shell used to be
 * two verbatim copies, one inside KidPortal and one inside KidAccount; this file
 * is the reason there only needs to be one review of it.
 *
 * THE SECURITY PROPERTY UNDER TEST: `children` in the store is RLS-scoped to the
 * signed-in parent, so picking the child out of it by id is what makes a guessed
 * or foreign id resolve to nothing. The strongest form of that assertion is not
 * "the page says Kid not found" (a body could still have rendered above the
 * fold) but "the body render prop was never CALLED" — no body code runs, and no
 * other family's row is ever reached for. That is what `body` being a spy here
 * buys us.
 */

const { store } = vi.hoisted(() => ({
  store: {
    ready: true,
    session: { user: {} } as unknown,
    parent: null as unknown,
    children: [] as Child[],
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

import KidRouteShell, { type KidRouteSurface } from "@/app/dashboard/kids/[id]/KidRouteShell";
import { emptyChild, type Child } from "@/app/dashboard/data";

function makeChild(id: string, over: Partial<Child> = {}): Child {
  return { ...emptyChild(id), ...over };
}

/** Render the shell with a spy body, so "was the body reached?" is observable. */
function renderShell(childId: string, surface: KidRouteSurface = "kid") {
  const body = vi.fn((c: Child) => createElement("p", null, `BODY FOR ${c.id}`));
  const out = renderToStaticMarkup(createElement(KidRouteShell, { childId, surface, body }));
  return { out, body };
}

describe("KidRouteShell — the shared ownership path", () => {
  // `ready` is flipped by the loading test, so reset it or that test poisons
  // every test declared after it (the trap kid-portal.test.tsx documents).
  beforeEach(() => {
    store.ready = true;
    store.session = { user: {} };
    store.children = [];
  });

  it("renders the body with the matched child when the parent owns that id", () => {
    store.children = [makeChild("k1", { firstName: "Remi" }), makeChild("k2")];
    const { out, body } = renderShell("k1");
    expect(out).toContain("BODY FOR k1");
    expect(body).toHaveBeenCalledTimes(1);
    expect(body.mock.calls[0][0].id).toBe("k1");
    expect(out).not.toContain("Kid not found");
  });

  // THE ACTUAL SECURITY ASSERTION. Not just "the fallback shows" — the body is
  // never invoked at all, so no page code runs for an id this parent does not
  // own, and the one kid they DO own does not bleed into the render.
  it("never calls the body for a childId that is not in the RLS-scoped store", () => {
    store.children = [makeChild("k1", { firstName: "Remi" })];
    const { out, body } = renderShell("stranger-id");
    expect(body).not.toHaveBeenCalled();
    expect(out).toContain("Kid not found");
    expect(out).not.toContain("BODY FOR");
    expect(out).toContain("Back to all kids");
  });

  it("never calls the body for an empty store, even with a plausible id", () => {
    store.children = [];
    const { out, body } = renderShell("k1");
    expect(body).not.toHaveBeenCalled();
    expect(out).toContain("Kid not found");
  });

  /* THE LOOKUP FAILS CLOSED ON ODD IDS. A childId arrives from the URL, so it is
   * whatever a visitor typed. None of these may be talked into matching an owned
   * kid, and — the stronger assertion — none may reach the body at all.
   *
   * WHY `__proto__` IS SAFE HERE SPECIFICALLY: the lookup is
   * `children.find((c) => c.id === childId)` — an Array.prototype.find with a
   * strict === over real rows. Nothing is ever used as a KEY, so there is no
   * inherited property to hit: `__proto__` is just a string that equals no id.
   * That safety is a property of the DATA STRUCTURE, not of any validation. A
   * future refactor to a Map keyed by id, or (worse) a plain object with
   * `byId[childId]`, would reintroduce the prototype-key hazard this repo has
   * documented elsewhere — an object lookup for "__proto__"/"constructor"
   * returns something truthy that is not a child, and the body would be handed
   * it. If you change the shape of this lookup, this test is the one that has to
   * be re-argued, not just re-run. */
  describe("fails closed on odd childId values (never matches, never calls the body)", () => {
    const owned = "k1";
    const cases: ReadonlyArray<[label: string, id: string]> = [
      ["an empty string", ""],
      ["a very long string", "k".repeat(5000)],
      ["a case variant of a real owned id", "K1"],
      ["a whitespace-padded variant of a real owned id", "  k1  "],
      ["the prototype key __proto__", "__proto__"],
      ["the prototype key constructor", "constructor"],
    ];

    for (const [label, id] of cases) {
      it(`renders "Kid not found" and never calls the body for ${label}`, () => {
        store.children = [makeChild(owned, { firstName: "Remi" })];
        const { out, body } = renderShell(id);
        expect(body).not.toHaveBeenCalled();
        expect(out).toContain("Kid not found");
        expect(out).not.toContain("BODY FOR");
        expect(out).not.toContain("Remi");
      });
    }
  });

  it("swaps to SignIn when signed out, before any lookup or body render", () => {
    store.session = null;
    store.children = [makeChild("k1")];
    const { out, body } = renderShell("k1");
    expect(out).toContain("SIGN IN MARKER");
    expect(body).not.toHaveBeenCalled();
    // The SignIn swap REPLACES the page: no chrome, no back link, no fallback.
    expect(out).not.toContain("Kid not found");
    expect(out).not.toContain("All kids");
  });

  // The gate is `ready && !session`, NOT a bare `!session`. Before the store has
  // resolved, session is null for a perfectly signed-in parent — a bare check
  // would flash the sign-in form at them on every load.
  it("does NOT flash SignIn while the store is still resolving the session", () => {
    store.ready = false;
    store.session = null;
    const { out, body } = renderShell("k1");
    expect(out).not.toContain("SIGN IN MARKER");
    expect(out).toContain("Loading");
    expect(body).not.toHaveBeenCalled();
  });

  // Ordering: a still-loading family is also an EMPTY one, so a shell that
  // checked !child before !ready would tell an owner their kid does not exist.
  it("shows loading, not 'Kid not found', while the family is still loading", () => {
    store.ready = false;
    store.children = [];
    const { out, body } = renderShell("k1");
    expect(out).toContain("Loading");
    expect(out).not.toContain("Kid not found");
    expect(body).not.toHaveBeenCalled();
  });

  it("carries the shared chrome on every branch: back link and wide main", () => {
    store.children = [makeChild("k1")];
    for (const id of ["k1", "stranger-id"]) {
      const { out } = renderShell(id);
      expect(out).toContain('href="/dashboard"');
      expect(out).toContain("All kids");
      expect(out).toContain("max-w-5xl");
    }
  });

  /* Each audience keeps its own look. The cream + grain page is the KID's space
   * and the white one is the PARENT's; a future edit must not be able to make
   * the parent page quietly look like the kid's. */
  describe("surface treatment", () => {
    const wrapperClass = (markup: string) =>
      /^<div class="([^"]*)"/.exec(markup)?.[1] ?? "";

    it('surface="kid" renders the cream, grained wrapper', () => {
      store.children = [makeChild("k1")];
      expect(wrapperClass(renderShell("k1", "kid").out)).toBe(
        "v3-grain min-h-screen bg-v3-cream text-v3-ink"
      );
    });

    it('surface="parent" renders the plain white wrapper', () => {
      store.children = [makeChild("k1")];
      expect(wrapperClass(renderShell("k1", "parent").out)).toBe(
        "min-h-screen bg-white text-v3-ink"
      );
    });

    it("the two surfaces are genuinely different (the distinction is the point)", () => {
      store.children = [makeChild("k1")];
      const kid = wrapperClass(renderShell("k1", "kid").out);
      const parent = wrapperClass(renderShell("k1", "parent").out);
      expect(kid).not.toBe(parent);
      expect(kid).toContain("v3-grain");
      expect(parent).not.toContain("v3-grain");
      expect(parent).not.toContain("bg-v3-cream");
    });
  });
});
