

import React from 'react';

interface SectionProps {
  id: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}

/** A labelled block in the design-system reference gallery. */
export function Section({ id, title, intro, children }: SectionProps) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-hq-border py-12">
      <div className="mb-6 max-w-2xl">
        <h2 className="font-display text-2xl font-semibold text-hq-ink">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-hq-ink-soft">{intro}</p>
      </div>
      {children}
    </section>);

}