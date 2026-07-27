import { describe, expect, it } from "vitest";

import {
  CTA_GROUP_PARAM,
  CTA_SOURCES,
  CTA_SOURCE_PARAM,
  FUNNEL_CTA_LABEL,
  attributedBookingUrl,
  funnelEntryHref,
  groupCtaSource,
  isCtaSource,
  readCtaSource,
  SRC_MARKER,
} from "@/app/lib/cta-source";
import { groups } from "@/app/lib/site";

/**
 * R10–R13, R18. The marker's whole point is the READ-BACK — `SRC_MARKER` has
 * been applied at two call sites since launch and read back nowhere.
 */

describe("the source vocabulary (R11)", () => {
  it("is the twelve documented markers, with no duplicates", () => {
    expect([...CTA_SOURCES]).toEqual([
      "home",
      "lp-athletes",
      "lp-founders",
      "lp-makers",
      "lp-scholars",
      "lp-givers",
      "fp-generic",
      "2026-27",
      "tuition",
      "faq",
      "parents",
      "scholars-legacy",
    ]);
    expect(new Set(CTA_SOURCES).size).toBe(CTA_SOURCES.length);
  });

  it("covers every group with an lp- marker", () => {
    for (const g of groups) {
      expect(CTA_SOURCES, g.slug).toContain(`lp-${g.slug}`);
      expect(groupCtaSource(g.slug)).toBe(`lp-${g.slug}`);
    }
  });

  it("falls back to home for a slug that is not a group, never inventing a bucket", () => {
    expect(groupCtaSource("not-a-group")).toBe("home");
    expect(groupCtaSource("")).toBe("home");
  });

  it("recognizes members and refuses everything else", () => {
    for (const s of CTA_SOURCES) expect(isCtaSource(s)).toBe(true);
    for (const bad of ["", "Home", "lp-athlete", "HOME", null, undefined, 0, {}, ["home"]]) {
      expect(isCtaSource(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("funnelEntryHref (R10, R12)", () => {
  it("builds /start with the marker for every source", () => {
    for (const s of CTA_SOURCES) {
      expect(funnelEntryHref(s)).toBe(`/start?${CTA_SOURCE_PARAM}=${encodeURIComponent(s)}`);
    }
  });

  it("adds the group hint when asked, and omits it otherwise", () => {
    expect(funnelEntryHref("lp-makers", { group: "makers" })).toBe(
      "/start?src=lp-makers&g=makers"
    );
    expect(funnelEntryHref("home")).not.toContain(`${CTA_GROUP_PARAM}=`);
  });

  it("never emits two src params, even composed twice", () => {
    // A wrapper plus a call site both reaching for the marker must produce one
    // bucket, not a double-counted one.
    const once = funnelEntryHref("home");
    const params = new URLSearchParams(once.split("?")[1]);
    expect(params.getAll(CTA_SOURCE_PARAM)).toHaveLength(1);
  });
});

describe("readCtaSource — the read-back R11 exists for", () => {
  it("parses a marker from URLSearchParams and from a Server Component's params object", () => {
    expect(readCtaSource(new URLSearchParams("src=lp-givers"))).toBe("lp-givers");
    expect(readCtaSource({ src: "tuition" })).toBe("tuition");
  });

  it("takes the FIRST value of a repeated param, never stringifying the array", () => {
    // `?src=home&src=faq` arrives as an array; `String(["home","faq"])` would
    // become "home,faq" — an unattributable bucket that looks attributed.
    expect(readCtaSource({ src: ["home", "faq"] })).toBe("home");
    expect(readCtaSource(new URLSearchParams("src=home&src=faq"))).toBe("home");
  });

  it("returns null — 'unattributed' — for unknown, absent, or malformed markers", () => {
    // Fail closed: a WRONG attribution is worse than a missing one when the
    // whole exercise is deciding where ad money goes.
    for (const params of [
      new URLSearchParams(""),
      new URLSearchParams("src=made-up"),
      { src: "made-up" },
      { src: "" },
      { src: undefined },
      { other: "home" },
      {},
      null,
      undefined,
    ]) {
      expect(readCtaSource(params), JSON.stringify(params)).toBeNull();
    }
  });

  it("round-trips every marker through the href it emits", () => {
    for (const s of CTA_SOURCES) {
      const href = funnelEntryHref(s, { group: "makers" });
      expect(readCtaSource(new URLSearchParams(href.split("?")[1]))).toBe(s);
    }
  });
});

describe("R13 — one label into the funnel", () => {
  it('is "Start Here →", and never the internal stage name', () => {
    expect(FUNNEL_CTA_LABEL).toBe("Start Here →");
    expect(FUNNEL_CTA_LABEL).not.toContain("Start Building");
  });
});

describe("attributedBookingUrl survives R18's removal", () => {
  it("appends the marker with the right separator", () => {
    expect(attributedBookingUrl("https://cal.com/x")).toBe(`https://cal.com/x?${SRC_MARKER}`);
    expect(attributedBookingUrl("https://cal.com/x?a=1")).toBe(
      `https://cal.com/x?a=1&${SRC_MARKER}`
    );
  });

  it("passes non-http targets through untouched", () => {
    expect(attributedBookingUrl("mailto:admissions@the120.school")).toBe(
      "mailto:admissions@the120.school"
    );
    expect(attributedBookingUrl("/relative")).toBe("/relative");
  });

  it("is idempotent", () => {
    const once = attributedBookingUrl("https://cal.com/x");
    expect(attributedBookingUrl(once)).toBe(once);
  });

  it("is re-exported from the old module, so its 17 importers keep working", async () => {
    // Extract, do not delete: `Audience` alone has fourteen importers.
    const legacy = await import("@/app/2026-27/cta-source");
    expect(legacy.SRC_MARKER).toBe(SRC_MARKER);
    expect(legacy.attributedBookingUrl("https://cal.com/x")).toBe(
      attributedBookingUrl("https://cal.com/x")
    );
    // …and the page-local vocabulary is still there.
    expect(typeof legacy.ctaLabels).toBe("function");
    expect(typeof legacy.seatsDisplay).toBe("function");
    expect(legacy.WAITLIST_LABEL).toBeTruthy();
  });
});
