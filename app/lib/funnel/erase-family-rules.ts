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
 * ── NEW USER FLOW v3: THE KID-FIRST ONBOARDING TABLES (2026-08-06) ──────────
 * v3 added two tables and six `children` columns that hold a child's personal
 * data, and the erasure above knew about none of them. They are folded into the
 * SAME plan (no second mechanism), at these positions:
 *
 *   fp_handoff_codes        (20260913120000) — one-time sign-in codes bound to a
 *     child. `child_id -> children ON DELETE CASCADE`, so the roster delete
 *     would take them anyway; they are deleted EXPLICITLY and EARLY (leaf order,
 *     before the auth accounts) because a live sign-in credential must stop
 *     working before the identity it grants is torn down, and because an
 *     explicit delete is the only one that shows up in the summary and the
 *     order log. Idempotent (0 rows on a re-run).
 *
 *   fp_onboarding_drafts    (20260912120000 + 20260914/20260917) — the whole
 *     pre-account record: kid_first_name, kid_last_name, kid_age, the story
 *     `answers`, cover_data_url (the picture, INLINE in the row) and the two
 *     blob keys. Deleted PER CHILD by `child_id` BEFORE the `children` row, and
 *     that order is LOAD-BEARING, not cosmetic: `child_id -> children ON DELETE
 *     SET NULL`, so a `children` delete that got there first would leave the
 *     draft alive with its child pointer NULLED — a row full of a minor's data
 *     that a re-run could no longer FIND by child. The only remaining handle
 *     would be parent_id, and in a full-family erasure the parent auth delete
 *     CASCADEs the drafts away silently, taking the row but NOT the external
 *     blobs it names. Drafts first; then the child; then the parent.
 *
 *   children.fp_cover_* / fp_kid_age / fp_story_answers (20260914/17/18) — the
 *     carried copy of the same data. The COLUMNS need no step of their own: the
 *     `children` row is deleted outright (step 7), which takes every column with
 *     it. The ONE exception is `fp_cover_blob_key`, which does not hold data —
 *     it NAMES BYTES IN AN EXTERNAL STORE that a row delete cannot reach. See
 *     the blob rule below.
 *
 * ── THE BLOB RULE (external objects outlive the row that names them) ────────
 * `fp_onboarding_drafts.{photo_blob_key,cover_blob_key}` and
 * `children.fp_cover_blob_key` name objects in the blob store. A Blob URL is
 * permanent until the object is deleted, so deleting the row is NOT erasure —
 * it only destroys the last pointer to a minor's picture, leaving the bytes
 * readable forever by anyone holding the URL. The erasure therefore deletes the
 * OBJECT FIRST and the ROW SECOND, which INVERTS the pipeline's normal rule (2)
 * ("a blob is deleted only after no row references its key",
 * app/fp/lib/cover-store-rules.ts) — deliberately, and only here:
 *
 *   - Rule (2) protects LIVE rows from dangling references. In an erasure the
 *     referencing row is being destroyed in the next breath, so the reference it
 *     briefly dangles has no reader and no future.
 *   - The opposite order is unrecoverable: delete the row first and a crash
 *     leaves an object nothing points at, in a namespace nothing will ever
 *     enumerate again. That is the stranded-row hazard this file's RESUMABILITY
 *     section already forbids, applied to bytes instead of tuples.
 *   - This mirrors the reaper's documented sequence (plan: "CAS flip → delete
 *     blob(s) → null blob keys only after confirmed deletion"), which is the
 *     same object-before-pointer discipline.
 *
 * A blob delete is idempotent by contract: "missing" (already gone) is SUCCESS.
 * A store outage is "error", which is STRANDED — never swallowed, never counted
 * as done, and (via the existing per-child stranded guard) it BLOCKS that
 * child's `children` anchor delete so a re-run can finish the job. A key that
 * does not belong to the subject being erased is REFUSED and stranded rather
 * than deleted (`keyBelongsTo`): a mistaken caller must only ever fail to
 * delete, never delete another child's art.
 *
 * WITH NO BLOB ADAPTER CONFIGURED the erasure does NOT quietly skip a key it
 * found. Unlike the Workspace legs — a separate system whose absence is benign —
 * an undeleted object IS the data-rights failure, so a present key with no way
 * to delete it is stranded loudly (`blobUnconfigured`). Today this cannot fire:
 * the shipped cover path is TEMPLATE-ONLY, writes the picture INLINE as a data
 * URL, and sets `cover_blob_key = null` (verified 2026-08-06 against production:
 * zero non-null blob keys in `children` or `fp_onboarding_drafts`, and no
 * `@vercel/blob` dependency or adapter exists in the repo). The step is built now
 * so that the day the AI path lands, erasure is already correct.
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
 * ── KNOWN LIMIT: an ACTIVE child's Path student graph is NOT drained (yet) ──
 * path_student_profiles has ~9 inbound RESTRICT FKs on student_id
 * (path_task_progress, path_task_events, path_reviews, path_evidence_items,
 * path_notification_events, path_notification_sends, path_cohort_members,
 * path_fw_replay_rejects, path_fw_released_aliases.released_profile_id).
 * The Slice-B era statement "an FP-signup child is never enrolled in Path/FW
 * coursework" is STALE: the full-path work made FP children real path students,
 * and an ACTIVE child (any task submit) accrues progress/events/reviews/
 * evidence (with storage objects + EXIF) and notification rows. Erasing such a
 * child today RESTRICT-blocks step 4 (23503): the child is recorded stranded,
 * its `children` anchor is preserved (same guard as the resumability hole), and
 * an operator escalates — FAIL-SAFE, never silent, but not yet self-service.
 * Draining that graph in FK-safe order (evidence objects before rows) is the
 * documented follow-up unit; the coverage ledger classifies every one of those
 * tables so the obligation is written down rather than remembered.
 *
 * NOTE — fp_ledger is deleted FIRST, not last. The plan-brief's prose ordered it
 * after children, but `fp_ledger.profile_id -> fp_player_profiles ON DELETE
 * RESTRICT` makes that impossible: the profile delete (step 3) would raise 23503
 * while a ledger row references it. The migration header and the R20 solution
 * doc both state the true order "ledger -> saves -> profile -> child"; the Unit 0
 * handoff (plan line 220) likewise lists fp_ledger first. We honor the schema.
 *
 * Then, ONCE per family (full-family erasure):
 *   7c. the PARENT-SCOPED draft sweep: `fp_onboarding_drafts` rows for this
 *      parent that never reached a child (an abandoned signup — the kid's name,
 *      age, story answers and cover, with `child_id` still NULL). They are
 *      reachable ONLY by parent_id, and step 9's parent auth delete CASCADEs
 *      them away silently, so they must be swept HERE, blobs first, while a
 *      handle to them still exists. Full-family scope only: in a child-scoped
 *      erasure the parent survives and their other kids' drafts are none of
 *      this run's business.
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
 *   8b. the PARENT-KEYED RESTRICT REFERRERS of auth.users (2026-08-06, found by
 *      the FIRST live family erasure, not by review). `path_role_grants.user_id`
 *      is ON DELETE RESTRICT, and EVERY v3 parent holds a verifier grant
 *      (child-core mints it at provisioning), so step 9 failed for a perfectly
 *      ordinary family: the account delete 23503'd, the parent stranded, and
 *      only a hand-issued SQL delete finished the job. The full audit of
 *      auth.users' RESTRICT referrers (pg_constraint, live, 2026-08-06) splits
 *      them three ways:
 *        - profile tables (fp_player_profiles / path_student_profiles.user_id):
 *          already deleted per child in steps 3-4;
 *        - attribution columns on the STUDENT's own graph (path_task_progress.
 *          verified_by, path_task_events.actor, path_reviews.opened_by/
 *          decided_by): those rows cascade away with the child's profile before
 *          step 9 runs, so a parent who verified their own kids' work is clear;
 *        - rows keyed DIRECTLY on the parent, which nothing upstream removes:
 *          path_role_grants.user_id (the universal verifier grant) and
 *          path_notification_sends.recipient_user_id (the notifications cron's
 *          send log). These are swept HERE — PARENT_AUTH_RESTRICT_SWEEP is the
 *          shared definition — and the sweep runs INSIDE the zero-stranded
 *          branch, immediately before the account delete, never earlier: the
 *          send log is the pipeline's only idempotency record, and deleting it
 *          while a stranded child's task events survive lets the cron's
 *          reconcile pass re-derive the rows and RE-EMAIL the parent who asked
 *          to be erased. Only when every child is fully gone are the
 *          derivation inputs gone too.
 *      The remaining referrers are NOT swept, each for a stated reason:
 *        - staff-only attribution (path_cohorts.created_by, the FW audit
 *          tables, ...) can never reference a v3 parent;
 *        - path_parent_invites.invited_by/accepted_by ARE parent-held columns,
 *          but the co-parent invite flow has ZERO rows in production, ever,
 *          and its UI is retired in the FP-surface-deletion ship. An invite
 *          row also references TWO principals, so what one principal's erasure
 *          does with it is a real decision for whenever the flow revives —
 *          not a default sweep now.
 *      If any of these ever DOES reference an erased account, step 9 strands
 *      loudly for triage, which is the correct fail-closed posture. Full-family
 *      scope only: a child-scoped erasure preserves the parent, their grant,
 *      and their mail history.
 *   9. the parent auth.users account (CASCADE-removes parents -> any remaining
 *      children/deposits — by now the children are already gone).
 *
 * PRESERVED (never deleted by an erasure): funnel_released_aliases — the
 * never-reissue ledger. The address-reuse guarantee outlives the child; a burned
 * local_part must stay burned.
 */

