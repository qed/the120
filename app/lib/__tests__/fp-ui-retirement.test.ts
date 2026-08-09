import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { globSync } from "tinyglobby";

import {
  FP_APP_URL,
  FP_LANDING_TARGET,
  FP_PARENT_TARGET,
  RETIRED_FP_UI_ROUTES,
} from "@/app/lib/fp/retired-ui-routes";
import { REVIEW_QUEUE_URL } from "@/app/lib/fp/notify/template";

/**
 * THE FIRST PROFIT UI RETIREMENT (v3 plan Unit 10, R16).
 *
 * The120 stopped rendering First Profit. Three separable guarantees, and the
 * retirement pattern this repo already has on file
 * (docs/solutions/best-practices/a-clean-cutover-precondition-collapses-…) says
 * the last one is the one that gets skipped: remove the surfaces, then GREP THE
 * IDENTIFIERS TO ZERO and verify the end state rather than assuming it.
 *
 *  1. The relocation is COMPLETE. `app/fp/lib` and `app/fp/content` are now
 *     `app/lib/fp` and `app/lib/fp/content`; no live module names the old paths.
 *  2. The deletion is COMPLETE. Nothing under `app/fp` renders First Profit,
 *     and no live module links a deleted route.
 *  3. Every retired URL still RESOLVES. There are 10 real families and 17 real
 *     children in production with the nurture sequence running, so a 404 on a
 *     bookmarked or mailed URL is the one outcome that is not available.
 *
 * And the pairing that a per-side pin would miss (the learning from
 * docs/solutions/logic-errors/a-retired-route-that-a-machine-calls-back-…):
 * `/fp/review` is not only a bookmark. `app/lib/fp/notify/template.ts` still
 * BUILDS it and the `/api/cron/path-notifications` cron still mails it every 10
 * minutes, so "the producer names it" and "the route resolves" are asserted in
 * ONE test rather than two independently-true ones.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");

/** Every live source file — the archive is excluded from tsconfig/eslint/vitest
 *  and is deliberately allowed to hold dangling references to deleted UI. */
const liveSources = (): string[] =>
  globSync(["app/**/*.{ts,tsx}", "scripts/**/*.ts", "next.config.*", "proxy.*", "middleware.*"], {
    cwd: ROOT,
    absolute: false,
  })
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => f !== "app/lib/__tests__/fp-ui-retirement.test.ts");

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the relocation is complete (app/fp/lib → app/lib/fp)", () => {
  it("no live module imports from the old paths — the grep-to-zero check", () => {
    const live = liveSources();
    expect(live.length).toBeGreaterThan(100); // the glob did not silently go empty
    // Every import specifier shape: `@/app/fp/lib/x`, `../app/fp/lib/x` (the
    // scripts' form) and a bare `app/fp/lib/x` all have to be caught.
    // Comment-stripped: modules legitimately EXPLAIN the move in prose ("this
    // pin used to name app/fp/lib/journey-loader.ts"), which is documentation
    // of the retirement, not a survivor of it.
    const offenders = live.filter((f) => /app\/fp\/(lib|content)\//.test(stripComments(read(f))));
    expect(offenders, "a module still names app/fp/lib or app/fp/content").toEqual([]);
  });

  it("the modules actually landed, including the two the plan named keep-not-delete", () => {
    for (const f of [
      // The backend's dependencies — the reason this was a relocation and not
      // a deletion.
      "app/lib/fp/provision-core.ts",
      "app/lib/fp/provision-rules.ts",
      "app/lib/fp/fp-username-rules.ts",
      "app/lib/fp/rate-limit-rules.ts",
      "app/lib/fp/rate-limit-store.ts",
      "app/lib/fp/parent-email/rules.ts",
      "app/lib/fp/parent-email/send.ts",
      "app/lib/fp/notify/send.ts",
      "app/lib/fp/evidence-loader.ts",
      "app/lib/fp/client-ip.ts",
      "app/lib/fp/cover-store.ts",
      "app/lib/fp/content/manifest.ts",
      // Kept deliberately: the executable spec of two applied migrations.
      "app/lib/fp/fp-save-doc-guard-rules.ts",
      "app/lib/fp/__tests__/fp-save-doc-guard-rules.test.ts",
    ]) {
      expect(existsSync(path.resolve(ROOT, f)), f).toBe(true);
    }
    expect(existsSync(path.resolve(ROOT, "app/fp/lib"))).toBe(false);
    expect(existsSync(path.resolve(ROOT, "app/fp/content"))).toBe(false);
  });

  it("the v3 front door moved with them — the signup door must not break", () => {
    // The plan flagged this explicitly: `app/start/*` and `app/lib/v3-signup/*`
    // import the rate limiter and are NOT in the `app/api/fp/*` import set the
    // relocation list was drawn from.
    for (const f of [
      "app/start/actions.ts",
      "app/lib/v3-signup/v3-signup-rules.ts",
      "app/lib/v3-signup/actions/kid-credentials.ts",
    ]) {
      expect(read(f), f).toContain("@/app/lib/fp/rate-limit");
    }
  });
});

