/**
 * The fpv04 U8 retirement, pinned (R7).
 *
 * The failure mode of this kind of work is a PREFIX SWEEP: `/start` and
 * `/dashboard` each carry sub-surfaces that must not retire with their root,
 * and one of them is a Stripe `success_url` a family lands on seconds after
 * being charged. This repo has already retired that URL by accident once. So
 * the kept list is asserted as loudly as the retired one.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FP_ADD_KID_URL,
  FP_PARENT_DASHBOARD_URL,
  FP_SIGNUP_URL,
  KEPT_UNDER_RETIRED_PREFIXES,
  RETIRED_PARENT_SURFACE_FILES,
  retiredStartTarget,
} from "../retired-parent-surfaces";

const APP = join(process.cwd(), "app");
const read = (rel: string): string => readFileSync(join(APP, rel), "utf8");

describe("where the retired surfaces point", () => {
  it("points at First Profit, on First Profit's origin, and nowhere else", () => {
    for (const url of [FP_PARENT_DASHBOARD_URL, FP_SIGNUP_URL, FP_ADD_KID_URL]) {
      expect(new URL(url).origin).toBe("https://firstprofit.school");
    }
    expect(FP_PARENT_DASHBOARD_URL).toBe("https://firstprofit.school/parent");
    expect(FP_SIGNUP_URL).toBe("https://firstprofit.school/signup");
  });

  it("carries the add-a-kid intent, and only that", () => {
    // `/start?step=kid` was the dashboard's add-another-kid CTA; First Profit
    // re-enters its own track at `/signup?add=1` (fpv04 U6b-iii).
    expect(retiredStartTarget("kid")).toBe(FP_ADD_KID_URL);
    expect(retiredStartTarget(" kid ")).toBe(FP_ADD_KID_URL);
    // Everything else — including the steps of the retired flow — starts at the
    // beginning rather than deep-linking into a track that has moved.
    for (const step of [null, undefined, "", "parent", "story", "cover", "ready", "../evil"]) {
      expect(retiredStartTarget(step), String(step)).toBe(FP_SIGNUP_URL);
    }
  });
});

describe("the retired front doors", () => {
  it("each one exists and does nothing but redirect", () => {
    for (const file of RETIRED_PARENT_SURFACE_FILES) {
      const src = read(file);
      expect(src, file).toMatch(/redirect\(/);
      // A retired page must not render a surface or read data on the way out.
      expect(src, file).not.toMatch(/<V3Flow|<ParentDashboard/);
    }
  });
});

describe("⚠ what the prefix sweep must NOT take", () => {
  it("every kept surface still exists", () => {
    for (const file of KEPT_UNDER_RETIRED_PREFIXES) {
      expect(existsSync(join(APP, file)), file).toBe(true);
    }
  });

  it("Stripe's success_url is still a real page, not a redirect stub", () => {
    // deposit-core.ts builds `${origin}/start/arrival?child=<id>`. A family
    // lands here seconds after being charged, normally before the webhook has
    // committed, so this page carries the poll that waits for it.
    const arrival = read("start/arrival/page.tsx");
    expect(arrival).toMatch(/ArrivalWatch|arrival/i);
    expect(read("../app/lib/funnel/deposit-core.ts")).toContain("/start/arrival");
  });

  it("the per-kid parent CONTROLS are still reachable and still self-authenticating", () => {
    // The R21 site-live notice links straight here (fpParentKidTarget), and
    // First Profit has no per-kid controls page yet. It renders its own SignIn
    // swap through KidRouteShell, so retiring the /dashboard ROOT does not
    // strand a signed-out parent who arrives from that email.
    const account = read("dashboard/kids/[id]/account/page.tsx");
    expect(account).toContain("KidAccount");
    expect(read("dashboard/kids/[id]/KidRouteShell.tsx")).toContain("<SignIn />");
  });
});
