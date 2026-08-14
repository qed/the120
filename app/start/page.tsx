import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
import { readCtaSource } from "@/app/lib/cta-source";
import { retiredStartTarget } from "@/app/lib/fp/retired-parent-surfaces";

/**
 * `/start` — RETIRED (fpv04 U8, R7). The account funnel that lived here is
 * First Profit's own `/signup` (fpv04 U4/U5a), which renders the same steps in
 * the app the family actually ends up in.
 *
 * The flow's components (`V3Flow`, the five Step files, `actions.ts`) are left
 * in place deliberately and are NOT deleted by this unit: `actions.ts` holds
 * separately-addressable Server Actions, and deleting a page is a one-line
 * change while deleting a flow is a unit of its own. What this file guarantees
 * is only that nobody can REACH the old funnel through the front door.
 *
 * ── WHAT SURVIVES THE REDIRECT, AND WHY ──
 *  1. THE FUNNEL EVENT. `start_view` is still emitted, with the same
 *     `readCtaSource(params)` reader, BEFORE the redirect — so conversion
 *     measurement stays continuous across the retirement instead of falling to
 *     zero on the day it ships. The emit-precedes-everything-conditional
 *     property is pinned by app/lib/__tests__/funnel-event-rules.test.ts.
 *  2. THE ADD-A-KID INTENT. `/start?step=kid` is the dashboard's
 *     add-another-kid CTA (V3_ADD_KID_HREF). First Profit has that exact flow
 *     at `/signup?add=1` (fpv04 U6b-iii), so `retiredStartTarget` carries the
 *     intent across rather than dropping a parent who already has an account
 *     at step 1 of a signup.
 *
 * ── WHAT IS NOT RETIRED ──
 * `/start/arrival` is Stripe's `success_url` and stays a live route. See
 * app/lib/fp/retired-parent-surfaces.ts, which is the list this unit is
 * checkable against.
 *
 * A 302, not a permanent redirect: `redirect()` defaults to temporary, and that
 * is the right default while First Profit's signup is one env flag away from
 * being switched off. A 308 would be cached by browsers that then could not be
 * told to come back.
 */

export const metadata: Metadata = {
  title: "Start — The 120",
  description: "Your kid designs a real business in ten minutes. See where it goes.",
};

export default async function RetiredStartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Before the redirect, and before any session read, exactly as it was.
  void emitFunnelEvent("start_view", { entrySource: readCtaSource(params) });

  const rawStep = Array.isArray(params.step) ? params.step[0] : params.step;
  redirect(retiredStartTarget(rawStep ?? null));
}
