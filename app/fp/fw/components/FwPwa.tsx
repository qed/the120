"use client";

/**
 * The Founders Weekend PWA runtime (FW Unit 8): service-worker registration, the
 * foreground drain-signal wiring, the queued indicator, and the private-mode
 * warning. Mounted ONCE from `app/fp/fw/(app)/layout.tsx` — the guide subtree —
 * because the Path's `PathPwa` mounts only in the Path `(app)` layout, which a
 * guide never loads. Renders the indicator and the warning; nothing else.
 *
 * Discipline (each line a plan requirement, all decided in `fw-sync-rules` /
 * `fw-sync-client`):
 *   - Registration is HOSTNAME-GUARDED — a preview deployment must never register a
 *     worker that outlives it.
 *   - `/sw.js` from the origin root, scope `/fp/fw` (the shared worker, narrowed),
 *     `updateViaCache: "none"`.
 *   - NO blind skipWaiting: a waiting worker surfaces as a toast; the reload happens
 *     on the guide's tap (v1 HTML + v2 chunks = ChunkLoadError).
 *   - The drain always runs in page context (`startFwSyncEngine`); Background Sync
 *     is a free Chromium-only nudge when taps are queued.
 *   - `isFwQueueSupported()` false (private-mode Safari) shows a PERSISTENT "this
 *     device cannot capture offline" warning (Decision 14).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { FwQueuedIndicator } from "@/app/fp/fw/components/FwQueuedIndicator";
import {
  dismissFwEntry,
  isFwAuthRequired,
  isFwQueueSupported,
  readFwQueueSummary,
  reconcileFwCacheOwner,
  runFwClientDrain,
  startFwSyncEngine,
  subscribeFwQueue,
} from "@/app/fp/lib/fw-sync-client";
import {
  FW_SW_SCOPE,
  FW_SW_URL,
  type FwQueueSummary,
} from "@/app/fp/lib/fw-sync-rules";
import { shouldRegisterServiceWorker } from "@/app/fp/lib/sync-rules";

/** A registration surface that may carry Chromium's Background Sync. */
type SyncCapableRegistration = ServiceWorkerRegistration & {
  sync?: { register(tag: string): Promise<void> };
};

const EMPTY_SUMMARY: FwQueueSummary = { queuedCount: 0, attention: [] };

export function FwPwa({ actorUserId }: { actorUserId: string }) {
  const router = useRouter();
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const reloadArmedRef = useRef(false);
  const [summary, setSummary] = useState<FwQueueSummary>(EMPTY_SUMMARY);
  const [syncing, setSyncing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);

  // Whether this browser can hold the queue at all — a persistent warning, not a
  // one-time toast (a private-mode iPad silently losing every tap is the failure).
  const supported = useSyncExternalStore(
    () => () => {},
    () => isFwQueueSupported(),
    () => true
  );

  // ── identity reconcile (security): purge a prior guide's cached residue ─────
  // Runs BEFORE the first drain so a device that changed hands without a sign-out
  // never serves the previous guide's authed shell / roster / queue to this one.
  useEffect(() => {
    void reconcileFwCacheOwner(actorUserId).catch((e) =>
      console.error("[fw/pwa] cache-owner reconcile failed:", e)
    );
  }, [actorUserId]);

  // ── sync engine lifecycle + queue summary ──────────────────────────────────
  useEffect(() => {
    const ctx = { actorUserId };
    const stopEngine = startFwSyncEngine(ctx);

    let cancelled = false;
    const refresh = () => {
      void readFwQueueSummary(actorUserId).then((next) => {
        if (cancelled) return;
        setSummary(next);
        setAuthRequired(isFwAuthRequired());
      });
    };
    refresh();
    const unsubscribe = subscribeFwQueue(() => {
      refresh();
      // A successful drain empties the queue and lands events server-side; refresh
      // the route so the roster's resume chips, the tree counts, and the board all
      // catch up (and the roster cache re-seeds from the fresh render).
      router.refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      stopEngine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorUserId]);

  // ── Background Sync nudge (Chromium-only enhancement) ──────────────────────
  useEffect(() => {
    if (summary.queuedCount === 0 || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg: SyncCapableRegistration) => reg.sync?.register("path-drain"))
      .catch(() => {});
  }, [summary.queuedCount]);

  // ── service worker registration + update detection ─────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!shouldRegisterServiceWorker(window.location.hostname)) return;

    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;
    const onUpdateFound = () => {
      const installing = registration?.installing;
      installing?.addEventListener("statechange", () => {
        if (!cancelled && installing.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(installing);
        }
      });
    };
    navigator.serviceWorker
      .register(FW_SW_URL, { scope: FW_SW_SCOPE, updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        if (reg.waiting && navigator.serviceWorker.controller) setWaitingWorker(reg.waiting);
        reg.addEventListener("updatefound", onUpdateFound);
      })
      .catch((e) => console.error("[fw/pwa] SW registration failed:", e));
    return () => {
      cancelled = true;
      registration?.removeEventListener("updatefound", onUpdateFound);
    };
  }, []);

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

  const manualDrain = useCallback(() => {
    setSyncing(true);
    void runFwClientDrain({ actorUserId }, { wait: true, includeStuck: true })
      .catch((e) => console.error("[fw/pwa] manual drain failed:", e))
      .finally(() => setSyncing(false));
  }, [actorUserId]);

  const onDismiss = useCallback((id: string) => {
    void dismissFwEntry(id).catch((e) => console.error("[fw/pwa] dismiss failed:", e));
  }, []);

  return (
    <>
      <FwQueuedIndicator
        supported={supported}
        summary={summary}
        syncing={syncing}
        authRequired={authRequired}
        onSyncNow={manualDrain}
        onDismiss={onDismiss}
      />
      {waitingWorker && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 bg-hq-ink px-4 py-3 font-path-body text-[13px] text-white"
        >
          A new version of Founders Weekend is ready.
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
