import React from "react";

/**
 * Mono eyebrow/kicker — the typographic label that opens most sections and
 * cards. Uppercase IBM Plex Mono, letterspaced, red by default. Segments are
 * joined with a · separator by convention.
 */
export function Kicker({ children, tone = "red", size = 12 }) {
  const color =
    tone === "muted" ? "var(--muted)" : tone === "blush" ? "var(--blush)" : "var(--red)";
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </span>
  );
}
