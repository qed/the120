"use client";

/**
 * SyncStatus (T1 Unit 11) — the durable queue made visible, mounted in the
 * task surface's capture card (the seam Unit 14 left). This REPLACES the
 * in-memory "Finish saving" affordance: an item that couldn't finish is a
 * durable queue entry now, and this surface is where a student sees it,
 * retries a stuck one, or dismisses a resolved note.
 *
 * States, per entry (all decided in sync-rules, rendered here):
 *   - pending  — "saved on this device"; sending when online, waiting when not
 *   - attention — blocked with a student-readable note + Retry / Dismiss
 *   - auth      — the drain hit an expired session; one line, sign-in fixes it
 *
 * Retryable-vs-terminal is already folded into the entry by the drain
 * (interpretAttachFailure): retryables stay pending and re-drain on foreground
 * signals; only terminal refusals surface here as attention items.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/app/path/components/system/cn";
import { Icon } from "@/app/path/components/system/Icon";
import { isQueueSupported, listEntries } from "@/app/path/lib/offline-queue";
import {
  dismissEntry,
  drainQueue,
  isAuthRequired,
  retryEntry,
  subscribeQueue,
} from "@/app/path/lib/sync-engine";
import type { QueueEntry } from "@/app/path/lib/sync-rules";
import type { Skin } from "@/app/path/lib/skin-tokens";

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
          // the next navigation.
          const pendingNow = mine.some((e) => !e.blocked);
          if (hadPendingRef.current && !pendingNow) router.refresh();
          hadPendingRef.current = pendingNow;
        })
        .catch(() => {});
    };
    refresh();
    const unsubscribe = subscribeQueue(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [studentId, taskId, router]);

  const retry = useCallback(
    (id: string) => void retryEntry(id, { actableStudentIds: [studentId] }),
    [studentId]
  );
  const dismiss = useCallback((id: string) => void dismissEntry(id), []);
  const sendNow = useCallback(
    () => void drainQueue({ actableStudentIds: [studentId] }),
    [studentId]
  );

  const pending = entries.filter((e) => !e.blocked);
  const attention = entries.filter((e) => e.blocked !== null);
  if (pending.length === 0 && attention.length === 0 && !authNeeded) return null;

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
          {online && (
            <button
              type="button"
              onClick={sendNow}
              className={cn("font-path-body text-[11.5px] underline-offset-2 hover:underline", inkSoft)}
            >
              <Icon name="refresh" size={13} title="Send now" />
            </button>
          )}
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
            <p className={cn("font-path-body text-[12px] leading-snug", trail ? "text-trail-ink" : "text-hq-ink")}>
              {entry.blocked?.note}
            </p>
            <div className="mt-1.5 flex items-center gap-3">
              {/* Tombstones (dropped / resolved-with-note) only dismiss; stuck
                  items can also retry. */}
              {entry.blocked?.reason !== "dropped" && entry.blocked?.reason !== "noted" && (
                <button
                  type="button"
                  onClick={() => retry(entry.id)}
                  className={cn("font-path-body text-[11.5px] font-semibold underline-offset-2 hover:underline", trail ? "text-trail-ink" : "text-hq-ink")}
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
