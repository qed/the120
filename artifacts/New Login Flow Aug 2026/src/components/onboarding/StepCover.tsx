import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRightIcon, CheckIcon, UploadIcon, WandSparklesIcon } from 'lucide-react';
import { ComicCover } from '../ComicCover';
import { PrimaryButton } from '../PrimaryButton';
import { PERSONALIZED_COVER_IMAGE, TEST_KID_PHOTO } from '../../data/storyQuestions';
import { firstName } from '../../utils/story';

interface StepCoverProps {
  fullName: string;
  age: string;
  photoUrl: string | null;
  coverImageUrl: string | null;
  onPhotoChange: (photoUrl: string | null, coverImageUrl: string | null) => void;
  onContinue: () => void;
}

const DRAW_STAGES = [
'Reading the photo…',
'Sketching the character…',
'Inking the workbench…',
'Painting the title page…'];


export function StepCover({
  fullName,
  age,
  photoUrl,
  coverImageUrl,
  onPhotoChange,
  onContinue
}: StepCoverProps) {
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const name = firstName(fullName);
  const drawing = pendingPhoto !== null;

  useEffect(() => {
    if (!drawing) return;
    const ticks = DRAW_STAGES.map((_, i) =>
    window.setTimeout(() => setStage(i), i * 900)
    );
    const done = window.setTimeout(() => {
      onPhotoChange(pendingPhoto, PERSONALIZED_COVER_IMAGE);
      setPendingPhoto(null);
      setStage(0);
    }, DRAW_STAGES.length * 900);
    return () => {
      ticks.forEach(window.clearTimeout);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPendingPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-12 text-center sm:py-16">
      <p className="label-mono text-profit">
        {coverImageUrl ? 'Title page · Customized' : 'Cover · Frame 1'}
      </p>
      <h1 className="mx-auto mt-3 max-w-2xl font-display text-3xl font-black leading-[1.1] text-ink sm:text-[42px]">
        {name}’s First Profit Journey
      </h1>

      <div className="relative mt-10">
        <ComicCover
          age={age}
          photoUrl={coverImageUrl ? photoUrl : null}
          imageUrl={coverImageUrl}
          title={coverImageUrl ? `Meet ${name}` : undefined}
          caption={
          coverImageUrl ?
          `${name}, drawing version 1. it was a big piece of paper.` :
          undefined
          } />
        

        <AnimatePresence>
          {drawing &&
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 mx-auto flex max-w-xl flex-col items-center justify-center gap-4 rounded-[3px] bg-cream/92 backdrop-blur-sm">
            
              <img
              src={pendingPhoto ?? ''}
              alt=""
              className="h-20 w-20 rounded-full object-cover ring-4 ring-white shadow-frame" />
            
              <div className="flex items-center gap-2 text-ink">
                <WandSparklesIcon className="h-4 w-4 text-profit" aria-hidden />
                <span className="font-display text-lg font-semibold">
                  Drawing {name} into the story
                </span>
              </div>
              <p role="status" className="label-mono text-stone">
                {DRAW_STAGES[stage]}
              </p>
              <div className="h-1 w-48 overflow-hidden rounded-full bg-ink/10">
                <motion.div
                className="h-full bg-profit"
                initial={{ width: '4%' }}
                animate={{ width: `${(stage + 1) / DRAW_STAGES.length * 100}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }} />
              
              </div>
            </motion.div>
          }
        </AnimatePresence>
      </div>

      <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-ink/10 bg-white/70 p-6 text-left">
        {coverImageUrl ?
        <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-profit text-white">
              <CheckIcon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div>
              <p className="font-display text-lg font-semibold text-ink">
                That’s {name}’s title page.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-stone">
                Every frame from here is drawn with {name} as the hero — this is exactly how the
                app builds the rest of the book.
              </p>
              <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-3 label-mono text-profit underline underline-offset-4 hover:text-profitDark">
              
                Use a different photo
              </button>
            </div>
          </div> :

        <>
            <h2 className="font-display text-lg font-semibold text-ink">
              Doesn’t look like your kid?
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-stone">
              Upload a recent photo and we’ll redraw this title page with {name || 'your kid'} as
              the hero.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={drawing}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/85 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
              
                <UploadIcon className="h-4 w-4" aria-hidden />
                Upload a photo
              </button>
              <button
              type="button"
              onClick={() => setPendingPhoto(TEST_KID_PHOTO)}
              disabled={drawing}
              className="label-mono text-stone underline underline-offset-4 hover:text-ink disabled:opacity-40">
              
                Use sample photo
              </button>
            </div>
          </>
        }
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleFile} />
        
      </div>

      <div className="mt-10">
        <PrimaryButton onClick={onContinue} disabled={drawing}>
          Write page 1
          <ArrowRightIcon className="h-4 w-4" aria-hidden />
        </PrimaryButton>
        {!coverImageUrl && !drawing &&
        <p className="mt-3 label-mono text-stone">You can add a photo later</p>
        }
      </div>
    </section>);

}