import React from "react";

/**
 * Labelled text input. Space Grotesk, hairline border, focus goes ink.
 * Default is the app/CRM style (white field, 10px radius). Pass flat for the
 * squared marketing lead-capture style (bone field, 1.5px border, no radius).
 */
export function TextField({ label, hint, flat = false, style, ...rest }) {
  const field = {
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    padding: flat ? "13px 16px" : "11px 13px",
    border: flat ? "1.5px solid var(--line)" : "1px solid var(--line-strong)",
    background: flat ? "var(--paper)" : "var(--white)",
    color: "var(--ink)",
    borderRadius: flat ? 0 : "var(--radius-button)",
    outline: "none",
    boxSizing: "border-box",
    width: "100%",
    ...style,
  };
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label ? (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
          {label}
        </span>
      ) : null}
      <input
        style={field}
        onFocus={(e) => (e.target.style.borderColor = "var(--ink)")}
        onBlur={(e) => (e.target.style.borderColor = flat ? "var(--line)" : "var(--line-strong)")}
        {...rest}
      />
      {hint ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted)" }}>{hint}</span>
      ) : null}
    </label>
  );
}
