import { describe, expect, it } from "vitest";

import {
  SURFACE,
  readRepoFile as read,
} from "@/app/lib/__tests__/helpers/dashboard-surfaces";

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
  const card = stripComments(read(SURFACE.firstProfitCard));

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
  const app = stripComments(read(SURFACE.parentDashboard));

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

/* ─────────────────── the shared per-kid route shell ─────────────────── */

// The auth gate, the ownership lookup and the not-found fallback used to be
// duplicated verbatim in KidPortal and KidAccount, and were pinned twice below.
// They live in ONE component now, so they are pinned ONCE here — the point of
// the extraction is that there is a single implementation to review, and the
// pins have to say so or they quietly re-license a second copy.
describe("KidRouteShell — the ONE ownership/chrome implementation both per-kid routes mount", () => {
  const shell = stripComments(read(SURFACE.kidRouteShell));

  it("picks the child by id from the RLS-scoped store, with a not-found fallback", () => {
    expect(shell).toContain("children.find((c) => c.id === childId)");
    expect(shell).toContain("?? null");
    expect(shell).toContain("Kid not found");
  });

  it("owns the client auth gate and links back to the parent dashboard", () => {
    // `ready &&` is load-bearing: a bare `!session` would flash SignIn while the
    // store is still resolving the session.
    expect(shell).toContain("if (ready && !session) return <SignIn");
    expect(shell).toContain('href="/dashboard"');
  });

  it("keeps loading ahead of not-found, and calls the body only for a matched child", () => {
    const gate = shell.indexOf("if (ready && !session)");
    const find = shell.indexOf("children.find(");
    const loading = shell.indexOf("!ready ?");
    const notFound = shell.indexOf("!child ?");
    const bodyCall = shell.indexOf("body(child)");
    expect(gate).toBeGreaterThan(-1);
    expect(find).toBeGreaterThan(gate); // no lookup for a signed-out visitor
    expect(notFound).toBeGreaterThan(loading); // a loading family is an empty one
    expect(bodyCall).toBeGreaterThan(notFound); // the body is the LAST branch
  });

  it("offers exactly two surface treatments, so a third look cannot be invented", () => {
    expect(shell).toMatch(/KidRouteSurface = "kid" \| "parent"/);
    expect(shell).toContain('kid: "v3-grain min-h-screen bg-v3-cream text-v3-ink"');
    expect(shell).toContain('parent: "min-h-screen bg-white text-v3-ink"');
  });

  it("carries the page chrome once: header, wide main, and the back link", () => {
    expect(shell).toContain("<AppHeader items={ACCOUNT_MENU} />");
    expect(shell).toContain("mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-12");
    expect(shell).toContain("All kids");
  });
});

/* ── THE BODY RENDER PROPS MUST NOT CALL HOOKS ──
 *
 * `body` is called as a PLAIN FUNCTION from inside a conditional branch of
 * KidRouteShell's render (`!ready ? ... : !child ? ... : body(child)`). Any hook
 * a body called would therefore run on the SHELL's fiber, at a hook position
 * only reached on the child-found branch. Kid found (N hooks run) -> the store's
 * `children` changes so `child` becomes null (an RLS refetch, another tab
 * archiving the kid, a load race) -> the ternary skips the body -> the shell's
 * fiber sees fewer hooks than last render -> React throws and the WHOLE per-kid
 * route crashes for a real parent, not just the body.
 *
 * Neither body calls a hook today. This pin is what keeps it that way. It scans
 * ONLY the body closure's own source region, because both files may legitimately
 * call hooks OUTSIDE the body (in their component function), and a whole-file
 * scan would either be a false alarm there or have to be weakened into
 * uselessness. */

/** Hook shapes, both the named ones this repo actually uses and the general form
 *  every custom hook takes. */
