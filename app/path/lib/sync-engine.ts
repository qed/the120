/**
 * The offline-sync drain engine (T1 Unit 11) — a THIN client-side driver.
 *
 * Every decision it takes comes from sync-rules.ts (pure, tested): what to
 * enqueue (`admitCapture`), what runs and in what order (`planDrain`,
 * `selectDrainable`), the next step of a media entry (`nextMediaStep`), how a
 * queued submit rebases onto moved server state (`planSubmitTransitions`,
 * `interpretSubmitRefusal`), and how failures classify
 * (`interpretAttachFailure`). This file only performs I/O in the order those
 * functions dictate.
 *
 * Runs in PAGE context, never the service worker — iOS kills a backgrounded SW
 * and an in-flight upload dies with it; a page-context TUS transfer resumes
 * (persisted URL) instead. Drained on foreground signals: module start
 * (`load`), `online`, `visibilitychange → visible`, and an SW "path-drain"
 * message (the Chromium-only Background Sync nudge — an enhancement, never the
 * mechanism).
 *
 * Durability contract (the calcom dedupe-key-after-effect model): an entry is
 * deleted only AFTER its idempotent server effect landed (confirm/link/log are
 * idempotent by the entry's client evidenceId; submit by the transition CAS).
 * A crash between effect and delete replays into the idempotency key and
 * yields exactly one row.
 *
 * Single-drainer: Web Locks (`ifAvailable`) with an in-module fallback — two
 * tabs never race one queue entry into two TUS clients (the 409 case).
 */

import {
  addLinkEvidence,
  confirmUploadedEvidence,
  saveLogEvidence,
} from "@/app/path/lib/actions/evidence";
import { applyTransition } from "@/app/path/lib/actions/transition";
import { getTaskState } from "@/app/path/lib/actions/journey-read";
import { requestUploadSlot } from "@/app/path/lib/actions/upload-slot";
import { sha256Hex, uploadWithSlot } from "@/app/path/components/upload-client";
import { extensionFor } from "@/app/path/lib/upload-rules";
import { transitionsAfterCapture } from "@/app/path/lib/now-card-rules";
import {
  deleteEntry,
  getEntry,
  isQueueSupported,
  listEntries,
  putEntry,
} from "@/app/path/lib/offline-queue";
import {
  admitCapture,
  applyUploadOutcome,
  buildConfirmParams,
  buildSubmitParams,
  clampToNow,
  interpretAttachFailure,
  interpretSubmitRefusal,
  nextMediaStep,
  planDrain,
  planSubmitTransitions,
  selectDrainable,
  type CaptureAdmission,
  type LinkQueueEntry,
  type LogQueueEntry,
  type MediaQueueEntry,
  type QueueEntry,
  type StoredSlot,
  type SubmitQueueEntry,
} from "@/app/path/lib/sync-rules";

// ── engine-wide state + subscription ──────────────────────────────────────────

const listeners = new Set<() => void>();
let authRequired = false;
let fallbackDrainActive = false;

/** Subscribe to queue mutations (SyncStatus/InstallPrompt re-read on change). */
export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when the last drain hit an expired session — surfaced, never redirected
 *  from a background drain (rude); the next signed-in page load resumes. */
export function isAuthRequired(): boolean {
  return authRequired;
}

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      console.error("[path/sync] queue listener threw:", e);
    }
  }
}

/** Next's redirect() control-flow throw — the auth guard firing before an
 *  action body. In a background drain this means "session expired": pause. */
