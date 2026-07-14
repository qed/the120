"use client";

import { useState } from "react";
import { BOOKING_URL, groups } from "@/app/lib/site";
import { StepSection, focusRing, type StepProps } from "./shared";

/**
 * Unit 4 — the binding group pick. Five cards from site.ts as a semantic
 * radiogroup (buttons carry role="radio", so Enter/Space work natively and
 * every card is keyboard-reachable). No availability states — there are no
 * per-group caps, only the global 120 pool (R16).
 */
export default function StepGroup({ child, set, n }: StepProps & { n: string }) {
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
      hint="Pick the group where your kid belongs. This seeds their review — and stays editable until a deposit is paid."
    >
      <div role="radiogroup" aria-label="Choose a group" className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => {
          const on = child.groupSlug === g.slug;
          return (
            <button
              key={g.slug}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick(g.slug)}
              className={`rounded-xl border p-4 text-left transition-colors ${focusRing} ${
                on ? "border-red bg-red/5" : "border-line-strong bg-white hover:border-ink"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-sm font-bold text-ink">{g.name}</span>
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[0.55rem] ${
                    on ? "border-red bg-red text-white" : "border-line-strong text-transparent"
                  }`}
                >
                  ✓
                </span>
              </div>
              <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted">
                {g.category}
              </p>
              <p className="mt-2 text-xs font-semibold leading-5 text-ink">{g.blurb}</p>
              <p className="mt-1.5 text-xs leading-5 text-ink-soft">{g.body}</p>
            </button>
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
