import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * fpv03 U4 apps-launcher wiring pins (source-scan convention: this repo's vitest
 * runs node-env with no jsdom, so surfaces that cannot be reduced to a pure
 * function are pinned by reading their source — the same convention
 * funnel-dashboard-cards / funnel-live-surface-pins use).
 *
 * Covers three review gaps:
 *  - the NEW Account Details route (app/dashboard/account/page.tsx) had zero
 *    coverage: it runs the same gate + redirect the dashboard page does and
 *    threads three server-computed facts into AccountDetails;
 *  - per-kid Login is bound to the row's OWN id (a refactor that hoists or loses
 *    it would burn the wrong child's handoff code);
 *  - both roster surfaces render `children.map` with a stable key.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ─────────────────── the Account Details route gate ─────────────────── */

describe("app/dashboard/account/page.tsx — the gate the new route inherited", () => {
  const page = stripComments(read("app/dashboard/account/page.tsx"));

  it("loads the gate facts through the cache() wrapper and computes the verdict", () => {
    // Same split-shape the dashboard page uses (memoized non-throwing loader,
    // redirect kept in the page).
    expect(page).toMatch(/cache\(\(\) => loadDashboardGateFactsCore\(\)\)/);
    expect(page).toContain("dashboardGateVerdict(");
  });

  it("redirects on the redirect verdict (the auth/session wiring, unchanged)", () => {
    expect(page).toMatch(/if \(verdict\.action === "redirect"\) redirect\(verdict\.route\)/);
  });

  it("threads the three server-computed facts into AccountDetails", () => {
    // The whole reason this route loads server-side facts: AccountDetails is a
    // client component and cannot compute the policy hash (node:crypto) or read
    // the parent-scoped sites/consent itself.
    expect(page).toMatch(/fpSites=\{fpSites\}/);
    expect(page).toMatch(/photoConsentChildIds=\{facts\.photoConsentChildIds\}/);
    expect(page).toContain("consentPolicy={");
    expect(page).toContain("currentPolicyHash()");
  });
});

/* ─────────────────── per-kid Login wiring ─────────────────── */

describe("DashboardApp — Login is bound to each kid's own id", () => {
  const app = stripComments(read("app/dashboard/DashboardApp.tsx"));

  it("the Login handler is invoked with the row's own id inside the children map", () => {
    // If a refactor hoists login() out of the per-kid render or drops the id
    // argument, this reddens — the mint is child-bound, so the wrong id burns
    // the wrong child's single-use handoff code.
    expect(app).toContain("onClick={() => login(c.id)}");
    expect(app).toContain("children.map(");
  });

  it("the Login button is DISABLED for a kid with no First Profit account (fix #1)", () => {
    // notSetUp reuses the exact null signal the Login-info panel shows, and the
    // button both disables and relabels on it — no handoff mint for a kid
    // without an FP account (which would land on a not_child error).
    expect(app).toContain("const notSetUp = c.fpUsername == null");
    expect(app).toContain("disabled={opening || notSetUp}");
    expect(app).toContain('notSetUp ? "Not set up yet"');
  });

  it("the detached mint carries the unmount guard and opener-null new tab (fix #2)", () => {
    expect(app).toContain("mounted.current");
    expect(app).toContain('window.open("", "_blank")');
    expect(app).toContain("win.opener = null");
    // NOT the noopener feature string — it returns null and breaks the mint.
    expect(app).not.toContain('"_blank", "noopener"');
    expect(app).not.toMatch(/window\.open\([^)]*noopener/);
  });
});

/* ─────────────────── multi-kid rendering, both surfaces ─────────────────── */

describe("both roster surfaces render children.map with a stable key", () => {
  it("DashboardApp maps children with key={c.id}", () => {
    const app = stripComments(read("app/dashboard/DashboardApp.tsx"));
    expect(app).toContain("children.map(");
    // kidSection stamps the key on its <section>.
    expect(app).toMatch(/key=\{c\.id\}/);
  });

  it("AccountDetails maps children with key={c.id}", () => {
    const details = stripComments(read("app/dashboard/AccountDetails.tsx"));
    expect(details).toContain("children.map(");
    expect(details).toMatch(/key=\{c\.id\}/);
  });
});
