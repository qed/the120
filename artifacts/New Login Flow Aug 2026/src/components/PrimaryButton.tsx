import React from 'react';

type Variant = 'profit' | 'ghost';

interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const STYLES: Record<Variant, string> = {
  profit:
  'bg-profit text-white hover:bg-profitDark focus-visible:outline-profit disabled:bg-ink/15 disabled:text-ink/40',
  ghost:
  'bg-transparent text-ink ring-1 ring-inset ring-ink/20 hover:bg-ink/5 focus-visible:outline-ink'
};

export function PrimaryButton({ variant = 'profit', className = '', ...props }: PrimaryButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-display text-base font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${STYLES[variant]} ${className}`} />);


}