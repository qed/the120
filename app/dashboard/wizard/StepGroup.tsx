"use client";

import { useState } from "react";
import { BOOKING_URL, groups } from "@/app/lib/site";
import { StepSection, focusRing, type StepProps } from "./shared";

/**
 * The group pick (R1/R2). Five compact cards from site.ts as a semantic
 * radiogroup — all five visible on one mobile screen. Each card is a compact
 * select row (name + category + check circle); the long blurb/body collapses
 * into a native <details>/<summary> disclosure (the Faq.tsx idiom) that is a
 * SIBLING of the radio button, never nested inside it — expanding details can
 * never change the selection. No availability states — there are no
 * per-group caps, only the global 120 pool.
 */
export default function StepGroup({ child, set, n }: StepProps) {
  // Switch-away-from-Scholars confirm (R6): nothing mutates until confirmed.
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  const pick = (slug: string) => {
    if (slug === child.groupSlug) {
      // Re-affirming the current group cancels any pending switch.
      setPendingSwitch(null);
      return;
    }
    if (child.groupSlug === "scholars" && child.workshopIds.length > 0) {
      setPendingSwitch(slug);
      return;
    }
    setPendingSwitch(null);
    set({ groupSlug: slug });
  };

  const confirmSwitch = () => {
    if (!pendingSwitch) return;
    // One update: the new group AND the cleared workshop picks together.
    set({ groupSlug: pendingSwitch, workshopIds: [] });
    setPendingSwitch(null);
  };

  return (
    <StepSection
      n={n}
      title="Group"
      hint="Pick a group that makes sense for your kid. This can be changed at any time."
    >
      <div role="radiogroup" aria-label="Choose a group" className="grid gap-2 sm:grid-cols-2">
        {groups.map((g) => {
          const on = child.groupSlug === g.slug;
          return (
            <div
              key={g.slug}
              className={`rounded-xl border transition-colors ${
                on ? "border-red bg-red/5" : "border-line-strong bg-white"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(g.slug)}
                className={`flex w-full items-center justify-between gap-2 rounded-t-xl p-3 text-left ${focusRing} ${
                  on ? "" : "hover:bg-paper-2"
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-display text-sm font-bold text-ink">{g.name}</span>
                  <span className="block font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">
                    {g.category}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[0.55rem] ${
                    on ? "border-red bg-red text-white" : "border-line-strong text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
              {/* Disclosure is a sibling of the radio — reading never selects. */}
              <details className="group border-t border-line/60 px-3">
                <summary
                  className={`cursor-pointer list-none rounded py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted hover:text-ink ${focusRing}`}
                >
                  Details{" "}
                  <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <div className="pb-3">
                  <p className="text-xs font-semibold leading-5 text-ink">{g.blurb}</p>
                  <p className="mt-1.5 text-xs leading-5 text-ink-soft">{g.body}</p>
                </div>
              </details>
            </div>
          );
        })}
      </div>

      {pendingSwitch && (
        <div className="mt-4 rounded-xl border border-red bg-red/5 p-4">
          <p className="text-sm font-semibold text-ink">
            Switching from The Scholars clears {child.workshopIds.length} workshop selection
            {child.workshopIds.length === 1 ? "" : "s"}.
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-soft">
            Workshops belong to The Scholars — you can always switch back later, but the picks
            start fresh.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={confirmSwitch}
              className={`inline-flex h-9 items-center justify-center rounded-full bg-red px-4 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-white hover:bg-red-dark ${focusRing}`}
            >
              Switch &amp; clear picks
            </button>
            <button
              type="button"
              onClick={() => setPendingSwitch(null)}
              className={`inline-flex h-9 items-center justify-center rounded-full border border-line-strong px-4 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft hover:border-ink ${focusRing}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Undecided affordance (R17) */}
      <div className="mt-5 rounded-xl border border-dashed border-line-strong bg-paper-2 p-4">
        <p className="font-display text-sm font-bold text-ink">Not sure which group?</p>
        <p className="mt-1 text-sm leading-6 text-ink-soft">
          Most families pick where the kid&rsquo;s energy already lives — our staff confirm the
          fit at the review call, and the choice stays editable until a deposit is paid.
        </p>
        <a
          href={BOOKING_URL}
          className={`mt-2 inline-block rounded font-mono text-xs uppercase tracking-[0.12em] text-blue hover:text-red ${focusRing}`}
        >
          Book a 20-minute call →
        </a>
      </div>
    </StepSection>
  );
}
