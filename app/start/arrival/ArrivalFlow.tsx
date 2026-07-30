"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ARRIVAL_POLL_INTERVAL_MS,
  ARRIVAL_SCREEN,
  arrivalCeremonyTitle,
  pollStep,
  type ArrivalView,
} from "@/app/lib/funnel/arrival-rules";
import { navCardIdentityOnly } from "@/app/lib/funnel/nav-card-rules";
import { ProgressNavCard } from "@/app/components/funnel/ProgressNavCard";

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

export function ArrivalFlow({
  childId,
  firstName,
  parentName,
}: {
  childId: string;
  firstName: string;
  /** The nav card's identity line (X1): uppercased full parent name, or
   *  null when the read degraded — the card shows SIGN OUT alone. */
  parentName: string | null;
}) {
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
    <div className="min-h-screen bg-paper text-ink">
    {/* X1: post-ladder, the card shows name + SIGN OUT only (no bar). The
        acceptance-letter ceremony around this screen is batch B2 (E5). It
        mounts ABOVE the column (2026-07-30) so it holds the home nav's
        exact full-width geometry. */}
    <ProgressNavCard model={navCardIdentityOnly(parentName)} />
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-14">
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
        /* E5 (Peter, 2026-07-29): the acceptance-letter ceremony, READY state
           only — stamped logo tile, "{name}, you're in." in Georgia display,
           the YOUR KEYS card, the mail-forwarding card, the calendar note,
           and the red dashboard CTA. Presentation only: the facts (address +
           forwarding state) and the poll/terminal logic are W16/wrap-U7's,
           untouched. W16 still means no password exists, so the keys card
           carries the address and the honest no-password body instead of the
           prototype's fallback-password rows. */
        <>
          <div className="mt-4 text-center">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-ink">
              <Image src="/path-logo.svg" alt="" width={34} height={32} unoptimized />
            </span>
            <h1 className="display mt-4 text-3xl text-ink">
              {arrivalCeremonyTitle(firstName)}
            </h1>
          </div>
          <div className="mt-6 rounded-2xl border border-line bg-white px-5 py-4">
            <p className="font-mono text-[0.65rem] tracking-[0.14em] text-red">
              {ARRIVAL_SCREEN.ready.keysLabel}
            </p>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-ink-soft">
                {ARRIVAL_SCREEN.ready.emailRowLabel}
              </span>
              <span className="font-mono text-[13px] font-semibold" data-testid="student-email">
                {view.email}
              </span>
            </div>
            <p className="mt-3 text-[13px] leading-5 text-ink-soft">
              {ARRIVAL_SCREEN.ready.body}
            </p>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
            <div className="border-b border-line bg-paper-2 px-4 py-2.5">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-soft">
                {ARRIVAL_SCREEN.ready.forwardingCardLabel}
              </p>
            </div>
            <p className="px-4 py-3 text-[13px] leading-5 text-ink-soft">
              {view.forwarding === "active"
                ? ARRIVAL_SCREEN.ready.forwardingActive
                : view.forwarding === "pending_verification"
                  ? ARRIVAL_SCREEN.ready.forwardingPending
                  : ARRIVAL_SCREEN.ready.forwardingNone}
            </p>
          </div>
          <div className="mt-4 rounded-[13px] bg-paper-2 px-4 py-3">
            <p className="text-[13px] leading-5 text-ink">
              {ARRIVAL_SCREEN.ready.calendarNote}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
          >
            {ARRIVAL_SCREEN.ready.cta}
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
    </div>
  );
}
