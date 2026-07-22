import "server-only";

/**
 * The server-only I/O layer for the Unit 10 evidence model: resolving the
 * task_progress row, reconciling an upload against the REAL storage object,
 * the idempotent insert, minting the ONE cached signed-download URL, the
 * append-only-latch lookup (also consumed by the Unit 9 slot action), and the
 * two Storage-API executors — redaction and the orphan reaper. Kept OUT of the
 * `"use server"` files so these are not themselves client-callable Server Actions
 * (the shared-core-must-not-live-in-a-use-server-file boundary); every decision
 * they take lives in `evidence-rules.ts` (tested).
 *
 * FAIL LOUD, NEVER SILENT: every query/API call checks its error and THROWS a
 * labeled error the action catches and maps to a typed `unavailable`. A swallowed
 * blip must never masquerade as "object missing" (which would wrongly refuse a
 * good confirm) or as a successful mint (which would hand back a broken URL).
 *
 * DELETION goes through the Storage API, NEVER SQL — deleting a storage.objects
 * row orphans the underlying file permanently. Both executors obey this.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { EVIDENCE_BUCKET } from "./upload-rules";
import {
  computeLatched,
  isEvidenceKind,
  planRedaction,
  selectOrphans,
  shouldRemintSignedUrl,
  SIGNED_URL_TTL_SECONDS,
  type EvidenceKind,
  type LatchEvent,
} from "./evidence-rules";

type Db = ReturnType<typeof supabaseAdmin>;

/** Split an object path into its parent folder and file name. */
function splitObjectPath(objectPath: string): { folder: string; name: string } {
  const slash = objectPath.lastIndexOf("/");
  return slash < 0
    ? { folder: "", name: objectPath }
    : { folder: objectPath.slice(0, slash), name: objectPath.slice(slash + 1) };
}

/** Resolve the task_progress row (id + current state) for a (student, task) pair —
 *  the FK the evidence row anchors to, plus the state that decides R6's
 *  `added_after_verification` flag. Returns null when the task is not provisioned
 *  for the student (a legitimate "not found"); a query error THROWS. */
export async function resolveTaskProgress(
  db: Db,
  studentId: string,
  taskId: string
): Promise<{ id: string; state: string } | null> {
  const { data, error } = await db
    .from("path_task_progress")
    .select("id, state")
    .eq("student_id", studentId)
    .eq("task_id", taskId)
    .maybeSingle();
  if (error) {
    throw new Error(`resolveTaskProgress(${studentId}, ${taskId}) failed: ${error.message}`);
  }
  return data ? { id: data.id as string, state: data.state as string } : null;
}

/** The real, server-observed metadata of a stored object (what confirm trusts
 *  over the client-declared values on an already-exists outcome). */
export type ObjectMeta = { exists: boolean; sizeBytes: number | null; etag: string | null };

/**
 * Read an object's REAL size/etag straight from Storage (never trust the
 * client-reported values). Uses a scoped `list` of the object's own folder — the
 * path is {student}/{evidence}/{sha}.{ext}, so the folder holds exactly this file.
 * A list error THROWS; a missing object returns `exists: false` (the confirm then
 * refuses, since the upload never actually landed).
 */
export async function readObjectMeta(db: Db, objectPath: string): Promise<ObjectMeta> {
  const { folder, name } = splitObjectPath(objectPath);
  const { data, error } = await db.storage.from(EVIDENCE_BUCKET).list(folder, { limit: 100, search: name });
  if (error) {
    throw new Error(`readObjectMeta(${objectPath}) failed: ${error.message}`);
  }
  const file = (data ?? []).find((f) => f.name === name);
  if (!file) return { exists: false, sizeBytes: null, etag: null };
  const meta = (file.metadata ?? {}) as { size?: unknown; eTag?: unknown };
  const size = typeof meta.size === "number" ? meta.size : null;
  const etag = typeof meta.eTag === "string" ? meta.eTag : null;
  return { exists: true, sizeBytes: size, etag };
}

/** The append-only latch events for a task (its event history's to_states), used
 *  both by the mutation checks and by the Unit 9 slot's `appendOnlyLatched`. */
