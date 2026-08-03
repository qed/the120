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
 *   fp_public_sites.profile_id      -> fp_player_profiles  ON DELETE RESTRICT
 *   fp_ledger.profile_id            -> fp_player_profiles  ON DELETE RESTRICT
 *   fp_player_saves.profile_id      -> fp_player_profiles  ON DELETE RESTRICT
 *   fp_player_profiles.user_id      -> auth.users          ON DELETE RESTRICT
 *   fp_player_profiles.child_id     -> children            ON DELETE RESTRICT
 *   path_student_profiles.user_id   -> auth.users          ON DELETE RESTRICT
 *   path_student_profiles.child_id  -> children            ON DELETE RESTRICT
 *   funnel_student_provisioning.child_id -> children  ON DELETE SET NULL (+trigger)
 *   parents.id                      -> auth.users          ON DELETE CASCADE
 *   children.parent_id              -> parents             ON DELETE CASCADE
 *   fp_parental_consent.{parent,child,attempt}_id          ON DELETE SET NULL
 *   fp_signup_attempts.{parent,child}_id                   ON DELETE SET NULL
 *
 * ── The provisioning claim is SET NULL, NOT CASCADE (20260818120000) ──
 * `funnel_student_provisioning.child_id -> children` is `ON DELETE SET NULL`, and
 * a BEFORE-UPDATE trigger (funnel_provisioning_child_deleted) flips the orphaned
 * claim to state='released', released_reason='child_deleted'. The row SURVIVES the
 * child delete BY DESIGN — it is the never-reissue local_part ledger, so its
 * `local_part` must stay burned forever. A data-rights erasure therefore does NOT
 * expect the claim row to disappear; instead it SCRUBS the residual PII off the
 * surviving released claim (null `email`, `workspace_attempted_email`,
 * `supabase_user_id`) while PRESERVING `local_part` (the reissue guarantee). This
 * corrects the earlier, wrong "CASCADE removes the claim" model.
 *
 * Therefore, per child:
 *   0. fp_public_sites     (RESTRICT -> profiles: the child's public page dies
 *      FIRST — the amended ordering "sites → ledger → saves → profile → child"
 *      from migration 20260907120000_fp_public_sites.sql. Deleting the row
 *      frees the handle and 404s the page; an OPERATOR-LOCKED row is still
 *      deleted (a data-rights erasure outranks a takedown lock) but NEVER
 *      SILENTLY: the executor logs it loudly and records `site-locked-released`
 *      in the order log so the operator sees the lock was released by erasure)
 *   1. fp_ledger           (RESTRICT -> profiles: must precede the profile)
 *   2. fp_player_saves     (RESTRICT -> profiles: must precede the profile)
 *   3. fp_player_profiles  (RESTRICT -> children AND auth.users)
 *   4. path_student_profiles (RESTRICT -> children AND auth.users)
 *   5. Workspace mailbox: SUSPEND then DELETE (path-b; read the address off
 *      funnel_student_provisioning BEFORE the child row is gone — the child delete
 *      SET-NULLs the claim's child_id, so re-finding the address by child_id
 *      afterwards would fail)
 *   6. the child's OWN auth.users login accounts (now unreferenced: steps 3-4
 *      cleared the RESTRICT referrers). The path-b account's id is ALSO carried on
 *      the claim's `supabase_user_id`, a DURABLE handle that outlives the profile
 *      rows (see the resumability note below)
 *   7. the children row (deposits CASCADE away; the provisioning claim does NOT —
 *      it SET-NULLs + releases and survives, then step 7b scrubs its PII)
 *   7b. scrub the surviving released claim's PII (email, workspace_attempted_email,
 *      supabase_user_id) while PRESERVING local_part — the true-erasure step the
 *      never-reissue ledger's survival makes necessary
 *
 * ── RESUMABILITY (why the auth id must be recoverable across a profile delete) ──
 * enumerateChild derives a child's auth ids from BOTH profile rows AND the claim's
 * `supabase_user_id`. RESTRICT forces profiles (3-4) to be deleted before the auth
 * accounts (6); if a run dies (or a step returns not-ok) in between, a re-run finds
 * the profiles gone. For path b the claim's `supabase_user_id` still resolves the
 * account (the claim row is preserved), so it can be torn down. A child that gained
 * ANY stranded marker this run (auth-delete not ok, workspace error, or a
 * RESTRICT-blocked leaf delete) MUST NOT have its `children` anchor deleted — the
 * anchor is left so a re-run RE-ENUMERATES the survivor, and summary.ok stays false.
 * Deleting the anchor while an account is orphaned (or worse, deleting the parent,
 * which CASCADEs the anchor away) is the resumability hole this guards.
 *
 * ── INVARIANT: FP-signup children carry NO Path/FW coursework (Slice B) ──
 * path_student_profiles has ~10 inbound RESTRICT FKs (path_progress.student_id,
 * path_evidence.student_id, path_notifications.student_id/recipient,
 * fw_cohort_sprints, path_task_reviews, ...). An FP-signup child is minted fresh
 * (child-core.ts) and is NEVER enrolled in Path/FW coursework in Slice B, so those
 * dependents are EXPECTED EMPTY and the enumeration deliberately does NOT drain
 * them (out of scope — draining the whole Path/FW graph is a different unit). The
 * executor is nonetheless FAIL-SAFE: if the path_student_profiles delete is
 * RESTRICT-blocked (23503, an unexpected dependent), the child is recorded stranded
 * and its `children` anchor is preserved (same guard as the resumability hole),
 * never silently proceeding past the block.
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
 *      EXPLICIT, deliberate final step. fp_signup_attempts is deleted by
 *      `parent_id` (the principal-scoped key); the `parent_email` scope is a
 *      FALLBACK used ONLY when the parent_id delete matched nothing (a prior
 *      partial run already SET-NULLed it), never as an unconditional second sweep
 *      — an unscoped email delete would destroy a DIFFERENT principal's attempt
 *      rows that merely reused the same email. DOCUMENTED ordering choice:
 *      evidence is removed last, on purpose.
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
  "fp_public_sites",
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
 * The PII columns scrubbed on the SURVIVING released provisioning claim after a
 * child delete (the claim is SET NULL + released, never cascaded away — see the
 * header). A true erasure nulls these so no minor's address/identity lingers on
 * the retained ledger row.
 */
export const RELEASED_CLAIM_PII_COLUMNS = [
  "email",
  "workspace_attempted_email",
  "supabase_user_id",
] as const;

/**
 * The column that MUST survive the scrub. `local_part` is the never-reissue
 * ledger key: nulling it (or deleting the row) would re-open the address to the
 * next same-name child, exactly the failure the total-unique index prevents.
 */
export const RELEASED_CLAIM_PRESERVED_COLUMN = "local_part" as const;

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
