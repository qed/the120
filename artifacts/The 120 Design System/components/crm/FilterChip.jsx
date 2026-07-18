import React from "react";

/**
 * Filter chip (mono). Active = electric-blue filled, white text; inactive =
 * bone with a hairline border. Matches the CRM/dossier-queue filter row.
 */
export function FilterChip({ children, active = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "7px 13px",
        borderRadius: "var(--radius-pill)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "all var(--dur) var(--ease)",
        background: active ? "var(--crm-blue)" : "var(--crm-card)",
        color: active ? "#fff" : "var(--ink-soft)",
        border: active ? "1px solid var(--crm-blue)" : "1px solid var(--line-strong)",
      }}
    >
      {children}
    </button>
  );
}
