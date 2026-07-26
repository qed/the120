



import React from 'react';
import { CheckIcon, ImageIcon, FileTextIcon, LinkIcon, VideoIcon } from 'lucide-react';
import { cn } from './cn';
import { Button } from './Button';
import { phaseColor, type PhaseKey } from './phases';

type EvidenceKind = 'photo' | 'video' | 'log' | 'link';

export interface EvidenceItem {
  kind: EvidenceKind;
  label: string;
}

interface ReviewPanelProps {
  taskId: string;
  title: string;
  doneWhen: string;
  bandVariant?: string;
  phase: PhaseKey;
  evidence: EvidenceItem[];
  reviewer?: string;
  onVerify?: () => void;
  onNotYet?: () => void;
  className?: string;
}

const kindIcon: Record<EvidenceKind, React.ElementType> = {
  photo: ImageIcon,
  video: VideoIcon,
  log: FileTextIcon,
  link: LinkIcon
};

/**
 * ReviewPanel — the parent's split view. Evidence on one side, the Done-when line
 * on the other, band variant shown so the parent holds the right bar. Verifying
 * is one tap; Not Yet requires a note. Built to make verifying easier than doing.
 */
export function ReviewPanel({
  taskId,
  title,
  doneWhen,
  bandVariant,
  phase,
  evidence,
  reviewer = 'You',
  onVerify,
  onNotYet,
  className
}: ReviewPanelProps) {
  const color = phaseColor(phase);
  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border border-hq-border bg-hq-canvas shadow-hq-lg',
        className
      )}
      aria-label={`Review ${taskId}`}>
      
      <header className="flex items-center justify-between border-b border-hq-border bg-hq-surface px-5 py-3">
        <div>
          <span className="font-mono text-xs text-hq-ink-muted">{taskId}</span>
          <h3 className="text-sm font-semibold text-hq-ink">{title}</h3>
        </div>
        <span className="text-xs text-hq-ink-muted">Reviewer: {reviewer}</span>
      </header>

      <div className="grid gap-px bg-hq-border sm:grid-cols-2">
        {/* Evidence side */}
        <div className="bg-hq-canvas p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-hq-ink-muted">
            Evidence
          </span>
          <ul className="mt-3 space-y-2">
            {evidence.map((e, i) => {
              const Icon = kindIcon[e.kind];
              return (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-hq-border bg-hq-surface px-3 py-2.5">
                  
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: `${color}18`, color }}>
                    
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm text-hq-ink">{e.label}</span>
                </li>);

            })}
          </ul>
        </div>

        {/* The bar side */}
        <div className="bg-hq-canvas p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-hq-ink-muted">
            Does this clear the bar?
          </span>
          <div
            className="mt-3 rounded-lg border-l-2 bg-hq-surface px-3 py-3"
            style={{ borderColor: color }}>
            
            <span className="text-[11px] font-semibold uppercase tracking-wide text-hq-ink-muted">
              Done when
            </span>
            <p className="text-sm text-hq-ink">{doneWhen}</p>
          </div>
          {bandVariant &&
          <p className="mt-3 text-xs text-hq-ink-muted">
              <span className="font-medium text-hq-ink-soft">Hold this bar:</span> {bandVariant}
            </p>
          }
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t border-hq-border bg-hq-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
        <Button skin="hq" variant="secondary" size="md" onClick={onNotYet}>
          Not yet — add a note
        </Button>
        <Button
          skin="hq"
          size="md"
          onClick={onVerify}
          icon={<CheckIcon className="h-4 w-4" />}>
          
          Verify
        </Button>
      </footer>
    </section>);

}