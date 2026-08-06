"use client";

/**
 * Image Lab — Kit: the harvest
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6; origin R10).
 *
 * Kept results only, grouped by the `{{slot}}` template behind them. The
 * projection and the grouping are `projectKit` in `./lib/history-rules`, tested
 * in the node suite; this file renders the result and decides nothing.
 *
 * ── THE ONE THING THIS SURFACE MUST GET RIGHT ──────────────────────────────
 * ⚠ COPY YIELDS THE TEMPLATE, VERBATIM — `kitCopyText(group)`, which returns
 * `group.template` and nothing else. NOT the resolved prompt. The resolved prompt
 * has one child's product name and pitch baked into it: copying it into the panel
 * engine would hardcode one child's business into a template meant to be filled
 * from every child's record, and would carry that child's authored text into a
 * new home nobody audited. The slot values are shown BESIDE the template so the
 * reader can see what filled it — visible, but not part of what the button hands
 * over.
 *
 * ── MOBILE (~390px) ────────────────────────────────────────────────────────
 * One column at base; the template block scrolls INSIDE its own box rather than
 * pushing the page sideways; every control is `min-h-11` (44px); the copy button
 * is always visible, never a hover affordance.
 */

import { useCallback, useState } from "react";
import {
  describeCopyOutcome,
  filledSlotEntries,
  kitCopyText,
  thumbnailState,
  IMAGE_LAB_EVIDENCE_COPY,
  type KitGroup,
  type KitResult,
} from "./lib/history-rules";

const COPY = IMAGE_LAB_EVIDENCE_COPY.kit;

export function KitView({
  groups,
  capped,
  limit,
}: {
  groups: readonly KitGroup[];
  /** The read came back AT its ceiling: older keeps exist and are not shown. */
  capped: boolean;
  limit: number;
}) {
  const [status, setStatus] = useState("");

  /**
   * ⚠ THE ONLY THING ON THE CLIPBOARD IS `kitCopyText(group)`.
   *
   * Failure is REPORTED rather than swallowed: `navigator.clipboard` is
   * unavailable on an insecure origin and can be denied by permission, and a
   * button that silently does nothing teaches a reviewer that the Kit is broken.
   * The template is on screen and selectable, so the fallback is honest advice.
   */
  const copy = useCallback(async (group: KitGroup) => {
    // ⚠ THE OUTCOME SENTENCE IS `describeCopyOutcome`, a pure rule, because the
    // insecure-origin / permission-denied path is a real branch this suite cannot
    // reach inside a .tsx.
    try {
      await navigator.clipboard.writeText(kitCopyText(group));
      setStatus(describeCopyOutcome(true));
    } catch {
      setStatus(describeCopyOutcome(false));
    }
  }, []);

  return (
    <div className="mt-6 flex flex-col gap-6">
      <p aria-live="polite" className="text-sm text-hq-ink">
        {status}
      </p>
      <p className="text-pretty text-xs leading-relaxed text-hq-ink-soft">
        {COPY.copyHint}
      </p>

      {/* ⚠ THE WINDOW, ADMITTED. A bounded read presented as the whole harvest is
          a harvest somebody will believe is complete. */}
      {capped && (
        <p
          role="status"
          className="text-pretty rounded-lg border border-hq-border-strong p-3 text-xs leading-relaxed text-hq-ink"
        >
          {COPY.capped(limit)}
        </p>
      )}

      <ul className="flex flex-col gap-6">
        {groups.map((group) => (
          <li
            key={group.templateKey}
            className="rounded-xl border border-hq-border bg-hq-surface p-4"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-path-display text-sm text-hq-ink">
                {COPY.templateHeading}
              </h3>
              <p className="text-xs text-hq-ink-soft">
                {COPY.keptCount(group.results.length)} · {group.modelIds.join(", ")}
              </p>
            </header>

            {/* Wide content scrolls inside its own box — the page body never
                scrolls sideways at 390px. */}
            <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-hq-border p-2 font-path-mono text-xs text-hq-ink">
              {group.template}
            </pre>

            <button
              type="button"
              onClick={() => copy(group)}
              className="mt-3 min-h-11 w-full rounded-lg border border-crm-blue px-3 text-sm font-medium text-hq-ink sm:w-auto"
            >
              {COPY.copy}
            </button>

            <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.results.map((result) => (
                <KitCard key={result.imageId} result={result} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KitCard({ result }: { result: KitResult }) {
  const slotEntries = filledSlotEntries(result.slotValues);
  const thumbnail = thumbnailState(result);

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-hq-border p-3">
      {thumbnail === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={result.signedUrl ?? undefined}
          alt={`kept ${result.modelId} result`}
          className="aspect-square w-full rounded-lg object-cover"
        />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-hq-border text-xs text-hq-ink-soft">
          {COPY.thumbnail[thumbnail]}
        </span>
      )}

      <p className="font-path-mono text-xs text-hq-ink">{result.modelId}</p>

      <dl className="flex flex-col gap-1 text-xs text-hq-ink-soft">
        <dt className="uppercase tracking-wide">{COPY.slotValuesHeading}</dt>
        <dd className="break-words">
          {slotEntries.length === 0
            ? COPY.noSlotValues
            : slotEntries.map(([slot, value]) => (
                <span key={slot} className="mr-2 inline-block">
                  <span className="font-path-mono">{slot}</span>: {value}
                </span>
              ))}
        </dd>
        <dt className="uppercase tracking-wide">{COPY.referencesHeading}</dt>
        <dd className="break-words">
          {result.referenceLabels.length === 0
            ? COPY.noReferences
            : result.referenceLabels.join(", ")}
        </dd>
        <dt className="uppercase tracking-wide">{COPY.resolvedHeading}</dt>
        {/* Shown so the reader can see what the template became — and deliberately
            NOT what the copy button yields. */}
        <dd className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words">
          {result.resolvedPrompt}
        </dd>
      </dl>

      {result.verdictNote !== "" && (
        <p className="text-pretty text-xs text-hq-ink">{result.verdictNote}</p>
      )}
    </li>
  );
}