export async function loadTaskLatchEvents(
  db: Db,
  studentId: string,
  taskId: string
): Promise<LatchEvent[]> {
  const { data, error } = await db
    .from("path_task_events")
    .select("to_state")
    .eq("student_id", studentId)
    .eq("task_id", taskId);
  if (error) {
    throw new Error(`loadTaskLatchEvents(${studentId}, ${taskId}) failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({ toState: String(r.to_state) }));
}

/**
 * Whether re-minting a slot for this evidence id must be refused because its
 * object is already append-only-latched (a verified task's evidence is physically
 * unoverwritable). A brand-new evidence id has no row → not latched → false; only
 * a re-mint targeting an existing latched row returns true. This is the real value
 * the Unit 9 slot passed as a hardcoded `false`.
 */
export async function isEvidencePathLatched(
  db: Db,
  studentId: string,
  evidenceId: string
): Promise<boolean> {
  // Two explicit single-table lookups rather than a composite-FK PostgREST embed
  // (embed resolution across a composite FK is less reliably detected).
  const { data: ev, error } = await db
    .from("path_evidence_items")
    .select("task_progress_id")
    .eq("id", evidenceId)
    .maybeSingle();
  if (error) throw new Error(`isEvidencePathLatched(${evidenceId}) evidence read failed: ${error.message}`);
  if (!ev) return false; // no existing evidence row → nothing to overwrite

  const { data: tp, error: tpError } = await db
    .from("path_task_progress")
    .select("task_id")
    .eq("id", ev.task_progress_id as string)
    .maybeSingle();
  if (tpError) throw new Error(`isEvidencePathLatched(${evidenceId}) task read failed: ${tpError.message}`);
  if (!tp) return false;

  const events = await loadTaskLatchEvents(db, studentId, tp.task_id as string);
  return computeLatched(events);
}

/** The existing evidence rows on a task, for the confirm's dedupe decision. */
export type ExistingEvidenceRow = { clientId: string; sha256: string | null; redactedAt: string | null };

export async function loadExistingEvidence(
  db: Db,
  taskProgressId: string
): Promise<ExistingEvidenceRow[]> {
  const { data, error } = await db
    .from("path_evidence_items")
    .select("id, sha256, redacted_at")
    .eq("task_progress_id", taskProgressId);
  if (error) {
    throw new Error(`loadExistingEvidence(${taskProgressId}) failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    clientId: r.id as string,
    sha256: (r.sha256 as string | null) ?? null,
    redactedAt: (r.redacted_at as string | null) ?? null,
  }));
}

/** The columns the confirm persists. Server-owned values only (ids from the
 *  authoritative profile, size RECONCILED against storage). */
export type EvidenceInsert = {
  id: string;
  taskProgressId: string;
  studentId: string;
  kind: EvidenceKind;
  bucket: string | null;
  objectPath: string | null;
  posterObjectPath: string | null;
  contentType: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  sizeMismatch: boolean;
  durationSeconds: number | null;
  logData: unknown | null;
  linkUrl: string | null;
  caption: string | null;
  capturedAt: string | null;
  exif: unknown | null;
  signedUrl: string | null;
  signedUrlExpiresAt: string | null;
  posterSignedUrl: string | null;
  posterSignedUrlExpiresAt: string | null;
  /** R6: evidence landing on an already-verified task, flagged not invisible. */
  addedAfterVerification: boolean;
};

/**
 * Insert the evidence row idempotently — ON CONFLICT (id) DO NOTHING, then RE-READ
 * by id and verify it actually landed under THIS task/student. `ignoreDuplicates`
 * silently SKIPS a colliding id, so a reused evidenceId that already belongs to a
 * different row must surface as a loud `id_conflict`, never a false success that
 * leaves the just-uploaded object an unattributed orphan. The client-generated id
 * is the offline-safety key: a committed-then-retried upload can never fork the
 * keepsake into two rows, and a genuine same-task retry re-reads its own row and
 * reports ok.
 */
