import { requireStaff } from "@/app/crm/lib/auth";
import { isImageLabLive } from "./lib/image-lab-rules";
import {
  imageLabGenerationNotice,
  IMAGE_LAB_BENCH_COPY,
} from "./lib/shell-rules";
import { ImageLabNav } from "./ImageLabNav";
import { ImageLabPanel } from "./ImageLabPanel";

/**
 * Force-dynamic: the gate reads the session and the service-role `staff` row per
 * request, AND this page reads `IMAGE_LAB_LIVE` at request time — a prerender
 * would bake one environment's flag into the HTML. `/staff` carries the same
 * directive for the same first reason.
 */
export const dynamic = "force-dynamic";

/**
 * No `metadata` of its own. It would be byte-identical to `./layout.tsx`'s, and
 * Next merges metadata from the root segment DOWN with the nearest declaration
 * winning — so the layout's title and `noindex` are what this page renders.
 * History and Kit declare their own only because their titles differ.
 */

/**
 * The bench (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 3 shell). Composer,
 * references, and the result grid are Units 4–6; what exists today is the route,
 * the gate, the navigation, and the honest statement of what this bench will and
 * will not do right now.
 *
 * GATES AGAIN, on purpose — see the layout's docblock. Memoized, so free.
 *
 * The flag is read HERE, server-side, and never shipped to the browser: it is an
 * operational fact about the deployment, and `NEXT_PUBLIC_`-ing it would put it
 * in the RSC payload where it is neither more useful nor less durable.
 */
export default async function ImageLabBenchPage() {
  await requireStaff();
  // `isImageLabLive()`, never a literal: the `/staff` hub card renders the SAME
  // call through `imageLabCardLine`, and the two surfaces disagreeing is the
  // failure the pure module exists to prevent. Both call sites are pinned in
  // __tests__/gate-enforcement.test.ts.
  const notice = imageLabGenerationNotice(isImageLabLive());

  return (
    <>
      <ImageLabNav current="bench" />

      <h2 className="mt-8 font-path-display text-lg text-hq-ink">
        {IMAGE_LAB_BENCH_COPY.heading}
      </h2>
      <p className="mt-2 text-pretty text-sm text-hq-ink-soft">
        {IMAGE_LAB_BENCH_COPY.intro}
      </p>

      {/* Stated in BOTH flag states — an indicator that only appears when
          something is off cannot be told apart from one that failed to render.
          `tone` is load-bearing: without it the off notice renders in the
          neutral skin and says nothing a glance can catch. */}
      <ImageLabPanel
        tone={notice.tone}
        headline={notice.headline}
        body={notice.body}
      />

      <ImageLabPanel
        headline={IMAGE_LAB_BENCH_COPY.composerPending.headline}
        body={IMAGE_LAB_BENCH_COPY.composerPending.body}
      />

      <ImageLabPanel
        headline={IMAGE_LAB_BENCH_COPY.emptyRuns.headline}
        body={IMAGE_LAB_BENCH_COPY.emptyRuns.body}
      />
    </>
  );
}
