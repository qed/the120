export interface StatusPillProps {
  children?: React.ReactNode;
  /**
   * neutral = INTERESTED/ACCOUNT; blue = DOSSIER/CALL stages; red = DEPOSIT PAID/MEMBER;
   * ink = LOST; blush = WAITLIST; green = paid confirmation.
   */
  tone?: "neutral" | "blue" | "red" | "ink" | "blush" | "green";
}
export function StatusPill(props: StatusPillProps): JSX.Element;
