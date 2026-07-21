

import React from 'react';
import { MapIcon, LayoutDashboardIcon } from 'lucide-react';
import { cn } from './cn';
import type { Skin } from './phases';

interface SkinToggleProps {
  value: Skin;
  onChange: (skin: Skin) => void;
  className?: string;
}

/**
 * SkinToggle — the student's control to flip between Trail and HQ.
 * No data consequences; the choice belongs to the student.
 */
export function SkinToggle({ value, onChange, className }: SkinToggleProps) {
  const options: {key: Skin;label: string;icon: React.ElementType;}[] = [
  { key: 'trail', label: 'Trail', icon: MapIcon },
  { key: 'hq', label: 'HQ', icon: LayoutDashboardIcon }];

  return (
    <div
      role="tablist"
      aria-label="Skin"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-hq-border bg-hq-canvas p-1',
        className
      )}>
      
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-hq-ink text-white' : 'text-hq-ink-soft hover:bg-hq-sunken'
            )}>
            
            <o.icon className="h-4 w-4" />
            {o.label}
          </button>);

      })}
    </div>);

}