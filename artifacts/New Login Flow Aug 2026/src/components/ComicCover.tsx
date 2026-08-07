import React from 'react';
import { motion } from 'framer-motion';
import { INTRO_IMAGE } from '../data/storyQuestions';

interface ComicCoverProps {
  age: string;
  photoUrl?: string | null;
  /** A customized graphic-novel version of the template. Falls back to the template art. */
  imageUrl?: string | null;
  caption?: string;
  /** Rendered as a title plate across the bottom of the art, e.g. "Meet Caradoc". */
  title?: string;
}

/**
 * The First Profit intro frame: the illustration inside a paper frame,
 * with the sticky note and the handwritten caption laid over it.
 */
export function ComicCover({ age, photoUrl, imageUrl, caption, title }: ComicCoverProps) {
  const personalized = Boolean(imageUrl);

  return (
    <motion.figure
      initial={{ opacity: 0, y: 14, rotate: -0.6 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative mx-auto w-full max-w-xl rounded-[3px] bg-[#FDFBF5] p-3 shadow-frame ring-1 ring-ink/10 sm:p-4">
      
      <div className="relative overflow-hidden rounded-[2px] ring-1 ring-ink/10">
        <img
          key={imageUrl || INTRO_IMAGE}
          src={imageUrl || INTRO_IMAGE}
          alt={
          personalized ?
          'A graphic-novel illustration of your kid at a workbench, drawing the first version of their idea.' :
          'A young founder at a workbench, drawing the first version of their idea on a big piece of paper.'
          }
          className="block w-full" />
        

        {title &&
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/85 via-ink/55 to-transparent px-5 pb-4 pt-14">
            <p className="font-display text-3xl font-black leading-none text-white drop-shadow-sm sm:text-4xl">
              {title}
            </p>
          </div>
        }
      </div>

      <span className="absolute -right-3 -top-4 rotate-[7deg] rounded-[2px] bg-sun px-3 py-1.5 font-hand text-lg font-bold leading-none text-ink shadow-[0_6px_14px_-6px_rgba(27,24,21,0.6)] sm:-right-5 sm:text-xl">
        Founder, age {age || '9'}
      </span>

      <figcaption className="px-1 pb-1 pt-3 font-hand text-lg text-ink/70 sm:text-xl">
        {caption ?? 'version 1 of AZEAP. it was a big piece of paper.'}
      </figcaption>

      {photoUrl &&
      <div className="absolute -bottom-5 -left-4 flex items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-3.5 shadow-frame ring-1 ring-ink/10">
          <img
          src={photoUrl}
          alt="The photo you uploaded of your kid"
          className="h-9 w-9 rounded-full object-cover" />
        
          <span className="label-mono text-profit">Drawn from this photo</span>
        </div>
      }
    </motion.figure>);

}