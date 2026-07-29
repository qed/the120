"use client";

import type { Child } from "../data";

/** Props every wizard step component receives from the DossierEditor shell. */
export type StepProps = {
  child: Child;
  /** Local-state setter (debounced persist); explicit saves happen on Next. */
  set: (patch: Partial<Child>) => void;
  /** Step number for the section header ("01", "02", …). */
  n: string;
};

/** Repo-wide visible-focus pattern (site palette: blue outline). */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue";

/** The dossier's white card section — same visual grammar as the old editor. */
export function StepSection({
  n,
  title,
  hint,
  children,
}: {
  n: string;
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-6 sm:p-7">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-red">{n}</span>
        {/* U10 fidelity (audit drift 12): Georgia 400 display for wizard
            step headers — `.display`, never `font-display` (Space Grotesk). */}
        <h3 className="display text-lg text-ink">{title}</h3>
      </div>
      {hint && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
