import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { globSync } from "tinyglobby";

import {
  RETIRED_V2_ROUTE_FILES,
  V2_DEEP_ROUTE_TARGET,
} from "@/app/lib/v3-signup/v2-deep-routes";
import { V3_FLOW_PATH, v3RemapRoute } from "@/app/lib/v3-signup/remap-rules";

/**
 * THE ARCHIVE, THE SWAP, AND THE SIX REDIRECTS (v3 plan Unit 9, R15/R17).
 *
 * Three separable guarantees, all of which the plan named as "the test is the
 * suite being green" and none of which the suite would actually catch on its
 * own:
 *
 *  1. The archive is INERT. `archive/**` is excluded from tsconfig, eslint and
 *     vitest, and no live module imports from it. The exclusion is what makes
 *     the archive possible (it still imports live modules, so a compiled
 *     archive breaks the build); the import ban is what stops the exclusion
 *     from becoming a hole — a live file importing an unchecked, unlinted,
 *     untested module would be worse than no archive at all.
 *  2. `/start` IS the v3 flow, and `/start/v3` is gone.
 *  3. Every retired v2 deep route still resolves — and `/start/arrival`, which
 *     is NOT one of them, is still a real page. It is Stripe's `success_url`
 *     with live checkout in front of it, so a redirect stub there strands a
 *     family who has just paid on a dashboard that cannot see their payment yet.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");

describe("the archive is inert (R15)", () => {
  it("holds the v2 flow, whole", () => {
    for (const f of [
      "archive/new-user-v2/page.tsx",
      "archive/new-user-v2/StartFlow.tsx",
      "archive/new-user-v2/children/ChildrenFlow.tsx",
      "archive/new-user-v2/child/[childId]/MiniAppShell.tsx",
      "archive/new-user-v2/child/[childId]/MergedFormSections.tsx",
      "archive/new-user-v2/next-steps/NextStepsFlow.tsx",
      "archive/new-user-v2/arrival/ArrivalFlow.tsx",
      "archive/new-user-v2/review/page.tsx",
      "archive/new-user-v2/waitlist/page.tsx",
    ]) {
      expect(existsSync(path.resolve(ROOT, f)), f).toBe(true);
    }
  });

  it("is excluded from tsconfig, eslint AND vitest — all three, or the build breaks", () => {
    expect(JSON.parse(read("tsconfig.json")).exclude).toContain("archive");
    expect(read("eslint.config.mjs")).toContain('"archive/**"');
    // vitest's `include` is an allowlist, so exclusion is the absence of a
    // glob — asserted as an absence rather than assumed.
    expect(read("vitest.config.ts")).not.toMatch(/^\s*"archive\//m);
  });

  it("NO live code imports from archive/ — the grep-to-zero check", () => {
    const live = globSync(["app/**/*.{ts,tsx}", "scripts/**/*.ts"], {
      cwd: ROOT,
      absolute: false,
    })
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => f !== "app/lib/__tests__/v3-archive-and-redirects.test.ts");
    expect(live.length).toBeGreaterThan(100); // the glob did not silently go empty
    // Every import specifier, however written: `@/archive/x`, `archive/x`, and
    // `../../archive/x` all have to be caught. A path-segment test on the
    // extracted specifier does that; a prefix test on the raw source does not,
    // and the relative form is exactly the one a future refactor would emit.
    const importsArchive = (src: string): boolean => {
      const specifiers = [...src.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)];
      return specifiers.some(([, spec]) => /(^|\/)archive\//.test(spec));
    };
    const offenders = live.filter((f) => importsArchive(read(f)));
    expect(offenders, "a live module imports from archive/ — move it or inline it").toEqual([]);
  });
});

