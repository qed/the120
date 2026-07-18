import React from "react";

/**
 * Scarcity indicator: an 8px dot + mono seat count. Red dot on light
 * surfaces, blush on dark. Counts feed from one shared source of truth.
 */
export function SeatsDot({ remaining = 113, total = 120, tone = "light" }) {
  const onDark = tone === "onDark";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "var(--radius-pill)",
          background: onDark ? "var(--blush)" : "var(--red)",
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          letterSpacing: "0.06em",
          color: onDark ? "var(--text-on-dark-soft)" : "var(--ink)",
        }}
      >
        {remaining} OF {total} SEATS REMAIN
      </span>
    </span>
  );
}
