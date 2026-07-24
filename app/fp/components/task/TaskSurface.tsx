"use client";

/**
 * The task spec sheet + capture/submit surface (T1 Unit 14) — the first route
 * the Unit 9/10 capture stack has ever mounted. Ported from handoff surfaces
 * 08 (HQ Current Task) and the Loop's Trail step card; both skins render the
 * same mechanics with different pixels and words (design rule D4).
 *
 * The load-bearing behaviors, each one a plan requirement:
 *   - MUTABILITY REGIMES drive everything: `editable` captures; the
 *     `locked_submitted` regime renders the evidence-locked line WITH the
 *     withdraw affordance (legal while reviewOpenedAt is null, D6 — the regime
 *     with no rendering anywhere else); `locked_review` drops withdraw;
 *     `append_only` allows additions (flagged server-side) and never
 *     delete/edit.
 *   - EVERY awaited action runs inside try/catch/finally (the auth guard can
 *     redirect() — a throw outside the action body — and a missing finally
 *     freezes the surface; docs/solutions/ui-bugs/server-action-rejection…).
 *   - REFUSALS differentiate: retryable (unavailable/rate-limited) vs refresh
 *     (superseded/diverged — never "you did it" when someone else did) vs
 *     terminal (quota/forbidden/caps), via `classifyActionFailure`.
 *   - `open` fires on the first evidence action from `available` (the state
 *     diagram's "opened / evidence added"), `resume` from `not_yet`.
 *   - SyncStatus is Unit 11's seam — deliberately NOT invented here.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/app/fp/components/system/cn";
import { Icon } from "@/app/fp/components/system/Icon";
import { StatusChip } from "@/app/fp/components/system/StatusChip";
import { phaseColor, phaseColorAlpha } from "@/app/fp/components/system/phases";
import { EvidenceList, type EvidenceItemView } from "@/app/fp/components/EvidenceList";
import { EvidenceUploader } from "@/app/fp/components/EvidenceUploader";
import { NotYetPanel } from "@/app/fp/components/NotYetPanel";
import { VideoCapture, type CapturedVideo } from "@/app/fp/components/VideoCapture";
import { LogTable } from "@/app/fp/components/LogTable";
import { EmptyEvidence } from "@/app/fp/components/EmptyStates";
import { scheduleCoalescedRefresh, SyncStatus } from "@/app/fp/components/SyncStatus";
import { probeVideoDuration, uploadEvidenceFile, type SlotRefusal } from "@/app/fp/lib/upload-client";
import { getEntry, isQueueSupported } from "@/app/fp/lib/offline-queue";
import {
  drainQueue,
  enqueueLink,
  enqueueLog,
  enqueueMediaCapture,
  enqueueSubmit,
  type DrainContext,
} from "@/app/fp/lib/sync-engine";
import { isSafeHttpUrl } from "@/app/fp/lib/evidence-rules";
import { isNextRedirect } from "@/app/fp/lib/next-redirect";
import {
  addLinkEvidence,
  confirmUploadedEvidence,
  deleteEvidence,
  editEvidenceCaption,
} from "@/app/fp/lib/actions/evidence";
import { applyTransition } from "@/app/fp/lib/actions/transition";
import { clearNowPin, pinNowTask } from "@/app/fp/lib/actions/pin";
import type { EvidenceSpec } from "@/app/fp/content/evidence-spec";
import { SAFETY_COPY, type SafetyFlag } from "@/app/fp/content/safety-flags";
import type { Band, PhaseKey } from "@/app/fp/content/types";
import {
  classifyActionFailure,
  transitionsAfterCapture,
  transitionsBeforeSubmit,
  type MutabilityRegime,
} from "@/app/fp/lib/now-card-rules";
import type { Skin } from "@/app/fp/lib/skin-tokens";
import type { TaskState } from "@/app/fp/lib/transition-table";

const BAND_LABEL: Record<Band, string> = {
  g3_5: "Grades 3–5",
  g6_8: "Grades 6–8",
  g9_12: "Grades 9–12",
};

export type TaskSurfaceProps = {
  skin: Skin;
  studentId: string;
  taskId: string;
  criterionId: string;
  phaseKey: PhaseKey;
  title: string;
  body: string;
  doneWhen: string;
  variant: string | null;
  allBandsNote: string | null;
  seq: number;
  taskTotal: number;
  state: TaskState;
  mutability: MutabilityRegime;
  band: Band;
  liveMoment: boolean;
  safetyFlags: readonly SafetyFlag[];
  evidenceSpec: EvidenceSpec | null;
  hasLogTemplate: boolean;
  decision: { kind: "verified" | "not_yet"; note: string } | null;
  evidence: EvidenceItemView[];
  pinned: boolean;
};

type Notice = { tone: "info" | "amber" | "error"; text: string };

/** The confirm call's client-held params — kept when a confirm fails after the
 *  bytes landed, so "Finish saving" can retry without re-uploading. */
type ConfirmParams = {
  evidenceId: string;
  objectPath: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  posterObjectPath?: string;
  durationSeconds?: number;
  capturedAt: string;
};

/** A never-firing subscription for capability snapshots (useSyncExternalStore
 *  wants one; browser capability never changes within a session). */
const noSubscription = () => () => {};

