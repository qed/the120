

import React from 'react';
import {
  LockIcon,
  CircleDashedIcon,
  CircleDotIcon,
  ClockIcon,
  StampIcon,
  CheckIcon } from
'lucide-react';
import { cn } from './cn';
import type { TaskState } from './phases';

interface StatusChipProps {
  state: TaskState;
  className?: string;
}

const config: Record<
  TaskState,
  {label: string;icon: React.ElementType;classes: string;}> =
{
  locked: {
    label: 'Locked',
    icon: LockIcon,
    classes: 'bg-hq-sunken text-hq-ink-muted border-hq-border'
  },
  available: {
    label: 'Available',
    icon: CircleDashedIcon,
    classes: 'bg-hq-canvas text-hq-ink-soft border-hq-border-strong'
  },
  in_progress: {
    label: 'In progress',
    icon: CircleDotIcon,
    classes: 'bg-hq-canvas text-hq-ink border-hq-border-strong'
  },
  submitted: {
    label: 'Awaiting review',
    icon: ClockIcon,
    classes: 'bg-awaiting/10 text-awaiting border-awaiting/25'
  },
  not_yet: {
    label: 'Not yet',
    icon: StampIcon,
    classes: 'bg-not-yet/10 text-not-yet border-not-yet/30'
  },
  verified: {
    label: 'Verified',
    icon: CheckIcon,
    classes: 'bg-verified/10 text-verified border-verified/25'
  }
};

/**
 * StatusChip — the quiet verification status pill used throughout HQ,
 * and inside review surfaces in both skins. "Not yet" is amber, never red.
 */
export function StatusChip({ state, className }: StatusChipProps) {
  const { label, icon: Icon, classes } = config[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        classes,
        className
      )}>
      
      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
      {label}
    </span>);

}