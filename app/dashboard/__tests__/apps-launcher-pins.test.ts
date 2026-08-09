import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Parent-dashboard restructure wiring pins (source-scan convention: this repo's
 * vitest runs node-env with no jsdom, so surfaces that cannot be reduced to a
 * pure function are pinned by reading their source — the same convention
 * funnel-dashboard-cards / funnel-live-surface-pins use).
 *
 * The restructure split the one merged launcher into two routes:
 *  - /dashboard (ParentDashboard): a clean, white list of kid CARDS, each a
 *    Link into that kid's portal; an add-a-kid icon in the section header;
 *  - /dashboard/kids/[id] (KidPortal): the per-kid apps launcher (the extracted
 *    FirstProfitCard + Gauntlet/Math rows) AND the per-kid controls
 *    (KidCredentials + KidSite), scoped to the one child picked by id.
 *
 * The First Profit Login handoff (child-bound mint, sync new-tab, unmount guard)
 * moved verbatim into FirstProfitCard. The retired Account Details route still
 * gate-redirects to /dashboard.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ─────────────── the retired Account Details route (unchanged) ─────────────── */

describe("app/dashboard/account/page.tsx — the retired route redirects to /dashboard", () => {
  const page = stripComments(read("app/dashboard/account/page.tsx"));

  it("still runs the gate before redirecting (cache() wrapper + verdict + redirect)", () => {
    expect(page).toMatch(/cache\(\(\) => loadDashboardGateFactsCore\(\)\)/);
    expect(page).toContain("dashboardGateVerdict(");
    expect(page).toMatch(/if \(verdict\.action === "redirect"\) redirect\(verdict\.route\)/);
  });

  it("permanently redirects a qualified parent to the merged /dashboard", () => {
    expect(page).toMatch(/permanentRedirect\("\/dashboard"\)/);
  });

  it("no longer renders a second surface (renders nothing)", () => {
    expect(page).not.toContain("return (");
  });
});

describe("app/dashboard/account/page.tsx — gate precedes the redirect (no open-redirect bypass)", () => {
  const acct = stripComments(read("app/dashboard/account/page.tsx"));

  it('the redirect gate line PRECEDES permanentRedirect("/dashboard")', () => {
    const gate = acct.indexOf('if (verdict.action === "redirect")');
    const perm = acct.indexOf('permanentRedirect("/dashboard")');
    expect(gate).toBeGreaterThan(-1);
    expect(perm).toBeGreaterThan(gate);
  });
});

/* ─────────────────── the First Profit Login handoff (FirstProfitCard) ─────────────────── */

describe("FirstProfitCard — the child-bound Login handoff", () => {
  const card = stripComments(read("app/dashboard/FirstProfitCard.tsx"));

  it("mints with the card's OWN child id (a refactor that loses it burns the wrong code)", () => {
    expect(card).toContain("v3MintHandoffAction({ childId: child.id })");
  });

  it("the Login button is DISABLED for a kid with no First Profit account", () => {
    // notSetUp reuses the exact null signal the Login-info panel shows, and the
    // button both disables and relabels on it — no handoff mint for a kid
    // without an FP account (which would land on a not_child error).
    expect(card).toContain("const notSetUp = child.fpUsername == null");
    expect(card).toContain("disabled={opening || notSetUp}");
    expect(card).toContain('notSetUp ? "Not set up yet"');
  });

  it("the detached mint carries the unmount guard and opener-null new tab", () => {
    expect(card).toContain("mounted.current");
    expect(card).toContain('window.open("", "_blank")');
    expect(card).toContain("win.opener = null");
    // NOT the noopener feature string — it returns null and breaks the mint.
    expect(card).not.toContain('"_blank", "noopener"');
    expect(card).not.toMatch(/window\.open\([^)]*noopener/);
  });
});

/* ─────────────────── the parent dashboard (kid grid) ─────────────────── */

