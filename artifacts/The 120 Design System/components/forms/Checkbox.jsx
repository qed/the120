import React from "react";

/**
 * Consent-style checkbox with wrapping label. Red accent. Never pre-checked
 * for CASL consent (Canadian anti-spam) — the box ships empty by design.
 */
export function Checkbox({ children, checked, onChange, ...rest }) {
  return (
    <label
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        lineHeight: 1.5,
        color: "var(--ink-soft)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ marginTop: 3, accentColor: "var(--red)", width: 16, height: 16, flex: "none" }}
        {...rest}
      />
      <span>{children}</span>
    </label>
  );
}
