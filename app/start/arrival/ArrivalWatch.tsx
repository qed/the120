"use client";

/**
 * THE ARRIVAL SCREEN, v3 (plan Unit 9 review).
 *
 * Stripe's `success_url` still lands here (`app/lib/funnel/deposit-core.ts`) and
 * deposit checkout is still live, so this route is NOT a retired v2 deep link —
 * it is a working payment return, and for one release it was a bare
 * `redirect("/dashboard")`. That bounced a family who had just paid onto a
 * dashboard that could not yet know about their payment, with no pending state
 * and no explanation, because the webhook usually has not committed their claim
 * row when they land.
 *
 * So the WEBHOOK-RACE BRIDGE is back, and it is the only thing about the v2
 * screen that came back. The ceremony (the acceptance-letter tile, the keys
 * card, the calendar note, the ProgressNavCard) stayed in `archive/`. This
 * component RENDERS PHASES and does nothing else: the loop, its bound, its
 * confirm-twice rule and its "a missing claim is the webhook racing us" reading
 * all live in `app/lib/funnel/arrival-poll.ts` + `arrival-rules.ts`, where the
 * vitest allowlist can reach them (`app/start/**` cannot be tested by design).
 * Nothing here imports from `archive/` — the logic was re-derived from the live
 * rules module the archived component was already calling.
 *
 * The four phases, and why each is honest:
 *  - polling   — "we are setting up", with the deposit already stated as in.
 *  - confirmed — the terminal answer, twice in a row: their kid's address and
 *                the real mail-forwarding state, then the dashboard.
 *  - timeout   — STILL PENDING, never failure, and it says the deposit went
 *                through so nobody reaches for their card a second time.
 *  - leave     — no live deposit (refunded/cancelled): the dashboard, exactly
 *                as v2 did, and never a screen implying an account exists.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ARRIVAL_SCREEN, arrivalCeremonyTitle } from "@/app/lib/funnel/arrival-rules";
import {
  readViewOrNull,
  runArrivalPoll,
  type ArrivalPhase,
} from "@/app/lib/funnel/arrival-poll";
import { V3Button } from "../v3-ui";

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function ArrivalWatch({ childId, firstName }: { childId: string; firstName: string }) {
  const [phase, setPhase] = useState<ArrivalPhase>({ kind: "polling", view: null });
  /** Bumped by "Check again" so the effect re-runs a whole fresh poll. */
  const [run, setRun] = useState(0);

  const retry = useCallback(() => {
    setPhase({ kind: "polling", view: null });
    setRun((n) => n + 1);
  }, []);

  useEffect(() => {
    let done = false;
    void runArrivalPoll({
      readView: readViewOrNull(fetch.bind(window), childId),
      sleep,
      cancelled: () => done,
      onPhase: (next) => {
        if (done) return;
        if (next.kind === "leave") {
          window.location.assign("/dashboard");
          return;
        }
        setPhase(next);
      },
    });
    return () => {
      done = true;
    };
  }, [childId, run]);

  const view = phase.kind === "confirmed" ? phase.view : null;

  return (
    <main className="v3-grain min-h-screen w-full bg-v3-cream text-v3-ink">
      <section className="mx-auto w-full max-w-xl px-5 py-16">
        <p className="v3-label text-v3-profit">{ARRIVAL_SCREEN.kicker}</p>

        {phase.kind === "timeout" ? (
          <>
            <h1 className="mt-3 font-path-display text-3xl leading-[1.1] font-black text-v3-ink">
              {ARRIVAL_SCREEN.timeout.title}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-v3-stone">
              {ARRIVAL_SCREEN.timeout.body}
            </p>
            <p className="mt-2 text-base leading-relaxed font-semibold text-v3-ink">
              {ARRIVAL_SCREEN.timeout.paid}
            </p>
            <div className="mt-8 space-y-3">
              <V3Button variant="ghost" onClick={retry}>
                {ARRIVAL_SCREEN.timeout.retry}
              </V3Button>
              <DashboardLink />
            </div>
          </>
        ) : view?.kind === "ready" ? (
          <>
            <h1 className="mt-3 font-path-display text-3xl leading-[1.1] font-black text-v3-ink">
              {arrivalCeremonyTitle(firstName)}
            </h1>
            <div className="mt-8 rounded-2xl border border-v3-ink/10 bg-white p-5 sm:p-6">
              <h2 className="v3-label text-v3-stone">{ARRIVAL_SCREEN.ready.title}</h2>
              {/* break-all: a family has to be able to read and retype it. */}
              <p className="mt-3 font-path-mono text-[15px] break-all text-v3-ink">
                {view.email}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-v3-stone">
                {ARRIVAL_SCREEN.ready.body}
              </p>
            </div>
            <div className="mt-4 rounded-2xl border border-v3-ink/10 bg-white p-5 sm:p-6">
              <h2 className="v3-label text-v3-stone">
                {ARRIVAL_SCREEN.ready.forwardingCardLabel}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-v3-stone">
                {view.forwarding === "active"
                  ? ARRIVAL_SCREEN.ready.forwardingActive
                  : view.forwarding === "pending_verification"
                    ? ARRIVAL_SCREEN.ready.forwardingPending
                    : ARRIVAL_SCREEN.ready.forwardingNone}
              </p>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-v3-stone">
              {ARRIVAL_SCREEN.ready.calendarNote}
            </p>
            <div className="mt-8">
              <Link
                href="/dashboard"
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-v3-profit px-6 py-3 font-path-display text-base font-semibold text-white transition-colors hover:bg-v3-profit-dark sm:w-auto"
              >
                {ARRIVAL_SCREEN.ready.cta}
              </Link>
            </div>
          </>
        ) : view?.kind === "setting_up" ? (
          <>
            <h1 className="mt-3 font-path-display text-3xl leading-[1.1] font-black text-v3-ink">
              {ARRIVAL_SCREEN.settingUp.title}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-v3-stone">
              {ARRIVAL_SCREEN.settingUp.body}
            </p>
            <div className="mt-8">
              <DashboardLink />
            </div>
          </>
        ) : (
          /* POLLING — including every tick that learned nothing. The claim row
             may not exist yet; that is the race, not an error. */
          <>
            <h1 className="mt-3 font-path-display text-3xl leading-[1.1] font-black text-v3-ink">
              {ARRIVAL_SCREEN.provisioning.title}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-v3-stone">
              {ARRIVAL_SCREEN.provisioning.body}
            </p>
            <div
              className="mt-8 h-1.5 w-40 overflow-hidden rounded-full bg-v3-ink/10"
              role="status"
              aria-label={ARRIVAL_SCREEN.provisioning.title}
            >
              <div className="h-full w-1/3 animate-pulse rounded-full bg-v3-profit" />
            </div>
            <div className="mt-8">
              <DashboardLink />
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function DashboardLink() {
  return (
    <Link
      href="/dashboard"
      className="v3-label inline-flex min-h-[44px] items-center text-v3-stone underline underline-offset-4 hover:text-v3-ink"
    >
      Parent dashboard
    </Link>
  );
}