export async function insertEvidenceItem(
  db: Db,
  row: EvidenceInsert
): Promise<{ ok: true } | { ok: false; reason: "id_conflict" }> {
  const { error } = await db
    .from("path_evidence_items")
    .upsert(
      {
        id: row.id,
        task_progress_id: row.taskProgressId,
        student_id: row.studentId,
        kind: row.kind,
        bucket: row.bucket,
        object_path: row.objectPath,
        poster_object_path: row.posterObjectPath,
        content_type: row.contentType,
        sha256: row.sha256,
        size_bytes: row.sizeBytes,
        size_mismatch: row.sizeMismatch,
        duration_seconds: row.durationSeconds,
        log_data: row.logData,
        link_url: row.linkUrl,
        caption: row.caption,
        captured_at: row.capturedAt,
        exif: row.exif,
        signed_url: row.signedUrl,
        signed_url_expires_at: row.signedUrlExpiresAt,
        poster_signed_url: row.posterSignedUrl,
        poster_signed_url_expires_at: row.posterSignedUrlExpiresAt,
        added_after_verification: row.addedAfterVerification,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
  if (error) {
    throw new Error(`insertEvidenceItem(${row.id}) failed: ${error.message}`);
  }

  // Verify the row that now holds this id is OURS (DO NOTHING silently skips a
  // colliding id belonging to another task/student).
  const { data, error: readError } = await db
    .from("path_evidence_items")
    .select("task_progress_id, student_id")
    .eq("id", row.id)
    .maybeSingle();
  if (readError) throw new Error(`insertEvidenceItem(${row.id}) verify read failed: ${readError.message}`);
  if (!data) throw new Error(`insertEvidenceItem(${row.id}): row missing immediately after upsert`);
  if (data.task_progress_id !== row.taskProgressId || data.student_id !== row.studentId) {
    return { ok: false, reason: "id_conflict" };
  }
  return { ok: true };
}

/** Upsert a log-table evidence row (kind='log'). ON CONFLICT (id) updates the rows
 *  — a log is edited in place until the task latches (the action gates that).
 *
 *  `caption` is written ONLY when the caller supplied one (`undefined` = leave
 *  it alone). LogTable's save never sends a caption, and a full-row overwrite
 *  here would deterministically wipe whatever `editEvidenceCaption` set — the
 *  Unit 14 adversarial review's guaranteed lost-update. */
export async function upsertLogEvidence(
  db: Db,
  p: { id: string; taskProgressId: string; studentId: string; rows: unknown[]; caption?: string | null }
): Promise<void> {
  const payload: Record<string, unknown> = {
    id: p.id,
    task_progress_id: p.taskProgressId,
    student_id: p.studentId,
    kind: "log",
    log_data: p.rows,
    updated_at: new Date().toISOString(),
  };
  if (p.caption !== undefined) payload.caption = p.caption;
  const { error } = await db.from("path_evidence_items").upsert(payload, { onConflict: "id" });
  if (error) throw new Error(`upsertLogEvidence(${p.id}) failed: ${error.message}`);
}

/** An evidence row's owner + the data a mutation (delete/redact) needs: whose it
 *  is, its storage objects, and its task's latch events. Null when no such row. */
export type EvidenceOwner = { studentId: string; taskId: string; objectPaths: string[]; events: LatchEvent[] };

export async function resolveEvidenceOwner(db: Db, evidenceId: string): Promise<EvidenceOwner | null> {
  const { data, error } = await db
    .from("path_evidence_items")
    .select("student_id, task_progress_id, object_path, poster_object_path")
    .eq("id", evidenceId)
    .maybeSingle();
  if (error) throw new Error(`resolveEvidenceOwner(${evidenceId}) failed: ${error.message}`);
  if (!data) return null;

  const { data: tp, error: tpError } = await db
    .from("path_task_progress")
    .select("task_id")
    .eq("id", data.task_progress_id as string)
    .maybeSingle();
  if (tpError) throw new Error(`resolveEvidenceOwner(${evidenceId}) task read failed: ${tpError.message}`);
  // Every evidence row FKs to a task_progress; a missing row is a data anomaly.
  if (!tp) throw new Error(`resolveEvidenceOwner(${evidenceId}): evidence row has no task_progress`);

  const studentId = data.student_id as string;
  const taskId = tp.task_id as string;
  const objectPaths = [data.object_path as string | null, data.poster_object_path as string | null].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  const events = await loadTaskLatchEvents(db, studentId, taskId);
  return { studentId, taskId, objectPaths, events };
}

/** Hard-delete an UNVERIFIED evidence row (the pre-verification carve-out). Deletes
 *  the ROW first, THEN its storage objects via the Storage API (never SQL): if the
 *  object delete then fails, the object is a row-less orphan the 48h reaper reclaims
 *  — self-healing. The reverse order would leave a live row pointing at deleted
 *  media, which nothing reconciles. A verified item is redacted (tombstoned), never
 *  deleted — the action enforces that. */
export async function deleteEvidenceRow(db: Db, evidenceId: string, objectPaths: string[]): Promise<void> {
  const { error } = await db.from("path_evidence_items").delete().eq("id", evidenceId);
  if (error) throw new Error(`deleteEvidenceRow(${evidenceId}) row delete failed: ${error.message}`);
  if (objectPaths.length > 0) {
    const { error: rmError } = await db.storage.from(EVIDENCE_BUCKET).remove(objectPaths);
    if (rmError) throw new Error(`deleteEvidenceRow(${evidenceId}) storage remove failed: ${rmError.message}`);
  }
}

/** A minted signed-download URL and the epoch-ms it expires — stored on the row and
 *  reused until near expiry (Unit 9: never minted per render; 3x CDN cost). */
export type MintedDownloadUrl = { signedUrl: string; expiresAtMs: number };

export async function mintSignedDownloadUrl(db: Db, objectPath: string): Promise<MintedDownloadUrl> {
  const { data, error } = await db.storage.from(EVIDENCE_BUCKET).createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`mintSignedDownloadUrl(${objectPath}) failed: ${error?.message ?? "no url returned"}`);
  }
  // createSignedUrl has no explicit expiry field; it is now + the TTL we passed.
  return { signedUrl: data.signedUrl, expiresAtMs: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 };
}

