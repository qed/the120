import type { Metadata } from "next";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
import { readCtaSource } from "@/app/lib/cta-source";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { FP_CONSENT_POLICY, currentPolicyHash } from "@/app/api/fp/signup/consent-rules";
import { loadV3OnboardingState } from "@/app/lib/v3-signup/v3-onboarding-core";
import { resolveV3Step } from "@/app/lib/v3-signup/flow-rules";
import { isV3StartLive, v3UnauthenticatedEntryOpen } from "@/app/lib/v3-signup/v3-signup-rules";
import { isCoverAiLive } from "@/app/api/fp/cover/cover-rules";
import { V3Flow } from "./V3Flow";
import { HoldingPage } from "./HoldingPage";

/**
 * `/start/v3` — the New User Flow v3 front door (plan Unit 3).
 *
 * ── THE GO-LIVE LEVER SHIPS IN THE FIRST COMMIT, FAIL-CLOSED ──
 * This page is PUBLICLY ROUTABLE and wired to REAL provisioning the moment it
 * merges (the plan's per-unit push-to-main cadence), so the flag cannot be a
 * later unit's job. `V3_START_LIVE` must be an explicit, affirmative `1` /
 * `true` / `on`; unset, empty, `0`, `false`, or any typo renders the holding
 * state. There is no "default on" and no inverted "disable" flag — a
 * mis-spelled disable flag is how a surface goes live by accident.
 *
 * ⚠ THE PAGE IS NOT THE ONLY PLACE THE FLAG IS ENFORCED (review FIX 1). Server
 * Actions are separately-addressable POST endpoints; gating only this render
 * would leave `v3StartAction` / `v3VerifyCodeAction` / `v3ResendCodeAction` /
 * `v3EditEmailAction` driving real account creation with the flag off. The same
 * `isV3StartLive` + `v3UnauthenticatedEntryOpen` pair runs at the top of each of
 * those actions. Do not "simplify" either side away.
 *
 * WHAT THE FLAG GATES, PRECISELY: **unauthenticated new-signup entry only.** A
 * SIGNED-IN parent always gets the flow, flag or no flag. That is deliberate:
 * plan Unit 8's dashboard retarget and Unit 9's v2 remap send returning families
 * here, and those deploys land BEFORE the flip. Gating them too would strand a
 * mid-flow family on a holding page while v2 is already archived — the exact
 * failure the flag exists to avoid.
 *
 * ── FUNNEL ANALYTICS PARITY ──
 * The v2 `/start` page emits `start_view` with `entrySource: readCtaSource(params)`
 * server-side, and that pairing is PINNED by
 * app/lib/__tests__/funnel-event-rules.test.ts (`"start_view"` emits from
 * app/start/page.tsx; `entry_source` reaches the tuple only through
 * `readCtaSource`). v3 emits the SAME event through the SAME reader so
 * conversion measurement is continuous across the swap; plan Unit 9 retargets
 * those pins from the v2 file to this one. Emitted BEFORE the flag check on
 * purpose — a family who lands here during the flag-off window is a real visit
 * and belongs in the denominator.
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

  // The gate: unauthenticated entry only. The SAME decision is re-applied at
  // the action boundary (app/start/v3/actions.ts), because a Server Action is a
  // separately-addressable POST endpoint that no page render stands in front of.
  if (
    !v3UnauthenticatedEntryOpen({
      live: isV3StartLive(process.env.V3_START_LIVE),
      hasSession: Boolean(user),
    })
  ) {
    return <HoldingPage />;
  }

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
          coverSettled: false,
          storyStarted: false,
          childCreated: false,
        },
      };

  const rawStep = Array.isArray(params.step) ? params.step[0] : params.step;

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
      // v3 Unit 4. Read on the SERVER: the flag decides whether a minor's photo
      // is collected at all, so it must not be inferable or overridable from the
      // client bundle. Off today, and the cover endpoint refuses a photo body
      // regardless of what any bundle believes.
      coverAiLive={isCoverAiLive(process.env.COVER_AI_LIVE)}
    />
  );
}