// The blob namespace scheme + its ownership guard. `cover-store-rules` is PURE
// (no SDK, no Supabase, no Next), so importing it here keeps this file pure too;
// the vendor-facing side of the port lives behind an injected dep in the core.
import { keyBelongsTo, type CoverOwnerScope } from "@/app/fp/lib/cover-store-rules";

/** The ordered per-child leaf tables (before the child's own auth + children
 *  row). Exported so the executor and its tests share ONE definition of order. */
export const CHILD_LEAF_DELETE_ORDER = [
  "fp_public_sites",
  "fp_ledger",
  "fp_player_saves",
  "fp_player_profiles",
  "path_student_profiles",
  // v3: the sign-in codes die before the identity they grant (CASCADE-backed,
  // deleted explicitly so it is visible and countable).
  "fp_handoff_codes",
  // v3: MUST precede the `children` delete — child_id is ON DELETE SET NULL, so
  // a roster delete first would orphan a row full of a minor's data.
  "fp_onboarding_drafts",
  // Image Lab v1: the SAME hazard as the drafts above, one table over.
  // `source_child_id -> children ON DELETE SET NULL`, so the roster delete keeps
  // the run and erases its provenance. Deleted here, after its storage objects.
  "fp_image_lab_runs",
] as const;

/**
 * Tables swept ONCE per family, keyed on `parent_id`, for rows that never
 * reached a child (and so are invisible to the per-child pass). Ordered before
 * the parent auth delete, whose CASCADE would otherwise take them silently.
 */
