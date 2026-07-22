"use server";

/**
 * Typed read-model wrappers over the family read layer (T1 Unit 15; the
 * agent-native review's parity fix). Every parent mutation this unit ships
 * takes an opaque id (familyId, childId, profileId, inviteId) that only the
 * family surfaces can supply — these wrappers make that discovery CALLABLE,
 * so anything a parent can see on the dashboard or the onboarding roster, an
 * agent (or a future client surface) can fetch through the same gate:
 * requirePathUser + the caller's own grants, never a client-trusted id.
 *
 * Like journey-read.ts, these have no UI consumer by design — the pages call
 * the server-only loaders directly (the repo's RSC idiom); the wrappers exist
 * for programmatic callers. The `{ok, ...}` result family matches the /path
 * canon and unwrapActionResult.
 *
 * ⚠️ `"use server"` boundary rules (docs/solutions/runtime-errors/use-server-
 * type-reexport-registers-server-reference-referenceerror-2026-07-22.md):
 * ONLY async functions are exported — never types.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { requirePathUser } from "@/app/path/lib/auth";
import {
  loadFounderCards,
  loadLinkableFounders,
  loadPendingInvites,
  resolveParentFamily,
} from "@/app/path/lib/family-loader";

/**
 * The caller's family context: familyId (the id every family mutation needs),
 * label, parent count, and whether the create path is available to them.
 * `not_a_parent` for students/guides — their surfaces are elsewhere.
 */
export async function getFamily() {
  const { userId, grants } = await requirePathUser();
  const family = await resolveParentFamily({ userId, grants });
  if (!family) return { ok: false as const, reason: "not_a_parent" as const };
  return {
    ok: true as const,
    data: {
      familyId: family.familyId,
      familyLabel: family.familyLabel,
      parentCount: family.parentCount,
      canCreateFounder: family.callerHasCrmParentRow,
    },
  };
}

/**
 * The onboarding roster: every roster child resolved through the pure link
 * decision — `linkable` (with childId + derived band, the provisioning
 * input), `needs_grade`, or `provisioned`.
 */
export async function listFounders() {
  const { userId, grants } = await requirePathUser();
  const family = await resolveParentFamily({ userId, grants });
  if (!family) return { ok: false as const, reason: "not_a_parent" as const };
  const founders = await loadLinkableFounders(supabaseAdmin(), family);
  return { ok: true as const, data: { familyId: family.familyId, founders } };
}

/**
 * The dashboard cards: one per provisioned child — position, segments, the
 * awaiting-review count, and the profileId the reset action needs.
 */
export async function listFounderCards() {
  const { userId, grants } = await requirePathUser();
  const family = await resolveParentFamily({ userId, grants });
  if (!family) return { ok: false as const, reason: "not_a_parent" as const };
  const cards = await loadFounderCards(supabaseAdmin(), family.familyId);
  return { ok: true as const, data: { familyId: family.familyId, cards } };
}

/** Pending (unaccepted) co-parent invites, with the inviteId resend needs. */
export async function listPendingInvites() {
  const { userId, grants } = await requirePathUser();
  const family = await resolveParentFamily({ userId, grants });
  if (!family) return { ok: false as const, reason: "not_a_parent" as const };
  const invites = await loadPendingInvites(supabaseAdmin(), family.familyId);
  return { ok: true as const, data: { familyId: family.familyId, invites } };
}
