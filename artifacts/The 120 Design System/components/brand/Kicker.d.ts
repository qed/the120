import React from "react";

export interface KickerProps {
  children?: React.ReactNode;
  /** red (default, on light), blush (on dark), muted (secondary). */
  tone?: "red" | "blush" | "muted";
  /** Font size in px (11–13 typical). */
  size?: number;
}
export function Kicker(props: KickerProps): JSX.Element;
