"use client";

/**
 * THE FIRST PROFIT CARD — the per-kid "Login" handoff, extracted so the per-kid
 * portal (app/dashboard/kids/[id]/KidPortal.tsx) mounts it verbatim rather than
 * re-implementing the popup discipline. It carries the WHOLE shipped mint path,
 * unchanged from the launcher it came out of:
 *
 * ── THE "LOGIN" HANDOFF ──
 * The button mints a one-time, child-bound handoff code for THIS child and opens
 * firstprofit.school/auth/enter#<code> in a NEW TAB. It reuses the shipped mint
 * path (`v3MintHandoffAction`, ownership enforced in the WHERE clause
 * server-side) and the shipped new-tab discipline from the account-ready screen:
 * open the blank tab SYNCHRONOUSLY inside the click handler, before any await, or
 * a popup blocker eats it. `fallback` and `minted` both carry a destination and
 * navigate alike; a blocked tab surfaces a visible manual link rather than a
 * silent dead end.
 *
 * Mobile-first: base classes are the ~390px phone. No em dashes in parent-facing
 * copy (the copy rule).
 */

import { useEffect, useRef, useState } from "react";
import { v3MintHandoffAction } from "@/app/start/actions";
import type { Child } from "./data";

const FP_BLURB =
  "Start a real business through 5 phases, 25 steps and 125 sub-steps. Every win builds a panel of your own custom graphic novel.";

/** The First Profit bars mark (already shipped for the path PWA / signup). */
function FpMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/path-logo.svg" alt="" aria-hidden className="h-10 w-10 flex-none" />
  );
}

export default function FirstProfitCard({ child }: { child: Child }) {
  const [opening, setOpening] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // Cleared on unmount. Read before every setState and every navigation the
  // detached mint performs (the same guard StepAccountReady.tsx ships, Unit 3
  // review FIX 5): the mint keeps resolving after this card is gone, and a
  // setState on an unmounted tree (or a navigate of a tab the parent already
  // left) is the bug that guard exists to prevent.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The SAME null signal the Login-info panel shows below ("Not set up yet"):
  // a kid with no FP account has no handoff to mint. Rendering an enabled Login
  // for them burns a real single-use code and lands on a not_child error.
  const notSetUp = child.fpUsername == null;

  const login = () => {
    if (opening) return;
    // SYNCHRONOUS OPEN, BEFORE ANY AWAIT (the shipped account-ready rule): a
    // window.open after an await has lost the user-gesture context and every
    // popup blocker eats it.
    // NO `noopener` IN THE FEATURE STRING: window.open returns NULL whenever
    // noopener is requested, which would null the handle this mint keeps and
    // force EVERY family onto the manual-link path (the shipped documented bug).
    // The destination is first-party, so win.opener is nulled directly instead.
    const win = window.open("", "_blank");
    try {
      if (win) win.opener = null;
    } catch {
      // First-party destination either way; nothing to do.
    }
    setOpening(true);
    setManualUrl(null);
    setLoginError(null);
    void (async () => {
      const result = await v3MintHandoffAction({ childId: child.id });
      // THE UNMOUNT GUARD (ported from StepAccountReady, review FIX 5). If this
      // card is gone the parent has chosen somewhere else to be; the only thing
      // left to do is not leave a blank popup behind, and never setState.
      if (!mounted.current) {
        win?.close();
        return;
      }
      if (result.kind === "failed") {
        win?.close();
        setOpening(false);
        setLoginError("We could not open First Profit just now. Try again.");
        return;
      }
      // `minted` and `fallback` both carry a working destination.
      if (win) {
        win.location.href = result.destination;
        setOpening(false);
        return;
      }
      // The popup blocker won: surface the link rather than a silent dead end.
      // Made observable (per the noopener learning): a silent fallback once hid
      // that EVERY family was taking this path.
      console.warn("[dashboard] new tab blocked; surfacing the manual handoff link");
      setManualUrl(result.destination);
      setOpening(false);
    })();
  };

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <FpMark />
          <div className="min-w-0">
            <p className="font-path-display text-xl font-black leading-none text-v3-ink">
              First Profit
            </p>
            <p className="mt-2 text-sm leading-relaxed text-v3-stone">{FP_BLURB}</p>
          </div>
        </div>
        <div className="flex flex-none flex-col items-stretch gap-2 sm:items-end">
          <button
            type="button"
            onClick={login}
            disabled={opening || notSetUp}
            title={notSetUp ? "This kid does not have a First Profit account yet." : undefined}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-v3-profit px-8 py-3 font-path-display text-base font-semibold text-white shadow-[0_4px_0_0_#0f4227] transition hover:-translate-y-0.5 hover:bg-v3-profit-dark active:translate-y-0 disabled:cursor-not-allowed disabled:bg-v3-ink/15 disabled:text-v3-ink/40 disabled:shadow-none disabled:hover:translate-y-0"
          >
            {notSetUp ? "Not set up yet" : opening ? "Opening..." : "Login"}
          </button>
          <button
            type="button"
            onClick={() => setInfoOpen((v) => !v)}
            aria-expanded={infoOpen}
            className="v3-label inline-flex min-h-[44px] items-center justify-center text-v3-stone underline underline-offset-4 transition-colors hover:text-v3-ink"
          >
            Login info
          </button>
        </div>
      </div>

      {infoOpen && (
        <div className="mt-4 rounded-2xl border border-v3-ink/10 bg-v3-cream/60 p-4">
          <p className="v3-label text-v3-stone">Username</p>
          {/* break-all: an email-shaped handle must wrap inside a 390px card
              rather than push the page sideways. */}
          <p className="mt-1 break-all font-path-mono text-sm text-v3-ink">
            {child.fpUsername ?? "Not set up yet"}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-v3-stone">
            Your kid signs in with this username. Forgot the password? On the login page they
            can also use &ldquo;Email my parent a code&rdquo; and we will send you a one-time
            code.
          </p>
        </div>
      )}

      {manualUrl && (
        <p className="mt-3 text-sm leading-relaxed text-v3-stone">
          Your browser blocked the new tab.{" "}
          <a
            href={manualUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-v3-profit underline underline-offset-4"
          >
            Open First Profit
          </a>
        </p>
      )}
      {loginError && (
        <p className="mt-3 text-sm leading-relaxed font-medium text-v3-one20" role="alert">
          {loginError}
        </p>
      )}
    </div>
  );
}
