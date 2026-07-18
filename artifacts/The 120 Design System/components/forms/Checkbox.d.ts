import React from "react";

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Wrapping label content (often a consent sentence). */
  children?: React.ReactNode;
  checked?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
export function Checkbox(props: CheckboxProps): JSX.Element;
