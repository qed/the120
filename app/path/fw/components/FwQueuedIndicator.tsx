"use client";

import { Icon } from "@/app/path/components/system/Icon";
import type { FwQueueSummary } from "@/app/path/lib/fw-sync-rules";

/**
 * The offline capture indicator (FW Unit 8; Decision 14) — a fixed corner chip that
 * carries all three states the plan names (n queued / syncing / synced) plus the
 * two that need a human: a rejected tap held for staff, and a truly-expired session
 * needing re-auth. A FAILED/held tap is visibly distinct from a merely queued one —
 * alert colour and its own dismiss, never a quiet line in a list.
 *
 * Presentational: every decision (the counts, the attention list) comes pre-shaped
 * from `summarizeFwQueue`; this only renders it. Single-skin (hq), like every FW
 * surface — complete Tailwind class literals, never concatenation.
 */
export function FwQueuedIndicator({
  supported,
  summary,
  syncing,
  authRequired,
  onSyncNow,
  onDismiss,
}: {
  supported: boolean;
  summary: FwQueueSummary;
  syncing: boolean;
  authRequired: boolean;
  onSyncNow: () => void;
  onDismiss: (id: string) => void;
}) {
  // Private-mode Safari: a PERSISTENT warning, because a device that silently drops
  // every offline tap is worse than one that says so up front.
  if (!supported) {
    return (
      <div
        role="alert"
        className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-xl border-2 border-not-yet bg-not-yet/10 p-3 shadow-hq"
      >
        <p className="flex items-center gap-2 font-path-body text-sm leading-5 text-hq-ink">
          <Icon name="alert-triangle" size={18} className="shrink-0 text-not-yet" />
          This device can&apos;t save check-ins while offline. Keep a signal, or use paper as backup.
        </p>
      </div>
    );
  }

  const hasAttention = summary.attention.length > 0;
  const hasQueued = summary.queuedCount > 0;
  if (!authRequired && !hasAttention && !hasQueued && !syncing) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-md flex-col gap-2">
      {authRequired && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border-2 border-not-yet bg-not-yet/10 p-3 shadow-hq"
        >
          <Icon name="alert-triangle" size={18} className="shrink-0 text-not-yet" />
          <p className="flex-1 font-path-body text-sm leading-5 text-hq-ink">
            Your session ended. Sign in again to send your saved check-ins.
          </p>
        </div>
      )}

      {summary.attention.map((item) => (
        <div
          key={item.id}
          role="alert"
          className="flex items-start gap-2 rounded-xl border-2 border-not-yet bg-not-yet/10 p-3 shadow-hq"
        >
          <Icon name="alert-triangle" size={18} className="mt-0.5 shrink-0 text-not-yet" />
          <p className="flex-1 font-path-body text-sm leading-5 text-hq-ink">
            A saved check-in couldn&apos;t be sent — The 120 staff have it. {item.note}
          </p>
          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            className="min-h-[36px] shrink-0 font-path-body text-sm font-medium text-hq-ink-soft underline underline-offset-2 hover:text-hq-ink"
          >
            Dismiss
          </button>
        </div>
      ))}

      {(hasQueued || syncing) && (
        <div className="flex items-center gap-2 rounded-xl border border-hq-border-strong bg-hq-surface p-3 shadow-hq">
          <Icon
            name={syncing ? "refresh" : "clock"}
            size={18}
            className={syncing ? "shrink-0 animate-spin text-hq-ink-soft" : "shrink-0 text-hq-ink-soft"}
          />
          <p className="flex-1 font-path-body text-sm leading-5 text-hq-ink">
            {syncing
              ? "Syncing your check-ins…"
              : `${summary.queuedCount} check-in${summary.queuedCount === 1 ? "" : "s"} waiting to sync`}
          </p>
          {hasQueued && !syncing && (
            <button
              type="button"
              onClick={onSyncNow}
              className="min-h-[36px] shrink-0 font-path-body text-sm font-medium text-hq-ink underline underline-offset-2"
            >
              Sync now
            </button>
          )}
        </div>
      )}
    </div>
  );
}
