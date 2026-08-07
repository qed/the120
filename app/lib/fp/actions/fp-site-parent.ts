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

const REFUSAL = "We could not change that just now. Refresh the page and try again.";

export async function setFpSitePublishedAction(
  input: unknown
): Promise<{ ok: true; site: ParentSiteRow } | { ok: false; message: string }> {
  try {
    const who = await parentCallerFromSession();
    if (!who) return { ok: false, message: REFUSAL };
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
