"use client";

/**
 * Step 3 — the comic cover.
 *
 * ── UNIT 4 OWNS THE GENERATOR; THIS IS THE TEMPLATE PATH ──
 * The plan's Unit 4 ships `POST /api/fp/cover`: photo validation, an SSE stream
 * of honest stage events, a 25s soft deadline, and the template compositor. None
 * of that exists yet, so this screen runs the TEMPLATE path and the seam is
 * exactly one function: `runCoverGeneration`. It takes a stage callback and
 * resolves with a cover url or null, which is precisely the shape an SSE
 * consumer has.
 *
 * THE STAGE ANIMATION IS DRIVEN BY REAL EVENTS WHERE THEY EXIST. Today the only
 * real events are "started" and "finished", so the intermediate labels advance
 * on a timer and say what they honestly are. When Unit 4 lands, its stage events
 * call the same `onStage` and the timer goes away — the component does not
 * change. What this screen must never do is show four convincing stages over a
 * request that failed; every terminal state below is explicit.
 *
 * The cover is OPTIONAL and skippable, always. A family with no photo, a family
 * whose upload fails, and a family in a hurry all reach step 4.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { V3Button, V3ComicCover, V3Notice, V3TextButton } from "./v3-ui";

/** The labels the progress overlay walks. Copy from the prototype. */
const DRAW_STAGES = [
  "Reading the photo…",
  "Sketching the character…",
  "Inking the workbench…",
  "Painting the title page…",
] as const;

const STAGE_MS = 900;

export type CoverStageHandler = (stageIndex: number) => void;

/**
 * THE UNIT 4 SEAM. Replace the body with the SSE call; keep the signature.
 * Returns the cover URL, or null when no cover could be produced (which is a
 * legitimate outcome, not an error — the family continues either way).
 *
 * ── IT TAKES AN ABORT SIGNAL, TODAY, ON PURPOSE (review FIX 10b) ──
 * The staged loop below is a `setTimeout` chain that keeps ticking after this
 * screen unmounts. That is harmless while the "generation" is four labels and a
 * timer — but this is EXACTLY the seam Unit 4 replaces with a real SSE stream,
 * where the same unguarded loop becomes a leaked connection held open past the
 * navigation that abandoned it. The signal is threaded now, while it costs
 * nothing, so Unit 4 only has to honour it (`fetch(url, { signal })`) rather
 * than rediscover the bug.
 */
async function runCoverGeneration(
  _input: { draftId: string; file: File | null; signal: AbortSignal },
  onStage: CoverStageHandler
): Promise<{ coverUrl: string | null; message: string }> {
  // Walk the stages on a timer so the wait has shape. Honest, because the
  // message below says a template is what arrived.
  for (let i = 0; i < DRAW_STAGES.length; i += 1) {
    if (_input.signal.aborted) throw new DOMException("aborted", "AbortError");
    onStage(i);
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        _input.signal.removeEventListener("abort", onAbort);
        resolve();
      }, STAGE_MS);
      function onAbort() {
        window.clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      }
      _input.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  return {
    coverUrl: null,
    message:
      "Their cover is not being drawn yet — that part switches on shortly. Everything else is ready, so carry on.",
  };
}

export function StepCover({
  draftId,
  firstName,
  age,
  onContinue,
  onBack,
}: {
  draftId: string;
  firstName: string;
  age: number | null;
  onContinue: () => void;
  onBack: () => void;
}) {
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Aborted on unmount, so the staged loop (an SSE stream from Unit 4 on) never
   *  outlives the screen that started it — review FIX 10b. */
  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    []
  );

  const generate = useCallback(
    async (file: File | null) => {
      if (drawing) return;
      setNotice(null);
      setStage(0);
      setDrawing(true);
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      try {
        const result = await runCoverGeneration(
          { draftId, file, signal: controller.signal },
          setStage
        );
        setCoverUrl(result.coverUrl);
        setNotice(result.message);
      } catch (err) {
        // An abort is this component going away, not a failure the family needs
        // told about — and there is nobody left to tell.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setNotice(
            "We could not draw that just now. You can add a photo later from your dashboard."
          );
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (!controller.signal.aborted) setDrawing(false);
      }
    },
    [draftId, drawing]
  );

  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-10 text-center sm:py-16">
      <p className="v3-label text-v3-profit">{coverUrl ? "Title page · Customized" : "Cover · Frame 1"}</p>
      <h1 className="mx-auto mt-3 max-w-2xl font-path-display text-3xl leading-[1.1] font-black text-v3-ink sm:text-[42px]">
        {firstName}&rsquo;s First Profit Journey
      </h1>

      <div className="relative mt-8 sm:mt-10">
        <V3ComicCover
          age={age ?? ""}
          imageUrl={coverUrl}
          title={coverUrl ? `Meet ${firstName}` : undefined}
          caption={
            coverUrl
              ? `${firstName}, drawing version 1. it was a big piece of paper.`
              : "version 1 of the idea. it was a big piece of paper."
          }
          onImageError={() => setCoverUrl(null)}
        />

        <AnimatePresence>
          {drawing && (
            <motion.div
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 mx-auto flex max-w-xl flex-col items-center justify-center gap-4 rounded-[3px] bg-v3-cream/92 px-5 backdrop-blur-sm"
            >
              <span className="font-path-display text-lg font-semibold text-v3-ink">
                Drawing {firstName} into the story
              </span>
              <p role="status" className="v3-label text-v3-stone">
                {DRAW_STAGES[Math.min(stage, DRAW_STAGES.length - 1)]}
              </p>
              <div className="h-1 w-full max-w-[12rem] overflow-hidden rounded-full bg-v3-ink/10">
                <div
                  className="v3-progress-fill h-full bg-v3-profit transition-[width] duration-700 ease-out"
                  style={{ width: `${((stage + 1) / DRAW_STAGES.length) * 100}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-v3-ink/10 bg-white/70 p-5 text-left sm:mt-16 sm:p-6">
        <h2 className="font-path-display text-lg font-semibold text-v3-ink">
          Want {firstName} on the cover?
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-v3-stone">
          Upload a recent photo and we redraw this title page with {firstName} as the hero. You can
          always do this later.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <V3Button
            type="button"
            variant="ink"
            onClick={() => inputRef.current?.click()}
            disabled={drawing}
          >
            Upload a photo
          </V3Button>
          <V3TextButton type="button" onClick={() => generate(null)} disabled={drawing}>
            Draw it without a photo
          </V3TextButton>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            // Clear the input so re-picking the SAME file fires change again.
            e.target.value = "";
            if (file) void generate(file);
          }}
        />
        {notice && <V3Notice tone="info">{notice}</V3Notice>}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3 sm:mt-10">
        <V3Button onClick={onContinue} disabled={drawing}>
          Write page 1
        </V3Button>
        <V3TextButton type="button" onClick={onBack} disabled={drawing}>
          Back
        </V3TextButton>
      </div>
    </section>
  );
}
