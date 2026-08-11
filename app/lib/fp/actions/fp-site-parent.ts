"use server";

/**
 * The dashboard's take-offline / put-back-online Server Action (real-public-site
 * plan R21/R22; restored onto `/dashboard` after v3 plan Unit 10 retired
 * `/fp/family`).
 *
 * THIN wrapper: every decision lives in ../fp-site-parent-core.ts (`server-only`,
 * deps-injected). The core's `deps` parameter must never reach the wire — a
 * Server Action's arguments arrive from the client — which is why the injection
 * seam stays in the core module (docs/solutions/best-practices/shared-db-taking-
 * core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md).
 *
 * ⚠ EXPORTS ARE ASYNC ACTIONS ONLY. No `export type`, no `export const` — a
 * type re-export from a `"use server"` file still emits
 * `registerServerReference` and throws at module load (docs/solutions/runtime-
 * errors/use-server-type-reexport-registers-server-reference-referenceerror-
 * 2026-07-22.md).
 *
 * Server Actions ARE this repo's session-authenticated mutation discipline
 * (Next's built-in same-origin/action-id protection; no cookie-bearing
 * cross-origin path exists). The order is the house order: SESSION FIRST
 * (`auth.getUser()` verifies the JWT), then the core, which proves ownership
 * with a WHERE-clause predicate before it touches a page.
 *
 * ── ONE MESSAGE FOR EVERY REFUSAL ──
 * The core's reasons are for logs and tests. The client is told one sentence,
 * because the interesting distinctions here are exactly the ones a probe would
 * want: `forbidden` (not your child, or no such child) must not read
 * differently from `no-site`, and neither may hint that a child id exists. The
 * UI never offers a control the core would refuse anyway, so a specific message
 * would buy the honest parent nothing.
 */

import {
  parentCallerFromSession,
  realParentSiteDeps,
  setSitePublishedForParent,
} from "@/app/lib/fp/fp-site-parent-core";
import type { ParentSiteRow } from "@/app/lib/fp/fp-public-site-rules";
import { consentClearance } from "@/app/lib/funnel/consent-wall-core";

const REFUSAL = "We could not change that just now. Refresh the page and try again.";

/**
 * IS THIS CALL TRYING TO PUT A CHILD'S PAGE ONLINE?
 *
 * Only the `published === true` direction is gated (review 2026-08-10, P2-b).
 * Anything else — `false`, a malformed body, a missing field — is not a publish,
 * and the core's own parser refuses the malformed cases a moment later.
 */
const isPublishDirection = (input: unknown): boolean =>
  !!input && typeof input === "object" && (input as { published?: unknown }).published === true;

export async function setFpSitePublishedAction(
  input: unknown
): Promise<{ ok: true; site: ParentSiteRow } | { ok: false; message: string }> {
  try {
    const who = await parentCallerFromSession();
    if (!who) return { ok: false, message: REFUSAL };
    // ── THE CONSENT WALL (founder, 2026-08-10), AFTER the session check and
    // before anything is written. Publishing a child's first name to the open
    // internet is the single most consequential control on this dashboard, so
    // it is the last one that should stay reachable while its parent owes us a
    // consent decision.
    //
    // ⚠ ONE DIRECTION ONLY (review 2026-08-10, P2-b). UNPUBLISH IS EXEMPT, for
    // exactly the reason `revokeChildConsentAction` is exempt: a walled parent
    // who urgently wants their child's page OFF the internet must not be told
    // "first agree to our notice". Withdrawal must be as easy as giving
    // (GDPR Art. 7(3)), and the blast radius of the exemption is bounded to the
    // safe direction by construction — `published: false` can only ever make us
    // publish LESS. There is no input to the unpublish path that grants
    // anything.
    //
    // ⚠ AND IT FAILS CLOSED ON A READ ERROR (review 2026-08-10, P2-a). Every
    // other consumer of this control fails open, because a Postgres hiccup must
    // not blockade a family out of their dashboard. Not this one: an outage
    // must not be the thing that puts a minor's page on the open internet.
    // cover-core.ts states the precedent — an unreadable tombstone is not an
    // absent tombstone. The cost here is a retry; failing open is irreversible.
    if (isPublishDirection(input)) {
      const clearance = await consentClearance(who.parentId);
      if (clearance !== "clear") {
        if (clearance === "error") {
          console.error(
            `[fp/site-parent] ⚠ FAILING CLOSED on publish for parent ${who.parentId}: the consent read did not answer`
          );
        }
        return { ok: false, message: REFUSAL };
      }
    }
    const result = await setSitePublishedForParent(realParentSiteDeps(), input, who);
    if (!result.ok) return { ok: false, message: REFUSAL };
    return { ok: true, site: result.site };
  } catch (err) {
    console.error(
      `[fp/site-parent] action threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return { ok: false, message: REFUSAL };
  }
}
