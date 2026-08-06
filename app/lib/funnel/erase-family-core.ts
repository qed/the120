/**
 * R28 data-rights erasure — the injected-db EXECUTOR (Slice B Unit 6). House
 * core pattern: NO "use server", NO `server-only` — the real deps come from
 * `realEraseFamilyDeps()` (provision-deps.ts) and tests inject fakes, so no real
 * DB is touched and no real Directory API is called in build/test. Every DECISION
 * about ORDER lives in `erase-family-rules.ts`; this file sequences the effects.
 *
 * Executes the full FK-safe deletion order END-TO-END for a family (see
 * erase-family-rules.ts for the order + the FK evidence). Properties:
 *   - IDEMPOTENT + RESUMABLE: every step is a delete that no-ops when the rows
 *     are already gone; a partial erasure re-run re-enumerates the survivors and
 *     finishes. RESTRICT guarantees a child is never half-deleted (its
 *     descendants are removed before the child row), so re-enumeration is always
 *     consistent.
 *   - EXTERNAL OBJECTS TOO: the v3 cover/photo blobs named by
 *     `fp_onboarding_drafts.{photo,cover}_blob_key` and
 *     `children.fp_cover_blob_key` are deleted at the STORE, object before row
 *     (a row delete only drops the pointer; the bytes stay readable forever).
 *     A missing object is success; a store outage is stranded, never swallowed.
 *     The Image Lab's generated images (`fp_image_lab_images.storage_key`, in the
 *     private `fp-image-lab` bucket) get the same treatment via `purgeImageLab`,
 *     which also walks the run lineage the migration's purge runbook requires.
 *   - The Workspace suspend+delete is GATED on `workspaceConfigured`: with no
 *     `GOOGLE_WORKSPACE_SA_KEY` the Google legs are skipped (counted `skipped`),
 *     exactly as provisioning parks `pending`. The one live exercise is Unit 11.
 *   - NEVER throws — returns a typed summary with an ordered operation log and a
 *     `stranded` list for any delete that failed (logged loudly, like the child-
 *     core compensation's STRANDED markers), so an operator can re-run or triage.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ⚠ SECURITY — CALLER AUTHORIZATION IS NOT PERFORMED HERE (forward-guard). ║
 * ║ eraseFamily does NO authz of its own and is deliberately NOT yet wired to ║
 * ║ any route. The Unit 11 call site MUST be SERVICE-ROLE / ADMIN-GATED and   ║
 * ║ FAIL-CLOSED — a GET behind CRON_SECRET (or an equivalent admin gate), so  ║
 * ║ a normal principal can NEVER reach it. It hard-deletes an entire family's ║
 * ║ accounts, mailboxes, and consent evidence keyed ONLY on the ids passed in;║
 * ║ there is no ownership check inside. Do NOT expose it on a principal-       ║
 * ║ reachable path. (See the matching note on realEraseFamilyDeps.)           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHILD_BLOB_KEY_COLUMNS,
  dedupeAuthUserIds,
  DRAFT_BLOB_KEY_COLUMNS,
  hasWorkspaceMailbox,
  IMAGE_LAB_IMAGES_TABLE,
  IMAGE_LAB_LINEAGE_MAX_HOPS,
  IMAGE_LAB_RUNS_TABLE,
  imageLabKeyBelongsToRun,
  isImageLabCellInFlight,
  planSubjectBlobDeletes,
  RELEASED_CLAIM_PII_COLUMNS,
  type PlannedBlobDelete,
} from "./erase-family-rules";

export type EraseFamilyDeps = {
  /** Service-role client — every read + delete + the auth-account deletes. */
  db: SupabaseClient;
  /** admin.auth.admin.deleteUser wrapper; ok:false on a real failure (404 is
   *  treated as ok upstream — an already-gone account is a successful erasure). */
  deleteAuthUser: (userId: string) => Promise<{ ok: boolean }>;
  /** Directory suspend (idempotent: "missing" for a 404). */
  suspendWorkspaceUser: (email: string) => Promise<"suspended" | "missing" | "error">;
  /** Directory delete (idempotent: "missing" for a 404). Gated — see below. */
  deleteWorkspaceUser: (email: string) => Promise<"deleted" | "missing" | "error">;
  /** False when GOOGLE_WORKSPACE_SA_KEY is absent: the core SKIPS both Google
   *  legs entirely (no real Directory call in normal build/test). */
  workspaceConfigured: boolean;
  /**
   * Delete ONE object from the blob store, by key. Idempotent by contract:
   * "missing" (already gone) is SUCCESS, exactly like the Directory legs' 404
   * handling. "error" is a real store failure and is reported honestly — the
   * core strands it, so a blob-store outage can never be mistaken for an
   * erasure. Never throws in a well-behaved adapter; the core defends anyway.
   */
  deleteBlob?: (key: string) => Promise<"deleted" | "missing" | "error">;
  /**
   * False when no blob adapter is wired (today: always — the cover path is
   * template-only and no `@vercel/blob` adapter exists yet; see the seam at the
   * bottom of app/lib/fp/cover-store.ts). UNLIKE `workspaceConfigured`, this is
   * NOT a benign skip: if a row actually names an object and there is no way to
   * delete it, the core STRANDS the key rather than proceeding, because an
   * undeleted object is the data-rights failure itself. With no keys present
   * (the shipped reality) it is simply never consulted.
   */
  blobConfigured: boolean;
  /**
   * Delete ONE object from the Image Lab's private Supabase Storage bucket
   * (`fp-image-lab`), by storage key. Same idempotent contract as `deleteBlob`:
   * "missing" (already gone) is SUCCESS, "error" is a real store failure and is
   * stranded.
   *
   * REQUIRED, with NO `imageLabConfigured` twin, and the asymmetry with
   * `deleteBlob` is deliberate: Vercel Blob has no adapter and no token in this
   * repo, so "unconfigured" is an honest state there. This bucket is reached
   * through the very service-role client `db` already is — it is always wired,
   * so there is no honest way to be unconfigured, and making the dep mandatory
   * means a future deps factory cannot quietly omit it and leave a minor's
   * generated imagery in the bucket.
   */
  deleteImageLabObject: (key: string) => Promise<"deleted" | "missing" | "error">;
  now: () => number;
};

