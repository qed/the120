"use client";

/**
 * The iOS install coach (T1 Unit 11) — a DATA-DURABILITY affordance, not
 * growth UX. Safari wipes IndexedDB, the Cache API, and the SW registration
 * after 7 days without interaction; installed home-screen apps are exempt. So:
 *
 *   - `install_gentle` (iOS, not installed, nothing queued): a dismissible
 *     coach card. Snoozed for 7 days on dismiss (localStorage).
 *   - `install_urgent` (iOS, not installed, QUEUED BYTES EXIST): the loud
 *     warning — a child's un-synced week is on the line. Not snoozable; it
 *     collapses to a compact line after a tap so it never buries the surface.
 *
 * There is no `beforeinstallprompt` on iOS — the COACHED SHEET (Share → Add to
 * Home Screen) is the only discoverable install path, which is why T1 ships it
 * (the richer install UX is T2 Unit 2). Android/desktop prompt capture is T2.
 */

import { useState, useSyncExternalStore } from "react";
import { cn } from "@/app/path/components/system/cn";
import { Icon } from "@/app/path/components/system/Icon";
import type { Skin } from "@/app/path/lib/skin-tokens";
import type { DurabilityWarning } from "@/app/path/lib/sync-rules";

const SNOOZE_KEY = "path-install-coach-snoozed-until";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** The snooze flag as a tiny external store over localStorage — snoozed during
 *  SSR (server snapshot: never flash the coach), real answer on the client. */
const snoozeListeners = new Set<() => void>();
const subscribeSnooze = (cb: () => void) => {
  snoozeListeners.add(cb);
  return () => snoozeListeners.delete(cb);
};
const readSnoozed = (): boolean => {
  try {
    return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
  } catch {
    return false; // private mode — no durable snooze
  }
};
const writeSnooze = (): void => {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* private mode — the coach returns next mount; acceptable */
  }
  snoozeListeners.forEach((cb) => cb());
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function InstallPrompt({
  warning,
  queuedBytes,
  skin,
  onRetry,
}: {
  warning: DurabilityWarning;
  queuedBytes: number;
  skin: Skin;
  /** Kick a drain — the honest first answer to "queued bytes exist" is to send them. */
  onRetry: () => void;
}) {
  const trail = skin === "trail";
  const snoozed = useSyncExternalStore(subscribeSnooze, readSnoozed, () => true);
  const [collapsed, setCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (warning === "none") return null;
  if (warning === "install_gentle" && snoozed) return null;

  const urgent = warning === "install_urgent";

  if (urgent && collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-3 right-3 z-40 flex items-center gap-2 rounded-full bg-not-yet px-3.5 py-2 font-path-body text-[12px] font-semibold text-white shadow-lg"
      >
        <Icon name="alert-triangle" size={14} />
        {formatBytes(queuedBytes)} not safe yet
      </button>
    );
  }

  return (
    <div
      role={urgent ? "alert" : "status"}
      className={cn(
        "fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-2xl border-2 p-4 shadow-xl",
        urgent
          ? "border-not-yet/40 bg-not-yet/10 backdrop-blur"
          : trail
            ? "border-trail-ink/12 bg-trail-surface"
            : "border-hq-border bg-hq-canvas",
        // solid backing so page content never bleeds through the blur
        trail ? "bg-trail-canvas" : "bg-hq-canvas"
      )}
    >
      <div className={cn("mb-1 flex items-center gap-2 font-path-body text-[13.5px] font-semibold", trail ? "text-trail-ink" : "text-hq-ink")}>
        <span className={urgent ? "text-not-yet" : "text-verified"}>
          <Icon name={urgent ? "alert-triangle" : "download"} size={17} />
        </span>
        {urgent ? "Your captures aren't safe on this iPhone yet" : "Add The Path to your Home Screen"}
      </div>
      <p className={cn("font-path-body text-[12px] leading-snug", trail ? "text-trail-ink-soft" : "text-hq-ink-soft")}>
        {urgent ? (
          <>
            {formatBytes(queuedBytes)} of evidence is saved only in this browser, and iPhones clear
            browser storage after about a week away. Install The Path to keep it safe — or get back
            online so it can send now.
          </>
        ) : (
          <>Installed, your work is safe on this device even offline — and The Path opens like an app.</>
        )}
      </p>

      {sheetOpen ? (
        <ol className={cn("mt-3 space-y-2 rounded-xl border p-3 font-path-body text-[12.5px]", trail ? "border-trail-ink/12 bg-trail-canvas text-trail-ink" : "border-hq-border bg-hq-surface text-hq-ink")}>
          <li className="flex items-center gap-2">
            <b>1.</b> Tap the <b>Share</b> button
            <span aria-hidden className={cn("inline-flex", trail ? "text-trail-ink-soft" : "text-hq-ink-soft")}>
              <Icon name="share" size={15} />
            </span>
            at the bottom of Safari
          </li>
          <li>
            <b>2.</b> Scroll down and tap <b>Add to Home Screen</b>
          </li>
          <li>
            <b>3.</b> Tap <b>Add</b> — then open The Path from your Home Screen
          </li>
        </ol>
      ) : null}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSheetOpen((v) => !v)}
          className={cn(
            "rounded-lg px-3.5 py-2 font-path-body text-[12.5px] font-semibold text-white",
            urgent ? "bg-not-yet" : "bg-verified"
          )}
        >
          {sheetOpen ? "Hide the steps" : "Show me how"}
        </button>
        {urgent ? (
          <>
            <button
              type="button"
              onClick={onRetry}
              className={cn("font-path-body text-[12px] underline underline-offset-2", trail ? "text-trail-ink-soft" : "text-hq-ink-soft")}
            >
              Try sending now
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className={cn("ml-auto font-path-body text-[12px]", trail ? "text-trail-ink-soft" : "text-hq-ink-soft")}
            >
              Minimize
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={writeSnooze}
            className={cn("ml-auto font-path-body text-[12px] underline-offset-2 hover:underline", trail ? "text-trail-ink-soft" : "text-hq-ink-soft")}
          >
            Not now
          </button>
        )}
      </div>
    </div>
  );
}
