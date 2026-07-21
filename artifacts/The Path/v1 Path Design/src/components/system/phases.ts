// The Path — the five phases are the spine of the whole system.
// Mechanics are constant; only Trail vs HQ rendering differs.

export type PhaseKey = 'sell' | 'build' | 'validate' | 'grow' | 'scale';
export type Skin = 'trail' | 'hq';
export type Band = 'g3_5' | 'g6_8' | 'g9_12';

export type TaskState =
'locked' |
'available' |
'in_progress' |
'submitted' |
'not_yet' |
'verified';

export interface PhaseMeta {
  key: PhaseKey;
  index: number;
  name: string;
  tagline: string;
  /** Trail territory metaphor */
  territory: string;
  /** tailwind text/bg/border color token, e.g. "phase-sell" */
  color: string;
}

export const PHASES: PhaseMeta[] = [
{
  key: 'sell',
  index: 1,
  name: 'SELL',
  tagline: 'Learn to confidently sell anything.',
  territory: 'The Market Town',
  color: 'phase-sell'
},
{
  key: 'build',
  index: 2,
  name: 'BUILD',
  tagline: 'Make a real product with AI.',
  territory: 'The Workshop Quarter',
  color: 'phase-build'
},
{
  key: 'validate',
  index: 3,
  name: 'VALIDATE',
  tagline: 'Test ideas like a scientist.',
  territory: 'The Observatory',
  color: 'phase-validate'
},
{
  key: 'grow',
  index: 4,
  name: 'GROW',
  tagline: 'Turn a validated idea into a running business.',
  territory: 'The Growing High Street',
  color: 'phase-grow'
},
{
  key: 'scale',
  index: 5,
  name: 'SCALE',
  tagline: 'Build systems so the business runs beyond them.',
  territory: 'The Summit City',
  color: 'phase-scale'
}];


export const phaseByKey = (key: PhaseKey): PhaseMeta =>
PHASES.find((p) => p.key === key)!;

/** raw hsl string for inline styles / gradients / svg fills */
export const PHASE_HSL: Record<PhaseKey, string> = {
  sell: 'var(--phase-sell)',
  build: 'var(--phase-build)',
  validate: 'var(--phase-validate)',
  grow: 'var(--phase-grow)',
  scale: 'var(--phase-scale)'
};

export const phaseColor = (key: PhaseKey): string => `hsl(${PHASE_HSL[key]})`;