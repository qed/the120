"use client";

/**
 * The Tier 1 moment host (T1 Unit 16; brief §5.1). Renders the replay of
 * unseen notification events as a sequence of compact, NON-MODAL moment
 * cards: two to four seconds each, in the order they happened, never
 * interrupting flow (no backdrop, no focus trap, no scroll lock — a fixed
 * corner card the student can ignore or tap through).
 *
 *   Trail celebrate — the wax stamp thumps (the globals.css `animate-stamp`
 *     keyframes, already reduced-motion-gated), a short chime (gated on user
 *     activation — browsers block autoplay before a gesture — and on
 *     reduced-motion; silence is a clean degrade).
 *   HQ celebrate — the status chip flips, the meter line ticks in.
 *   Amber (not yet / returned / reopened) — information, not judgement:
 *     gentle rise, amber never red, no error iconography.
 *
 * Reduced motion suppresses MOTION, never the MOMENT: the shell's
 * `<MotionConfig reducedMotion="user">` kills transform animations and the
 * per-component gates below skip the extras — the card still appears, holds,
 * and reads identically.
 *
 * The seen cursor: a moment is stamped seen when it finishes (or is tapped
 * through) — a tab closed mid-replay leaves the rest unstamped, so they fire
 * again next open (the one case Tier 1 deliberately replays). Events that
 * must never play (superseded — no re-celebration — or unresolvable) arrive
 * as `stampWithoutPlaying` and advance the cursor silently. On
 * /path/notifications the host stays quiet entirely: the feed page IS the
 * presentation there and owns its own stamping.
 *
 * All decisions (ordering, what plays, copy, register) are made by the pure
 * `celebration-tier1-rules` module server-side — this component only renders
 * and keeps time.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { markNotificationEventsSeen } from "@/app/path/lib/actions/notifications";
import { MOMENT_DISPLAY_MS, MOMENT_GAP_MS, type Moment } from "@/app/path/lib/celebration-tier1-rules";
import type { Skin } from "@/app/path/lib/skin-tokens";
import { StatusChip } from "./system/StatusChip";
import { Icon } from "./system/Icon";
import { cn } from "./system/cn";

/** A short two-note chime for a Trail stamp — only after a real user gesture
 *  (autoplay policy) and never under reduced motion. Failure is silence. */
