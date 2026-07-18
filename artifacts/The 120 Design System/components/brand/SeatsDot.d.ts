export interface SeatsDotProps {
  /** Seats still available. */
  remaining?: number;
  /** Total seats (always 120 for The 120). */
  total?: number;
  /** "light" for bone surfaces, "onDark" for ink/blue. */
  tone?: "light" | "onDark";
}
export function SeatsDot(props: SeatsDotProps): JSX.Element;
