"use server";

/**
 * The Path evidence Server Actions (T1 Unit 10). The CONFIRM step Unit 9's
 * uploader hands its stored object up to (`onUploaded` → an EvidenceItem row),
 * plus the log-table, link-overflow, delete, and redaction actions. Same canon as
 * every other Path action: gate → zod → authorize/decide (pure) → fail-loud I/O →
 * typed result. Bodies never throw from their own logic — `requirePathUser` may
 * `redirect()` (a control-flow throw a client caller still wraps in
 * try/catch/finally), and loaders throw on I/O errors, which these CATCH and map
 * to a typed `unavailable`.
 *
 * No caller exists yet (the surfaces land in Unit 14; student sessions in Unit 6);
 * this establishes the contract they consume, verified via the migration DO-block.
 */

import { z } from "zod";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { loadStudentContext } from "@/app/path/lib/progress-loader";
import { canCaptureEvidence, resolveActorRole } from "@/app/path/lib/access-rules";
import { EVIDENCE_BUCKET } from "@/app/path/lib/upload-rules";
import { classifyUploadKind, computeLatched, decideConfirm, decideEvidenceMutation, reconcileMetadata } from "@/app/path/lib/evidence-rules";
import {
  deleteEvidenceRow,
  insertEvidenceItem,
  loadExistingEvidence,
  loadTaskLatchEvents,
  mintSignedDownloadUrl,
  readObjectMeta,
  redactEvidence,
  resolveEvidenceOwner,
  resolveTaskProgressId,
  upsertLogEvidence,
} from "@/app/path/lib/evidence-loader";

// ── shared input pieces ────────────────────────────────────────────────────────
const studentId = z.uuid();
const taskId = z.string().regex(/^\d+\.\d+\.\d+$/);
const evidenceId = z.uuid();

