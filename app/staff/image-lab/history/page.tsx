import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { IMAGE_LAB_HISTORY_COPY } from "../lib/shell-rules";
import { ImageLabNav } from "../ImageLabNav";
import { ImageLabPanel } from "../ImageLabPanel";

/** Same reason as the bench: a per-request session gate, never prerendered. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Image Lab history — The 120 (staff)",
  robots: { index: false, follow: false },
};

/**
 * `/staff/image-lab/history` (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 3 shell).
 *
 * NO DATA FETCHING YET — the `fp_image_lab_*` reads, filters, and per-model stats
 * are Unit 6's. This renders the empty state a staff member would see with zero
 * runs, which is also the only state that exists until Unit 5 can create one.
 *
 * GATES ITSELF, for the soft-navigation reason stated in the layout's docblock.
 */
export default async function ImageLabHistoryPage() {
  await requireStaff();

  return (
    <>
      <ImageLabNav current="history" />

      <h2 className="mt-8 font-path-display text-lg text-hq-ink">
        {IMAGE_LAB_HISTORY_COPY.heading}
      </h2>
      <p className="mt-2 text-pretty text-sm text-hq-ink-soft">
        {IMAGE_LAB_HISTORY_COPY.intro}
      </p>

      <ImageLabPanel
        headline={IMAGE_LAB_HISTORY_COPY.emptyRuns.headline}
        body={IMAGE_LAB_HISTORY_COPY.emptyRuns.body}
      />
    </>
  );
}
