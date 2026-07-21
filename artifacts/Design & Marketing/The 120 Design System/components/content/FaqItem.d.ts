import React from "react";

export interface FaqItemProps {
  question: string;
  children?: React.ReactNode;
  /** Whether the answer is expanded (parent controls single-open). */
  open?: boolean;
  onToggle?: () => void;
}
export function FaqItem(props: FaqItemProps): JSX.Element;
