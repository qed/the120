import "server-only";

/**
 * First Profit public site — PARENT unpublish/republish core (real-public-site
 * plan, Unit 2; R21, R22). RESTORED after v3 plan Unit 10 deleted `/fp/family`,
 * the surface it used to serve: the control now lives on `/dashboard`, and the
 * R21 email's promise ("you can take the page offline any time from your family
 * dashboard") is true again because of it.
 *
 * `server-only`, deps-injected, deliberately NOT `"use server"` — a core with a
 * `deps` parameter may never live in a file whose every export is
 * client-callable (docs/solutions/best-practices/shared-db-taking-core-must-not-
 * live-in-a-use-server-file-server-action-boundary-2026-07-17.md). The thin
 * actions live in ./actions/fp-site-parent.ts; the pure status ladder and the
 * parent's affordance derivation live in ./fp-public-site-rules.ts.
 *
 * ── AUTHORIZATION: THE PARENT REACHES THEIR OWN CHILD AND NOTHING ELSE ──
 * 1. `parentId` comes from the COOKIE SESSION (`auth.getUser()`, which verifies
 *    the JWT), handed in as `ctx`. Nothing here ever reads an id from the
 *    request body as a credential: a `childId` in an argument is an identifier
 *    (the bearer-credential learning, 2026-08-05).
 * 2. Ownership is a WHERE-CLAUSE PREDICATE, never a fetched-row comparison:
 *    `.eq("id", childId).eq("parent_id", ctx.parentId)`. A child this parent
 *    does not own returns NO ROW, so there is no row to mis-compare and no
 *    branch where a wrong `if` leaks one. It also means "no such child" and
 *    "not yours" are the same answer: no existence oracle.
 *    (The pre-Unit-10 version re-read the child and compared `parent_id` in
 *    TypeScript. Same refusal, but the predicate form is this repo's canon
 *    since `kid-credentials-core.ts` and is strictly harder to get wrong, so
 *    the restore adopts it. Nothing is loosened: the parent id is still in
 *    every read and every write.)
 * 3. THE SITE IS NEVER ADDRESSED BY A CLIENT-SUPPLIED KEY. Neither a handle nor
 *    a `profile_id` nor a site id is accepted from the caller. `profile_id` is
 *    DERIVED from the child row the WHERE clause just authorized, and the one
 *    UPDATE is filtered on that derived id — so there is no input, malicious or
 *    accidental, that points the write at another family's page.
 * 4. The privileged client is a FACTORY (`deps.db()`): `fp_public_sites` and
 *    `fp_player_profiles` are service-role-only tables, and constructing the
 *    client only inside the core keeps "the parent id is in the WHERE clause"
 *    the access control the absent RLS policies would be.
 *
 * ── SEMANTICS (unchanged from the original; each one is a rule, not a detail) ──
 *   - unpublish: `published = false`. `first_published_at` STAYS (the R9d
 *     discriminator: the public page renders the OFFLINE state, never
 *     `unclaimed`). Idempotent.
 *   - republish: `published = true`, ONLY for an EVER-PUBLISHED page
 *     (`first_published_at` set). The published-implies-stamped CHECK and the
 *     product rule agree: a parent RESTORES a page, they do not launch one.
 *     A never-published page answers `never-published` and nothing is written.
 *   - THE OPERATOR LOCK ALWAYS WINS. `operator_locked` is not read-modified and
 *     not in any UPDATE payload here, so this path structurally cannot clear
 *     it; a republish while locked flips `published` and the page STAYS OFFLINE,
 *     which is exactly what the returned `deriveSiteStatus` says. Only
 *     `fp-site-ops-core` (CRM staff action + `scripts/fp-site-lock.ts`) clears
 *     a lock.
 *   - No email: the parent is the actor. The R21 notification belongs to the
 *     CHILD publish endpoint's hidden→visible transition.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import {
  deriveSiteStatus,
  type ParentSiteRow,
} from "@/app/lib/fp/fp-public-site-rules";

/* ------------------------------------------------------------------- deps */

export type ParentSiteDeps = {
  /** SERVICE-ROLE client, as a FACTORY: nothing privileged is constructed
   *  until the core has a session-named caller. */
  db: () => SupabaseClient;
  now: () => number;
  log: (message: string) => void;
};

/** The server-attested caller, read from the cookie session by the action. */
export type ParentCaller = { parentId: string };

/** The production wiring. Service-role by necessity: `fp_player_profiles` and
 *  `fp_public_sites` are RLS-on-with-no-parent-policy tables, and the parent id
 *  in every WHERE clause is the access control they lack. */
