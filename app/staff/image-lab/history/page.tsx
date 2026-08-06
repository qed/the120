import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { IMAGE_LAB_HISTORY_COPY } from "../lib/shell-rules";
import { ImageLabNav } from "../ImageLabNav";
import { ImageLabPanel } from "../ImageLabPanel";
import { HistoryView } from "../HistoryView";
import { imageLabDb } from "../lib/image-lab-db";
import { historyDeps } from "../lib/history-loader";
import { loadHistoryView } from "../lib/history-core";
import {
  isHistoryFilterActive,
  parseHistoryFilter,
  HISTORY_QUERY_KEYS,
  HISTORY_VERDICT_FILTERS,
  IMAGE_LAB_EVIDENCE_COPY,
  type HistoryFilter,
  type HistoryReference,
} from "../lib/history-rules";
import { IMAGE_LAB_DRILL_TAGS } from "../lib/image-lab-rules";
import { IMAGE_LAB_MODELS } from "../lib/model-registry";

/** Same reason as the bench: a per-request session gate, never prerendered. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Image Lab history — The 120 (staff)",
  robots: { index: false, follow: false },
};

/**
 * `/staff/image-lab/history` (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 6).
 *
 * EVERY RUN, EVER, with the per-model evidence the model decision rests on:
 * completions, keeps, keep rate, cost — and `timeout`/`safety_blocked` as their
 * OWN labelled counts, outside the keep-rate denominator, because both are our
 * artifacts rather than the model's answer.
 *
 * GATES ITSELF, for the soft-navigation reason stated in the layout's docblock.
 *
 * ── THE FILTERS LIVE IN THE URL ────────────────────────────────────────────
 * A plain GET form, no client state. Which means a filtered view — "every run
 * that used this hero sheet" — is a link that can be bookmarked, pasted into a
 * review thread and gated per-route, and cannot be lost to a re-render. The
 * parser is total and drops what it does not recognize, so a hand-edited or stale
 * URL degrades to a wider view rather than to an error page.
 */
export default async function ImageLabHistoryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Reading the route props before the gate is the one allowed early await
  // (gate-enforcement's `ALLOWED_EARLY_AWAIT`); nothing else may precede it.
  const params = await searchParams;
  await requireStaff();

  const filter = parseHistoryFilter(params);
  const result = await loadHistoryView(historyDeps(imageLabDb()), filter);

  return (
    <>
      <ImageLabNav current="history" />

      <h2 className="mt-8 font-path-display text-lg text-hq-ink">
        {IMAGE_LAB_HISTORY_COPY.heading}
      </h2>
      <p className="mt-2 text-pretty text-sm text-hq-ink-soft">
        {IMAGE_LAB_HISTORY_COPY.intro}
      </p>

      <FilterForm filter={filter} references={result.ok ? result.references : []} />

      {!result.ok ? (
        // ⚠ A FAILED QUERY IS NOT AN EMPTY HISTORY. History's whole claim is that
        // it is complete, so an empty list reads as "nothing was ever generated" —
        // which is exactly the wrong conclusion to draw from a broken read.
        <ImageLabPanel
          headline={IMAGE_LAB_EVIDENCE_COPY.runs.loadFailed.headline}
          body={IMAGE_LAB_EVIDENCE_COPY.runs.loadFailed.body}
        />
      ) : result.runs.length === 0 && !isHistoryFilterActive(filter) ? (
        <ImageLabPanel
          headline={IMAGE_LAB_HISTORY_COPY.emptyRuns.headline}
          body={IMAGE_LAB_HISTORY_COPY.emptyRuns.body}
        />
      ) : (
        <HistoryView
          runs={result.runs}
          images={result.images}
          stats={result.stats}
          cost={result.cost}
          serverNowMs={result.serverNowMs}
          filter={result.filter}
          references={result.references}
          totalRuns={result.totalRuns}
          imagesTruncated={result.imagesTruncated}
          imageCap={result.imageCap}
        />
      )}
    </>
  );
}

