import React from "react";

export interface DisplayHeadingProps {
  /** Headline content. Wrap the accent word in <em style={{color:'var(--red)'}}> (light) or blush (dark). */
  children?: React.ReactNode;
  as?: "h1" | "h2" | "h3" | "div";
  /** Font size in px. 68 hero, 52 CTA, 44 section, 36 dashboard, 28 card. */
  size?: number;
  tone?: "light" | "dark";
  style?: React.CSSProperties;
}
export function DisplayHeading(props: DisplayHeadingProps): JSX.Element;