export const PARENT_SCOPED_DELETE_ORDER = ["fp_onboarding_drafts"] as const;

/** The family-level evidence tables removed as the deliberate final step. */
export const FAMILY_EVIDENCE_DELETE_ORDER = ["fp_parental_consent", "fp_signup_attempts"] as const;

/**
 * Rows keyed DIRECTLY on the parent's auth user id whose FK to auth.users is
 * ON DELETE RESTRICT — they physically block step 9's account delete and
 * nothing upstream removes them (see step 8b in the header; discovered live,
 * 2026-08-06). Swept once per family, immediately before the account delete.
 * Order is irrelevant (both reference only auth.users); the list is exported so
 * the executor and its tests share one definition, like the orders above.
 */
export const PARENT_AUTH_RESTRICT_SWEEP = [
  // The verifier grant child-core mints for EVERY v3 parent at provisioning —
  // the row that made the first live erasure strand its parent.
  { table: "path_role_grants", column: "user_id" },
  // The path-notifications cron's send log, keyed on the recipient. A send log
  // about an erased person is itself personal data; RESTRICT forces the choice
  // and deletion is the right one.
  { table: "path_notification_sends", column: "recipient_user_id" },
] as const;

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
  // Added 2026-08-06 with the v3 coverage ledger, which forced a per-column
  // decision on this SURVIVING row and surfaced two more identity-bearing
  // columns on it:
  //   forwarding_target — the PARENT'S email address (20260819120000), sitting
  //     on a row that outlives the whole family by design.
  //   last_error        — the last Directory/API failure string, which routinely
  //     embeds the child's full mailbox address. It is operational diagnostics
  //     with no value once the claim is released, so it is nulled rather than
  //     left as a back door to the address every other column just gave up.
  "forwarding_target",
  "last_error",
] as const;

/**
 * The column that MUST survive the scrub. `local_part` is the never-reissue
 * ledger key: nulling it (or deleting the row) would re-open the address to the
 * next same-name child, exactly the failure the total-unique index prevents.
 */
export const RELEASED_CLAIM_PRESERVED_COLUMN = "local_part" as const;

/* ────────────────────────── external objects (the blob rule) ────────────── */

/* ────────────────────────────── the Image Lab purge ─────────────────────── */

