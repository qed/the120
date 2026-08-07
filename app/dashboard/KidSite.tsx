"use client";

import { useState } from "react";
import { setFpSitePublishedAction } from "@/app/lib/fp/actions/fp-site-parent";
import {
  parentSiteControl,
  parentSiteStatusLine,
  type ParentSiteRow,
} from "@/app/lib/fp/fp-public-site-rules";

/**
 * THE PARENT'S TAKE-OFFLINE CONTROL for one child's public page
 * (real-public-site R21/R22; restored onto `/dashboard` after v3 plan Unit 10
 * retired `/fp/family`, which used to carry it).
 *
 * This is the control the R21 launch email promises: "You can take the page
 * offline any time from your family dashboard." Every published family got that
 * sentence, so the button has to exist wherever that sentence points.
 *
 * LAYOUT ONLY. Which control to offer is `parentSiteControl` (pure, tested);
 * whether the caller may touch this page at all, and whether a republish is
 * even legal, belong to `fp-site-parent-core` and are re-decided there on every
 * call. Nothing this component renders is trusted by the server: the action
 * takes a child id, and the core answers `forbidden` for any child the session
 * does not own.
 *
 * ── THE OPERATOR LOCK ──
 * A page The 120 took down shows the honest line and NO button. A parent
 * republish cannot clear a lock (the core never writes that column), so a
 * button here would flip a flag and change nothing a visitor can see. The core
 * re-derives the status after the write, so even if this branch were wrong the
 * page would report `offline` rather than claim to be live.
 *
 * Mobile-first: one column, 44px controls, the handle wraps rather than pushing
 * a 390px card sideways.
 */
export default function KidSite({ site }: { site: ParentSiteRow }) {
  const [row, setRow] = useState(site);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const control = parentSiteControl(row);

  const toggle = async (published: boolean) => {
    setBusy(true);
    setError(null);
    const result = await setFpSitePublishedAction({ childId: row.childId, published });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // The SERVER's re-derived row, never an optimistic guess: a republish under
    // an operator lock comes back `offline`, and the card says so.
    setRow(result.site);
  };

  const pageUrl = `https://firstprofit.school/${row.handle}`;
  const buttonClass =
    "mt-3 inline-flex h-11 w-full items-center justify-center rounded-full border border-hq-border-strong bg-white px-4 font-path-mono text-[0.65rem] uppercase tracking-[0.1em] text-hq-ink transition-colors hover:bg-hq-sunken disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="mt-4 border-t border-hq-border pt-4">
      <p className="font-path-mono text-[0.6rem] uppercase tracking-[0.1em] text-hq-ink-muted">
        Public page
      </p>
      {/* `break-all`: a 20-character handle on a 390px card must wrap, not
          push the page sideways. */}
      {control === "take-offline" ? (
        <a
          href={pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block break-all font-path-mono text-sm text-hq-ink underline underline-offset-2"
        >
          firstprofit.school/{row.handle}
        </a>
      ) : (
        <p className="mt-1 break-all font-path-mono text-sm text-hq-ink-muted">
          firstprofit.school/{row.handle}
        </p>
      )}
      <p className="mt-2 text-sm leading-6 text-hq-ink-soft">{parentSiteStatusLine(row)}</p>

      {control === "take-offline" && (
        <button type="button" onClick={() => toggle(false)} disabled={busy} className={buttonClass}>
          {busy ? "Working…" : "Take the page offline"}
        </button>
      )}
      {control === "put-back-online" && (
        <button type="button" onClick={() => toggle(true)} disabled={busy} className={buttonClass}>
          {busy ? "Working…" : "Put the page back online"}
        </button>
      )}

      {error && (
        <p className="mt-3 text-sm leading-6 text-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
