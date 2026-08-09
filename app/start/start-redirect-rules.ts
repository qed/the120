/**
 * fpv03 U2 amendment: should a signed-in parent visiting `/start` be sent to
 * `/dashboard` instead of being shown the signup funnel?
 *
 * The founder's live test found a fully-onboarded parent (a verified session
 * AND at least one provisioned kid) landing on `/start` and watching their
 * kid's journey replayed from the top. The funnel exists to MINT a first kid;
 * a family that already has one belongs on the dashboard, which owns every
 * existing kid.
 *
 * PURE, deliberately — page.tsx calls this with server facts and issues the
 * `redirect()`; nothing here touches Next, Supabase, or a clock, so the
 * decision is unit-testable exactly like app/lib/v3-signup/flow-rules.ts.
 *
 * ── WHO REDIRECTS: COMPLETED PARENTS ONLY ──
 * "Complete" is read off the state `loadV3OnboardingState` already returns —
 * no new query:
 *   - `existingKids` contains a `kind: "child"` entry → a child was
 *     provisioned for this family at some point. This is the durable signal:
 *     a consumed draft stops being the active draft, so `facts.childCreated`
 *     alone would read false for a finished family (e.g. the Cedric test
 *     family, whose draft is long consumed).
 *   - `facts.childCreated` → the ACTIVE draft already minted its child (the
 *     terminal state `furthestReachableV3Step` pins to `ready`). Covers the
 *     sliver where the child row exists but the children read failed or
 *     raced the consumption stamp.
 * A MID-FLOW parent — verified cookie session, draft in progress, no child
 * yet — matches neither and keeps the funnel: they still need add-kid, the
 * cover, and the ready screen.
 *
 * ── WHY AN EXPLICIT VALID `?step=` SUPPRESSES THE REDIRECT ──
 * The dashboard itself links INTO the flow on purpose:
 *   - `V3_ADD_KID_HREF` = `/start?step=kid` (app/lib/v3-signup/remap-rules.ts,
 *     pinned by app/lib/__tests__/funnel-dashboard-cards.test.ts) — the "add
 *     another kid" CTA, used precisely by parents who already have a child;
 *   - the dashboard's SetPasswordForm round-trips with `next="/start?step=kid"`
 *     (app/dashboard/__tests__/kid-credentials-panel.test.tsx).
 * Redirecting those requests would bounce every completed parent straight
 * back to the dashboard they just left and break adding a second kid. So a
 * `?step=` that parses to a real step is treated as a deliberate re-entry and
 * rendered; `resolveV3Step`'s clamp still governs WHICH screen it lands on.
 * A garbled `?step=banana` parses to null and redirects like a bare visit —
 * it carries no intent worth honoring.
 */

import {
  parseV3Step,
  type ExistingKid,
  type V3FlowFacts,
} from "@/app/lib/v3-signup/flow-rules";

export function shouldRedirectToDashboard(input: {
  /** A verified parent cookie session exists (page.tsx's `parentVerified`). */
  parentVerified: boolean;
  /** The raw `?step=` value, exactly as the page read it from searchParams. */
  rawStep: string | null | undefined;
  facts: V3FlowFacts;
  existingKids: readonly ExistingKid[];
}): boolean {
  if (!input.parentVerified) return false;
  // A parseable step is a deliberate re-entry (dashboard add-kid / back-nav).
  if (parseV3Step(input.rawStep) !== null) return false;
  return (
    input.facts.childCreated ||
    input.existingKids.some((kid) => kid.kind === "child")
  );
}
