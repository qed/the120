



import React from 'react';
import { cn } from './cn';
import { phaseByKey, phaseColor, type PhaseKey, type Skin } from './phases';

interface CrestProps {
  phase: PhaseKey;
  /** "1.3" style criterion id — drives the numeral shown on the crest */
  criterion?: string;
  skin?: Skin;
  size?: number;
  /** locked crests show as a faint silhouette */
  locked?: boolean;
  className?: string;
}

/**
 * Crest — the criterion achievement badge. Same heraldic artwork lineage in both skins:
 *   Trail  → full-color illustrated heraldry mounted on the landmark
 *   HQ     → clean monochrome achievement mark on the trophy wall
 * One design, two finishes, so nothing feels lost when toggling skins.
 */
export function Crest({
  phase,
  criterion,
  skin = 'hq',
  size = 72,
  locked = false,
  className
}: CrestProps) {
  const meta = phaseByKey(phase);
  const color = phaseColor(phase);
  const isTrail = skin === 'trail';
  const uid = `crest-${phase}-${criterion ?? 'x'}`.replace(/\./g, '-');

  const stroke = locked ? 'hsl(var(--hq-border-strong))' : isTrail ? 'hsl(var(--trail-ink))' : color;
  const fill = locked ?
  'hsl(var(--hq-sunken))' :
  isTrail ?
  color :
  'transparent';
  const numeralColor = locked ?
  'hsl(var(--hq-ink-muted))' :
  isTrail ?
  'white' :
  color;

  return (
    <div
      className={cn('inline-flex flex-col items-center gap-1', className)}
      title={`${meta.name} · ${criterion ?? meta.index}`}>
      
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={`${meta.name} criterion ${criterion ?? ''} crest`}
        className={isTrail && !locked ? 'drop-shadow-md' : undefined}>
        
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={isTrail ? 0.95 : 0.14} />
            <stop offset="1" stopColor={color} stopOpacity={isTrail ? 0.7 : 0.04} />
          </linearGradient>
        </defs>
        {/* heraldic shield */}
        <path
          d="M50 6 L86 18 V50 C86 74 68 88 50 95 C32 88 14 74 14 50 V18 Z"
          fill={locked ? fill : isTrail ? `url(#${uid})` : `url(#${uid})`}
          stroke={stroke}
          strokeWidth={isTrail ? 3 : 2.5}
          strokeLinejoin="round" />
        
        {/* inner chevron band */}
        <path
          d="M22 44 L50 30 L78 44"
          fill="none"
          stroke={locked ? 'hsl(var(--hq-border-strong))' : isTrail ? 'white' : color}
          strokeWidth={isTrail ? 3 : 2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85} />
        
        {/* criterion numeral */}
        <text
          x="50"
          y="68"
          textAnchor="middle"
          fontFamily="Fraunces, serif"
          fontSize="26"
          fontWeight="700"
          fill={numeralColor}>
          
          {criterion ? criterion.split('.')[1] ?? criterion : meta.index}
        </text>
      </svg>
    </div>);

}