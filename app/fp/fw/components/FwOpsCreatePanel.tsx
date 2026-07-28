"use client";

/**
 * The inline weekend-creation panel (ops redesign Unit 2; R11–R12): mounted by
 * the ops LIST page at the top of the list area, opened and closed by the +
 * in the tab row through `FwOpsChrome`'s context (the shell owns the flag; see
 * that file for why the state cannot live here or in the row).
 *
 * It wraps `FwCohortCreate` — the form itself is unchanged — and takes over the
 * SUCCESS rendering through the form's `onCreated` seam: the panel collapses
 * (an expanded form over a list that already shows the new row is stale
 * chrome) and a one-line note names the weekend WITH a link to its ops page,
 * because "created" is only half the job — guides and the board link are next,
 * and they live on the cohort page. The form's own `router.refresh()` repaints
 * the list behind the note, so the row and the note appear together.
 *
 * Replaces the always-visible "New weekend" section the page used to render
 * (the Unit 1 state), and with it the `#new-weekend` anchor — the + is a real
 * client seam everywhere now, so there is no Link fallback left to land.
 */

import { useState } from "react";
import Link from "next/link";
import FwCohortCreate from "./FwCohortCreate";
import { useFwOpsCreate } from "./FwOpsChrome";

export default function FwOpsCreatePanel() {
  const ctx = useFwOpsCreate();
  const [created, setCreated] = useState<{ cohortId: string; slug: string } | null>(null);

  // Mounted outside the ops shell: nothing can toggle it, so render nothing —
  // inert and visible in review, never a crash.
  if (!ctx) return null;
  const { open, setOpen } = ctx;

  if (!open) {
    // The success note outlives the collapse — it is the only pointer to the
    // new weekend that does not require finding it in the repainted list.
    if (!created) return null;
    return (
      <p
        role="status"
        className="mt-5 rounded-xl border border-verified/40 bg-verified/10 p-3 font-path-body text-sm leading-6 text-hq-ink"
      >
        Created <strong>{created.slug}</strong>.{" "}
        <Link
          href={`/fp/fw/ops/cohort/${created.cohortId}`}
          className="font-semibold underline underline-offset-2"
        >
          Open it
        </Link>{" "}
        to add guides and mint the board link.
      </p>
    );
  }

  return (
    <section aria-label="New weekend" className="mt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-path-display text-lg font-semibold tracking-tight text-hq-ink">
          New weekend
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-path-body text-sm text-hq-ink-soft underline underline-offset-2 hover:text-hq-ink"
        >
          Cancel
        </button>
      </div>
      <p className="mt-1.5 mb-4 font-path-body text-sm leading-6 text-hq-ink-soft">
        The end date and time set when the projected board&apos;s link expires — six hours
        after the weekend ends. Enter them in the host city&apos;s own clock.
      </p>
      <FwCohortCreate
        onCreated={(made) => {
          setCreated(made);
          setOpen(false);
        }}
      />
    </section>
  );
}