export type EraseFamilyInput = {
  /** The parent's auth user id (== parents.id). Anchors the whole family. */
  parentUserId: string;
  /** The parent's signup email — a STABLE handle (never nulled) for finding
   *  fp_signup_attempts after the account FK has been SET NULL (resumability). */
  parentEmail: string;
  /**
   * Optional child-scoped erasure: restrict to these child ids (verified to
   * belong to the parent) and PRESERVE the parent account + parent-level
   * attempts. Omitted = full-family erasure (children + consent evidence +
   * parent account).
   */
  childIds?: readonly string[];
};

export type EraseFamilySummary = {
  ok: boolean;
  scope: "family" | "child";
  childrenErased: number;
  deleted: {
    fp_public_sites: number;
    fp_ledger: number;
    fp_player_saves: number;
    fp_player_profiles: number;
    path_student_profiles: number;
    /** v3: one-time sign-in codes bound to the child. */
    fp_handoff_codes: number;
    /** v3: the kid-first onboarding drafts (name, age, story answers, cover). */
    fp_onboarding_drafts: number;
    /** Image Lab: runs sourced from this child, plus their copy-forward
     *  descendants. `fp_image_lab_images` rows CASCADE with them. */
    fp_image_lab_runs: number;
    children: number;
    authUsers: number;
    fp_parental_consent: number;
    fp_signup_attempts: number;
  };
  workspace: { suspended: number; deleted: number; missing: number; skipped: number; errored: number };
  /**
   * External blob objects (cover / source photo). `missing` is a SUCCESS
   * (already-deleted is a completed erasure); `errored` is a store outage and
   * `unconfigured` is "a key exists and there is no adapter to delete it" —
   * both are also recorded in `stranded`, so neither can pass as done.
   * `refused` is a key outside the subject's own namespace, never deleted.
   */
  blobs: {
    deleted: number;
    missing: number;
    errored: number;
    refused: number;
    unconfigured: number;
  };
  /**
   * The Image Lab purge's object accounting, kept separate from `blobs` because
   * it is a different store with a different adapter: `missing` is success,
   * `errored` is a store outage, `refused` is a key outside its own run's
   * namespace, and `deferred` counts children whose purge was postponed because
   * a cell was still IN FLIGHT. Every non-success is also in `stranded`.
   */
  imageLab: {
    objectsDeleted: number;
    objectsMissing: number;
    objectsErrored: number;
    objectsRefused: number;
    deferredInFlight: number;
  };
  /** Released provisioning claims whose residual PII was scrubbed after the child
   *  delete (row + local_part preserved; email/attempted-email/supabase_user_id
   *  nulled). See RELEASED_CLAIM_PII_COLUMNS. */
  scrubbedReleasedClaims: number;
  parentAccountDeleted: boolean;
  /** Ordered table-level operation log for auditing / order assertions. */
  order: string[];
  /** Rows/accounts whose delete failed — loud, for triage + re-run. */
  stranded: string[];
};

type Db = SupabaseClient;

/** Delete rows and return the count actually removed (PostgREST returns the
 *  deleted rows when `.select()` is chained). Records the op in the order log
 *  and any error in `stranded`. Idempotent: 0 rows is a valid no-op. */
async function del(
  db: Db,
  table: string,
  column: string,
  value: string | readonly string[],
  summary: EraseFamilySummary,
  label: string
): Promise<number> {
  const q = db.from(table).delete();
  const filtered = Array.isArray(value) ? q.in(column, value as string[]) : q.eq(column, value as string);
  const { data, error } = await filtered.select("*");
  if (error) {
    console.error(`[erase] STRANDED: ${table} delete (${label}) failed: ${error.message}`);
    summary.stranded.push(`${table}:${label}:${error.message}`);
    return 0;
  }
  const n = (data ?? []).length;
  if (n > 0) summary.order.push(`${table}:${label}(${n})`);
  return n;
}