export function TaskSurface(props: TaskSurfaceProps) {
  const {
    skin,
    studentId,
    taskId,
    criterionId,
    phaseKey,
    state,
    mutability,
    band,
    evidence,
    pinned,
  } = props;
  const router = useRouter();
  const trail = skin === "trail";
  const color = phaseColor(phaseKey);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [captionDraft, setCaptionDraft] = useState<{ id: string; text: string } | null>(null);
  /** LEGACY-mode only (no IndexedDB): the in-memory confirm-retry params. The
   *  durable queue replaced this for every queue-supported browser (Unit 11). */
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmParams | null>(null);
  /** Whether the durable capture queue exists in this browser (Unit 11).
   *  A capability snapshot: false during SSR/hydration (server snapshot), the
   *  real answer on the client — no setState-in-effect, no hydration drift. */
  const queueSupported = useSyncExternalStore(noSubscription, isQueueSupported, () => false);
  const mountedRef = useRef(true);
  const videoUploadRef = useRef<import("tus-js-client").Upload | null>(null);
  // A fresh log's evidence identity, stable across edits until it lands.
  const [draftLogId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      videoUploadRef.current?.abort().catch(() => {});
      videoUploadRef.current = null;
    };
  }, []);

  const editable = mutability === "editable";
  const captureAllowed = editable || mutability === "append_only";
  const evidenceMutable = editable; // delete/caption-edit; append_only freezes them

  const failureNotice = useCallback(
    (reason: string): Notice => {
      switch (classifyActionFailure(reason)) {
        case "login":
          return { tone: "amber", text: "Your sign-in expired — please sign in again." };
        case "retryable":
          return { tone: "amber", text: "That didn't go through — a temporary hiccup. Try again." };
        case "refresh":
          return { tone: "info", text: "This task just changed elsewhere — refreshing to the latest." };
        default: {
          const map: Record<string, string> = {
            quota_exceeded: "Storage is full for this year — add big items as links instead.",
            link_overflow: "That file is too big to store — add it as a link instead.",
            append_only: "This task is verified — its evidence is part of the record and can't change.",
            append_only_latched: "This task is verified — its evidence is part of the record and can't change.",
            review_already_opened: "The review has already started, so it can't be withdrawn now.",
            forbidden: "You can't do that on this task.",
            gate_closed: "Submitting is paused right now.",
            display_blocked: "An earlier step reopened — finish it first.",
            note_required: "A note is required for that.",
          };
          return { tone: "error", text: map[reason] ?? "That didn't work. Please try again." };
        }
      }
    },
    []
  );

  const handleFailure = useCallback(
    (reason: string) => {
      const n = failureNotice(reason);
      setNotice(n);
      if (classifyActionFailure(reason) === "login") router.push("/fp/sign-in");
      if (classifyActionFailure(reason) === "refresh") router.refresh();
    },
    [failureNotice, router]
  );

  /**
   * EVERY async flow runs through here (Unit 14 review consolidation): one
   * busy key held for the flow's WHOLE lifetime (upload → confirm → transition
   * → refresh — the julik review found the confirm chain and log-save escaping
   * the gate), the notice cleared at start, the auth guard's NEXT_REDIRECT
   * throw routed to sign-in instead of a doomed "try again" (reliability
   * review), and busy always cleared in finally.
   */
  const runGuarded = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusy(key);
      setNotice(null);
      try {
        await fn();
      } catch (e) {
        if (isNextRedirect(e)) {
          router.push("/fp/sign-in");
          return;
        }
        if (mountedRef.current) setNotice({ tone: "error", text: "Something went wrong. Please try again." });
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [router]
  );

  /** Run one transition; returns true when the task is at the target. Throws
   *  are handled by the enclosing runGuarded. */
  const runTransition = useCallback(
    async (transition: "open" | "submit" | "withdraw" | "resume"): Promise<boolean> => {
      const result = await applyTransition({ studentId, taskId, transition });
      if (!mountedRef.current) return false;
      if (result.ok) {
        if (!result.byCaller) {
          // Superseded — the task reached this state, but not through this
          // tap (another tab, a queued sync, or an adult acting first). The
          // goal holds; never claim "you did it" (Unit 12 → 16 carry: the
          // richer copy names WHAT happened, register-true).
          setNotice({
            tone: "info",
            text: result.winner?.verifiedBy
              ? skin === "trail"
                ? "A grown-up already stamped this one — the moment is waiting in Your news!"
                : "Already verified — the verification is in your notifications."
              : skin === "trail"
                ? "Already done — this step had just been moved along somewhere else (maybe another tab)."
                : "Already done — this had just been handled elsewhere (another tab or a queued sync).",
          });
        }
        return true;
      }
      handleFailure(result.reason);
      return false;
    },
    [studentId, taskId, skin, handleFailure]
  );

  /** After a successful capture: the tested choreography rule (the state
   *  diagram's "opened / evidence added"). */
  const touchStateAfterCapture = useCallback(async () => {
    for (const transition of transitionsAfterCapture(state)) {
      await runTransition(transition);
    }
  }, [state, runTransition]);

  /** Queue the submit for the next foreground signal (Unit 11 — R30: the
   *  client submit time is recorded NOW, at intent, not at drain). */
  const queueSubmit = useCallback(async () => {
    const enqueued = await enqueueSubmit({ studentId, taskId });
    if (!mountedRef.current) return;
    if (enqueued.ok) {
      setNotice({
        tone: "info",
        text: trail
          ? "Your satchel's packed! It'll send for review the moment you're back online."
          : "Saved — your submit will send the moment you're back online.",
      });
    } else {
      setNotice({ tone: "amber", text: "You're offline and this browser can't save the submit — try again when you're connected." });
    }
  }, [studentId, taskId, trail]);

  const submit = useCallback(
    () =>
      runGuarded("submit", async () => {
        // Known-offline: queue immediately (the transition chain is re-derived
        // from real server state at drain — the rebase, Decision 10).
        if (queueSupported && navigator.onLine === false) {
          await queueSubmit();
          return;
        }
        try {
          // submit runs from in_progress; chain the state there first when needed.
          for (const transition of transitionsBeforeSubmit(state)) {
            if (!(await runTransition(transition))) return;
          }
          if (await runTransition("submit")) {
            setNotice({ tone: "info", text: trail ? "Your satchel's in!" : "Submitted for review." });
            if (mountedRef.current) router.refresh();
          }
        } catch (e) {
          // A mid-flight network drop (navigator.onLine lied, as it does):
          // queue the intent instead of losing it. Auth redirects propagate to
          // runGuarded, which routes to sign-in.
          if (isNextRedirect(e) || !queueSupported) throw e;
          await queueSubmit();
        }
      }),
    [state, queueSupported, queueSubmit, runGuarded, runTransition, router, trail]
  );

  const withdraw = useCallback(
    () =>
      runGuarded("withdraw", async () => {
        if (await runTransition("withdraw")) {
          setNotice({ tone: "info", text: "Withdrawn — add what you need, then send it back." });
          if (mountedRef.current) router.refresh();
        }
      }),
    [runGuarded, runTransition, router]
  );

  const togglePin = useCallback(
    () =>
      runGuarded("pin", async () => {
        const result = pinned ? await clearNowPin() : await pinNowTask({ taskId });
        if (!mountedRef.current) return;
        if (result.ok) router.refresh();
        else handleFailure(result.reason);
      }),
    [pinned, taskId, runGuarded, router, handleFailure]
  );

  /**
   * Confirm an uploaded object into an evidence row. The bytes are ALREADY
   * durably stored when this runs, so a failed confirm keeps the params in
   * `pendingConfirm` and offers an explicit "Finish saving" retry — never the
   * false promise that it "will finish next time this page loads" (nothing
   * reconciles on load; the 48h reaper would delete the orphan — reliability
   * review). The retry re-confirms the SAME object; no bytes are re-uploaded.
   */
  const confirmUpload = useCallback(
    (p: ConfirmParams) =>
      runGuarded("confirm", async () => {
        try {
          const result = await confirmUploadedEvidence({ studentId, taskId, ...p });
          if (!mountedRef.current) return;
          if (result.ok) {
            setPendingConfirm(null);
            if (result.hashDuplicateOf) {
              setNotice({ tone: "info", text: "Saved — heads up, it looks identical to something already filed." });
            }
            await touchStateAfterCapture();
            if (mountedRef.current) router.refresh();
          } else if (classifyActionFailure(result.reason) === "retryable") {
            setPendingConfirm(p);
            setNotice({
              tone: "amber",
              text: "The file is uploaded but not saved to this step yet — tap “Finish saving” to try again.",
            });
          } else {
            setPendingConfirm(null);
            handleFailure(result.reason);
          }
        } catch (e) {
          if (isNextRedirect(e)) throw e; // runGuarded routes it to sign-in
          if (mountedRef.current) {
            setPendingConfirm(p);
            setNotice({
              tone: "amber",
              text: "The file is uploaded but not saved to this step yet — tap “Finish saving” to try again.",
            });
          }
        }
      }),
    [studentId, taskId, runGuarded, touchStateAfterCapture, router, handleFailure]
  );

  const onSlotRefused = useCallback(
    (refusal: SlotRefusal) => {
      if (refusal.reason === "rate_limited") {
        setNotice({ tone: "amber", text: "Too many uploads at once — wait a moment and try again." });
        return;
      }
      handleFailure(refusal.reason);
    },
    [handleFailure]
  );

  // ── the DURABLE capture path (Unit 11) ─────────────────────────────────────
  // Every capture writes an IndexedDB queue entry BEFORE any network I/O, then
  // drains immediately — online, that IS the upload; offline (or on a killed
  // tab) the entry survives and the sync engine finishes it on the next
  // foreground signal. SyncStatus (mounted below) renders whatever remains.

  const drainCtx = useCallback(
    (): DrainContext => ({
      actableStudentIds: [studentId],
      onEntryProgress: (_id, pct) => {
        if (mountedRef.current) setUploadProgress(pct);
      },
    }),
    [studentId]
  );

  /** Drain now; report whether the given entry fully landed. `wait: true` —
   *  a user-waited-on save queues behind an in-flight background drain rather
   *  than silently losing the lock race and lying "you're offline". */
  const drainAndSettle = useCallback(
    async (entryId: string): Promise<"resolved" | "queued"> => {
      setUploadProgress(0);
      try {
        await drainQueue(drainCtx(), { wait: true });
      } finally {
        if (mountedRef.current) setUploadProgress(null);
      }
      const remaining = await getEntry(entryId);
      if (!remaining) {
        // Coalesced: SyncStatus's queue-cleared refresh can land in the same
        // beat — one RSC refetch serves both (julik review).
        if (mountedRef.current) scheduleCoalescedRefresh(() => router.refresh());
        return "resolved";
      }
      // Still queued: offline (pending — reassure) or blocked (SyncStatus
      // already shows the note; no duplicate banner).
      if (!remaining.blocked && mountedRef.current) {
        setNotice({
          tone: "info",
          text: "Saved on this device — it'll send the moment you're back online.",
        });
      }
      return "queued";
    },
    [drainCtx, router]
  );

  const durableCapture = useCallback(
    async (p: {
      file: Blob;
      fileName: string;
      poster?: Blob | null;
      durationSeconds?: number;
    }): Promise<"done" | "fallback"> => {
      const enqueued = await enqueueMediaCapture({
        studentId,
        taskId,
        file: p.file,
        fileName: p.fileName,
        poster: p.poster ?? null,
        ...(p.durationSeconds !== undefined ? { durationSeconds: p.durationSeconds } : {}),
      });
      if (!enqueued.ok) {
        if (enqueued.reason === "unsupported") return "fallback";
        if (enqueued.reason === "storage_failed") {
          // IndexedDB couldn't hold the Blob (device storage pressure). The
          // bytes are NOT durably saved — online, fall back to the direct
          // upload so they still land; offline, say exactly what happened
          // (reliability review: never the generic "try again").
          if (navigator.onLine !== false) return "fallback";
          setNotice({
            tone: "error",
            text: "This device can't save that right now — its storage looks full. Free up some space and capture it again.",
          });
          return "done";
        }
        handleFailure("link_overflow"); // refused at capture — never queued (D21)
        return "done";
      }
      await drainAndSettle(enqueued.id);
      return "done";
    },
    [studentId, taskId, drainAndSettle, handleFailure]
  );

  /** LEGACY direct upload (no IndexedDB): Unit 9/14's in-session flow, with the
   *  in-memory pendingConfirm as its only upload-then-die affordance. */
  const legacyDirectUpload = useCallback(
    async (file: File) => {
      const uploaded = await uploadEvidenceFile({
        studentId,
        taskId,
        file,
        fileName: file.name,
        isMounted: () => mountedRef.current,
        onProgress: (pct) => {
          if (mountedRef.current) setUploadProgress(pct);
        },
        registerUpload: (u) => {
          videoUploadRef.current = u;
        },
      });
      if (!mountedRef.current) return;
      if (!uploaded.ok) {
        if (uploaded.kind === "refused") onSlotRefused(uploaded.refusal);
        else setNotice({ tone: "amber", text: uploaded.message });
        return;
      }
      await confirmUpload({
        evidenceId: uploaded.uploaded.evidenceId,
        objectPath: uploaded.uploaded.objectPath,
        sha256: uploaded.uploaded.sha256,
        sizeBytes: uploaded.uploaded.sizeBytes,
        contentType: uploaded.uploaded.contentType,
        capturedAt: new Date().toISOString(),
      });
    },
    [studentId, taskId, confirmUpload, onSlotRefused]
  );

  const onFilePicked = useCallback(
    (file: File) =>
      runGuarded("upload", async () => {
        setUploadProgress(0);
        try {
          const durationSeconds = file.type.startsWith("video/")
            ? await probeVideoDuration(file)
            : undefined;
          const outcome = await durableCapture({
            file,
            fileName: file.name,
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
          });
          if (outcome === "fallback") await legacyDirectUpload(file);
        } finally {
          if (mountedRef.current) setUploadProgress(null);
        }
      }),
    [runGuarded, durableCapture, legacyDirectUpload]
  );

  const onVideoCaptured = useCallback(
    (captured: CapturedVideo) =>
      runGuarded("video", async () => {
        setUploadProgress(0);
        try {
          // DURABLE path (Unit 11): queue first — a recorded clip survives a
          // killed tab, and the poster rides in the same entry.
          if (queueSupported) {
            await durableCapture({
              file: captured.file,
              fileName: captured.file.name || "capture.mp4",
              poster: captured.poster ?? null,
              durationSeconds: captured.durationSeconds,
            });
            return;
          }

          // LEGACY direct path (no IndexedDB) — Unit 14's in-session flow.
          const evidenceId = crypto.randomUUID();
          const file = captured.file;
          const uploaded = await uploadEvidenceFile({
            studentId,
            taskId,
            file,
            fileName: file.name || "capture.mp4",
            evidenceId,
            durationSeconds: captured.durationSeconds,
            isMounted: () => mountedRef.current,
            onProgress: (pct) => {
              if (mountedRef.current) setUploadProgress(pct);
            },
            // Abort-on-unmount, same as the picker path (correctness review).
            registerUpload: (u) => {
              videoUploadRef.current = u;
            },
          });
          if (!mountedRef.current) return;
          if (!uploaded.ok) {
            if (uploaded.kind === "refused") onSlotRefused(uploaded.refusal);
            else setNotice({ tone: "amber", text: uploaded.message });
            return;
          }

          // The poster rides along under the SAME evidence identity. Best-effort:
          // a failed poster never blocks the clip (the list falls back gracefully).
          let posterObjectPath: string | undefined;
          if (captured.poster) {
            const poster = await uploadEvidenceFile({
              studentId,
              taskId,
              file: captured.poster,
              fileName: "poster.jpg",
              evidenceId,
              isMounted: () => mountedRef.current,
            });
            if (poster.ok) posterObjectPath = poster.uploaded.objectPath;
          }
          if (!mountedRef.current) return;

          await confirmUpload({
            evidenceId,
            objectPath: uploaded.uploaded.objectPath,
            sha256: uploaded.uploaded.sha256,
            sizeBytes: uploaded.uploaded.sizeBytes,
            contentType: uploaded.uploaded.contentType,
            posterObjectPath,
            durationSeconds: captured.durationSeconds,
            capturedAt: new Date().toISOString(),
          });
        } finally {
          if (mountedRef.current) setUploadProgress(null);
        }
      }),
    [studentId, taskId, queueSupported, durableCapture, runGuarded, confirmUpload, onSlotRefused]
  );

  const addLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) return;
    return runGuarded("link", async () => {
      // Validate BEFORE queueing (Unit 11): a bad URL must fail inline, in the
      // moment — not as a queue-attention note after an offline drain. Same
      // pure rule the server enforces.
      if (!isSafeHttpUrl(url)) {
        setNotice({ tone: "error", text: "That doesn't look like a web link — it needs to start with https://" });
        return;
      }

      // DURABLE path: enqueue + drain (online, that IS the save).
      if (queueSupported) {
        const enqueued = await enqueueLink({ studentId, taskId, url });
        if (enqueued.ok) {
          setLinkUrl("");
          await drainAndSettle(enqueued.id);
          return;
        }
        // unsupported raced off — fall through to the direct call
      }

      const result = await addLinkEvidence({
        studentId,
        taskId,
        evidenceId: crypto.randomUUID(),
        url,
      });
      if (!mountedRef.current) return;
      if (result.ok) {
        setLinkUrl("");
        await touchStateAfterCapture();
        if (mountedRef.current) router.refresh();
      } else if (result.reason === "invalid_input") {
        setNotice({ tone: "error", text: "That doesn't look like a web link — it needs to start with https://" });
      } else {
        handleFailure(result.reason);
      }
    });
  }, [linkUrl, studentId, taskId, queueSupported, drainAndSettle, runGuarded, touchStateAfterCapture, router, handleFailure]);

  const saveCaption = useCallback(() => {
    if (!captionDraft) return;
    return runGuarded("caption", async () => {
      const result = await editEvidenceCaption({
        studentId,
        evidenceId: captionDraft.id,
        caption: captionDraft.text,
      });
      if (!mountedRef.current) return;
      if (result.ok) {
        setCaptionDraft(null);
        router.refresh();
      } else {
        handleFailure(result.reason);
      }
    });
  }, [captionDraft, studentId, runGuarded, router, handleFailure]);

  const removeItem = useCallback(
    (evidenceId: string) =>
      runGuarded(`delete-${evidenceId}`, async () => {
        const result = await deleteEvidence({ studentId, evidenceId });
        if (!mountedRef.current) return;
        if (result.ok) router.refresh();
        else handleFailure(result.reason);
      }),
    [studentId, runGuarded, router, handleFailure]
  );

  /** LogTable's save runs its own action; the follow-on transition + refresh
   *  must still hold the shared busy gate (julik review). */
  const onLogSaved = useCallback(
    () =>
      runGuarded("log", async () => {
        await touchStateAfterCapture();
        if (mountedRef.current) router.refresh();
      }),
    [runGuarded, touchStateAfterCapture, router]
  );

  const ink = trail ? "text-trail-ink" : "text-hq-ink";
  const inkSoft = trail ? "text-trail-ink-soft" : "text-hq-ink-soft";
  const surface = trail ? "bg-trail-surface" : "bg-hq-canvas";
  const cardBorder = trail ? "border-trail-ink/12" : "border-hq-border";

  const logItem = evidence.find((e) => e.kind === "log" && !e.redactedAt) ?? null;
  const visibleEvidence = evidence.filter((e) => e.kind !== "log");

  return (
    <div className="pb-10">
      {/* back + header */}
      <Link
        href={`/fp/criterion/${criterionId}`}
        className={cn("mb-1 mt-2 flex items-center gap-1.5 py-2 font-path-body text-[12.5px] font-semibold", inkSoft)}
      >
        <Icon name="chevron-left" size={16} />
        {trail ? `Landmark ${criterionId}` : `Criterion ${criterionId}`}
      </Link>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className="rounded-md px-2 py-0.5 font-path-mono text-[13px] font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          {taskId}
        </span>
        {props.liveMoment && (
          <span className="flex items-center gap-1.5 rounded-full border border-wax/30 bg-wax/10 px-2.5 py-0.5 font-path-body text-[10.5px] font-bold uppercase tracking-[0.04em] text-wax">
            <Icon name="radio" size={12} />
            Live moment
          </span>
        )}
        <StatusChip state={state} />
        <button
          type="button"
          onClick={() => void togglePin()}
          disabled={busy !== null}
          className={cn("ml-auto font-path-body text-[11.5px] underline-offset-2 hover:underline", inkSoft)}
        >
          {pinned ? "Unpin from Now" : "Pin as my Now"}
        </button>
      </div>

      <h1 className={cn("font-path-display text-2xl font-semibold tracking-tight", ink)}>{props.title}</h1>
      <p className={cn("mb-4 mt-2 font-path-body text-[13.5px] leading-relaxed", inkSoft)}>{props.body}</p>

      {/* Done when — the standard the adult verifies against */}
      <div
        className="mb-3.5 rounded-r-[10px] border-l-[3px] px-3.5 py-2.5"
        style={{ borderColor: color, backgroundColor: phaseColorAlpha(phaseKey, 0.06) }}
      >
        <div className="mb-0.5 font-path-body text-[9.5px] font-bold uppercase tracking-[0.08em]" style={{ color }}>
          Done when
        </div>
        <p className={cn("font-path-body text-[13px] leading-normal", ink)}>{props.doneWhen}</p>
      </div>

      {/* the Not Yet moment — the reviewer's note BESIDE the Done-when line
          (brief §5.2; Unit 16's NotYetPanel, extracted from the Unit 14
          inline block): information, not judgement. */}
      {state === "not_yet" && props.decision?.kind === "not_yet" && (
        <NotYetPanel skin={skin} note={props.decision.note} className="mb-3.5" />
      )}

      {props.variant && (
        <div className={cn("mb-3 rounded-xl border px-3.5 py-2.5", cardBorder, surface)}>
          <div className={cn("mb-1 font-path-body text-[9.5px] font-bold uppercase tracking-[0.06em]", trail ? "text-trail-ink-soft" : "text-hq-ink-muted")}>
            Your band · {BAND_LABEL[band]}
          </div>
          <p className={cn("font-path-body text-[12.5px] leading-snug", inkSoft)}>{props.variant}</p>
        </div>
      )}

      {props.allBandsNote && (
        <p className={cn("mb-3 font-path-body text-[12px] leading-snug", inkSoft)}>
          <span className={cn("font-semibold", ink)}>All bands:</span> {props.allBandsNote}
        </p>
      )}

      {props.safetyFlags.length > 0 && (
        <div
          className="mb-4 flex gap-2.5 rounded-xl border px-3.5 py-2.5"
          style={{
            borderColor: phaseColorAlpha(phaseKey, 0.2),
            backgroundColor: phaseColorAlpha(phaseKey, 0.06),
          }}
        >
          <span style={{ color }} className="mt-0.5 flex-shrink-0">
            <Icon name="shield-check" size={17} />
          </span>
          <p className={cn("font-path-body text-[11.5px] leading-snug", inkSoft)}>
            <b className={ink}>Safety:</b> {props.safetyFlags.map((f) => SAFETY_COPY[f]).join(" ")}
          </p>
        </div>
      )}

      {state === "verified" && (
        <div className="mb-4 rounded-[13px] border-[1.5px] border-verified/25 bg-verified/10 px-3.5 py-3">
          <div className="mb-1 font-path-body text-[10px] font-bold uppercase tracking-[0.06em] text-verified">
            {trail ? "Stamped" : "Verified"}
          </div>
          {props.decision?.kind === "verified" ? (
            <p className={cn("font-path-body text-[13px] italic leading-snug", ink)}>
              &ldquo;{props.decision.note}&rdquo;
            </p>
          ) : (
            <p className={cn("font-path-body text-[12.5px]", inkSoft)}>
              {trail ? "This step is stamped. It's part of your record now." : "Verified — part of the permanent record."}
            </p>
          )}
        </div>
      )}

      {/* evidence checklist — the spec where authored, the Done-when line as the standard where not */}
      <div className={cn("mb-2.5 font-path-mono text-[11px] font-bold uppercase tracking-[0.08em]", trail ? "text-trail-ink-soft" : "text-hq-ink-muted")}>
        Evidence to capture
      </div>
      {props.evidenceSpec ? (
        <div className="mb-4 flex flex-col gap-2">
          {props.evidenceSpec.required.map((kind) => (
            <div key={kind} className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2.5", cardBorder, surface)}>
              <span className={cn("h-5 w-5 flex-shrink-0 rounded-full border-2", trail ? "border-trail-mist" : "border-hq-border-strong")} aria-hidden />
              <span className={cn("flex-1 font-path-body text-[12.5px] capitalize", ink)}>
                {kind.replace("_", " ")}
              </span>
              <span className="rounded-full bg-not-yet/12 px-2 py-0.5 font-path-body text-[10px] font-semibold text-not-yet">
                required
              </span>
            </div>
          ))}
          {props.evidenceSpec.note && (
            <p className={cn("font-path-body text-[11.5px]", inkSoft)}>{props.evidenceSpec.note}</p>
          )}
        </div>
      ) : (
        <p className={cn("mb-4 font-path-body text-[12px] leading-snug", inkSoft)}>
          The <b className={ink}>Done when</b> line above is the standard — capture whatever proves it.
        </p>
      )}

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "mb-4 rounded-xl border px-3.5 py-2.5 font-path-body text-[12.5px]",
            notice.tone === "info" && "border-verified/25 bg-verified/8 text-verified",
            notice.tone === "amber" && "border-not-yet/30 bg-not-yet/10 text-not-yet",
            notice.tone === "error" && cn(cardBorder, surface, ink)
          )}
        >
          {notice.text}
          {pendingConfirm && (
            <button
              type="button"
              onClick={() => void confirmUpload(pendingConfirm)}
              disabled={busy !== null}
              className="ml-2 font-semibold underline underline-offset-2 disabled:opacity-50"
            >
              {busy === "confirm" ? "Saving…" : "Finish saving"}
            </button>
          )}
        </div>
      )}

      {/* the durable queue, made visible (Unit 11's seam, now filled): queued
          items, offline reassurance, stuck-item retry/dismiss. Rendered in
          every regime — a submitted task can still hold queued evidence. */}
      <SyncStatus studentId={studentId} taskId={taskId} skin={skin} />

      {/* state-driven action area */}
      {mutability === "locked" && (
        <div className={cn("mb-4 rounded-xl border-2 border-dashed p-4 text-center", trail ? "border-trail-mist" : "border-hq-border")}>
          <p className={cn("font-path-body text-sm", inkSoft)}>
            {trail ? "This step is still ahead — finish the earlier one first." : "Locked — the earlier task in this criterion comes first."}
          </p>
        </div>
      )}

      {mutability === "locked_submitted" && (
        <div className="mb-4">
          <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-awaiting/25 bg-awaiting/8 p-3.5">
            <span className="animate-shimmer flex-shrink-0 text-awaiting">
              <Icon name="backpack" size={26} />
            </span>
            <div>
              <div className={cn("font-path-body text-[13.5px] font-semibold", ink)}>
                {trail ? "Your satchel's in!" : "Submitted — awaiting review."}
              </div>
              <div className={cn("font-path-body text-[12px] leading-snug", inkSoft)}>
                {trail
                  ? "It's being looked at. You'll feel the stamp the moment it's done."
                  : "Evidence is locked while it's reviewed."}
                {" "}Withdraw to add more.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void withdraw()}
            disabled={busy !== null}
            className={cn("mt-2.5 font-path-body text-[11.5px] underline underline-offset-2", inkSoft)}
          >
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw to add more"}
          </button>
        </div>
      )}

      {mutability === "locked_review" && (
        <div className="mb-4 flex items-center gap-3 rounded-[14px] border-[1.5px] border-awaiting/25 bg-awaiting/8 p-3.5">
          <span className="flex-shrink-0 text-awaiting">
            <Icon name="clock" size={22} />
          </span>
          <div>
            <div className={cn("font-path-body text-[13.5px] font-semibold", ink)}>The review has started.</div>
            <div className={cn("font-path-body text-[12px] leading-snug", inkSoft)}>
              Evidence stays locked while it&rsquo;s being looked at — withdraw isn&rsquo;t available once a review opens.
            </div>
          </div>
        </div>
      )}

      {/* the filed evidence */}
      <div className={cn("mb-2.5 mt-2 font-path-mono text-[11px] font-bold uppercase tracking-[0.08em]", trail ? "text-trail-ink-soft" : "text-hq-ink-muted")}>
        {trail ? "In your satchel" : "Filed evidence"}
      </div>
      {visibleEvidence.length === 0 && !logItem ? (
        <div className="mb-4">
          <EmptyEvidence skin={skin} />
        </div>
      ) : (
        <div className="mb-4">
          <EvidenceList
            studentId={studentId}
            taskId={taskId}
            band={band}
            items={visibleEvidence}
            skin={skin}
            renderItemActions={
              evidenceMutable
                ? (item) => (
                    <div className="mt-2 flex items-center gap-3">
                      {captionDraft?.id === item.id ? (
                        <span className="flex flex-1 items-center gap-2">
                          <input
                            value={captionDraft.text}
                            onChange={(e) => setCaptionDraft({ id: item.id, text: e.target.value })}
                            placeholder="Say what this shows…"
                            maxLength={2000}
                            className={cn(
                              "min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 font-path-body text-xs",
                              cardBorder,
                              trail ? "bg-trail-canvas text-trail-ink" : "bg-hq-surface text-hq-ink"
                            )}
                          />
                          <button
                            type="button"
                            onClick={() => void saveCaption()}
                            disabled={busy !== null}
                            className={cn("font-path-body text-[11.5px] font-semibold", ink)}
                          >
                            {busy === "caption" ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setCaptionDraft(null)}
                            className={cn("font-path-body text-[11.5px]", inkSoft)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setCaptionDraft({ id: item.id, text: item.caption ?? "" })}
                            className={cn("font-path-body text-[11.5px] underline-offset-2 hover:underline", inkSoft)}
                          >
                            {item.caption ? "Edit caption" : "Add caption"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeItem(item.id)}
                            disabled={busy !== null}
                            className={cn("font-path-body text-[11.5px] underline-offset-2 hover:underline", inkSoft)}
                          >
                            {busy === `delete-${item.id}` ? "Removing…" : "Remove"}
                          </button>
                        </>
                      )}
                    </div>
                  )
                : undefined
            }
          />
        </div>
      )}

      {/* the log — a first-class structured type, rendered from its template */}
      {props.hasLogTemplate && (captureAllowed || logItem) && (
        <div className={cn("mb-4 rounded-xl border p-3.5 [&_input]:max-w-[7.5rem] [&_input]:rounded-md [&_input]:border [&_input]:px-1.5 [&_input]:py-1 [&_select]:rounded-md [&_select]:border [&_select]:px-1 [&_select]:py-1 [&_table]:w-full [&_td]:py-1 [&_td]:pr-2 [&_th]:py-1 [&_th]:pr-2 [&_th]:text-left", cardBorder, surface, "font-path-body text-[12.5px]", ink)}>
          <LogTable
            studentId={studentId}
            taskId={taskId}
            band={band}
            evidenceId={logItem?.id ?? draftLogId}
            initialRows={logItem?.logRows ?? []}
            readOnly={!captureAllowed || mutability === "append_only"}
            // DURABLE save (Unit 11): rows survive a killed tab; the drain's own
            // choreography + refresh replace onLogSaved on this path.
            saveOverride={
              queueSupported
                ? async (rows) => {
                    const enqueued = await enqueueLog({
                      studentId,
                      taskId,
                      evidenceId: logItem?.id ?? draftLogId,
                      rows,
                    });
                    if (!enqueued.ok) return { ok: false, message: "Could not save the log. Please try again." };
                    await drainAndSettle(enqueued.id);
                    return { ok: true };
                  }
                : undefined
            }
            onSaved={() => {
              if (!queueSupported) void onLogSaved();
            }}
            onError={(message) => setNotice({ tone: "error", text: message })}
          />
        </div>
      )}

      {/* capture — editable regimes; append-only additions stay possible and are flagged */}
      {captureAllowed && (
        <div className={cn("mb-4 rounded-[16px] border-2 p-4", trail ? "border-trail-ink/12 bg-trail-surface shadow-trail" : "border-hq-border bg-hq-canvas shadow-hq")}>
          <div className={cn("mb-1 font-path-body text-[13px] font-semibold", ink)}>
            {mutability === "append_only"
              ? "Add to the record"
              : trail
                ? "Add evidence to my satchel"
                : "Capture evidence"}
          </div>
          {mutability === "append_only" && (
            <p className={cn("mb-2 font-path-body text-[11px] leading-snug", inkSoft)}>
              This task is verified — anything added now is marked as added afterwards.
            </p>
          )}
          <p className={cn("mb-3 font-path-body text-[12px]", inkSoft)}>
            Go do it in the world. Then bring back your proof.
          </p>

          <div className={cn("[&_input[type=file]]:font-path-body [&_input[type=file]]:text-xs", inkSoft)}>
            <EvidenceUploader
              studentId={studentId}
              taskId={taskId}
              disabled={busy !== null}
              // DURABLE mode (Unit 11): the file routes through the offline
              // queue; without IndexedDB the component's own legacy flow runs.
              onPick={queueSupported ? (file) => void onFilePicked(file) : undefined}
              onUploaded={(u) =>
                void confirmUpload({
                  evidenceId: u.evidenceId,
                  objectPath: u.objectPath,
                  sha256: u.sha256,
                  sizeBytes: u.sizeBytes,
                  contentType: u.contentType,
                  capturedAt: new Date().toISOString(),
                })
              }
              onRefused={onSlotRefused}
              onError={(message) => setNotice({ tone: "amber", text: message })}
            />
          </div>

          <div className={cn("mt-3 border-t pt-3", cardBorder)}>
            <div className={cn("[&_button]:rounded-lg [&_button]:border [&_button]:px-3 [&_button]:py-1.5 [&_button]:font-path-body [&_button]:text-xs", inkSoft)}>
              <VideoCapture
                disabled={busy !== null}
                onCaptured={(captured) => void onVideoCaptured(captured)}
                onError={(message) => setNotice({ tone: "amber", text: message })}
              />
            </div>
          </div>

          {uploadProgress !== null && (
            <p role="status" className={cn("mt-2 font-path-body text-[11.5px]", inkSoft)}>
              Uploading… {uploadProgress}%
            </p>
          )}

          <div className={cn("mt-3 flex items-center gap-2 border-t pt-3", cardBorder)}>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Or paste a link (a video too big to store, a page)…"
              className={cn(
                "min-w-0 flex-1 rounded-lg border px-3 py-2 font-path-body text-xs",
                cardBorder,
                trail ? "bg-trail-canvas text-trail-ink" : "bg-hq-surface text-hq-ink"
              )}
            />
            <button
              type="button"
              onClick={() => void addLink()}
              disabled={busy !== null || !linkUrl.trim()}
              className={cn(
                "rounded-lg px-3 py-2 font-path-body text-xs font-semibold text-white disabled:opacity-50",
              )}
              style={{ backgroundColor: color }}
            >
              {busy === "link" ? "Adding…" : "Add link"}
            </button>
          </div>
        </div>
      )}

      {/* submit */}
      {editable && (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy !== null}
          className={cn(
            "w-full rounded-xl py-3 text-center font-path-body text-sm font-semibold text-white hover:brightness-105 disabled:opacity-50"
          )}
          style={{ backgroundColor: color }}
        >
          {busy === "submit"
            ? "Sending…"
            : state === "not_yet"
              ? "Fix it & resubmit"
              : trail
                ? "Send my satchel for review"
                : "Submit for review"}
        </button>
      )}
    </div>
  );
}
