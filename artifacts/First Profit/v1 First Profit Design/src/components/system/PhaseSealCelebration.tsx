






import React from 'react';
import { motion } from 'framer-motion';
import { PartyPopperIcon, CalendarHeartIcon, ArrowRightIcon } from 'lucide-react';
import { cn } from './cn';
import { Button } from './Button';
import { Seal } from './Seal';
import { phaseByKey, phaseColor, PHASES, type PhaseKey, type Skin } from './phases';

interface StatLine {
  value: string;
  label: string;
}

interface PhaseSealCelebrationProps {
  phase: PhaseKey;
  skin?: Skin;
  stats: StatLine[];
  /** real evidence thumbnails from the Founder File montage */
  montage?: string[];
  onCelebrate?: () => void;
  onContinue?: () => void;
  className?: string;
}

/**
 * PhaseSealCelebration — Tier 3, the big one. Shared structure in both skins:
 * the seal presses, a montage of the phase's own evidence, the real numbers,
 * and the real-world celebration prompt. Trail plays it cinematic; HQ plays it
 * like closing a funding round — neither skin underplays it.
 */
export function PhaseSealCelebration({
  phase,
  skin = 'hq',
  stats,
  montage = [],
  onCelebrate,
  onContinue,
  className
}: PhaseSealCelebrationProps) {
  const meta = phaseByKey(phase);
  const color = phaseColor(phase);
  const isTrail = skin === 'trail';
  const next = PHASES.find((p) => p.index === meta.index + 1);

  return (
    <div
      className={cn(
        'relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl p-8 text-center shadow-hq-lg',
        isTrail ? 'bg-trail-surface' : 'bg-hq-canvas',
        className
      )}
      style={{ borderTop: `4px solid ${color}` }}>
      
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center">
        
        <span
          className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest"
          style={{ backgroundColor: `${color}18`, color }}>
          
          <PartyPopperIcon className="h-4 w-4" /> Phase sealed
        </span>

        <Seal phase={phase} skin={skin} size={120} animate sealed />

        <h2
          className={cn(
            'mt-5 text-2xl font-bold',
            isTrail ? 'font-display text-trail-ink' : 'text-hq-ink'
          )}>
          
          {isTrail ? `The gate is open. You finished ${meta.name}.` : `Phase 0${meta.index} · ${meta.name} sealed.`}
        </h2>
        <p className={cn('mt-1 text-sm', isTrail ? 'text-trail-ink-soft' : 'text-hq-ink-soft')}>
          {meta.tagline}
        </p>

        {montage.length > 0 &&
        <div className="mt-6 flex w-full gap-2 overflow-hidden">
            {montage.slice(0, 4).map((src, i) =>
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 * i }}
            className="h-20 flex-1 overflow-hidden rounded-lg bg-hq-sunken">
            
                <img src={src} alt="" className="h-full w-full object-cover" />
              </motion.div>
          )}
          </div>
        }

        <div className="mt-6 grid w-full grid-cols-3 gap-3">
          {stats.map((s, i) =>
          <div key={i} className={cn('rounded-xl p-3', isTrail ? 'bg-trail-canvas' : 'bg-hq-surface')}>
              <div
              className={cn('text-2xl font-bold tabular-nums', isTrail ? 'font-display' : 'font-mono')}
              style={{ color }}>
              
                {s.value}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-hq-ink-muted">{s.label}</div>
            </div>
          )}
        </div>

        <div className="mt-7 flex w-full flex-col gap-2 sm:flex-row">
          <Button
            skin={skin}
            variant="secondary"
            className="flex-1"
            onClick={onCelebrate}
            icon={<CalendarHeartIcon className="h-4 w-4" />}>
            
            This deserves a dinner
          </Button>
          {next &&
          <Button
            skin={skin}
            className="flex-1"
            onClick={onContinue}
            icon={<ArrowRightIcon className="h-4 w-4" />}>
            
              Open {next.name}
            </Button>
          }
        </div>
      </motion.div>
    </div>);

}