/**
 * Pure evidence-model decision logic (T1 Unit 10) — the testable heart of the
 * evidence pipeline, in the same posture as Unit 9's `upload-rules.ts`.
 *
 * No next/supabase/react imports: this repo's tests are node-only, so the only
 * defensible place for the dedupe decision, the append-only latch, the redaction
 * blast radius, the log-table zero-vs-absent distinction, the confirm-time
 * metadata reconciliation, the evidence-kind validation, and the orphan-reaper
 * selection is a pure module. The `"use server"` confirm action and the
 * `server-only` I/O layer (`evidence-loader.ts`) decide nothing — every branch
 * they take is decided here and covered by `__tests__/evidence-rules.test.ts`.
 *
 * ── Load-bearing decisions baked in (see the plan's Unit 10 + Decision 10/11) ──
 *   * APPEND-ONLY IS A ONE-WAY LATCH set at first verification and NEVER lifting —
 *     through revocation, Not Yet, criterion return, and phase return. It is
 *     DERIVED from the append-only `path_task_events` history (a `verified`
 *     to_state ever existing), NOT from the task's CURRENT state — because a
 *     current-state check would wrongly conclude the latch lifts when a task
 *     returns to `in_progress`, letting a student delete the evidence that made a
 *     reviewer uncomfortable. Carve-out: reconciling/deleting a duplicate BEFORE
 *     any verification is not a deletion.
 *   * CONTENT-HASH DEDUPE IS ADVISORY (keep-both), not a DB constraint. The hard
 *     idempotency key is the client-generated evidence UUID (the row's PRIMARY KEY
 *     on `id` — a global UUID PK subsumes the plan's weaker composite), which makes
 *     the offline queue safe. The
 *     content hash only surfaces a "you already added this" hint — so there is no
 *     silent drop, and no redacted tombstone holding a hash forever and blocking a
 *     later legitimate resubmission (the reason a partial unique index is NOT used).
 *   * The sha256 in the object path is CLIENT-DECLARED and never integrity-verified
 *     (Unit 9). On an already-exists upload outcome the client-reported size/sha
 *     are unverified, so the confirm step reconciles against the real
 *     storage.objects size before storing it (`reconcileMetadata`).
 */

