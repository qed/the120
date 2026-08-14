/**
 * THE ONE READ THAT ANSWERS "IS PHOTO PERMISSION OPEN FOR THIS CHILD?"
 *
 * Extracted verbatim from `app/lib/funnel/dashboard-gate-core.ts`'s
 * `loadPhotoConsentChildIds` dep (fpv04 U8b) so that the120's own dashboard and
 * the First Profit SPA's cross-origin roster door (`/api/fp/parent/roster`)
 * consume ONE source of truth rather than two reads that agree today.
 *
 * ⚠ WHY EXTRACTION AND NOT A SECOND READ. The verdict here is
 * `photoConsentVerdict`, the SAME pure gate `/api/fp/cover` enforces — so a
 * surface can never offer an affordance the endpoint refuses. A second
 * hand-rolled read of `fp_parental_consent` + the per-child tombstone would be
 * a second place for the tombstone rule, the `photo_declined` evidence mark, or
 * the version anchor to rot, and the symptom would be a parent told their
 * withdrawal took effect on one screen and not on the other.
 *
 * ── THE CLIENT IS A PARAMETER, AND THAT IS THE WHOLE SEAM ──
 * `fp_parental_consent` is RLS-on with ZERO policies, so this read is
 * service-role by necessity (docs/solutions/security-issues/rls-enabled-zero-
 * policies-...-2026-07-28.md: the access story must name its client). The
 * caller passes the privileged client it already built, which keeps the trust
 * argument where it belongs: THE CALLER must have derived `childIds` from a
 * read already scoped to the authenticated parent. Nothing here scopes
 * anything — it takes ids and answers about exactly those ids.
 *
 * ── Never-log discipline (R3) ──
 * Nothing is logged and nothing is thrown. A failed read is `null`, which every
 * caller renders as "offer neither affordance this load" rather than guessing a
 * state. `null` IS NOT "CLOSED".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  photoConsentVerdict,
  type PhotoConsentRow,
} from "@/app/api/fp/signup/consent-rules";

/** The privileged client, named as `SupabaseClient` rather than as a structural
 *  minimum: `fp-site-parent-core`'s `ParentSiteDeps.db` sets the precedent, and
 *  a hand-written structural subset of this client makes the compiler walk
 *  PostgREST's generic chain on every call site (TS2589). */
export type PhotoConsentDb = SupabaseClient;

/**
 * Child ids whose photo/cover consent gate is currently OPEN.
 *
 *   - a Set     — the read succeeded; membership is the answer, and ABSENCE
 *                 from the set is a genuine "closed", not a missing datum.
 *   - `null`    — the read FAILED. Not "closed": the caller must offer neither
 *                 the grant nor the withdraw affordance.
 *   - empty Set — for an empty `childIds`, without a round trip.
 */
export async function loadPhotoConsentOpenIds(
  db: PhotoConsentDb,
  childIds: readonly string[]
): Promise<Set<string> | null> {
  if (childIds.length === 0) return new Set<string>();
  try {
    const ids = [...childIds];
    const [consents, kids] = await Promise.all([
      db
        .from("fp_parental_consent")
        // `evidence` rides along for the verdict's photo_declined read (fpv03
        // U3 review, FIX A) — the SAME shape /api/fp/cover reads.
        .select("child_id, policy_version, accepted_at, revoked_at, evidence")
        .in("child_id", ids),
      db.from("children").select("id, photo_consent_revoked_at").in("id", ids),
    ]);
    if (consents.error || kids.error) return null;

    const tombstones = new Map<string, string | null>();
    for (const k of (kids.data as Array<Record<string, unknown>> | null) ?? []) {
      const stamp = k.photo_consent_revoked_at;
      tombstones.set(String(k.id), typeof stamp === "string" ? stamp : null);
    }
    const byChild = new Map<string, PhotoConsentRow[]>();
    for (const r of (consents.data as Array<Record<string, unknown>> | null) ?? []) {
      const id = String(r.child_id);
      const list = byChild.get(id) ?? [];
      list.push({
        policyVersion: typeof r.policy_version === "string" ? r.policy_version : null,
        acceptedAt: typeof r.accepted_at === "string" ? r.accepted_at : null,
        revokedAt: typeof r.revoked_at === "string" ? r.revoked_at : null,
        // Raw jsonb; the verdict narrows it (absent/malformed = no claim).
        evidence: r.evidence,
      });
      byChild.set(id, list);
    }

    const open = new Set<string>();
    for (const id of ids) {
      const verdict = photoConsentVerdict({
        rows: byChild.get(id) ?? [],
        revokedAt: tombstones.get(id) ?? null,
      });
      if (verdict.ok) open.add(id);
    }
    return open;
  } catch {
    return null;
  }
}