describe("v3 owns /start (R15)", () => {
  it("the flow path is the bare front door, and the old nested route is gone", () => {
    expect(V3_FLOW_PATH).toBe("/start");
    expect(existsSync(path.resolve(ROOT, "app/start/v3"))).toBe(false);
    // Every producer builds from the table, so this one constant IS the swap.
    expect(v3RemapRoute({ screen: "v3_flow", step: "kid" })).toBe("/start?step=kid");
  });

  it("app/start/page.tsx is the v3 page, not the archived capture flow", () => {
    const page = read("app/start/page.tsx");
    expect(page).toContain("V3Flow");
    expect(page).not.toContain("StartFlow");
    // The go-live lever and its holding state were removed by owner decision:
    // /start is live on deploy. The BEHAVIORAL guarantee is
    // app/lib/v3-signup/__tests__/v3-start-always-live.test.ts; this is only
    // the source-level companion that the holding branch is gone for good.
    expect(page).not.toContain("HoldingPage");
    expect(existsSync(path.resolve(ROOT, "app/start/HoldingPage.tsx"))).toBe(false);
  });

  it("no live source still points at /start/v3", () => {
    const live = globSync(["app/**/*.{ts,tsx}", "scripts/**/*.ts"], {
      cwd: ROOT,
      absolute: false,
    })
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => f !== "app/lib/__tests__/v3-archive-and-redirects.test.ts");
    // Comment-stripped: three modules mention `app/start/v3` in prose,
    // explaining the move that this test exists to confirm happened.
    const offenders = live.filter((f) =>
      read(f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
        .includes("start/v3")
    );
    expect(offenders).toEqual([]);
  });
});

describe("the retired v2 deep routes still resolve (R17)", () => {
  it("targets the dashboard, read FROM the remap table rather than typed twice", () => {
    expect(V2_DEEP_ROUTE_TARGET).toBe("/dashboard");
    expect(V2_DEEP_ROUTE_TARGET).toBe(v3RemapRoute({ screen: "dashboard" }));
  });

  it("names every URL a bookmark or a sent email could carry", () => {
    // The two mail senders are the reason this list is not "whatever we
    // remembered": app/crm/lib/offer-rules.ts mails /start/next-steps, and
    // app/lib/funnel/actions/full-core.ts mails /start/child/<id>/review.
    expect(read("app/crm/lib/offer-rules.ts")).toContain("/start/next-steps");
    expect(read("app/lib/funnel/actions/full-core.ts")).toContain("/start/child/");
    expect(read("app/api/checkout/route.ts")).toContain("/start/waitlist");
  });

  it("does NOT retire /start/arrival: Stripe's success_url points at a LIVE page", () => {
    // The pairing that makes this a real guarantee rather than a preference:
    // deposit-core still builds the URL, checkout is still reachable from the
    // dashboard, so the page it names must be a page — not a redirect stub.
    expect(read("app/lib/funnel/deposit-core.ts")).toContain("/start/arrival");
    expect(read("app/dashboard/DashboardApp.tsx")).toContain("/api/checkout");
    expect(RETIRED_V2_ROUTE_FILES).not.toContain("start/arrival/page.tsx");

    const page = read("app/start/arrival/page.tsx");
    expect(page).toContain("ArrivalWatch");
    expect(page).not.toContain("V2_DEEP_ROUTE_TARGET");
    // The bridge itself: the screen polls the live arrival API through the
    // tested loop, and neither file reaches into `archive/` for it (the
    // grep-to-zero check above covers every live file, this names the two that
    // were re-derived from the archived component and would be the tempting
    // place to import it).
    const watch = read("app/start/arrival/ArrivalWatch.tsx");
    expect(watch).toContain("runArrivalPoll");
    expect(read("app/lib/funnel/arrival-poll.ts")).toContain("/api/funnel/arrival");
    // Comment-stripped: both files MENTION the archive in prose, explaining
    // what was re-derived and what stayed behind. Neither may import from it.
    for (const src of [page, watch]) {
      expect(
        src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
      ).not.toContain("archive/");
    }
  });

  it.each([...RETIRED_V2_ROUTE_FILES])("app/%s redirects, and redirects only", (rel) => {
    const file = path.posix.join("app", rel);
    expect(existsSync(path.resolve(ROOT, file)), file).toBe(true);
    const src = read(file);
    // The shared constant, never a re-typed literal — one edit moves all six.
    expect(src).toContain("V2_DEEP_ROUTE_TARGET");
    expect(src).toContain("redirect(V2_DEEP_ROUTE_TARGET)");
    // redirect() throws NEXT_REDIRECT; a catch turns success into failure.
    expect(src).not.toMatch(/try\s*\{/);
    // No render, no data read, no session work — a redirect page that does
    // anything else is a page, and pages rot.
    expect(src).not.toContain("supabase");
    expect(src).not.toContain("return (");
  });
});
