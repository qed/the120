/**
 * First Profit public site — PARENT unpublish/republish core (real-public-site
 * plan, Unit 2; R21, R22). House core pattern: plain module, NO "use server",
 * NO `server-only`; the Server Action wrapper (app/fp/lib/actions/fp-site.ts)
 * hands in the service-role client + the AUTHENTICATED parent's user id, tests
 * inject fakes.
 *
 * Authorization model (the access-rules invariant: target ids come from the
 * AUTHORITATIVE resource row, never a client param): the childId is a client
 * param, so the FIRST step re-reads the children row and requires
 * `parent_id === parentUserId` — a child the caller does not own answers the
 * same `forbidden` as a nonexistent child (no existence oracle).
 *
 * Semantics:
 *   - unpublish: `published = false`. first_published_at STAYS (the R9d
 *     discriminator: the public page renders the offline state, never
 *     unclaimed). Idempotent.
 *   - republish: `published = true`, ONLY for an ever-published page
 *     (first_published_at set — the published-implies-stamped CHECK and the
 *     product rule agree: a parent restores a page, they do not launch one).
 *   - CANNOT clear operator_locked (it is not even read-modified here): a
 *     republish while locked flips the flag but the page stays offline — the
 *     returned status says so honestly.
 *   - No email: the parent is the actor; the R21 notification belongs to the
 *     CHILD publish endpoint's hidden→visible transition.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveSiteStatus, type SiteStatus } from "@/app/fp/lib/fp-public-site-rules";

export type ParentSiteView = {
  handle: string;
  /** Never "none" here (a missing row answers `no-site` instead), but typed
   *  as the SHARED ladder — one deriveSiteStatus, no local re-implementation
   *  (Unit 2 review item). */
  status: SiteStatus;
  operatorLocked: boolean;
};

export type ParentSiteToggleResult =
  | { ok: true; site: ParentSiteView }
  | { ok: false; reason: "forbidden" | "no-site" | "never-published" | "outage" };

type RawSiteRow = {
  handle?: unknown;
  published?: unknown;
  operator_locked?: unknown;
  first_published_at?: unknown;
};

type OwnedSiteLoad =
  | { ok: true; profileId: string; handle: string; flags: { published: boolean; operator_locked: boolean; first_published_at: string | null } }
  | { ok: false; reason: "forbidden" | "no-site" | "outage" };

/** Ownership (authoritative children row) → FP profile → site row. Shared by
 *  the parent read and the toggle. Unowned and nonexistent children answer
 *  identically (no oracle). */
async function loadOwnedSite(
  db: SupabaseClient,
  input: { parentUserId: string; childId: string }
): Promise<OwnedSiteLoad> {
  const child = await db
    .from("children")
    .select("parent_id")
    .eq("id", input.childId)
    .maybeSingle();
  if (child.error) {
    console.error(`[fp/site-parent] child read failed: ${child.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const parentId = (child.data as { parent_id?: unknown } | null)?.parent_id;
  if (typeof parentId !== "string" || parentId !== input.parentUserId) {
    return { ok: false, reason: "forbidden" };
  }

  const profile = await db
    .from("fp_player_profiles")
    .select("id")
    .eq("child_id", input.childId)
    .maybeSingle();
  if (profile.error) {
    console.error(`[fp/site-parent] profile read failed: ${profile.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const profileId = (profile.data as { id?: unknown } | null)?.id;
  if (typeof profileId !== "string") return { ok: false, reason: "no-site" };

  const site = await db
    .from("fp_public_sites")
    .select("handle, published, operator_locked, first_published_at")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (site.error) {
    console.error(`[fp/site-parent] site read failed: ${site.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const row = site.data as RawSiteRow | null;
  if (!row || typeof row.handle !== "string") return { ok: false, reason: "no-site" };
  return {
    ok: true,
    profileId,
    handle: row.handle,
    flags: {
      published: row.published === true,
      operator_locked: row.operator_locked === true,
      first_published_at: typeof row.first_published_at === "string" ? row.first_published_at : null,
    },
  };
}

export type ParentSiteReadResult =
  | { ok: true; site: ParentSiteView | null }
  | { ok: false; reason: "forbidden" | "outage" };

/** The parent-dashboard read: the child's site view, or null when no handle
 *  has been claimed yet. */
export async function readSiteForParent(
  db: SupabaseClient,
  input: { parentUserId: string; childId: string }
): Promise<ParentSiteReadResult> {
  const loaded = await loadOwnedSite(db, input);
  if (!loaded.ok) {
    if (loaded.reason === "no-site") return { ok: true, site: null };
    return { ok: false, reason: loaded.reason };
  }
  return {
    ok: true,
    site: {
      handle: loaded.handle,
      status: deriveSiteStatus(loaded.flags),
      operatorLocked: loaded.flags.operator_locked,
    },
  };
}

export async function setSitePublishedForParent(
  db: SupabaseClient,
  input: { parentUserId: string; childId: string; published: boolean }
): Promise<ParentSiteToggleResult> {
  const loaded = await loadOwnedSite(db, input);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const { profileId, flags } = loaded;

  // 3. Republish requires an ever-published page (see header).
  if (input.published && flags.first_published_at === null) {
    return { ok: false, reason: "never-published" };
  }

  // 4. The one write: `published` only — operator_locked is structurally out
  //    of reach of this path.
  const updated = await db
    .from("fp_public_sites")
    .update({ published: input.published, updated_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .select("handle, published, operator_locked, first_published_at");
  if (updated.error) {
    console.error(`[fp/site-parent] toggle write failed: ${updated.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const after = ((updated.data ?? []) as RawSiteRow[])[0];
  if (!after || typeof after.handle !== "string") return { ok: false, reason: "outage" };
  const afterFlags = {
    published: after.published === true,
    operator_locked: after.operator_locked === true,
    first_published_at:
      typeof after.first_published_at === "string" ? after.first_published_at : null,
  };
  return {
    ok: true,
    site: {
      handle: after.handle,
      status: deriveSiteStatus(afterFlags),
      operatorLocked: afterFlags.operator_locked,
    },
  };
}
