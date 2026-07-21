




import React from 'react';
import { motion } from 'framer-motion';
import { SparklesIcon, QuoteIcon, StarIcon } from 'lucide-react';
import { cn } from './cn';

export interface WisdomEntry {
  text: string;
  attribution: string;
  /** true = one of "The 120 originals"; false = a real vetted quote */
  original?: boolean;
}

/**
 * WisdomCard — Trail rendering. A collectible illustrated card that flutters down
 * after a meaningful moment and files itself into the satchel's card book.
 */
export function WisdomCard({
  entry,
  favorited,
  onFavorite,
  className





}: {entry: WisdomEntry;favorited?: boolean;onFavorite?: () => void;className?: string;}) {
  return (
    <motion.figure
      initial={{ y: -40, rotate: -6, opacity: 0 }}
      animate={{ y: 0, rotate: -1.5, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 180, damping: 14 }}
      className={cn(
        'relative w-64 rounded-2xl border-2 border-trail-ink/12 bg-trail-surface p-5 shadow-trail',
        className
      )}>
      
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-leaf/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gold-leaf">
          <SparklesIcon className="h-3.5 w-3.5" /> Wisdom
        </span>
        <button
          type="button"
          onClick={onFavorite}
          aria-label={favorited ? 'Unfavorite' : 'Favorite'}
          className="text-trail-ink/30 transition-colors hover:text-gold-leaf">
          
          <StarIcon
            className="h-4 w-4"
            fill={favorited ? 'currentColor' : 'none'}
            style={favorited ? { color: 'hsl(var(--gold-leaf))' } : undefined} />
          
        </button>
      </div>
      <blockquote className="font-display text-lg leading-snug text-trail-ink">
        “{entry.text}”
      </blockquote>
      <figcaption className="mt-3 text-sm text-trail-ink-soft">
        — {entry.attribution}
        {entry.original &&
        <span className="ml-1 text-trail-ink/40">· The 120</span>
        }
      </figcaption>
    </motion.figure>);

}

/**
 * MarginNote — HQ rendering. A typographically beautiful pull-quote that slides in
 * contextually and collects into the Almanac. Same content, quieter finish.
 */
export function MarginNote({ entry, className }: {entry: WisdomEntry;className?: string;}) {
  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={cn('border-l-2 border-hq-border-strong pl-4', className)}>
      
      <QuoteIcon className="mb-1 h-4 w-4 text-hq-ink-muted" />
      <p className="font-display text-lg leading-snug text-hq-ink">{entry.text}</p>
      <p className="mt-1.5 text-sm text-hq-ink-muted">
        — {entry.attribution}
        {entry.original && <span className="ml-1">· The 120</span>}
      </p>
    </motion.aside>);

}