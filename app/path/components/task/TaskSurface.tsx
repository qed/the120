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

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/app/path/components/system/cn";
import { Icon } from "@/app/path/components/system/Icon";
import { StatusChip } from "@/app/path/components/system/StatusChip";
import { phaseColor, phaseColorAlpha } from "@/app/path/components/system/phases";
import { EvidenceList, type EvidenceItemView } from "@/app/path/components/EvidenceList";
import { EvidenceUploader } from "@/app/path/components/EvidenceUploader";
import { VideoCapture, type CapturedVideo } from "@/app/path/components/VideoCapture";
import { LogTable } from "@/app/path/components/LogTable";
import { EmptyEvidence } from "@/app/path/components/EmptyStates";
import { uploadEvidenceFile, type SlotRefusal } from "@/app/path/components/upload-client";
import {
  addLinkEvidence,
  confirmUploadedEvidence,
  deleteEvidence,
  editEvidenceCaption,
} from "@/app/path/lib/actions/evidence";
import { applyTransition } from "@/app/path/lib/actions/transition";
import { clearNowPin, pinNowTask } from "@/app/path/lib/actions/pin";
import type { EvidenceSpec } from "@/app/path/content/evidence-spec";
import { SAFETY_COPY, type SafetyFlag } from "@/app/path/content/safety-flags";
import type { Band, PhaseKey } from "@/app/path/content/types";
import { classifyActionFailure, type MutabilityRegime } from "@/app/path/lib/now-card-rules";
import type { Skin } from "@/app/path/lib/skin-tokens";
import type { TaskState } from "@/app/path/lib/transition-table";

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
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [captionDraft, setCaptionDraft] = useState<{ id: string; text: string } | null>(null);
  const mountedRef = useRef(true);
  // A fresh log's evidence identity, stable across edits until it lands.
  const [draftLogId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
      if (classifyActionFailure(reason) === "login") router.push("/path/sign-in");
      if (classifyActionFailure(reason) === "refresh") router.refresh();
    },
    [failureNotice, router]
  );

  /** Run one transition; returns true when the task is at the target. */
  const runTransition = useCallback(
    async (transition: "open" | "submit" | "withdraw" | "resume"): Promise<boolean> => {
      try {
        const result = await applyTransition({ studentId, taskId, transition });
        if (!mountedRef.current) return false;
        if (result.ok) {
          if (!result.byCaller && result.winner?.verifiedBy) {
            // Superseded — someone else got it there. Never claim "you did it".
            setNotice({ tone: "info", text: "Already done — this had just been handled elsewhere." });
          }
          return true;
        }
        handleFailure(result.reason);
        return false;
      } catch {
        if (mountedRef.current) {
          setNotice({ tone: "error", text: "Something went wrong. Please try again." });
        }
        return false;
      }
    },
    [studentId, taskId, handleFailure]
  );

  /** After a successful capture, move available→in_progress / not_yet→in_progress. */
  const touchStateAfterCapture = useCallback(async () => {
    if (state === "available") await runTransition("open");
    else if (state === "not_yet") await runTransition("resume");
  }, [state, runTransition]);

  const submit = useCallback(async () => {
    setBusy("submit");
    setNotice(null);
    try {
      // submit runs from in_progress; chain the state there first when needed.
      if (state === "available" && !(await runTransition("open"))) return;
      if (state === "not_yet" && !(await runTransition("resume"))) return;
      if (await runTransition("submit")) {
        setNotice({ tone: "info", text: trail ? "Your satchel's in!" : "Submitted for review." });
        router.refresh();
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [state, runTransition, router, trail]);

  const withdraw = useCallback(async () => {
    setBusy("withdraw");
    setNotice(null);
    try {
      if (await runTransition("withdraw")) {
        setNotice({ tone: "info", text: "Withdrawn — add what you need, then send it back." });
        router.refresh();
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [runTransition, router]);

  const togglePin = useCallback(async () => {
    setBusy("pin");
    try {
      const result = pinned ? await clearNowPin() : await pinNowTask({ taskId });
      if (!mountedRef.current) return;
      if (result.ok) router.refresh();
      else handleFailure(result.reason);
    } catch {
      if (mountedRef.current) setNotice({ tone: "error", text: "Something went wrong. Please try again." });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [pinned, taskId, router, handleFailure]);

  const confirmUpload = useCallback(
    async (p: {
      evidenceId: string;
      objectPath: string;
      sha256: string;
      sizeBytes: number;
      contentType: string;
      posterObjectPath?: string;
      durationSeconds?: number;
    }) => {
      try {
        const result = await confirmUploadedEvidence({
          studentId,
          taskId,
          ...p,
          capturedAt: new Date().toISOString(),
        });
        if (!mountedRef.current) return;
        if (result.ok) {
          if (result.hashDuplicateOf) {
            setNotice({ tone: "info", text: "Saved — heads up, it looks identical to something already filed." });
          }
          await touchStateAfterCapture();
          router.refresh();
        } else {
          handleFailure(result.reason);
        }
      } catch {
        if (mountedRef.current) {
          setNotice({
            tone: "amber",
            text: "The file is uploaded but not yet filed — it will finish next time this page loads.",
          });
        }
      }
    },
    [studentId, taskId, touchStateAfterCapture, router, handleFailure]
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

  const onVideoCaptured = useCallback(
    async (captured: CapturedVideo) => {
      setBusy("video");
      setNotice(null);
      setVideoProgress(0);
      try {
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
            if (mountedRef.current) setVideoProgress(pct);
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
        });
      } finally {
        if (mountedRef.current) {
          setBusy(null);
          setVideoProgress(null);
        }
      }
    },
    [studentId, taskId, confirmUpload, onSlotRefused]
  );

  const addLink = useCallback(async () => {
    if (!linkUrl.trim()) return;
    setBusy("link");
    setNotice(null);
    try {
      const result = await addLinkEvidence({
        studentId,
        taskId,
        evidenceId: crypto.randomUUID(),
        url: linkUrl.trim(),
      });
      if (!mountedRef.current) return;
      if (result.ok) {
        setLinkUrl("");
        await touchStateAfterCapture();
        router.refresh();
      } else if (result.reason === "invalid_input") {
        setNotice({ tone: "error", text: "That doesn't look like a web link — it needs to start with https://" });
      } else {
        handleFailure(result.reason);
      }
    } catch {
      if (mountedRef.current) setNotice({ tone: "error", text: "Something went wrong. Please try again." });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [linkUrl, studentId, taskId, touchStateAfterCapture, router, handleFailure]);

  const saveCaption = useCallback(async () => {
    if (!captionDraft) return;
    setBusy("caption");
    try {
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
    } catch {
      if (mountedRef.current) setNotice({ tone: "error", text: "Something went wrong. Please try again." });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [captionDraft, studentId, router, handleFailure]);

  const removeItem = useCallback(
    async (evidenceId: string) => {
      setBusy(`delete-${evidenceId}`);
      try {
        const result = await deleteEvidence({ studentId, evidenceId });
        if (!mountedRef.current) return;
        if (result.ok) router.refresh();
        else handleFailure(result.reason);
      } catch {
        if (mountedRef.current) setNotice({ tone: "error", text: "Something went wrong. Please try again." });
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [studentId, router, handleFailure]
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
        href={`/path/criterion/${criterionId}`}
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

      {/* reviewer decision — the adult's words are the best reward in the system */}
      {state === "not_yet" && props.decision?.kind === "not_yet" && (
        <div className="mb-4 rounded-[14px] border-[1.5px] border-not-yet/30 bg-not-yet/10 px-3.5 py-3">
          <div className={cn("mb-1 flex items-center gap-2 font-path-body text-sm font-semibold", ink)}>
            <span className="text-not-yet">
              <Icon name="circle-dot" size={16} />
            </span>
            Not yet — and that&rsquo;s okay.
          </div>
          <p className={cn("font-path-body text-[12.5px] leading-snug", inkSoft)}>{props.decision.note}</p>
          <p className={cn("mt-2 font-path-body text-[11.5px]", inkSoft)}>
            Your evidence is safe. Fix the one thing and try again — not done, <i>yet</i>.
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
        </div>
      )}

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
            onSaved={() => {
              void touchStateAfterCapture().then(() => router.refresh());
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
              onUploaded={(u) =>
                void confirmUpload({
                  evidenceId: u.evidenceId,
                  objectPath: u.objectPath,
                  sha256: u.sha256,
                  sizeBytes: u.sizeBytes,
                  contentType: u.contentType,
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
            {videoProgress !== null && (
              <p role="status" className={cn("mt-1 font-path-body text-[11.5px]", inkSoft)}>
                Uploading video… {videoProgress}%
              </p>
            )}
          </div>

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
