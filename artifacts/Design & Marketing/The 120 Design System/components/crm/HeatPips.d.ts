export interface HeatPipsProps {
  /** Current heat 1–5. */
  value?: number;
  max?: number;
  /** Auto-suggested value, shown as ghost outlines beyond the manual value. */
  suggested?: number;
}
export function HeatPips(props: HeatPipsProps): JSX.Element;
