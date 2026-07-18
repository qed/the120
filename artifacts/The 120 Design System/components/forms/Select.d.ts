import React from "react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  /** Options as strings or {value,label}. */
  options?: Array<string | { value: string; label: string }>;
  flat?: boolean;
}
export function Select(props: SelectProps): JSX.Element;
