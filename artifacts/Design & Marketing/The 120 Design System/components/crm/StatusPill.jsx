import React from "react";

/**
 * Pipeline / review status pill (mono, uppercase, pill radius). Colour maps to
 * the family's stage or a child's review status — matching the CRM spec.
 */
const TONES = {
  neutral: { background: "#e0ddd7", color: "var(--ink-soft)" },
  blue: { background: "var(--crm-blue)", color: "#fff" },
  red: { background: "var(--red)", color: "#fff" },
  ink: { background: "var(--ink)", color: "#fff" },
  blush: { background: "var(--blush)", color: "var(--ink)" },
  green: { background: "var(--green)", color: "#fff" },
};

export function StatusPill({ children, tone = "neutral" }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "4px 10px",
        borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
        ...t,
      }}
    >
      {children}
    </span>
  );
}
