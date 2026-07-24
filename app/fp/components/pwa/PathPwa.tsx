"use client";

/**
 * The /path PWA runtime (T1 Unit 11): service-worker registration, the update
 * toast, the sync-engine lifecycle, storage persistence, and the iOS install
 * coach. Mounted ONCE in the authed (app) layout; renders nothing but the
 * toast and the install prompt.
 *
 * Discipline (every line a plan requirement, all decided in sync-rules):
 *   - Registration is HOSTNAME-GUARDED (shouldRegisterServiceWorker) — a
 *     preview deployment must never register a worker that outlives it.
 *   - `/sw.js` from the origin root, scope "/fp", updateViaCache: "none".
 *   - NO blind skipWaiting: a waiting worker surfaces as a toast; the reload
 *     happens on the user's tap (v1 HTML + v2 chunks = ChunkLoadError).
 *   - `navigator.storage.persist()` is requested and `false` is EXPECTED on
 *     Safari — the durability answer there is install, not the API.
 *   - Background Sync (Chromium-only) is registered as a free nudge when
 *     entries are queued; the drain itself always runs in page context.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { InstallPrompt } from "@/app/fp/components/pwa/InstallPrompt";
import { listEntries } from "@/app/fp/lib/offline-queue";
import { drainQueue, startSyncEngine, subscribeQueue } from "@/app/fp/lib/sync-engine";
import {
  decideDurabilityWarning,
  shouldRegisterServiceWorker,
  summarizeQueue,
  SW_SCOPE,
  SW_URL,
  type QueueSummary,
} from "@/app/fp/lib/sync-rules";
import type { Skin } from "@/app/fp/lib/skin-tokens";

/** A registration surface that may carry Chromium's Background Sync. */
type SyncCapableRegistration = ServiceWorkerRegistration & {
  sync?: { register(tag: string): Promise<void> };
};

/** Platform snapshots via useSyncExternalStore (never computed in the render
 *  body): the server snapshot says "not iOS / not installed", so SSR renders
 *  no prompt and the client corrects after hydration — the render-body
 *  typeof-guard version would MISMATCH at hydration on the exact device this
 *  component targets (project-standards review). */
const noSubscription = () => () => {};
const readIsIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const subscribeStandalone = (cb: () => void) => {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const readStandalone = () => window.matchMedia("(display-mode: standalone)").matches;

export function PathPwa({
  actableStudentIds,
  skin,
}: {
  /** Student profiles this session may act on — the drain scope. */
  actableStudentIds: string[];
  skin: Skin;
}) {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [summary, setSummary] = useState<QueueSummary>({ pendingCount: 0, queuedBytes: 0, attention: [] });
  const [updating, setUpdating] = useState(false);
  const reloadArmedRef = useRef(false);
  const isIOS = useSyncExternalStore(noSubscription, readIsIOS, () => false);
  const isStandalone = useSyncExternalStore(subscribeStandalone, readStandalone, () => true);

  // ── sync engine lifecycle + queue summary ──────────────────────────────────
  useEffect(() => {
    const ctx = { actableStudentIds };
    const stopEngine = startSyncEngine(ctx);

    let cancelled = false;
    const refresh = () => {
      void listEntries()
        .then((entries) => {
          if (cancelled) return;
          // Scope the SUMMARY exactly like the drain: this session's own
          // students only. A sibling's queued entries on a shared device must
          // not leak their byte counts/urgency into this account's banner
          // (security review — display scope must match selectDrainable's).
          const actable = new Set(actableStudentIds);
          setSummary(summarizeQueue(entries.filter((e) => actable.has(e.studentId))));
        })
        .catch(() => {
          /* queue unsupported — summary stays empty */
        });
    };
    refresh();
    const unsubscribe = subscribeQueue(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
      stopEngine();
    };
    // A stable primitive key: the id list only changes with the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actableStudentIds.join(",")]);

  // ── storage persistence (expect false on Safari — install is the answer) ───
  useEffect(() => {
    navigator.storage
      ?.persist?.()
      .then((granted) => {
        if (!granted) console.info("[path/pwa] storage.persist() not granted (expected on Safari)");
      })
      .catch(() => {});
  }, []);

  // ── service worker registration + update detection ─────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!shouldRegisterServiceWorker(window.location.hostname)) return;

    let cancelled = false;
    // The registration outlives this component — the updatefound listener must
    // be removed on unmount or a remount stacks stale closures (julik review).
    let registration: ServiceWorkerRegistration | null = null;
    const onUpdateFound = () => {
      const installing = registration?.installing;
      installing?.addEventListener("statechange", () => {
        // "installed" with an existing controller = an UPDATE is waiting.
        // (Without a controller it's the very first install — no toast.)
        if (!cancelled && installing.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(installing);
        }
      });
    };
    navigator.serviceWorker
      .register(SW_URL, { scope: SW_SCOPE, updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        // A worker already waiting (an update installed on a previous visit).
        if (reg.waiting && navigator.serviceWorker.controller) setWaitingWorker(reg.waiting);
        reg.addEventListener("updatefound", onUpdateFound);
      })
      .catch((e) => console.error("[path/pwa] SW registration failed:", e));
    return () => {
      cancelled = true;
      registration?.removeEventListener("updatefound", onUpdateFound);
    };
  }, []);

  // ── Background Sync nudge (Chromium-only enhancement, never the mechanism) ─
  useEffect(() => {
    if (summary.pendingCount === 0 || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg: SyncCapableRegistration) => reg.sync?.register("path-drain"))
      .catch(() => {});
  }, [summary.pendingCount]);

  // ── the update toast (the ONLY path to skipWaiting) ────────────────────────
  const applyUpdate = useCallback(() => {
    if (!waitingWorker) return;
    setUpdating(true);
    if (!reloadArmedRef.current) {
      reloadArmedRef.current = true;
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
        once: true,
      });
    }
    waitingWorker.postMessage("path-skip-waiting");
  }, [waitingWorker]);

  const retryDrain = useCallback(() => {
    void drainQueue({ actableStudentIds }, { wait: true, includeStuck: true }).catch((e) =>
      console.error("[path/pwa] manual drain failed:", e)
    );
  }, [actableStudentIds]);

  const warning = decideDurabilityWarning({
    isIOS,
    isStandalone,
    queuedCount: summary.pendingCount + summary.attention.length,
  });

  return (
    <>
      <InstallPrompt warning={warning} queuedBytes={summary.queuedBytes} skin={skin} onRetry={retryDrain} />
      {waitingWorker && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 bg-hq-ink px-4 py-3 font-path-body text-[13px] text-white"
        >
          A new version of First Profit is ready.
          <button
            type="button"
            onClick={applyUpdate}
            disabled={updating}
            className="rounded-lg bg-white/15 px-3 py-1.5 font-semibold underline-offset-2 hover:bg-white/25 disabled:opacity-60"
          >
            {updating ? "Updating…" : "Update now"}
          </button>
        </div>
      )}
    </>
  );
}
