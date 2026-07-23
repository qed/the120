/**
 * Pure offline-sync decision logic (T1 Unit 11) — ALL of it.
 *
 * No next/supabase/react/dom imports: this repo's tests are node-only, so the
 * service worker, the IndexedDB queue, and the drain engine must be THIN
 * drivers over this module — nothing about the SW or IDB is testable here, so
 * nothing decision-bearing may live there. Every branch the drivers take is
 * decided here and covered by __tests__/sync-rules.test.ts.
 *
 * ── The architecture in one paragraph ─────────────────────────────────────────
 * Every capture writes a durable IndexedDB queue entry BEFORE any network I/O
 * (upload-then-die and mid-upload death both survive a killed tab), and the
 * online interactive path is simply the FIRST drain attempt of that entry. The
 * queue is drained on foreground signals (`load`, `online`,
 * `visibilitychange → visible`, post-auth) — Background Sync is a
 * Chromium-only nudge, never the mechanism. Uploads run from the PAGE context
 * (iOS kills backgrounded SWs); TUS resume covers interrupts. An entry is
 * deleted only AFTER its idempotent effect lands (the calcom
 * dedupe-key-after-effect model: the effect is idempotent by client
 * `evidenceId`, the deletion is the "record" step — docs/solutions/
 * best-practices/webhook-idempotency-record-dedupe-key-after-idempotent-
 * effect-and-scope-cancels-by-provenance-2026-07-17.md).
 *
 * ── Sync is a REBASE, not a replay (Decision 10) ──────────────────────────────
 * Evidence always attaches — it is a fact about the world and `capturedAt` is
 * honest. Queued SUBMITS validate against current server state; the four
 * server-state-moved cases are each explicit in `planSubmitTransitions` /
 * `interpretSubmitRefusal`:
 *   1. task returned to `not_yet`  → attach; submit re-applies (resume→submit)
 *   2. criterion returned          → attach; submit no-ops with a note
 *      (surfaces as a `display_blocked` refusal from the engine)
 *   3. phase/predecessor locked    → attach; submit refused with an explanation
 *   4. task ALREADY VERIFIED       → attach flagged `added_after_verification`
 *      (server-side, repaired against real state — see evidence-rules'
 *      `shouldRepairAddedAfterVerification`); submit resolves quietly and the
 *      celebration replays on next open (Unit 16). Never an error.
 *
 * ── Timestamps (R30) ──────────────────────────────────────────────────────────
 * `submittedAt` is the ENQUEUE-time client value, skew-clamped (never a future
 * timestamp) — it rides `applyTransition`'s `submittedAt` → the RPC's
 * `p_submitted_at`. The server stamps `submit_received_at` itself; R30
 * instruments off the SERVER value, or the metric would measure the child's
 * connectivity rather than the parent's responsiveness. `capturedAt` clamps
 * the same way, and a clamp is RECORDED (queue entry + the private exif column)
 * rather than silently rewritten.
 *
 * ── Scope decision (System-Wide Impact; decided deliberately) ─────────────────
 * The worker is served from the ORIGIN ROOT (`/sw.js` — outside the proxy
 * matcher, so an expired session can never break an SW update fetch) and
 * registered with the NARROW scope `/path` (narrowing needs no
 * Service-Worker-Allowed header; only broadening does). A Path SW bug can
 * therefore never intercept a marketing fetch. The manifest is likewise
 * /path-scoped: `public/path.webmanifest` linked only from the /path layout —
 * a root `app/manifest.ts` would make every marketing page installable under
 * Path branding. `sw-discipline.test.ts` pins the drivers to these constants.
 */

import {
  classifyItem,
  isTusUrlExpired,
  type ItemClassification,
} from "./upload-rules";
import type { TaskState } from "./transition-table";

// ── Constants the thin drivers inline (parity-pinned by sw-discipline.test.ts) ─

