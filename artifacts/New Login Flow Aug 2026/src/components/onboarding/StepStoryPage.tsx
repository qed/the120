import React, { useMemo } from 'react';
import { ArrowRightIcon, SparklesIcon } from 'lucide-react';
import { PrimaryButton } from '../PrimaryButton';
import { storyQuestions } from '../../data/storyQuestions';
import { firstName } from '../../utils/story';
import type { Answers } from '../../types/onboarding';

interface StepStoryPageProps {
  fullName: string;
  photoUrl: string | null;
  coverImageUrl: string | null;
  answers: Answers;
  onAnswer: (id: string, value: string) => void;
  onFillSample: () => void;
  onContinue: () => void;
}

export function StepStoryPage({
  fullName,
  photoUrl,
  coverImageUrl,
  answers,
  onAnswer,
  onFillSample,
  onContinue
}: StepStoryPageProps) {
  const name = firstName(fullName);
  const answered = useMemo(
    () => storyQuestions.filter((q) => (answers[q.id] || '').trim().length > 0).length,
    [answers]
  );
  const complete = answered === storyQuestions.length;

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-12 sm:py-16">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
        <div>
          <p className="label-mono text-profit">Page 1 · Meet the hero</p>
          <h1 className="mt-3 font-display text-3xl font-black leading-[1.1] text-ink sm:text-[40px]">
            Meet {name}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-stone">
            Sit with {name} and answer these together, in their words. This is the page every
            future frame is built on.
          </p>

          <button
            type="button"
            onClick={onFillSample}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2 label-mono text-stone transition-colors hover:text-ink">
            
            <SparklesIcon className="h-3.5 w-3.5" aria-hidden />
            Fill with the sample answers
          </button>

          <form
            className="mt-10 space-y-8"
            onSubmit={(e) => {
              e.preventDefault();
              onContinue();
            }}>
            
            {storyQuestions.map((q, index) =>
            <div key={q.id}>
                <label htmlFor={q.id} className="block font-display text-lg font-semibold text-ink">
                  <span className="mr-2 font-mono text-xs text-profit">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {q.question}
                </label>
                {q.hint && <p className="mt-1 text-sm text-stone">{q.hint}</p>}
                <textarea
                id={q.id}
                rows={q.rows}
                value={answers[q.id] || ''}
                onChange={(e) => onAnswer(q.id, e.target.value)}
                placeholder={q.sample}
                className="mt-3 w-full resize-y rounded-xl border border-ink/15 bg-white px-4 py-3 text-[15px] leading-relaxed text-ink shadow-card outline-none transition-colors placeholder:text-ink/25 focus:border-profit" />
              
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 border-t border-ink/10 pt-6">
              <PrimaryButton type="submit" disabled={!complete}>
                Finish page 1
                <ArrowRightIcon className="h-4 w-4" aria-hidden />
              </PrimaryButton>
              <span className="label-mono text-stone">
                {answered} of {storyQuestions.length} answered
              </span>
            </div>
          </form>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="label-mono mb-3 text-stone">Live page preview</p>
          <div className="rounded-[3px] bg-[#FDFBF5] p-5 shadow-frame ring-1 ring-ink/10">
            {coverImageUrl &&
            <div className="relative mb-4 overflow-hidden rounded-[2px] ring-1 ring-ink/10">
                <img
                src={coverImageUrl}
                alt={`A graphic-novel illustration of ${name} at their workbench.`}
                className="block w-full" />
              
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/85 via-ink/50 to-transparent px-4 pb-3 pt-10">
                  <p className="font-display text-2xl font-black leading-none text-white">
                    Meet {name}
                  </p>
                </div>
              </div>
            }
            <div className="flex items-center gap-3 border-b border-ink/10 pb-4">
              {photoUrl ?
              <img
                src={photoUrl}
                alt=""
                className="h-12 w-12 rounded-full object-cover ring-2 ring-sun" /> :


              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper font-display text-lg font-bold text-ink">
                  {name.slice(0, 1) || '?'}
                </span>
              }
              <div>
                <p className="font-display text-xl font-black text-ink">Meet {name}</p>
                <p className="label-mono text-stone">Page 1</p>
              </div>
            </div>

            <div className="mt-4 max-h-[52vh] space-y-4 overflow-y-auto pr-1">
              {storyQuestions.map((q) =>
              <div key={q.id}>
                  <p className="font-hand text-lg leading-tight text-one20">{q.question}</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink/80">
                    {(answers[q.id] || '').trim() ||
                  <span className="text-ink/25">Waiting for {name}’s answer…</span>
                  }
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>);

}