"use client";

/**
 * ⚠ DORMANT SURFACE (fpv03 U3): this component is NO LONGER MOUNTED — the
 * cover step was retired from signup (founder decision 2026-08-08; the flow is
 * parent → kid → ready, and cover generation returns elsewhere in U6). The file
 * is kept for DEPLOY SKEW only: an old tab holding the pre-U3 bundle can still
 * be mid-flow on this screen, and its server surface (`POST /api/fp/cover`)
 * stays live for the same reason. See the dormant-surfaces list in
 * app/lib/v3-signup/flow-rules.ts's module header; delete this file in the
 * eventual cleanup once the skew window has passed.
 *
 * Step 3 — the comic cover.
 *
 * ── UNIT 4 LANDED; THE SEAM IS NOW THE REAL ENDPOINT ──
 * `runCoverGeneration` keeps the shape Unit 3 defined — `({ draftId, file,
 * signal }, onStage) => Promise<{ coverUrl, message }>` — but its body is now a
 * `fetch` of `POST /api/fp/cover` reading a Server-Sent-Events stream. The
 * AbortSignal is honoured by `fetch` itself, so abandoning this screen tears the
 * connection down instead of leaking it (the hazard review FIX 10b threaded the
 * signal for in the first place).
 *
 * ── THE STAGES ARE REAL, SO THERE ARE ONLY TWO OF THEM ──
 * Unit 3 walked four invented labels on a 900ms timer, and said so honestly in
 * its comments. The timer is GONE. The server emits one `stage` event per
 * durable transition it actually performs — `reserved`, then `composed` — and
 * this screen renders the label for whatever it was told, from the one
 * vocabulary in `app/api/fp/cover/cover-rules.ts`. If the server ever performs
 * more steps (the AI path), more events arrive and this component needs no
 * change. What it must never do is show a stage the server did not send.
 *
 * ── THE PHOTO AFFORDANCE IS ABSENT, NOT DISABLED, IN TEMPLATE MODE ──
 * While `COVER_AI_LIVE` is off there is no vendor to send a child's photo to and
 * no store to put it in, so we do not ask for one. Offering a greyed-out button
 * would still be advertising a thing we are not doing; offering a working one
 * and discarding the upload would be collecting a minor's photo for no purpose.
 * The endpoint independently REFUSES a photo body, so the two sides agree.
 *
 * The cover is OPTIONAL and skippable, always. A family with no photo, a family
 * whose generation fails, and a family in a hurry all reach step 4.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  COVER_STAGE_LABELS,
  stagesForMode,
  type CoverStage,
} from "@/app/api/fp/cover/cover-rules";
import { V3Button, V3ComicCover, V3Notice, V3TextButton } from "./v3-ui";

export type CoverStageHandler = (stage: CoverStage) => void;

/** The stages the TEMPLATE path can produce, used only to size the progress
 *  bar. Read from the same table the server emits against, so the bar can never
 *  promise more steps than the server performs. */
const TEMPLATE_STAGES = stagesForMode("template");

type CoverOutcome = { coverUrl: string | null; message: string | null };

/**
 * THE ENDPOINT CALL. Streams `event: stage` frames, then one `event: done`.
 *
 * A refusal before the stream opens is an ordinary HTTP status with a JSON body
 * (the route commits a 200 the moment a stream starts, so every gate runs
 * first); a refusal after it opens rides the terminal `done` event. Both land in
 * `message`, and both leave `coverUrl` null — which every caller below treats as
 * "no cover, carry on", because the cover is decoration and never blocks signup.
 */
async function runCoverGeneration(
  input: { draftId: string; file: File | null; signal: AbortSignal },
  onStage: CoverStageHandler
): Promise<CoverOutcome> {
  // The file is never sent while the photo path is closed. It is still accepted
  // by this signature so the AI path is a body change and not a call-site change.
  void input.file;

  const res = await fetch("/api/fp/cover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftId: input.draftId }),
    signal: input.signal,
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    const message = await readRefusalMessage(res);
    return { coverUrl: null, message };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: CoverOutcome = {
    coverUrl: null,
    // A stream that ends without a `done` frame is a truncated response, not a
    // silent success. Say so rather than showing an empty frame forever.
    message: "We could not finish drawing that. You can try again from your dashboard.",
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line; keep the trailing partial.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const raw of frames) {
      const parsed = parseFrame(raw);
      if (!parsed) continue;
      if (parsed.event === "stage" && typeof parsed.data?.stage === "string") {
        onStage(parsed.data.stage as CoverStage);
      } else if (parsed.event === "done") {
        outcome =
          parsed.data?.ok === true
            ? { coverUrl: String(parsed.data.coverUrl ?? "") || null, message: null }
            : {
                coverUrl: null,
                message:
                  typeof parsed.data?.message === "string"
                    ? parsed.data.message
                    : "We could not draw that just now.",
              };
      }
    }
  }
  return outcome;
}

function parseFrame(raw: string): { event: string; data: Record<string, unknown> | null } | null {
  let event = "message";
  let data: Record<string, unknown> | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      try {
        data = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }
  }
  return event === "message" && data === null ? null : { event, data };
}

async function readRefusalMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) return body.message;
  } catch {
    // fall through to the generic line
  }
  return "We could not draw that just now. You can add one later from your dashboard.";
}

export function StepCover({
  draftId,
  firstName,
  age,
  coverAiLive,
  onContinue,
  onBack,
}: {
  draftId: string;
  firstName: string;
  age: number | null;
  /** Server-read `COVER_AI_LIVE`. Off = no photo affordance at all (see header). */
  coverAiLive: boolean;
  onContinue: () => void;
  onBack: () => void;
}) {
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<CoverStage | null>(null);
  const [stageCount, setStageCount] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Aborted on unmount, so the SSE connection never outlives the screen that
   *  started it — review FIX 10b, now load-bearing rather than anticipatory. */
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
      setStage(null);
      setStageCount(0);
      setDrawing(true);
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      try {
        const result = await runCoverGeneration(
          { draftId, file, signal: controller.signal },
          (next) => {
            setStage(next);
            setStageCount((n) => n + 1);
          }
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

  const progress = Math.min(stageCount / TEMPLATE_STAGES.length, 1);

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
                {stage ? COVER_STAGE_LABELS[stage] : "Starting…"}
              </p>
              <div className="h-1 w-full max-w-[12rem] overflow-hidden rounded-full bg-v3-ink/10">
                <div
                  className="v3-progress-fill h-full bg-v3-profit transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.max(progress, 0.08) * 100}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-v3-ink/10 bg-white/70 p-5 text-left sm:mt-16 sm:p-6">
        <h2 className="font-path-display text-lg font-semibold text-v3-ink">
          {coverAiLive ? `Want ${firstName} on the cover?` : `Draw ${firstName} a cover`}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-v3-stone">
          {coverAiLive
            ? `Upload a recent photo and we redraw this title page with ${firstName} as the hero. You can always do this later.`
            : `We make a one-of-a-kind title page from ${firstName}'s name and age. Photo covers are not switched on yet, so we are not collecting photos.`}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          {/* ABSENT, not disabled, while the photo path is closed (see header). */}
          {coverAiLive && (
            <V3Button
              type="button"
              variant="ink"
              onClick={() => inputRef.current?.click()}
              disabled={drawing}
            >
              Upload a photo
            </V3Button>
          )}
          <V3TextButton type="button" onClick={() => generate(null)} disabled={drawing}>
            {coverAiLive ? "Draw it without a photo" : "Draw the cover"}
          </V3TextButton>
        </div>
        {coverAiLive && (
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
        )}
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
