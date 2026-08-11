import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * THE DASHBOARD'S NEW CLIENT SURFACES (v3 Unit 8 review, FIX 5b).
 *
 * ⚠ CONVENTION NOTE, STATED SO THE NEXT EDITOR DOES NOT HUNT FOR IT. This
 * repo's vitest runs in the NODE environment with no jsdom, no happy-dom and no
 * @testing-library — and that is deliberate, not an oversight to route around
 * in one file. The single precedent for touching a component at all is
 * `app/gauntlet/components/__tests__/triangleFigure.test.tsx`, which uses
 * `renderToStaticMarkup`. That is what this file uses, and it buys exactly one
 * thing: the FIRST render. It cannot click.
 *
 * So the coverage is split honestly:
 *  - the RENDER-TIME decisions are asserted here, through the markup;
 *  - the pure branch that matters most (`photoAffordance` — and specifically
 *    that a FAILED consent read offers NEITHER affordance) is asserted as a
 *    function, exhaustively;
 *  - the INTERACTIVE paths (reset happy path, weak-password refusal, consent
 *    capture and withdrawal) are asserted where their decisions actually live:
 *    `app/lib/v3-signup/__tests__/kid-credentials-actions.test.ts` and
 *    `set-password-action.test.ts`. The component is layout only, by the repo's
 *    own rule, so there is no third decision hiding in the click handler.
 */

vi.mock("@/app/lib/v3-signup/actions/kid-credentials", () => ({
  resetKidPasswordAction: vi.fn(),
  captureChildConsentAction: vi.fn(),
  revokeChildConsentAction: vi.fn(),
}));
vi.mock("@/app/lib/v3-signup/actions/set-password", () => ({
  setParentPasswordAction: vi.fn(),
}));

import KidCredentials, {
  ageBandFor,
  photoAffordance,
} from "@/app/dashboard/KidCredentials";
import { SetPasswordForm } from "@/app/set-password/SetPasswordForm";
import { emptyChild, type Child } from "@/app/dashboard/data";

const POLICY = { version: "2026-08-05.1", hash: "abc123", text: "I confirm I am the parent." };

const kid = (over: Partial<Child> = {}): Child => ({ ...emptyChild("kid-1"), ...over });

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

/* ─────────────────── the branch a failed read must not guess ─────────────────── */

describe("photoAffordance — null is NOT 'closed'", () => {
  it("offers NEITHER affordance when the consent read failed", () => {
    // The honest degrade. Offering "give permission" to a family who already
    // consented, or "withdraw" to one who never did, are both worse than
    // offering nothing until the next page load.
    expect(photoAffordance(null)).toBe("unknown");
  });

  it("offers withdraw when open and give when closed — and nothing else exists", () => {
    expect(photoAffordance(true)).toBe("withdraw");
    expect(photoAffordance(false)).toBe("give");
    expect(new Set([photoAffordance(null), photoAffordance(true), photoAffordance(false)]).size).toBe(3);
  });

  it("the panel's markup branches on it: neither button renders for null", () => {
    // The collapsed panel renders no consent controls at all, which is the
    // stronger statement: nothing is offered before the parent opens it.
    for (const state of [null, true, false] as const) {
      const out = html(<KidCredentials child={kid()} photoConsentOpen={state} policy={POLICY} />);
      expect(out).not.toContain("Give permission");
      expect(out).not.toContain("Withdraw permission");
      expect(out).toContain("Login &amp; permissions");
      expect(out).toContain('aria-expanded="false"');
    }
  });
});

/* ───────────────────────────── the age band rule ───────────────────────────── */