const HOOK_PATTERNS: ReadonlyArray<RegExp> = [
  /\buseState\s*\(/,
  /\buseEffect\s*\(/,
  /\buseLayoutEffect\s*\(/,
  /\buseMemo\s*\(/,
  /\buseRef\s*\(/,
  /\buseCallback\s*\(/,
  /\buseReducer\s*\(/,
  /\buseContext\s*\(/,
  /\buseTransition\s*\(/,
  /\buseDashboard\s*\(/,
  /\buse[A-Z]\w*\s*\(/,
];

/**
 * Slice out one arrow-function body's own source: from the line declaring it to
 * the first following line that is exactly its own indentation + "};".
 * Prettier formats this file set, so that terminator is reliable — and if it
 * ever stops being, this throws rather than silently scanning nothing (a pin
 * that cannot fail is worse than no pin).
 */
function bodyRegion(src: string, decl: string): string {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(`body declaration not found: ${decl}`);
  const lineStart = src.lastIndexOf("\n", start) + 1;
  const indent = src.slice(lineStart, start);
  const end = src.indexOf(`\n${indent}};`, start);
  if (end === -1) throw new Error(`could not find the end of the body: ${decl}`);
  return src.slice(start, end);
}

describe("the KidRouteShell body render props call NO hooks (or the route crashes)", () => {
  const WHY =
    "A hook inside a KidRouteShell `body` runs on the SHELL's fiber, at a position only " +
    "reached on the child-found branch. When the child stops matching (RLS refetch, another " +
    "tab archiving the kid, a load race) the ternary skips the body, the hook count drops, " +
    "and React crashes the WHOLE per-kid route for a real parent. Move the state into a " +
    "MODULE-SCOPE component mounted as JSX instead, so React gives it its own fiber.";

  const bodies: ReadonlyArray<[label: string, region: string]> = [
    [
      "KidPortal.tsx kidBody",
      bodyRegion(stripComments(read(SURFACE.kidPortal)), "const kidBody = (c: Child) => {"),
    ],
    [
      "KidAccount.tsx body",
      bodyRegion(
        stripComments(read(SURFACE.kidAccount)),
        "const body = (c: Child) => {"
      ),
    ],
  ];

  // Guard the SCAN itself: a region that failed to capture the real body would
  // pass every hook assertion below while checking nothing.
  it("each scanned region really is the body (not an empty or runaway slice)", () => {
    const [portal, account] = bodies;
    expect(portal[1]).toContain("<FirstProfitCard child={c} />");
    expect(portal[1]).not.toContain("export default function KidPortal");
    expect(account[1]).toContain("<KidCredentials");
    expect(account[1]).not.toContain("return <KidRouteShell");
  });

  for (const [label, region] of bodies) {
    it(`${label} contains no hook call`, () => {
      for (const pattern of HOOK_PATTERNS) {
        const hit = pattern.exec(region);
        expect(
          hit ? `${label} calls ${hit[0].trim()} — ${WHY}` : null,
          `${label} must not call hooks. ${WHY}`
        ).toBeNull();
      }
    });
  }
});

/* ─────────────────── the per-kid portal ─────────────────── */

describe("KidPortal — the per-kid apps launcher, picked by id", () => {
  const app = stripComments(read(SURFACE.kidPortal));

  it("gets its ownership check from the shared shell, in the KID's cream surface", () => {
    expect(app).toContain('<KidRouteShell childId={childId} surface="kid" body={kidBody} />');
    // It must NOT keep a private second copy of the control.
    expect(app).not.toContain("children.find(");
    expect(app).not.toContain("useDashboard(");
  });

  it("mounts the extracted FirstProfitCard plus the Gauntlet and Math rows", () => {
    expect(app).toContain("<FirstProfitCard child={c} />");
    expect(app).toContain("GAUNTLET");
    expect(app).toContain("Math Academy");
    expect(app).toContain("Coming soon");
    expect(app).toMatch(/&rsquo;s Dashboard/);
  });

  // THE KID'S PAGE IS THE KID'S. The parent controls moved to their own route;
  // the portal keeps only a link across. Mirrored by the KidAccount pins below,
  // so neither audience's surface can quietly absorb the other's.
  it("mounts NO parent controls, only a link to this kid's account page", () => {
    expect(app).not.toContain("<KidCredentials");
    expect(app).not.toContain("<KidSite");
    expect(app).toContain("href={`/dashboard/kids/${c.id}/account`}");
  });
});

/* ─────────────────── the per-kid ACCOUNT page ─────────────────── */

describe("KidAccount — one kid's parent controls, picked by id", () => {
  const app = stripComments(read(SURFACE.kidAccount));

  it("gets the SAME ownership check from the SAME shell, in the PARENT's white surface", () => {
    expect(app).toContain('<KidRouteShell childId={childId} surface="parent" body={body} />');
    expect(app).not.toContain("children.find(");
    expect(app).not.toContain("useDashboard(");
  });

  it("mounts the per-kid controls verbatim (KidCredentials + KidSite) for the one child", () => {
    expect(app).toContain("<KidCredentials");
    expect(app).toContain("<KidSite");
  });

  it("mounts no apps", () => {
    expect(app).not.toContain("FirstProfitCard");
    expect(app).not.toContain("GAUNTLET");
  });
});

/* The two surfaces must stay visibly different: cream + grain is the kid's
 * space, white is the parent's. Nothing else in the suite would notice the day
 * one of them silently started looking like the other. */
describe("the two per-kid audiences keep their own wrapper treatment", () => {
  const portal = stripComments(read(SURFACE.kidPortal));
  const account = stripComments(read(SURFACE.kidAccount));

  it('the kid\'s portal asks for surface="kid" and the account page for surface="parent"', () => {
    expect(portal).toContain('surface="kid"');
    expect(portal).not.toContain('surface="parent"');
    expect(account).toContain('surface="parent"');
    expect(account).not.toContain('surface="kid"');
  });

  it("neither route hand-rolls a wrapper className of its own", () => {
    for (const src of [portal, account]) {
      expect(src).not.toContain("min-h-screen");
      expect(src).not.toContain("v3-grain");
      expect(src).not.toContain("bg-v3-cream");
    }
  });
});

/* ─────────────────── the three server pages ─────────────────── */

describe("app/dashboard/page.tsx — the parent list loads only the gate", () => {
  const page = stripComments(read("app/dashboard/page.tsx"));

  it("keeps the gate + redirect and renders ParentDashboard", () => {
    expect(page).toMatch(/cache\(\(\) => loadDashboardGateFactsCore\(\)\)/);
    expect(page).toMatch(/if \(verdict\.action === "redirect"\) redirect\(verdict\.route\)/);
    expect(page).toContain("<ParentDashboard");
  });

  it("loads NO per-kid READS (fpSites / consent policy live on the account page)", () => {
    expect(page).not.toContain("loadParentSitesForRequest");
    expect(page).not.toContain("consentPolicy");
    expect(page).not.toContain("photoConsentChildIds");
  });

  // The Path bars on the kid cards. These counts are NOT an extra read: the gate
  // facts the redirect already awaited carry them, so the bars cost nothing.
  it("threads the verified counts the gate already loaded into the kid cards", () => {
    expect(page).toContain("verifiedTaskCounts={facts.verifiedTaskCounts}");
  });
});

describe("app/dashboard/kids/[id]/page.tsx — the kid's page: gate, and no kid reads", () => {
  const page = stripComments(read("app/dashboard/kids/[id]/page.tsx"));

  it("runs the same gate + redirect the parent page does", () => {
    expect(page).toMatch(/cache\(\(\) => loadDashboardGateFactsCore\(\)\)/);
    expect(page).toMatch(/if \(verdict\.action === "redirect"\) redirect\(verdict\.route\)/);
  });

  it("threads only the route id — the parent-control facts moved to the account page", () => {
    expect(page).toMatch(/params: Promise<\{ id: string \}>/);
    expect(page).toContain("childId={id}");
    expect(page).not.toContain("loadParentSitesForRequest");
    expect(page).not.toContain("consentPolicy");
    expect(page).not.toContain("photoConsentChildIds");
  });
});

describe("app/dashboard/kids/[id]/account/page.tsx — gate before data, then the per-kid facts", () => {
  const page = stripComments(read("app/dashboard/kids/[id]/account/page.tsx"));

  // The ordering that matters: nothing about a kid is read for a request the
  // gate is about to bounce.
  it("runs the gate + redirect BEFORE any kid data loads", () => {
    const gate = page.indexOf('if (verdict.action === "redirect")');
    const load = page.indexOf("loadParentSitesForRequest()");
    expect(gate).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(gate);
  });

  it("threads the route id and the per-kid facts down to KidAccount", () => {
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
    const ui = read(SURFACE.ui);
    expect(ui).toContain('<V3BrandLockup href="/dashboard"');
  });

  it("the /start brand header passes NO href — the shared lockup does not navigate there", () => {
    const startUi = read("app/start/v3-ui.tsx");
    expect(startUi).toContain("<V3BrandLockup />");
    expect(startUi).not.toContain("<V3BrandLockup href");
  });
});
