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
 *  - the RETIRED Account Details route (app/dashboard/account/page.tsx): after
 *    the U4 MERGE it is no longer a second surface — it runs the same gate the
 *    dashboard page does and then PERMANENTLY redirects to /dashboard (the
 *    merged page). It renders nothing;
 *  - per-kid Login is bound to the row's OWN id (a refactor that hoists or loses
 *    it would burn the wrong child's handoff code);
 *  - both roster surfaces render `children.map` with a stable key.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ─────────────── the retired Account Details route (U4 merge) ─────────────── */

describe("app/dashboard/account/page.tsx — the retired route redirects to /dashboard", () => {
  // fpv03 U4 (deliberate update): the two-page dashboard collapsed into one.
  // This route stopped rendering AccountDetails; it now runs the shared gate and
  // PERMANENTLY redirects to /dashboard so stale bookmarks land on the merged
  // page. The management controls moved onto /dashboard itself (asserted in
  // funnel-dashboard-register + fp-ui-retirement).
  const page = stripComments(read("app/dashboard/account/page.tsx"));

  it("still runs the gate before redirecting (cache() wrapper + verdict + redirect)", () => {
    // The auth/session wiring is unchanged: a session-less/unqualified request
    // is bounced by the gate exactly as before, never leaking /dashboard.
    expect(page).toMatch(/cache\(\(\) => loadDashboardGateFactsCore\(\)\)/);
    expect(page).toContain("dashboardGateVerdict(");
    expect(page).toMatch(/if \(verdict\.action === "redirect"\) redirect\(verdict\.route\)/);
  });

  it("permanently redirects a qualified parent to the merged /dashboard", () => {
    expect(page).toMatch(/permanentRedirect\("\/dashboard"\)/);
  });

  it("no longer renders AccountDetails or loads its facts (the split is gone)", () => {
    expect(page).not.toContain("AccountDetails");
    expect(page).not.toContain("fpSites=");
    expect(page).not.toContain("consentPolicy={");
    expect(page).not.toContain("return (");
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

/* ─────────────── U4 dashboard-merge correction (single point of gating,
   unconditional #account mount, gate-before-data-load) ─────────────── */

describe("DashboardApp — one point of auth gating, AccountDetails mounted unconditionally", () => {
  const app = stripComments(read("app/dashboard/DashboardApp.tsx"));

  it("the signed-out gate (return <SignIn) textually PRECEDES the <AccountDetails mount", () => {
    // The parent owns the single auth gate; AccountDetails is only ever reached
    // once the signed-out swap has been ruled out. A refactor that mounts the
    // section above the gate (leaking it to a session-less request) reddens.
    const gate = app.indexOf("if (ready && !session) return <SignIn");
    const mount = app.indexOf("<AccountDetails");
    expect(gate).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(gate);
  });

  it("AccountDetails is mounted regardless of children.length — the #account anchor always exists (zero-kid reachability, fix #1)", () => {
    // The bug: the section was nested inside the has-kids fragment, so a zero-kid
    // family's "Account Details" menu link (/dashboard#account) was a dead
    // affordance and AccountDetails' own "No kids yet..." copy was unreachable.
    // The fix hoists the single mount OUT of the fragment to a sibling after the
    // ternary, so its indexOf now follows the fragment close (</>) — before the
    // fix it preceded it (nested inside the has-kids branch).
    const fragEnd = app.indexOf("</>");
    const mount = app.indexOf("<AccountDetails");
    expect(fragEnd).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(fragEnd);
    // Exactly one mount — not one per branch.
    expect(app.match(/<AccountDetails/g)).toHaveLength(1);
  });
});

describe("AccountDetails — no second gate (single point of gating)", () => {
  const details = stripComments(read("app/dashboard/AccountDetails.tsx"));

  it("does not import SignIn or read session — the parent is the only gate", () => {
    // AccountDetails is a plain composed section now; if it grew its own SignIn
    // swap or session read the app would have two gates that could disagree.
    expect(details).not.toContain("SignIn");
    expect(details).not.toMatch(/\bsession\b/);
  });
});

describe("app/dashboard/page.tsx — gate runs before the kid-data load, and threads the merged props", () => {
  const page = stripComments(read("app/dashboard/page.tsx"));

  it("loadParentSitesForRequest() runs AFTER the redirect gate line (no kid data for a bounced session)", () => {
    const gate = page.indexOf('if (verdict.action === "redirect")');
    const load = page.indexOf("loadParentSitesForRequest()");
    expect(gate).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(gate);
  });

  it("passes fpSites, photoConsentChildIds, and consentPolicy to <DashboardApp", () => {
    expect(page).toContain("fpSites={fpSites}");
    expect(page).toContain("photoConsentChildIds={facts.photoConsentChildIds}");
    expect(page).toContain("consentPolicy={{");
  });
});

describe("app/dashboard/account/page.tsx — gate precedes the redirect (no open-redirect bypass)", () => {
  const acct = stripComments(read("app/dashboard/account/page.tsx"));

  it("the redirect gate line PRECEDES permanentRedirect(\"/dashboard\")", () => {
    // A reorder that ran permanentRedirect before the gate would bounce even a
    // session-less/unqualified request straight to /dashboard — an open-redirect
    // bypass of the shared auth gate. Ordering pins the gate-first contract.
    const gate = acct.indexOf('if (verdict.action === "redirect")');
    const perm = acct.indexOf('permanentRedirect("/dashboard")');
    expect(gate).toBeGreaterThan(-1);
    expect(perm).toBeGreaterThan(gate);
  });
});

describe("V3BrandLockup — navigating on the dashboard, inert on /start", () => {
  it("the dashboard header links the lockup home (href=\"/dashboard\")", () => {
    const ui = read("app/dashboard/ui.tsx");
    expect(ui).toContain('<V3BrandLockup href="/dashboard"');
  });

  it("the /start brand header passes NO href — the shared lockup does not navigate there", () => {
    const startUi = read("app/start/v3-ui.tsx");
    expect(startUi).toContain("<V3BrandLockup />");
    expect(startUi).not.toContain("<V3BrandLockup href");
  });
});
