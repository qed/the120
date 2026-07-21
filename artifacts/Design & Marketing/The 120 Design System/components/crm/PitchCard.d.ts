import React from "react";

export interface PitchCardProps {
  /** Blush mono kicker, e.g. "PROJECT PITCH" or "CONVERSATION CO-PILOT". */
  kicker?: string;
  /** Georgia-italic body (the pitch or the co-pilot summary). */
  children?: React.ReactNode;
  /** Show the pulsing red dot (co-pilot). */
  dot?: boolean;
  /** Optional white next-move pill text. */
  action?: string;
}
export function PitchCard(props: PitchCardProps): JSX.Element;