import type { Band } from "@/app/path/content/types";
import { columnsForBand, type LogColumn, type LogTemplate } from "@/app/path/content/log-templates";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Objects with no confirmed evidence row are reaped after 7 DAYS. Widened from
 * 48h when the reaper was scheduled (Unit 12, re-examining the Unit 10
 * carry-forward against Unit 11's offline queue): a device can complete an
 * upload, die before the confirm, and stay offline for days — the queued entry
 * then replays confirm-first against the already-uploaded object, and a 48h
 * window could have reaped it out from under that legitimate deferred confirm.
 * Seven days aligns with iOS's 7-day script-storage wipe horizon: past it, an
 * uninstalled client's queue is presumed dead anyway. Still comfortably past
 * the 24h TUS window (a resumable transfer is never deleted mid-flight), and
 * the cost is only that abandoned bytes linger five extra days. Closes the
 * quota's blind spot: an in-flight/abandoned upload has no size metadata and
 * is invisible to `path_student_storage_bytes`.
 */
export const ORPHAN_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The stored signed-download URL's lifetime. Kept SHORT because signed URLs use a
 * per-project key with no self-serve revocation (Unit 9). One URL is minted per
 * object and stored in Postgres, reused until near expiry — never minted per
 * render (each unique token is a fresh CDN cache key billed at 3x the cached rate).
 */
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h

/** Re-mint a stored URL once it is within this window of expiry. */
export const SIGNED_URL_REMINT_SKEW_MS = 5 * 60 * 1000; // 5m

/**
 * D21: in-app `MediaRecorder` clips are capped at this many seconds — which also
 * caps the storage bill. The file-picker fallback enforces its own size/duration
 * caps at slot issue (Unit 9). Client-declared/best-effort; there is no server-side
 * duration backstop in T1 (see the plan's Unit 9 carry-forward).
 */
export const MAX_VIDEO_RECORDING_SECONDS = 90;

// ── Evidence kinds ──────────────────────────────────────────────────────────────

/** The closed set of evidence kinds. Mirrored in the migration's `kind` CHECK
 *  (a parity test parses the .sql so the two can't drift). */
export const EVIDENCE_KINDS = ["photo", "video", "audio", "document", "log", "link"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** The kinds backed by an uploaded storage object. `log` (structured rows) and
 *  `link` (a >50MB link-overflow URL) carry no object. */
export const UPLOAD_EVIDENCE_KINDS = ["photo", "video", "audio", "document"] as const;
export type UploadEvidenceKind = (typeof UPLOAD_EVIDENCE_KINDS)[number];

export function isEvidenceKind(x: unknown): x is EvidenceKind {
  return typeof x === "string" && (EVIDENCE_KINDS as readonly string[]).includes(x);
}

/**
 * Map an upload's content-type to a renderable media kind — the evidence-kind
 * validation Unit 9 deferred here (the bucket's `allowed_mime_types` is NULL and
 * the pure upload-rules do size/duration/quota only). Returns `null` for an
 * unknown/unrenderable type so the caller can refuse FAIL-CLOSED rather than
 * smuggle arbitrary bytes in as a "document". Widening the allowlist is a one-line
 * change; refusing octet-stream (the uploader's empty-`File.type` fallback) is
 * deliberate.
 */
export function classifyUploadKind(contentType: string): UploadEvidenceKind | null {
  const mime = contentType.trim().toLowerCase().split(";")[0].trim();
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (DOCUMENT_MIME_TYPES.has(mime) || mime.startsWith("text/")) return "document";
  return null;
}

/**
 * Whether a URL is safe to store and render as an `<a href>`. Only `http`/`https`
 * pass — `javascript:`, `data:`, `vbscript:` and friends are refused. Zod's
 * `z.url()` accepts those dangerous schemes as valid URLs, so a link-overflow item
 * would otherwise be a stored-XSS vector when a reviewer (incl. a cross-family
 * Guide) clicks it. Applied at BOTH write (the addLink schema refine) and render
 * (EvidenceList) so a row that somehow already holds an unsafe URL is never linked.
 */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** The explicit document allowlist (plus any `text/*`). Deliberately narrow for
 *  T1 — a real family hitting a rejection is a one-line addition here. */
const DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// ── Confirm decision: idempotency + advisory hash dedupe ────────────────────────

/** An existing evidence row on the same task, as the confirm decision sees it. */
export type ExistingEvidence = {
  /** The client-generated evidence UUID (the row identity). */
  clientId: string;
  /** The client-declared content hash (null for log/link). */
  sha256: string | null;
  /** Non-null once redacted — a tombstone that must not block a resubmission. */
  redactedAt: string | null;
};

export type ConfirmOutcome =
  /** The clientId already has a row (offline retry / lost ack) — do NOT insert a
   *  second permanent row; adopt the existing one. */
  | { action: "idempotent"; existingClientId: string }
  /** Insert a new row. `hashDuplicateOf` names a NON-redacted same-hash sibling for
   *  an advisory "you already added this" hint — keep-both, never a hard block. */
  | { action: "insert"; hashDuplicateOf: string | null };

/**
 * Decide what a confirm should do given the incoming (clientId, sha256) and the
 * task's existing evidence rows. Mirrors the DB's `unique(task_progress_id, id)`:
 * a same-clientId match (redacted or not) is idempotent; otherwise insert, with an
 * advisory pointer to a non-redacted same-hash sibling (Decision #1: keep-both).
 */
export function decideConfirm(input: {
  clientId: string;
  sha256: string | null;
  existing: readonly ExistingEvidence[];
}): ConfirmOutcome {
  // Mirrors the DB's PRIMARY KEY on `id`: a same-clientId row (redacted or not) is
  // idempotent; otherwise insert, with an advisory pointer to a live same-hash sibling.
  const sameId = input.existing.find((e) => e.clientId === input.clientId);
  if (sameId) return { action: "idempotent", existingClientId: sameId.clientId };

  // Advisory hash duplicate: only a LIVE (non-redacted) sibling counts — a redacted
  // tombstone must never nag against a fresh similar capture.
  const hashTwin =
    input.sha256 != null
      ? input.existing.find((e) => e.redactedAt == null && e.sha256 === input.sha256)
      : undefined;
  return { action: "insert", hashDuplicateOf: hashTwin ? hashTwin.clientId : null };
}

// ── Append-only latch ───────────────────────────────────────────────────────────

/** The minimal task-event shape the latch reads: its resulting state. */
export type LatchEvent = { toState: string };

/**
 * Whether the task's evidence is append-only-latched. TRUE once a `verified`
 * to_state has ever appeared in the append-only event history — and it never
 * lifts, because a return (revoke / Not Yet / criterion return / phase return)
 * appends a NEW event and never erases the historical `verified` one. Derived from
 * history, not current state, on purpose (see the module header).
 */
export function computeLatched(events: readonly LatchEvent[]): boolean {
  return events.some((e) => e.toState === "verified");
}

export type MutationDecision = { ok: true } | { ok: false; reason: "append_only" };

/**
 * Whether an edit or delete of an existing evidence row is permitted. Refused once
 * latched (both edit and delete); permitted before the latch — which is the
 * pre-verification carve-out: an unverified duplicate can be deleted, a caption
 * fixed. "Reconciling a duplicate before verification is not a deletion."
 */
export function decideEvidenceMutation(input: {
  op: "edit" | "delete";
  latched: boolean;
}): MutationDecision {
  return input.latched ? { ok: false, reason: "append_only" } : { ok: true };
}

/**
 * The Unit 11 rebase repair (R6, the U10 carry-forward): `confirmUploadedEvidence`
 * snapshots `added_after_verification` from the task state read BEFORE its meta
 * reads and mints — a verify landing inside that I/O window yields a stale
 * `false`, silently violating R6 ("no evidence lands on a verified task
 * invisibly"). After the insert, the action re-reads the task and repairs
 * one-directionally: false→true when the task is NOW verified. Never true→false
 * — when the ordering is ambiguous (the verify and the confirm raced), erring
 * toward reviewer VISIBILITY is the honest side, and a flag on evidence that
 * arrived at the verification boundary is mild; invisible evidence is not.
 */
export function shouldRepairAddedAfterVerification(input: {
  stored: boolean;
  currentlyVerified: boolean;
}): boolean {
  return !input.stored && input.currentlyVerified;
}

// ── Redaction blast radius ──────────────────────────────────────────────────────

export type RedactionPlan = {
  /** Storage objects to delete via the Storage API, NEVER SQL (object + poster). */
  deleteObjectPaths: string[];
  /** Null the Postgres-cached signed URL — irrevocable URLs keep redacted media
   *  readable while a cached one survives. */
  nullSignedUrl: true;
  /** Clear the private EXIF column — it can hold the GPS coords of a child's home. */
  clearExif: true;
  /** The DB row stays as an append-only tombstone (redacted_at/by/reason set). */
  keepTombstone: true;
};

/**
 * The complete set of side-effects a redaction must perform. Pure descriptor; the
 * `server-only` executor performs each via the Storage API / a tombstone UPDATE.
 * Defined now — "the blast radius is defined now, or redaction doesn't redact."
 */
export function planRedaction(row: {
  objectPath: string | null;
  posterObjectPath: string | null;
}): RedactionPlan {
  const deleteObjectPaths = [row.objectPath, row.posterObjectPath].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  return { deleteObjectPaths, nullSignedUrl: true, clearExif: true, keepTombstone: true };
}

// ── Log-table view: zero-row vs absent ──────────────────────────────────────────

export type LogTableView =
  | { present: false }
  | { present: true; empty: boolean; columns: LogColumn[]; rowCount: number };

/**
 * Resolve how a task's log table renders. A task with a template but ZERO rows is
 * `present: true, empty: true` (render the headers + an empty state); a task with
 * NO template at all is `present: false` (render nothing). The distinction is the
 * plan's explicit requirement: a zero-row log must be distinguishable from no log.
 * `LogTable.tsx` renders this; it never defines a template.
 */
export function describeLogTable(input: {
  template: LogTemplate | undefined;
  band: Band;
  rowCount: number;
}): LogTableView {
  if (!input.template) return { present: false };
  const columns = columnsForBand(input.template, input.band);
  return { present: true, empty: input.rowCount <= 0, columns, rowCount: Math.max(0, input.rowCount) };
}

// ── Confirm-time metadata reconciliation ────────────────────────────────────────

export type ReconcileResult =
  | { ok: true; storedSizeBytes: number; sizeMismatch: boolean }
  | { ok: false; reason: "object_missing" | "unreadable_size" };

/**
 * Reconcile the client-reported upload metadata against the REAL storage object
 * before persisting it. On an already-exists outcome the client-reported size/sha
 * are unverified (Unit 9), so the confirm step must trust the object, not the
 * client: refuse if the object never landed, fail loud on an unreadable real size
 * (never store a guess — a fail-OPEN would corrupt the quota), and otherwise store
 * the REAL size, flagging a divergence from what the client claimed.
 */
export function reconcileMetadata(input: {
  reportedSizeBytes: number;
  actual: { exists: boolean; sizeBytes: number | null };
}): ReconcileResult {
  if (!input.actual.exists) return { ok: false, reason: "object_missing" };
  const real = input.actual.sizeBytes;
  if (typeof real !== "number" || !Number.isFinite(real) || real < 0) {
    return { ok: false, reason: "unreadable_size" };
  }
  return { ok: true, storedSizeBytes: real, sizeMismatch: real !== input.reportedSizeBytes };
}

// ── Orphan reaper selection ─────────────────────────────────────────────────────

/**
 * Select storage objects to reap: those with no confirmed evidence row that are at
 * least `minAgeMs` old (default 48h). Pure — the cron loads the bucket listing and
 * the confirmed-path set, and this decides; the executor deletes via the Storage
 * API. `>=` at the boundary errs toward reclaiming abandoned bytes.
 */
export function selectOrphans(input: {
  objects: readonly { path: string; createdAtMs: number }[];
  confirmedPaths: Iterable<string>;
  nowMs: number;
  minAgeMs?: number;
}): string[] {
  const minAge = input.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const confirmed = input.confirmedPaths instanceof Set ? input.confirmedPaths : new Set(input.confirmedPaths);
  return input.objects
    .filter((o) => !confirmed.has(o.path) && input.nowMs - o.createdAtMs >= minAge)
    .map((o) => o.path);
}

// ── Signed-download-URL freshness ───────────────────────────────────────────────

/**
 * Whether the stored signed-download URL should be re-minted: yes when none is
 * stored, or when within `SIGNED_URL_REMINT_SKEW_MS` of expiry. Reusing the stored
 * URL until near expiry is what keeps the CDN warm — minting per render triples the
 * egress bill.
 *
 * No caller yet — Unit 14's evidence-read surface consumes this to decide whether to
 * re-mint before rendering, rather than reinventing an ad-hoc freshness check.
 */
export function shouldRemintSignedUrl(input: {
  expiresAtMs: number | null;
  nowMs: number;
  skewMs?: number;
}): boolean {
  if (input.expiresAtMs == null) return true;
  const skew = input.skewMs ?? SIGNED_URL_REMINT_SKEW_MS;
  return input.nowMs >= input.expiresAtMs - skew;
}
