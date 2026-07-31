import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { globSync } from "tinyglobby";

import { CTA_SOURCES, FUNNEL_CTA_LABEL } from "@/app/lib/cta-source";

/**
 * R10, R13, R18 — the sitewide reroute, enforced.
 *
 * A source scan, because `environment: "node"` cannot render a page. Anchored
 * on SHAPE rather than spellings, comments stripped, and paths resolved from
 * this file rather than `process.cwd()` — the accumulated rules from the
 * source-scanning doc's six rounds.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const sources = () =>
  globSync(["app/**/*.tsx"], { cwd: ROOT, absolute: false })
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => !f.includes("__tests__"));

/**
 * The call sites that deliberately KEEP the account modal.
 *
 * Not "marketing surfaces we forgot": the Gauntlet's two are a functional
 * tournament-entry gate, a stated non-goal of the reroute. `SignIn.tsx` left
 * this list 2026-07-30 (item 39): "Create an account" on the sign-in page
 * now routes to /start — creating an account IS starting the application.
 */
const PRESERVED = [
  "app/gauntlet/ComingSoon.tsx",
  "app/gauntlet/GauntletGame.tsx",
];

describe("R10 — no marketing surface opens the account modal", () => {
  it("renders JoinButton in exactly the three preserved files, and nowhere else", () => {
    const offenders = sources().filter((f) => {
      if (PRESERVED.includes(f) || f.endsWith("components/JoinButton.tsx")) return false;
      return /<JoinButton[\s/>]/.test(stripComments(read(f)));
    });
    expect(offenders).toEqual([]);
  });

  it("catches the aliased import a name-anchored scan would walk past", () => {
    // The scan above matches the literal identifier. `import JB from
    // ".../JoinButton"` then `<JB />` renders the same modal and would sail
    // through — the documented "a spelling you did not guess" failure, in its
    // import-alias costume. Anchor on the MODULE, which cannot be renamed.
    const offenders = sources().filter((f) => {
      if (PRESERVED.includes(f) || f.endsWith("components/JoinButton.tsx")) return false;
      const code = stripComments(read(f));
      return /import\s+[\w{},\s*]+\s+from\s+["'][^"']*components\/JoinButton["']/.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it("catches a marketing surface reaching the modal hook directly", () => {
    // JoinButton is not the only door: `useAccountModal()` opens it too, which
    // is exactly what GauntletGame does on purpose.
    const offenders = sources().filter((f) => {
      if (PRESERVED.includes(f)) return false;
      // The modal's own provider, and JoinButton — which IS the button the
      // three preserved sites render.
      if (f.startsWith("app/components/account/")) return false;
      if (f.endsWith("components/JoinButton.tsx")) return false;
      return /useAccountModal\s*\(/.test(stripComments(read(f)));
    });
    expect(offenders).toEqual([]);
  });

  it("keeps the preserved sites — asserted BY COUNT so a sweep cannot thin them", () => {
    // A later "remove the last JoinButtons" pass would otherwise delete the
    // Gauntlet's entry gate without a test noticing.
    for (const f of PRESERVED) {
      const code = stripComments(read(f));
      expect(
        (code.match(/<JoinButton[\s/>]/g) ?? []).length,
        `${f} lost its preserved JoinButton`
      ).toBeGreaterThanOrEqual(1);
    }
    // The Gauntlet's direct modal call is separate from its JoinButton.
    const gauntlet = stripComments(read("app/gauntlet/GauntletGame.tsx"));
    expect(gauntlet).toMatch(/openAccountModal\s*\(/);
  });

  it("leaves signUp() reachable — exactly one path, in the modal", () => {
    const withSignUp = sources().filter((f) => /\.signUp\s*\(/.test(stripComments(read(f))));
    expect(withSignUp).toEqual(["app/components/account/AccountModal.tsx"]);
  });
});

describe("R18 — no 'Book a call' on the logged-out marketing site", () => {
  /**
   * Post-C1 surfaces where the call is deliberately still offered.
   *
   * `app/dashboard/` is NOT excluded wholesale: `SignIn.tsx` is what a
   * logged-OUT visitor sees when they click "Log in" from any marketing page,
   * so a path-prefix exclusion would let "Book a call" reappear on a
   * logged-out surface (adversarial review). Directory location is not
   * audience.
   */
  const POST_C1 = ["app/fp/", "app/crm/"];
  const LOGGED_OUT_UNDER_DASHBOARD = ["app/dashboard/SignIn.tsx"];

  const isPostC1 = (f: string) =>
    POST_C1.some((p) => f.startsWith(p)) ||
    (f.startsWith("app/dashboard/") && !LOGGED_OUT_UNDER_DASHBOARD.includes(f));

  it("appears on no logged-out marketing surface", () => {
    const offenders = sources().filter((f) => {
      if (isPostC1(f)) return false;
      return /book a call/i.test(stripComments(read(f)));
    });
    expect(offenders).toEqual([]);
  });

  it("covers the signed-out sign-in page, which lives under app/dashboard/", () => {
    // Pins the carve-out's reason: if SignIn.tsx ever moves or is renamed,
    // this reddens rather than silently widening the exclusion.
    expect(sources()).toContain("app/dashboard/SignIn.tsx");
    expect(isPostC1("app/dashboard/SignIn.tsx")).toBe(false);
    expect(isPostC1("app/dashboard/DashboardApp.tsx")).toBe(true);
  });

  it("keeps the helper and the label for the post-C1 surfaces that will use them", () => {
    // R18 removes the CTA, not the capability: the call is offered after C1,
    // on the dashboard and in nurture email.
    const lib = read("app/lib/cta-source.ts");
    expect(lib).toContain("attributedBookingUrl");
    expect(read("app/2026-27/cta-source.ts")).toMatch(/ctaLabels/);
  });
});

describe("R13 — one label into the funnel", () => {
  it("is what StartCta defaults to", () => {
    expect(FUNNEL_CTA_LABEL).toBe("Start Here →");
    expect(read("app/components/StartCta.tsx")).toContain("children = FUNNEL_CTA_LABEL");
  });

  it("leaves no 'Join the 120' button label on a rerouted surface", () => {
    // The nav's wordmark and prose may still say it; a CTA into the funnel
    // may not. Anchored on the JSX child of a StartCta, not on the phrase.
    const offenders = sources().filter((f) =>
      /<StartCta[^>]*>[\s]*Join the 120/.test(stripComments(read(f)))
    );
    expect(offenders).toEqual([]);
  });
});

describe("every rerouted CTA is attributed", () => {
  it("passes a source from the closed vocabulary at every StartCta call site", () => {
    const pattern = /<StartCta\s+source=\{"([^"]+)"\}/g;
    let found = 0;
    for (const f of sources()) {
      const code = stripComments(read(f));
      if (!code.includes("<StartCta")) continue;
      for (const m of code.matchAll(pattern)) {
        expect(CTA_SOURCES, `${f}: ${m[1]}`).toContain(m[1]);
        found++;
      }
      // A StartCta whose source is a bare literal is checked above; one built
      // from an expression (the group pages' `groupCtaSource(...)`) is typed.
      const literalCount = (code.match(/<StartCta\s+source=\{"/g) ?? []).length;
      const totalCount = (code.match(/<StartCta[\s]/g) ?? []).length;
      expect(totalCount, `${f} has an unattributed StartCta`).toBeGreaterThanOrEqual(
        literalCount
      );
    }
    expect(found).toBeGreaterThan(0);
  });
});