/** The worker script URL — origin root, OUTSIDE the /path proxy matcher. */
export const SW_URL = "/sw.js";
/** The registration scope — no trailing slash so `/path` itself is controlled. */
export const SW_SCOPE = "/path";
/** The navigation fallback page — static, ungated, env-less-safe. */
export const OFFLINE_URL = "/offline";
/** The /path-scoped manifest (NEVER a root app/manifest.ts — see header). */
export const PATH_MANIFEST_URL = "/path.webmanifest";

/** IndexedDB identity for the capture queue. */
export const QUEUE_DB_NAME = "path-offline-queue";
export const QUEUE_DB_VERSION = 1;
export const QUEUE_STORE = "entries";

/** `createSignedUploadUrl` expiry is fixed at 2 hours (not configurable). */
export const SIGNED_UPLOAD_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
/** Re-mint this far BEFORE the token dies — a mint is cheap, a mid-upload 403 is not. */
export const TOKEN_REMINT_MARGIN_MS = 5 * 60 * 1000;

// ── Queue entry model ─────────────────────────────────────────────────────────
// Stored via structured clone (Blobs kept as Blobs — far cheaper than base64).

type QueueEntryBase = {
  /** Entry identity (uuid) — distinct from any evidence identity. */
  id: string;
  studentId: string;
  taskId: string;
  /** Client clock at enqueue (ISO). Drain order and submit ordering key on it. */
  enqueuedAt: string;
  /** Failed drain attempts (diagnostics + SyncStatus escalation). */
  attempts: number;
  lastAttemptAt: string | null;
  /**
   * Terminal outcome, surfaced in SyncStatus and excluded from auto-drain.
   * `reason` is the typed refusal; `note` is the student-readable line. A
   * dropped entry keeps a tombstone here until dismissed — never silent.
   */
  blocked: { reason: string; note: string } | null;
};

/** The minted slot, persisted so a resume survives the session (U9 carry). */
export type StoredSlot = {
  strategy: "plain" | "tus";
  bucket: string;
  objectPath: string;
  token: string;
  /** TUS only. */
  endpoint?: string;
  chunkSize?: number;
  /** Server-issued mint time (ISO) — the 2h token clock. */
  mintedAt: string;
};

export type MediaQueueEntry = QueueEntryBase & {
  kind: "media";
  /** The durable client evidence identity — REUSED on every replay (the confirm
   *  dedupe and the quota exclusion both key on it). Never regenerated. */
  evidenceId: string;
  file: Blob;
  fileName: string;
  mime: string;
  bytes: number;
  sha256: string;
  capturedAt: string;
  durationSeconds?: number;
  /** Video poster frame — best-effort, one attempt per drain, never blocks. */
  poster: {
    blob: Blob;
    sha256: string;
    uploaded: boolean;
    attempted: boolean;
    objectPath: string | null;
  } | null;
  slot: StoredSlot | null;
  /** The live TUS upload URL and ITS creation clock (24h TTL — independent of
   *  the 2h token clock). */
  tus: { url: string; createdAt: string } | null;
  uploadedBytes: number;
  /** True once the object landed (including an already-exists retry mapping). */
  uploaded: boolean;
};

export type LinkQueueEntry = QueueEntryBase & {
  kind: "link";
  evidenceId: string;
  url: string;
  caption?: string;
};

export type LogQueueEntry = QueueEntryBase & {
  kind: "log";
  evidenceId: string;
  rows: Record<string, unknown>[];
  caption?: string;
};

export type SubmitQueueEntry = QueueEntryBase & {
  kind: "submit";
  /** Client submit time at ENQUEUE (not drain) — R30's `submitted_at`. */
  submittedAt: string;
};

export type QueueEntry = MediaQueueEntry | LinkQueueEntry | LogQueueEntry | SubmitQueueEntry;

// ── Enqueue admission ─────────────────────────────────────────────────────────

export type CaptureAdmission =
  | { ok: true }
  | { ok: false; reason: "link_overflow"; cause: Extract<ItemClassification, { storable: false }>["reason"] };

/**
 * Refuse at CAPTURE what can never be stored (D21 caps) — a 400 MB video must
 * be refused in the moment with the link path offered, not queued for days and
 * refused at sync when the moment is gone. Delegates to upload-rules'
 * classifyItem so the boundary can never drift from the server's.
 */
