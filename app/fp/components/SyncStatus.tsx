"use client";

/**
 * SyncStatus (T1 Unit 11) — the durable queue made visible, mounted in the
 * task surface's capture card (the seam Unit 14 left). This REPLACES the
 * in-memory "Finish saving" affordance: an item that couldn't finish is a
 * durable queue entry now, and this surface is where a student sees it,
 * retries a stuck one, or dismisses a resolved note.
 *
 * States, per entry (all decided in sync-rules' entryDisplayState):
 *   - pending      — "saved on this device"; sending when online, waiting when not
 *   - still_trying — many failed attempts, auto-retry ceiling reached: the
 *     copy stops promising "it'll send" and offers the manual retry
 *     (reliability review — the honest middle state)
 *   - attention    — blocked with a student-readable note + Retry / Dismiss
 *     (tombstones — dropped/noted/phase_locked/unrecognized — dismiss only)
 * Plus one auth line when the drain hit an expired session.
 *
 * "Send now" renders whenever anything is pending, even while the browser
 * claims offline — navigator.onLine false-negatives are real, and a manual
 * attempt while genuinely offline fails harmlessly into retry posture.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/app/fp/components/system/cn";
import { Icon } from "@/app/fp/components/system/Icon";
import { isQueueSupported, listEntries } from "@/app/fp/lib/offline-queue";
import {
  dismissEntry,
  drainQueue,
  isAuthRequired,
  retryEntry,
  subscribeQueue,
} from "@/app/fp/lib/sync-engine";
import {
  entryDisplayState,
  isTombstoneReason,
  type QueueEntry,
} from "@/app/fp/lib/sync-rules";
import type { Skin } from "@/app/fp/lib/skin-tokens";

const KIND_LABEL: Record<QueueEntry["kind"], string> = {
  media: "capture",
  link: "link",
  log: "log",
  submit: "submit",
};

/** navigator.onLine as an external store: online during SSR (server snapshot),
 *  live browser truth afterwards. */
const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
const readOnline = () => navigator.onLine !== false;

/**
 * Coalesce router.refresh() calls: a background drain's queue-cleared refresh
 * and TaskSurface's own post-drain refresh can land in the same beat (julik
 * review) — one RSC refetch serves both.
 */
let refreshScheduled = false;
export function scheduleCoalescedRefresh(refresh: () => void): void {
  if (refreshScheduled) return;
  refreshScheduled = true;
  setTimeout(() => {
    refreshScheduled = false;
    refresh();
  }, 120);
}

