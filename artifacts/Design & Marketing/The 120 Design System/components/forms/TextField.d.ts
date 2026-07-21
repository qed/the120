import React from "react";

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Field label (Space Grotesk 600, 12.5px). */
  label?: string;
  /** Small mono hint below the field. */
  hint?: string;
  /** Squared marketing lead-capture style (bone field, no radius). */
  flat?: boolean;
}
export function TextField(props: TextFieldProps): JSX.Element;
