/**
 * THE WEBHOOK-RACE BRIDGE, AS A HEADLESS LOOP (v3 plan Unit 9 review).
 *
 * `/start/arrival` is Stripe's `success_url` (`deposit-core.ts`), and deposit
 * checkout is LIVE — the dashboard's reserve buttons still open it. A family
 * lands here SECONDS after paying, which is usually BEFORE Stripe's webhook has
 * committed their claim row. That is the whole reason the screen exists: for a
 * few seconds the truthful answer to "did my payment work?" is not in our
 * database yet, so a page that reads once and reports what it finds will tell a
 * paying family nothing, or worse, something wrong.
 *
 * The bridge is: KEEP ASKING, and treat every absence as "not yet".
 *   - A missing claim row is the WEBHOOK RACING US, not an error. (The API
 *     route already turns that into a `provisioning` view, and heals the row.)
 *   - A failed fetch is a tick that learned nothing, not a failure.
 *   - A terminal answer commits only after TWO CONSECUTIVE identical reads
 *     (`TERMINAL_CONFIRMATIONS`) — one read of `complete` could be a stale
 *     replica or a mid-write blip.
 *   - The poll is BOUNDED (`ARRIVAL_POLL_MAX_ATTEMPTS` × the interval, ~60s)
 *     and a timeout is STILL PENDING, never failure.
 *
 * Every one of those decisions belongs to `arrival-rules.ts` (`pollStep`,
 * `arrivalView`) and is tested there. What lives HERE is the loop that drives
 * them — the part the archived v2 client component held inline, where nothing
 * could reach it: `app/start/**` is outside the vitest include allowlist by
 * design, so a scheduling bug in the bridge was untestable. The loop takes its
 * clock and its transport as deps, so this module is the bridge's test surface
 * and `ArrivalWatch.tsx` is a render of the phases it emits.
 *
 * PURE-ADJACENT: no React, no fetch, no timers of its own.
 */

import {
  ARRIVAL_POLL_INTERVAL_MS,
  pollStep,
  type ArrivalView,
} from "@/app/lib/funnel/arrival-rules";

/** What the screen is showing. `leave` is the only non-render answer: the
 *  family has no live deposit (refunded, cancelled, or someone else's link),
 *  and the honest destination is the dashboard, exactly as in v2. */
export type ArrivalPhase =
  | { kind: "polling"; view: ArrivalView | null }
  | { kind: "confirmed"; view: ArrivalView }
  | { kind: "timeout" }
  | { kind: "leave" };

export type ArrivalPollDeps = {
  /** One read of `/api/funnel/arrival`. MUST resolve `null` rather than throw
   *  on any transport or parse failure — see `readViewOrNull`. */
  readView: () => Promise<ArrivalView | null>;
  /** Injected so tests run instantly and the component uses `setTimeout`. */
  sleep: (ms: number) => Promise<void>;
  /** Called on every phase change, including each polling tick. */
  onPhase: (phase: ArrivalPhase) => void;
  /** Cooperative cancellation (unmount, or a re-run superseding this one).
   *  Checked after every await, because both awaits can outlive the caller. */
  cancelled?: () => boolean;
};

/**
 * Run the bridge to a terminal phase. Resolves with the phase it settled on
 * (or the last one emitted, if cancelled), so a caller can await a whole run
 * in a test without reaching into the callback.
 */
export async function runArrivalPoll(deps: ArrivalPollDeps): Promise<ArrivalPhase> {
  const cancelled = deps.cancelled ?? (() => false);
  let attempt = 0;
  let previousView: ArrivalView["kind"] | null = null;
  let terminalStreak = 0;
  let last: ArrivalPhase = { kind: "polling", view: null };

  const settle = (phase: ArrivalPhase): ArrivalPhase => {
    last = phase;
    deps.onPhase(phase);
    return phase;
  };

  for (;;) {
    if (cancelled()) return last;
    attempt += 1;
    const view = await deps.readView();
    if (cancelled()) return last;

    if (view?.kind === "redirect_dashboard") return settle({ kind: "leave" });

    // A read that learned nothing (network blip, 5xx) is indistinguishable
    // from "the webhook has not landed yet", and both mean the same thing to
    // the family: keep waiting. Never an error state.
    const effective: ArrivalView = view ?? { kind: "provisioning" };
    const step = pollStep({ attempt, view: effective.kind, previousView, terminalStreak });
    previousView = effective.kind;

    if (step.action === "stop_confirmed") return settle({ kind: "confirmed", view: effective });
    if (step.action === "stop_timeout") return settle({ kind: "timeout" });

    terminalStreak = step.terminalStreak;
    settle({ kind: "polling", view: effective });
    await deps.sleep(ARRIVAL_POLL_INTERVAL_MS);
  }
}

/**
 * The transport, factored out of the component so the "a failure is a tick
 * that learned nothing" rule is in the same module as the loop that depends
 * on it. A non-OK response and a thrown fetch are the SAME answer: null.
 */
export function readViewOrNull(fetchImpl: typeof fetch, childId: string) {
  return async (): Promise<ArrivalView | null> => {
    try {
      const res = await fetchImpl(
        `/api/funnel/arrival?child=${encodeURIComponent(childId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { view?: ArrivalView };
      return body.view ?? null;
    } catch {
      return null;
    }
  };
}
