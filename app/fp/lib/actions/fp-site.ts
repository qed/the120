"use server";

/**
 * Parent-surface Server Actions for a child's First Profit public site
 * (real-public-site plan, Unit 2; R21, R22): unpublish / republish. Server
 * Actions ARE this repo's session-authenticated mutation discipline (Next's
 * built-in same-origin/action-id protection; no cookie-bearing cross-origin
 * path exists) — the same canon as app/fp/lib/actions/review.ts:
 * gate → zod → authorize-off-the-authoritative-row → mutate via service role →
 * typed result, never throwing to the client.
 *
 * The parent gate here is the PARENT'S OWN auth session (supabaseServer
 * getUser — revocation-sensitive) resolved against `children.parent_id` inside
 * the core; no path_role_grants requirement, because FP-signup families are
 * not necessarily Path-enrolled. Operator locks are structurally out of reach:
 * the core writes `published` only.
 */

import { z } from "zod";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  setSitePublishedForParent,
  type ParentSiteToggleResult,
} from "../fp-site-parent-core";

const toggleSchema = z.object({ childId: z.string().uuid(), published: z.boolean() }).strip();

export type FpSiteToggleActionResult =
  | ParentSiteToggleResult
  | { ok: false; reason: "invalid_input" | "not_signed_in" };

export async function setFpSitePublished(input: unknown): Promise<FpSiteToggleActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return { ok: false, reason: "not_signed_in" };

  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };

  return setSitePublishedForParent(supabaseAdmin(), {
    parentUserId: data.user.id,
    childId: parsed.data.childId,
    published: parsed.data.published,
  });
}
