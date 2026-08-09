import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
import { readCtaSource } from "@/app/lib/cta-source";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { FP_CONSENT_POLICY, currentPolicyHash } from "@/app/api/fp/signup/consent-rules";
import { loadV3OnboardingState } from "@/app/lib/v3-signup/v3-onboarding-core";
import { resolveV3Step } from "@/app/lib/v3-signup/flow-rules";
import { shouldRedirectToDashboard } from "./start-redirect-rules";
import { V3Flow } from "./V3Flow";

/**
 * `/start` — the New User Flow v3 front door (plan Unit 3).
 *
 * ── THE FRONT DOOR IS UNCONDITIONALLY OPEN ──
 * Every visitor gets the flow: signed-in, signed-out, no env configured at all.
 * There is NO go-live lever and NO holding state. `/start` is live the moment it
 * deploys, exactly as the v2 front door was, and there is nothing to set in
 * Vercel to open it.
 *
 * There WAS a go-live lever here, with a holding state for its off case; it was
 * removed by owner decision (see the plan's no-go-live-lever entry). Do not
 * reintroduce one as a "default on" env read — and if a future launch genuinely
 * needs a gate, it belongs at EVERY entry point, not just this render: the four
 * Server Actions in `app/start/actions.ts` are separately-addressable POST
 * endpoints that no page render stands in front of (docs/solutions/security-
 * issues/a-flag-that-gates-the-page-does-not-gate-its-server-actions-...-
 * 2026-08-05.md). That lesson is about where a gate lives, and it survives the
 * removal of the flag it was learned from.
 *
 * The always-live property is asserted behaviorally, with the environment
 * emptied, by app/lib/v3-signup/__tests__/v3-start-always-live.test.ts.
 *
 * ── FUNNEL ANALYTICS PARITY ──
 * The v2 `/start` page emits `start_view` with `entrySource: readCtaSource(params)`
 * server-side, and that pairing is PINNED by
 * app/lib/__tests__/funnel-event-rules.test.ts (`"start_view"` emits from
 * app/start/page.tsx; `entry_source` reaches the tuple only through
 * `readCtaSource`). v3 emits the SAME event through the SAME reader so
 * conversion measurement is continuous across the swap; plan Unit 9 retargets
 * those pins from the v2 file to this one. Emitted first thing in the render, so
 * every landing is counted in the denominator whatever the visitor's session
 * state turns out to be.
 */

export const metadata: Metadata = {
  title: "Start — The 120",
  description:
    "Your kid designs a real business in ten minutes. See where it goes.",
};

export default async function V3StartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // R56 parity with app/start/page.tsx: server-side, and the source goes through
  // the SAME readCtaSource, so an unknown marker fails closed to null and free
  // text can never reach the tuple column.
  void emitFunnelEvent("start_view", { entrySource: readCtaSource(params) });

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The session is read to RESUME a returning parent, not to admit anyone: a
  // visitor with no session simply starts at step 1.
  const parentVerified = Boolean(user?.id && user?.email);
  const state = parentVerified
    ? // The page only READS, so it takes the READ deps: a client and nothing
      // else. No clock and no CSPRNG in a render (both are impure), and no
      // `createChild` handed to a surface that must never call one.
      await loadV3OnboardingState({ db: supabaseAdmin() }, {
        parentId: user!.id,
        parentVerified: true,
      })
    : {
        draft: null,
        existingKids: [],
        facts: {
          parentVerified: false,
          hasDraft: false,
          kidNamed: false,
          childCreated: false,
        },
      };

  const rawStep = Array.isArray(params.step) ? params.step[0] : params.step;

  // ── fpv03 U2 amendment: completed parents skip the funnel ──
  // A signed-in parent whose onboarding is effectively complete (>=1
  // provisioned child, or the active draft already minted one) is sent to the
  // dashboard rather than shown their kid's journey replayed. An explicit
  // valid `?step=` suppresses this — the dashboard's own add-kid CTA is
  // `/start?step=kid` (V3_ADD_KID_HREF) — and a mid-flow parent never matches.
  // Decision logic is pure (see start-redirect-rules.ts); only the redirect
  // itself lives here. It sits BELOW the start_view emit on purpose: the
  // emit-before-everything-conditional property is pinned by
  // app/lib/__tests__/funnel-event-rules.test.ts (emit precedes the
  // supabaseServer() read), so a redirected request still lands in the
  // funnel denominator.
  if (
    shouldRedirectToDashboard({
      parentVerified,
      rawStep: rawStep ?? null,
      facts: state.facts,
      existingKids: state.existingKids,
    })
  ) {
    redirect("/dashboard");
  }

  return (
    <V3Flow
      initialStep={resolveV3Step(rawStep ?? null, state.facts)}
      facts={state.facts}
      draft={state.draft}
      parentEmail={user?.email ?? null}
      // The bind-to-rendered consent proof: the client echoes exactly what this
      // render displayed, and the server refuses anything else (echo + refuse
      // stale). Shipped as props rather than fetched so the text on screen and
      // the hash in the payload are the same render.
      consentPolicy={{
        version: FP_CONSENT_POLICY.version,
        hash: currentPolicyHash(),
        text: FP_CONSENT_POLICY.text,
      }}
      // fpv03 U3: `coverAiLive` is no longer passed — the cover step left
      // signup. The /api/fp/cover endpoint still reads COVER_AI_LIVE itself,
      // so a stale bundle's cover screen keeps exactly the gate it had.
    />
  );
}