/**
 * Delete the external objects a subject owns, OBJECT BEFORE ROW (see the blob
 * rule in erase-family-rules.ts). Every outcome is accounted for:
 *
 *   deleted / missing → success (missing = already gone = a completed erasure)
 *   error             → the store failed. STRANDED + logged; never swallowed.
 *   unconfigured      → a key exists with no adapter to delete it. STRANDED.
 *   not owned         → refused (never deleted) + STRANDED for triage.
 *
 * Because every non-success lands in `summary.stranded`, the caller's existing
 * per-child strand guard preserves the `children` anchor, and `summary.ok`
 * goes false — a blob failure downgrades the whole run exactly like a failed
 * row delete does.
 */
async function eraseBlobs(
  deps: EraseFamilyDeps,
  summary: EraseFamilySummary,
  plan: readonly PlannedBlobDelete[],
  label: string
): Promise<void> {
  for (const item of plan) {
    if (!item.owned) {
      console.error(
        `[erase] STRANDED: refusing to delete blob key outside the ${item.scope} ${item.ownerId} namespace (${label})`
      );
      summary.blobs.refused++;
      summary.stranded.push(`blob:not_owned:${label}:${item.key}`);
      continue;
    }
    const del = deps.deleteBlob;
    if (!deps.blobConfigured || !del) {
      console.error(
        `[erase] STRANDED: ${label} names blob ${item.key} but no blob adapter is configured — the object SURVIVES this erasure; wire the adapter and re-run`
      );
      summary.blobs.unconfigured++;
      summary.stranded.push(`blob:unconfigured:${label}:${item.key}`);
      continue;
    }
    let outcome: "deleted" | "missing" | "error";
    try {
      outcome = await del(item.key);
    } catch (err) {
      // A throwing adapter is an outage, not a success. Same branch as "error".
      console.error(
        `[erase] blob delete threw for ${item.key} (${label}): ${err instanceof Error ? err.message : String(err)}`
      );
      outcome = "error";
    }
    if (outcome === "deleted") {
      summary.blobs.deleted++;
      summary.order.push(`blob:deleted(${label})`);
    } else if (outcome === "missing") {
      // Already gone. Idempotent re-run, or a reaper that got there first.
      summary.blobs.missing++;
      summary.order.push(`blob:missing(${label})`);
    } else {
      console.error(
        `[erase] STRANDED: blob delete failed for ${item.key} (${label}) — the object may still exist; re-run after the store recovers`
      );
      summary.blobs.errored++;
      summary.stranded.push(`blob:error:${label}:${item.key}`);
    }
  }
}

/** One onboarding draft's identity + the objects it names. */
type DraftRow = {
  id: string;
  blobKeys: (string | null)[];
};

/** Read the drafts matching one filter, with the two blob-key columns. A read
 *  failure is STRANDED, never treated as "no drafts": silently proceeding would
 *  delete the anchor and orphan the row this step exists to remove. */
