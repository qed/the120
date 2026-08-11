import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * THE CONSENT WALL's ACCESSIBILITY, pinned (review 2026-08-10).
 *
 * This interstitial is the ONLY screen between a parent and a legal decision.
 * A keyboard-only parent who cannot scroll the notice cannot read what they are
 * agreeing to; a screen-reader user whose submit fails silently does not know
 * it failed. Neither is polish, so neither is left to a comment.
 *
 * ⚠ CONVENTION NOTE. This repo's vitest runs in the NODE environment with no
 * jsdom and no @testing-library (see app/dashboard/__tests__/
 * kid-credentials-panel.test.tsx, which states the same rule). Rendering is
 * `renderToStaticMarkup`: it captures the FIRST render and cannot click, and it
 * does NOT run effects. So the focus MOVE itself is not observable here — what
 * is asserted is the markup that makes it possible and meaningful
 * (`role="status"` + a programmatically-focusable `tabindex="-1"`), plus every
 * static attribute. The decline state is reached through the `initialDeclined`
 * test seam, the `initialOpen` idiom from the kid-credentials panel.
 */

vi.mock("../actions", () => ({
  acceptConsentWallAction: vi.fn(),
  declineConsentWallAction: vi.fn(),
}));

import { ConsentWall } from "../ConsentWall";

const POLICY_TEXT = "I confirm I am the parent or legal guardian.";
const POLICY_VERSION = "2026-08-08.1";

const render = (props: { initialDeclined?: boolean; initialError?: string } = {}) =>
  renderToStaticMarkup(
    <ConsentWall policyText={POLICY_TEXT} policyVersion={POLICY_VERSION} {...props} />
  );

describe("ConsentWall — the container is announced", () => {
  it("is an alertdialog, named by its heading and described by its lede", () => {
    // The old rationale here refused the role on the grounds that `aria-modal`
    // "would promise an Escape that does not exist". That is simply not true of
    // ARIA — dismissal keys are an APG authoring pattern, not a semantic — and
    // the cost of the mistake was an unnamed `div` wrapping a legal decision.
    const out = render();
    expect(out).toContain('role="alertdialog"');
    expect(out).toContain('aria-labelledby="consent-wall-title"');
    expect(out).toContain('aria-describedby="consent-wall-lede"');
    expect(out).toContain('id="consent-wall-title"');
    expect(out).toContain('id="consent-wall-lede"');
  });

  it("reports aria-busy, and reports it as false while idle", () => {
    expect(render()).toContain('aria-busy="false"');
  });
});

describe("ConsentWall — the notice is READABLE by keyboard", () => {
  it("the scroll region is focusable and has an accessible name", () => {
    // Without `tabIndex`, a keyboard-only parent literally cannot scroll the
    // notice they are being asked to consent to.
    const out = render();
    expect(out).toContain('role="region"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain(`aria-label="Parental consent notice, version ${POLICY_VERSION}"`);
    // And the name is on the SAME element as the scroll container.
    expect(out).toMatch(/role="region"[^>]*class="[^"]*overflow-y-auto/);
    expect(out).toContain(POLICY_TEXT);
  });
});

describe("ConsentWall — a failed submit is not silent", () => {
  it("the error is a live region", () => {
    // Before this, a failed accept produced red text and no announcement: the
    // parent tapped "I agree", heard nothing, and nothing appeared to change.
    const out = render({ initialError: "We could not record that just now." });
    expect(out).toContain('role="alert"');
    expect(out).toContain("We could not record that just now.");
  });

  it("renders no alert at all when there is nothing wrong", () => {
    expect(render()).not.toContain('role="alert"');
  });
});

describe("ConsentWall — the decline confirmation is announced and focusable", () => {
  it("carries role=status and is programmatically focusable", () => {
    // It REPLACES the two buttons the user was standing on. Without a live
    // region and a focus target, that is a silent screen change with focus
    // dropped to <body>.
    const out = render({ initialDeclined: true });
    expect(out).toContain('role="status"');
    expect(out).toContain('tabindex="-1"');
    expect(out).toContain("We have recorded that you said no");
    // The buttons really are gone, which is why the announcement matters.
    expect(out).not.toContain("I agree");
  });
});
