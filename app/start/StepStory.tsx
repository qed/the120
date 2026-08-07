"use client";

/**
 * Step 4 — the six story questions, all OPTIONAL.
 *
 * The prototype gates its continue button on all six being answered. This port
 * deliberately does not: the plan calls these "six optional story questions",
 * and a locked button in front of a nine-year-old at the end of a signup is how
 * a family abandons. The answered count is still shown, so the incentive is
 * visible without being a wall.
 *
 * The answers are SAVED to the draft on continue (one write, not per keystroke),
 * which is what makes a refresh mid-flow restore them. They also feed the
 * child's password word — the credential rules read `matters`/`intro` first.
 *
 * LAYOUT: one column on a phone, the live page preview joins as a sticky column
 * only at `lg`. The preview is decoration; it must never push the form sideways
 * at 390px, so it is not rendered at all below `lg` rather than stacked
 * (a duplicate of everything the parent just typed, restated underneath, is
 * noise on a small screen).
 */

import { useMemo, useState, useTransition } from "react";
import { v3SaveStoryAction } from "./actions";
import { STORY_ANSWER_MAX_CHARS, STORY_QUESTIONS } from "@/app/lib/v3-signup/story-questions";
import { V3Button, V3Notice, V3TextButton, V3_TEXTAREA_CLASSES } from "./v3-ui";

export function StepStory({
  draftId,
  firstName,
  initialAnswers,
  onContinue,
  onBack,
}: {
  draftId: string;
  firstName: string;
  initialAnswers: Record<string, string>;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const answered = useMemo(
    () => STORY_QUESTIONS.filter((q) => (answers[q.id] ?? "").trim().length > 0).length,
    [answers]
  );

  const saveAndContinue = () => {
    setNotice(null);
    startTransition(async () => {
      const result = await v3SaveStoryAction({ draftId, answers });
      if (result.kind === "saved") {
        onContinue();
        return;
      }
      setNotice("We could not save those answers just now. Try again, or carry on without them.");
    });
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
        <div className="min-w-0">
          <p className="v3-label text-v3-profit">Page 1 · Meet the hero</p>
          <h1 className="mt-3 font-path-display text-3xl leading-[1.1] font-black text-v3-ink sm:text-[40px]">
            Meet {firstName}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-v3-stone">
            Sit with {firstName}
            {" and answer these together, in their words. Every question is optional "}
            &mdash; skip any of them and carry on.
          </p>

          <form
            className="mt-8 space-y-7"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pending) saveAndContinue();
            }}
          >
            {STORY_QUESTIONS.map((q, index) => (
              <div key={q.id}>
                <label
                  htmlFor={`v3-q-${q.id}`}
                  className="block font-path-display text-lg font-semibold text-v3-ink"
                >
                  <span className="mr-2 font-path-mono text-xs text-v3-profit">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {q.question}
                </label>
                {q.hint && <p className="mt-1 text-sm text-v3-stone">{q.hint}</p>}
                <textarea
                  id={`v3-q-${q.id}`}
                  rows={q.rows}
                  maxLength={STORY_ANSWER_MAX_CHARS}
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }
                  placeholder={q.sample}
                  className={V3_TEXTAREA_CLASSES}
                />
              </div>
            ))}

            {notice && <V3Notice tone="error">{notice}</V3Notice>}

            <div className="flex flex-col gap-3 border-t border-v3-ink/10 pt-6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <V3Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Finish page 1"}
              </V3Button>
              <span className="v3-label text-v3-stone">
                {answered} of {STORY_QUESTIONS.length} answered
              </span>
              <V3TextButton type="button" onClick={onBack} disabled={pending}>
                Back
              </V3TextButton>
            </div>
          </form>
        </div>

        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <p className="v3-label mb-3 text-v3-stone">Live page preview</p>
          <div className="rounded-[3px] bg-[#FDFBF5] p-5 shadow-v3-frame ring-1 ring-v3-ink/10">
            <div className="flex items-center gap-3 border-b border-v3-ink/10 pb-4">
              <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-v3-paper font-path-display text-lg font-bold text-v3-ink">
                {firstName.slice(0, 1) || "?"}
              </span>
              <div className="min-w-0">
                <p className="truncate font-path-display text-xl font-black text-v3-ink">
                  Meet {firstName}
                </p>
                <p className="v3-label text-v3-stone">Page 1</p>
              </div>
            </div>
            <div className="mt-4 max-h-[52vh] space-y-4 overflow-y-auto pr-1">
              {STORY_QUESTIONS.map((q) => (
                <div key={q.id}>
                  <p className="font-path-display text-base italic leading-tight text-v3-one20">
                    {q.question}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-v3-ink/80">
                    {(answers[q.id] ?? "").trim() || (
                      <span className="text-v3-ink/25">Waiting for {firstName}&rsquo;s answer…</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