describe("ageBandFor — the consent record's band, from a v2 roster row's grade", () => {
  it("maps Canadian grade → typical age (grade + 5) across the three bands", () => {
    expect(ageBandFor(kid({ grade: 3 }))).toBe("under_13"); // age 8
    expect(ageBandFor(kid({ grade: 7 }))).toBe("under_13"); // age 12
    expect(ageBandFor(kid({ grade: 8 }))).toBe("13_to_15"); // age 13
    expect(ageBandFor(kid({ grade: 10 }))).toBe("13_to_15"); // age 15
    expect(ageBandFor(kid({ grade: 11 }))).toBe("16_plus"); // age 16
  });

  it("an UNSET grade records the strictest band, never a guess", () => {
    // Over-protecting a 16-year-old costs nothing; under-protecting a
    // 10-year-old is a compliance failure.
    expect(ageBandFor(kid({ grade: "" }))).toBe("under_13");
  });

  it("⚠ ON A DEGENERATE GRADE THE CONSERVATIVE ANSWER WINS (review P2-e)", () => {
    // THE BUG THIS TEST WAS WRITTEN FOR: `NaN` is a `number`, and both
    // `NaN + 5 < 13` and `NaN <= 15` are false — so the naive
    // `typeof === "number"` guard fell straight through to `16_plus`, the
    // LEAST protective band, for the one input that means "we do not know".
    // This value is written to `fp_parental_consent.child_age_band`, a NOT NULL
    // column of a legal-evidence table, so "unknown" must land on the most
    // protective band, never the least.
    expect(ageBandFor(kid({ grade: Number.NaN }))).toBe("under_13");
    expect(ageBandFor(kid({ grade: Number.POSITIVE_INFINITY }))).toBe("under_13");
    expect(ageBandFor(kid({ grade: Number.NEGATIVE_INFINITY }))).toBe("under_13");
    expect(ageBandFor(kid({ grade: "" }))).toBe("under_13");
  });
});

/* ───────────────────────────── the render itself ───────────────────────────── */

describe("KidCredentials — first render", () => {
  it("renders a collapsed 44px-tall disclosure and nothing else", () => {
    const out = html(<KidCredentials child={kid()} photoConsentOpen={false} policy={POLICY} />);
    expect(out).toContain("h-11"); // the mobile tap-target floor
    // Nothing from the expanded body leaks into the collapsed markup.
    expect(out).not.toContain("Set a new password");
    expect(out).not.toContain(POLICY.text);
    expect(out).not.toContain(POLICY.hash);
  });

  it("never renders the policy HASH as visible text (it is an echo, not copy)", () => {
    const out = html(<KidCredentials child={kid({ fpUsername: "a@b.c" })} photoConsentOpen={false} policy={POLICY} />);
    expect(out).not.toContain(POLICY.hash);
  });
});

/* ─────── a kid with no First Profit account (fpUsername null) — v3 U4 ─────── */

describe("KidCredentials — the unprovisioned kid (fpUsername null)", () => {
  // `initialOpen` is the test-only seam: renderToStaticMarkup captures only the
  // first render and cannot click, so the expanded body is only assertable when
  // the disclosure starts open. Production never passes it.
  it("shows 'Not set up yet' and SUPPRESSES the reset-password form when expanded", () => {
    const out = html(
      <KidCredentials child={kid({ fpUsername: null })} photoConsentOpen={false} policy={POLICY} initialOpen />
    );
    expect(out).toContain('aria-expanded="true"'); // the panel really is expanded
    expect(out).toContain("Not set up yet");
    // No password to reset for an account that does not exist.
    expect(out).not.toContain("Set a new password");
    expect(out).not.toContain('id="kid-pw-kid-1"');
  });

  it("a kid WITH an fpUsername gets the reset form (and the username) when expanded", () => {
    const out = html(
      <KidCredentials child={kid({ fpUsername: "remi.newal" })} photoConsentOpen={false} policy={POLICY} initialOpen />
    );
    expect(out).toContain("Set a new password");
    expect(out).toContain("remi.newal");
    expect(out).not.toContain("Not set up yet");
  });
});

describe("SetPasswordForm — first render", () => {
  it("renders one password field, a submit, and no error", () => {
    const out = html(<SetPasswordForm next="/start?step=kid" />);
    expect(out).toContain('type="password"');
    // A password MANAGER hint, not a browser autofill of the old value: this
    // field mints a new credential.
    expect(out).toContain('autoComplete="new-password"');
    expect(out).toContain("Save password");
    expect(out).toContain("Choose a password for your account.");
    // 48px control height — comfortably past the 44px mobile floor.
    expect(out).toContain("h-12");
  });

  it("does NOT put the handoff destination in the markup as a link a scanner could follow", () => {
    // The `next` value drives a post-success `window.location`, never an anchor:
    // a just-authenticated page with a followable destination is where open
    // redirects come from, and this one is a fixed first-party path anyway.
    const out = html(<SetPasswordForm next="/start?step=kid" />);
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("href=");
  });
});
