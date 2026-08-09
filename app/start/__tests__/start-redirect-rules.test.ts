import { describe, expect, it } from "vitest";
import { V3_ADD_KID_HREF } from "@/app/lib/v3-signup/remap-rules";
import type { ExistingKid, V3FlowFacts } from "@/app/lib/v3-signup/flow-rules";
import { shouldRedirectToDashboard } from "../start-redirect-rules";

/**
 * fpv03 U2 amendment: completed parents skip the funnel.
 *
 * The decision is pure (the page only issues the `redirect()`), so it is
 * pinned here the way flow-rules' resolver is: every (session, ?step=, facts)
 * class gets its verdict stated. The two guards the amendment names are the
 * spine of this file — a MID-FLOW parent is never redirected, and the
 * dashboard's own `?step=` re-entry links are never bounced back.
 */

// fpv03 U3: coverSettled/storyStarted left V3FlowFacts with the cover/story
// steps' retirement from signup.
const facts = (over: Partial<V3FlowFacts> = {}): V3FlowFacts => ({
  parentVerified: true,
  hasDraft: false,
  kidNamed: false,
  childCreated: false,
  ...over,
});

const CHILD: ExistingKid = { id: "c-1", kind: "child", firstName: "Remi", lastName: "Newal" };
const DRAFT: ExistingKid = { id: "d-1", kind: "draft", firstName: "Ada", lastName: "Newal" };

describe("shouldRedirectToDashboard", () => {
  it("redirects a signed-in parent with a provisioned child visiting bare /start", () => {
    expect(
      shouldRedirectToDashboard({
        parentVerified: true,
        rawStep: null,
        // The Cedric-family shape: the draft that minted the kid is long
        // consumed, so the facts are all cold — the CHILD is the signal.
        facts: facts(),
        existingKids: [CHILD],
      })
    ).toBe(true);
  });

  it("redirects on facts.childCreated even if the children read came back empty", () => {
    expect(
      shouldRedirectToDashboard({
        parentVerified: true,
        rawStep: null,
        facts: facts({ hasDraft: true, kidNamed: true, childCreated: true }),
        existingKids: [],
      })
    ).toBe(true);
  });

  it("never redirects a signed-out visitor, whatever the state claims", () => {
    expect(
      shouldRedirectToDashboard({
        parentVerified: false,
        rawStep: null,
        facts: facts({ parentVerified: false }),
        existingKids: [CHILD],
      })
    ).toBe(false);
  });

  it("never redirects a MID-FLOW parent: verified session, draft in progress, no child", () => {
    expect(
      shouldRedirectToDashboard({
        parentVerified: true,
        rawStep: null,
        facts: facts({ hasDraft: true, kidNamed: true }),
        existingKids: [],
      })
    ).toBe(false);
    // Another live draft is still not a child.
    expect(
      shouldRedirectToDashboard({
        parentVerified: true,
        rawStep: null,
        facts: facts({ hasDraft: true, kidNamed: true }),
        existingKids: [DRAFT],
      })
    ).toBe(false);
  });

  it("an explicit valid ?step= suppresses the redirect — the dashboard's add-kid CTA depends on it", () => {
    // V3_ADD_KID_HREF is /start?step=kid: a completed parent following it must
    // reach the kid step, not bounce straight back to the dashboard.
    expect(V3_ADD_KID_HREF).toBe("/start?step=kid");
    // fpv03 U3 retarget: "cover"/"story" left this list when they left
    // V3_STEPS — they now parse to null, i.e. the BARE-VISIT branch below.
    for (const step of ["parent", "kid", "ready"]) {
      expect(
        shouldRedirectToDashboard({
          parentVerified: true,
          rawStep: step,
          facts: facts({ childCreated: true }),
          existingKids: [CHILD],
        }),
        `?step=${step}`
      ).toBe(false);
    }
  });

  it("a garbled ?step= carries no intent — a completed parent still redirects", () => {
    // "cover"/"story" join the garbled set (fpv03 U3): a completed parent's
    // stale bookmark to a retired step goes to the dashboard like a bare visit.
    for (const raw of ["banana", "", "  ", "KID?", "cover", "story"]) {
      expect(
        shouldRedirectToDashboard({
          parentVerified: true,
          rawStep: raw,
          facts: facts(),
          existingKids: [CHILD],
        }),
        `?step=${JSON.stringify(raw)}`
      ).toBe(true);
    }
    // Case-insensitive parse: "KID" IS a valid step, so it suppresses.
    expect(
      shouldRedirectToDashboard({
        parentVerified: true,
        rawStep: "KID",
        facts: facts(),
        existingKids: [CHILD],
      })
    ).toBe(false);
  });
});
