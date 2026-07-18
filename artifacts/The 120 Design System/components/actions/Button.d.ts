import React from "react";

export interface ButtonProps {
  children?: React.ReactNode;
  /** Red is reserved for the primary Join action — one per view. */
  variant?: "primary" | "ink" | "ghost" | "white" | "ghostLight";
  /** Render as a link to this href instead of a <button>. */
  href?: string;
  onClick?: () => void;
  /** Full-width. */
  block?: boolean;
  style?: React.CSSProperties;
}
export function Button(props: ButtonProps): JSX.Element;
