import React from 'react';

interface BrandHeaderProps {
  step: number;
  totalSteps: number;
  stepLabel: string;
}

export function BrandHeader({ step, totalSteps, stepLabel }: BrandHeaderProps) {
  return (
    <header className="sticky top-0 z-20 w-full border-b border-ink/10 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-one20 font-mono text-[11px] font-bold text-white">
            120
          </span>
          <span className="hidden text-ink/25 sm:inline">→</span>
          <span className="hidden items-center gap-2 sm:flex">
            <span aria-hidden className="flex items-end gap-[2px]">
              <span className="block h-2 w-1 rounded-sm bg-profit" />
              <span className="block h-3 w-1 rounded-sm bg-sun" />
              <span className="block h-4 w-1 rounded-sm bg-one20" />
            </span>
            <span className="label-mono font-bold text-ink">First Profit</span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="label-mono text-stone">
            Step {step} of {totalSteps} · {stepLabel}
          </span>
          <div
            className="flex gap-1"
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={totalSteps}
            aria-label="Onboarding progress">
            
            {Array.from({ length: totalSteps }).map((_, i) =>
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full transition-colors ${
              i < step ? 'bg-profit' : 'bg-ink/10'}`
              } />

            )}
          </div>
        </div>
      </div>
    </header>);

}