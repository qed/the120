import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isStaffPath, resolveProxyOutcome } from "@/app/lib/supabase/proxy-rules";
import { config } from "@/proxy";

/**
 * The `/staff` route's contract (Staff Front Door Unit 2; R1, R5a, R6).
 *
 * FIRST TEST FILE UNDER `app/staff/` — its glob went into `vitest.config.ts`'s
 * include allowlist in the same commit, and `app/lib/__tests__/
 * vitest-include-coverage.test.ts` now fails if any repo test file is left
 * outside that list. Before this file existed, a test here would never have
 * run while `npm run test` stayed green.
 *
 * There is no jsdom (`environment: "node"`), so nothing here renders the page.
 * What it does assert is the pair of facts that are true of the ROUTE rather
 * than of any one module, and that no other test file owns:
 *
 *   1. Every gate the hub has agrees on which paths are the hub.
 *   2. The hub's own metadata declares noindex (R5a).
 *
 * The page and layout are imported for their module-scope exports only —
 * `metadata` and `dynamic` are plain values evaluated at import, so this reads
 * the real exports Next reads, not a copy of them.
 */

describe("/staff — one definition of the hub across every gate", () => {
  it("the matcher and the decision table cover exactly the same paths", async () => {
    // Two independent gates decide whether a request is "the hub": the
    // statically-analyzed `config.matcher` (which decides whether the proxy
    // RUNS) and `isStaffPath` (which decides what the proxy DOES). They are
    // written in different languages — a path-to-regexp pattern and a string
    // comparison — and nothing but this assertion keeps them in step.
    //
    // The failure it prevents is asymmetric and silent: a matcher that stops
    // covering a path the decision table still claims means the hub is not
    // gated at all, and nothing anywhere else reddens.
    const { unstable_doesMiddlewareMatch } = await import(
      "next/experimental/testing/server"
    );
    const matches = (url: string) =>
      unstable_doesMiddlewareMatch({ config: { matcher: config.matcher }, url });

    for (const url of ["/staff", "/staff/", "/staff/anything", "/staff/a/b"]) {
      expect(isStaffPath(url), `isStaffPath(${url})`).toBe(true);
      expect(matches(url), `matcher(${url})`).toBe(true);
    }

    // And the prefix neighbours are outside BOTH. `/staffing` never reaching
    // the proxy is what makes it harmless that the decision table's hub branch
    // and its catch-all agree today.
    for (const url of ["/staffing", "/staff-handbook", "/staffroom/x"]) {
      expect(isStaffPath(url), `isStaffPath(${url})`).toBe(false);
      expect(matches(url), `matcher(${url})`).toBe(false);
    }
  });

  it("resolveProxyOutcome still decides the hub through isStaffPath", () => {
    /**
     * A SOURCE assertion, deliberately, and the only kind that can work here.
     *
     * The `/staff` branch in `resolveProxyOutcome` returns exactly what the
     * catch-all beneath it returns, so deleting the branch changes no outcome
     * and reddens no behavioural test — verified by mutation during this
     * unit's review, where the whole `/staff` suite stayed green with the
     * branch removed. The branch is not there for today's verdict; it is
     * there so that the day someone changes the catch-all, /staff keeps the
     * gate R6 chose for it.
     *
     * That makes it precisely the shape
     * docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-\
     * mechanism-2026-07-23.md warns about: a guard whose value is entirely in
     * being wired up, where losing the wiring is invisible. A "remove
     * duplicate code" pass would delete it and every test would pass.
     *
     * So the wiring itself is what gets asserted. The repo already scans
     * source this way (sw-discipline, fp-rename-straggler).
     */
    const src = readFileSync("app/lib/supabase/proxy-rules.ts", "utf8");
    const body = src.slice(src.indexOf("export function resolveProxyOutcome"));
    expect(body).toContain("isStaffPath(pathname)");

    // And the predicate is not merely referenced somewhere in the file — it is
    // referenced ahead of the catch-all, or /staff would reach the catch-all
    // first and the branch would be unreachable rather than merely inert.
    const branch = body.indexOf("isStaffPath(pathname)");
    const catchAll = body.lastIndexOf("return resolveAdminClaimOutcome(session)");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(catchAll);
  });

  it("no session reaches the hub — signed out or signed in without the claim", () => {
    // R6 end to end at the routing layer: a guide typing /staff gets the 404
    // rewrite outcome, never `pass`, so the surface never confirms it exists.
    expect(resolveProxyOutcome({ pathname: "/staff", session: null })).toBe(
      "crm-login"
    );
    expect(
      resolveProxyOutcome({
        pathname: "/staff",
        session: { user: { app_metadata: { role: "guide" } } },
      })
    ).toBe("crm-staff-only");
  });
});

describe("/staff — route segment config (R5a)", () => {
  it("the page declares itself unindexable and dynamic", async () => {
    const page = await import("@/app/staff/page");

    // Both are asserted because Next merges `metadata` shallowly from the root
    // segment down, nearest wins: the page's own declaration is what survives
    // if the layout's is ever removed, and the layout's is what covers any
    // future page added under /staff that forgets its own.
    expect(page.metadata.robots).toEqual({ index: false, follow: false });
    // The gate reads the session and the service-role staff row per request;
    // the env-less build must never try to prerender it.
    expect(page.dynamic).toBe("force-dynamic");
  });

  it("the layout declares itself unindexable too", async () => {
    const layout = await import("@/app/staff/layout");
    expect(layout.metadata.robots).toEqual({ index: false, follow: false });
  });
});