describe("the First Profit UI is gone (R16)", () => {
  it("app/fp holds only Founders Weekend, the segment layout, and redirect stubs", () => {
    const under = globSync(["app/fp/**/*.{ts,tsx}"], { cwd: ROOT, absolute: false }).map((f) =>
      f.replaceAll("\\", "/")
    );
    expect(under.length).toBeGreaterThan(0);
    const strays = under.filter(
      (f) =>
        !f.startsWith("app/fp/fw/") &&
        f !== "app/fp/layout.tsx" &&
        !RETIRED_FP_UI_ROUTES.some((r) => f === `app/${r.file}`)
    );
    expect(strays, "a First Profit UI file survived the deletion").toEqual([]);
  });

  it("the deleted trees and the funnel card that lost its last mount are gone", () => {
    for (const f of [
      "app/fp/(app)",
      "app/fp/(auth)",
      "app/fp/components",
      // Unit 9 left this with zero live mounts (all five were v2 screens).
      "app/components/funnel/ProgressNavCard.tsx",
    ]) {
      expect(existsSync(path.resolve(ROOT, f)), f).toBe(false);
    }
  });

  it("no live module mounts ProgressNavCard or imports a deleted First Profit module", () => {
    const live = liveSources();
    const banned = [
      /ProgressNavCard/,
      /@\/app\/lib\/fp\/journey-loader/,
      /@\/app\/lib\/fp\/sync-engine/,
      /@\/app\/lib\/fp\/offline-queue/,
      /@\/app\/lib\/fp\/actions\/(sign-in|sign-out|pin|review|transition|evidence|upload-slot)/,
    ];
    const offenders = live.filter((f) => {
      const src = stripComments(read(f));
      return banned.some((re) => re.test(src));
    });
    expect(offenders).toEqual([]);
  });

  it("nothing links a deleted /fp route as an href", () => {
    // The routes still EXIST as redirect stubs, so an href is not broken — it
    // is just a hop through a page that only exists for people who already
    // have the URL. Internal links must name the destination directly.
    const live = liveSources().filter((f) => !f.startsWith("app/fp/"));
    const offenders = live.filter((f) =>
      /href=\{?["'`]\/fp(?![\w/-]*fw)/.test(stripComments(read(f)))
    );
    expect(offenders).toEqual([]);
  });
});

describe("every retired URL still resolves", () => {
  it("targets are the two honest destinations, plus the ad landing's front door", () => {
    expect(FP_APP_URL).toBe("https://firstprofit.school/");
    expect(FP_PARENT_TARGET).toBe("/dashboard");
    expect(FP_LANDING_TARGET).toBe("/start");
  });

  it.each([...RETIRED_FP_UI_ROUTES])("app/$file redirects, and redirects only", ({ file }) => {
    const rel = path.posix.join("app", file);
    expect(existsSync(path.resolve(ROOT, rel)), rel).toBe(true);
    const src = read(rel);
    // The shared constant, never a re-typed literal — one edit moves them all.
    expect(src).toMatch(/redirect\((FP_APP_URL|FP_PARENT_TARGET|FP_LANDING_TARGET)\)/);
    // redirect() throws NEXT_REDIRECT; a catch turns success into failure.
    expect(src).not.toMatch(/try\s*\{/);
    // No render, no data read, no session work.
    expect(src).not.toContain("supabase");
    expect(src).not.toContain("return (");
  });

  it("THE PAIRING: a live cron still MAILS /fp/review, so /fp/review must be a route", () => {
    // Two independently-true pins ("the stub redirects", "the sender names the
    // URL") are a contradiction no test sees. This is the one assertion that
    // names both — the learning from the /start/arrival incident, applied here
    // before it can happen a second time.
    expect(REVIEW_QUEUE_URL.endsWith("/fp/review")).toBe(true);
    expect(read("app/api/cron/path-notifications/route.ts")).toContain("@/app/lib/fp/notify/send");
    expect(read("vercel.json")).toContain("/api/cron/path-notifications");
    expect(RETIRED_FP_UI_ROUTES.map((r) => r.file)).toContain("fp/review/page.tsx");
  });

  it("THE PAIRING: the site-live notice promises a take-offline control, so the dashboard must carry one", () => {
    // `/fp/family` carried the parent unpublish/republish control, and R21's
    // mail told every published family they could use it. Unit 10 retired that
    // page; the control was RESTORED onto `/dashboard`, which is what
    // `manageUrl` (FP_PARENT_TARGET) now resolves to. Both halves are asserted
    // together — a promise and its mechanism must never be two independently
    // true pins (the /fp/review learning, applied again).
    const gateway = read("app/api/fp/site/site-gateway.ts");
    expect(stripComments(gateway)).not.toContain("/fp/family");
    expect(gateway).toContain("FP_PARENT_TARGET");
    expect(FP_PARENT_TARGET).toBe("/dashboard");

    const notice = read("app/lib/fp/parent-email/rules.ts");
    expect(notice).toContain("take the page offline any time from your family dashboard");

    // The mechanism the sentence names: the parent dashboard mounts the
    // control, and the control drives the parent-scoped core through its Server
    // Action. fpv03 U4 relocated it from the apps launcher to the Account
    // Details page (still under /dashboard, still what FP_PARENT_TARGET resolves
    // to — the header menu links to it), so the promise stays reachable.
    expect(read("app/dashboard/AccountDetails.tsx")).toContain("KidSite");
    const panel = read("app/dashboard/KidSite.tsx");
    expect(panel).toContain("setFpSitePublishedAction");
    expect(panel).toContain("Take the page offline");
    expect(read("app/lib/fp/actions/fp-site-parent.ts")).toContain(
      "@/app/lib/fp/fp-site-parent-core"
    );
  });

  it("the offline fallback's only link points at Founders Weekend, not the retired /fp", () => {
    // FwPwa is the only service-worker registrar left (PathPwa went with the
    // First Profit UI), so the guide iPads are this page's whole audience and
    // "Try again" must reload THEIR shell. A pin, because repointing a link is
    // a real behaviour change that no other assertion would notice.
    const page = read("app/offline/page.tsx");
    expect(page).toContain('href="/fp/fw"');
    // And nothing else: exactly one anchor, so a second, retired destination
    // cannot creep back in beside it.
    expect(page.match(/href="/g) ?? []).toHaveLength(1);
    expect(page).not.toMatch(/href="\/fp"/);
  });

  it("the /fp gate passes: a signed-out parent reaches their redirect, not the kid's door", () => {
    // The proxy used to send every session-less /fp/* request to /fp/sign-in.
    // With the UI retired that would bounce a PARENT holding /fp/family to the
    // KID's app — the exact strand the two-destination split exists to avoid.
    const proxy = stripComments(read("app/lib/supabase/proxy-rules.ts"));
    expect(proxy).toContain('if (pathname === "/fp" || pathname.startsWith("/fp/")) return "pass"');
    expect(proxy).not.toContain("path-login");
  });
});

describe("what this unit deliberately did NOT retire", () => {
  it("the backend firstprofit.school talks to is untouched", () => {
    for (const f of [
      "app/api/fp/login/route.ts",
      "app/api/fp/signup/route.ts",
      "app/api/fp/handoff/exchange/route.ts",
      "app/api/fp/cover/route.ts",
      "app/api/fp/site/route.ts",
    ]) {
      expect(existsSync(path.resolve(ROOT, f)), f).toBe(true);
    }
  });

  it("Founders Weekend still serves — its invite and board URLs are token handshakes", () => {
    // `/fp/fw` shares the URL prefix and nothing else: it is a staff/guide tool
    // with no counterpart in the first-profit repo to redirect to, and two of
    // its routes are named by URL BUILDERS that survive this unit. A redirect
    // stub at either would delete the handshake, not preserve a bookmark.
    for (const f of [
      "app/fp/fw/(auth)/invite/[token]/page.tsx",
      "app/fp/fw/board/[token]/page.tsx",
      "app/fp/fw/board/[token]/feed/route.ts",
    ]) {
      expect(existsSync(path.resolve(ROOT, f)), f).toBe(true);
    }
    expect(read("app/lib/fp/fw-guide-invite-email.ts")).toContain("/fp/fw/invite/");
    expect(read("scripts/fw-ops.ts")).toContain("/fp/fw/board/");
  });
});