/**
 * IMAGE LAB v1 (#140/#143) — the third table of a child's data the eraser has to
 * know about, and the one whose purge is a PROCEDURE rather than a delete.
 *
 * `fp_image_lab_runs` records a staff prompt→image run. `source_child_id`
 * references `children(id)` ON DELETE SET NULL, and `template` / `slot_values` /
 * `resolved_prompt` carry the CHILD'S OWN AUTHORED TEXT — the migration header
 * (20260919120000) says so explicitly and instructs the reader to treat these
 * rows as child-PII-bearing. Two consequences make a plain delete wrong:
 *
 *   1. ORDER. SET NULL means a `children` delete does not remove the run — it
 *      removes the only link that could ever FIND it again. So the purge must
 *      run BEFORE the roster row, like the drafts sweep and for the same reason.
 *   2. LINEAGE. Iterating on a run COPIES its template and slot values forward,
 *      and `iterated_from_run_id` is ALSO ON DELETE SET NULL, so deleting the
 *      parent first severs the only breadcrumb to a descendant carrying the same
 *      child's words. The purge walks descendants first, then deletes the set.
 *
 * And the images are BYTES OUTSIDE POSTGRES (`fp_image_lab_images.storage_key`,
 * in the private `fp-image-lab` bucket, cascade-deleted with their run). Same
 * object-before-row rule as the cover blobs: the row is the only record of its
 * key, so deleting rows past a failed object delete leaves the survivors
 * permanently unattributable.
 *
 * ⚠ THE IN-FLIGHT WINDOW (purge step 0 in the migration). A cell that is
 * `requested` with a non-null `attempted_at` has a vendor call running and no
 * `storage_key` yet: its bytes are ON THE WAY and would land in the bucket after
 * we collected the keys, surviving the erasure with nothing left pointing at
 * them. The eraser does not wait out IMAGE_LAB_STALE_AFTER_MS inside a request —
 * it STRANDS the child, which preserves the anchor and makes the re-run finish
 * the job once the window drains. Deferring loudly beats erasing incompletely.
 */
export const IMAGE_LAB_RUNS_TABLE = "fp_image_lab_runs" as const;
export const IMAGE_LAB_IMAGES_TABLE = "fp_image_lab_images" as const;

/** Bound on the lineage walk. Each hop is one round trip; a `seen` set already
 *  guarantees termination, so this only caps a pathological chain depth. */
export const IMAGE_LAB_LINEAGE_MAX_HOPS = 64;

/** An image row is IN FLIGHT when it is latched but not finalized: a vendor call
 *  may be running and its object may not exist yet. See the ⚠ above. */
export function isImageLabCellInFlight(row: {
  state?: unknown;
  attempted_at?: unknown;
}): boolean {
  return row.state === "requested" && row.attempted_at != null;
}

/**
 * Generated-image keys are DETERMINISTIC — `runs/{run_id}/{image_id}` (migration
 * header). The eraser only ever deletes a key it read off a row it selected by
 * run id, so provenance is already established; this re-derives it anyway, for
 * the same reason `keyBelongsTo` exists on the cover path. A mistaken caller
 * must only ever fail to delete, never delete someone else's object.
 */
export function imageLabKeyBelongsToRun(key: string, runId: string): boolean {
  return key.startsWith(`runs/${runId}/`);
}

/** Columns on `fp_onboarding_drafts` that NAME an object in the blob store.
 *  `photo_blob_key` is the source photo of a minor; `cover_blob_key` is the
 *  generated art. Both must be deleted at the store, not merely dereferenced. */
export const DRAFT_BLOB_KEY_COLUMNS = ["photo_blob_key", "cover_blob_key"] as const;

/** The same, on `children` (the copy made at the draft→child carry). */
export const CHILD_BLOB_KEY_COLUMNS = ["fp_cover_blob_key"] as const;

/** One object an erasure intends to delete, with the ownership verdict already
 *  applied. `owned:false` means the key does not live in this subject's own
 *  namespace and MUST NOT be deleted (refused + stranded instead). */
export type PlannedBlobDelete = {
  key: string;
  scope: CoverOwnerScope;
  ownerId: string;
  owned: boolean;
};

/**
 * Turn a subject's raw key columns into the ordered, de-duplicated delete plan.
 * Pure: blank/absent keys vanish (a row with no cover has nothing to delete, and
 * that is the overwhelmingly common case), duplicates collapse (the same key can
 * legitimately appear on two columns after a carry), and every survivor carries
 * the `keyBelongsTo` verdict so the executor never has to re-derive it.
 */
export function planSubjectBlobDeletes(input: {
  scope: CoverOwnerScope;
  ownerId: string;
  keys: readonly (string | null | undefined)[];
}): PlannedBlobDelete[] {
  const seen = new Set<string>();
  const out: PlannedBlobDelete[] = [];
  for (const raw of input.keys) {
    const key = (raw ?? "").trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      scope: input.scope,
      ownerId: input.ownerId,
      owned: keyBelongsTo(key, input.scope, input.ownerId),
    });
  }
  return out;
}

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