export function SyncStatus({
  studentId,
  taskId,
  skin,
}: {
  studentId: string;
  taskId: string;
  skin: Skin;
}) {
  const trail = skin === "trail";
  const router = useRouter();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [authNeeded, setAuthNeeded] = useState(false);
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  const hadPendingRef = useRef(false);

  useEffect(() => {
    if (!isQueueSupported()) return;
    let cancelled = false;
    const refresh = () => {
      void listEntries()
        .then((all) => {
          if (cancelled) return;
          const mine = all.filter((e) => e.studentId === studentId && e.taskId === taskId);
          setEntries(mine);
          setAuthNeeded(isAuthRequired());
          // A BACKGROUND drain (the engine's online/visibility signal, not this
          // surface's own action flow) just landed this task's queued work —
          // refresh so the satchel shows it, rather than staying stale until
          // the next navigation. Coalesced: TaskSurface may refresh too.
          const pendingNow = mine.some((e) => !e.blocked);
          if (hadPendingRef.current && !pendingNow) {
            scheduleCoalescedRefresh(() => router.refresh());
          }
          hadPendingRef.current = pendingNow;
        })
        .catch((e) => console.error("[path/SyncStatus] queue read failed:", e));
    };
    refresh();
    const unsubscribe = subscribeQueue(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [studentId, taskId, router]);

  const retry = useCallback(
    (id: string) =>
      void retryEntry(id, { actableStudentIds: [studentId] }).catch((e) =>
        console.error("[path/SyncStatus] retry failed:", e)
      ),
    [studentId]
  );
  const dismiss = useCallback(
    (id: string) =>
      void dismissEntry(id).catch((e) => console.error("[path/SyncStatus] dismiss failed:", e)),
    []
  );
  const sendNow = useCallback(
    () =>
      void drainQueue({ actableStudentIds: [studentId] }, { wait: true, includeStuck: true }).catch(
        (e) => console.error("[path/SyncStatus] manual drain failed:", e)
      ),
    [studentId]
  );

  const pending = entries.filter((e) => entryDisplayState(e) === "pending");
  const stillTrying = entries.filter((e) => entryDisplayState(e) === "still_trying");
  const attention = entries.filter((e) => entryDisplayState(e) === "attention");
  if (pending.length === 0 && stillTrying.length === 0 && attention.length === 0 && !authNeeded) {
    return null;
  }

  const ink = trail ? "text-trail-ink" : "text-hq-ink";
  const inkSoft = trail ? "text-trail-ink-soft" : "text-hq-ink-soft";
  const cardBorder = trail ? "border-trail-ink/12" : "border-hq-border";
  const surface = trail ? "bg-trail-canvas" : "bg-hq-surface";

  return (
    <div className="mb-3 flex flex-col gap-2" data-path-sync-status>
      {pending.length > 0 && (
        <div className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2.5", cardBorder, surface)}>
          <span className={cn("flex-shrink-0", online ? "text-awaiting" : inkSoft)}>
            <Icon name={online ? "upload" : "cloud-off"} size={16} />
          </span>
          <p className={cn("flex-1 font-path-body text-[12px] leading-snug", inkSoft)}>
            {online
              ? `Sending ${pending.length} ${pending.length === 1 ? "item" : "items"}…`
              : `${pending.length} ${pending.length === 1 ? "item is" : "items are"} saved on this device — they'll send when you're back online.`}
          </p>
          <button
            type="button"
            onClick={sendNow}
            className={cn("font-path-body text-[11.5px] underline-offset-2 hover:underline", inkSoft)}
          >
            <Icon name="refresh" size={13} title="Send now" />
          </button>
        </div>
      )}

      {stillTrying.length > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-not-yet/30 bg-not-yet/10 px-3 py-2.5">
          <span className="flex-shrink-0 text-not-yet">
            <Icon name="clock" size={15} />
          </span>
          <p className={cn("flex-1 font-path-body text-[12px] leading-snug", ink)}>
            {stillTrying.length === 1 ? "One item keeps" : `${stillTrying.length} items keep`} not going
            through. It&rsquo;s still safe on this device — but it may need attention.
          </p>
          <button
            type="button"
            onClick={sendNow}
            className={cn("font-path-body text-[11.5px] font-semibold underline underline-offset-2", ink)}
          >
            Try again
          </button>
        </div>
      )}

      {attention.map((entry) => (
        <div
          key={entry.id}
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-not-yet/30 bg-not-yet/10 px-3 py-2.5"
        >
          <span className="mt-0.5 flex-shrink-0 text-not-yet">
            <Icon name="alert-triangle" size={15} />
          </span>
          <div className="flex-1">
            <p className={cn("font-path-body text-[12px] leading-snug", ink)}>{entry.blocked?.note}</p>
            <div className="mt-1.5 flex items-center gap-3">
              {/* Tombstones (dropped / noted / phase-locked / unrecognized)
                  only dismiss; stuck items can also retry. */}
              {entry.blocked && !isTombstoneReason(entry.blocked.reason) && (
                <button
                  type="button"
                  onClick={() => retry(entry.id)}
                  className={cn("font-path-body text-[11.5px] font-semibold underline-offset-2 hover:underline", ink)}
                >
                  Try again
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(entry.id)}
                className={cn("font-path-body text-[11.5px] underline-offset-2 hover:underline", inkSoft)}
              >
                Dismiss{entry.kind === "media" ? " (removes this capture)" : ""}
              </button>
              <span className={cn("ml-auto font-path-mono text-[10px] uppercase", inkSoft)}>
                {KIND_LABEL[entry.kind]}
              </span>
            </div>
          </div>
        </div>
      ))}

      {authNeeded && (
        <div className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2.5", cardBorder, surface)}>
          <span className={cn("flex-shrink-0", inkSoft)}>
            <Icon name="clock" size={15} />
          </span>
          <p className={cn("font-path-body text-[12px]", inkSoft)}>
            Your sign-in expired — sign in again and your saved items will finish sending.
          </p>
        </div>
      )}
    </div>
  );
}
