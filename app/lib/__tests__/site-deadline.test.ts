import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { globSync } from "tinyglobby";

import {
  DEPOSIT_REFUND_DEADLINE,
  DEPOSIT_REFUND_DEADLINE_LABEL,
} from "@/app/lib/site";
import { renderNurtureEmail } from "@/app/lib/nurture/copy";
import { WELCOME_HTML, WELCOME_TEXT } from "@/app/lib/welcome/template";

const readSource = (rel: string) =>
  readFileSync(path.resolve(process.cwd(), rel), "utf8");

/** Block and line comments removed, so documentation of the date is not
 *  counted as a duplicate of it. String contents are preserved. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * The whole app/ tree, read ONCE at module load rather than per assertion —
 * ~390 files / ~3.4MB, and this suite already has two unrelated files sitting
 * at the edge of the 5s default timeout under parallel CI load.
 */
const SOURCES: ReadonlyMap<string, string> = new Map(
  globSync(["app/**/*.{ts,tsx}"], { cwd: process.cwd(), absolute: false })
    .filter((f) => !f.includes("__tests__"))
    .map((f) => [f.replaceAll("\\", "/"), stripComments(readSource(f))])
);

/**
 * Known stragglers in LANE A's territory (docs/LANES.md: app/crm/ belongs to
 * the Staff Front Door lane; Lane B does not edit those files, even for a
 * one-line constant adoption). Both are display copy that retypes the deadline
 * abbreviated. Flagged in the Unit 1 PR for Lane A to adopt
 * DEPOSIT_REFUND_DEADLINE_LABEL — delete the entry here when it does, and this
 * test starts protecting that file too.
 */
const LANE_A_DEADLINE_STRAGGLERS = [
  "app/crm/components/dashboard/DepositThermometer.tsx", // "REFUNDABLE UNTIL SEP 30"
];

/**
 * F7: the September 30 date stays presentational this build, but the
 * machine-readable constant lands beside the label so a later unit can enforce
 * it without introducing a second literal — and the four places that had
 * retyped the date now read the one constant.
 *
 * The fourth was found only because it spelled the date with `&nbsp;` and hid
 * from a plain-text search. That is the whole argument for these assertions:
 * the duplicates were not hard to fix, they were hard to FIND.
 */

describe("the refund deadline constant and its label agree", () => {
  it("formats to the label in Toronto, where the deadline is offered", () => {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Toronto",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(DEPOSIT_REFUND_DEADLINE);
    expect(formatted).toBe(DEPOSIT_REFUND_DEADLINE_LABEL);
  });

  it("is the END of September 30 in Toronto, not the start", () => {
    // A bare `new Date("2026-09-30")` is UTC midnight, which is 20:00 on
    // September 29 in Toronto — it would expire the refund a day early, and
    // would still format as "September 30, 2026" in UTC, so the assertion
    // above alone cannot catch it.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Toronto",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(DEPOSIT_REFUND_DEADLINE);
    expect(parts).toBe("23:59");
  });

  it("is a valid date, not an Invalid Date silently formatting to nonsense", () => {
    expect(Number.isNaN(DEPOSIT_REFUND_DEADLINE.getTime())).toBe(false);
  });
});

describe("no surface retypes the deadline", () => {
  it("the deposit-welcome nurture email carries the label in both parts", () => {
    const email = renderNurtureEmail("deposit-welcome", { firstName: "Sam" });
    expect(email.text).toContain(`refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}.`);
    // The HTML part uses non-breaking spaces so the date cannot wrap; it is
    // derived from the same constant rather than retyped.
    expect(email.html).toContain(
      `refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL.replace(/ /g, "&nbsp;")}.`
    );
    expect(email.html).not.toContain("September 30, 2026");
  });

  it("the welcome template carries the label in both parts", () => {
    expect(WELCOME_TEXT).toContain(`refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}`);
    expect(WELCOME_HTML).toContain(`refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}`);
  });

  it("the dashboard carries NO deposit surface at all (fpv03 U4 payment removal)", () => {
    // fpv03 U4 removed payment from the parent experience, so the dashboard's
    // deposit banner is gone rather than merely reading the constant. The
    // deadline label now lives only where money still does (nurture email,
    // welcome template, checkout route) — asserted elsewhere.
    const src = stripComments(
      readSource("app/dashboard/ParentDashboard.tsx") +
        readSource("app/dashboard/kids/[id]/KidPortal.tsx") +
        readSource("app/dashboard/FirstProfitCard.tsx")
    );
    expect(src).not.toContain("DEPOSIT_REFUND_DEADLINE_LABEL");
    expect(src).not.toContain("September 30, 2026");
  });

  it("leaves no other spelling of the deadline in app/ — including abbreviations", () => {
    // The sweep the `&nbsp;` copy would have failed — and, as first written,
    // this sweep itself was defeated the same way: it matched only the word
    // "September", and THREE abbreviated copies ("Sept 30, 2026",
    // "Refundable until Sept 30.", "REFUNDABLE UNTIL SEP 30") sailed past it,
    // one of them in a file this unit had already edited. A sweep is only as
    // good as the spellings it can imagine; match the stem, not the word.
    // Comments are stripped so prose about the deadline is not a duplicate.
    const offenders = [...SOURCES.entries()]
      .filter(
        ([f]) =>
          f !== "app/lib/site.ts" && !LANE_A_DEADLINE_STRAGGLERS.includes(f)
      )
      .filter(([, src]) => /sept?(ember)?\s*\.?\s*(&nbsp;)?\s*30/i.test(src))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("keeps the Lane A carve-out honest — those files still carry the literal", () => {
    // If Lane A adopts the constant, this fails and the entry gets deleted,
    // rather than the carve-out silently outliving the problem it excuses.
    for (const f of LANE_A_DEADLINE_STRAGGLERS) {
      const src = SOURCES.get(f);
      expect(src, `${f} vanished — remove its carve-out entry`).toBeDefined();
      expect(
        /sept?\s*\.?\s*30/i.test(src as string),
        `${f} no longer carries the literal — remove its carve-out entry`
      ).toBe(true);
    }
  });
});