/**
 * The four filters, as a GET form.
 *
 * Server-rendered and stateless: submitting navigates, which re-runs the gate and
 * the query and leaves the whole view in the URL.
 *
 * ── THE FORM MUST BE ABLE TO EXPRESS WHAT THE COPY PROMISES ────────────────
 * ⚠ THE REFERENCE, TAG AND MODEL SELECTS ARE `multiple`, and that is not a nicety.
 * The copy beneath them says "Select two and only runs carrying BOTH are shown" —
 * a containment claim — under controls that could carry exactly ONE value. Worse,
 * a hand-built `?ref=A&ref=B` (which the parser accepts, and the query executes
 * correctly) silently narrowed to `ref=A` on the next Apply, WIDENING the result
 * set with nothing on screen saying so.
 *
 * ⚠ `limit` RIDES ALONG AS A HIDDEN INPUT. Without it a hand-set `?limit=200` was
 * discarded by the next Apply while the reader believed they were still reading
 * 200 runs.
 *
 * ⚠ AN UNKNOWN MODEL ID IS RENDERED AS A SELECTED OPTION. A model retired from
 * the registry still has history rows — which is exactly why the parser does not
 * validate against the registry — and a control reading "Any" over single-model
 * statistics is the control lying about the page.
 */
function FilterForm({
  filter,
  references,
}: {
  filter: HistoryFilter;
  references: readonly HistoryReference[];
}) {
  const copy = IMAGE_LAB_EVIDENCE_COPY.filters;
  const field =
    "min-h-11 w-full rounded-lg border border-hq-border bg-transparent px-3 text-sm text-hq-ink";
  // A multi-select needs room to show more than one row on a phone.
  const multi = `${field} min-h-32 py-2`;

  const known = new Set<string>(IMAGE_LAB_MODELS.map((model) => model.id));
  const retired = filter.modelIds.filter((id) => !known.has(id));

  return (
    <form method="get" className="mt-6 rounded-xl border border-hq-border bg-hq-surface p-4">
      <h3 className="font-path-display text-sm text-hq-ink">{copy.heading}</h3>
      <p className="mt-1 text-pretty text-xs text-hq-ink-soft">{copy.hint}</p>
      <p className="mt-1 text-pretty text-xs text-hq-ink-soft">{copy.multiHint}</p>

      {/* ⚠ THE LIMIT SURVIVES AN APPLY. */}
      <input type="hidden" name={HISTORY_QUERY_KEYS.limit} value={String(filter.limit)} />

      {/* One column at 390px, four across on a desktop. */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-hq-ink-soft">
          <span>{copy.model}</span>
          <select
            name={HISTORY_QUERY_KEYS.model}
            multiple
            defaultValue={[...filter.modelIds]}
            className={multi}
          >
            {IMAGE_LAB_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
            {/* Applied, and no longer in the registry. Named rather than dropped. */}
            {retired.map((id) => (
              <option key={id} value={id}>
                {copy.retiredModel(id)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-hq-ink-soft">
          <span>{copy.verdict}</span>
          {/* Single-value BY NATURE: the four options are mutually exclusive. */}
          <select name={HISTORY_QUERY_KEYS.verdict} defaultValue={filter.verdict} className={field}>
            {HISTORY_VERDICT_FILTERS.map((value) => (
              <option key={value} value={value}>
                {copy.verdictOptions[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-hq-ink-soft">
          <span>{copy.tag}</span>
          <select
            name={HISTORY_QUERY_KEYS.tag}
            multiple
            defaultValue={[...filter.drillTags]}
            className={multi}
          >
            {IMAGE_LAB_DRILL_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-hq-ink-soft">
          <span>{copy.reference}</span>
          <select
            name={HISTORY_QUERY_KEYS.reference}
            multiple
            defaultValue={[...filter.referenceIds]}
            className={multi}
          >
            {references.length === 0 && <option value="">{copy.noReferences}</option>}
            {references.map((reference) => (
              <option key={reference.id} value={reference.id}>
                {reference.label === "" ? reference.id.slice(0, 8) : reference.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-2 text-pretty text-xs text-hq-ink-soft">{copy.referenceHint}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          className="min-h-11 rounded-lg border border-crm-blue px-4 text-sm font-medium text-hq-ink"
        >
          {copy.apply}
        </button>
        <a
          href="/staff/image-lab/history"
          className="flex min-h-11 items-center rounded-lg border border-hq-border px-4 text-sm text-hq-ink-soft"
        >
          {copy.clear}
        </a>
      </div>
    </form>
  );
}
