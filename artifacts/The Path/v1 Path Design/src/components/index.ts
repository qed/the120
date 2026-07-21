
// The Path — Design System barrel export

// Foundation
export * from './system/phases';
export { cn } from './system/cn';

// Shared primitives
export { Button } from './system/Button';
export { StatusChip } from './system/StatusChip';
export { ProgressMeter } from './system/ProgressMeter';
export { SkinToggle } from './system/SkinToggle';

// Crest / Seal artwork lineage (one design, two finishes)
export { Crest } from './system/Crest';
export { Seal } from './system/Seal';

// Verification
export { ReviewPanel } from './system/ReviewPanel';
export type { EvidenceItem } from './system/ReviewPanel';

// Wisdom / Almanac
export { WisdomCard, MarginNote } from './system/Wisdom';
export type { WisdomEntry } from './system/Wisdom';

// Celebration
export { PhaseSealCelebration } from './system/PhaseSealCelebration';

// HQ skin
export { HQTaskCard } from './hq/TaskCard';
export type { TaskCardData } from './hq/TaskCard';
export { PhaseRow } from './hq/PhaseRow';

// Trail skin
export { TrailStep } from './trail/TrailStep';