export function realParentSiteDeps(): ParentSiteDeps {
  return {
    db: () => supabaseAdmin(),
    now: () => Date.now(),
    log: (message) => console.error(message),
  };
}

/**
 * The session-derived caller, or null when there is no verified session.
 * `auth.getUser()` (not `getSession()`) so the JWT is verified by the auth
 * server rather than trusted from a cookie this process never checked.
 */
export async function parentCallerFromSession(): Promise<ParentCaller | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return null;
  return { parentId: data.user.id };
}

/**
 * The dashboard page's entry point: this parent's own children's public pages,
 * or `null` when we could not load them (signed out, or a failed read). Null is
 * an HONEST DEGRADE, mirroring `photoConsentChildIds`: the dashboard then
 * offers no take-offline control this page load rather than rendering a state
 * it does not know. Never throws — the dashboard must always render.
 */
export async function loadParentSitesForRequest(): Promise<ParentSiteRow[] | null> {
  try {
    const who = await parentCallerFromSession();
    if (!who) return null;
    return await listParentSites(realParentSiteDeps(), who);
  } catch {
    return null;
  }
}

export type ParentSiteToggleResult =
  | { ok: true; site: ParentSiteRow }
  | { ok: false; reason: ParentSiteRefusal };

/** Every way the toggle can refuse. `forbidden` covers BOTH "no such child" and
 *  "not your child" by construction (see the header). */
export type ParentSiteRefusal =
  | "bad_request"
  | "forbidden"
  | "no-site"
  | "never-published"
  | "outage";

type SiteRow = {
  profile_id: string;
  handle: string;
  published: boolean;
  operator_locked: boolean;
  first_published_at: string | null;
};

const SITE_COLUMNS = "profile_id, handle, published, operator_locked, first_published_at";

/** Coerce one raw `fp_public_sites` row; null when it is not a usable shape. */
function toSiteRow(raw: unknown): SiteRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.profile_id !== "string" || typeof r.handle !== "string") return null;
  return {
    profile_id: r.profile_id,
    handle: r.handle,
    published: r.published === true,
    operator_locked: r.operator_locked === true,
    first_published_at:
      typeof r.first_published_at === "string" ? r.first_published_at : null,
  };
}

function toParentSiteRow(
  site: SiteRow,
  child: { childId: string; firstName: string }
): ParentSiteRow {
  return {
    childId: child.childId,
    firstName: child.firstName,
    handle: site.handle,
    status: deriveSiteStatus({
      published: site.published,
      operator_locked: site.operator_locked,
      first_published_at: site.first_published_at,
    }),
    operatorLocked: site.operator_locked,
  };
}

/* ------------------------------------------------------------- the listing */

/**
 * EVERY public page belonging to THIS PARENT'S OWN CHILDREN, for the dashboard
 * render. `null` = the read failed, which the dashboard treats as "show no
 * control this page load" rather than guessing a state.
 *
 * ⚠ THIS FUNCTION TAKES NO CHILD ID AT ALL. The roster is derived from the
 * session's parent id, so the listing has no untrusted input to validate: a
 * caller cannot ask about a child, only about themselves.
 */
export async function listParentSites(
  deps: ParentSiteDeps,
  ctx: ParentCaller
): Promise<ParentSiteRow[] | null> {
  const db = deps.db();

  const kids = await db
    .from("children")
    .select("id, first_name")
    .eq("parent_id", ctx.parentId);
  if (kids.error) {
    deps.log(`[fp/site-parent] children read failed: ${kids.error.message}`);
    return null;
  }
  const byChildId = new Map<string, string>();
  for (const raw of (kids.data as Record<string, unknown>[] | null) ?? []) {
    if (typeof raw.id === "string") {
      byChildId.set(raw.id, typeof raw.first_name === "string" ? raw.first_name : "");
    }
  }
  if (byChildId.size === 0) return [];

  const profiles = await db
    .from("fp_player_profiles")
    .select("id, child_id")
    .in("child_id", [...byChildId.keys()]);
  if (profiles.error) {
    deps.log(`[fp/site-parent] profile read failed: ${profiles.error.message}`);
    return null;
  }
  const childByProfile = new Map<string, string>();
  for (const raw of (profiles.data as Record<string, unknown>[] | null) ?? []) {
    // The `.in` filter already restricted this to owned children; the guard is
    // a shape check, not an access check.
    if (typeof raw.id === "string" && typeof raw.child_id === "string") {
      if (byChildId.has(raw.child_id)) childByProfile.set(raw.id, raw.child_id);
    }
  }
  if (childByProfile.size === 0) return [];

  const sites = await db
    .from("fp_public_sites")
    .select(SITE_COLUMNS)
    .in("profile_id", [...childByProfile.keys()]);
  if (sites.error) {
    deps.log(`[fp/site-parent] site read failed: ${sites.error.message}`);
    return null;
  }

  const rows: ParentSiteRow[] = [];
  for (const raw of (sites.data as unknown[] | null) ?? []) {
    const site = toSiteRow(raw);
    if (!site) continue;
    const childId = childByProfile.get(site.profile_id);
    if (!childId) continue;
    rows.push(toParentSiteRow(site, { childId, firstName: byChildId.get(childId) ?? "" }));
  }
  // Stable order so the dashboard does not reshuffle between loads.
  rows.sort((a, b) => a.handle.localeCompare(b.handle));
  return rows;
}