/** Update a non-redacted item's caption. Returns false when no row matched —
 *  the item is missing OR redacted (a tombstone's caption is frozen); the
 *  action maps that to a typed refusal. */
export async function updateEvidenceCaption(
  db: Db,
  evidenceId: string,
  caption: string | null
): Promise<boolean> {
  const { data, error } = await db
    .from("path_evidence_items")
    .update({ caption, updated_at: new Date().toISOString() })
    .eq("id", evidenceId)
    .is("redacted_at", null)
    .select("id");
  if (error) throw new Error(`updateEvidenceCaption(${evidenceId}) failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/* ------------------------------------------------------------- read views */

/** One evidence item as the task surface renders it (EvidenceList's shape,
 *  minus the client-only fields the caller adds). */
export type EvidenceReadRow = {
  id: string;
  kind: EvidenceKind;
  url: string | null;
  posterUrl: string | null;
  contentType: string | null;
  caption: string | null;
  linkUrl: string | null;
  logRows: Record<string, unknown>[];
  redactedAt: string | null;
  addedAfterVerification: boolean;
  createdAt: string;
};

/**
 * Load a task's evidence items for READ, in capture order, with fresh-enough
 * signed URLs. The Unit 10/14 rule made real here: the STORED URL is reused
 * until near expiry (`shouldRemintSignedUrl`); a remint happens at most once
 * per item per TTL window and is PERSISTED back onto the row — never minted per
 * render (each unique token is a fresh CDN cache key at 3x the egress rate).
 * The poster frame gets the identical treatment via its own columns.
 *
 * A redacted row comes back as a tombstone (nulled URLs; the columns are
 * already nulled, but the mapping guards it anyway). A row whose kind fails the
 * fail-closed narrowing is dropped LOUDLY (logged), never coerced.
 */
export async function loadEvidenceViews(db: Db, taskProgressId: string): Promise<EvidenceReadRow[]> {
  const { data, error } = await db
    .from("path_evidence_items")
    .select(
      "id, kind, object_path, poster_object_path, content_type, caption, link_url, log_data, signed_url, signed_url_expires_at, poster_signed_url, poster_signed_url_expires_at, redacted_at, added_after_verification, created_at"
    )
    .eq("task_progress_id", taskProgressId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`loadEvidenceViews(${taskProgressId}) failed: ${error.message}`);

  const nowMs = Date.now();
  // Items resolve CONCURRENTLY — a same-session batch of uploads shares one
  // expiry window, so the remint case is the common one, and a serial loop
  // would pay 2N sequential Storage round trips on exactly that page load
  // (Unit 14 performance/reliability reviews). freshSignedUrl isolates its own
  // failures, so parallelizing changes latency, never failure semantics.
  const out = await Promise.all(
    (data ?? []).map(async (r): Promise<EvidenceReadRow | null> => {
      const kind = r.kind;
      if (!isEvidenceKind(kind)) {
        console.error(`[path/evidence] dropped row ${String(r.id)} with unrecognized kind ${String(kind)}`);
        return null;
      }
      const redactedAt = (r.redacted_at as string | null) ?? null;

      let url: string | null = null;
      let posterUrl: string | null = null;
      if (!redactedAt) {
        [url, posterUrl] = await Promise.all([
          freshSignedUrl(db, {
            evidenceId: r.id as string,
            objectPath: (r.object_path as string | null) ?? null,
            storedUrl: (r.signed_url as string | null) ?? null,
            storedExpiresAt: (r.signed_url_expires_at as string | null) ?? null,
            urlColumn: "signed_url",
            expiryColumn: "signed_url_expires_at",
            nowMs,
          }),
          freshSignedUrl(db, {
            evidenceId: r.id as string,
            objectPath: (r.poster_object_path as string | null) ?? null,
            storedUrl: (r.poster_signed_url as string | null) ?? null,
            storedExpiresAt: (r.poster_signed_url_expires_at as string | null) ?? null,
            urlColumn: "poster_signed_url",
            expiryColumn: "poster_signed_url_expires_at",
            nowMs,
          }),
        ]);
      }

      return {
        id: r.id as string,
        kind,
        url,
        posterUrl,
        contentType: (r.content_type as string | null) ?? null,
        caption: (r.caption as string | null) ?? null,
        linkUrl: (r.link_url as string | null) ?? null,
        logRows: Array.isArray(r.log_data) ? (r.log_data as Record<string, unknown>[]) : [],
        redactedAt,
        addedAfterVerification: r.added_after_verification === true,
        createdAt: r.created_at as string,
      };
    })
  );
  return out.filter((r): r is EvidenceReadRow => r !== null);
}

/** Reuse the stored signed URL, or remint near expiry and PERSIST the new one.
 *  A mint/persist failure degrades to the stale-but-maybe-working stored URL
 *  (or null) rather than failing the whole read — one broken thumbnail beats a
 *  blank task page. */
async function freshSignedUrl(
  db: Db,
  p: {
    evidenceId: string;
    objectPath: string | null;
    storedUrl: string | null;
    storedExpiresAt: string | null;
    urlColumn: "signed_url" | "poster_signed_url";
    expiryColumn: "signed_url_expires_at" | "poster_signed_url_expires_at";
    nowMs: number;
  }
): Promise<string | null> {
  if (!p.objectPath) return null;

  const expiresAtMs = p.storedExpiresAt ? Date.parse(p.storedExpiresAt) : NaN;
  const remint = shouldRemintSignedUrl({
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
    nowMs: p.nowMs,
  });
  if (!remint && p.storedUrl) return p.storedUrl;

  try {
    const minted = await mintSignedDownloadUrl(db, p.objectPath);
    const { error } = await db
      .from("path_evidence_items")
      .update({
        [p.urlColumn]: minted.signedUrl,
        [p.expiryColumn]: new Date(minted.expiresAtMs).toISOString(),
      })
      .eq("id", p.evidenceId);
    if (error) {
      console.error(`[path/evidence] persisting reminted ${p.urlColumn} for ${p.evidenceId} failed: ${error.message}`);
    }
    return minted.signedUrl;
  } catch (e) {
    console.error(`[path/evidence] remint failed for ${p.evidenceId} (${p.objectPath}):`, e);
    return p.storedUrl; // possibly stale; better than a guaranteed-blank item
  }
}

/**
 * Redact an evidence row: perform the full blast radius (`planRedaction`) — delete
 * the object AND its poster via the Storage API, null the cached signed URL, clear
 * the private EXIF — and stamp the tombstone. The DB row STAYS (append-only
 * tombstone). Fail-loud on the storage delete: a surviving object + a "redacted"
 * row is the worst outcome (the whole point is the media becomes unreadable).
 */
export async function redactEvidence(
  db: Db,
  input: { evidenceId: string; redactedBy: string; reason: string }
): Promise<void> {
  const { data, error } = await db
    .from("path_evidence_items")
    .select("object_path, poster_object_path, redacted_at")
    .eq("id", input.evidenceId)
    .maybeSingle();
  if (error) throw new Error(`redactEvidence(${input.evidenceId}) read failed: ${error.message}`);
  if (!data) throw new Error(`redactEvidence(${input.evidenceId}): no such evidence row`);

  const plan = planRedaction({
    objectPath: (data.object_path as string | null) ?? null,
    posterObjectPath: (data.poster_object_path as string | null) ?? null,
  });

  // TOMBSTONE FIRST (once): mark redacted + null the cached URL/EXIF BEFORE the
  // physical delete, so a failure between the two leaves an inert row (UI shows the
  // tombstone, no URL to serve) rather than a live-looking row whose media is gone.
  // Only set it when not already redacted, to preserve the ORIGINAL redactor/time on
  // a retry.
  if (data.redacted_at == null) {
    const now = new Date().toISOString();
    const { error: updError } = await db
      .from("path_evidence_items")
      .update({
        redacted_at: now,
        redacted_by: input.redactedBy,
        redaction_reason: input.reason,
        signed_url: null, // irrevocable URLs keep redacted media readable while cached
        signed_url_expires_at: null,
        poster_signed_url: null, // the poster's cached URL is the same leak (Unit 14)
        poster_signed_url_expires_at: null,
        exif: null, // can hold a child's home GPS coords
        updated_at: now,
      })
      .eq("id", input.evidenceId);
    if (updError) {
      throw new Error(`redactEvidence(${input.evidenceId}) tombstone update failed: ${updError.message}`);
    }
  }

  // ALWAYS (re)attempt the physical delete — NOT gated on redacted_at. A prior call
  // may have committed the tombstone and then failed the delete; gating on the
  // tombstone would leave the media permanently in the bucket (and un-reaped, since
  // a tombstoned path still counts as "confirmed"). storage.remove is idempotent for
  // already-gone paths, so a retry converges on media-actually-deleted.
  if (plan.deleteObjectPaths.length > 0) {
    const { error: rmError } = await db.storage.from(EVIDENCE_BUCKET).remove(plan.deleteObjectPaths);
    if (rmError) {
      throw new Error(`redactEvidence(${input.evidenceId}) storage remove failed: ${rmError.message}`);
    }
  }
}

/** Recursively list every stored object under the bucket ({student}/{evidence}/
 *  file), collecting path + created-at. Bounded by the bucket size (T1 scale). A
 *  list error THROWS. Pseudo-folder entries (id === null) are recursed, not
 *  collected. */
async function listAllObjects(db: Db): Promise<{ path: string; createdAtMs: number }[]> {
  const out: { path: string; createdAtMs: number }[] = [];
  async function walk(prefix: string): Promise<void> {
    const { data, error } = await db.storage.from(EVIDENCE_BUCKET).list(prefix, { limit: 1000 });
    if (error) throw new Error(`listAllObjects(${prefix || "/"}) failed: ${error.message}`);
    for (const entry of data ?? []) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        await walk(full); // a folder
      } else {
        const created = entry.created_at ? Date.parse(entry.created_at) : NaN;
        out.push({ path: full, createdAtMs: Number.isFinite(created) ? created : 0 });
      }
    }
  }
  await walk("");
  return out;
}

/** The set of object paths that DO have a confirmed evidence row (object + poster,
 *  including redacted tombstones whose object is already gone). */
async function loadConfirmedObjectPaths(db: Db): Promise<Set<string>> {
  const { data, error } = await db
    .from("path_evidence_items")
    .select("object_path, poster_object_path");
  if (error) throw new Error(`loadConfirmedObjectPaths failed: ${error.message}`);
  const set = new Set<string>();
  for (const r of data ?? []) {
    const op = r.object_path as string | null;
    const pp = r.poster_object_path as string | null;
    if (op) set.add(op);
    if (pp) set.add(pp);
  }
  return set;
}

/**
 * Reap orphaned objects — those with no confirmed evidence row, older than 48h
 * (`selectOrphans`). Deletes via the Storage API in one call (NEVER SQL). Returns
 * how many were reaped and how many were considered. Closes the quota's blind spot:
 * an abandoned upload has no size metadata and is invisible to the byte-sum.
 */
export async function reapOrphans(
  db: Db,
  nowMs: number,
  maxDeletePerRun: number
): Promise<{ scanned: number; orphans: number; deleted: number; capped: boolean }> {
  const [objects, confirmed] = await Promise.all([listAllObjects(db), loadConfirmedObjectPaths(db)]);
  const orphans = selectOrphans({ objects, confirmedPaths: confirmed, nowMs });
  const toDelete = orphans.slice(0, maxDeletePerRun);
  if (toDelete.length > 0) {
    const { error } = await db.storage.from(EVIDENCE_BUCKET).remove(toDelete);
    if (error) throw new Error(`reapOrphans remove failed: ${error.message}`);
  }
  return {
    scanned: objects.length,
    orphans: orphans.length,
    deleted: toDelete.length,
    capped: orphans.length > toDelete.length,
  };
}
