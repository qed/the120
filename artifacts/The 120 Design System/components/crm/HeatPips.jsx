import React from "react";

/**
 * Heat meter — five 8px squares (echoing the square 120 chip), filled red for
 * the current value. Optionally shows the auto-suggested value as ghost
 * outlines when overridden.
 */
export function HeatPips({ value = 3, max = 5, suggested }) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < value;
        const isSuggestedEdge = suggested != null && i < suggested && !filled;
        return (
          <span
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: filled ? "var(--red)" : "transparent",
              border: filled
                ? "none"
                : isSuggestedEdge
                ? "1px solid var(--red)"
                : "1px solid #e0ddd7",
              boxSizing: "border-box",
            }}
          />
        );
      })}
    </span>
  );
}
