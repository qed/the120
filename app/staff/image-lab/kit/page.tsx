import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { IMAGE_LAB_KIT_COPY } from "../lib/shell-rules";
import { ImageLabNav } from "../ImageLabNav";
import { ImageLabPanel } from "../ImageLabPanel";

/** Same reason as the bench: a per-request session gate, never prerendered. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Image Lab kit — The 120 (staff)",
  robots: { index: false, follow: false },
};

/**
 * `/staff/image-lab/kit` (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 3 shell).
 *
 * NO DATA FETCHING YET — the kept-result projection and the copy-the-template
 * affordance are Unit 6's. The empty state is the honest one: the Kit is a
 * DERIVED view of verdicts, so it is empty until someone judges a run, not until
 * someone generates one.
 *
 * GATES ITSELF, for the soft-navigation reason stated in the layout's docblock.
 */
export default async function ImageLabKitPage() {
  await requireStaff();

  return (
    <>
      <ImageLabNav current="kit" />

      <h2 className="mt-8 font-path-display text-lg text-hq-ink">
        {IMAGE_LAB_KIT_COPY.heading}
      </h2>
      <p className="mt-2 text-pretty text-sm text-hq-ink-soft">
        {IMAGE_LAB_KIT_COPY.intro}
      </p>

      <ImageLabPanel
        headline={IMAGE_LAB_KIT_COPY.emptyKept.headline}
        body={IMAGE_LAB_KIT_COPY.emptyKept.body}
      />
    </>
  );
}