function playTrailChime() {
  try {
    if (typeof window === "undefined") return;
    const activation = (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (!activation?.hasBeenActive) return;
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    for (const [freq, at] of [
      [659.25, 0], // E5
      [987.77, 0.09], // B5
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.035, now + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.3);
    }
    // Close once the notes are done so we never hold an audio session open.
    window.setTimeout(() => void ctx.close().catch(() => undefined), 600);
  } catch {
    // Silence is the correct failure mode for a garnish.
  }
}

export function TaskVerifiedMoment({
  skin,
  moments,
  stampWithoutPlaying,
}: {
  skin: Skin;
  moments: Moment[];
  stampWithoutPlaying: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();
  const trail = skin === "trail";
  // The feed page presents (and stamps) everything itself — the host is quiet there.
  const onFeedPage = pathname.startsWith("/path/notifications");

  const [queue, setQueue] = useState<Moment[]>([]);
  const [current, setCurrent] = useState<Moment | null>(null);
  const enqueuedRef = useRef<Set<string>>(new Set());
  const stampedRef = useRef<Set<string>>(new Set());
  const playedAnyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Fire-and-forget cursor stamp — every awaited action is guarded (the
   *  guard can redirect(), which throws outside the action body). */
  const stamp = useCallback((ids: string[]) => {
    const fresh = ids.filter((id) => !stampedRef.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) stampedRef.current.add(id);
    void (async () => {
      try {
        await markNotificationEventsSeen({ eventIds: fresh });
      } catch {
        // A failed stamp self-heals: the event replays next open.
      }
    })();
  }, []);

  // Silent cursor advances (superseded / unresolvable — never played).
  useEffect(() => {
    if (stampWithoutPlaying.length > 0) stamp(stampWithoutPlaying);
  }, [stampWithoutPlaying, stamp]);

  // Enqueue newly-arrived moments once each (props refresh on router.refresh()).
  useEffect(() => {
    if (onFeedPage) return; // the feed page owns presentation there
    const fresh = moments.filter((m) => !enqueuedRef.current.has(m.eventId));
    if (fresh.length === 0) return;
    for (const m of fresh) enqueuedRef.current.add(m.eventId);
    setQueue((q) => [...q, ...fresh]);
  }, [moments, onFeedPage]);

  // Navigating to the feed mid-replay hands presentation over to the page —
  // adjust during render (the React "information from previous renders"
  // pattern), not in an effect.
  const [wasOnFeedPage, setWasOnFeedPage] = useState(onFeedPage);
  if (onFeedPage !== wasOnFeedPage) {
    setWasOnFeedPage(onFeedPage);
    if (onFeedPage) {
      setCurrent(null);
      setQueue([]);
    }
  }

  const advance = useCallback(() => {
    setCurrent((m) => {
      if (m) {
        stamp([m.eventId]);
        playedAnyRef.current = true;
      }
      return null;
    });
  }, [stamp]);

  // Promote the queue head after the inter-moment gap (immediately for the
  // first). Each effect owns exactly ONE timer with its own cleanup — a
  // shared timer ref here would let the re-run's cleanup cancel the hold.
  useEffect(() => {
    if (current !== null || queue.length === 0 || onFeedPage) return;
    const t = setTimeout(
      () => {
        if (!mountedRef.current) return;
        setQueue((q) => q.slice(1));
        setCurrent(queue[0]);
      },
      playedAnyRef.current ? MOMENT_GAP_MS : 0
    );
    return () => clearTimeout(t);
  }, [current, queue, onFeedPage]);

  // Hold the current moment on screen, then stamp it and move on.
  useEffect(() => {
    if (current === null) return;
    const t = setTimeout(() => {
      if (mountedRef.current) advance();
    }, MOMENT_DISPLAY_MS);
    return () => clearTimeout(t);
  }, [current, advance]);

  // Chime with the stamp — Trail celebrations only (§5.1; HQ is silent).
  useEffect(() => {
    if (current?.tone === "celebrate" && trail && !reduce) playTrailChime();
  }, [current, trail, reduce]);

  // After a drain that played something, refresh once — the nav badge and any
  // open surface pick up the stamped cursor.
  useEffect(() => {
    if (current === null && queue.length === 0 && playedAnyRef.current) {
      playedAnyRef.current = false;
      router.refresh();
    }
  }, [current, queue, router]);

  const surface = trail ? "border-trail-mist bg-trail-surface" : "border-hq-border bg-hq-surface";
  const ink = trail ? "text-trail-ink" : "text-hq-ink";
  const inkSoft = trail ? "text-trail-ink-soft" : "text-hq-ink-soft";

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-40 flex justify-center lg:inset-x-auto lg:bottom-6 lg:right-6 lg:justify-end"
    >
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.eventId}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="pointer-events-auto w-full max-w-[380px]"
          >
            <button
              type="button"
              onClick={advance}
              aria-label={`${current.eyebrow} — ${current.headline}. Dismiss.`}
              className={cn(
                "relative block w-full overflow-hidden rounded-[18px] border p-5 text-center shadow-lg",
                surface
              )}
            >
              {/* the mark — stamp thump (Trail) / chip flip (HQ) / quiet amber dot */}
              {current.tone === "celebrate" ? (
                trail ? (
                  <span key={current.eventId} className="animate-stamp mb-1.5 inline-flex text-wax">
                    <Icon name="stamp" size={44} strokeWidth={1.8} />
                  </span>
                ) : (
                  <motion.span
                    initial={reduce ? false : { rotateX: 90, opacity: 0 }}
                    animate={{ rotateX: 0, opacity: 1 }}
                    transition={{ delay: 0.12, type: "spring", stiffness: 260, damping: 20 }}
                    className="mb-2 inline-flex"
                  >
                    <StatusChip state="verified" />
                  </motion.span>
                )
              ) : (
                <span
                  className={cn(
                    "mb-1.5 inline-flex",
                    current.tone === "amber" ? "text-not-yet" : "text-awaiting"
                  )}
                >
                  <Icon name={current.tone === "amber" ? "circle-dot" : "clock"} size={26} />
                </span>
              )}

              <div
                className={cn(
                  "font-path-body text-[11px] font-bold uppercase tracking-[0.05em]",
                  current.tone === "celebrate" ? "text-verified" : current.tone === "amber" ? "text-not-yet" : "text-awaiting"
                )}
              >
                {current.eyebrow}
              </div>
              <h3 className={cn("mt-1 font-path-display text-[19px] font-semibold leading-snug", ink)}>
                {current.headline}
              </h3>

              {/* the adult's words — the best reward in the system */}
              {current.note && (
                <div
                  className={cn(
                    "mt-2.5 rounded-xl px-3.5 py-2.5 font-path-body text-[13px] italic leading-relaxed",
                    current.tone === "celebrate" ? "bg-verified/8" : "bg-not-yet/8",
                    ink
                  )}
                >
                  &ldquo;{current.note}&rdquo;
                </div>
              )}

              {current.body && !current.note && (
                <p className={cn("mt-2 font-path-body text-[12.5px] leading-snug", inkSoft)}>{current.body}</p>
              )}

              {/* the meter ticks — mono, truthful, current count only */}
              {current.detail && (
                <motion.p
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35 }}
                  className={cn("mt-2.5 font-path-mono text-[12px] font-semibold", inkSoft)}
                >
                  {current.detail}
                </motion.p>
              )}

              {/* the hold bar — how long the moment stays; static under reduced motion */}
              <motion.span
                aria-hidden
                initial={{ scaleX: 1 }}
                animate={reduce ? { scaleX: 1 } : { scaleX: 0 }}
                transition={reduce ? undefined : { duration: MOMENT_DISPLAY_MS / 1000, ease: "linear" }}
                className={cn(
                  "absolute inset-x-0 bottom-0 h-[3px] origin-left",
                  current.tone === "celebrate" ? "bg-verified/45" : current.tone === "amber" ? "bg-not-yet/45" : "bg-awaiting/45"
                )}
              />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
