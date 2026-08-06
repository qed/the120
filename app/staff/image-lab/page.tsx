import { requireStaff } from "@/app/crm/lib/auth";
import {
  isImageLabLive,
  isImageLabOpenReferences,
  isImageLabOpenVocabulary,
} from "./lib/image-lab-rules";
import {
  imageLabChannelNotice,
  imageLabGenerationNotice,
  IMAGE_LAB_BENCH_COPY,
} from "./lib/shell-rules";
import { isImageLabRealContentLive } from "./lib/content-picker-core";
import { ImageLabNav } from "./ImageLabNav";
import { ImageLabPanel } from "./ImageLabPanel";
import { RunComposer } from "./RunComposer";

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
  /**
   * ⚠ THE ONLY SURFACE THAT REPORTS THE TWO OPENAI CHANNEL FLAGS. `IMAGE_LAB_LIVE`
   * has the notice above and `IMAGE_LAB_REAL_CONTENT_LIVE` has the picker's own
   * panel, but the switches deciding whether a child's wording and a child's
   * uploaded images reach OpenAI had nothing anywhere — so an operator who
   * believed the reference channel was closed had no way to confirm it, on the one
   * channel whose mistakes are permanent.
   *
   * ⚠ BOTH FLAGS ARE READ HERE, IN A SERVER COMPONENT, AND ONLY THE TEXT ONE IS
   * PASSED TO THE COMPOSER (see below). Reporting a flag on a server-rendered
   * panel is not the same as handing the browser a switch: this is a string the
   * server computed, not a value client code branches on, so it cannot become the
   * second, drift-capable reader that keeps `IMAGE_LAB_OPENAI_OPEN_REFERENCES` out
   * of `RunComposer`.
   */
  const channels = imageLabChannelNotice(
    isImageLabOpenVocabulary(),
    isImageLabOpenReferences()
  );

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

      {/* Stated in all FOUR flag states, for the same reason as the notice above:
          an indicator that appears only when a channel is open cannot be told
          apart from one that failed to render. */}
      <ImageLabPanel
        tone={channels.tone}
        headline={channels.headline}
        body={channels.body}
      />

      {/* Unit 5. The composer OWNS the reference picker now (it is a controlled
          child: the composer holds the selection, and the picker's budget is the
          strictest limit across the chosen models), so `ReferenceLibrary` is no
          longer mounted here.

          EVERY FLAG IS READ SERVER-SIDE AND HANDED DOWN, never re-read in the
          browser: they are operational facts about the deployment, and a
          `NEXT_PUBLIC_` copy would be a second reader resolved at BUILD time that
          could disagree with the server on a warm deploy. They gate different
          things — `live` is whether a model may be called, `pickerLive` is
          whether a real child's authored text may be loaded at all, and
          `openVocabulary` is the TEXT half of the owner's 2026-08-06 decision
          that the OpenAI leg takes name-scrubbed child wording on the same terms
          as Gemini (see `isImageLabOpenVocabulary`).

          ⚠ `IMAGE_LAB_OPENAI_OPEN_REFERENCES` — the decision's other half — is
          DELIBERATELY NOT PASSED. The composer's only use for a flag here is
          deciding which prompt each model will be sent and whether that select is
          locked, and reference images are not part of the prompt: they are loaded
          and gated at dispatch, in `generateCell`. Handing the browser a switch it
          has no surface for would be a second reader that can only drift.

          ⚠ THE COMPOSER USES IT ONLY TO TELL THE TRUTH ABOUT WHAT WILL HAPPEN —
          which prompt each model will be sent, and whether the select is locked.
          The enforcement is `decideChildTextGate`, server-side, at dispatch, off
          the server's OWN read of the same flag. A browser that lies about this
          prop changes nothing but its own preview.

          ⚠ BUT THE READ HERE IS ONCE PER RENDER, AND A TAB OUTLIVES IT. This
          docblock used to argue a stale client is harmless because it
          "under-promises". For a PRIVACY preview that is inverted: under-promising
          means the preview shows LESS text than is sent, which is the harmful
          direction — the preview is the last place a human sees what leaves for a
          vendor. Both flags reverse by env with no deploy, so a tab rendered under
          one value can Generate under another, in EITHER direction.

          What closes it is not this prop: the composer submits an EXPLICIT prompt
          mode for every selected model (`effectivePromptModes`), so `createRun`
          never fills a missing entry from a default computed off its own, newer
          reading. Before that, a tab rendered flag-OFF wrote no entry for a locked
          OpenAI model — the select was disabled, so its `onChange` never fired —
          and a server that had since seen the flag set answered `authored`. */}
      <RunComposer
        live={isImageLabLive()}
        pickerLive={isImageLabRealContentLive()}
        openVocabulary={isImageLabOpenVocabulary()}
      />
    </>
  );
}