export function admitCapture(input: { sizeBytes: number; durationSeconds?: number | null }): CaptureAdmission {
  const cls = classifyItem(input);
  if (!cls.storable) return { ok: false, reason: "link_overflow", cause: cls.reason };
  return { ok: true };
}

// ── Skew clamping ─────────────────────────────────────────────────────────────

export type ClampResult =
  | { value: string; clamped: false }
  | { value: string; clamped: true; original: string };

/**
 * A client clock can run ahead; a future `capturedAt`/`submittedAt` is clamped
 * to now and the clamp is RECORDED (never silently rewritten). An unparseable
 * value degrades to now, recorded — a corrupt timestamp must never abort a
 * child's capture.
 */
export function clampToNow(isoValue: string, nowMs: number): ClampResult {
  const parsed = Date.parse(isoValue);
  const nowIso = new Date(nowMs).toISOString();
  if (Number.isNaN(parsed)) return { value: nowIso, clamped: true, original: isoValue };
  if (parsed > nowMs) return { value: nowIso, clamped: true, original: isoValue };
  return { value: isoValue, clamped: false };
}

// ── Upload freshness (2h token vs 24h TUS URL — two independent clocks) ───────

export type UploadFreshness = "fresh" | "token_stale" | "url_expired";

/**
 * The U9 carry-forward, wired: the signed-upload TOKEN lives 2h from mint (re-
 * minted early by TOKEN_REMINT_MARGIN_MS); the TUS upload URL lives 24h from
 * ITS creation (`isTusUrlExpired`). A >2h pause re-mints the token and KEEPS
 * the URL — resume, not restart. Past 24h the URL is dead: restart from zero.
 */
export function classifyUploadFreshness(input: {
  slotMintedAtMs: number | null;
  tusCreatedAtMs: number | null;
  nowMs: number;
}): UploadFreshness {
  if (input.tusCreatedAtMs !== null && isTusUrlExpired(input.tusCreatedAtMs, input.nowMs)) {
    return "url_expired";
  }
  if (input.slotMintedAtMs === null) return "token_stale";
  if (input.nowMs - input.slotMintedAtMs >= SIGNED_UPLOAD_TOKEN_TTL_MS - TOKEN_REMINT_MARGIN_MS) {
    return "token_stale";
  }
  return "fresh";
}

// ── Media pipeline stepping ───────────────────────────────────────────────────

export type MediaStep =
  | { step: "mint"; reset: boolean }
  | { step: "upload"; resumeUrl: string | null }
  | { step: "poster" }
  | { step: "confirm" };

const parseIsoMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * The next action for a media entry — the drain engine is a `while` loop over
 * this function. Once `uploaded`, the entry never re-uploads (an already-
 * exists response on either leg was mapped to success upstream by
 * interpretUploadResponse — the 48h-wedge learning); the poster gets exactly
 * ONE best-effort attempt per drain and never blocks confirm.
 */
export function nextMediaStep(entry: MediaQueueEntry, nowMs: number): MediaStep {
  if (entry.uploaded) {
    if (entry.poster && !entry.poster.uploaded && !entry.poster.attempted) return { step: "poster" };
    return { step: "confirm" };
  }
  const freshness = classifyUploadFreshness({
    slotMintedAtMs: parseIsoMs(entry.slot?.mintedAt),
    tusCreatedAtMs: parseIsoMs(entry.tus?.createdAt),
    nowMs,
  });
  if (freshness === "url_expired") return { step: "mint", reset: true };
  if (freshness === "token_stale") return { step: "mint", reset: false };
  return { step: "upload", resumeUrl: entry.tus?.url ?? null };
}

/** Fold an upload-leg outcome (from upload-rules' interpretUploadResponse)
 *  back into the entry. Success — including the already-exists mapping —
 *  marks `uploaded`; a retry outcome counts the attempt and stays pending. */
