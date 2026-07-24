"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "./cn";
import { phaseByKey, phaseColor } from "./phases";
import type { PhaseKey } from "@/app/fp/content/types";
import type { Skin } from "@/app/fp/lib/skin-tokens";

interface SealProps {
  phase: PhaseKey;
  skin?: Skin;
  size?: number;
  /** unsealed phases render as a faint pending impression */
  sealed?: boolean;
  date?: string;
  /** play the wax-press entrance (used in the Tier 3 celebration) */
  animate?: boolean;
  className?: string;
}

/**
 * Seal — the phase achievement mark; the report-card stamp. Trail is a large wax
 * seal pressed on the gate between territories; HQ is a larger monochrome mark
 * with a completion date on the phase row. Parametric template (color + numeral)
 * behind a swappable art reference.
 */
export function Seal({
  phase,
  skin = "hq",
  size = 96,
  sealed = true,
  date,
  animate = false,
  className,
}: SealProps) {
  const meta = phaseByKey(phase);
  const color = phaseColor(phase);
  const isTrail = skin === "trail";
  // Skip the wax-press entrance when the OS asks for reduced motion — the seal
  // still renders in its final pressed state, just without the spring.
  const reduce = useReducedMotion();
  const playEntrance = animate && !reduce;

  const ring = !sealed ? "hsl(var(--hq-border-strong))" : isTrail ? "hsl(var(--wax))" : color;
  const face = !sealed
    ? "hsl(var(--hq-sunken))"
    : isTrail
      ? "hsl(var(--wax))"
      : `color-mix(in srgb, ${color} 12%, white)`;
  const text = !sealed ? "hsl(var(--hq-ink-muted))" : isTrail ? "white" : color;

  const teeth = Array.from({ length: 24 });

  return (
    <div className={cn("inline-flex flex-col items-center gap-1.5", className)}>
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={`${meta.name} phase ${sealed ? "sealed" : "not sealed"}`}
        initial={playEntrance ? { scale: 2.2, rotate: -18, opacity: 0 } : false}
        animate={playEntrance ? { scale: 1, rotate: -6, opacity: 1 } : {}}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
        className={sealed && isTrail ? "drop-shadow-lg" : undefined}
      >
        {/* scalloped wax edge */}
        {teeth.map((_, i) => {
          const a = (i / teeth.length) * Math.PI * 2;
          const cx = 50 + Math.cos(a) * 44;
          const cy = 50 + Math.sin(a) * 44;
          return <circle key={i} cx={cx} cy={cy} r={5.5} fill={face} opacity={sealed ? 1 : 0.5} />;
        })}
        <circle cx="50" cy="50" r="42" fill={face} stroke={ring} strokeWidth="2.5" />
        <circle cx="50" cy="50" r="34" fill="none" stroke={ring} strokeWidth="1.5" opacity="0.6" />
        <text
          x="50"
          y="45"
          textAnchor="middle"
          className="font-path-display"
          fontSize="13"
          fontWeight="700"
          letterSpacing="1"
          fill={text}
        >
          {meta.name}
        </text>
        <text
          x="50"
          y="63"
          textAnchor="middle"
          className="font-path-mono"
          fontSize="18"
          fontWeight="500"
          fill={text}
        >
          0{meta.index}
        </text>
      </motion.svg>
      {date && <span className="font-path-mono text-[11px] text-hq-ink-muted">{date}</span>}
    </div>
  );
}
