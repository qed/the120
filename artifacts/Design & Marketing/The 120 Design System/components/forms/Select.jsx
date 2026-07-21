import React from "react";

/** Select styled to match TextField. Options passed as [{value,label}] or strings. */
export function Select({ label, options = [], flat = false, style, ...rest }) {
  const field = {
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    padding: flat ? "13px 16px" : "11px 13px",
    border: flat ? "1.5px solid var(--line)" : "1px solid var(--line-strong)",
    background: flat ? "var(--paper)" : "var(--white)",
    color: "var(--ink-soft)",
    borderRadius: flat ? 0 : "var(--radius-button)",
    outline: "none",
    boxSizing: "border-box",
    width: "100%",
    appearance: "none",
    ...style,
  };
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label ? (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
          {label}
        </span>
      ) : null}
      <select style={field} {...rest}>
        {options.map((o, i) => {
          const value = typeof o === "string" ? o : o.value;
          const text = typeof o === "string" ? o : o.label;
          return (
            <option key={i} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </label>
  );
}
