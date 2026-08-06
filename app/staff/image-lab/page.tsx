import { requireStaff } from "@/app/crm/lib/auth";
import { isImageLabLive, isImageLabOpenVocabulary } from "./lib/image-lab-rules";
import {
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
          prop changes nothing but its own preview. */}
      <RunComposer
        live={isImageLabLive()}
        pickerLive={isImageLabRealContentLive()}
        openVocabulary={isImageLabOpenVocabulary()}
      />
    </>
  );
}
