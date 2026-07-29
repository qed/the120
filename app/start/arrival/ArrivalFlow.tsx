"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ARRIVAL_POLL_INTERVAL_MS,
  ARRIVAL_SCREEN,
  pollStep,
  type ArrivalView,
} from "@/app/lib/funnel/arrival-rules";

/**
 * The arrival poll shell (funnel wrap U7). Every decision — view mapping,
 * bounded await, consecutive terminal confirmation — comes from
 * arrival-rules (tested); this component only schedules fetches and
 * renders the answer. A poll timeout is STILL PENDING, never an error.
 */

type Phase =
  | { kind: "polling"; view: ArrivalView | null }
  | { kind: "committed"; view: ArrivalView }
  | { kind: "timeout" };

export function ArrivalFlow({ childId, firstName }: { childId: string; firstName: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "polling", view: null });
  const runRef = useRef(0);

  const startPolling = useCallback(() => {
    const run = (runRef.current += 1);
    let attempt = 0;
    let previousView: ArrivalView["kind"] | null = null;
    let terminalStreak = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled || runRef.current !== run) return;
      attempt += 1;
      let view: ArrivalView | null = null;
      try {
        const res = await fetch(`/api/funnel/arrival?child=${encodeURIComponent(childId)}`, {
          cache: "no-store",
        });
        if (res.ok) view = ((await res.json()) as { view: ArrivalView }).view;
      } catch {
        // A failed tick is just a tick that learned nothing.
      }
      if (cancelled || runRef.current !== run) return;

      if (view?.kind === "redirect_dashboard") {
        window.location.assign("/dashboard");
        return;
      }
      const effective = view ?? ({ kind: "provisioning" } as const);
      const step = pollStep({
        attempt,
        view: effective.kind,
        previousView,
        terminalStreak,
      });
      previousView = effective.kind;
      if (step.action === "stop_confirmed") {
        setPhase({ kind: "committed", view: effective });
        return;
      }
      if (step.action === "stop_timeout") {
        setPhase({ kind: "timeout" });
        return;
      }
      terminalStreak = step.terminalStreak;
      setPhase({ kind: "polling", view: effective });
      timer = setTimeout(tick, ARRIVAL_POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [childId]);

  useEffect(() => startPolling(), [startPolling]);

  const view = phase.kind === "committed" ? phase.view : phase.kind === "polling" ? phase.view : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center bg-paper px-6 py-14 text-ink">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-red">
        {ARRIVAL_SCREEN.kicker}
      </p>

      {phase.kind === "timeout" ? (
        <>
          <h1 className="mt-2 font-display text-3xl leading-tight">
            {ARRIVAL_SCREEN.timeout.title}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-soft">{ARRIVAL_SCREEN.timeout.body}</p>
          <button
            type="button"
            onClick={() => {
              setPhase({ kind: "polling", view: null });
              startPolling();
            }}
            className="mt-8 inline-flex h-11 items-center justify-center self-start rounded-full border border-line-strong px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink hover:border-ink"
          >
            {ARRIVAL_SCREEN.timeout.retry}
          </button>
        </>
      ) : view?.kind === "ready" ? (
        <>
          <h1 className="mt-2 font-display text-3xl leading-tight">
            {firstName ? `${firstName}'s 120 address` : ARRIVAL_SCREEN.ready.title}
          </h1>
          <div className="mt-6 rounded-2xl border border-line bg-paper-2 p-5">
            <p className="font-mono text-lg" data-testid="student-email">
              {view.email}
            </p>
          </div>
          <p className="mt-4 text-base leading-7 text-ink-soft">{ARRIVAL_SCREEN.ready.body}</p>
          <p className="mt-3 text-[13px] leading-5 text-ink-soft">
            {view.forwarding === "active"
              ? ARRIVAL_SCREEN.ready.forwardingActive
              : view.forwarding === "pending_verification"
                ? ARRIVAL_SCREEN.ready.forwardingPending
                : ARRIVAL_SCREEN.ready.forwardingNone}
          </p>
          <Link
            href="/dashboard"
            className="mt-8 inline-flex h-11 items-center justify-center self-start rounded-full border border-line-strong px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink hover:border-ink"
          >
            ← Back to the dashboard
          </Link>
        </>
      ) : view?.kind === "setting_up" && phase.kind === "committed" ? (
        <>
          <h1 className="mt-2 font-display text-3xl leading-tight">
            {ARRIVAL_SCREEN.settingUp.title}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-soft">{ARRIVAL_SCREEN.settingUp.body}</p>
          <Link
            href="/dashboard"
            className="mt-8 inline-flex h-11 items-center justify-center self-start rounded-full border border-line-strong px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink hover:border-ink"
          >
            ← Back to the dashboard
          </Link>
        </>
      ) : (
        <>
          <h1 className="mt-2 font-display text-3xl leading-tight">
            {ARRIVAL_SCREEN.provisioning.title}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-soft">
            {ARRIVAL_SCREEN.provisioning.body}
          </p>
          <div className="mt-8 h-1 w-40 overflow-hidden rounded-full bg-paper-2">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-red" />
          </div>
        </>
      )}
    </main>
  );
}