/* -------------------------------------------------------------- the toggle */

type ParsedToggle = { ok: true; childId: string; published: boolean } | { ok: false };

function parseToggleInput(input: unknown): ParsedToggle {
  if (!input || typeof input !== "object") return { ok: false };
  const { childId, published } = input as { childId?: unknown; published?: unknown };
  if (typeof childId !== "string" || childId.length === 0 || childId.length > 100) {
    return { ok: false };
  }
  if (typeof published !== "boolean") return { ok: false };
  return { ok: true, childId, published };
}

/**
 * Take ONE of the caller's own children's pages offline, or put it back.
 *
 * The whole security story is in the header; the shape of the code is the proof
 * of it: parent id in the children WHERE clause, `profile_id` derived from that
 * authorized row, the UPDATE filtered on the derived id, and `published` the
 * ONLY column in the payload besides the timestamp.
 */
export async function setSitePublishedForParent(
  deps: ParentSiteDeps,
  input: unknown,
  ctx: ParentCaller
): Promise<ParentSiteToggleResult> {
  const parsed = parseToggleInput(input);
  if (!parsed.ok) return { ok: false, reason: "bad_request" };

  const db = deps.db();

  // 1. OWNERSHIP AS A PREDICATE. A foreign or nonexistent child returns no row,
  //    and both answer `forbidden` — no existence oracle.
  const child = await db
    .from("children")
    .select("id, first_name")
    .eq("id", parsed.childId)
    .eq("parent_id", ctx.parentId)
    .maybeSingle();
  if (child.error) {
    deps.log(`[fp/site-parent] child read failed: ${child.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const childRow = child.data as Record<string, unknown> | null;
  if (!childRow || typeof childRow.id !== "string") return { ok: false, reason: "forbidden" };
  const firstName = typeof childRow.first_name === "string" ? childRow.first_name : "";

  // 2. The profile id is DERIVED from the authorized child, never accepted.
  const profile = await db
    .from("fp_player_profiles")
    .select("id")
    .eq("child_id", childRow.id)
    .maybeSingle();
  if (profile.error) {
    deps.log(`[fp/site-parent] profile read failed: ${profile.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const profileId = (profile.data as { id?: unknown } | null)?.id;
  if (typeof profileId !== "string") return { ok: false, reason: "no-site" };

  const current = await db
    .from("fp_public_sites")
    .select(SITE_COLUMNS)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (current.error) {
    deps.log(`[fp/site-parent] site read failed: ${current.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const before = toSiteRow(current.data);
  if (!before) return { ok: false, reason: "no-site" };

  // 3. Republish requires an EVER-PUBLISHED page (see the header). Refused
  //    before any write, so a never-published page is never touched.
  if (parsed.published && before.first_published_at === null) {
    return { ok: false, reason: "never-published" };
  }

  // 4. THE ONE WRITE: `published` only. `operator_locked` and
  //    `first_published_at` are absent from the payload, so an operator lock
  //    survives a republish and the ever-published stamp survives an unpublish.
  const updated = await db
    .from("fp_public_sites")
    .update({ published: parsed.published, updated_at: new Date(deps.now()).toISOString() })
    .eq("profile_id", profileId)
    .select(SITE_COLUMNS);
  if (updated.error) {
    deps.log(`[fp/site-parent] toggle write failed: ${updated.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const after = toSiteRow(((updated.data ?? []) as unknown[])[0]);
  if (!after) return { ok: false, reason: "outage" };

  // The status is re-derived from what the row NOW holds, so a republish under
  // a lock reports `offline` honestly rather than echoing the caller's intent.
  return { ok: true, site: toParentSiteRow(after, { childId: childRow.id, firstName }) };
}