export function applyUploadOutcome(
  entry: MediaQueueEntry,
  outcome: "success" | "retry" | "failed"
): MediaQueueEntry {
  if (outcome === "success") return { ...entry, uploaded: true };
  return { ...entry, attempts: entry.attempts + 1 };
}

// ── Drain planning ────────────────────────────────────────────────────────────

export type DrainPlan = {
  /** Entry ids in execution order (enqueue order, FIFO). */
  runnable: string[];
  /** Entries deliberately not run this drain, each with a reason. */
  held: { id: string; reason: "awaiting_evidence" | "needs_attention_first" }[];
};

/**
 * FIFO by `enqueuedAt` (id tiebreak, so the order is total and stable). A
 * SUBMIT for task T is held while any earlier NON-submit entry for T is still
 * in the queue: submitting before the evidence lands would present the parent
 * an emptier task than the child actually finished. If the earlier entry is
 * BLOCKED, the submit holds with `needs_attention_first` — surfaced, so the
 * student resolves or dismisses the stuck item rather than waiting forever.
 */
export function planDrain(entries: readonly QueueEntry[]): DrainPlan {
  const ordered = [...entries].sort((a, b) => {
    const at = Date.parse(a.enqueuedAt);
    const bt = Date.parse(b.enqueuedAt);
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const runnable: string[] = [];
  const held: DrainPlan["held"] = [];

  for (const entry of ordered) {
    if (entry.blocked) continue; // manual retry/dismiss only
    if (entry.kind === "submit") {
      const earlier = ordered.filter(
        (e) =>
          e.kind !== "submit" &&
          e.taskId === entry.taskId &&
          Date.parse(e.enqueuedAt) <= Date.parse(entry.enqueuedAt)
      );
      if (earlier.some((e) => e.blocked)) {
        held.push({ id: entry.id, reason: "needs_attention_first" });
        continue;
      }
      if (earlier.length > 0) {
        held.push({ id: entry.id, reason: "awaiting_evidence" });
        continue;
      }
    }
    runnable.push(entry.id);
  }

  return { runnable, held };
}

/**
 * A shared family tablet's queue can hold entries for several siblings, and a
 * signed-in session can only act on its own scope (the student themself; a
 * parent, any of their children). Entries outside the scope stay QUEUED —
 * never attempted, never blocked — and drain when their owner (or a parent)
 * next signs in on this device.
 */
export function selectDrainable(
  entries: readonly QueueEntry[],
  actableStudentIds: readonly string[]
): QueueEntry[] {
  const actable = new Set(actableStudentIds);
  return entries.filter((e) => actable.has(e.studentId));
}

// ── The submit rebase (Decision 10's four cases) ──────────────────────────────

export type SubmitPlan =
  | { kind: "chain"; transitions: ("open" | "resume" | "submit")[] }
  | { kind: "done"; celebrate: boolean; note: string | null }
  | { kind: "refused"; note: string }
  | { kind: "drop"; note: string };

/**
 * Rebase a queued submit against the task's CURRENT server state (read fresh
 * at drain time — never the state the client remembered). `null` state means
 * the task no longer resolves for this student (program change, removed row):
 * drop with a surfaced note, never silently.
 */
export function planSubmitTransitions(state: TaskState | null): SubmitPlan {
  switch (state) {
    case null:
      return {
        kind: "drop",
        note: "This step no longer exists in your Path, so the queued submit was set aside. Your evidence is safe.",
      };
    case "available":
      // The offline `open` never landed — chain it (same choreography as the
      // live surface's transitionsBeforeSubmit).
      return { kind: "chain", transitions: ["open", "submit"] };
    case "not_yet":
      // Case 1 — returned while offline: evidence attached; re-apply via resume.
      return { kind: "chain", transitions: ["resume", "submit"] };
    case "in_progress":
      return { kind: "chain", transitions: ["submit"] };
    case "submitted":
      // An earlier drain attempt (or another device) already won — idempotent.
      return { kind: "done", celebrate: false, note: null };
    case "verified":
      // Case 4 — verified while offline. Quietly done; the celebration event
      // replays on next open (Unit 16). NEVER an error.
      return { kind: "done", celebrate: true, note: "This step was verified while you were away." };
    case "locked":
      // Case 3 — the phase (or an earlier step) locked it again.
      return {
        kind: "refused",
        note: "This step isn't open right now — an earlier part of your Path has to finish first. Your evidence is attached and safe.",
      };
  }
}

export type RefusalInterpretation =
  | { outcome: "retry" }
  | { outcome: "auth" }
  | { outcome: "done_with_note"; note: string }
  | { outcome: "blocked"; note: string };

const RETRYABLE_REASONS = new Set(["unavailable", "retry", "rate_limited"]);

/**
 * Interpret a refusal from the live transition attempt. `display_blocked` is
 * case 2 — the criterion was returned while offline: the evidence is attached,
 * the submit no-ops with a note. Anything unrecognized blocks with a note
 * (fail closed — never an infinite retry on a reason nobody classified).
 */
export function interpretSubmitRefusal(reason: string): RefusalInterpretation {
  if (reason === "login") return { outcome: "auth" };
  if (RETRYABLE_REASONS.has(reason)) return { outcome: "retry" };
  if (reason === "display_blocked") {
    return {
      outcome: "done_with_note",
      note: "An earlier step reopened while you were away, so this one waits its turn. Your evidence is attached and safe.",
    };
  }
  return {
    outcome: "blocked",
    note: "This couldn't be sent for review. Open the step to see where it stands.",
  };
}

/** A submit that returns ok is DONE — including `byCaller: false`, which is
 *  applyTransition's lost-echo re-read ("the write committed, the response was
 *  lost") or a concurrent winner. Either way: delete the entry, never re-apply. */
export function resolveSubmitResult(result: { ok: true; byCaller: boolean }): { outcome: "done" } {
  void result;
  return { outcome: "done" };
}

// ── Attach failures (media confirm / link / log) ──────────────────────────────

export type AttachFailure =
  | { outcome: "retry" }
  | { outcome: "auth" }
  | { outcome: "drop"; note: string }
  | { outcome: "done_with_note"; note: string }
  | { outcome: "blocked"; note: string };

const ATTACH_BLOCK_NOTES: Record<string, string> = {
  quota_exceeded: "Storage is full for this year — add this as a link instead.",
  link_overflow: "This file is too big to store — add it as a link instead.",
  forbidden: "This couldn't be saved to this step.",
  invalid_input: "Something about this item couldn't be saved. Try capturing it again.",
  unsupported_type: "This file type can't be stored — add it as a link instead.",
  object_missing: "The uploaded file went missing — try capturing it again.",
  append_only_latched: "This step is verified — its filed evidence can't be replaced.",
};

/**
 * Interpret a failed attach. Evidence ALWAYS attaches under Decision 10 — the
 * exceptions are each explicit: a task that no longer exists drops with a
 * surfaced note; a LOG against a since-verified task is frozen by append-only
 * (an edit, unlike photo/video/link additions, which the server accepts and
 * flags); transient failures retry; the rest block for attention.
 */
export function interpretAttachFailure(kind: QueueEntry["kind"], reason: string): AttachFailure {
  if (reason === "login") return { outcome: "auth" };
  if (RETRYABLE_REASONS.has(reason)) return { outcome: "retry" };
  if (reason === "not_found") {
    return {
      outcome: "drop",
      note: "This step no longer exists in your Path, so this item was set aside.",
    };
  }
  if (reason === "append_only" && kind === "log") {
    return {
      outcome: "done_with_note",
      note: "This step was verified while you were away — its log is part of the record now and can't change.",
    };
  }
  return {
    outcome: "blocked",
    note: ATTACH_BLOCK_NOTES[reason] ?? "This couldn't be saved. Tap to try again.",
  };
}

// ── Replay-stable server call builders ────────────────────────────────────────

export type ConfirmCallParams = {
  evidenceId: string;
  objectPath: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  posterObjectPath?: string;
  durationSeconds?: number;
  capturedAt: string;
  /** Present ONLY when the capture time was clamped — the recorded skew. */
  exif?: { clock_skew_clamped: { original_captured_at: string; clamped_at: string } };
};

/**
 * Build the confirm call from a media entry. The evidenceId is the ENTRY's —
 * never regenerated — so a replay lands on the confirm's idempotency key and
 * the quota exclusion, yielding exactly one permanent row. Requires a minted
 * slot (the objectPath is the slot's).
 */
export function buildConfirmParams(
  entry: MediaQueueEntry & { slot: StoredSlot },
  nowMs: number
): ConfirmCallParams {
  const clamp = clampToNow(entry.capturedAt, nowMs);
  return {
    evidenceId: entry.evidenceId,
    objectPath: entry.slot.objectPath,
    sha256: entry.sha256,
    sizeBytes: entry.bytes,
    contentType: entry.mime,
    ...(entry.poster?.uploaded && entry.poster.objectPath
      ? { posterObjectPath: entry.poster.objectPath }
      : {}),
    ...(entry.durationSeconds !== undefined ? { durationSeconds: entry.durationSeconds } : {}),
    capturedAt: clamp.value,
    ...(clamp.clamped
      ? {
          exif: {
            clock_skew_clamped: { original_captured_at: clamp.original, clamped_at: clamp.value },
          },
        }
      : {}),
  };
}

/**
 * Build the submit's client timestamp (R30): the ENQUEUE-time value, clamped —
 * so `submitted_at` and the server's `submit_received_at` legitimately diverge
 * by the offline duration, and R30 instruments off the server value.
 */
export function buildSubmitParams(
  entry: SubmitQueueEntry,
  nowMs: number
): { submittedAt: string; clamp: { original: string } | null } {
  const clamp = clampToNow(entry.submittedAt, nowMs);
  return {
    submittedAt: clamp.value,
    clamp: clamp.clamped ? { original: clamp.original } : null,
  };
}

// ── Registration guard ────────────────────────────────────────────────────────

const REGISTRABLE_HOSTNAMES = new Set([
  "the120.school",
  "www.the120.school",
  "localhost",
  "127.0.0.1",
]);

/**
 * Only the production origin (and local dev) may register the worker — a
 * preview deployment's SW would outlive the preview and poison later previews
 * on the same origin. Exact hostname match, never a suffix test.
 */
export function shouldRegisterServiceWorker(hostname: string): boolean {
  return REGISTRABLE_HOSTNAMES.has(hostname);
}

// ── iOS durability posture ────────────────────────────────────────────────────

export type DurabilityWarning = "none" | "install_gentle" | "install_urgent";

/**
 * Install is a DATA-DURABILITY requirement on iOS: Safari wipes IndexedDB, the
 * Cache API, and the SW registration after 7 days without interaction —
 * installed home-screen apps are exempt. Non-installed iOS with queued bytes
 * is the product-destroying state (a 400 MB week wiped on day eight): warn
 * urgently. With nothing queued, coach gently. Installed or non-iOS: silent.
 */
export function decideDurabilityWarning(input: {
  isIOS: boolean;
  isStandalone: boolean;
  queuedCount: number;
}): DurabilityWarning {
  if (!input.isIOS || input.isStandalone) return "none";
  return input.queuedCount > 0 ? "install_urgent" : "install_gentle";
}

// ── SyncStatus view model ─────────────────────────────────────────────────────

export type QueueSummary = {
  /** Entries still trying (not blocked). */
  pendingCount: number;
  /** Bytes of pending media — the durability-warning input. */
  queuedBytes: number;
  /** Blocked entries needing a human, each with its student-readable note. */
  attention: { id: string; note: string }[];
};

export function summarizeQueue(entries: readonly QueueEntry[]): QueueSummary {
  let pendingCount = 0;
  let queuedBytes = 0;
  const attention: QueueSummary["attention"] = [];
  for (const entry of entries) {
    if (entry.blocked) {
      attention.push({ id: entry.id, note: entry.blocked.note });
      continue;
    }
    pendingCount += 1;
    if (entry.kind === "media") queuedBytes += entry.bytes;
  }
  return { pendingCount, queuedBytes, attention };
}