async function readDrafts(
  db: Db,
  column: "child_id" | "parent_id",
  value: string,
  summary: EraseFamilySummary,
  label: string
): Promise<{ ok: boolean; drafts: DraftRow[] }> {
  // The projection is a STATIC literal (supabase-js types it at compile time and
  // cannot parse an interpolated one) — it MUST list every DRAFT_BLOB_KEY_COLUMNS
  // entry. `readKeys` below strands loudly if it ever stops doing so, so the two
  // cannot drift into a silently-unerased object.
  const { data, error } = await db
    .from("fp_onboarding_drafts")
    .select("id, photo_blob_key, cover_blob_key")
    .eq(column, value);
  if (error) {
    console.error(
      `[erase] STRANDED: fp_onboarding_drafts read (${column}=${value}, ${label}) failed: ${error.message}`
    );
    summary.stranded.push(`fp_onboarding_drafts:read:${label}:${error.message}`);
    return { ok: false, drafts: [] };
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return {
    ok: true,
    drafts: rows.map((r) => ({
      id: String(r.id),
      blobKeys: readKeys(r, DRAFT_BLOB_KEY_COLUMNS),
    })),
  };
}

/**
 * Pull the blob-key columns off a row. Absent / null / non-string all mean "this
 * subject owns no object here", which is the overwhelmingly common case (and the
 * only case in production today).
 *
 * The risk this cannot see is a PROJECTION DRIFT: someone adds a third key
 * column to DRAFT_BLOB_KEY_COLUMNS and forgets the static `.select(...)` literal
 * above, so the value arrives undefined and the object is never deleted. That is
 * guarded one level up instead, by the coverage test
 * (__tests__/erase-family-schema-coverage.test.ts), which asserts every column
 * named by those constants literally appears in this file's projections.
 */
function readKeys(row: Record<string, unknown>, columns: readonly string[]): (string | null)[] {
  return columns.map((col) => (typeof row[col] === "string" ? (row[col] as string) : null));
}

/**
 * The v3 draft step, shared by the per-child pass and the family-level
 * parent-scoped sweep: blobs first (object before row), then the rows. A read
 * failure or a stranded blob leaves the rows in place for the re-run.
 */
async function eraseDrafts(
  deps: EraseFamilyDeps,
  summary: EraseFamilySummary,
  column: "child_id" | "parent_id",
  value: string,
  label: string
): Promise<void> {
  const read = await readDrafts(deps.db, column, value, summary, label);
  if (!read.ok || read.drafts.length === 0) return;
  const strandedBefore = summary.stranded.length;
  for (const draft of read.drafts) {
    await eraseBlobs(
      deps,
      summary,
      planSubjectBlobDeletes({ scope: "draft", ownerId: draft.id, keys: draft.blobKeys }),
      `draft:${draft.id}`
    );
  }
  if (summary.stranded.length > strandedBefore) {
    // Object before row: a key we could not delete must keep its row, or the
    // bytes become unreachable forever.
    console.error(
      `[erase] fp_onboarding_drafts rows for ${column}=${value} PRESERVED — a blob delete did not succeed; re-run to finish`
    );
    summary.order.push(`fp_onboarding_drafts:preserved(${label})`);
    return;
  }
  summary.deleted.fp_onboarding_drafts += await del(
    deps.db,
    "fp_onboarding_drafts",
    column,
    value,
    summary,
    label
  );
}

/**
 * THE IMAGE LAB PURGE (Image Lab v1, #140/#143) — the migration's own runbook
 * (20260919120000, "CONSENT-REVOCATION PURGE"), executed for real rather than
 * left as prose. See the long note in erase-family-rules.ts for WHY each step
 * exists; this function is the sequence:
 *
 *   1. seed   — runs whose `source_child_id` is this child
 *   2. walk   — copy-forward descendants via `iterated_from_run_id`
 *   3. gather — the images of every run in that set
 *   4. defer  — if ANY cell is in flight, strand and stop (bytes still landing)
 *   5. delete — the OBJECTS, at the store, before any row
 *   6. verify — a single failed object delete keeps EVERY row, because the row
 *               is the only record of its key
 *   7. delete — the run rows; images CASCADE
 *
 * Every failure is stranded, so the caller's per-child guard preserves the
 * `children` anchor and the whole run reports ok:false. Zero runs (production
 * today) costs exactly one SELECT and returns.
 */
async function purgeImageLab(
  deps: EraseFamilyDeps,
  summary: EraseFamilySummary,
  childId: string
): Promise<void> {
  const { db } = deps;
  const label = `child:${childId}`;
  const strandedBefore = summary.stranded.length;

  // 1: the runs this child sourced.
  const seed = await db.from(IMAGE_LAB_RUNS_TABLE).select("id").eq("source_child_id", childId);
  if (seed.error) {
    console.error(`[erase] STRANDED: ${IMAGE_LAB_RUNS_TABLE} read (${label}) failed: ${seed.error.message}`);
    summary.stranded.push(`${IMAGE_LAB_RUNS_TABLE}:read:${label}:${seed.error.message}`);
    return;
  }
  const runIds = new Set<string>(((seed.data ?? []) as Record<string, unknown>[]).map((r) => String(r.id)));
  if (runIds.size === 0) return; // The universal case today: nothing to purge.

  // 2: the copy-forward lineage. A `seen` set terminates the walk even if the
  //    self-referencing FK ever forms a cycle; the hop cap is belt-and-braces.
  let frontier = [...runIds];
  for (let hop = 0; hop < IMAGE_LAB_LINEAGE_MAX_HOPS && frontier.length > 0; hop++) {
    const kids = await db
      .from(IMAGE_LAB_RUNS_TABLE)
      .select("id")
      .in("iterated_from_run_id", frontier);
    if (kids.error) {
      console.error(
        `[erase] STRANDED: ${IMAGE_LAB_RUNS_TABLE} lineage walk (${label}) failed: ${kids.error.message}`
      );
      summary.stranded.push(`${IMAGE_LAB_RUNS_TABLE}:lineage:${label}:${kids.error.message}`);
      return;
    }
    const next: string[] = [];
    for (const r of (kids.data ?? []) as Record<string, unknown>[]) {
      const id = String(r.id);
      if (!runIds.has(id)) {
        runIds.add(id);
        next.push(id);
      }
    }
    frontier = next;
  }
  const allRunIds = [...runIds];

  // 3: the images of every run in the tainted set.
  const images = await db
    .from(IMAGE_LAB_IMAGES_TABLE)
    .select("id, run_id, state, attempted_at, storage_key")
    .in("run_id", allRunIds);
  if (images.error) {
    console.error(
      `[erase] STRANDED: ${IMAGE_LAB_IMAGES_TABLE} read (${label}) failed: ${images.error.message}`
    );
    summary.stranded.push(`${IMAGE_LAB_IMAGES_TABLE}:read:${label}:${images.error.message}`);
    return;
  }
  const imageRows = (images.data ?? []) as Record<string, unknown>[];

  // 4: the in-flight window. Its bytes have not landed yet, so collecting keys
  //    now would miss them and deleting the rows would erase the only record of
  //    where they land. Defer the whole child to the re-run, loudly.
  const inFlight = imageRows.filter(isImageLabCellInFlight);
  if (inFlight.length > 0) {
    console.error(
      `[erase] STRANDED: ${inFlight.length} Image Lab cell(s) for ${label} are IN FLIGHT (requested + attempted) — their objects have not landed; deferring the purge and preserving the child anchor, re-run once the stale window drains`
    );
    summary.imageLab.deferredInFlight++;
    summary.stranded.push(`${IMAGE_LAB_RUNS_TABLE}:in_flight:${childId}`);
    summary.order.push(`${IMAGE_LAB_RUNS_TABLE}:deferred(${label})`);
    return;
  }

  // 5: the objects, before any row.
  const seenKeys = new Set<string>();
  for (const row of imageRows) {
    const key = typeof row.storage_key === "string" ? row.storage_key.trim() : "";
    if (key.length === 0 || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const runId = String(row.run_id);
    if (!imageLabKeyBelongsToRun(key, runId)) {
      console.error(
        `[erase] STRANDED: refusing to delete Image Lab key ${key} — it is not in run ${runId}'s namespace (${label})`
      );
      summary.imageLab.objectsRefused++;
      summary.stranded.push(`image_lab:not_owned:${label}:${key}`);
      continue;
    }
    let outcome: "deleted" | "missing" | "error";
    try {
      outcome = await deps.deleteImageLabObject(key);
    } catch (err) {
      console.error(
        `[erase] Image Lab object delete threw for ${key} (${label}): ${err instanceof Error ? err.message : String(err)}`
      );
      outcome = "error";
    }
    if (outcome === "deleted") {
      summary.imageLab.objectsDeleted++;
      summary.order.push(`image_lab:object-deleted(${label})`);
    } else if (outcome === "missing") {
      summary.imageLab.objectsMissing++;
      summary.order.push(`image_lab:object-missing(${label})`);
    } else {
      console.error(
        `[erase] STRANDED: Image Lab object delete failed for ${key} (${label}) — the bytes may still exist; re-run after the store recovers`
      );
      summary.imageLab.objectsErrored++;
      summary.stranded.push(`image_lab:error:${label}:${key}`);
    }
  }

  // 6: verify before deleting rows (migration purge step 3). The row is the ONLY
  //    record of its key, so a partial object delete followed by a row delete
  //    leaves the survivors permanently unattributable.
  if (summary.stranded.length > strandedBefore) {
    console.error(
      `[erase] ${IMAGE_LAB_RUNS_TABLE} rows for ${label} PRESERVED — an object delete did not succeed; re-run to finish`
    );
    summary.order.push(`${IMAGE_LAB_RUNS_TABLE}:preserved(${label})`);
    return;
  }

  // 7: the rows. fp_image_lab_images CASCADEs with its run.
  summary.deleted.fp_image_lab_runs += await del(
    db,
    IMAGE_LAB_RUNS_TABLE,
    "id",
    allRunIds,
    summary,
    label
  );
}

type ChildRow = {
  childId: string;
  profileIds: string[];
  authUserIds: string[];
  workspaceEmail: string | null;
  /** The provisioning claim's stable row id (path b only), used to SCRUB its PII
   *  after the child delete releases it. `null` for a path-a child (no claim). */
  claimId: string | null;
};

/** Enumerate one child's owned rows across the FP + path graph. */
async function enumerateChild(db: Db, childId: string): Promise<ChildRow> {
  const [pp, psp, prov] = await Promise.all([
    db.from("fp_player_profiles").select("id, user_id").eq("child_id", childId),
    db.from("path_student_profiles").select("id, user_id").eq("child_id", childId),
    db
      .from("funnel_student_provisioning")
      .select("id, email, supabase_user_id, state")
      .eq("child_id", childId)
      .maybeSingle(),
  ]);
  const ppRows = (pp.data ?? []) as { id: string; user_id: string | null }[];
  const pspRows = (psp.data ?? []) as { id: string; user_id: string | null }[];
  const provRow =
    (prov.data as { id?: string | null; email?: string | null; supabase_user_id?: string | null } | null) ??
    null;
  return {
    childId,
    profileIds: ppRows.map((r) => r.id),
    // RESUMABILITY (FIX 1b): fold the claim's `supabase_user_id` into the auth-id
    // set. It is the path-b account's DURABLE handle — it survives the profile
    // deletes (steps 3-4), so a re-run after a mid-erase failure can still tear
    // the account down instead of orphaning it once the profile user_id rows are
    // gone. dedupe collapses it against the profile user_ids when both are present.
    authUserIds: dedupeAuthUserIds([
      ...ppRows.map((r) => r.user_id),
      ...pspRows.map((r) => r.user_id),
      provRow?.supabase_user_id ?? null,
    ]),
    workspaceEmail: provRow?.email ?? null,
    claimId: (provRow?.id as string | null) ?? null,
  };
}

/**
 * Erase a family (or a scoped subset of its children) in FK-safe order. Returns
 * a detailed summary; never throws. Re-runnable to completion after a partial
 * failure.
 *
 * CONCURRENCY: there is no cross-run lock. Two concurrent erasures of the same
 * family are ACCEPTABLE — every effect is an idempotent delete/scrub (a no-op on
 * already-gone rows), and RESTRICT keeps the order consistent — so a race yields
 * duplicated harmless work, never corruption. A lock is deliberately not added.
 */
export async function eraseFamily(
  deps: EraseFamilyDeps,
  input: EraseFamilyInput
): Promise<EraseFamilySummary> {
  const { db } = deps;
  const childScoped = input.childIds !== undefined;
  const summary: EraseFamilySummary = {
    ok: true,
    scope: childScoped ? "child" : "family",
    childrenErased: 0,
    deleted: {
      fp_public_sites: 0,
      fp_ledger: 0,
      fp_player_saves: 0,
      fp_player_profiles: 0,
      path_student_profiles: 0,
      fp_handoff_codes: 0,
      fp_onboarding_drafts: 0,
      fp_image_lab_runs: 0,
      children: 0,
      authUsers: 0,
      fp_parental_consent: 0,
      fp_signup_attempts: 0,
    },
    workspace: { suspended: 0, deleted: 0, missing: 0, skipped: 0, errored: 0 },
    blobs: { deleted: 0, missing: 0, errored: 0, refused: 0, unconfigured: 0 },
    imageLab: {
      objectsDeleted: 0,
      objectsMissing: 0,
      objectsErrored: 0,
      objectsRefused: 0,
      deferredInFlight: 0,
    },
    scrubbedReleasedClaims: 0,
    parentAccountDeleted: false,
    order: [],
    stranded: [],
  };

  try {
    // ── Resolve the children in scope. Always re-read (resumability): a re-run
    //    sees only the survivors. Child-scoped runs verify ownership via the
    //    parent_id filter so a caller can never erase another family's child.
    //    The cover blob key rides along on this read: it names an EXTERNAL
    //    object the `children` delete cannot reach (v3 blob rule).
    //    (static projection — must list every CHILD_BLOB_KEY_COLUMNS entry;
    //    `readKeys` strands loudly if it stops doing so.)
    let childQuery = db
      .from("children")
      .select("id, fp_cover_blob_key")
      .eq("parent_id", input.parentUserId);
    if (childScoped) childQuery = childQuery.in("id", input.childIds as string[]);
    const childrenRes = await childQuery;
    if (childrenRes.error) {
      console.error(`[erase] children enumeration failed: ${childrenRes.error.message}`);
      summary.ok = false;
      summary.stranded.push(`children:enumerate:${childrenRes.error.message}`);
      return summary;
    }
    const childRows = (childrenRes.data ?? []) as unknown as Record<string, unknown>[];
    const childIds = childRows.map((r) => String(r.id));
    const childBlobKeys = new Map<string, (string | null)[]>(
      childRows.map((r) => [
        String(r.id),
        readKeys(r, CHILD_BLOB_KEY_COLUMNS),
      ])
    );

    // ── Per child, delete the leaf graph in FK-safe order, then the mailbox,
    //    then the child's own auth accounts, then the roster row.
    for (const childId of childIds) {
      const child = await enumerateChild(db, childId);
      // RESUMABILITY GUARD (FIX 1): any stranded marker this child accrues (a
      // failed auth delete, a workspace error, or a RESTRICT-blocked leaf delete)
      // must BLOCK the `children` anchor delete below, so a re-run re-enumerates
      // the survivor and summary.ok stays false. Snapshot the count to detect it.
      const strandedBefore = summary.stranded.length;

      // 0: fp_public_sites (RESTRICT -> fp_player_profiles) — the child's public
      //    page dies FIRST (the amended "sites → ledger → saves → profile →
      //    child" ordering, migration 20260907120000). Handle disposition is
      //    decided HERE, explicitly: deleting the row frees the handle and 404s
      //    the page. An OPERATOR-LOCKED row is still deleted — a data-rights
      //    erasure outranks a takedown lock — but NEVER SILENTLY: the release
      //    is logged loudly and recorded in the order log so the operator sees
      //    that a locked handle re-entered the pool via erasure.
      for (const profileId of child.profileIds) {
        const lockedSite = await db
          .from("fp_public_sites")
          .select("handle, operator_locked")
          .eq("profile_id", profileId)
          .maybeSingle();
        if (lockedSite.error) {
          // The lock read is OBSERVABILITY, not a gate: a failed read must not
          // block the erasure, but it must not silently skip the loud-release
          // rule either — log the ambiguity (possibly locked) and proceed; the
          // delete below strands loudly on its own if the DB is really down.
          console.error(
            `[erase] fp_public_sites lock read failed for profile ${profileId} (${lockedSite.error.message}) — proceeding; if this site was operator-locked, its handle release is NOT individually logged`
          );
          summary.order.push(`fp_public_sites:site-lock-read-failed(child:${childId})`);
        } else if ((lockedSite.data as { operator_locked?: unknown } | null)?.operator_locked === true) {
          console.error(
            `[erase] releasing an OPERATOR-LOCKED public-site handle via erasure (profile ${profileId}) — deliberate, not silent`
          );
          summary.order.push(`fp_public_sites:site-locked-released(child:${childId})`);
        }
        summary.deleted.fp_public_sites += await del(db, "fp_public_sites", "profile_id", profileId, summary, `child:${childId}`);
      }

      // 1-2: ledger + saves (both RESTRICT -> fp_player_profiles) — must precede
      //      the profile delete. Keyed on the profile ids.
      for (const profileId of child.profileIds) {
        summary.deleted.fp_ledger += await del(db, "fp_ledger", "profile_id", profileId, summary, `child:${childId}`);
        summary.deleted.fp_player_saves += await del(db, "fp_player_saves", "profile_id", profileId, summary, `child:${childId}`);
      }
      // 3: fp_player_profiles (RESTRICT -> children AND auth.users)
      summary.deleted.fp_player_profiles += await del(db, "fp_player_profiles", "child_id", childId, summary, `child:${childId}`);
      // 4: path_student_profiles (RESTRICT -> children AND auth.users)
      summary.deleted.path_student_profiles += await del(db, "path_student_profiles", "child_id", childId, summary, `child:${childId}`);

      // 4a (v3): fp_handoff_codes — the one-time sign-in codes bound to this
      //     child. CASCADE-backed by the children delete, but removed HERE and
      //     EXPLICITLY: a live sign-in credential must stop working before the
      //     identity it grants is torn down, and an implicit cascade would be
      //     invisible in the summary and the order log.
      summary.deleted.fp_handoff_codes += await del(db, "fp_handoff_codes", "child_id", childId, summary, `child:${childId}`);

      // 4b (v3): fp_onboarding_drafts for this child — kid name, age, story
      //     answers, the inline cover data URL, and the two blob keys. MUST
      //     precede the `children` delete: child_id is ON DELETE SET NULL, so a
      //     roster delete first would leave this row alive and unfindable by
      //     child. Blobs are deleted before the row (see the blob rule).
      await eraseDrafts(deps, summary, "child_id", childId, `child:${childId}`);

      // 4c (Image Lab): the runs this child's product text was fed into, their
      //     copy-forward descendants, and the generated images in the private
      //     `fp-image-lab` bucket. SAME hazard as the drafts above —
      //     `source_child_id -> children ON DELETE SET NULL` means the roster
      //     delete would keep the row and erase its provenance — so it MUST
      //     precede the `children` delete. Objects before rows; see purgeImageLab.
      await purgeImageLab(deps, summary, childId);

      // 5: Workspace mailbox (path b) — SUSPEND then DELETE, read the address
      //    BEFORE the child delete cascades the provisioning claim away.
      if (hasWorkspaceMailbox(child.workspaceEmail)) {
        if (!deps.workspaceConfigured) {
          summary.workspace.skipped++;
          summary.order.push(`workspace:skipped(${childId})`);
        } else {
          const email = child.workspaceEmail;
          const sus = await deps.suspendWorkspaceUser(email);
          if (sus === "suspended") summary.workspace.suspended++;
          else if (sus === "missing") summary.workspace.missing++;
          else {
            summary.workspace.errored++;
            summary.stranded.push(`workspace:suspend:${childId}`);
          }
          summary.order.push(`workspace:suspend:${sus}(${childId})`);
          // Delete regardless of a benign suspend "missing" (already gone); only
          // a hard suspend error blocks the delete (leave it for a re-run).
          if (sus !== "error") {
            const deld = await deps.deleteWorkspaceUser(email);
            if (deld === "deleted") summary.workspace.deleted++;
            else if (deld === "missing") summary.workspace.missing++;
            else {
              summary.workspace.errored++;
              summary.stranded.push(`workspace:delete:${childId}`);
            }
            summary.order.push(`workspace:delete:${deld}(${childId})`);
          }
        }
      }

      // 6: the child's own auth.users login accounts (now unreferenced).
      for (const authUserId of child.authUserIds) {
        const res = await deps.deleteAuthUser(authUserId);
        if (res.ok) {
          summary.deleted.authUsers++;
          summary.order.push(`auth_users:child:${childId}(${authUserId})`);
        } else {
          summary.stranded.push(`auth_users:${authUserId}`);
        }
      }

      // 6b (v3): the child's OWN cover object. `children.fp_cover_blob_key` is a
      //     pointer into the blob store; the roster delete below removes the
      //     pointer but NOT the bytes, and a Blob URL stays readable forever
      //     until the object is deleted. Object BEFORE row, and BEFORE the
      //     strand guard below, so a store failure preserves the anchor for the
      //     re-run instead of orphaning the picture.
      await eraseBlobs(
        deps,
        summary,
        planSubjectBlobDeletes({
          scope: "child",
          ownerId: childId,
          keys: childBlobKeys.get(childId) ?? [],
        }),
        `child:${childId}`
      );

      // FIX 1c: a child still present with ZERO resolvable auth identities is a
      // partial-erasure resume (profiles already deleted, no claim to recover the
      // account from) or a corrupt row — NEVER anchor-delete it, or its orphaned
      // auth account would survive forever under a falsely ok:true summary. A
      // normally-erasable child always has at least one identity, so this only
      // fires on the anomaly. Fail-closed: strand it for triage.
      if (child.authUserIds.length === 0) {
        console.error(
          `[erase] STRANDED: child ${childId} has no resolvable auth identity while its anchor persists — preserving the anchor for re-enumeration`
        );
        summary.stranded.push(`children:no_identity:${childId}`);
      }

      // FIX 1a / FIX 4: if this child accrued ANY stranded marker (auth-delete not
      // ok, workspace error, RESTRICT-blocked leaf delete, or the no-identity guard
      // above), do NOT delete its `children` anchor. Leave it so a re-run
      // re-enumerates the survivor; summary.ok is already false.
      if (summary.stranded.length > strandedBefore) {
        summary.order.push(`children:stranded(${childId})`);
        continue;
      }

      // 7: the roster row. deposits CASCADE away; the provisioning claim does NOT —
      //    its child_id FK is ON DELETE SET NULL + a trigger flips it to released/
      //    child_deleted (the row + local_part SURVIVE, never-reissue ledger). The
      //    child-scoped consent evidence is removed here, while child_id still
      //    links, BEFORE the row is gone (the SET-NULL FK would otherwise unbind).
      if (childScoped) {
        summary.deleted.fp_parental_consent += await del(db, "fp_parental_consent", "child_id", childId, summary, `child:${childId}`);
      }
      summary.deleted.children += await del(db, "children", "id", childId, summary, `child:${childId}`);
      summary.childrenErased++;

      // 7b (FIX 2): the child delete released the provisioning claim (child_id →
      //    null, state → released) but PRESERVED the row for never-reissue. A true
      //    erasure scrubs the residual PII off that surviving row — null email,
      //    workspace_attempted_email, supabase_user_id — while KEEPING local_part.
      //    Targeted by the claim's stable id (child_id is now null, so it can no
      //    longer be found by child).
      if (child.claimId) {
        const scrub: Record<string, null> = {};
        for (const col of RELEASED_CLAIM_PII_COLUMNS) scrub[col] = null;
        const { error } = await db
          .from("funnel_student_provisioning")
          .update(scrub)
          .eq("id", child.claimId);
        if (error) {
          console.error(
            `[erase] STRANDED: released-claim PII scrub failed for claim ${child.claimId}: ${error.message}`
          );
          summary.stranded.push(`funnel_student_provisioning:scrub:${child.claimId}:${error.message}`);
        } else {
          summary.scrubbedReleasedClaims++;
          summary.order.push(`funnel_student_provisioning:scrubbed(${childId})`);
        }
      }
    }

    // ── Family-level erasure only (childIds omitted): the deliberate final
    //    evidence step + the parent account. Anchored on parent_id (still set —
    //    the parent account is deleted only after) and parent_email (a stable
    //    handle if a prior partial run already nulled parent_id).
    if (!childScoped) {
      // 7c (v3): the PARENT-SCOPED draft sweep. An abandoned signup leaves a
      //     draft with `child_id` still NULL — the kid's name, age, story
      //     answers and cover, reachable ONLY by parent_id. Step 9's parent auth
      //     delete CASCADEs those rows away silently (parent_id -> auth.users ON
      //     DELETE CASCADE), taking the row but NOT the objects it names, so the
      //     sweep must happen HERE, blobs first, while a handle still exists.
      //     Child-scoped runs deliberately skip it: the parent survives and
      //     their other kids' drafts are not this run's business.
      await eraseDrafts(deps, summary, "parent_id", input.parentUserId, "family");

      // 8: consent evidence — the EXPLICIT, deliberate final removal (see
      //    erase-family-rules.ts). fp_parental_consent by parent_id.
      summary.deleted.fp_parental_consent += await del(db, "fp_parental_consent", "parent_id", input.parentUserId, summary, "family");

      // FIX 3 (security): fp_signup_attempts is deleted by parent_id — the
      // principal-scoped key. The parent_email scope is a FALLBACK used ONLY when
      // the parent_id delete matched nothing (a prior partial run already
      // SET-NULLed parent_id), NEVER as an unconditional second sweep: an unscoped
      // parent_email delete would destroy a DIFFERENT principal's attempt/consent
      // evidence that merely reused this email.
      const attemptsByParent = await del(db, "fp_signup_attempts", "parent_id", input.parentUserId, summary, "family:parent_id");
      summary.deleted.fp_signup_attempts += attemptsByParent;
      if (attemptsByParent === 0) {
        const attemptsByEmail = await del(db, "fp_signup_attempts", "parent_email", input.parentEmail, summary, "family:parent_email_fallback");
        summary.deleted.fp_signup_attempts += attemptsByEmail;
      }

      // 9: the parent auth account (CASCADE-removes parents -> children -> ...).
      //    RESUMABILITY GUARD (FIX 1): if ANY child was stranded above, its
      //    `children` anchor was deliberately preserved — but deleting the parent
      //    account here would CASCADE that anchor away (orphaning the account we
      //    could not delete). So skip the parent delete entirely while anything is
      //    stranded; the re-run finishes the children first, then removes the parent.
      if (summary.stranded.length > 0) {
        console.error(
          `[erase] parent account ${input.parentUserId} NOT deleted — ${summary.stranded.length} stranded item(s) still hold preserved anchors; re-run after triage`
        );
        summary.order.push(`auth_users:parent:deferred(${input.parentUserId})`);
      } else {
        const res = await deps.deleteAuthUser(input.parentUserId);
        if (res.ok) {
          summary.parentAccountDeleted = true;
          summary.order.push(`auth_users:parent(${input.parentUserId})`);
        } else {
          summary.stranded.push(`auth_users:parent:${input.parentUserId}`);
        }
      }
    }

    summary.ok = summary.stranded.length === 0;
    return summary;
  } catch (err) {
    console.error(`[erase] unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    summary.ok = false;
    summary.stranded.push(`exception:${err instanceof Error ? err.message : String(err)}`);
    return summary;
  }
}