/** A best-effort ISO capture time; dropped (not fatal) if unparseable. */
function safeIso(s: string | undefined): string | null {
  if (!s) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/** An object path must live under the resolved student's own folder — the last
 *  line of defense against a forged path pointing at another child's evidence
 *  (the folder-1 segment is what the storage RLS keys on). */
function underStudentFolder(objectPath: string, sid: string): boolean {
  return objectPath.startsWith(`${sid}/`);
}

// ── confirm an uploaded object (photo/video/audio/document) ─────────────────────

const confirmSchema = z.object({
  studentId,
  taskId,
  evidenceId,
  objectPath: z.string().min(1).max(1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  contentType: z.string().min(1).max(255),
  posterObjectPath: z.string().min(1).max(1024).optional(),
  durationSeconds: z.number().nonnegative().optional(),
  caption: z.string().max(2000).optional(),
  capturedAt: z.string().max(64).optional(),
  /** Parsed EXIF (GPS/timestamp) — PRIVATE; cleared on redaction. Optional. */
  exif: z.record(z.string(), z.unknown()).optional(),
});

export type ConfirmEvidenceResult =
  | {
      ok: true;
      evidenceId: string;
      kind: string;
      sizeBytes: number;
      sizeMismatch: boolean;
      /** Advisory: a non-redacted same-hash sibling ("you already added this"). */
      hashDuplicateOf: string | null;
      /** True when the clientId already had a row (offline retry) — no new insert. */
      idempotent: boolean;
    }
  | {
      ok: false;
      reason: "login" | "forbidden" | "not_found" | "invalid_input" | "unsupported_type" | "object_missing" | "unavailable";
    };

export async function confirmUploadedEvidence(input: unknown): Promise<ConfirmEvidenceResult> {
  const { grants } = await requirePathUser();

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const p = parsed.data;

  // Evidence-kind validation (Unit 9 deferred it here): refuse an unrenderable type
  // fail-closed rather than store arbitrary bytes as a "document".
  const kind = classifyUploadKind(p.contentType);
  if (!kind) return { ok: false, reason: "unsupported_type" };

  const db = supabaseAdmin();

  let student;
  try {
    student = await loadStudentContext(db, p.studentId);
  } catch (e) {
    console.error(`[path/confirm] load failed for ${p.studentId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!student) return { ok: false, reason: "not_found" };

  // WRITE authority — the student or a parent (a guide's D25 read grant is NOT
  // authority to author evidence). Same rule as the slot mint.
  if (!canCaptureEvidence(grants, { studentId: student.studentId, familyId: student.familyId })) {
    return { ok: false, reason: "forbidden" };
  }
  // Paths must sit under this student's folder (defense against a forged path).
  if (!underStudentFolder(p.objectPath, student.studentId)) return { ok: false, reason: "forbidden" };
  if (p.posterObjectPath && !underStudentFolder(p.posterObjectPath, student.studentId)) {
    return { ok: false, reason: "forbidden" };
  }

  let taskProgressId: string | null;
  try {
    taskProgressId = await resolveTaskProgressId(db, student.studentId, p.taskId);
  } catch (e) {
    console.error(`[path/confirm] task lookup failed for ${student.studentId}/${p.taskId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!taskProgressId) return { ok: false, reason: "not_found" };

  // Idempotency (offline retry) + advisory hash dedupe, from the task's rows.
  let existing;
  try {
    existing = await loadExistingEvidence(db, taskProgressId);
  } catch (e) {
    console.error(`[path/confirm] existing read failed for ${taskProgressId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  const decision = decideConfirm({ clientId: p.evidenceId, sha256: p.sha256, existing });
  if (decision.action === "idempotent") {
    // The row already exists (a prior confirm won) — never a second permanent row.
    return { ok: true, evidenceId: decision.existingClientId, kind, sizeBytes: p.sizeBytes, sizeMismatch: false, hashDuplicateOf: null, idempotent: true };
  }

  // Reconcile the CLIENT-declared size/sha against the REAL object (on an
  // already-exists outcome the client values are unverified). Store the real size.
  let meta;
  try {
    meta = await readObjectMeta(db, p.objectPath);
  } catch (e) {
    console.error(`[path/confirm] object meta read failed for ${p.objectPath}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  const rec = reconcileMetadata({ reportedSizeBytes: p.sizeBytes, actual: { exists: meta.exists, sizeBytes: meta.sizeBytes } });
  if (!rec.ok) {
    if (rec.reason === "object_missing") return { ok: false, reason: "object_missing" };
    return { ok: false, reason: "unavailable" }; // unreadable_size — fail loud, never guess
  }

  // Mint the ONE cached signed-download URL for the object (reused until near
  // expiry — never minted per render).
  let minted;
  try {
    minted = await mintSignedDownloadUrl(db, p.objectPath);
  } catch (e) {
    console.error(`[path/confirm] signed-url mint failed for ${p.objectPath}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  try {
    await insertEvidenceItem(db, {
      id: p.evidenceId,
      taskProgressId,
      studentId: student.studentId,
      kind,
      bucket: EVIDENCE_BUCKET,
      objectPath: p.objectPath,
      posterObjectPath: p.posterObjectPath ?? null,
      contentType: p.contentType,
      sha256: p.sha256,
      sizeBytes: rec.storedSizeBytes,
      sizeMismatch: rec.sizeMismatch,
      durationSeconds: p.durationSeconds ?? null,
      logData: null,
      linkUrl: null,
      caption: p.caption ?? null,
      capturedAt: safeIso(p.capturedAt),
      exif: p.exif ?? null,
      signedUrl: minted.signedUrl,
      signedUrlExpiresAt: new Date(minted.expiresAtMs).toISOString(),
    });
  } catch (e) {
    console.error(`[path/confirm] insert failed for ${p.evidenceId}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, evidenceId: p.evidenceId, kind, sizeBytes: rec.storedSizeBytes, sizeMismatch: rec.sizeMismatch, hashDuplicateOf: decision.hashDuplicateOf, idempotent: false };
}

// ── save a log-table (kind='log') ───────────────────────────────────────────────

const saveLogSchema = z.object({
  studentId,
  taskId,
  evidenceId,
  /** The student's rows for the task's template. A zero-row log ([]) is a valid,
   *  DISTINCT state from having no log evidence at all. */
  rows: z.array(z.record(z.string(), z.unknown())).max(500),
  caption: z.string().max(2000).optional(),
});

export type SaveLogResult =
  | { ok: true; evidenceId: string }
  | { ok: false; reason: "login" | "forbidden" | "not_found" | "invalid_input" | "append_only" | "unavailable" };

export async function saveLogEvidence(input: unknown): Promise<SaveLogResult> {
  const { grants } = await requirePathUser();
  const parsed = saveLogSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const p = parsed.data;

  const db = supabaseAdmin();
  let student;
  try {
    student = await loadStudentContext(db, p.studentId);
  } catch (e) {
    console.error(`[path/log] load failed for ${p.studentId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!student) return { ok: false, reason: "not_found" };
  if (!canCaptureEvidence(grants, { studentId: student.studentId, familyId: student.familyId })) {
    return { ok: false, reason: "forbidden" };
  }

  let taskProgressId: string | null;
  try {
    taskProgressId = await resolveTaskProgressId(db, student.studentId, p.taskId);
  } catch (e) {
    console.error(`[path/log] task lookup failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!taskProgressId) return { ok: false, reason: "not_found" };

  // A log is editable until the task is append-only-latched (first verification).
  let latched: boolean;
  try {
    latched = computeLatched(await loadTaskLatchEvents(db, student.studentId, p.taskId));
  } catch (e) {
    console.error(`[path/log] latch read failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  const mutation = decideEvidenceMutation({ op: "edit", latched });
  if (!mutation.ok) return { ok: false, reason: "append_only" };

  try {
    await upsertLogEvidence(db, {
      id: p.evidenceId,
      taskProgressId,
      studentId: student.studentId,
      rows: p.rows,
      caption: p.caption ?? null,
    });
  } catch (e) {
    console.error(`[path/log] upsert failed for ${p.evidenceId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, evidenceId: p.evidenceId };
}

// ── add a link-overflow item (kind='link') ──────────────────────────────────────

const addLinkSchema = z.object({
  studentId,
  taskId,
  evidenceId,
  url: z.url().max(2048),
  caption: z.string().max(2000).optional(),
});

export type AddLinkResult =
  | { ok: true; evidenceId: string; idempotent: boolean }
  | { ok: false; reason: "login" | "forbidden" | "not_found" | "invalid_input" | "unavailable" };

export async function addLinkEvidence(input: unknown): Promise<AddLinkResult> {
  const { grants } = await requirePathUser();
  const parsed = addLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const p = parsed.data;

  const db = supabaseAdmin();
  let student;
  try {
    student = await loadStudentContext(db, p.studentId);
  } catch (e) {
    console.error(`[path/link] load failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!student) return { ok: false, reason: "not_found" };
  if (!canCaptureEvidence(grants, { studentId: student.studentId, familyId: student.familyId })) {
    return { ok: false, reason: "forbidden" };
  }

  let taskProgressId: string | null;
  try {
    taskProgressId = await resolveTaskProgressId(db, student.studentId, p.taskId);
  } catch (e) {
    console.error(`[path/link] task lookup failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!taskProgressId) return { ok: false, reason: "not_found" };

  let existing;
  try {
    existing = await loadExistingEvidence(db, taskProgressId);
  } catch (e) {
    console.error(`[path/link] existing read failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  const decision = decideConfirm({ clientId: p.evidenceId, sha256: null, existing });
  if (decision.action === "idempotent") return { ok: true, evidenceId: decision.existingClientId, idempotent: true };

  try {
    await insertEvidenceItem(db, {
      id: p.evidenceId,
      taskProgressId,
      studentId: student.studentId,
      kind: "link",
      bucket: null,
      objectPath: null,
      posterObjectPath: null,
      contentType: null,
      sha256: null,
      sizeBytes: null,
      sizeMismatch: false,
      durationSeconds: null,
      logData: null,
      linkUrl: p.url,
      caption: p.caption ?? null,
      capturedAt: null,
      exif: null,
      signedUrl: null,
      signedUrlExpiresAt: null,
    });
  } catch (e) {
    console.error(`[path/link] insert failed for ${p.evidenceId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, evidenceId: p.evidenceId, idempotent: false };
}

// ── delete an UNVERIFIED item (the pre-verification carve-out) ───────────────────

const deleteSchema = z.object({ studentId, evidenceId });

export type DeleteEvidenceResult =
  | { ok: true }
  | { ok: false; reason: "login" | "forbidden" | "not_found" | "invalid_input" | "append_only" | "unavailable" };

export async function deleteEvidence(input: unknown): Promise<DeleteEvidenceResult> {
  const { grants } = await requirePathUser();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const p = parsed.data;

  const db = supabaseAdmin();
  let student;
  try {
    student = await loadStudentContext(db, p.studentId);
  } catch (e) {
    console.error(`[path/delete] load failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!student) return { ok: false, reason: "not_found" };
  if (!canCaptureEvidence(grants, { studentId: student.studentId, familyId: student.familyId })) {
    return { ok: false, reason: "forbidden" };
  }

  let owner;
  try {
    owner = await resolveEvidenceOwner(db, p.evidenceId);
  } catch (e) {
    console.error(`[path/delete] owner read failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  // The row must belong to THIS student (never delete across families).
  if (!owner || owner.studentId !== student.studentId) return { ok: false, reason: "not_found" };

  // Refuse once latched (append-only); allowed for an unverified duplicate.
  const mutation = decideEvidenceMutation({ op: "delete", latched: computeLatched(owner.events) });
  if (!mutation.ok) return { ok: false, reason: "append_only" };

  try {
    await deleteEvidenceRow(db, p.evidenceId, owner.objectPaths);
  } catch (e) {
    console.error(`[path/delete] delete failed for ${p.evidenceId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}

// ── redact a verified item (the reviewer's tool; tombstone, never a row delete) ──

const redactSchema = z.object({ studentId, evidenceId, reason: z.string().min(1).max(1000) });

export type RedactEvidenceResult =
  | { ok: true }
  | { ok: false; reason: "login" | "forbidden" | "not_found" | "invalid_input" | "unavailable" };

export async function redactEvidenceAction(input: unknown): Promise<RedactEvidenceResult> {
  const { userId, grants } = await requirePathUser();
  const parsed = redactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const p = parsed.data;

  const db = supabaseAdmin();
  let student;
  try {
    student = await loadStudentContext(db, p.studentId);
  } catch (e) {
    console.error(`[path/redact] load failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!student) return { ok: false, reason: "not_found" };

  // Redaction is an ADULT action (a verifying parent or guide) — not the student.
  const actor = resolveActorRole({
    grants,
    target: { kind: "evidence", studentId: student.studentId, familyId: student.familyId, cohortId: student.cohortId },
  });
  if (actor !== "adult") return { ok: false, reason: "forbidden" };

  let owner;
  try {
    owner = await resolveEvidenceOwner(db, p.evidenceId);
  } catch (e) {
    console.error(`[path/redact] owner read failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!owner || owner.studentId !== student.studentId) return { ok: false, reason: "not_found" };

  try {
    await redactEvidence(db, { evidenceId: p.evidenceId, redactedBy: userId, reason: p.reason });
  } catch (e) {
    console.error(`[path/redact] redact failed for ${p.evidenceId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}
