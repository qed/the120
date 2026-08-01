/**
 * R28 data-rights erasure — the PURE part (Slice B Unit 6). No I/O, no
 * next/supabase imports, so the deletion ORDER and the small decisions are
 * unit-tested in isolation and the executor (`erase-family-core.ts`) only
 * sequences effects. The load-bearing knowledge here is the FK-safe order.
 *
 * ── The FK-safe deletion order (leaf-first, past every RESTRICT) ──
 * Verified against the live migrations (20260827120000_fp_player_tables.sql,
 * 20260721130000_path_identity.sql, 20260709200000_initial_schema.sql,
 * 20260817120000_funnel_student_provisioning.sql, 20260829120000_fp_signup_
 * consent.sql):
 *
 *   fp_ledger.profile_id            -> fp_player_profiles  ON DELETE RESTRICT
 *   fp_player_saves.profile_id      -> fp_player_profiles  ON DELETE RESTRICT
 *   fp_player_profiles.user_id      -> auth.users          ON DELETE RESTRICT
 *   fp_player_profiles.child_id     -> children            ON DELETE RESTRICT
 *   path_student_profiles.user_id   -> auth.users          ON DELETE RESTRICT
 *   path_student_profiles.child_id  -> children            ON DELETE RESTRICT
 *   funnel_student_provisioning.child_id -> children       ON DELETE CASCADE
 *   parents.id                      -> auth.users          ON DELETE CASCADE
 *   children.parent_id              -> parents             ON DELETE CASCADE
 *   fp_parental_consent.{parent,child,attempt}_id          ON DELETE SET NULL
 *   fp_signup_attempts.{parent,child}_id                   ON DELETE SET NULL
 *
 * Therefore, per child:
 *   1. fp_ledger           (RESTRICT -> profiles: must precede the profile)
 *   2. fp_player_saves     (RESTRICT -> profiles: must precede the profile)
 *   3. fp_player_profiles  (RESTRICT -> children AND auth.users)
 *   4. path_student_profiles (RESTRICT -> children AND auth.users)
 *   5. Workspace mailbox: SUSPEND then DELETE (path-b; read the address off
 *      funnel_student_provisioning BEFORE the child row is gone, since that FK
 *      is CASCADE and the child delete removes the claim)
 *   6. the child's OWN auth.users login accounts (now unreferenced: steps 3-4
 *      cleared the RESTRICT referrers)
 *   7. the children row (CASCADE-removes funnel_student_provisioning + deposits)
 *
 * NOTE — fp_ledger is deleted FIRST, not last. The plan-brief's prose ordered it
 * after children, but `fp_ledger.profile_id -> fp_player_profiles ON DELETE
 * RESTRICT` makes that impossible: the profile delete (step 3) would raise 23503
 * while a ledger row references it. The migration header and the R20 solution
 * doc both state the true order "ledger -> saves -> profile -> child"; the Unit 0
 * handoff (plan line 220) likewise lists fp_ledger first. We honor the schema.
 *
 * Then, ONCE per family (full-family erasure):
 *   8. fp_parental_consent + fp_signup_attempts — the CONSENT EVIDENCE. Per the
 *      SET-NULL posture these SURVIVE the account/child deletes above (a routine
 *      delete must never be blocked by, nor silently destroy, compliance
 *      evidence). A true data-rights erasure removes them too, so this is an
 *      EXPLICIT, deliberate final step (anchored on parent_id, which still
 *      resolves because the parent account is deleted only after). DOCUMENTED
 *      ordering choice: evidence is removed last, on purpose.
 *   9. the parent auth.users account (CASCADE-removes parents -> any remaining
 *      children/deposits — by now the children are already gone).
 *
 * PRESERVED (never deleted by an erasure): funnel_released_aliases — the
 * never-reissue ledger. The address-reuse guarantee outlives the child; a burned
 * local_part must stay burned.
 */

/** The ordered per-child leaf tables (before the child's own auth + children
 *  row). Exported so the executor and its tests share ONE definition of order. */
export const CHILD_LEAF_DELETE_ORDER = [
  "fp_ledger",
  "fp_player_saves",
  "fp_player_profiles",
  "path_student_profiles",
] as const;

/** The family-level evidence tables removed as the deliberate final step. */
export const FAMILY_EVIDENCE_DELETE_ORDER = ["fp_parental_consent", "fp_signup_attempts"] as const;

/** Tables an erasure must NEVER touch (the never-reissue address ledger). */
export const ERASURE_PRESERVED_TABLES = ["funnel_released_aliases"] as const;

/**
 * Dedupe the auth.users ids a child's identity spans. A path-a child has ONE
 * account (the `.invalid` login, referenced by both path_student_profiles and
 * fp_player_profiles); a path-b child's provisioned identity is likewise shared.
 * Both profile tables carry `user_id`, so the raw list can repeat — collapse it
 * so `deleteAuthUser` is called once per real account. Blank/undefined dropped.
 */
export function dedupeAuthUserIds(ids: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) seen.add(id);
  }
  return [...seen];
}

/**
 * Whether a provisioning claim's mailbox should be suspended+deleted at Google.
 * Only a claim that actually carries an `@`-address is a real Workspace mailbox
 * (path b); a path-a child has no claim/email and is skipped. A blank email is
 * never handed to the Directory API.
 */
export function hasWorkspaceMailbox(email: string | null | undefined): email is string {
  return typeof email === "string" && email.includes("@") && email.trim().length > 0;
}