function isNextRedirect(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

// ── enqueue ───────────────────────────────────────────────────────────────────

export type EnqueueResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unsupported" }
  | Extract<CaptureAdmission, { ok: false }>;

const nowIso = () => new Date().toISOString();

const baseEntry = (studentId: string, taskId: string) => ({
  id: crypto.randomUUID(),
  studentId,
  taskId,
  enqueuedAt: nowIso(),
  attempts: 0,
  lastAttemptAt: null,
  blocked: null,
});

/**
 * Queue a media capture BEFORE any network I/O — upload-then-die and
 * mid-upload death both survive a killed tab. Refuses at capture what can
 * never be stored (D21, via admitCapture) with the link path offered; returns
 * `unsupported` when this browser has no IndexedDB (private-mode Safari), and
 * the caller falls back to the in-session direct flow.
 */
export async function enqueueMediaCapture(p: {
  studentId: string;
  taskId: string;
  file: Blob;
  fileName: string;
  capturedAt?: string;
  durationSeconds?: number;
  poster?: Blob | null;
}): Promise<EnqueueResult> {
  const admission = admitCapture({ sizeBytes: p.file.size, durationSeconds: p.durationSeconds ?? null });
  if (!admission.ok) return admission;
  if (!isQueueSupported()) return { ok: false, reason: "unsupported" };

  const sha256 = await sha256Hex(await p.file.arrayBuffer());
  const posterSha = p.poster ? await sha256Hex(await p.poster.arrayBuffer()) : null;

  const entry: MediaQueueEntry = {
    ...baseEntry(p.studentId, p.taskId),
    kind: "media",
    evidenceId: crypto.randomUUID(),
    file: p.file,
    fileName: p.fileName,
    mime: p.file.type || "application/octet-stream",
    bytes: p.file.size,
    sha256,
    // Clamped at BUILD time too (drain-time now) — but record honestly here.
    capturedAt: clampToNow(p.capturedAt ?? nowIso(), Date.now()).value,
    ...(p.durationSeconds !== undefined ? { durationSeconds: p.durationSeconds } : {}),
    poster:
      p.poster && posterSha
        ? { blob: p.poster, sha256: posterSha, uploaded: false, attempted: false, objectPath: null }
        : null,
    slot: null,
    tus: null,
    uploadedBytes: 0,
    uploaded: false,
  };
  await putEntry(entry);
  notify();
  return { ok: true, id: entry.id };
}

export async function enqueueLink(p: {
  studentId: string;
  taskId: string;
  url: string;
  caption?: string;
}): Promise<EnqueueResult> {
  if (!isQueueSupported()) return { ok: false, reason: "unsupported" };
  const entry: LinkQueueEntry = {
    ...baseEntry(p.studentId, p.taskId),
    kind: "link",
    evidenceId: crypto.randomUUID(),
    url: p.url,
    ...(p.caption !== undefined ? { caption: p.caption } : {}),
  };
  await putEntry(entry);
  notify();
  return { ok: true, id: entry.id };
}

export async function enqueueLog(p: {
  studentId: string;
  taskId: string;
  /** The log's DURABLE evidence identity — the live surface's draft/log id, so
   *  an offline save then an online save land on ONE row, not two. */
  evidenceId: string;
  rows: Record<string, unknown>[];
  caption?: string;
}): Promise<EnqueueResult> {
  if (!isQueueSupported()) return { ok: false, reason: "unsupported" };
  const entries = await listEntries();
  // A re-save of the same log replaces the queued rows (last write wins locally
  // — the server upsert has the same semantics).
  const existing = entries.find(
    (e): e is LogQueueEntry => e.kind === "log" && e.evidenceId === p.evidenceId
  );
  const entry: LogQueueEntry = existing
    ? { ...existing, rows: p.rows, ...(p.caption !== undefined ? { caption: p.caption } : {}), blocked: null }
    : {
        ...baseEntry(p.studentId, p.taskId),
        kind: "log",
        evidenceId: p.evidenceId,
        rows: p.rows,
        ...(p.caption !== undefined ? { caption: p.caption } : {}),
      };
  await putEntry(entry);
  notify();
  return { ok: true, id: entry.id };
}

/** Queue a submit. `submittedAt` is the ENQUEUE-time client clock (R30) — the
 *  drain clamps it and the server stamps submit_received_at independently. */
export async function enqueueSubmit(p: { studentId: string; taskId: string }): Promise<EnqueueResult> {
  if (!isQueueSupported()) return { ok: false, reason: "unsupported" };
  const entry: SubmitQueueEntry = {
    ...baseEntry(p.studentId, p.taskId),
    kind: "submit",
    submittedAt: nowIso(),
  };
  await putEntry(entry);
  notify();
  return { ok: true, id: entry.id };
}

/** Dismiss a tombstone / stuck entry (the student saw the note). */
export async function dismissEntry(id: string): Promise<void> {
  await deleteEntry(id);
  notify();
}

/** Manual retry of a blocked entry: clear the block and drain. */
export async function retryEntry(id: string, ctx: DrainContext): Promise<void> {
  const entry = await getEntry(id);
  if (!entry) return;
  await putEntry({ ...entry, blocked: null, attempts: 0 });
  notify();
  await drainQueue(ctx);
}

// ── drain ─────────────────────────────────────────────────────────────────────

export type DrainContext = {
  /** Student profiles this session may act on (self, or a parent's children). */
  actableStudentIds: readonly string[];
  onEntryProgress?: (id: string, pct: number) => void;
};

type ExecResult = "resolved" | "pending" | "auth";

async function persist(entry: QueueEntry): Promise<void> {
  await putEntry(entry);
  notify();
}

/** Apply an interpretAttachFailure outcome to an entry. */
async function applyAttachFailure(
  entry: QueueEntry,
  reason: string
): Promise<ExecResult> {
  const failure = interpretAttachFailure(entry.kind, reason);
  switch (failure.outcome) {
    case "auth":
      return "auth";
    case "retry":
      await persist({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso() });
      return "pending";
    case "drop":
      // A tombstone, not a silent delete — SyncStatus surfaces the note until
      // the student dismisses it.
      await persist({ ...entry, blocked: { reason: "dropped", note: failure.note } });
      return "pending";
    case "done_with_note":
      await persist({ ...entry, blocked: { reason: "noted", note: failure.note } });
      return "pending";
    case "blocked":
      await persist({ ...entry, blocked: { reason, note: failure.note } });
      return "pending";
  }
}

function toStoredSlot(
  slot:
    | { strategy: "plain"; bucket: string; objectPath: string; token: string }
    | { strategy: "tus"; bucket: string; objectPath: string; token: string; endpoint: string; chunkSize: number; tusMintedAt: string }
): StoredSlot {
  return slot.strategy === "plain"
    ? { strategy: "plain", bucket: slot.bucket, objectPath: slot.objectPath, token: slot.token, mintedAt: nowIso() }
    : {
        strategy: "tus",
        bucket: slot.bucket,
        objectPath: slot.objectPath,
        token: slot.token,
        endpoint: slot.endpoint,
        chunkSize: slot.chunkSize,
        mintedAt: slot.tusMintedAt,
      };
}

async function execMedia(entry: MediaQueueEntry, ctx: DrainContext): Promise<ExecResult> {
  let current = entry;
  // Bounded walk: mint → upload → (poster) → confirm is at most a handful of
  // steps; the guard keeps a surprising loop from spinning a phone's battery.
  for (let step = 0; step < 8; step++) {
    const next = nextMediaStep(current, Date.now());

    if (next.step === "mint") {
      if (next.reset) {
        // TUS URL past 24h — restart from zero (never resume into a 404).
        current = { ...current, tus: null, uploaded: false, uploadedBytes: 0 };
      }
      let slot;
      try {
        slot = await requestUploadSlot({
          studentId: current.studentId,
          taskId: current.taskId,
          evidenceId: current.evidenceId,
          sha256: current.sha256,
          ext: extensionFor(current.fileName, current.mime),
          contentType: current.mime,
          sizeBytes: current.bytes,
          ...(current.durationSeconds !== undefined ? { durationSeconds: current.durationSeconds } : {}),
        });
      } catch (e) {
        if (isNextRedirect(e)) return "auth";
        await persist({ ...current, attempts: current.attempts + 1, lastAttemptAt: nowIso() });
        return "pending";
      }
      if (!slot.ok) return applyAttachFailure(current, slot.reason);
      current = { ...current, slot: toStoredSlot(slot) };
      await persist(current);
      continue;
    }

    if (next.step === "upload") {
      const slot = current.slot;
      if (!slot) continue; // impossible (nextMediaStep minted first) — re-plan
      let persistedBytes = current.uploadedBytes;
      const result = await uploadWithSlot({
        slot:
          slot.strategy === "plain"
            ? { strategy: "plain", bucket: slot.bucket, objectPath: slot.objectPath, token: slot.token }
            : {
                strategy: "tus",
                bucket: slot.bucket,
                objectPath: slot.objectPath,
                token: slot.token,
                endpoint: slot.endpoint ?? "",
                chunkSize: slot.chunkSize ?? 6 * 1024 * 1024,
              },
        file: current.file,
        contentType: current.mime,
        resumeUrl: next.resumeUrl,
        onTusUrl: (url) => {
          current = { ...current, tus: { url, createdAt: nowIso() } };
          void putEntry(current);
        },
        onProgress: (pct, uploadedBytes) => {
          ctx.onEntryProgress?.(current.id, pct);
          // Persist resume progress at most every ~6 MB — an IDB write per
          // chunk, not per XHR progress tick.
          if (uploadedBytes - persistedBytes >= 6 * 1024 * 1024) {
            persistedBytes = uploadedBytes;
            current = { ...current, uploadedBytes };
            void putEntry(current);
          }
        },
      });
      if (result.outcome === "success") {
        current = applyUploadOutcome(current, "success");
        await persist(current);
        continue;
      }
      current = applyUploadOutcome(current, "retry");
      await persist({ ...current, lastAttemptAt: nowIso() });
      return "pending";
    }

    if (next.step === "poster") {
      // Best-effort, exactly one attempt per drain: a poster hiccup must never
      // block the clip's confirm.
      const poster = current.poster;
      if (poster) {
        try {
          const slot = await requestUploadSlot({
            studentId: current.studentId,
            taskId: current.taskId,
            evidenceId: current.evidenceId,
            sha256: poster.sha256,
            ext: "jpg",
            contentType: "image/jpeg",
            sizeBytes: poster.blob.size,
          });
          if (slot.ok) {
            const up = await uploadWithSlot({
              slot:
                slot.strategy === "plain"
                  ? { strategy: "plain", bucket: slot.bucket, objectPath: slot.objectPath, token: slot.token }
                  : {
                      strategy: "tus",
                      bucket: slot.bucket,
                      objectPath: slot.objectPath,
                      token: slot.token,
                      endpoint: slot.endpoint,
                      chunkSize: slot.chunkSize,
                    },
              file: poster.blob,
              contentType: "image/jpeg",
            });
            if (up.outcome === "success") {
              current = {
                ...current,
                poster: { ...poster, uploaded: true, attempted: true, objectPath: slot.objectPath },
              };
              await persist(current);
              continue;
            }
          }
        } catch (e) {
          if (isNextRedirect(e)) return "auth";
          console.error(`[path/sync] poster upload failed for ${current.id} (non-fatal):`, e);
        }
        current = { ...current, poster: { ...poster, attempted: true } };
        await persist(current);
      }
      continue;
    }

    // confirm
    const slot = current.slot;
    if (!slot) continue; // impossible — uploaded implies a slot existed
    let confirm;
    try {
      confirm = await confirmUploadedEvidence({
        studentId: current.studentId,
        taskId: current.taskId,
        ...buildConfirmParams({ ...current, slot }, Date.now()),
      });
    } catch (e) {
      if (isNextRedirect(e)) return "auth";
      await persist({ ...current, attempts: current.attempts + 1, lastAttemptAt: nowIso() });
      return "pending";
    }
    if (confirm.ok) {
      // Effect landed (idempotent by evidenceId) — NOW record it by deleting.
      await deleteEntry(current.id);
      notify();
      return "resolved";
    }
    return applyAttachFailure(current, confirm.reason);
  }
  return "pending";
}

async function execLink(entry: LinkQueueEntry): Promise<ExecResult> {
  let result;
  try {
    result = await addLinkEvidence({
      studentId: entry.studentId,
      taskId: entry.taskId,
      evidenceId: entry.evidenceId,
      url: entry.url,
      ...(entry.caption !== undefined ? { caption: entry.caption } : {}),
    });
  } catch (e) {
    if (isNextRedirect(e)) return "auth";
    await persist({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso() });
    return "pending";
  }
  if (result.ok) {
    await deleteEntry(entry.id);
    notify();
    return "resolved";
  }
  return applyAttachFailure(entry, result.reason);
}

async function execLog(entry: LogQueueEntry): Promise<ExecResult> {
  let result;
  try {
    result = await saveLogEvidence({
      studentId: entry.studentId,
      taskId: entry.taskId,
      evidenceId: entry.evidenceId,
      rows: entry.rows,
      ...(entry.caption !== undefined ? { caption: entry.caption } : {}),
    });
  } catch (e) {
    if (isNextRedirect(e)) return "auth";
    await persist({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso() });
    return "pending";
  }
  if (result.ok) {
    await deleteEntry(entry.id);
    notify();
    return "resolved";
  }
  return applyAttachFailure(entry, result.reason);
}

async function execSubmit(entry: SubmitQueueEntry): Promise<ExecResult> {
  // THE REBASE (Decision 10): read the task's CURRENT server state — never the
  // state the client remembered when it queued the submit.
  let stateRes;
  try {
    stateRes = await getTaskState({ taskId: entry.taskId, studentId: entry.studentId });
  } catch (e) {
    if (isNextRedirect(e)) return "auth";
    await persist({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso() });
    return "pending";
  }

  const plan = stateRes.ok
    ? planSubmitTransitions(stateRes.data.state)
    : stateRes.reason === "not_found"
      ? planSubmitTransitions(null)
      : null;
  if (plan === null) {
    // unavailable/invalid — transient; try again on the next signal.
    await persist({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso() });
    return "pending";
  }

  switch (plan.kind) {
    case "done":
      // Verified/submitted while away — quietly done. The celebration event
      // replays in-app on next open (Unit 16 renders it); never an error here.
      await deleteEntry(entry.id);
      notify();
      return "resolved";
    case "refused":
    case "drop":
      await persist({
        ...entry,
        blocked: { reason: plan.kind === "drop" ? "dropped" : "phase_locked", note: plan.note },
      });
      return "pending";
    case "chain": {
      const { submittedAt } = buildSubmitParams(entry, Date.now());
      for (const transition of plan.transitions) {
        let result;
        try {
          result = await applyTransition({
            studentId: entry.studentId,
            taskId: entry.taskId,
            transition,
            ...(transition === "submit" ? { submittedAt } : {}),
          });
        } catch (e) {
          if (isNextRedirect(e)) return "auth";
          await persist({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso() });
          return "pending";
        }
        if (!result.ok) {
          const refusal = interpretSubmitRefusal(result.reason);
          switch (refusal.outcome) {
            case "auth":
              return "auth";
            case "retry":
              await persist({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: nowIso() });
              return "pending";
            case "done_with_note":
              await persist({ ...entry, blocked: { reason: "noted", note: refusal.note } });
              return "pending";
            case "blocked":
              await persist({ ...entry, blocked: { reason: result.reason, note: refusal.note } });
              return "pending";
          }
        }
        // ok — including byCaller:false (lost echo re-read / concurrent winner):
        // resolveSubmitResult says done either way, never a re-apply.
      }
      await deleteEntry(entry.id);
      notify();
      return "resolved";
    }
  }
}

async function execEntry(entry: QueueEntry, ctx: DrainContext): Promise<{ result: ExecResult; attachedTask: string | null }> {
  switch (entry.kind) {
    case "media": {
      const result = await execMedia(entry, ctx);
      return { result, attachedTask: result === "resolved" ? entry.taskId : null };
    }
    case "link": {
      const result = await execLink(entry);
      return { result, attachedTask: result === "resolved" ? entry.taskId : null };
    }
    case "log": {
      const result = await execLog(entry);
      return { result, attachedTask: result === "resolved" ? entry.taskId : null };
    }
    case "submit":
      return { result: await execSubmit(entry), attachedTask: null };
  }
}

/**
 * After attaches with NO queued submit for the task, run the capture
 * choreography (the state diagram's "opened / evidence added") so the task's
 * state doesn't lag its evidence. Advisory: failures are logged, never block.
 */
async function runCaptureChoreography(taskIds: Set<string>, studentIdByTask: Map<string, string>): Promise<void> {
  for (const taskId of taskIds) {
    const studentId = studentIdByTask.get(taskId);
    if (!studentId) continue;
    try {
      const stateRes = await getTaskState({ taskId, studentId });
      if (!stateRes.ok) continue;
      for (const transition of transitionsAfterCapture(stateRes.data.state)) {
        await applyTransition({ studentId, taskId, transition });
      }
    } catch (e) {
      console.error(`[path/sync] capture choreography failed for ${taskId} (advisory):`, e);
    }
  }
}

/**
 * Drain the queue once: plan → execute → re-plan (a resolved capture can free
 * a held submit) until nothing new is runnable. Single-flight across tabs.
 */
export async function drainQueue(ctx: DrainContext): Promise<void> {
  if (!isQueueSupported()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const run = async () => {
    authRequired = false;
    const executed = new Set<string>();
    const attachedTasks = new Set<string>();
    const studentIdByTask = new Map<string, string>();

    // Re-plan after each pass: resolving a media entry can free a held submit.
    for (let pass = 0; pass < 6; pass++) {
      const entries = selectDrainable(await listEntries(), ctx.actableStudentIds);
      const plan = planDrain(entries);
      const ids = plan.runnable.filter((id) => !executed.has(id));
      if (ids.length === 0) break;

      for (const id of ids) {
        const entry = entries.find((e) => e.id === id);
        if (!entry) continue;
        executed.add(id);
        const { result, attachedTask } = await execEntry(entry, ctx);
        if (attachedTask) {
          attachedTasks.add(attachedTask);
          studentIdByTask.set(attachedTask, entry.studentId);
        }
        if (result === "auth") {
          authRequired = true;
          notify();
          return;
        }
      }
    }

    // Choreograph only tasks with no submit still queued (a queued submit's own
    // chain opens/resumes the task itself).
    const remaining = await listEntries();
    const withQueuedSubmit = new Set(remaining.filter((e) => e.kind === "submit").map((e) => e.taskId));
    const toChoreograph = new Set([...attachedTasks].filter((t) => !withQueuedSubmit.has(t)));
    await runCaptureChoreography(toChoreograph, studentIdByTask);
  };

  // Single-drainer across tabs (two TUS clients on one URL → 409).
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    await navigator.locks.request("path-offline-drain", { ifAvailable: true }, async (lock) => {
      if (lock) await run();
    });
    return;
  }
  if (fallbackDrainActive) return;
  fallbackDrainActive = true;
  try {
    await run();
  } finally {
    fallbackDrainActive = false;
  }
}

// ── foreground signals ────────────────────────────────────────────────────────

/**
 * Wire the drain to its foreground signals. Returns a cleanup. Mounted once
 * per /path app session (PathPwa); Background Sync — where it exists — only
 * posts "path-drain" back to the page, which lands here too.
 */
export function startSyncEngine(ctx: DrainContext): () => void {
  const kick = () => void drainQueue(ctx).catch((e) => console.error("[path/sync] drain failed:", e));

  kick(); // the load signal

  const onOnline = () => kick();
  const onVisibility = () => {
    if (document.visibilityState === "visible") kick();
  };
  const onSwMessage = (event: MessageEvent) => {
    if (event.data === "path-drain") kick();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);
  navigator.serviceWorker?.addEventListener("message", onSwMessage);

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker?.removeEventListener("message", onSwMessage);
  };
}