describe("ParentDashboard — a clean white list of clickable kid cards", () => {
  const app = stripComments(read("app/dashboard/ParentDashboard.tsx"));

  it("reads as clean/white, not the v3-cream grain", () => {
    expect(app).toContain("bg-white");
    expect(app).not.toContain("bg-v3-cream");
    expect(app).not.toContain("v3-grain");
  });

  it("maps children into cards with a stable key, each Link'd to that kid's portal", () => {
    expect(app).toContain("children.map(");
    expect(app).toMatch(/key=\{c\.id\}/);
    expect(app).toContain("href={`/dashboard/kids/${c.id}`}");
  });

  it("carries an add-a-kid icon in the section header, linking to /start?step=kid", () => {
    expect(app).toContain('aria-label="Add a kid"');
    expect(app).toContain('href="/start?step=kid"');
  });

  it("keeps an empty state for a zero-kid family, and owns the single auth gate", () => {
    expect(app).toContain("children.length === 0");
    expect(app).toContain("if (ready && !session) return <SignIn");
  });

  it("does NOT mount any per-kid controls (they live on the per-kid portal)", () => {
    expect(app).not.toContain("KidCredentials");
    expect(app).not.toContain("KidSite");
    expect(app).not.toContain("FirstProfitCard");
  });
});

/* ─────────────────── the per-kid portal ─────────────────── */

describe("KidPortal — the per-kid apps launcher + controls, picked by id", () => {
  const app = stripComments(read("app/dashboard/kids/[id]/KidPortal.tsx"));

  it("picks the child by id from the RLS-scoped store, with a not-found fallback", () => {
    expect(app).toContain("children.find((c) => c.id === childId)");
    expect(app).toContain("Kid not found");
  });

  it("mounts the extracted FirstProfitCard plus the Gauntlet and Math rows", () => {
    expect(app).toContain("<FirstProfitCard child={c} />");
    expect(app).toContain("GAUNTLET");
    expect(app).toContain("Math Academy");
    expect(app).toContain("Coming soon");
    expect(app).toMatch(/&rsquo;s Dashboard/);
  });

  it("mounts the per-kid controls verbatim (KidCredentials + KidSite) for the one child", () => {
    expect(app).toContain("<KidCredentials");
    expect(app).toContain("<KidSite");
  });

  it("owns the same client auth gate and links back to the parent dashboard", () => {
    expect(app).toContain("if (ready && !session) return <SignIn");
    expect(app).toContain('href="/dashboard"');
  });
});

/* ─────────────────── the two server pages ─────────────────── */

describe("app/dashboard/page.tsx — the parent list loads only the gate", () => {
  const page = stripComments(read("app/dashboard/page.tsx"));

  it("keeps the gate + redirect and renders ParentDashboard", () => {
    expect(page).toMatch(/cache\(\(\) => loadDashboardGateFactsCore\(\)\)/);
    expect(page).toMatch(/if \(verdict\.action === "redirect"\) redirect\(verdict\.route\)/);
    expect(page).toContain("<ParentDashboard");
  });

  it("loads NO per-kid facts (fpSites / consent policy moved to the per-kid page)", () => {
    expect(page).not.toContain("loadParentSitesForRequest");
    expect(page).not.toContain("consentPolicy");
    expect(page).not.toContain("photoConsentChildIds");
  });
});

describe("app/dashboard/kids/[id]/page.tsx — gate before data, then the per-kid facts", () => {
  const page = stripComments(read("app/dashboard/kids/[id]/page.tsx"));

  it("runs the same gate + redirect the parent page does, before any kid data", () => {
    const gate = page.indexOf('if (verdict.action === "redirect")');
    const load = page.indexOf("loadParentSitesForRequest()");
    expect(gate).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(gate);
  });

  it("threads the route id and the per-kid facts down to KidPortal", () => {
    expect(page).toMatch(/params: Promise<\{ id: string \}>/);
    expect(page).toContain("childId={id}");
    expect(page).toContain("fpSites={fpSites}");
    expect(page).toContain("photoConsentChildIds={facts.photoConsentChildIds}");
    expect(page).toContain("consentPolicy={{");
  });
});

/* ─────────────────── the shared header lockup ─────────────────── */

describe("V3BrandLockup — navigating on the dashboard, inert on /start", () => {
  it('the dashboard header links the lockup home (href="/dashboard")', () => {
    const ui = read("app/dashboard/ui.tsx");
    expect(ui).toContain('<V3BrandLockup href="/dashboard"');
  });

  it("the /start brand header passes NO href — the shared lockup does not navigate there", () => {
    const startUi = read("app/start/v3-ui.tsx");
    expect(startUi).toContain("<V3BrandLockup />");
    expect(startUi).not.toContain("<V3BrandLockup href");
  });
});
