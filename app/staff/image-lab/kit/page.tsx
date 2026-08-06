import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { IMAGE_LAB_KIT_COPY } from "../lib/shell-rules";
import { ImageLabNav } from "../ImageLabNav";
import { ImageLabPanel } from "../ImageLabPanel";
import { KitView } from "../KitView";
import { imageLabDb } from "../lib/image-lab-db";
import { historyDeps } from "../lib/history-loader";
import { loadKitView } from "../lib/history-core";
import { IMAGE_LAB_EVIDENCE_COPY } from "../lib/history-rules";

/** Same reason as the bench: a per-request session gate, never prerendered. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Image Lab kit — The 120 (staff)",
  robots: { index: false, follow: false },
};

/**
 * `/staff/image-lab/kit` (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 6).
 *
 * The harvest: kept results only, grouped by the `{{slot}}` template behind them,
 * with the slot values, model and references shown beside each one. The copy
 * action yields the TEMPLATE verbatim — that template is what the panel engine
 * inherits, and the resolved prompt has one child's business baked into it.
 *
 * GATES ITSELF, for the soft-navigation reason stated in the layout's docblock.
 *
 * ⚠ FOUR STATES, FOUR RENDERINGS, AND NO TWO ARE INTERCHANGEABLE: a failed query;
 * an honestly empty kit (nothing has been judged `keep` yet — which is a fact
 * about VERDICTS, not about runs); a kit whose kept rows EXIST but could not be
 * resolved to the runs behind them; and a kit with content. Collapsing the first
 * two would make a broken read look like a bench nobody has judged. Collapsing
 * the THIRD into the second put "Nothing kept yet" over a bench that has kept
 * results — the confusion `projectKit`'s own docblock forbids.
 */
export default async function ImageLabKitPage() {
  await requireStaff();

  const result = await loadKitView(historyDeps(imageLabDb()));

  return (
    <>
      <ImageLabNav current="kit" />

      <h2 className="mt-8 font-path-display text-lg text-hq-ink">
        {IMAGE_LAB_KIT_COPY.heading}
      </h2>
      <p className="mt-2 text-pretty text-sm text-hq-ink-soft">
        {IMAGE_LAB_KIT_COPY.intro}
      </p>

      {!result.ok ? (
        <ImageLabPanel
          headline={IMAGE_LAB_EVIDENCE_COPY.kit.loadFailed.headline}
          body={IMAGE_LAB_EVIDENCE_COPY.kit.loadFailed.body}
        />
      ) : result.groups.length === 0 && result.unresolved > 0 ? (
        // ⚠ THE FOURTH STATE. Kept rows exist and could not be assembled — which
        // is a data problem, NOT an empty kit.
        <ImageLabPanel
          headline={IMAGE_LAB_EVIDENCE_COPY.kit.unresolved.headline}
          body={IMAGE_LAB_EVIDENCE_COPY.kit.unresolved.body(result.unresolved)}
          tone="off"
        />
      ) : result.groups.length === 0 ? (
        <ImageLabPanel
          headline={IMAGE_LAB_KIT_COPY.emptyKept.headline}
          body={IMAGE_LAB_KIT_COPY.emptyKept.body}
        />
      ) : (
        <>
          {result.unresolved > 0 && (
            <ImageLabPanel
              headline={IMAGE_LAB_EVIDENCE_COPY.kit.unresolved.headline}
              body={IMAGE_LAB_EVIDENCE_COPY.kit.unresolved.body(result.unresolved)}
              tone="off"
            />
          )}
          <KitView groups={result.groups} capped={result.capped} limit={result.limit} />
        </>
      )}
    </>
  );
}
