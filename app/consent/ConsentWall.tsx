"use client";

import { useEffect, useRef, useState } from "react";
import { acceptConsentWallAction, declineConsentWallAction } from "./actions";

/**
 * THE CONSENT WALL's client half — the two buttons and the three states the
 * screen can be in. Everything legally load-bearing (the text, the version) is
 * rendered by the SERVER page and handed down as props, so this component can
 * never be the reason a parent saw different words than the record says.
 *
 * ── ⚠ IT IS A MODAL IN LOOKS ONLY. IT IS NOT DISMISSABLE. ──
 * There is deliberately NO Escape handler, NO backdrop click-to-close, NO close
 * X, and no focus trap to escape from because there is nothing to return to.
 * The affordances a real dialog owes its user all exist to let them leave; this
 * screen exists precisely because leaving is what must stop. The only two ways
 * out are the two buttons, and one of them is honest refusal.
 *
 * ── ACCESSIBILITY (review 2026-08-10) ──
 * This interstitial is the ONLY screen between a parent and a legal decision, so
 * every one of these is load-bearing rather than polish:
 *   - `role="alertdialog"` with `aria-labelledby`/`aria-describedby`. An earlier
 *     comment here refused the role on the grounds that `aria-modal` "would
 *     promise an Escape that does not exist" — that was simply WRONG. ARIA
 *     carries no such promise; the dismissal keys are an APG authoring pattern,
 *     not a semantic of the role. What the role does buy is real: a screen
 *     reader announces the container, names it from the heading, and reads the
 *     description, instead of dropping the user into an unnamed `div`.
 *     `alertdialog` rather than `dialog` because this interrupts.
 *   - The policy text lives in a SCROLLABLE region, so it is focusable
 *     (`tabIndex={0}`) and named. A keyboard-only user literally could not
 *     scroll to read what they were agreeing to before this.
 *   - The error is a `role="alert"` live region; a failed submit was silent.
 *   - The decline confirmation is a `role="status"` AND takes focus, because it
 *     replaces the two buttons the user was standing on.
 *   - `aria-busy` while a submit is in flight.
 *
 * ── MOBILE ──
 * Sized from 320px up: a single column, `min-h-dvh` rather than a fixed height,
 * the long policy text in its own scroll region (`overflow-y-auto`) so the
 * buttons never scroll off, and the buttons stacked (`flex-col`) below `sm` so
 * neither is ever squeezed under a 44px tap target. Nothing here has a fixed
 * width, so 320 and 390 differ only in how the text wraps.
 */
export function ConsentWall({
  policyText,
  policyVersion,
  /** TEST-ONLY SEAM, the `initialOpen` idiom from app/dashboard/KidCredentials.
   *  This repo's vitest renders with `renderToStaticMarkup`, which captures only
   *  the FIRST render and cannot click — so asserting the decline
   *  confirmation's semantics needs it to start shown. Production never passes
   *  it (default false = the two buttons, the shipped behaviour). */
  initialDeclined = false,
  /** TEST-ONLY SEAM, same reason as `initialDeclined`: the error state is only
   *  reachable through a click this environment cannot perform. */
  initialError = null,
}: {
  policyText: string;
  policyVersion: string;
  initialDeclined?: boolean;
  initialError?: string | null;
}) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [declined, setDeclined] = useState(initialDeclined);
  const [error, setError] = useState<string | null>(initialError);
  const declinedRef = useRef<HTMLDivElement | null>(null);

  // MOVE FOCUS INTO THE CONFIRMATION. The decline replaces the two buttons the
  // user was standing on; without this, focus falls back to <body> and a
  // keyboard or screen-reader user is left nowhere, with no idea anything
  // happened. `role="status"` announces it; this is what lets them read it.
  useEffect(() => {
    if (declined) declinedRef.current?.focus();
  }, [declined]);

  const accept = async () => {
    setBusy("accept");
    setError(null);
    const res = await acceptConsentWallAction();
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    // A full reload, not a router push: the wall's redirects live in the server
    // page gates, and a hard navigation re-runs them against the row that was
    // just written rather than against a cached RSC payload.
    window.location.assign("/dashboard");
  };

  const decline = async () => {
    setBusy("decline");
    setError(null);
    const res = await declineConsentWallAction();
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    // Stay on the wall. Declining is not consenting, so nothing about their
    // access changes — and nothing about their data does either.
    setDeclined(true);
  };

  return (
    <div
      // `alertdialog`, not a bare div: it interrupts, it is named by its own
      // heading and described by its own lead paragraph. See the header — the
      // role promises no Escape key, and this screen deliberately has none.
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="consent-wall-title"
      aria-describedby="consent-wall-lede"
      aria-busy={busy !== null}
      className="fixed inset-0 z-50 flex min-h-dvh w-full items-start justify-center overflow-y-auto bg-black/60 px-3 py-6 sm:items-center sm:px-6"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl sm:p-6">
        <h1 id="consent-wall-title" className="text-lg font-semibold leading-6 sm:text-xl">
          One thing before you continue
        </h1>
        <p id="consent-wall-lede" className="mt-2 text-sm leading-6 text-black/70">
          Your family joined before we asked for this. Please read the notice below and
          tell us yes or no. We cannot keep running your child&rsquo;s account until you do.
        </p>

        <div
          // FOCUSABLE AND NAMED. A scroll container that no key can reach is a
          // notice a keyboard-only parent cannot read — and this is the text
          // they are being asked to agree to.
          tabIndex={0}
          role="region"
          aria-label={`Parental consent notice, version ${policyVersion}`}
          className="mt-4 max-h-[45vh] overflow-y-auto rounded-xl bg-black/5 p-3 sm:p-4"
        >
          {/* The policy text, VERBATIM from the server's own constant. */}
          <p className="whitespace-pre-wrap text-sm leading-6">{policyText}</p>
        </div>
        <p className="mt-2 text-xs leading-5 text-black/50">
          Notice version {policyVersion}
        </p>

        {declined ? (
          <div
            ref={declinedRef}
            role="status"
            tabIndex={-1}
            className="mt-5 rounded-xl border border-black/10 p-3 outline-none sm:p-4"
          >
            <p className="text-sm font-semibold leading-6">
              Thanks for telling us. We have recorded that you said no.
            </p>
            <p className="mt-1 text-sm leading-6 text-black/70">
              Nothing has been deleted or turned off. Please contact The 120 and we will
              sort out what happens next with you.
            </p>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:gap-3">
            <button
              type="button"
              onClick={accept}
              disabled={busy !== null}
              className="min-h-[44px] w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
            >
              {busy === "accept" ? "Saving..." : "I agree"}
            </button>
            <button
              type="button"
              onClick={decline}
              disabled={busy !== null}
              className="min-h-[44px] w-full rounded-xl border border-black/20 px-4 py-3 text-sm font-semibold disabled:opacity-60 sm:w-auto"
            >
              {busy === "decline" ? "Saving..." : "I do not agree"}
            </button>
          </div>
        )}

        {/* A LIVE REGION. A failed submit used to be completely silent to a
            screen reader — the parent tapped "I agree", nothing announced, and
            nothing appeared to change. */}
        {error && (
          <p role="alert" className="mt-3 text-sm leading-6 text-red">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
